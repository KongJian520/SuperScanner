use crate::core::traits::{CommandParser, TaskManager, TaskStore};
use crate::core::types::{CommandSpec, RunnerEvent, TaskMetadataPatch};
use crate::core::command::CommandRegistry;
use crate::error::AppError;
use async_trait::async_trait;
use chrono::Utc;
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use tokio::fs::OpenOptions;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::{RwLock, broadcast, mpsc, Semaphore};
use tracing::{error, info};
use sqlx::sqlite::{SqlitePool, SqliteConnectOptions};
use std::str::FromStr;
use std::sync::atomic::{AtomicUsize, Ordering};

/// 简单的命令解析器：支持 metadata.toml 中的 command_spec 或回退到 targets[0]
pub struct SimpleCommandParser {}

#[async_trait]
impl CommandParser for SimpleCommandParser {
    async fn parse(&self, task_dir: &PathBuf) -> Result<Vec<CommandSpec>, AppError> {
        // 1. 尝试读取 workflow.json
        let workflow_path = task_dir.join("workflow.json");
        if workflow_path.exists() {
            let content = tokio::fs::read_to_string(&workflow_path).await
                .map_err(|e| AppError::Config(format!("无法读取 workflow.json: {}", e)))?;
            let workflow: Vec<String> = serde_json::from_str(&content)
                .map_err(|e| AppError::Config(format!("workflow.json 格式错误: {}", e)))?;
            
            let mut specs = Vec::new();
            for cmd_id in workflow {
                let spec_path = task_dir.join("commands").join(&cmd_id).join("spec.toml");
                if spec_path.exists() {
                    let content = tokio::fs::read_to_string(&spec_path).await
                        .map_err(|e| AppError::Config(format!("无法读取 spec.toml [{}]: {}", cmd_id, e)))?;
                    let mut spec: CommandSpec = toml::from_str(&content)
                        .map_err(|e| AppError::Config(format!("spec.toml 格式错误 [{}]: {}", cmd_id, e)))?;
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

struct RunnerHandle {
    pub broadcaster: broadcast::Sender<RunnerEvent>,
    #[allow(dead_code)]
    pub join_handle: tokio::task::JoinHandle<()>,
    pub stop_tx: mpsc::Sender<()>,
}

pub struct BackgroundTaskRunner {
    tasks_dir: PathBuf,
    store: Arc<dyn TaskStore>,
    running_tasks: Arc<RwLock<HashMap<String, RunnerHandle>>>,
    parser: Box<dyn CommandParser>,
    registry: CommandRegistry,
}

async fn append_runner_log(_file: &mut Option<tokio::fs::File>, _msg: &str) {
    // Log functionality disabled
}

impl BackgroundTaskRunner {
    pub fn new(tasks_dir: PathBuf, store: Arc<dyn TaskStore>, registry: CommandRegistry) -> Self {
        Self {
            tasks_dir,
            store,
            running_tasks: Arc::new(RwLock::new(HashMap::new())),
            parser: Box::new(SimpleCommandParser {}),
            registry,
        }
    }

    async fn run_task_loop(
        task_id: String,
        specs: Vec<CommandSpec>,
        store: Arc<dyn TaskStore>,
        tx: broadcast::Sender<RunnerEvent>,
        mut stop_rx: mpsc::Receiver<()>,
        task_dir: PathBuf,
        registry: CommandRegistry,
    ) {
        let _start_ts = Utc::now().timestamp_millis();

        // [新增] 创建并打开 runner.log
        // Log functionality disabled
        let mut runner_log_file: Option<tokio::fs::File> = None;

        append_runner_log(&mut runner_log_file, "Task runner started").await;

        // 更新数据库状态为 RUNNING
        if let Err(e) = store.set_status(&task_id, 2, Some(0), None, None, None).await {
            let msg = format!("无法更新任务状态: {}", e);
            error!("{}", msg);
            append_runner_log(&mut runner_log_file, &msg).await;
            return;
        }

        append_runner_log(&mut runner_log_file, &format!("Found {} commands to execute", specs.len())).await;

        // 连接任务数据库
        let db_path = task_dir.join("targets.db");
        let db_url = format!("sqlite://{}", db_path.to_string_lossy());
        
        let opts = SqliteConnectOptions::from_str(&db_url)
            .unwrap_or_else(|_| SqliteConnectOptions::new().filename(&db_path))
            .create_if_missing(true)
            .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal)
            .synchronous(sqlx::sqlite::SqliteSynchronous::Normal)
            .busy_timeout(std::time::Duration::from_secs(5));

        let pool = match sqlx::pool::PoolOptions::new()
            .max_connections(1)
            .connect_with(opts).await {
            Ok(p) => p,
            Err(e) => {
                let msg = format!("无法连接任务数据库: {}", e);
                append_runner_log(&mut runner_log_file, &msg).await;
                let _ = store.set_status(&task_id, 4, None, Some(-1), Some(msg), Some(Utc::now().timestamp_millis())).await;
                return;
            }
        };

        for mut spec in specs {
            let cmd_id = spec.id.clone();
            append_runner_log(&mut runner_log_file, &format!("Preparing command: {}", cmd_id)).await;

            // 检查是否在注册表中
            if let Some(cmd_impl) = registry.get(&cmd_id) {
                // === 新模式：并行执行 ===
                append_runner_log(&mut runner_log_file, &format!("Executing {} in parallel mode", cmd_id)).await;

                // 1. 初始化 DB
                if let Err(e) = cmd_impl.init_db(&pool).await {
                    let msg = format!("DB Init failed for {}: {}", cmd_id, e);
                    append_runner_log(&mut runner_log_file, &msg).await;
                    let _ = store.set_status(&task_id, 4, None, Some(-1), Some(msg), Some(Utc::now().timestamp_millis())).await;
                    return;
                }

                // 2. 获取待处理目标
                // [新增] 获取总目标数以计算进度
                let total_row: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM targets")
                    .fetch_one(&pool).await
                    .unwrap_or((0,));
                let total_targets = total_row.0 as usize;

                let targets_result: Result<Vec<(String,)>, _> = sqlx::query_as("SELECT ip FROM targets WHERE status = 'pending'")
                    .fetch_all(&pool).await;
                
                let targets = match targets_result {
                    Ok(t) => t,
                    Err(e) => {
                        let msg = format!("Failed to fetch targets: {}", e);
                        append_runner_log(&mut runner_log_file, &msg).await;
                        return;
                    }
                };

                // [新增] 计算初始已完成数量
                let initial_completed = if total_targets > targets.len() { total_targets - targets.len() } else { 0 };
                let completed_counter = Arc::new(AtomicUsize::new(initial_completed));

                append_runner_log(&mut runner_log_file, &format!("Found {} pending targets (Total: {}, Completed: {})", targets.len(), total_targets, initial_completed)).await;

                // [新增] 批量更新通道
                let (update_tx, mut update_rx) = mpsc::channel::<(String, bool)>(1000);
                let pool_for_updater = pool.clone();
                let store_for_updater = store.clone();
                let task_id_for_updater = task_id.clone();
                
                let updater_handle = tokio::spawn(async move {
                    let mut buffer = Vec::with_capacity(100);
                    let mut current_completed = initial_completed;
                    let mut last_saved_progress = 0;
                    
                    // 定义一个宏或闭包来处理刷新逻辑是不可能的（async closure），所以我们定义一个内部函数
                    // 但内部函数不能捕获环境，所以我们只能复制代码或者使用一个结构体
                    // 为了简单起见，我们在这里复制代码逻辑，或者使用一个简单的循环处理
                    
                    let flush = |pool: SqlitePool, items: Vec<(String, bool)>| async move {
                        if items.is_empty() { return; }
                        let mut finished_ips = Vec::new();
                        let mut failed_ips = Vec::new();
                        for (ip, success) in items {
                            if success { finished_ips.push(ip); } else { failed_ips.push(ip); }
                        }
                        
                        if !finished_ips.is_empty() {
                            let placeholders: Vec<&str> = finished_ips.iter().map(|_| "?").collect();
                            let sql = format!("UPDATE targets SET status = 'finished' WHERE ip IN ({})", placeholders.join(","));
                            let mut query = sqlx::query(&sql);
                            for ip in finished_ips { query = query.bind(ip); }
                            let _ = query.execute(&pool).await;
                        }
                        
                        if !failed_ips.is_empty() {
                            let placeholders: Vec<&str> = failed_ips.iter().map(|_| "?").collect();
                            let sql = format!("UPDATE targets SET status = 'failed' WHERE ip IN ({})", placeholders.join(","));
                            let mut query = sqlx::query(&sql);
                            for ip in failed_ips { query = query.bind(ip); }
                            let _ = query.execute(&pool).await;
                        }
                    };

                    while let Some(item) = update_rx.recv().await {
                        buffer.push(item);
                        current_completed += 1;

                        if buffer.len() >= 50 {
                            let items: Vec<_> = buffer.drain(..).collect();
                            flush(pool_for_updater.clone(), items).await;

                            // Update progress
                            let progress = if total_targets > 0 {
                                ((current_completed as f64 / total_targets as f64) * 100.0) as u8
                            } else {
                                0
                            };
                            
                            // Save progress if it changed
                            if progress > last_saved_progress {
                                let _ = store_for_updater.update_task(&task_id_for_updater, &TaskMetadataPatch {
                                    progress: Some(progress),
                                    ..Default::default()
                                }).await;
                                last_saved_progress = progress;
                            }
                        }
                    }
                    // Final flush
                    if !buffer.is_empty() {
                        let items: Vec<_> = buffer.drain(..).collect();
                        flush(pool_for_updater.clone(), items).await;

                        // Final progress update
                        let progress = if total_targets > 0 {
                            ((current_completed as f64 / total_targets as f64) * 100.0) as u8
                        } else {
                            0
                        };
                        let _ = store_for_updater.update_task(&task_id_for_updater, &TaskMetadataPatch {
                            progress: Some(progress),
                            ..Default::default()
                        }).await;
                    }
                });

                // 3. 并行执行
                let semaphore = Arc::new(Semaphore::new(10)); // 10 threads
                let mut handles = Vec::new();
                let mut stopped = false;

                for (target,) in targets {
                    // Check stop signal
                    if stop_rx.try_recv().is_ok() {
                        info!("任务 {} 收到停止信号", task_id);
                        append_runner_log(&mut runner_log_file, "Task stopped by user").await;
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
                    
                    // [新增] 克隆计数器和发送通道
                    let counter_clone = completed_counter.clone();
                    let tx_clone = tx.clone();
                    let total_targets_clone = total_targets;
                    let update_tx_clone = update_tx.clone();
                    
                    let handle = tokio::spawn(async move {
                        let _permit = permit;
                        // Execute
                        let success = match cmd_clone.execute_target(&target_clone, &task_dir_clone, &pool_clone).await {
                            Ok(_) => true,
                            Err(_) => false,
                        };
                        
                        let _ = update_tx_clone.send((target_clone, success)).await;

                        // [新增] 更新进度并发送事件
                        let current = counter_clone.fetch_add(1, Ordering::SeqCst) + 1;
                        if total_targets_clone > 0 {
                            let percent = ((current as f64 / total_targets_clone as f64) * 100.0) as u8;
                            let _ = tx_clone.send(RunnerEvent::Progress { 
                                percent, 
                                ts: Utc::now().timestamp_millis() 
                            });
                        }
                    });
                    handles.push(handle);
                }

                drop(update_tx); // Close the channel so updater knows we are done

                // Wait for all spawned tasks
                for h in handles {
                    let _ = h.await;
                }
                
                // Wait for updater
                let _ = updater_handle.await;

                if stopped {
                    let _ = store.set_status(&task_id, 5, None, None, None, Some(Utc::now().timestamp_millis())).await;
                    return;
                }

                // Process result (optional post-processing)
                if let Err(e) = cmd_impl.process_result(&task_dir).await {
                     append_runner_log(&mut runner_log_file, &format!("Post-processing failed: {}", e)).await;
                }

            } else {
                // === 旧模式：进程执行 (Fallback) ===
                let cmd_dir = task_dir.join("commands").join(&cmd_id);
                if let Err(e) = tokio::fs::create_dir_all(&cmd_dir).await {
                    let msg = format!("无法创建命令目录 {}: {}", cmd_dir.display(), e);
                    append_runner_log(&mut runner_log_file, &msg).await;
                    let _ = tx.send(RunnerEvent::Error { message: msg, ts: Utc::now().timestamp_millis() });
                    return;
                }

                let stdout_path = cmd_dir.join("stdout.log");
                let stderr_path = cmd_dir.join("stderr.log");

                let stdout_file = match OpenOptions::new().create(true).write(true).truncate(true).open(&stdout_path).await {
                    Ok(f) => f,
                    Err(e) => {
                        let msg = format!("无法打开 stdout 日志: {}", e);
                        append_runner_log(&mut runner_log_file, &msg).await;
                        let _ = tx.send(RunnerEvent::Error { message: msg, ts: Utc::now().timestamp_millis() });
                        return;
                    }
                };
                let stderr_file = match OpenOptions::new().create(true).write(true).truncate(true).open(&stderr_path).await {
                    Ok(f) => f,
                    Err(e) => {
                        let msg = format!("无法打开 stderr 日志: {}", e);
                        append_runner_log(&mut runner_log_file, &msg).await;
                        let _ = tx.send(RunnerEvent::Error { message: msg, ts: Utc::now().timestamp_millis() });
                        return;
                    }
                };

                // 构造命令
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

                append_runner_log(&mut runner_log_file, &format!("Spawning command: {:?} {:?}", spec.program, spec.args)).await;

                // 启动进程
                let mut child = match cmd.spawn() {
                    Ok(c) => c,
                    Err(e) => {
                        let msg = format!("启动进程失败 [{}]: {}", cmd_id, e);
                        append_runner_log(&mut runner_log_file, &msg).await;
                        let _ = tx.send(RunnerEvent::Error {
                            message: msg.clone(),
                            ts: Utc::now().timestamp_millis(),
                        });
                        let _ = store.set_status(&task_id, 4, None, Some(-1), Some(msg), Some(Utc::now().timestamp_millis())).await;
                        return;
                    }
                };

                let stdout = child.stdout.take().expect("failed to capture stdout");
                let stderr = child.stderr.take().expect("failed to capture stderr");
                let mut stdout_reader = BufReader::new(stdout).lines();
                let mut stderr_reader = BufReader::new(stderr).lines();

                // Redirect logs
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
                                Some(_) => {
                                    info!("任务 {} 收到停止信号", task_id);
                                    append_runner_log(&mut runner_log_file, "Task stopped by user").await;
                                    let _ = child.kill().await;
                                    let _ = store.set_status(&task_id, 5, None, None, None, Some(Utc::now().timestamp_millis())).await; // 5 = STOPPED
                                    return;
                                }
                                None => {
                                    info!("任务 {} 控制句柄已释放，正在停止...", task_id);
                                    append_runner_log(&mut runner_log_file, "Task control handle dropped, stopping").await;
                                    let _ = child.kill().await;
                                    let _ = store.set_status(&task_id, 5, None, None, None, Some(Utc::now().timestamp_millis())).await;
                                    return;
                                }
                            }
                        }
                        status = child.wait() => {
                            match status {
                                Ok(s) => {
                                    append_runner_log(&mut runner_log_file, &format!("Command finished with status: {}", s)).await;
                                    if !s.success() {
                                        let code = s.code().unwrap_or(-1);
                                        let msg = format!("Command '{}' failed with exit code {}", cmd_id, code);
                                        append_runner_log(&mut runner_log_file, &msg).await;
                                        let _ = store.set_status(&task_id, 4, None, Some(code), Some(msg), Some(Utc::now().timestamp_millis())).await;
                                        let _ = tx.send(RunnerEvent::Exit { code, ts: Utc::now().timestamp_millis() });
                                        return;
                                    }
                                    break;
                                }
                                Err(e) => {
                                    append_runner_log(&mut runner_log_file, &format!("Wait failed: {}", e)).await;
                                    break;
                                }
                            }
                        }
                    }
                }
            }
        }

        // 所有命令执行完毕
        append_runner_log(&mut runner_log_file, "All commands finished successfully").await;
        let ts = Utc::now().timestamp_millis();
        let _ = store.set_status(&task_id, 3, Some(100), Some(0), None, Some(ts)).await; // 3 = DONE
        let _ = tx.send(RunnerEvent::Exit { code: 0, ts });
        
        // 发送最终快照
        if let Ok(Some(meta)) = store.get_task(&task_id).await {
            let _ = tx.send(RunnerEvent::Snapshot { meta, ts });
        }
    }
}

#[async_trait]
impl TaskManager for BackgroundTaskRunner {
    async fn start(&self, id: &str) -> Result<i64, AppError> {
        let (tx, _) = mpsc::channel(100);
        self.start_with_event_sink(id, tx).await
    }

