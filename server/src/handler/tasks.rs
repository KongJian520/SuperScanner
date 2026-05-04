use crate::commands::CommandRegistry;
use crate::domain::traits::{TaskManager, TaskStore};
use crate::domain::types::{RunnerEvent, TaskMetadata};
use crate::engine::BackgroundTaskRunner;
use crate::engine::scheduler::SqliteScheduler;
use crate::handler::tasks_proto;
use crate::handler::tasks_proto::{
    CreateTaskRequest, DeleteTaskRequest, Error as ProtoError, Finding as ProtoFinding,
    GetTaskRequest, ListTasksRequest, ListTasksResponse, Progress, RestartTaskRequest, ScanResult,
    StartTaskRequest, StopTaskRequest, StreamTaskEventsRequest, Task as ProtoTask, TaskEvent,
    tasks_server,
};
use crate::storage::task_db;
use super_scanner_shared::models::TaskStatus;

use ipnetwork::IpNetwork;
use prost_types::Timestamp;
use std::net::IpAddr;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;
use tonic::{Request, Response, Status};
use tracing::{error, info};
use uuid::Uuid;

pub struct TasksService {
    root: PathBuf,
    runner: Arc<dyn TaskManager>,
    store: Arc<dyn TaskStore>,
    registry: CommandRegistry,
}

impl TasksService {
    pub fn new_with_store(
        root: PathBuf,
        store: Arc<dyn TaskStore>,
        registry: CommandRegistry,
    ) -> Self {
        // SqliteScheduler 在 main 中创建后传入；这里创建一个临时 NoopScheduler 用于接口兼容
        // 实际生产中由 main.rs 传入 Arc<dyn Scheduler>
        let scheduler = Arc::new(crate::engine::scheduler::NoopScheduler);
        let runner = Arc::new(BackgroundTaskRunner::new(
            root.clone(),
            store.clone(),
            registry.clone(),
            scheduler,
        ));
        Self {
            root,
            runner,
            store,
            registry,
        }
    }

    pub fn new_with_scheduler(
        root: PathBuf,
        store: Arc<dyn TaskStore>,
        registry: CommandRegistry,
        scheduler: Arc<SqliteScheduler>,
    ) -> Self {
        let runner = Arc::new(BackgroundTaskRunner::new(
            root.clone(),
            store.clone(),
            registry.clone(),
            scheduler,
        ));
        Self {
            root,
            runner,
            store,
            registry,
        }
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
            findings: vec![],
        }
    }

    fn map_step_to_command_id(step_type: i32, tool: &str) -> Option<String> {
        if tool == "builtin" {
            let mapped = match step_type {
                1 => "builtin_port_scan",
                2 => "httpx",
                3 => "nuclei",
                4 => "fscan",
                _ => return None,
            };
            return Some(mapped.to_string());
        }
        Some(tool.to_string())
    }
}

impl From<crate::domain::types::Workflow> for crate::handler::tasks_proto::Workflow {
    fn from(wf: crate::domain::types::Workflow) -> Self {
        Self {
            steps: wf.steps.into_iter().map(|s| s.into()).collect(),
        }
    }
}

impl From<crate::domain::types::WorkflowStep> for crate::handler::tasks_proto::WorkflowStep {
    fn from(step: crate::domain::types::WorkflowStep) -> Self {
        Self {
            r#type: step.r#type,
            tool: step.tool,
        }
    }
}

impl From<crate::handler::tasks_proto::Workflow> for crate::domain::types::Workflow {
    fn from(wf: crate::handler::tasks_proto::Workflow) -> Self {
        Self {
            steps: wf.steps.into_iter().map(|s| s.into()).collect(),
        }
    }
}

impl From<crate::handler::tasks_proto::WorkflowStep> for crate::domain::types::WorkflowStep {
    fn from(step: crate::handler::tasks_proto::WorkflowStep) -> Self {
        Self {
            r#type: step.r#type,
            tool: step.tool,
        }
    }
}

#[tonic::async_trait]
impl tasks_server::Tasks for TasksService {
    type StreamTaskEventsStream = ReceiverStream<Result<TaskEvent, Status>>;

    async fn list_tasks(
        &self,
        _request: Request<ListTasksRequest>,
    ) -> Result<Response<ListTasksResponse>, Status> {
        let tasks = self.store.list_tasks().await.map_err(Status::from)?;
        let proto_tasks = tasks.into_iter().map(Self::metadata_to_proto).collect();
        Ok(Response::new(ListTasksResponse { tasks: proto_tasks }))
    }

