use super::ScannerCommand;
use crate::domain::types::CommandSpec;
use crate::error::AppError;
use async_trait::async_trait;
use sqlx::sqlite::SqlitePool;
use std::path::PathBuf;

#[allow(dead_code)]
pub struct CurlCommand;

#[async_trait]
impl ScannerCommand for CurlCommand {
    fn id(&self) -> &'static str {
        "curl"
    }

    fn description(&self) -> &'static str {
        "HTTP 请求测试"
    }

    fn build_spec(&self, targets: &[String], user_args: &[String]) -> CommandSpec {
        let program = PathBuf::from("curl");
        let mut args = vec!["-I".to_string()];
        args.extend_from_slice(user_args);
        let target_args = if let Some(first) = targets.first() {
            vec![first.clone()]
        } else {
            vec![]
        };
        CommandSpec {
            id: "curl".to_string(),
            program,
            args,
            targets: target_args,
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
        Box::new(CurlCommand)
    }
}
