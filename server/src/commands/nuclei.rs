use super::ScannerCommand;
use crate::domain::types::CommandSpec;
use crate::error::AppError;
use async_trait::async_trait;
use sqlx::sqlite::SqlitePool;
use std::path::PathBuf;

pub struct NucleiCommand;

#[async_trait]
impl ScannerCommand for NucleiCommand {
    fn id(&self) -> &'static str {
        "nuclei"
    }

    fn description(&self) -> &'static str {
        "Nuclei POC Scanner"
    }

    fn build_spec(&self, targets: &[String], args: &[String]) -> CommandSpec {
        CommandSpec {
            id: "nuclei".to_string(),
            program: PathBuf::from("nuclei"),
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
        Box::new(NucleiCommand)
    }
}
