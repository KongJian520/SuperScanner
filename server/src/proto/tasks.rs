use crate::proto::tasks_proto::{
    tasks_server, CreateTaskRequest, DeleteTaskRequest, GetTaskRequest, ListTasksRequest,
    ListTasksResponse, StartTaskRequest, StopTaskRequest, Task as ProtoTask,
    StreamTaskEventsRequest, RestartTaskRequest, TaskEvent, LogChunk, Progress, Error as ProtoError,
};
use crate::proto::tasks_proto;
use crate::core::traits::{TaskManager, TaskStore};
use crate::core::runner::BackgroundTaskRunner;
use crate::core::types::{TaskMetadata, RunnerEvent};

use tonic::{Request, Response, Status};
use std::sync::Arc;
use std::path::PathBuf;
use prost_types::Timestamp;
use uuid::Uuid;
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;
use ipnetwork::IpNetwork;
use std::net::IpAddr;

pub struct TasksService {
    root: PathBuf,
    runner: Arc<dyn TaskManager>,
    store: Arc<dyn TaskStore>,
}

impl TasksService {
    pub fn new_with_store(root: PathBuf, store: Arc<dyn TaskStore>) -> Self {
        let runner = Arc::new(BackgroundTaskRunner::new(root.clone(), store.clone()));
        Self { root, runner, store }
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
        let task = self.store.get_task(&id).await.map_err(Status::from)?;
        match task {
            Some(t) => Ok(Response::new(Self::metadata_to_proto(t))),
            None => Err(Status::not_found("任务不存在")),
        }
    }

    async fn create_task(&self, request: Request<CreateTaskRequest>) -> Result<Response<ProtoTask>, Status> {
        let req = request.into_inner();
        
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

        let id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now().timestamp_millis();
        
        let meta = TaskMetadata {
            id: id.clone(),
            name: req.name,
            description: req.description,
            targets: req.targets,
            status: 1, // PENDING
            exit_code: 0,
            error_message: String::new(),
            created_at: now,
            updated_at: None,
            started_at: None,
            finished_at: None,
            log_path: String::new(),
        };

        self.store.create_task(&meta).await.map_err(Status::from)?;
        
        // 创建目录
        let task_dir = self.root.join(&id);
        tokio::fs::create_dir_all(&task_dir).await.map_err(|e| Status::internal(e.to_string()))?;

        Ok(Response::new(Self::metadata_to_proto(meta)))
    }

    async fn start_task(&self, request: Request<StartTaskRequest>) -> Result<Response<ProtoTask>, Status> {
        let id = request.into_inner().id;
        self.runner.start(&id).await.map_err(Status::from)?;
        
        let task = self.store.get_task(&id).await.map_err(Status::from)?
            .ok_or_else(|| Status::not_found("任务未找到"))?;
        
        // 停止任务（如果正在运行）
        let _ = self.runner.stop(&id).await;

        // 删除数据库记录
        self.store.delete_task(&id).await.map_err(Status::from)?;
        
        // 删除磁盘文件
        let task_dir = self.root.join(&id);
        if task_dir.exists() {
            tokio::fs::remove_dir_all(&task_dir).await.map_err(|e| {
                tracing::error!("删除任务目录失败 {}: {}", id, e);
                Status::internal("删除任务文件失败")
            })?;
        }

        Ok(Response::new(Self::metadata_to_proto(task)))
    }

    async fn stop_task(&self, request: Request<StopTaskRequest>) -> Result<Response<ProtoTask>, Status> {
        let id = request.into_inner().id;
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
             // 这里可能需要处理历史日志回放，但目前简化处理，直接返回结束
             // 实际生产中应读取日志文件并回放
        }

        tokio::spawn(async move {
            while let Some(event) = runner_rx.recv().await {
                let proto_event = match event {
                    RunnerEvent::Progress { percent, ts } => TaskEvent {
                        ev: Some(tasks_proto::task_event::Ev::Progress(Progress {
                            percent: percent as i32,
                            message: "".to_string(),
                            ts: TasksService::to_proto_ts(Some(ts)),
                        })),
                    },
                    RunnerEvent::Log { subtask, data, is_stderr, offset, ts } => TaskEvent {
                        ev: Some(tasks_proto::task_event::Ev::Log(LogChunk {
                            subtask,
                            text: String::from_utf8_lossy(&data).to_string(),
                            is_stderr,
                            offset,
                            ts: TasksService::to_proto_ts(Some(ts)),
                        })),
                    },
                    RunnerEvent::Exit { .. } => continue, // Exit event handled via snapshot or status update usually
                    RunnerEvent::Snapshot { meta, .. } => TaskEvent {
                        ev: Some(tasks_proto::task_event::Ev::TaskSnapshot(TasksService::metadata_to_proto(meta))),
                    },
                    RunnerEvent::Error { message, .. } => TaskEvent {
                        ev: Some(tasks_proto::task_event::Ev::Error(ProtoError { message })),
                    },
                };
                
                if tx.send(Ok(proto_event)).await.is_err() {
                    break;
                }
            }
        });

        Ok(Response::new(ReceiverStream::new(rx)))
    }

    async fn restart_task(&self, request: Request<RestartTaskRequest>) -> Result<Response<ProtoTask>, Status> {
        let req = request.into_inner();
        let now = chrono::Utc::now().timestamp_millis();
        
        let task = self.store.reset_task_for_restart(&req.id, now).await.map_err(Status::from)?;
        
        if req.start_now {
            self.runner.start(&req.id).await.map_err(Status::from)?;
        }

        Ok(Response::new(Self::metadata_to_proto(task)))
    }
}
