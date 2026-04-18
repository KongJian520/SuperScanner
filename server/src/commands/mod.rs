use crate::domain::types::CommandSpec;
use crate::error::AppError;
use async_trait::async_trait;
use sqlx::sqlite::SqlitePool;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

/// 扫描命令接口
#[async_trait]
pub trait ScannerCommand: Send + Sync {
    fn id(&self) -> &'static str;
    fn description(&self) -> &'static str;
    fn build_spec(&self, targets: &[String], args: &[String]) -> CommandSpec;
    async fn init_db(&self, pool: &SqlitePool) -> Result<(), AppError>;
    async fn execute_target(
        &self,
        target: &str,
        task_dir: &PathBuf,
        pool: &SqlitePool,
    ) -> Result<(), AppError>;
    async fn process_result(&self, task_dir: &PathBuf) -> Result<(), AppError>;
    fn box_clone(&self) -> Box<dyn ScannerCommand>;
}

impl Clone for Box<dyn ScannerCommand> {
    fn clone(&self) -> Box<dyn ScannerCommand> {
        self.box_clone()
    }
}

/// 命令工厂类型：每次调用返回一个新的命令实例（支持带配置的命令）
pub type CommandFactory = Box<dyn Fn() -> Box<dyn ScannerCommand> + Send + Sync>;

enum RegistryEntry {
    Instance(Box<dyn ScannerCommand>),
    Factory(CommandFactory),
}

impl RegistryEntry {
    fn get_instance(&self) -> Box<dyn ScannerCommand> {
        match self {
            RegistryEntry::Instance(cmd) => cmd.box_clone(),
            RegistryEntry::Factory(f) => f(),
        }
    }

    fn id(&self) -> &str {
        match self {
            RegistryEntry::Instance(cmd) => cmd.id(),
            RegistryEntry::Factory(f) => {
                // 临时构造一个实例以获取 id
                let instance = f();
                // 此处返回 &str 会有生命周期问题，因此工厂注册 id 由调用者提供
                // 不应直接调用此分支
                let _ = instance;
                ""
            }
        }
    }

    fn description(&self) -> &str {
        match self {
            RegistryEntry::Instance(cmd) => cmd.description(),
            RegistryEntry::Factory(_) => "factory-registered command",
        }
    }
}

#[derive(Clone)]
pub struct CommandRegistry {
    commands: Arc<HashMap<String, Arc<RegistryEntry>>>,
}

impl CommandRegistry {
    pub fn new() -> Self {
        Self {
            commands: Arc::new(HashMap::new()),
        }
    }

    /// 注册命令实例（便利方法，内部转换为工厂）
    pub fn register<C: ScannerCommand + 'static>(mut self, cmd: C) -> Self {
        let mut map = Arc::try_unwrap(self.commands)
            .unwrap_or_else(|arc| (*arc).clone());
        let id = cmd.id().to_string();
        map.insert(id, Arc::new(RegistryEntry::Instance(Box::new(cmd))));
        self.commands = Arc::new(map);
        self
    }

    /// 注册工厂函数（支持带配置的命令，每次 get_instance 返回新实例）
    pub fn register_factory(mut self, id: &'static str, factory: CommandFactory) -> Self {
        let mut map = Arc::try_unwrap(self.commands)
            .unwrap_or_else(|arc| (*arc).clone());
        map.insert(id.to_string(), Arc::new(RegistryEntry::Factory(factory)));
        self.commands = Arc::new(map);
        self
    }

    /// 获取命令引用（用于直接调用，返回克隆实例）
    pub fn get(&self, id: &str) -> Option<Box<dyn ScannerCommand>> {
        self.commands.get(id).map(|entry| entry.get_instance())
    }

    pub fn list_commands(&self) -> Vec<(&str, &str)> {
        self.commands
            .iter()
            .filter_map(|(id, entry)| {
                if let RegistryEntry::Instance(cmd) = entry.as_ref() {
                    Some((cmd.id(), cmd.description()))
                } else {
                    Some((id.as_str(), "factory-registered"))
                }
            })
            .collect()
    }
}

pub mod ping;
pub mod nmap;
pub mod port_scan;
pub mod service_probes;
pub mod curl;
pub mod httpx;
pub mod nuclei;

pub use ping::PingCommand;
pub use nmap::NmapCommand;
pub use port_scan::BuiltinPortScanCommand;
pub use httpx::HttpxCommand;
pub use nuclei::NucleiCommand;
