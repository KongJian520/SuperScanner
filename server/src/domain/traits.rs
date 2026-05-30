use crate::domain::types::{CommandSpec, RunnerEvent, TaskMetadata, TaskMetadataPatch};
use crate::error::AppError;
use crate::storage::task_db::PortRow;
use async_trait::async_trait;
use std::path::PathBuf;
use tokio::sync::mpsc;

/// 任务存储 trait：管理任务元数据的持久化 CRUD
#[async_trait]
pub trait TaskStore: Send + Sync + 'static {
    /// 列出所有任务
    async fn list_tasks(&self) -> Result<Vec<TaskMetadata>, AppError>;
    /// 获取单个任务
    async fn get_task(&self, id: &str) -> Result<Option<TaskMetadata>, AppError>;
    /// 创建新任务
    async fn create_task(&self, meta: &TaskMetadata) -> Result<(), AppError>;
    /// 更新任务元数据
    #[allow(dead_code)]
    async fn update_task(&self, id: &str, patch: &TaskMetadataPatch) -> Result<(), AppError>;
    /// 删除任务
    async fn delete_task(&self, id: &str) -> Result<(), AppError>;
    /// 设置任务状态（含进度、退出码、错误信息等）
    async fn set_status(
        &self,
        id: &str,
        status: i32,
        progress: Option<u8>,
        exit_code: Option<i32>,
        error: Option<String>,
        finished_at: Option<i64>,
    ) -> Result<(), AppError>;
    /// 重置任务以便重新启动
    async fn reset_task_for_restart(&self, id: &str, now_ms: i64)
    -> Result<TaskMetadata, AppError>;
}

/// 命令解析器 trait：从任务目录中解析出待执行的命令规范
#[async_trait]
pub trait CommandParser: Send + Sync + 'static {
    /// 解析任务目录下的 metadata.toml，返回命令规范列表
    async fn parse(&self, task_dir: &PathBuf) -> Result<Vec<CommandSpec>, AppError>;
}

/// 任务管理器 trait：控制任务的生命周期（启动、停止、事件流）
#[async_trait]
pub trait TaskManager: Send + Sync + 'static {
    /// 启动任务
    async fn start(&self, id: &str) -> Result<i64, AppError>;
    /// 停止任务
    async fn stop(&self, id: &str) -> Result<(), AppError>;
    /// 启动任务并接收事件流
    async fn start_with_event_sink(
        &self,
        id: &str,
        sink: mpsc::Sender<RunnerEvent>,
    ) -> Result<i64, AppError>;
    /// 将事件接收器附加到运行中的任务
    async fn attach_event_sink(
        &self,
        id: &str,
        sink: mpsc::Sender<RunnerEvent>,
    ) -> Result<(), AppError>;
}

/// 目标存储库 trait，封装对 targets.db 的所有操作
#[async_trait]
pub trait TargetRepository: Send + Sync + 'static {
    async fn create_targets(&self, task_id: &str, targets: &[String]) -> Result<(), AppError>;
    async fn reset_targets(&self, task_id: &str) -> Result<(), AppError>;
    async fn query_port_results(&self, task_id: &str) -> Result<Vec<PortRow>, AppError>;
}
