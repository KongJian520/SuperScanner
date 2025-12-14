use crate::core::traits::{CommandParser, TaskManager, TaskStore};
use crate::core::types::{CommandSpec, RunnerEvent};
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
use tokio::sync::{broadcast, mpsc, Mutex};
use tracing::{error, info};

#[cfg(test)]
#[path = "parser_tests.rs"]
mod parser_tests;

/// 简单的命令解析器：支持 metadata.toml 中的 command_spec 或回退到 targets[0]
pub struct SimpleCommandParser {}

#[async_trait]
impl CommandParser for SimpleCommandParser {
    async fn parse(&self, task_dir: &PathBuf) -> Result<CommandSpec, AppError> {
        let meta_path = task_dir.join("metadata.toml");
        let content = tokio::fs::read_to_string(&meta_path).await
            .map_err(|e| AppError::Config(format!("无法读取 metadata.toml: {}", e)))?;
        
        let meta = content.parse::<toml::Value>()
            .map_err(|e| AppError::Config(format!("metadata.toml 格式错误: {}", e)))?;

        // 尝试新的结构化形式
        if let Some(spec_tbl) = meta.get("command_spec").and_then(|v| v.as_table()) {
            let program = spec_tbl.get("program")
                .and_then(|v| v.as_str())
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from("echo"));
            let args = spec_tbl.get("args")
                .and_then(|v| v.as_array())
                .map(|arr| arr.iter().filter_map(|it| it.as_str().map(|s| s.to_string())).collect())
                .unwrap_or_default();
            let targets = spec_tbl.get("targets")
                .and_then(|v| v.as_array())
                .map(|arr| arr.iter().filter_map(|it| it.as_str().map(|s| s.to_string())).collect())
                .unwrap_or_default();
            
            return Ok(CommandSpec { program, args, targets, env: None, cwd: None });
        }

        // 回退模式
        if let Some(first) = meta.get("targets").and_then(|t| t.as_array()).and_then(|arr| arr.get(0)).and_then(|v| v.as_str()) {
            let mut parts = first.split_whitespace();
            let program = parts.next().map(PathBuf::from).unwrap_or_else(|| PathBuf::from("echo"));
            let args: Vec<String> = parts.map(|p| p.to_string()).collect();
            return Ok(CommandSpec { program, args, targets: Vec::new(), env: None, cwd: None });
        }

        Err(AppError::Config("metadata.toml 中未找到有效的命令定义".to_string()))
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
    running_tasks: Arc<Mutex<HashMap<String, RunnerHandle>>>,
    parser: Box<dyn CommandParser>,
}

impl BackgroundTaskRunner {
    pub fn new(tasks_dir: PathBuf, store: Arc<dyn TaskStore>) -> Self {
        Self {
            tasks_dir,
            store,
            running_tasks: Arc::new(Mutex::new(HashMap::new())),
            parser: Box::new(SimpleCommandParser {}),
        }
    }

