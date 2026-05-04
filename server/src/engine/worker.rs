use crate::commands::CommandRegistry;
use crate::domain::traits::{CommandParser, TaskStore};
use crate::domain::types::{CommandSpec, RunnerEvent, TaskMetadataPatch};
use crate::engine::scheduler::Scheduler;
use crate::error::AppError;
use async_trait::async_trait;
use chrono::Utc;
use sqlx::sqlite::SqlitePool;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use super_scanner_shared::models::TaskStatus;
use tokio::fs::OpenOptions;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::{Semaphore, broadcast, mpsc, watch};
use tracing::{error, info};

/// 简单命令解析器：支持 metadata.toml 中的 command_spec 或 workflow.json
pub struct SimpleCommandParser {}

#[async_trait]
impl CommandParser for SimpleCommandParser {
    async fn parse(&self, task_dir: &PathBuf) -> Result<Vec<CommandSpec>, AppError> {
        let workflow_path = task_dir.join("workflow.json");
        if workflow_path.exists() {
            let content = tokio::fs::read_to_string(&workflow_path)
                .await
                .map_err(|e| AppError::Config(format!("无法读取 workflow.json: {}", e)))?;
            let workflow: Vec<String> = serde_json::from_str(&content)
                .map_err(|e| AppError::Config(format!("workflow.json 格式错误: {}", e)))?;

            let mut specs = Vec::new();
            for cmd_id in workflow {
                let spec_path = task_dir.join("commands").join(&cmd_id).join("spec.toml");
                if spec_path.exists() {
                    let content = tokio::fs::read_to_string(&spec_path).await.map_err(|e| {
                        AppError::Config(format!("无法读取 spec.toml [{}]: {}", cmd_id, e))
                    })?;
                    let mut spec: CommandSpec = toml::from_str(&content).map_err(|e| {
                        AppError::Config(format!("spec.toml 格式错误 [{}]: {}", cmd_id, e))
                    })?;
                    spec.id = cmd_id;
                    specs.push(spec);
                }
            }
            return Ok(specs);
        }

        Err(AppError::Config(
            "未找到任务定义 (workflow.json)".to_string(),
        ))
    }
}

