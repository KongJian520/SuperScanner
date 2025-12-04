// ...existing code...
use crate::proto::tasks_proto::{
    tasks_server, CreateTaskRequest, DeleteTaskRequest, GetTaskRequest, ListTasksRequest,
    ListTasksResponse, StartTaskRequest, StopTaskRequest, Task as ProtoTask, TaskStatus,
};
use crate::services::task_runner::{BackgroundTaskRunner, TaskRunner};
use crate::utils::ROOT_DIR;

use async_trait::async_trait;
use prost_types::Timestamp;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::fs;
use tonic::{Request, Response, Status};
use tracing::{error, info, warn};
use uuid::Uuid;

// 定义存储在 metadata.toml 中的结构
#[derive(Debug, Serialize, Deserialize, Clone)]
struct TaskMetadata {
    /// 任务的唯一标识符 (通常为 UUID)
    id: String,
    /// 任务名称，用于显示
    name: String,
    /// 任务的详细描述
    description: String,
    targets: Vec<String>,
    /// 当前任务状态
    status: i32,
    /// 进程退出码 (仅在任务结束时有效)
    /// 0 通常表示成功，非 0 表示有错误发生
    exit_code: i32,
    /// 错误信息详情
    /// 仅在 status 为 FAILED 时填充，用于排查问题
    error_message: String,
    /// 任务创建时间 (毫秒)
    created_at: i64,
    /// 任务最后一次更新的时间 (包括状态变更、重命名等) (毫秒)
    updated_at: Option<i64>,
    /// 任务实际开始运行的时间 (从 PENDING 转为 RUNNING 的时间点) (毫秒)
    started_at: Option<i64>,
    /// 任务结束时间 (进入 DONE, FAILED 或 STOPPED 的时间点) (毫秒)
    finished_at: Option<i64>,
    /// 日志文件路径
    log_path: String,
}

pub struct Task {}
pub struct TasksService {
    root: PathBuf,
    runner: Arc<dyn TaskRunner>,
}

// --- 内部私有方法 ---
impl TasksService {
    pub fn new() -> Self {
        let root = ROOT_DIR.join("tasks");
        let runner = Arc::new(BackgroundTaskRunner::new(root.clone()));
        Self { root, runner }
    }

    /// 获取当前毫秒时间戳
    fn now() -> i64 {
        chrono::Utc::now().timestamp_millis()
    }

    /// 将毫秒转换为 Protobuf Timestamp
    fn to_proto_ts(ms: Option<i64>) -> Option<Timestamp> {
        ms.map(|m| Timestamp {
            seconds: m / 1000,
            nanos: ((m % 1000) * 1_000_000) as i32,
        })
    }

    /// 将 Metadata 转换为 ProtoTask
    fn metadata_to_proto(meta: TaskMetadata) -> ProtoTask {
        // 使用统一转换函数处理 created_at
        let created_at = Self::to_proto_ts(Some(meta.created_at));

        ProtoTask {
            id: meta.id,
            name: meta.name,
            description: meta.description,
            targets: meta.targets,
            status: meta.status,
            exit_code: meta.exit_code,
            error_message: meta.error_message,
            created_at,
            updated_at: Self::to_proto_ts(meta.updated_at),
            started_at: Self::to_proto_ts(meta.started_at),
            finished_at: Self::to_proto_ts(meta.finished_at),
        }
    }

    /// 读取 metadata.toml
    async fn load_metadata(task_dir: &Path) -> Result<TaskMetadata, anyhow::Error> {
        let toml_path = task_dir.join("metadata.toml");
        let content = fs::read_to_string(&toml_path).await?;
        let meta: TaskMetadata = toml::from_str(&content)?;
        Ok(meta)
    }

    /// 写入 metadata.toml
    async fn save_metadata(task_dir: &Path, meta: &TaskMetadata) -> Result<(), anyhow::Error> {
        let toml_path = task_dir.join("metadata.toml");
        let content = toml::to_string_pretty(meta)?;
        fs::write(&toml_path, content).await?;
        Ok(())
    }

    /// 尝试加载单个任务 (ListTasks 专用)
    async fn try_load_task(&self, id: &str, task_dir: PathBuf) -> Option<ProtoTask> {
        let toml_path = task_dir.join("metadata.toml");

        if !fs::try_exists(&toml_path).await.unwrap_or(false) {
            return None;
        }

        match Self::load_metadata(&task_dir).await {
            Ok(meta) => Some(Self::metadata_to_proto(meta)),
            Err(e) => {
                warn!(%id, "Skipping task: failed to parse metadata.toml: {}", e);
                None
            }
        }
    }
}

