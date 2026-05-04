use crate::error::AppError;
use async_trait::async_trait;
use chrono::Utc;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePool};
use std::path::PathBuf;
use std::str::FromStr;
use std::sync::Arc;
use tokio::sync::Mutex;

#[async_trait]
pub trait Scheduler: Send + Sync + 'static {
    /// 将任务加入队列（queued 状态）
    async fn enqueue(&self, task_id: &str) -> Result<(), AppError>;
    /// 标记任务完成
    async fn complete(&self, task_id: &str) -> Result<(), AppError>;
    /// 标记任务失败
    async fn fail(&self, task_id: &str, reason: &str) -> Result<(), AppError>;
    /// 重启后，将 running 状态的任务恢复为 queued
    async fn recover_running(&self) -> Result<Vec<String>, AppError>;
}

pub struct SqliteScheduler {
    pool: Arc<Mutex<SqlitePool>>,
}

impl SqliteScheduler {
    pub async fn new(root_dir: &PathBuf) -> Result<Self, AppError> {
        let db_path = root_dir.join("scheduler.db");
        let db_url = format!("sqlite://{}", db_path.to_string_lossy());
        let opts = SqliteConnectOptions::from_str(&db_url)
            .map_err(|e| AppError::Storage(format!("Scheduler DB URL 解析失败: {}", e)))?
            .create_if_missing(true);
        let pool = SqlitePool::connect_with(opts)
            .await
            .map_err(|e| AppError::Storage(format!("无法创建 scheduler.db: {}", e)))?;

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS task_queue (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id      TEXT NOT NULL UNIQUE,
                status       TEXT NOT NULL DEFAULT 'queued',
                created_at   INTEGER NOT NULL,
                started_at   INTEGER,
                failed_reason TEXT
            )",
        )
        .execute(&pool)
        .await
        .map_err(|e| AppError::Storage(format!("无法创建 task_queue 表: {}", e)))?;

        Ok(Self {
            pool: Arc::new(Mutex::new(pool)),
        })
    }
}

#[async_trait]
impl Scheduler for SqliteScheduler {
    async fn enqueue(&self, task_id: &str) -> Result<(), AppError> {
        let pool = self.pool.lock().await;
        let now = Utc::now().timestamp_millis();
        sqlx::query(
            "INSERT INTO task_queue (task_id, status, created_at, started_at)
             VALUES (?, 'running', ?, ?)
             ON CONFLICT(task_id) DO UPDATE SET status = 'running', started_at = excluded.started_at",
        )
        .bind(task_id)
        .bind(now)
        .bind(now)
        .execute(&*pool)
        .await
        .map_err(|e| AppError::Storage(format!("入队失败: {}", e)))?;
        Ok(())
    }

    async fn complete(&self, task_id: &str) -> Result<(), AppError> {
        let pool = self.pool.lock().await;
        sqlx::query("UPDATE task_queue SET status = 'done' WHERE task_id = ?")
            .bind(task_id)
            .execute(&*pool)
            .await
            .map_err(|e| AppError::Storage(format!("标记完成失败: {}", e)))?;
        Ok(())
    }

    async fn fail(&self, task_id: &str, reason: &str) -> Result<(), AppError> {
        let pool = self.pool.lock().await;
        sqlx::query("UPDATE task_queue SET status = 'failed', failed_reason = ? WHERE task_id = ?")
            .bind(reason)
            .bind(task_id)
            .execute(&*pool)
            .await
            .map_err(|e| AppError::Storage(format!("标记失败状态失败: {}", e)))?;
        Ok(())
    }

    async fn recover_running(&self) -> Result<Vec<String>, AppError> {
        let pool = self.pool.lock().await;
        // 将未完成的 running 状态恢复为 queued（重启后调用）
        sqlx::query("UPDATE task_queue SET status = 'queued' WHERE status = 'running'")
            .execute(&*pool)
            .await
            .map_err(|e| AppError::Storage(format!("恢复任务失败: {}", e)))?;

        let rows: Vec<(String,)> =
            sqlx::query_as("SELECT task_id FROM task_queue WHERE status = 'queued'")
                .fetch_all(&*pool)
                .await
                .map_err(|e| AppError::Storage(format!("查询待恢复任务失败: {}", e)))?;

        Ok(rows.into_iter().map(|(id,)| id).collect())
    }
}

/// 无操作调度器，用于测试或不需要持久化队列的场景
pub struct NoopScheduler;

#[async_trait]
impl Scheduler for NoopScheduler {
    async fn enqueue(&self, _task_id: &str) -> Result<(), AppError> {
        Ok(())
    }
    async fn complete(&self, _task_id: &str) -> Result<(), AppError> {
        Ok(())
    }
    async fn fail(&self, _task_id: &str, _reason: &str) -> Result<(), AppError> {
        Ok(())
    }
    async fn recover_running(&self) -> Result<Vec<String>, AppError> {
        Ok(vec![])
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[tokio::test]
    async fn test_enqueue_complete_fail() {
        let dir = tempdir().unwrap();
        let scheduler = SqliteScheduler::new(&dir.path().to_path_buf())
            .await
            .unwrap();

        scheduler.enqueue("task-1").await.unwrap();
        scheduler.complete("task-1").await.unwrap();

        scheduler.enqueue("task-2").await.unwrap();
        scheduler.fail("task-2", "test failure").await.unwrap();
    }

    #[tokio::test]
    async fn test_recover_running() {
        let dir = tempdir().unwrap();
        let scheduler = SqliteScheduler::new(&dir.path().to_path_buf())
            .await
            .unwrap();

        // 模拟重启前有 running 的任务
        scheduler.enqueue("task-running").await.unwrap();

        let recovered = scheduler.recover_running().await.unwrap();
        assert!(recovered.contains(&"task-running".to_string()));
    }
}
