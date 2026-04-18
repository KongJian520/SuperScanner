use super::ScannerCommand;
use crate::domain::types::CommandSpec;
use crate::error::AppError;
use async_trait::async_trait;
use sqlx::sqlite::SqlitePool;
use std::path::PathBuf;
use tokio::process::Command;
use tokio::time::{timeout, Duration};
use tracing::warn;

#[derive(Clone)]
pub struct NmapCommand {
    binary: String,
    default_args: Vec<String>,
    timeout_secs: u64,
}

impl NmapCommand {
    pub fn new(binary: String, default_args: Vec<String>, timeout_secs: u64) -> Self {
        Self {
            binary,
            default_args,
            timeout_secs,
        }
    }
}

#[async_trait]
impl ScannerCommand for NmapCommand {
    fn id(&self) -> &'static str {
        "nmap"
    }

    fn description(&self) -> &'static str {
        "Nmap Port Scanner"
    }

    fn build_spec(&self, targets: &[String], args: &[String]) -> CommandSpec {
        let mut merged_args = self.default_args.clone();
        merged_args.extend(args.to_vec());
        CommandSpec {
            id: "nmap".to_string(),
            program: PathBuf::from(&self.binary),
            args: merged_args,
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
        let mut cmd = Command::new(&self.binary);
        cmd.args(&self.default_args)
            .arg(target)
            .arg("-oG")
            .arg("-");

        let output = timeout(Duration::from_secs(self.timeout_secs), cmd.output())
            .await
            .map_err(|_| AppError::Task(format!("Nmap 扫描超时: {} ({}s)", target, self.timeout_secs)))?
            .map_err(|e| AppError::Task(format!("无法启动 Nmap: {}", e)))?;

        if !output.status.success() {
            let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(AppError::Task(format!("Nmap 扫描失败 [{}]: {}", target, err)));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines() {
            if !line.contains("Host:") || !line.contains("Ports:") {
                continue;
            }
            let Some((_, ports_part)) = line.split_once("Ports:") else {
                continue;
            };
            for entry in ports_part.split(',') {
                let fields: Vec<&str> = entry.trim().split('/').collect();
                if fields.len() < 5 {
                    continue;
                }
                let Ok(port) = fields[0].trim().parse::<i32>() else {
                    continue;
                };
                let state = fields[1].trim();
                let protocol = fields[2].trim();
                let service = fields[4].trim();
                if state.is_empty() || protocol.is_empty() {
                    continue;
                }
                let final_service = if service.is_empty() { "unknown" } else { service };
                if let Err(e) = sqlx::query("INSERT OR REPLACE INTO port_results (ip, port, protocol, state, service, tool) VALUES (?, ?, ?, ?, ?, ?)")
                    .bind(target)
                    .bind(port)
                    .bind(protocol)
                    .bind(state)
                    .bind(final_service)
                    .bind("nmap")
                    .execute(pool)
                    .await
                {
                    warn!("写入 nmap 结果失败: {}", e);
                }
            }
        }
        Ok(())
    }

    async fn process_result(&self, _task_dir: &PathBuf) -> Result<(), AppError> {
        Ok(())
    }

    fn box_clone(&self) -> Box<dyn ScannerCommand> {
        Box::new(self.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_id_and_description() {
        let cmd = NmapCommand::new("nmap".to_string(), vec![], 30);
        assert_eq!(cmd.id(), "nmap");
        assert!(!cmd.description().is_empty());
    }

    #[test]
    fn test_build_spec_returns_correct_program() {
        let cmd = NmapCommand::new("custom-nmap".to_string(), vec!["-Pn".to_string()], 30);
        let spec = cmd.build_spec(&["10.0.0.1".to_string()], &[]);
        assert_eq!(spec.program, PathBuf::from("custom-nmap"));
        assert_eq!(spec.id, "nmap");
        assert_eq!(spec.targets, vec!["10.0.0.1".to_string()]);
        assert_eq!(spec.args, vec!["-Pn".to_string()]);
    }
}
