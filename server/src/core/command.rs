use crate::core::types::CommandSpec;
use crate::error::AppError;
use async_trait::async_trait;
use std::path::PathBuf;
use std::sync::Arc;
use std::collections::HashMap;
use sqlx::sqlite::SqlitePool;
use tokio::fs;
use regex::Regex;

/// 扫描命令接口
#[async_trait]
pub trait ScannerCommand: Send + Sync {
    fn id(&self) -> &'static str;
    fn description(&self) -> &'static str;
    fn build_spec(&self, targets: &[String], args: &[String]) -> CommandSpec;
    /// 处理命令执行结果，例如解析日志并更新数据库
    async fn process_result(&self, task_dir: &PathBuf) -> Result<(), AppError>;
    fn box_clone(&self) -> Box<dyn ScannerCommand>;
}

impl Clone for Box<dyn ScannerCommand> {
    fn clone(&self) -> Box<dyn ScannerCommand> {
        self.box_clone()
    }
}

pub struct PingCommand;

#[async_trait]
impl ScannerCommand for PingCommand {
    fn id(&self) -> &'static str { "ping" }
    
    fn description(&self) -> &'static str { "ICMP Ping 连通性测试" }
    
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
        
        // Ping 仅支持单个目标，取第一个
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

    async fn process_result(&self, task_dir: &PathBuf) -> Result<(), AppError> {
        let log_path = task_dir.join("commands").join("ping").join("stdout.log");
        if !log_path.exists() {
            return Ok(());
        }

        let content = fs::read_to_string(&log_path).await
            .map_err(|e| AppError::Storage(format!("无法读取 Ping 日志: {}", e)))?;

        // 简单的 Ping 成功判断逻辑 (Windows/Linux 通用尝试)
        // Windows: "Reply from ..." or "来自 ... 的回复"
        // Linux: "bytes from ..."
        let success_regex = Regex::new(r"(Reply from|bytes from|来自)").unwrap();
        
        if success_regex.is_match(&content) {
            // 连接数据库更新状态
            let db_path = task_dir.join("targets.db");
            let db_url = format!("sqlite://{}", db_path.to_string_lossy());
            
            let pool = SqlitePool::connect(&db_url).await
                .map_err(|e| AppError::Storage(format!("无法连接任务数据库: {}", e)))?;

            // 假设我们只 Ping 了一个目标，这里简单处理，将所有 pending 的都标记为 alive
            // 实际应该解析 IP
            sqlx::query("UPDATE targets SET status = 'alive' WHERE status = 'pending'")
                .execute(&pool)
                .await
                .map_err(|e| AppError::Storage(format!("更新数据库失败: {}", e)))?;
                
            pool.close().await;
        }

        Ok(())
    }

    fn box_clone(&self) -> Box<dyn ScannerCommand> {
        Box::new(PingCommand)
    }
}

pub struct CurlCommand;

#[async_trait]
impl ScannerCommand for CurlCommand {
    fn id(&self) -> &'static str { "curl" }
    
    fn description(&self) -> &'static str { "HTTP 请求测试" }
    
    fn build_spec(&self, targets: &[String], user_args: &[String]) -> CommandSpec {
        let program = PathBuf::from("curl");
        let mut args = vec!["-I".to_string()]; // Head request
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

    async fn process_result(&self, _task_dir: &PathBuf) -> Result<(), AppError> {
        // Curl 结果处理逻辑 (暂空)
        Ok(())
    }

    fn box_clone(&self) -> Box<dyn ScannerCommand> {
        Box::new(CurlCommand)
    }
}

#[derive(Clone)]
pub struct CommandRegistry {
    commands: Arc<HashMap<String, Box<dyn ScannerCommand>>>,
}

impl CommandRegistry {
    pub fn new() -> Self {
        Self {
            commands: Arc::new(HashMap::new()),
        }
    }
    
    pub fn register<C: ScannerCommand + 'static>(mut self, cmd: C) -> Self {
        let mut map = Arc::try_unwrap(self.commands).unwrap_or_else(|arc| (*arc).clone());
        map.insert(cmd.id().to_string(), Box::new(cmd));
        self.commands = Arc::new(map);
        self
    }
    
    pub fn get(&self, id: &str) -> Option<&dyn ScannerCommand> {
        self.commands.get(id).map(|b| b.as_ref())
    }
    
    pub fn list_commands(&self) -> Vec<(&str, &str)> {
        self.commands.values().map(|c| (c.id(), c.description())).collect()
    }
}
