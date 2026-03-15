use crate::domain::traits::TargetRepository;
use crate::error::AppError;
use crate::storage::task_db::{self, PortRow};
use async_trait::async_trait;
use std::path::PathBuf;

pub struct SqliteTargetRepository {
    tasks_dir: PathBuf,
}

impl SqliteTargetRepository {
    pub fn new(tasks_dir: PathBuf) -> Self {
        Self { tasks_dir }
    }

    fn task_dir(&self, task_id: &str) -> PathBuf {
        self.tasks_dir.join(task_id)
    }
}

#[async_trait]
impl TargetRepository for SqliteTargetRepository {
    async fn create_targets(&self, task_id: &str, targets: &[String]) -> Result<(), AppError> {
        task_db::create_targets_db(&self.task_dir(task_id), targets).await
    }

    async fn reset_targets(&self, task_id: &str) -> Result<(), AppError> {
        task_db::reset_targets_db(&self.task_dir(task_id)).await
    }

    async fn query_port_results(&self, task_id: &str) -> Result<Vec<PortRow>, AppError> {
        let pool = task_db::open_targets_db(&self.task_dir(task_id)).await?;
        let rows = task_db::query_port_results(&pool).await?;
        pool.close().await;
        Ok(rows)
    }
}