    async fn start_with_event_sink(
        &self,
        id: &str,
        sink: mpsc::Sender<RunnerEvent>,
    ) -> Result<i64, AppError> {
        let mut tasks = self.running_tasks.write().await;
        if tasks.contains_key(id) {
            return Err(AppError::Task("任务已在运行中".to_string()));
        }

        let meta = self.store.get_task(id).await?.ok_or(AppError::Task("Task not found".to_string()))?;
        let task_dir = self.tasks_dir.join(id);

        let specs = if !meta.workflow.steps.is_empty() {
            let workflow = &meta.workflow;
            let mut specs = Vec::new();
            for step in &workflow.steps {
                let cmd_id = if step.tool == "builtin" {
                    match step.r#type {
                        1 => "builtin_port_scan",
                        2 => "httpx",
                        3 => "nuclei",
                        _ => "unknown",
                    }
                } else {
                    &step.tool
                };
                
                specs.push(CommandSpec {
                    id: cmd_id.to_string(),
                    program: PathBuf::from(cmd_id),
                    targets: meta.targets.clone(),
                    args: vec![],
                    env: None,
                    cwd: Some(task_dir.clone()),
                });
            }
            specs
        } else {
            self.parser.parse(&task_dir).await?
        };

        // 确保日志根目录存在
        let logs_root = task_dir.join("logs");
        tokio::fs::create_dir_all(&logs_root).await?;

