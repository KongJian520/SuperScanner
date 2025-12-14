use async_trait::async_trait;
use std::path::PathBuf;
use std::time::Duration;
use tokio::sync::mpsc;
use crate::core::types::{CommandSpec, TaskMetadata, TaskMetadataPatch, RunnerEvent};
use crate::error::AppError;

#[async_trait]
pub trait TaskStore: Send + Sync + 'static {
    async fn list_tasks(&self) -> Result<Vec<TaskMetadata>, AppError>;
    async fn get_task(&self, id: &str) -> Result<Option<TaskMetadata>, AppError>;
    async fn create_task(&self, meta: &TaskMetadata) -> Result<(), AppError>;
    #[allow(dead_code)]
    async fn update_task(&self, id: &str, patch: &TaskMetadataPatch) -> Result<(), AppError>;
    async fn delete_task(&self, id: &str) -> Result<(), AppError>;
    async fn set_status(&self, id: &str, status: i32, progress: Option<u8>, exit_code: Option<i32>, error: Option<String>, finished_at: Option<i64>) -> Result<(), AppError>;
    async fn reset_task_for_restart(&self, id: &str, now_ms: i64) -> Result<TaskMetadata, AppError>;
}

#[async_trait]
pub trait CommandParser: Send + Sync + 'static {
    async fn parse(&self, task_dir: &PathBuf) -> Result<Vec<CommandSpec>, AppError>;
}

#[async_trait]
pub trait TaskManager: Send + Sync + 'static {
    async fn start(&self, id: &str) -> Result<i64, AppError>;
    async fn stop(&self, id: &str) -> Result<(), AppError>;
    async fn ensure_stopped(&self, id: &str, _timeout: Duration) -> Result<(), AppError> {
        let _ = self.stop(id).await?;
        Ok(())
    }
    async fn start_with_event_sink(&self, id: &str, sink: mpsc::Sender<RunnerEvent>) -> Result<i64, AppError>;
    async fn attach_event_sink(&self, id: &str, sink: mpsc::Sender<RunnerEvent>) -> Result<(), AppError>;
}
