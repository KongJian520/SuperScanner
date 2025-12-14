use crate::core::traits::{CommandParser, TaskManager, TaskStore};
use crate::core::types::{CommandSpec, RunnerEvent};
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
use tokio::sync::{RwLock, broadcast, mpsc};
use tracing::{error, info};

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

async fn append_runner_log(file: &mut Option<tokio::fs::File>, msg: &str) {
    if let Some(f) = file {
        let ts = chrono::Utc::now().to_rfc3339();
        let line = format!("[{}] {}\n", ts, msg);
        let _ = f.write_all(line.as_bytes()).await;
        let _ = f.flush().await;
    }
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
        let log_path = task_dir.join("runner.log");
        let mut runner_log_file = match OpenOptions::new().create(true).write(true).truncate(true).open(&log_path).await {
            Ok(f) => Some(f),
            Err(e) => {
                error!("Failed to create runner log: {}", e);
                None
            }
        };

        append_runner_log(&mut runner_log_file, "Task runner started").await;

        // 更新数据库状态为 RUNNING
        if let Err(e) = store.set_status(&task_id, 2, None, None, None).await {
            let msg = format!("无法更新任务状态: {}", e);
            error!("{}", msg);
            append_runner_log(&mut runner_log_file, &msg).await;
            return;
        }

        append_runner_log(&mut runner_log_file, &format!("Found {} commands to execute", specs.len())).await;

        for mut spec in specs {
            let cmd_id = spec.id.clone();
            append_runner_log(&mut runner_log_file, &format!("Preparing command: {}", cmd_id)).await;

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

            let mut stdout_writer = tokio::io::BufWriter::new(stdout_file);
            let mut stderr_writer = tokio::io::BufWriter::new(stderr_file);

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
                    let _ = store.set_status(&task_id, 4, Some(-1), Some(msg), Some(Utc::now().timestamp_millis())).await;
                    return;
                }
            };

            let stdout = child.stdout.take().expect("failed to capture stdout");
            let stderr = child.stderr.take().expect("failed to capture stderr");
            let mut stdout_reader = BufReader::new(stdout).lines();
            let mut stderr_reader = BufReader::new(stderr).lines();

            loop {
                tokio::select! {
                    val = stop_rx.recv() => {
                        match val {
                            Some(_) => {
                                info!("任务 {} 收到停止信号", task_id);
                                append_runner_log(&mut runner_log_file, "Task stopped by user").await;
                                let _ = child.kill().await;
                                let _ = store.set_status(&task_id, 5, None, None, Some(Utc::now().timestamp_millis())).await; // 5 = STOPPED
                                return; // 停止整个任务链
                            }
                            None => {
                                info!("任务 {} 控制句柄已释放，正在停止...", task_id);
                                append_runner_log(&mut runner_log_file, "Task control handle dropped, stopping").await;
                                let _ = child.kill().await;
                                let _ = store.set_status(&task_id, 5, None, None, Some(Utc::now().timestamp_millis())).await;
                                return;
                            }
                        }
                    }
                    Ok(Some(line)) = stdout_reader.next_line() => {
                        let ts = Utc::now().timestamp_millis();
                        let bytes = line.as_bytes();
                        let _ = stdout_writer.write_all(bytes).await;
                        let _ = stdout_writer.write_all(b"\n").await;
                        let _ = tx.send(RunnerEvent::Log { subtask: cmd_id.clone(), data: bytes.to_vec(), is_stderr: false, offset: 0, ts });
                    }
                    Ok(Some(line)) = stderr_reader.next_line() => {
                        let ts = Utc::now().timestamp_millis();
                        let bytes = line.as_bytes();
                        let _ = stderr_writer.write_all(bytes).await;
                        let _ = stderr_writer.write_all(b"\n").await;
                        let _ = tx.send(RunnerEvent::Log { subtask: cmd_id.clone(), data: bytes.to_vec(), is_stderr: true, offset: 0, ts });
                    }
                    status = child.wait() => {
                        let ts = Utc::now().timestamp_millis();
                        let _ = stdout_writer.flush().await;
                        let _ = stderr_writer.flush().await;
                        
                        match status {
                            Ok(s) => {
                                let code = s.code().unwrap_or(-1);
                                if !s.success() {
                                    // [修改] 构造详细错误信息
                                    let msg = format!("Command '{}' failed with exit code {}", cmd_id, code);
                                    append_runner_log(&mut runner_log_file, &msg).await;
                                    
                                    // [修改] 将错误信息 msg 传入 set_status，而不是 None
                                    let _ = store.set_status(&task_id, 4, Some(code), Some(msg), Some(ts)).await;
                                    let _ = tx.send(RunnerEvent::Exit { code, ts });
                                    return;
                                }
                                append_runner_log(&mut runner_log_file, &format!("Command '{}' finished successfully", cmd_id)).await;
                                
                                // 命令成功，处理结果
                                if let Some(cmd) = registry.get(&cmd_id) {
                                    if let Err(e) = cmd.process_result(&task_dir).await {
                                        let msg = format!("Result processing failed: {}", e);
                                        error!("{}", msg);
                                        append_runner_log(&mut runner_log_file, &msg).await;
                                    }
                                }
                            }
                            Err(e) => {
                                let msg = format!("进程异常退出: {}", e);
                                append_runner_log(&mut runner_log_file, &msg).await;
                                let _ = store.set_status(&task_id, 4, Some(-1), Some(msg.clone()), Some(ts)).await;
                                let _ = tx.send(RunnerEvent::Error { message: msg, ts });
                                return;
                            }
                        }
                        break; // 跳出 select loop，继续下一个命令
                    }
                }
            }
        }

        // 所有命令执行完毕
        append_runner_log(&mut runner_log_file, "All commands finished successfully").await;
        let ts = Utc::now().timestamp_millis();
        let _ = store.set_status(&task_id, 3, Some(0), None, Some(ts)).await; // 3 = DONE
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

        let task_dir = self.tasks_dir.join(id);
        let specs = self.parser.parse(&task_dir).await?;

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

        let join_handle = tokio::spawn(async move {
            Self::run_task_loop(task_id, specs, store, bc_clone, stop_rx, task_dir, registry).await;
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