// --- gRPC 实现 ---

#[async_trait]
impl tasks_server::Tasks for TasksService {
    async fn list_tasks(
        &self,
        _req: Request<ListTasksRequest>,
    ) -> Result<Response<ListTasksResponse>, Status> {
        if !fs::try_exists(&self.root).await.unwrap_or(false) {
            return Ok(Response::new(ListTasksResponse { tasks: vec![] }));
        }

        let mut entries = fs::read_dir(&self.root)
            .await
            .map_err(|e| Status::internal(format!("read tasks dir failed: {}", e)))?;

        let mut tasks: Vec<ProtoTask> = Vec::new();

        while let Some(entry) = entries
            .next_entry()
            .await
            .map_err(|e| Status::internal(format!("read dir entry failed: {}", e)))?
        {
            if !entry
                .file_type()
                .await
                .map_err(|e| Status::internal(format!("get file type failed: {}", e)))?
                .is_dir()
            {
                continue;
            }

            let dirname = entry.file_name().to_string_lossy().to_string();

            // 过滤临时目录
            if dirname.contains(".creating.") || dirname.contains(".deleting.") {
                continue;
            }

            if let Some(task) = self.try_load_task(&dirname, entry.path()).await {
                tasks.push(task);
            }
        }

        info!("ListTasks: Found {} tasks", tasks.len());
        Ok(Response::new(ListTasksResponse { tasks }))
    }

    async fn create_task(
        &self,
        req: Request<CreateTaskRequest>,
    ) -> Result<Response<ProtoTask>, Status> {
        let req = req.get_ref();
        info!("CreateTask: Request received for name='{}'", req.name);

        if req.name.trim().is_empty() {
            return Err(Status::invalid_argument("name is required"));
        }
        if req.targets.is_empty() {
            return Err(Status::invalid_argument("targets is required"));
        }

        let id = Uuid::new_v4().to_string();

        // 准备路径
        let tmp_name = format!("{}.creating.{}", id, Uuid::new_v4());
        let tmp_dir = self.root.join(&tmp_name);
        let log_path = tmp_dir.join("logs").join("task.log");

        // 构建 Metadata 对象
        let now = Self::now();
        let meta = TaskMetadata {
            id: id.clone(),
            name: req.name.clone(),
            description: req.description.clone(),
            targets: req.targets.clone(),
            status: TaskStatus::Pending as i32,
            exit_code: 0,
            error_message: String::new(),
            created_at: now,
            updated_at: Some(now),
            started_at: None,
            finished_at: None,
            log_path: log_path.display().to_string(),
        };

        // 创建目录结构
        fs::create_dir_all(&tmp_dir)
            .await
            .map_err(|e| Status::internal(format!("mkdir failed: {}", e)))?;

        // 创建 logs 目录
        fs::create_dir_all(tmp_dir.join("logs"))
            .await
            .map_err(|e| Status::internal(format!("create logs dir failed: {}", e)))?;

        // 创建日志文件
        {
            let _f = fs::File::create(&log_path)
                .await
                .map_err(|e| Status::internal(format!("create log failed: {}", e)))?;
        }

        // 保存 metadata.toml
        Self::save_metadata(&tmp_dir, &meta)
            .await
            .map_err(|e| Status::internal(format!("save metadata failed: {}", e)))?;

        // Windows 锁等待 (文件系统操作在某些系统上可能不是原子的)
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;

        let final_dir = self.root.join(&id);
        if final_dir.exists() {
            let _ = fs::remove_dir_all(&tmp_dir).await;
            return Err(Status::already_exists("task id exists"));
        }

        fs::rename(&tmp_dir, &final_dir)
            .await
            .map_err(|e| Status::internal(format!("rename failed: {}", e)))?;

        info!("CreateTask: Successfully created task id={}", id);

        // 返回 Proto 对象
        Ok(Response::new(Self::metadata_to_proto(meta)))
    }