    async fn run_task_loop(
        task_id: String,
        mut spec: CommandSpec,
        store: Arc<dyn TaskStore>,
        tx: broadcast::Sender<RunnerEvent>,
        mut stop_rx: mpsc::Receiver<()>,
        log_path: PathBuf,
    ) {
        let start_ts = Utc::now().timestamp_millis();
        
        // 更新数据库状态为 RUNNING
        if let Err(e) = store.set_status(&task_id, 2, None, None, None).await { // 2 = RUNNING
            error!("无法更新任务状态: {}", e);
            return;
        }

        // 准备日志文件
        let log_file = match OpenOptions::new().create(true).append(true).open(&log_path).await {
            Ok(f) => f,
            Err(e) => {
                let _ = tx.send(RunnerEvent::Error { message: format!("无法打开日志文件: {}", e), ts: start_ts });
                return;
            }
        };
        let mut log_writer = tokio::io::BufWriter::new(log_file);

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

        // 启动进程
        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                let msg = format!("启动进程失败: {}", e);
                let _ = tx.send(RunnerEvent::Error { message: msg.clone(), ts: start_ts });
                let _ = store.set_status(&task_id, 4, Some(-1), Some(msg), Some(Utc::now().timestamp_millis())).await; // 4 = FAILED
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
                            let _ = child.kill().await;
                            let _ = store.set_status(&task_id, 5, None, None, Some(Utc::now().timestamp_millis())).await; // 5 = STOPPED
                            break;
                        }
                        None => {
                            info!("任务 {} 控制句柄已释放，正在停止...", task_id);
                            let _ = child.kill().await;
                            let _ = store.set_status(&task_id, 5, None, None, Some(Utc::now().timestamp_millis())).await;
                            break;
                        }
                    }
                }
                Ok(Some(line)) = stdout_reader.next_line() => {
                    let ts = Utc::now().timestamp_millis();
                    let bytes = line.as_bytes();
                    let _ = log_writer.write_all(bytes).await;
                    let _ = log_writer.write_all(b"\n").await;
                    let _ = tx.send(RunnerEvent::Log { subtask: "main".into(), data: bytes.to_vec(), is_stderr: false, offset: 0, ts });
                }
                Ok(Some(line)) = stderr_reader.next_line() => {
                    let ts = Utc::now().timestamp_millis();
                    let bytes = line.as_bytes();
                    let _ = log_writer.write_all(bytes).await;
                    let _ = log_writer.write_all(b"\n").await;
                    let _ = tx.send(RunnerEvent::Log { subtask: "main".into(), data: bytes.to_vec(), is_stderr: true, offset: 0, ts });
                }
                status = child.wait() => {
                    let ts = Utc::now().timestamp_millis();
                    let _ = log_writer.flush().await;
                    match status {
                        Ok(s) => {
                            let code = s.code().unwrap_or(-1);
                            let task_status = if s.success() { 3 } else { 4 }; // 3 = DONE, 4 = FAILED
                            let _ = store.set_status(&task_id, task_status, Some(code), None, Some(ts)).await;
                            let _ = tx.send(RunnerEvent::Exit { code, ts });
                        }
                        Err(e) => {
                            let msg = format!("进程异常退出: {}", e);
                            let _ = store.set_status(&task_id, 4, Some(-1), Some(msg.clone()), Some(ts)).await;
                            let _ = tx.send(RunnerEvent::Error { message: msg, ts });
                        }
                    }
                    // 发送最终快照
                    if let Ok(Some(meta)) = store.get_task(&task_id).await {
                        let _ = tx.send(RunnerEvent::Snapshot { meta, ts });
                    }
                    break;
                }
            }
        }
    }
}

#[async_trait]
impl TaskManager for BackgroundTaskRunner {
    async fn start(&self, id: &str) -> Result<i64, AppError> {
        let (tx, _) = mpsc::channel(100);
        self.start_with_event_sink(id, tx).await
    }

    async fn start_with_event_sink(&self, id: &str, sink: mpsc::Sender<RunnerEvent>) -> Result<i64, AppError> {
        let mut tasks = self.running_tasks.lock().await;
        if tasks.contains_key(id) {
            return Err(AppError::Task("任务已在运行中".to_string()));
        }

        let task_dir = self.tasks_dir.join(id);
        let spec = self.parser.parse(&task_dir).await?;
        
        // 确保日志目录存在
        let log_dir = task_dir.join("logs");
        tokio::fs::create_dir_all(&log_dir).await?;
        let log_path = log_dir.join("run.log");

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
        
        let join_handle = tokio::spawn(async move {
            Self::run_task_loop(task_id, spec, store, bc_clone, stop_rx, log_path).await;
        });

        tasks.insert(id.to_string(), RunnerHandle {
            broadcaster,
            join_handle,
            stop_tx,
        });

        Ok(Utc::now().timestamp_millis())
    }

    async fn stop(&self, id: &str) -> Result<(), AppError> {
        let mut tasks = self.running_tasks.lock().await;
        if let Some(handle) = tasks.remove(id) {
            let _ = handle.stop_tx.send(()).await;
            // 不等待 join，避免阻塞 gRPC 线程
        }
        Ok(())
    }

    async fn attach_event_sink(&self, id: &str, sink: mpsc::Sender<RunnerEvent>) -> Result<(), AppError> {
        let tasks = self.running_tasks.lock().await;
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
