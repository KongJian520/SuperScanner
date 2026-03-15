use super::ScannerCommand;
use crate::domain::types::CommandSpec;
use crate::error::AppError;
use async_trait::async_trait;
use sqlx::sqlite::SqlitePool;
use std::path::PathBuf;
use std::time::Duration;
use tokio::net::TcpStream;

pub struct BuiltinPortScanCommand;

#[async_trait]
impl ScannerCommand for BuiltinPortScanCommand {
    fn id(&self) -> &'static str {
        "builtin_port_scan"
    }

    fn description(&self) -> &'static str {
        "Builtin TCP Port Scanner"
    }

    fn build_spec(&self, targets: &[String], args: &[String]) -> CommandSpec {
        CommandSpec {
            id: "builtin_port_scan".to_string(),
            program: PathBuf::from("builtin_port_scan"),
            args: args.to_vec(),
            targets: targets.to_vec(),
            env: None,
            cwd: None,
        }
    }

    async fn init_db(&self, pool: &SqlitePool) -> Result<(), AppError> {
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS port_results (
                ip TEXT,
                port INTEGER,
                protocol TEXT,
                state TEXT,
                service TEXT,
                tool TEXT,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (ip, port, protocol)
            )",
        )
        .execute(pool)
        .await
        .map_err(|e| AppError::Storage(format!("无法创建 port_results 表: {}", e)))?;
        Ok(())
    }

    async fn execute_target(
        &self,
        target: &str,
        _task_dir: &PathBuf,
        pool: &SqlitePool,
    ) -> Result<(), AppError> {
        let top_ports = vec![21, 22, 23, 25, 53, 80, 110, 143, 443, 445, 3306, 3389, 8080];
        for port in top_ports {
            let addr = format!("{}:{}", target, port);
            let is_open = tokio::time::timeout(Duration::from_millis(500), TcpStream::connect(&addr))
                .await
                .map(|r| r.is_ok())
                .unwrap_or(false);

            if is_open {
                sqlx::query("INSERT OR REPLACE INTO port_results (ip, port, protocol, state, service, tool) VALUES (?, ?, ?, ?, ?, ?)")
                    .bind(target)
                    .bind(port as i32)
                    .bind("tcp")
                    .bind("open")
                    .bind("unknown")
                    .bind("builtin")
                    .execute(pool)
                    .await
                    .map_err(|e| AppError::Storage(format!("保存端口结果失败: {}", e)))?;
            }
        }
        Ok(())
    }

    async fn process_result(&self, _task_dir: &PathBuf) -> Result<(), AppError> {
        Ok(())
    }

    fn box_clone(&self) -> Box<dyn ScannerCommand> {
        Box::new(BuiltinPortScanCommand)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_id_and_description() {
        let cmd = BuiltinPortScanCommand;
        assert_eq!(cmd.id(), "builtin_port_scan");
        assert!(!cmd.description().is_empty());
    }

    #[test]
    fn test_build_spec() {
        let cmd = BuiltinPortScanCommand;
        let targets = vec!["192.168.1.1".to_string()];
        let spec = cmd.build_spec(&targets, &[]);
        assert_eq!(spec.id, "builtin_port_scan");
        assert_eq!(spec.targets, targets);
    }
}
