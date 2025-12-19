use crate::proto::tasks_proto::{
    tasks_server, CreateTaskRequest, DeleteTaskRequest, GetTaskRequest, ListTasksRequest,
    ListTasksResponse, StartTaskRequest, StopTaskRequest, Task as ProtoTask,
    StreamTaskEventsRequest, RestartTaskRequest, TaskEvent, LogChunk, Progress, Error as ProtoError,
    ScanResult,
};
use crate::proto::tasks_proto;
use crate::core::traits::{TaskManager, TaskStore};
use crate::core::runner::BackgroundTaskRunner;
use crate::core::types::{TaskMetadata, RunnerEvent};
use crate::core::command::CommandRegistry;

use tonic::{Request, Response, Status};
use std::sync::Arc;
use std::path::PathBuf;
use prost_types::Timestamp;
use uuid::Uuid;
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;
use ipnetwork::IpNetwork;
use std::net::IpAddr;
use tracing::{info, error};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePool};
use std::str::FromStr;

pub struct TasksService {
    root: PathBuf,
    runner: Arc<dyn TaskManager>,
    store: Arc<dyn TaskStore>,
    registry: CommandRegistry,
}

impl TasksService {
    pub fn new_with_store(root: PathBuf, store: Arc<dyn TaskStore>, registry: CommandRegistry) -> Self {
        let runner = Arc::new(BackgroundTaskRunner::new(root.clone(), store.clone(), registry.clone()));
        Self { root, runner, store, registry }
    }

    fn to_proto_ts(ms: Option<i64>) -> Option<Timestamp> {
        ms.map(|m| Timestamp {
            seconds: m / 1000,
            nanos: ((m % 1000) * 1_000_000) as i32,
        })
    }

    fn metadata_to_proto(meta: TaskMetadata) -> ProtoTask {
        ProtoTask {
            id: meta.id,
            name: meta.name,
            description: meta.description,
            targets: meta.targets,
            status: meta.status,
            exit_code: meta.exit_code,
            error_message: meta.error_message,
            created_at: Self::to_proto_ts(Some(meta.created_at)),
            updated_at: Self::to_proto_ts(meta.updated_at),
            started_at: Self::to_proto_ts(meta.started_at),
            finished_at: Self::to_proto_ts(meta.finished_at),
            progress: meta.progress as i32,
            workflow: Some(meta.workflow.into()),
            results: vec![],
        }
    }
}

impl From<crate::core::types::Workflow> for crate::proto::tasks_proto::Workflow {
    fn from(wf: crate::core::types::Workflow) -> Self {
        Self {
            steps: wf.steps.into_iter().map(|s| s.into()).collect(),
        }
    }
}

impl From<crate::core::types::WorkflowStep> for crate::proto::tasks_proto::WorkflowStep {
    fn from(step: crate::core::types::WorkflowStep) -> Self {
        Self {
            r#type: step.r#type,
            tool: step.tool,
        }
    }
}

impl From<crate::proto::tasks_proto::Workflow> for crate::core::types::Workflow {
    fn from(wf: crate::proto::tasks_proto::Workflow) -> Self {
        Self {
            steps: wf.steps.into_iter().map(|s| s.into()).collect(),
        }
    }
}

impl From<crate::proto::tasks_proto::WorkflowStep> for crate::core::types::WorkflowStep {
    fn from(step: crate::proto::tasks_proto::WorkflowStep) -> Self {
        Self {
            r#type: step.r#type,
            tool: step.tool,
        }
    }
}

#[tonic::async_trait]
impl tasks_server::Tasks for TasksService {
    type StreamTaskEventsStream = ReceiverStream<Result<TaskEvent, Status>>;

    async fn list_tasks(&self, _request: Request<ListTasksRequest>) -> Result<Response<ListTasksResponse>, Status> {
        let tasks = self.store.list_tasks().await.map_err(Status::from)?;
        let proto_tasks = tasks.into_iter().map(Self::metadata_to_proto).collect();
        Ok(Response::new(ListTasksResponse { tasks: proto_tasks }))
    }

