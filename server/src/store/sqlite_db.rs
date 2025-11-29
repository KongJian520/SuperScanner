use async_trait::async_trait;
use sqlx::{sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous}, SqlitePool, Row};
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::time::Duration;
use uuid::Uuid;
use std::time::{SystemTime, UNIX_EPOCH};
use crate::store::{StoreError, Task, TaskStore};

pub struct SqliteStore {
    pool: SqlitePool,
    root: PathBuf,
}

impl SqliteStore {
    /// 初始化数据库连接并创建表
    pub async fn new(root_path: PathBuf) -> Result<Self, StoreError> {
        // 确保目录存在
        if !root_path.exists() {
            tokio::fs::create_dir_all(&root_path)
                .await
                .map_err(StoreError::Io)?;
        }

        let db_path = root_path.join("data.db");

        // 配置连接选项（高性能模式）
        let options = SqliteConnectOptions::new()
            .filename(&db_path)
            .create_if_missing(true)
            .journal_mode(SqliteJournalMode::Wal)
            .synchronous(SqliteSynchronous::Normal)
            .busy_timeout(Duration::from_secs(5));

        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect_with(options)
            .await
            .map_err(map_sql_err)?;
        // 初始化表结构
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'PENDING',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_status ON projects(status);
            "#
        )
            .execute(&pool)
            .await
            .map_err(map_sql_err)?;

        Ok(Self {
            pool,
            root: root_path,
        })
    }
}

#[async_trait]
impl TaskStore for SqliteStore {
    async fn create(&self, name: String, description: String) -> Result<Task, StoreError> {
        let id = Uuid::new_v4().to_string();
        let now = current_timestamp();

        // 使用 RETURNING 直接返回插入后的数据，省去一次查询
        let project = sqlx::query_as::<_, Task>(
            r#"
            INSERT INTO projects (id, name, description, status, created_at, updated_at)
            VALUES (?, ?, ?, 'PENDING', ?, ?)
            RETURNING id, name, description, status, created_at, updated_at
            "#
        )
            .bind(&id)
            .bind(&name)
            .bind(&description)
            .bind(now)
            .bind(now)
            .fetch_one(&self.pool)
            .await
            .map_err(map_sql_err)?;

        Ok(project)
    }

    async fn get(&self, id: &str) -> Result<Task, StoreError> {
        sqlx::query_as::<_, Task>(
            "SELECT id, name, description, status, created_at, updated_at FROM projects WHERE id = ?"
        )
            .bind(id)
            .fetch_optional(&self.pool)
            .await
            .map_err(map_sql_err)?
            .ok_or(StoreError::NotFound)
    }

    async fn list(&self) -> Result<Vec<Task>, StoreError> {
        let projects = sqlx::query_as::<_, Task>(
            "SELECT id, name, description, status, created_at, updated_at FROM projects ORDER BY created_at DESC"
        )
            .fetch_all(&self.pool)
            .await
            .map_err(map_sql_err)?;

        Ok(projects)
    }

    async fn update(
        &self,
        id: &str,
        name: Option<String>,
        description: Option<String>
    ) -> Result<Task, StoreError> {
        let now = current_timestamp();

        // COALESCE技巧：如果传入的是 NULL (None)，则保持原值不变
        let project = sqlx::query_as::<_, Task>(
            r#"
            UPDATE projects
            SET
                name = COALESCE(?, name),
                description = COALESCE(?, description),
                updated_at = ?
            WHERE id = ?
            RETURNING id, name, description, status, created_at, updated_at
            "#
        )
            .bind(name)        // ?1
            .bind(description) // ?2
            .bind(now)         // ?3
            .bind(id)          // ?4
            .fetch_optional(&self.pool)
            .await
            .map_err(map_sql_err)?
            .ok_or(StoreError::NotFound)?;

        Ok(project)
    }

    async fn delete(&self, id: &str) -> Result<bool, StoreError> {
        let result = sqlx::query("DELETE FROM projects WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await
            .map_err(map_sql_err)?;

        Ok(result.rows_affected() > 0)
    }


    async fn set_status(&self, id: &str, status: &str) -> Result<(), StoreError> {
        let now = current_timestamp();
        let result = sqlx::query(
            "UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?"
        )
            .bind(status)
            .bind(now)
            .bind(id)
            .execute(&self.pool)
            .await
            .map_err(map_sql_err)?;

        if result.rows_affected() == 0 {
            return Err(StoreError::NotFound);
        }
        Ok(())
    }

    fn root(&self) -> &Path {
        &self.root
    }
}

// --- 辅助函数 ---

// 将 sqlx 错误映射为自定义 StoreError
fn map_sql_err(e: sqlx::Error) -> StoreError {
    match e {
        sqlx::Error::RowNotFound => StoreError::NotFound,
        sqlx::Error::Database(d) => {
            // 简单的约束冲突检查，实际可能需要解析 message
            if d.message().contains("UNIQUE constraint failed") {
                StoreError::AlreadyExists
            } else {
                StoreError::Db(d.to_string())
            }
        }
        _ => StoreError::Db(e.to_string()),
    }
}

fn current_timestamp() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}