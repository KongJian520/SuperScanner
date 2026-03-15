use super::ScannerCommand;
use crate::domain::types::CommandSpec;
use crate::error::AppError;
use async_trait::async_trait;
use sqlx::sqlite::SqlitePool;
use std::path::PathBuf;

pub struct NmapCommand;

#[async_trait]
impl ScannerCommand for NmapCommand {
    fn id(&self) -> &'static str {
        "nmap"
    }

    fn description(&self) -> &'static str {
        "Nmap Port Scanner"
    }

    fn build_spec(&self, targets: &[String], args: &[String]) -> CommandSpec {
        CommandSpec {
            id: "nmap".to_string(),
            program: PathBuf::from("nmap"),
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
        // 模拟 Nmap 执行并写入结果 (实际应解析 XML/Grepable 输出)
        sqlx::query("INSERT OR REPLACE INTO port_results (ip, port, protocol, state, service, tool) VALUES (?, ?, ?, ?, ?, ?)")
            .bind(target)
            .bind(80i32)
            .bind("tcp")
            .bind("open")
            .bind("http")
            .bind("nmap")
            .execute(pool)
            .await
            .map_err(|e| AppError::Storage(format!("保存 Nmap 结果失败: {}", e)))?;
        Ok(())
    }

    async fn process_result(&self, _task_dir: &PathBuf) -> Result<(), AppError> {
        Ok(())
    }

    fn box_clone(&self) -> Box<dyn ScannerCommand> {
        Box::new(NmapCommand)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_id_and_description() {
        let cmd = NmapCommand;
        assert_eq!(cmd.id(), "nmap");
        assert!(!cmd.description().is_empty());
    }

    #[test]
    fn test_build_spec_returns_correct_program() {
        let cmd = NmapCommand;
        let spec = cmd.build_spec(&["10.0.0.1".to_string()], &[]);
        assert_eq!(spec.program, PathBuf::from("nmap"));
        assert_eq!(spec.id, "nmap");
        assert_eq!(spec.targets, vec!["10.0.0.1".to_string()]);
    }
}
