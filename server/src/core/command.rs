use crate::core::types::CommandSpec;
use crate::error::AppError;
use async_trait::async_trait;
use std::path::PathBuf;
use std::sync::Arc;
use std::collections::HashMap;
use sqlx::sqlite::SqlitePool;
use tokio::process::Command;
use std::process::Stdio;

/// 扫描命令接口
#[async_trait]
pub trait ScannerCommand: Send + Sync {
    fn id(&self) -> &'static str;
    fn description(&self) -> &'static str;
    fn build_spec(&self, targets: &[String], args: &[String]) -> CommandSpec;
    
    /// 初始化命令所需的数据库表
    async fn init_db(&self, pool: &SqlitePool) -> Result<(), AppError>;
    
    /// 执行命令逻辑（如果返回 Some，则 Runner 使用此逻辑代替默认进程启动）
    /// 并发数由 Runner 控制，这里只定义单个目标的处理逻辑
    async fn execute_target(&self, target: &str, task_dir: &PathBuf, pool: &SqlitePool) -> Result<(), AppError>;

    /// 处理命令执行结果（旧模式保留，用于后处理）
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
        // 旧模式的 Spec 构建，保留以防万一
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
            )"
        )
        .execute(pool)
        .await
        .map_err(|e| AppError::Storage(format!("无法创建 ping_results 表: {}", e)))?;
        Ok(())
    }

    async fn execute_target(&self, target: &str, _task_dir: &PathBuf, pool: &SqlitePool) -> Result<(), AppError> {
        // 执行系统 Ping 命令
        let mut cmd = if cfg!(target_os = "windows") {
            let mut c = Command::new("ping");
            c.args(&["-n", "1", "-w", "1000", target]); // 1次，1秒超时
            c
        } else {
            let mut c = Command::new("ping");
            c.args(&["-c", "1", "-W", "1", target]);
            c
        };

        cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
        
        let output = cmd.output().await
            .map_err(|e| AppError::Io(e))?;
            
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let is_success = output.status.success();
        
        // 简单解析延迟 (仅示例，实际需更复杂正则)
        let latency = 0.0; 

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

pub struct CurlCommand;

#[async_trait]
impl ScannerCommand for CurlCommand {
    fn id(&self) -> &'static str { "curl" }
    
    fn description(&self) -> &'static str { "HTTP 请求测试" }
    
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

    async fn execute_target(&self, _target: &str, _task_dir: &PathBuf, _pool: &SqlitePool) -> Result<(), AppError> {
        Ok(())
    }

    async fn process_result(&self, _task_dir: &PathBuf) -> Result<(), AppError> {
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