        let (broadcaster, _) = broadcast::channel(100);
        let (stop_tx, stop_rx) = mpsc::channel(1);

        // 桥接 broadcast -> mpsc sink
        let mut rx = broadcaster.subscribe();
        let sink_clone = sink.clone();
        tokio::spawn(async move {
            while let Ok(event) = rx.recv().await {
                if sink_clone.send(event).await.is_err() {
                    break;
                }
            }
        });

        let store = self.store.clone();
        let task_id = id.to_string();
        let bc_clone = broadcaster.clone();
        let registry = self.registry.clone();
        
        let running_tasks_clone = self.running_tasks.clone();
        let task_id_cleanup = id.to_string();

        let join_handle = tokio::spawn(async move {
            Self::run_task_loop(task_id, specs, store, bc_clone, stop_rx, task_dir, registry).await;
            
            // Cleanup: remove from running_tasks when done
            let mut tasks = running_tasks_clone.write().await;
            if tasks.remove(&task_id_cleanup).is_some() {
                info!("Task {} removed from running_tasks map (finished naturally)", task_id_cleanup);
            }
        });

        tasks.insert(
            id.to_string(),
            RunnerHandle {
                broadcaster,
                join_handle,
                stop_tx,
            },
        );

        Ok(Utc::now().timestamp_millis())
    }

    async fn stop(&self, id: &str) -> Result<(), AppError> {
        let mut tasks = self.running_tasks.write().await;
        if let Some(handle) = tasks.remove(id) {
            let _ = handle.stop_tx.send(()).await;
            // 不等待 join，避免阻塞 gRPC 线程
        }
        Ok(())
    }

    async fn attach_event_sink(
        &self,
        id: &str,
        sink: mpsc::Sender<RunnerEvent>,
    ) -> Result<(), AppError> {
        let tasks = self.running_tasks.read().await;
        if let Some(handle) = tasks.get(id) {
            let mut rx = handle.broadcaster.subscribe();
            tokio::spawn(async move {
                while let Ok(event) = rx.recv().await {
                    if sink.send(event).await.is_err() {
                        break;
                    }
                }
            });
            Ok(())
        } else {
            Err(AppError::Task("任务未运行".to_string()))
        }
    }
}
