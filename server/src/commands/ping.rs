use super::ScannerCommand;
use crate::domain::types::CommandSpec;
use crate::error::AppError;
use async_trait::async_trait;
use sqlx::sqlite::SqlitePool;
use std::path::PathBuf;
use std::process::Stdio;
use tokio::process::Command;

pub struct PingCommand;

#[async_trait]
impl ScannerCommand for PingCommand {
    fn id(&self) -> &'static str {
        "ping"
    }

    fn description(&self) -> &'static str {
        "ICMP Ping 连通性测试"
    }

    fn build_spec(&self, targets: &[String], user_args: &[String]) -> CommandSpec {
        let program = PathBuf::from("ping");
        let mut args = Vec::new();
        if cfg!(target_os = "windows") {
            args.push("-n".to_string());
            args.push("4".to_string());
        } else {
            args.push("-c".to_string());
            args.push("4".to_string());
        }
        args.extend_from_slice(user_args);
        let target_args = if let Some(first) = targets.first() {
            vec![first.clone()]
        } else {
            vec![]
        };
        CommandSpec {
            id: "ping".to_string(),
            program,
            args,
            targets: target_args,
            env: None,
            cwd: None,
        }
    }

    async fn init_db(&self, pool: &SqlitePool) -> Result<(), AppError> {
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS ping_results (
                ip TEXT PRIMARY KEY,
                is_alive BOOLEAN,
                latency_ms REAL,
                output TEXT,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )",
        )
        .execute(pool)
        .await
        .map_err(|e| AppError::Storage(format!("无法创建 ping_results 表: {}", e)))?;
        Ok(())
    }

    async fn execute_target(
        &self,
        target: &str,
        _task_dir: &PathBuf,
        pool: &SqlitePool,
    ) -> Result<(), AppError> {
        let mut cmd = if cfg!(target_os = "windows") {
            let mut c = Command::new("ping");
            c.args(&["-n", "1", "-w", "1000", target]);
            c
        } else {
            let mut c = Command::new("ping");
            c.args(&["-c", "1", "-W", "1", target]);
            c
        };

        cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
        let output = cmd.output().await.map_err(AppError::Io)?;
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let is_success = output.status.success();
        let latency = 0.0f64;

        sqlx::query("INSERT OR REPLACE INTO ping_results (ip, is_alive, latency_ms, output) VALUES (?, ?, ?, ?)")
            .bind(target)
            .bind(is_success)
            .bind(latency)
            .bind(&stdout)
            .execute(pool)
            .await
            .map_err(|e| AppError::Storage(format!("保存 Ping 结果失败: {}", e)))?;

        Ok(())
    }

    async fn process_result(&self, _task_dir: &PathBuf) -> Result<(), AppError> {
        Ok(())
    }

    fn box_clone(&self) -> Box<dyn ScannerCommand> {
        Box::new(PingCommand)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_id_and_description() {
        let cmd = PingCommand;
        assert_eq!(cmd.id(), "ping");
        assert!(!cmd.description().is_empty());
    }

    #[test]
    fn test_build_spec_returns_correct_program() {
        let cmd = PingCommand;
        let spec = cmd.build_spec(&["192.168.1.1".to_string()], &[]);
        assert!(!spec.program.as_os_str().is_empty());
        assert_eq!(spec.id, "ping");
    }

    #[test]
    fn test_build_spec_empty_targets() {
        let cmd = PingCommand;
        let spec = cmd.build_spec(&[], &[]);
        assert!(spec.targets.is_empty());
    }
}