pub async fn run_task_loop(
    task_id: String,
    specs: Vec<CommandSpec>,
    store: Arc<dyn TaskStore>,
    tx: broadcast::Sender<RunnerEvent>,
    mut stop_rx: mpsc::Receiver<()>,
    cancel_rx: watch::Receiver<bool>,
    task_dir: PathBuf,
    registry: CommandRegistry,
    scheduler: Arc<dyn Scheduler>,
) {
    // 更新状态为 RUNNING
    if let Err(e) = store
        .set_status(
            &task_id,
            TaskStatus::Running.as_i32(),
            Some(0),
            None,
            None,
            None,
        )
        .await
    {
        error!("无法更新任务状态: {}", e);
        let _ = scheduler.fail(&task_id, &e.to_string()).await;
        return;
    }

    // 连接任务数据库
    let pool = match crate::storage::task_db::open_targets_db(&task_dir).await {
        Ok(p) => p,
        Err(e) => {
            let msg = format!("无法连接任务数据库: {}", e);
            let _ = store
                .set_status(
                    &task_id,
                    TaskStatus::Failed.as_i32(),
                    None,
                    Some(-1),
                    Some(msg.clone()),
                    Some(Utc::now().timestamp_millis()),
                )
                .await;
            let _ = scheduler.fail(&task_id, &msg).await;
            return;
        }
    };

    for mut spec in specs {
        let cmd_id = spec.id.clone();

        if let Some(cmd_impl) = registry.get(&cmd_id) {
            // === 并行执行模式 ===
            if let Err(e) = cmd_impl.init_db(&pool).await {
                let msg = format!("DB Init failed for {}: {}", cmd_id, e);
                let _ = store
                    .set_status(
                        &task_id,
                        TaskStatus::Failed.as_i32(),
                        None,
                        Some(-1),
                        Some(msg.clone()),
                        Some(Utc::now().timestamp_millis()),
                    )
                    .await;
                let _ = scheduler.fail(&task_id, &msg).await;
                return;
            }

            let total_row: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM targets")
                .fetch_one(&pool)
                .await
                .unwrap_or((0,));
            let total_targets = total_row.0 as usize;

            let targets_result: Result<Vec<(String,)>, _> =
                sqlx::query_as("SELECT ip FROM targets WHERE status = 'pending'")
                    .fetch_all(&pool)
                    .await;

            let targets = match targets_result {
                Ok(t) => t,
                Err(e) => {
                    let msg = format!("Failed to fetch targets: {}", e);
                    error!("{}", msg);
                    return;
                }
            };

            let initial_completed = if total_targets > targets.len() {
                total_targets - targets.len()
            } else {
                0
            };

            let (update_tx, mut update_rx) = mpsc::channel::<(String, bool)>(1000);
            let pool_for_updater = pool.clone();
            let store_for_updater = store.clone();
            let task_id_for_updater = task_id.clone();
            let tx_for_updater = tx.clone();

            let updater_handle = tokio::spawn(async move {
                let mut buffer = Vec::with_capacity(100);
                let mut current_completed = initial_completed;
                let mut last_saved_progress: u8 = 0;

                let flush = |pool: SqlitePool, items: Vec<(String, bool)>| async move {
                    if items.is_empty() {
                        return;
                    }
                    let mut finished_ips = Vec::new();
                    let mut failed_ips = Vec::new();
                    for (ip, success) in items {
                        if success {
                            finished_ips.push(ip);
                        } else {
                            failed_ips.push(ip);
                        }
                    }
                    if !finished_ips.is_empty() {
                        let placeholders: Vec<&str> = finished_ips.iter().map(|_| "?").collect();
                        let sql = format!(
                            "UPDATE targets SET status = 'finished' WHERE ip IN ({})",
                            placeholders.join(",")
                        );
                        let mut query = sqlx::query(&sql);
                        for ip in finished_ips {
                            query = query.bind(ip);
                        }
                        let _ = query.execute(&pool).await;
                    }
                    if !failed_ips.is_empty() {
                        let placeholders: Vec<&str> = failed_ips.iter().map(|_| "?").collect();
                        let sql = format!(
                            "UPDATE targets SET status = 'failed' WHERE ip IN ({})",
                            placeholders.join(",")
                        );
                        let mut query = sqlx::query(&sql);
                        for ip in failed_ips {
                            query = query.bind(ip);
                        }
                        let _ = query.execute(&pool).await;
                    }
                };

                while let Some(item) = update_rx.recv().await {
                    buffer.push(item);
                    current_completed += 1;

                    let percent = if total_targets > 0 {
                        ((current_completed as f64 / total_targets as f64) * 100.0) as u8
                    } else {
                        0
                    };
                    let _ = tx_for_updater.send(RunnerEvent::Progress {
                        percent,
                        ts: Utc::now().timestamp_millis(),
                    });

                    if buffer.len() >= 50 {
                        let items: Vec<_> = buffer.drain(..).collect();
                        flush(pool_for_updater.clone(), items).await;

                        if percent > last_saved_progress {
                            let _ = store_for_updater
                                .update_task(
                                    &task_id_for_updater,
                                    &TaskMetadataPatch {
                                        progress: Some(percent),
                                        ..Default::default()
                                    },
                                )
                                .await;
                            last_saved_progress = percent;
                        }
                    }
                }
                // Final flush
                if !buffer.is_empty() {
                    let items: Vec<_> = buffer.drain(..).collect();
                    flush(pool_for_updater.clone(), items).await;

                    let percent = if total_targets > 0 {
                        ((current_completed as f64 / total_targets as f64) * 100.0) as u8
                    } else {
                        0
                    };
                    let _ = store_for_updater
                        .update_task(
                            &task_id_for_updater,
                            &TaskMetadataPatch {
                                progress: Some(percent),
                                ..Default::default()
                            },
                        )
                        .await;
                }
            });

            let semaphore = Arc::new(Semaphore::new(10));
            let mut handles = Vec::new();
            let mut stopped = false;

            for (target,) in targets {
                if stop_rx.try_recv().is_ok() || *cancel_rx.borrow() {
                    info!("任务 {} 收到停止信号", task_id);
                    stopped = true;
                    break;
                }

                let permit = match semaphore.clone().acquire_owned().await {
                    Ok(p) => p,
                    Err(_) => break,
                };

                let cmd_clone = cmd_impl.box_clone();
                let pool_clone = pool.clone();
                let task_dir_clone = task_dir.clone();
                let target_clone = target.clone();
                let update_tx_clone = update_tx.clone();
                let mut cancel_rx_clone = cancel_rx.clone();

                let handle = tokio::spawn(async move {
                    let _permit = permit;
                    if *cancel_rx_clone.borrow_and_update() {
                        let _ = update_tx_clone.send((target_clone, false)).await;
                        return;
                    }
                    let success = cmd_clone
                        .execute_target(&target_clone, &task_dir_clone, &pool_clone)
                        .await
                        .is_ok();
                    let _ = update_tx_clone.send((target_clone, success)).await;
                });
                handles.push(handle);
            }

            drop(update_tx);

            for h in handles {
                let _ = h.await;
            }
            let _ = updater_handle.await;

            if stopped {
                let _ = store
                    .set_status(
                        &task_id,
                        TaskStatus::Stopped.as_i32(),
                        None,
                        None,
                        None,
                        Some(Utc::now().timestamp_millis()),
                    )
                    .await;
                let _ = scheduler.complete(&task_id).await;
                return;
            }

            if let Err(e) = cmd_impl.process_result(&task_dir).await {
                error!("Post-processing failed: {}", e);
            }
        } else {
            // === 旧模式：进程执行 (Fallback) ===
            let cmd_dir = task_dir.join("commands").join(&cmd_id);
            if let Err(e) = tokio::fs::create_dir_all(&cmd_dir).await {
                let msg = format!("无法创建命令目录 {}: {}", cmd_dir.display(), e);
                let _ = tx.send(RunnerEvent::Error {
                    message: msg,
                    ts: Utc::now().timestamp_millis(),
                });
                return;
            }

            let stdout_path = cmd_dir.join("stdout.log");
            let stderr_path = cmd_dir.join("stderr.log");

            let stdout_file = match OpenOptions::new()
                .create(true)
                .write(true)
                .truncate(true)
                .open(&stdout_path)
                .await
            {
                Ok(f) => f,
                Err(e) => {
                    let _ = tx.send(RunnerEvent::Error {
                        message: format!("无法打开 stdout 日志: {}", e),
                        ts: Utc::now().timestamp_millis(),
                    });
                    return;
                }
            };
            let stderr_file = match OpenOptions::new()
                .create(true)
                .write(true)
                .truncate(true)
                .open(&stderr_path)
                .await
            {
                Ok(f) => f,
                Err(e) => {
                    let _ = tx.send(RunnerEvent::Error {
                        message: format!("无法打开 stderr 日志: {}", e),
                        ts: Utc::now().timestamp_millis(),
                    });
                    return;
                }
            };

            if !spec.targets.is_empty() {
                spec.args.extend(spec.targets);
            }

            let mut cmd = Command::new(&spec.program);
            cmd.args(&spec.args);
            if let Some(cwd) = &spec.cwd {
                cmd.current_dir(cwd);
            }
            cmd.stdout(Stdio::piped());
            cmd.stderr(Stdio::piped());

            let mut child = match cmd.spawn() {
                Ok(c) => c,
                Err(e) => {
                    let msg = format!("启动进程失败 [{}]: {}", cmd_id, e);
                    let _ = tx.send(RunnerEvent::Error {
                        message: msg.clone(),
                        ts: Utc::now().timestamp_millis(),
                    });
                    let _ = store
                        .set_status(
                            &task_id,
                            TaskStatus::Failed.as_i32(),
                            None,
                            Some(-1),
                            Some(msg),
                            Some(Utc::now().timestamp_millis()),
                        )
                        .await;
                    let _ = scheduler
                        .fail(&task_id, &format!("启动进程失败: {}", e))
                        .await;
                    return;
                }
            };

            let stdout = child.stdout.take().expect("failed to capture stdout");
            let stderr = child.stderr.take().expect("failed to capture stderr");
            let mut stdout_reader = BufReader::new(stdout).lines();
            let mut stderr_reader = BufReader::new(stderr).lines();

            let mut stdout_writer = tokio::io::BufWriter::new(stdout_file);
            let mut stderr_writer = tokio::io::BufWriter::new(stderr_file);

            tokio::spawn(async move {
                while let Ok(Some(line)) = stdout_reader.next_line().await {
                    let _ = stdout_writer.write_all(line.as_bytes()).await;
                    let _ = stdout_writer.write_all(b"\n").await;
                }
                let _ = stdout_writer.flush().await;
            });

            tokio::spawn(async move {
                while let Ok(Some(line)) = stderr_reader.next_line().await {
                    let _ = stderr_writer.write_all(line.as_bytes()).await;
                    let _ = stderr_writer.write_all(b"\n").await;
                }
                let _ = stderr_writer.flush().await;
            });

            loop {
                tokio::select! {
                    val = stop_rx.recv() => {
                        match val {
                            Some(_) | None => {
                                info!("任务 {} 收到停止信号", task_id);
                                let _ = child.kill().await;
                                let _ = store.set_status(&task_id, TaskStatus::Stopped.as_i32(), None, None, None, Some(Utc::now().timestamp_millis())).await;
                                let _ = scheduler.complete(&task_id).await;
                                return;
                            }
                        }
                    }
                    status = child.wait() => {
                        match status {
                            Ok(s) => {
                                if !s.success() {
                                    let code = s.code().unwrap_or(-1);
                                    let msg = format!("Command '{}' failed with exit code {}", cmd_id, code);
                                    let _ = store.set_status(&task_id, TaskStatus::Failed.as_i32(), None, Some(code), Some(msg.clone()), Some(Utc::now().timestamp_millis())).await;
                                    let _ = tx.send(RunnerEvent::Exit { code, ts: Utc::now().timestamp_millis() });
                                    let _ = scheduler.fail(&task_id, &msg).await;
                                    return;
                                }
                                break;
                            }
                            Err(_) => break,
                        }
                    }
                }
            }
        }
    }

    // 所有命令执行完毕
    let ts = Utc::now().timestamp_millis();
    let _ = store
        .set_status(
            &task_id,
            TaskStatus::Done.as_i32(),
            Some(100),
            Some(0),
            None,
            Some(ts),
        )
        .await;
    let _ = tx.send(RunnerEvent::Exit { code: 0, ts });
    let _ = scheduler.complete(&task_id).await;

    if let Ok(Some(meta)) = store.get_task(&task_id).await {
        let _ = tx.send(RunnerEvent::Snapshot { meta, ts });
    }
}