    async fn get_task(&self, request: Request<GetTaskRequest>) -> Result<Response<ProtoTask>, Status> {
        let id = request.into_inner().id;
        let task = self.store.get_task(&id).await.map_err(Status::from)?
            .ok_or_else(|| Status::not_found("任务不存在"))?;
        
        let mut proto_task = Self::metadata_to_proto(task);

        // Fetch results from targets.db
        let db_path = self.root.join(&id).join("targets.db");
        if db_path.exists() {
             let db_url = format!("sqlite://{}", db_path.to_string_lossy());
             if let Ok(pool) = SqlitePool::connect(&db_url).await {
                 // Use CAST(updated_at AS TEXT) to ensure we get a string, avoiding type mapping issues
                 if let Ok(rows) = sqlx::query("SELECT ip, port, protocol, state, service, tool, CAST(updated_at AS TEXT) as updated_at FROM port_results")
                    .fetch_all(&pool).await 
                 {
                     let mut results = Vec::new();
                     for row in rows {
                         use sqlx::Row;
                         // Safely handle port as i64 (SQLite INTEGER) and cast to i32
                         let port: i64 = row.try_get("port").unwrap_or(0);
                         
                         results.push(ScanResult {
                             ip: row.try_get("ip").unwrap_or_default(),
                             port: port as i32,
                             protocol: row.try_get("protocol").unwrap_or_default(),
                             state: row.try_get("state").unwrap_or_default(),
                             service: row.try_get("service").unwrap_or_default(),
                             tool: row.try_get("tool").unwrap_or_default(),
                             timestamp: row.try_get("updated_at").unwrap_or_default(),
                         });
                     }
                     proto_task.results = results;
                 }
                 let _ = pool.close().await;
             }
        }

        Ok(Response::new(proto_task))
    }

