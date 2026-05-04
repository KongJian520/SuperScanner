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

/// 一行 findings 记录
pub struct FindingRow {
    pub id: i64,
    pub dedupe_key: String,
    pub finding_type: String,
    pub severity: String,
    pub title: String,
    pub detail: String,
    pub ip: String,
    pub port: i64,
    pub protocol: String,
    pub source_tool: String,
    pub source_command: String,
    pub metadata_json: String,
    pub occurrences: i64,
    pub first_seen_at: String,
    pub last_seen_at: String,
    pub updated_at: String,
}

/// 插入 findings 时的输入模型
pub struct NewFinding {
    pub dedupe_key: Option<String>,
    pub finding_type: String,
    pub severity: String,
    pub title: String,
    pub detail: Option<String>,
    pub ip: Option<String>,
    pub port: Option<i64>,
    pub protocol: Option<String>,
    pub source_tool: Option<String>,
    pub source_command: Option<String>,
    pub metadata_json: Option<String>,
}

fn normalize_key_part(value: &str) -> String {
    value.trim().to_lowercase()
}

/// 生成 findings 去重键（命令侧也可自行提供 dedupe_key 覆盖）
pub fn build_finding_dedupe_key(finding: &NewFinding) -> String {
    let ip = finding.ip.as_deref().unwrap_or("*");
    let port = finding.port.unwrap_or(-1);
    let protocol = finding.protocol.as_deref().unwrap_or("*");
    let source_tool = finding.source_tool.as_deref().unwrap_or("*");

    format!(
        "{}|{}|{}|{}|{}|{}",
        normalize_key_part(&finding.finding_type),
        normalize_key_part(ip),
        port,
        normalize_key_part(protocol),
        normalize_key_part(&finding.title),
        normalize_key_part(source_tool),
    )
}

/// 初始化 findings 表
pub async fn ensure_findings_table(pool: &SqlitePool) -> Result<(), AppError> {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS findings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            dedupe_key TEXT NOT NULL UNIQUE,
            finding_type TEXT NOT NULL,
            severity TEXT NOT NULL,
            title TEXT NOT NULL,
            detail TEXT,
            ip TEXT,
            port INTEGER,
            protocol TEXT,
            source_tool TEXT,
            source_command TEXT,
            metadata_json TEXT,
            occurrences INTEGER NOT NULL DEFAULT 1,
            first_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )",
    )
    .execute(pool)
    .await
    .map_err(|e| AppError::Storage(format!("无法创建 findings 表: {}", e)))?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_findings_ip_port ON findings(ip, port)")
        .execute(pool)
        .await
        .map_err(|e| {
            AppError::Storage(format!(
                "无法创建 findings 索引 idx_findings_ip_port: {}",
                e
            ))
        })?;
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_findings_severity ON findings(severity)")
        .execute(pool)
        .await
        .map_err(|e| {
            AppError::Storage(format!(
                "无法创建 findings 索引 idx_findings_severity: {}",
                e
            ))
        })?;
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_findings_type ON findings(finding_type)")
        .execute(pool)
        .await
        .map_err(|e| {
            AppError::Storage(format!("无法创建 findings 索引 idx_findings_type: {}", e))
        })?;

    Ok(())
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

    ensure_findings_table(&pool).await?;

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

/// 插入 findings 记录；若命中 dedupe_key 则更新并累加 occurrences
pub async fn insert_or_update_finding(
    pool: &SqlitePool,
    finding: &NewFinding,
) -> Result<(), AppError> {
    let dedupe_key = finding
        .dedupe_key
        .clone()
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| build_finding_dedupe_key(finding));

    sqlx::query(
        "INSERT INTO findings (
            dedupe_key, finding_type, severity, title, detail, ip, port, protocol, source_tool, source_command, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(dedupe_key) DO UPDATE SET
            finding_type = excluded.finding_type,
            severity = excluded.severity,
            title = excluded.title,
            detail = excluded.detail,
            ip = excluded.ip,
            port = excluded.port,
            protocol = excluded.protocol,
            source_tool = excluded.source_tool,
            source_command = excluded.source_command,
            metadata_json = excluded.metadata_json,
            occurrences = findings.occurrences + 1,
            last_seen_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP",
    )
    .bind(dedupe_key)
    .bind(&finding.finding_type)
    .bind(&finding.severity)
    .bind(&finding.title)
    .bind(&finding.detail)
    .bind(&finding.ip)
    .bind(finding.port)
    .bind(&finding.protocol)
    .bind(&finding.source_tool)
    .bind(&finding.source_command)
    .bind(&finding.metadata_json)
    .execute(pool)
    .await
    .map_err(|e| AppError::Storage(format!("写入 findings 失败: {}", e)))?;

    Ok(())
}

