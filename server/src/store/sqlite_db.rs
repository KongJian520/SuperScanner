use std::str::FromStr;
use std::time::Duration;
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous};
use sqlx::SqlitePool;
use anyhow::Result;

#[derive(Clone)] // 让它易于在线程间传递
pub struct SqliteDB {
    pub pool: SqlitePool,
}

impl SqliteDB {
    pub async fn new(path: &str) -> Result<Self> {
        let options = SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(true)
            .journal_mode(SqliteJournalMode::Wal)
            .synchronous(SqliteSynchronous::Normal)
            .busy_timeout(Duration::from_secs(5));


        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect_with(options)
            .await?;

        // 返回构造好的结构体
        Ok(Self {
            pool,
        })
    }

    // 示例：你可以在这里添加其他方法
    pub async fn init_tables(&self) -> Result<()> {
        sqlx::query("CREATE TABLE IF NOT EXISTS pages (url TEXT, content TEXT)")
            .execute(&self.pool)
            .await?;
        Ok(())
    }
}

// 用法：
// #[tokio::main]
// async fn main() {
//     let data_store = SqliteDB::new("spider.data_store").await.unwrap();
//     data_store.init_tables().await.unwrap();
// }