    async fn create_task(&self, request: Request<CreateTaskRequest>) -> Result<Response<ProtoTask>, Status> {
        let mut req = request.into_inner();
        info!("Received create task request: {:?}", req);
        
        // Deduplicate targets
        req.targets.sort();
        req.targets.dedup();

        // 验证输入
        if req.name.trim().is_empty() {
            return Err(Status::invalid_argument("任务名称不能为空"));
        }
        if req.targets.is_empty() {
            return Err(Status::invalid_argument("扫描目标不能为空"));
        }
        for target in &req.targets {
            let valid_ip = target.parse::<IpAddr>().is_ok();
            let valid_cidr = target.parse::<IpNetwork>().is_ok();
            if !valid_ip && !valid_cidr {
                return Err(Status::invalid_argument(format!("无效的目标地址: {}", target)));
            }
        }

        if req.workflow.is_none() {
            return Err(Status::invalid_argument("Workflow is required"));
        }

        let id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now().timestamp_millis();
        
        let meta = TaskMetadata {
            id: id.clone(),
            name: req.name,
            description: req.description,
            targets: req.targets.clone(),
            status: 1, // PENDING
            exit_code: 0,
            error_message: String::new(),
            created_at: now,
            updated_at: None,
            started_at: None,
            finished_at: None,
            log_path: String::new(),
            progress: 0,
            workflow: req.workflow.map(|w| w.into()).unwrap_or_default(),
        };

        self.store.create_task(&meta).await.map_err(Status::from)?;
        info!("Task record created in DB: {}", id);
        
        // Wrap file system operations
        let fs_result = async {
            // 创建目录
            let task_dir = self.root.join(&id);
            tokio::fs::create_dir_all(&task_dir).await?;

            // 1. 展开 IP 并初始化 SQLite
            let mut expanded_targets = Vec::new();
            for target in &req.targets {
                if let Ok(net) = target.parse::<IpNetwork>() {
                    for ip in net.iter() {
                        expanded_targets.push(ip.to_string());
                    }
                } else {
                    expanded_targets.push(target.clone());
                }
            }

            let db_path = task_dir.join("targets.db");
            let db_url = format!("sqlite://{}", db_path.to_string_lossy());
            
            let opts = SqliteConnectOptions::from_str(&db_url).map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?
                .create_if_missing(true);
            let pool = SqlitePool::connect_with(opts).await.map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;

            sqlx::query("CREATE TABLE IF NOT EXISTS targets (ip TEXT PRIMARY KEY, status TEXT DEFAULT 'pending', updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)")
                .execute(&pool).await.map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;

            let mut tx = pool.begin().await.map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
            for ip in expanded_targets {
                sqlx::query("INSERT OR IGNORE INTO targets (ip) VALUES (?)")
                    .bind(ip)
                    .execute(&mut *tx).await.map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
            }
            tx.commit().await.map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
            pool.close().await;

            // 2. 创建命令目录和配置
            // 定义工作流：先 Ping 后 Curl
            let workflow = vec!["ping"];
            let commands_dir = task_dir.join("commands");
            tokio::fs::create_dir_all(&commands_dir).await?;

            for cmd_id in &workflow {
                let cmd_dir = commands_dir.join(cmd_id);
                tokio::fs::create_dir_all(&cmd_dir).await?;
                
                if let Some(cmd) = self.registry.get(cmd_id) {
                    // 构建 Spec 并保存
                    let spec = cmd.build_spec(&req.targets, &[]);
                    let toml_content = toml::to_string_pretty(&spec).map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
                    tokio::fs::write(cmd_dir.join("spec.toml"), toml_content).await?;
                }
            }

            // 保存工作流定义
            let workflow_content = serde_json::to_string_pretty(&workflow).map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
            tokio::fs::write(task_dir.join("workflow.json"), workflow_content).await?;

            Ok::<(), std::io::Error>(())
        }.await;

        if let Err(e) = fs_result {
            error!("Failed to setup task files: {}", e);
            self.store.delete_task(&id).await.map_err(Status::from)?;
            return Err(Status::internal(format!("Failed to setup task: {}", e)));
        }

        info!("Task created successfully: {}", id);
        Ok(Response::new(Self::metadata_to_proto(meta)))
    }

    async fn start_task(&self, request: Request<StartTaskRequest>) -> Result<Response<ProtoTask>, Status> {
        let id = request.into_inner().id;
        
        let task = self.store.get_task(&id).await.map_err(Status::from)?
            .ok_or_else(|| Status::not_found("任务未找到"))?;

        // 限制：如果任务已完成或正在运行，不允许重复启动（除非显式重启）
        // 2=RUNNING, 3=DONE
        if task.status == 2 {
            return Err(Status::failed_precondition("任务正在运行中"));
        }
        if task.status == 3 {
            return Err(Status::failed_precondition("任务已完成，请使用重启功能"));
        }

        info!("Starting task: {}", id);
        self.runner.start(&id).await.map_err(Status::from)?;
        
        let task = self.store.get_task(&id).await.map_err(Status::from)?
            .ok_or_else(|| Status::not_found("任务未找到"))?;
        
        Ok(Response::new(Self::metadata_to_proto(task)))
    }

    async fn stop_task(&self, request: Request<StopTaskRequest>) -> Result<Response<ProtoTask>, Status> {
        let id = request.into_inner().id;
        info!("Stopping task: {}", id);
        self.runner.stop(&id).await.map_err(Status::from)?;
        
        let task = self.store.get_task(&id).await.map_err(Status::from)?
            .ok_or_else(|| Status::not_found("任务未找到"))?;
            
        Ok(Response::new(Self::metadata_to_proto(task)))
    }