/// 查询所有 findings（按最近更新时间倒序）
pub async fn query_findings(pool: &SqlitePool) -> Result<Vec<FindingRow>, AppError> {
    let rows = sqlx::query(
        "SELECT
            id, dedupe_key, finding_type, severity, title,
            IFNULL(detail, '') AS detail,
            IFNULL(ip, '') AS ip,
            IFNULL(port, 0) AS port,
            IFNULL(protocol, '') AS protocol,
            IFNULL(source_tool, '') AS source_tool,
            IFNULL(source_command, '') AS source_command,
            IFNULL(metadata_json, '') AS metadata_json,
            occurrences,
            CAST(first_seen_at AS TEXT) AS first_seen_at,
            CAST(last_seen_at AS TEXT) AS last_seen_at,
            CAST(updated_at AS TEXT) AS updated_at
        FROM findings
        ORDER BY updated_at DESC, id DESC",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Storage(format!("查询 findings 失败: {}", e)))?;

    let mut result = Vec::new();
    for row in rows {
        use sqlx::Row;
        let port: i64 = row.try_get("port").unwrap_or(0);
        result.push(FindingRow {
            id: row.try_get("id").unwrap_or(0),
            dedupe_key: row.try_get("dedupe_key").unwrap_or_default(),
            finding_type: row.try_get("finding_type").unwrap_or_default(),
            severity: row.try_get("severity").unwrap_or_default(),
            title: row.try_get("title").unwrap_or_default(),
            detail: row.try_get("detail").unwrap_or_default(),
            ip: row.try_get("ip").unwrap_or_default(),
            port,
            protocol: row.try_get("protocol").unwrap_or_default(),
            source_tool: row.try_get("source_tool").unwrap_or_default(),
            source_command: row.try_get("source_command").unwrap_or_default(),
            metadata_json: row.try_get("metadata_json").unwrap_or_default(),
            occurrences: row.try_get("occurrences").unwrap_or(1),
            first_seen_at: row.try_get("first_seen_at").unwrap_or_default(),
            last_seen_at: row.try_get("last_seen_at").unwrap_or_default(),
            updated_at: row.try_get("updated_at").unwrap_or_default(),
        });
    }
    Ok(result)
}

/// 查询指定 IP 的 findings（按最近更新时间倒序）
pub async fn query_findings_by_ip(
    pool: &SqlitePool,
    ip: &str,
) -> Result<Vec<FindingRow>, AppError> {
    let rows = sqlx::query(
        "SELECT
            id, dedupe_key, finding_type, severity, title,
            IFNULL(detail, '') AS detail,
            IFNULL(ip, '') AS ip,
            IFNULL(port, 0) AS port,
            IFNULL(protocol, '') AS protocol,
            IFNULL(source_tool, '') AS source_tool,
            IFNULL(source_command, '') AS source_command,
            IFNULL(metadata_json, '') AS metadata_json,
            occurrences,
            CAST(first_seen_at AS TEXT) AS first_seen_at,
            CAST(last_seen_at AS TEXT) AS last_seen_at,
            CAST(updated_at AS TEXT) AS updated_at
        FROM findings
        WHERE ip = ?
        ORDER BY updated_at DESC, id DESC",
    )
    .bind(ip)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Storage(format!("按 IP 查询 findings 失败: {}", e)))?;

    let mut result = Vec::new();
    for row in rows {
        use sqlx::Row;
        let port: i64 = row.try_get("port").unwrap_or(0);
        result.push(FindingRow {
            id: row.try_get("id").unwrap_or(0),
            dedupe_key: row.try_get("dedupe_key").unwrap_or_default(),
            finding_type: row.try_get("finding_type").unwrap_or_default(),
            severity: row.try_get("severity").unwrap_or_default(),
            title: row.try_get("title").unwrap_or_default(),
            detail: row.try_get("detail").unwrap_or_default(),
            ip: row.try_get("ip").unwrap_or_default(),
            port,
            protocol: row.try_get("protocol").unwrap_or_default(),
            source_tool: row.try_get("source_tool").unwrap_or_default(),
            source_command: row.try_get("source_command").unwrap_or_default(),
            metadata_json: row.try_get("metadata_json").unwrap_or_default(),
            occurrences: row.try_get("occurrences").unwrap_or(1),
            first_seen_at: row.try_get("first_seen_at").unwrap_or_default(),
            last_seen_at: row.try_get("last_seen_at").unwrap_or_default(),
            updated_at: row.try_get("updated_at").unwrap_or_default(),
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
        let pending: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM targets WHERE status='pending'")
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

    #[tokio::test]
    async fn test_findings_table_created_with_targets_db() {
        let dir = tempdir().unwrap();
        create_targets_db(dir.path(), &["192.168.1.10".to_string()])
            .await
            .unwrap();
        let pool = open_targets_db(dir.path()).await.unwrap();

        let findings_exists: (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'findings'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(findings_exists.0, 1);
        pool.close().await;
    }

    #[tokio::test]
    async fn test_insert_or_update_finding_dedupes() {
        let dir = tempdir().unwrap();
        create_targets_db(dir.path(), &["10.0.0.1".to_string()])
            .await
            .unwrap();
        let pool = open_targets_db(dir.path()).await.unwrap();

        let finding = NewFinding {
            dedupe_key: None,
            finding_type: "open_port".to_string(),
            severity: "medium".to_string(),
            title: "SSH open".to_string(),
            detail: Some("22/tcp open".to_string()),
            ip: Some("10.0.0.1".to_string()),
            port: Some(22),
            protocol: Some("tcp".to_string()),
            source_tool: Some("nmap".to_string()),
            source_command: Some("nmap -sV".to_string()),
            metadata_json: Some("{\"service\":\"ssh\"}".to_string()),
        };

        insert_or_update_finding(&pool, &finding).await.unwrap();
        insert_or_update_finding(&pool, &finding).await.unwrap();

        let findings = query_findings(&pool).await.unwrap();
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].occurrences, 2);
        assert_eq!(findings[0].ip, "10.0.0.1");
        assert_eq!(findings[0].port, 22);

        let by_ip = query_findings_by_ip(&pool, "10.0.0.1").await.unwrap();
        assert_eq!(by_ip.len(), 1);
        assert_eq!(by_ip[0].title, "SSH open");

        pool.close().await;
    }

    #[tokio::test]
    async fn test_insert_or_update_finding_with_custom_dedupe_key() {
        let dir = tempdir().unwrap();
        create_targets_db(dir.path(), &["10.10.10.10".to_string()])
            .await
            .unwrap();
        let pool = open_targets_db(dir.path()).await.unwrap();

        let f1 = NewFinding {
            dedupe_key: Some("custom-key-1".to_string()),
            finding_type: "banner".to_string(),
            severity: "info".to_string(),
            title: "Service banner".to_string(),
            detail: Some("first".to_string()),
            ip: Some("10.10.10.10".to_string()),
            port: Some(80),
            protocol: Some("tcp".to_string()),
            source_tool: Some("httpx".to_string()),
            source_command: Some("httpx -json".to_string()),
            metadata_json: None,
        };
        let f2 = NewFinding {
            dedupe_key: Some("custom-key-1".to_string()),
            finding_type: "banner".to_string(),
            severity: "info".to_string(),
            title: "Service banner".to_string(),
            detail: Some("second".to_string()),
            ip: Some("10.10.10.10".to_string()),
            port: Some(80),
            protocol: Some("tcp".to_string()),
            source_tool: Some("httpx".to_string()),
            source_command: Some("httpx -json".to_string()),
            metadata_json: None,
        };

        insert_or_update_finding(&pool, &f1).await.unwrap();
        insert_or_update_finding(&pool, &f2).await.unwrap();

        let rows = query_findings(&pool).await.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].occurrences, 2);
        assert_eq!(rows[0].detail, "second");
        pool.close().await;
    }

    #[test]
    fn test_build_finding_dedupe_key_normalizes_case_and_space() {
        let a = NewFinding {
            dedupe_key: None,
            finding_type: " Open_Port ".to_string(),
            severity: "info".to_string(),
            title: " SSH Open ".to_string(),
            detail: None,
            ip: Some("10.0.0.1".to_string()),
            port: Some(22),
            protocol: Some("TCP".to_string()),
            source_tool: Some("NMAP".to_string()),
            source_command: None,
            metadata_json: None,
        };
        let b = NewFinding {
            dedupe_key: None,
            finding_type: "open_port".to_string(),
            severity: "info".to_string(),
            title: "ssh open".to_string(),
            detail: None,
            ip: Some("10.0.0.1".to_string()),
            port: Some(22),
            protocol: Some("tcp".to_string()),
            source_tool: Some("nmap".to_string()),
            source_command: None,
            metadata_json: None,
        };
        assert_eq!(build_finding_dedupe_key(&a), build_finding_dedupe_key(&b));
    }
}