    async fn get_task(
        &self,
        request: Request<GetTaskRequest>,
    ) -> Result<Response<ProtoTask>, Status> {
        let id = request.into_inner().id;
        let task = self
            .store
            .get_task(&id)
            .await
            .map_err(Status::from)?
            .ok_or_else(|| Status::not_found("任务不存在"))?;

        let mut proto_task = Self::metadata_to_proto(task);

        let task_dir = self.root.join(&id);
        if let Ok(pool) = task_db::open_targets_db(&task_dir).await {
            if let Ok(rows) = task_db::query_port_results(&pool).await {
                proto_task.results = rows
                    .into_iter()
                    .map(|r| ScanResult {
                        ip: r.ip,
                        port: r.port as i32,
                        protocol: r.protocol,
                        state: r.state,
                        service: r.service,
                        tool: r.tool,
                        timestamp: r.timestamp,
                    })
                    .collect();
            }
            if let Ok(rows) = task_db::query_findings(&pool).await {
                proto_task.findings = rows
                    .into_iter()
                    .map(|f| ProtoFinding {
                        id: f.id,
                        dedupe_key: f.dedupe_key,
                        finding_type: f.finding_type,
                        severity: f.severity,
                        title: f.title,
                        detail: f.detail,
                        ip: f.ip,
                        port: f.port as i32,
                        protocol: f.protocol,
                        source_tool: f.source_tool,
                        source_command: f.source_command,
                        metadata_json: f.metadata_json,
                        occurrences: f.occurrences,
                        first_seen_at: f.first_seen_at,
                        last_seen_at: f.last_seen_at,
                        updated_at: f.updated_at,
                    })
                    .collect();
            }
            let _ = pool.close().await;
        }

        Ok(Response::new(proto_task))
    }

