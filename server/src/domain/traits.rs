use crate::domain::types::{CommandSpec, RunnerEvent, TaskMetadata, TaskMetadataPatch};
use crate::error::AppError;
use crate::storage::task_db::PortRow;
use async_trait::async_trait;
use std::path::PathBuf;
use tokio::sync::mpsc;

#[async_trait]
pub trait TaskStore: Send + Sync + 'static {
    async fn list_tasks(&self) -> Result<Vec<TaskMetadata>, AppError>;
    async fn get_task(&self, id: &str) -> Result<Option<TaskMetadata>, AppError>;
    async fn create_task(&self, meta: &TaskMetadata) -> Result<(), AppError>;
    #[allow(dead_code)]
    async fn update_task(&self, id: &str, patch: &TaskMetadataPatch) -> Result<(), AppError>;
    async fn delete_task(&self, id: &str) -> Result<(), AppError>;
    async fn set_status(
        &self,
        id: &str,
        status: i32,
        progress: Option<u8>,
        exit_code: Option<i32>,
        error: Option<String>,
        finished_at: Option<i64>,
    ) -> Result<(), AppError>;
    async fn reset_task_for_restart(&self, id: &str, now_ms: i64)
    -> Result<TaskMetadata, AppError>;
}

#[async_trait]
pub trait CommandParser: Send + Sync + 'static {
    async fn parse(&self, task_dir: &PathBuf) -> Result<Vec<CommandSpec>, AppError>;
}

#[async_trait]
pub trait TaskManager: Send + Sync + 'static {
    async fn start(&self, id: &str) -> Result<i64, AppError>;
    async fn stop(&self, id: &str) -> Result<(), AppError>;
    async fn start_with_event_sink(
        &self,
        id: &str,
        sink: mpsc::Sender<RunnerEvent>,
    ) -> Result<i64, AppError>;
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