    async fn delete_task(&self, request: Request<DeleteTaskRequest>) -> Result<Response<()>, Status> {
        let id = request.into_inner().id;
        self.store.delete_task(&id).await.map_err(Status::from)?;
        Ok(Response::new(()))
    }

    async fn stream_task_events(&self, request: Request<StreamTaskEventsRequest>) -> Result<Response<Self::StreamTaskEventsStream>, Status> {
        let req = request.into_inner();
        let id = req.id;

        let (tx, rx) = mpsc::channel(100);
        let (runner_tx, mut runner_rx) = mpsc::channel(100);

        // 如果请求启动且未运行，则启动
        if req.start_if_not_running {
            // 尝试启动，忽略"已在运行"错误
            let _ = self.runner.start_with_event_sink(&id, runner_tx.clone()).await;
        }

        // 尝试附加到现有任务
        if let Err(_) = self.runner.attach_event_sink(&id, runner_tx).await {
            // 如果任务未运行且我们没有启动它（或者启动失败但不是因为已运行），
            // 我们仍然会尝试从日志文件回放历史日志并 tail
        }

        tokio::spawn(async move {
            // 将来自 runner 的实时事件转发给客户端
            while let Some(event) = runner_rx.recv().await {
                let proto_event = match event {
                    RunnerEvent::Progress { percent, ts } => TaskEvent {
                        ev: Some(tasks_proto::task_event::Ev::Progress(Progress {
                            percent: percent as i32,
                            message: "".to_string(),
                            ts: TasksService::to_proto_ts(Some(ts)),
                        })),
                    },
                    RunnerEvent::Log { .. } => continue, // 忽略日志事件
                    RunnerEvent::Exit { .. } => continue, // Exit 事件由 snapshot 或状态更新处理
                    RunnerEvent::Snapshot { meta, .. } => TaskEvent {
                        ev: Some(tasks_proto::task_event::Ev::TaskSnapshot(TasksService::metadata_to_proto(meta))),
                    },
                    RunnerEvent::Error { message, .. } => TaskEvent {
                        ev: Some(tasks_proto::task_event::Ev::Error(ProtoError { message })),
                    },
                };

                if tx.send(Ok(proto_event)).await.is_err() {
                    return; // 客户端已断开
                }
            }
        });
        

        Ok(Response::new(ReceiverStream::new(rx)))
    }

    async fn restart_task(&self, request: Request<RestartTaskRequest>) -> Result<Response<ProtoTask>, Status> {
        let req = request.into_inner();
        let id = req.id;
        
        // 1. 检查任务是否正在运行
        if let Ok(Some(current_task)) = self.store.get_task(&id).await {
            // 2 = RUNNING
            if current_task.status == 2 {
                return Err(Status::failed_precondition("任务正在运行中，请先停止任务后再重启"));
            }
        } else {
            return Err(Status::not_found("任务不存在"));
        }

        let now = chrono::Utc::now().timestamp_millis();
        
        // 2. 重置元数据
        let task = self.store.reset_task_for_restart(&id, now).await.map_err(Status::from)?;
        
        // 3. 重置 targets.db 中的目标状态
        let task_dir = self.root.join(&id);
        let db_path = task_dir.join("targets.db");
        if db_path.exists() {
            let db_url = format!("sqlite://{}", db_path.to_string_lossy());
            match SqlitePool::connect(&db_url).await {
                Ok(pool) => {
                    if let Err(e) = sqlx::query("UPDATE targets SET status = 'pending'")
                        .execute(&pool).await 
                    {
                        error!("Failed to reset targets.db for task {}: {}", id, e);
                        // 这里可以选择是否报错返回，或者仅记录日志继续
                    }
                    pool.close().await;
                },
                Err(e) => {
                    error!("Failed to connect to targets.db for task {}: {}", id, e);
                }
            }
        }

        if req.start_now {
            self.runner.start(&id).await.map_err(Status::from)?;
        }

        Ok(Response::new(Self::metadata_to_proto(task)))
    }
}