    async fn create_task(
        &self,
        request: Request<CreateTaskRequest>,
    ) -> Result<Response<ProtoTask>, Status> {
        let mut req = request.into_inner();
        info!("Received create task request: {:?}", req);

        req.targets.sort();
        req.targets.dedup();

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
                return Err(Status::invalid_argument(format!(
                    "无效的目标地址: {}",
                    target
                )));
            }
        }

        if req.workflow.is_none() {
            return Err(Status::invalid_argument("Workflow is required"));
        }
        let workflow_proto = req
            .workflow
            .clone()
            .ok_or_else(|| Status::invalid_argument("Workflow is required"))?;
        if workflow_proto.steps.is_empty() {
            return Err(Status::invalid_argument("Workflow 至少需要一个步骤"));
        }
        for step in &workflow_proto.steps {
            let cmd_id =
                Self::map_step_to_command_id(step.r#type, &step.tool).ok_or_else(|| {
                    Status::invalid_argument(format!(
                        "无效的 workflow step: type={}, tool={}",
                        step.r#type, step.tool
                    ))
                })?;
            if self.registry.get(&cmd_id).is_none() {
                return Err(Status::invalid_argument(format!(
                    "未注册的扫描工具: {}",
                    cmd_id
                )));
            }
        }
        let workflow_model: crate::domain::types::Workflow = workflow_proto.into();

        let id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now().timestamp_millis();

        let meta = TaskMetadata {
            id: id.clone(),
            name: req.name,
            description: req.description,
            targets: req.targets.clone(),
            status: TaskStatus::Pending.as_i32(),
            exit_code: 0,
            error_message: String::new(),
            created_at: now,
            updated_at: None,
            started_at: None,
            finished_at: None,
            log_path: String::new(),
            progress: 0,
            workflow: workflow_model.clone(),
        };

        self.store.create_task(&meta).await.map_err(Status::from)?;
        info!("Task record created in DB: {}", id);

        let fs_result = async {
            let task_dir = self.root.join(&id);
            tokio::fs::create_dir_all(&task_dir).await?;

            task_db::create_targets_db(&task_dir, &req.targets)
                .await
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;

            let workflow: Vec<String> = workflow_model
                .steps
                .iter()
                .filter_map(|step| Self::map_step_to_command_id(step.r#type, &step.tool))
                .collect();
            let commands_dir = task_dir.join("commands");
            tokio::fs::create_dir_all(&commands_dir).await?;

            for cmd_id in &workflow {
                let cmd_dir = commands_dir.join(cmd_id);
                tokio::fs::create_dir_all(&cmd_dir).await?;

                if let Some(cmd) = self.registry.get(cmd_id) {
                    let spec = cmd.build_spec(&req.targets, &[]);
                    let toml_content = toml::to_string_pretty(&spec)
                        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
                    tokio::fs::write(cmd_dir.join("spec.toml"), toml_content).await?;
                }
            }

            let workflow_content = serde_json::to_string_pretty(&workflow)
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
            tokio::fs::write(task_dir.join("workflow.json"), workflow_content).await?;

            Ok::<(), std::io::Error>(())
        }
        .await;

        if let Err(e) = fs_result {
            error!("Failed to setup task files: {}", e);
            self.store.delete_task(&id).await.map_err(Status::from)?;
            return Err(Status::internal(format!("Failed to setup task: {}", e)));
        }

        info!("Task created successfully: {}", id);
        Ok(Response::new(Self::metadata_to_proto(meta)))
    }

    async fn start_task(
        &self,
        request: Request<StartTaskRequest>,
    ) -> Result<Response<ProtoTask>, Status> {
        let id = request.into_inner().id;

        let task = self
            .store
            .get_task(&id)
            .await
            .map_err(Status::from)?
            .ok_or_else(|| Status::not_found("任务未找到"))?;

        if task.status == TaskStatus::Running.as_i32() {
            return Err(Status::failed_precondition("任务正在运行中"));
        }
        if task.status == TaskStatus::Done.as_i32() {
            return Err(Status::failed_precondition("任务已完成，请使用重启功能"));
        }

        info!("Starting task: {}", id);
        self.runner.start(&id).await.map_err(Status::from)?;

        let task = self
            .store
            .get_task(&id)
            .await
            .map_err(Status::from)?
            .ok_or_else(|| Status::not_found("任务未找到"))?;

        Ok(Response::new(Self::metadata_to_proto(task)))
    }

    async fn stop_task(
        &self,
        request: Request<StopTaskRequest>,
    ) -> Result<Response<ProtoTask>, Status> {
        let id = request.into_inner().id;
        info!("Stopping task: {}", id);
        self.runner.stop(&id).await.map_err(Status::from)?;

        let task = self
            .store
            .get_task(&id)
            .await
            .map_err(Status::from)?
            .ok_or_else(|| Status::not_found("任务未找到"))?;

        Ok(Response::new(Self::metadata_to_proto(task)))
    }

    async fn delete_task(
        &self,
        request: Request<DeleteTaskRequest>,
    ) -> Result<Response<()>, Status> {
        let id = request.into_inner().id;
        self.store.delete_task(&id).await.map_err(Status::from)?;
        Ok(Response::new(()))
    }

    async fn stream_task_events(
        &self,
        request: Request<StreamTaskEventsRequest>,
    ) -> Result<Response<Self::StreamTaskEventsStream>, Status> {
        let req = request.into_inner();
        let id = req.id;

        let (tx, rx) = mpsc::channel(100);
        let (runner_tx, mut runner_rx) = mpsc::channel(100);

        if req.start_if_not_running {
            let _ = self
                .runner
                .start_with_event_sink(&id, runner_tx.clone())
                .await;
        }

        if self.runner.attach_event_sink(&id, runner_tx).await.is_err() {
            // task not running; events may be empty
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
                    RunnerEvent::Log { .. } => continue,
                    RunnerEvent::Exit { .. } => continue,
                    RunnerEvent::Snapshot { meta, .. } => TaskEvent {
                        ev: Some(tasks_proto::task_event::Ev::TaskSnapshot(
                            TasksService::metadata_to_proto(meta),
                        )),
                    },
                    RunnerEvent::Error { message, .. } => TaskEvent {
                        ev: Some(tasks_proto::task_event::Ev::Error(ProtoError { message })),
                    },
                };

                if tx.send(Ok(proto_event)).await.is_err() {
                    return;
                }
            }
        });

        Ok(Response::new(ReceiverStream::new(rx)))
    }

    async fn restart_task(
        &self,
        request: Request<RestartTaskRequest>,
    ) -> Result<Response<ProtoTask>, Status> {
        let req = request.into_inner();
        let id = req.id;

        if let Ok(Some(current_task)) = self.store.get_task(&id).await {
            if current_task.status == TaskStatus::Running.as_i32() {
                return Err(Status::failed_precondition(
                    "任务正在运行中，请先停止任务后再重启",
                ));
            }
        } else {
            return Err(Status::not_found("任务不存在"));
        }

        let now = chrono::Utc::now().timestamp_millis();
        let task = self
            .store
            .reset_task_for_restart(&id, now)
            .await
            .map_err(Status::from)?;

        let task_dir = self.root.join(&id);
        if let Err(e) = task_db::reset_targets_db(&task_dir).await {
            error!("Failed to reset targets.db for task {}: {}", id, e);
        }

        if req.start_now {
            self.runner.start(&id).await.map_err(Status::from)?;
        }

        Ok(Response::new(Self::metadata_to_proto(task)))
    }
}
