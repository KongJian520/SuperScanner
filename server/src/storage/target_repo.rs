use crate::domain::traits::TargetRepository;
use crate::error::AppError;
use crate::storage::task_db::{self, PortRow};
use async_trait::async_trait;
use std::path::PathBuf;

/// 基于 SQLite 的目标仓库实现，代理到 task_db 模块
pub struct SqliteTargetRepository {
    /// 任务目录根路径
    tasks_dir: PathBuf,
}

impl SqliteTargetRepository {
    /// 创建新的 SQLite 目标仓库实例
    pub fn new(tasks_dir: PathBuf) -> Self {
        Self { tasks_dir }
    }

    fn task_dir(&self, task_id: &str) -> PathBuf {
        self.tasks_dir.join(task_id)
    }
}

#[async_trait]
impl TargetRepository for SqliteTargetRepository {
    /// 创建目标数据库并批量插入目标 IP
    async fn create_targets(&self, task_id: &str, targets: &[String]) -> Result<(), AppError> {
        task_db::create_targets_db(&self.task_dir(task_id), targets).await
    }

    /// 重置所有目标状态为 pending
    async fn reset_targets(&self, task_id: &str) -> Result<(), AppError> {
        task_db::reset_targets_db(&self.task_dir(task_id)).await
    }

    /// 查询端口扫描结果
    async fn query_port_results(&self, task_id: &str) -> Result<Vec<PortRow>, AppError> {
        let pool = task_db::open_targets_db(&self.task_dir(task_id)).await?;
        let rows = task_db::query_port_results(&pool).await?;
        pool.close().await;
        Ok(rows)
    }
}