    async fn delete_task(
        &self,
        request: Request<DeleteTaskRequest>,
    ) -> Result<Response<()>, Status> {
        let id = &request.get_ref().id;
        info!("DeleteTask: Request received for id={}", id);

        let dir = self.root.join(id);
        if !dir.exists() {
            return Err(Status::not_found("task not found"));
        }

        // 尝试读取状态并停止
        match Self::load_metadata(&dir).await {
            Ok(meta) => {
                if meta.status == TaskStatus::Running as i32 {
                    info!("DeleteTask: Task {} is running, stopping first...", id);
                    self.runner.stop(id).await.map_err(|e| {
                        Status::failed_precondition(format!("runner stop failed: {}", e))
                    })?;
                } else {
                    let _ = self
                        .runner
                        .ensure_stopped(id, std::time::Duration::from_secs(5))
                        .await;
                }
            }
            Err(e) => {
                // 如果 metadata 读取失败，强制停止 Runner 并继续删除
                error!(
                    "DeleteTask: Cannot load metadata: {}. Force stopping runner.",
                    e
                );
                let _ = self
                    .runner
                    .ensure_stopped(id, std::time::Duration::from_secs(5))
                    .await;
            }
        }

        // 重命名删除
        let deleting_dir = self.root.join(format!("{}.deleting.{}", id, Self::now()));
        fs::rename(&dir, &deleting_dir)
            .await
            .map_err(|e| Status::internal(format!("rename before delete failed: {}", e)))?;

        fs::remove_dir_all(&deleting_dir)
            .await
            .map_err(|e| Status::internal(format!("remove dir failed: {}", e)))?;

        info!("DeleteTask: Successfully deleted task id={}", id);
        Ok(Response::new(()))
    }

    async fn get_task(&self, req: Request<GetTaskRequest>) -> Result<Response<ProtoTask>, Status> {
        let id = &req.get_ref().id;
        let task_dir = self.root.join(id);
        let toml_path = task_dir.join("metadata.toml");

        if !fs::try_exists(&toml_path).await.unwrap_or(false) {
            return Err(Status::not_found("task not found"));
        }

        let meta = Self::load_metadata(&task_dir)
            .await
            .map_err(|e| Status::internal(format!("load metadata failed: {}", e)))?;

        Ok(Response::new(Self::metadata_to_proto(meta)))
    }

    async fn start_task(
        &self,
        req: Request<StartTaskRequest>,
    ) -> Result<Response<ProtoTask>, Status> {
        let id = &req.get_ref().id;
        info!("StartTask: Request received for id={}", id);

        let task_dir = self.root.join(id);
        let toml_path = task_dir.join("metadata.toml");

        if !fs::try_exists(&toml_path).await.unwrap_or(false) {
            return Err(Status::not_found("task not found"));
        }

        // 读取当前状态
        let mut meta = Self::load_metadata(&task_dir)
            .await
            .map_err(|e| Status::internal(format!("load metadata failed: {}", e)))?;

        if meta.status != TaskStatus::Pending as i32 && meta.status != TaskStatus::Paused as i32
        // 允许重启已停止的任务（视具体需求而定，这里保留原逻辑，只允许 Pending/Paused，
        // 若原逻辑允许 Stopped 重启，请添加 TaskStatus::Stopped）
        {
            return Err(Status::failed_precondition("task not in startable state"));
        }

        // 更新 Metadata
        let now = Self::now();
        meta.status = TaskStatus::Running as i32;
        meta.started_at = Some(now);
        meta.updated_at = Some(now);

        // 写回文件
        Self::save_metadata(&task_dir, &meta)
            .await
            .map_err(|e| Status::internal(format!("save metadata failed: {}", e)))?;

        Ok(Response::new(Self::metadata_to_proto(meta)))
    }

    async fn stop_task(
        &self,
        req: Request<StopTaskRequest>,
    ) -> Result<Response<ProtoTask>, Status> {
        let id = &req.get_ref().id;
        info!("StopTask: Request received for id={}", id);

        let task_dir = self.root.join(id);
        let toml_path = task_dir.join("metadata.toml");

        if !fs::try_exists(&toml_path).await.unwrap_or(false) {
            return Err(Status::not_found("task not found"));
        }

        // 读取当前状态
        let mut meta = Self::load_metadata(&task_dir)
            .await
            .map_err(|e| Status::internal(format!("load metadata failed: {}", e)))?;

        if meta.status != TaskStatus::Running as i32 {
            return Err(Status::failed_precondition("task not running"));
        }

        // 停止进程
        self.runner
            .stop(id)
            .await
            .map_err(|e| Status::internal(format!("runner stop failed: {}", e)))?;

        info!("StopTask: Successfully stopped task id={}", id);

        // 更新 Metadata
        let now = Self::now();
        meta.status = TaskStatus::Stopped as i32;
        meta.finished_at = Some(now);
        meta.updated_at = Some(now);

        // 写回文件
        Self::save_metadata(&task_dir, &meta)
            .await
            .map_err(|e| Status::internal(format!("save metadata failed: {}", e)))?;

        Ok(Response::new(Self::metadata_to_proto(meta)))
    }
}
