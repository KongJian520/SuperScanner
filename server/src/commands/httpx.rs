use super::ScannerCommand;
use crate::domain::types::CommandSpec;
use crate::error::AppError;
use async_trait::async_trait;
use sqlx::sqlite::SqlitePool;
use std::path::PathBuf;

pub struct HttpxCommand;

#[async_trait]
impl ScannerCommand for HttpxCommand {
    fn id(&self) -> &'static str {
        "httpx"
    }

    fn description(&self) -> &'static str {
        "HTTPX Fingerprint Scanner"
    }

    fn build_spec(&self, targets: &[String], args: &[String]) -> CommandSpec {
        CommandSpec {
            id: "httpx".to_string(),
            program: PathBuf::from("httpx"),
            args: args.to_vec(),
            targets: targets.to_vec(),
            env: None,
            cwd: None,
        }
    }

    async fn init_db(&self, _pool: &SqlitePool) -> Result<(), AppError> {
        Ok(())
    }

    async fn execute_target(
        &self,
        _target: &str,
        _task_dir: &PathBuf,
        _pool: &SqlitePool,
    ) -> Result<(), AppError> {
        Ok(())
    }

    async fn process_result(&self, _task_dir: &PathBuf) -> Result<(), AppError> {
        Ok(())
    }

    fn box_clone(&self) -> Box<dyn ScannerCommand> {
        Box::new(HttpxCommand)
    }
}
