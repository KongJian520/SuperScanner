use anyhow::Result;
use async_trait::async_trait;
use std::path::PathBuf;
use std::time::Duration;

#[async_trait]
pub trait TaskRunner: Send + Sync + 'static {
    /// Start the task identified by `id`. Return a pid or runtime instance id on success.
    async fn start(&self, id: &str) -> Result<i64>;

    /// Stop the running task and ensure all file handles are released before returning.
    async fn stop(&self, id: &str) -> Result<()>;

    /// Optional: ensure stopped within timeout.
    async fn ensure_stopped(&self, id: &str, timeout: Duration) -> Result<()> {
        // Default implementation: call stop and return.
        let _ = self.stop(id).await?;
        Ok(())
    }
}

/// Minimal background runner stub. Real implementation should spawn processes or tokio tasks,
/// manage log file handles, and update metadata.db when tasks finish.
pub struct BackgroundTaskRunner {
    root: PathBuf,
}

impl BackgroundTaskRunner {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }
}

#[async_trait]
impl TaskRunner for BackgroundTaskRunner {
    async fn start(&self, _id: &str) -> Result<i64> {
        // TODO: spawn process or task, open log file, and return actual pid or instance id
        // For now return a fake pid (timestamp)
        Ok(chrono::Utc::now().timestamp_millis())
    }

    async fn stop(&self, _id: &str) -> Result<()> {
        // TODO: stop the process/task and ensure file handles closed
        Ok(())
    }

    async fn ensure_stopped(&self, id: &str, _timeout: Duration) -> Result<()> {
        // Default to stop for stub
        self.stop(id).await
    }
}
