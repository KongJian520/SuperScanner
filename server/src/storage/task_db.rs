use crate::error::AppError;
use ipnetwork::IpNetwork;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePool};
use std::path::Path;
use std::str::FromStr;

/// 一行 port_results 记录
pub struct PortRow {
    pub ip: String,
    pub port: i64,
    pub protocol: String,
    pub state: String,
    pub service: String,
    pub tool: String,
    pub timestamp: String,
}

/// 创建 targets.db，建表，批量插入展开后的 IP
pub async fn create_targets_db(task_dir: &Path, targets: &[String]) -> Result<(), AppError> {
    let db_path = task_dir.join("targets.db");
    let db_url = format!("sqlite://{}", db_path.to_string_lossy());

    let opts = SqliteConnectOptions::from_str(&db_url)
        .map_err(|e| AppError::Storage(format!("DB URL 解析失败: {}", e)))?
        .create_if_missing(true);
    let pool = SqlitePool::connect_with(opts)
        .await
        .map_err(|e| AppError::Storage(format!("无法创建 targets.db: {}", e)))?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS targets (ip TEXT PRIMARY KEY, status TEXT DEFAULT 'pending', updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)"
    )
    .execute(&pool)
    .await
    .map_err(|e| AppError::Storage(format!("无法创建 targets 表: {}", e)))?;

    let mut expanded = Vec::new();
    for target in targets {
        if let Ok(net) = target.parse::<IpNetwork>() {
            for ip in net.iter() {
                expanded.push(ip.to_string());
            }
        } else {
            expanded.push(target.clone());
        }
    }

    let mut tx = pool
        .begin()
        .await
        .map_err(|e| AppError::Storage(format!("无法开启事务: {}", e)))?;
    for ip in expanded {
        sqlx::query("INSERT OR IGNORE INTO targets (ip) VALUES (?)")
            .bind(ip)
            .execute(&mut *tx)
            .await
            .map_err(|e| AppError::Storage(format!("插入目标失败: {}", e)))?;
    }
    tx.commit()
        .await
        .map_err(|e| AppError::Storage(format!("事务提交失败: {}", e)))?;
    pool.close().await;

    Ok(())
}

/// 重置所有目标状态为 'pending'
pub async fn reset_targets_db(task_dir: &Path) -> Result<(), AppError> {
    let db_path = task_dir.join("targets.db");
    if !db_path.exists() {
        return Ok(());
    }
    let pool = open_targets_db(task_dir).await?;
    sqlx::query("UPDATE targets SET status = 'pending'")
        .execute(&pool)
        .await
        .map_err(|e| AppError::Storage(format!("重置 targets 状态失败: {}", e)))?;
    pool.close().await;
    Ok(())
}

/// 打开已存在的 targets.db，返回连接池
pub async fn open_targets_db(task_dir: &Path) -> Result<SqlitePool, AppError> {
    let db_path = task_dir.join("targets.db");
    let db_url = format!("sqlite://{}", db_path.to_string_lossy());
    SqlitePool::connect(&db_url)
        .await
        .map_err(|e| AppError::Storage(format!("无法连接 targets.db: {}", e)))
}

/// 读取 port_results 表，返回 PortRow 列表
pub async fn query_port_results(pool: &SqlitePool) -> Result<Vec<PortRow>, AppError> {
    let rows = sqlx::query(
        "SELECT ip, port, protocol, state, service, tool, CAST(updated_at AS TEXT) as updated_at FROM port_results"
    )
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Storage(format!("查询 port_results 失败: {}", e)))?;

    let mut result = Vec::new();
    for row in rows {
        use sqlx::Row;
        let port: i64 = row.try_get("port").unwrap_or(0);
        result.push(PortRow {
            ip: row.try_get("ip").unwrap_or_default(),
            port,
            protocol: row.try_get("protocol").unwrap_or_default(),
            state: row.try_get("state").unwrap_or_default(),
            service: row.try_get("service").unwrap_or_default(),
            tool: row.try_get("tool").unwrap_or_default(),
            timestamp: row.try_get("updated_at").unwrap_or_default(),
        });
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[tokio::test]
    async fn test_create_and_reset_targets_db() {
        let dir = tempdir().unwrap();
        let targets = vec!["192.168.1.1".to_string(), "10.0.0.0/30".to_string()];
        create_targets_db(dir.path(), &targets).await.unwrap();

        let pool = open_targets_db(dir.path()).await.unwrap();
        let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM targets")
            .fetch_one(&pool)
            .await
            .unwrap();
        // 192.168.1.1 (1) + 10.0.0.0/30 network addresses (4 IPs)
        assert!(count.0 >= 1);

        reset_targets_db(dir.path()).await.unwrap();
        let pending: (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM targets WHERE status='pending'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(pending.0, count.0);
        pool.close().await;
    }

    #[tokio::test]
    async fn test_create_targets_db_single_ip() {
        let dir = tempdir().unwrap();
        create_targets_db(dir.path(), &["172.16.0.1".to_string()])
            .await
            .unwrap();
        let pool = open_targets_db(dir.path()).await.unwrap();
        let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM targets")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count.0, 1);
        pool.close().await;
    }

    #[tokio::test]
    async fn test_reset_nonexistent_db_is_ok() {
        let dir = tempdir().unwrap();
        // Should not error if db doesn't exist
        reset_targets_db(dir.path()).await.unwrap();
    }
}
