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
    /// 返回命令的唯一标识符
    fn id(&self) -> &'static str;
    /// 返回命令的描述信息
    fn description(&self) -> &'static str;
    /// 根据目标和参数构建命令规范
    fn build_spec(&self, targets: &[String], args: &[String]) -> CommandSpec;
    /// 初始化命令所需的数据库表结构
    async fn init_db(&self, pool: &SqlitePool) -> Result<(), AppError>;
    /// 对单个目标执行扫描命令
    async fn execute_target(
        &self,
        target: &str,
        task_dir: &PathBuf,
        pool: &SqlitePool,
    ) -> Result<(), AppError>;
    /// 处理命令执行结果（解析输出、入库等）
    async fn process_result(&self, task_dir: &PathBuf) -> Result<(), AppError>;
    /// 克隆命令实例（用于 Box<dyn ScannerCommand> 克隆）
    fn box_clone(&self) -> Box<dyn ScannerCommand>;
}

impl Clone for Box<dyn ScannerCommand> {
    fn clone(&self) -> Box<dyn ScannerCommand> {
        self.box_clone()
    }
}

/// 命令工厂类型：每次调用返回一个新的命令实例（支持带配置的命令）
pub type CommandFactory = Box<dyn Fn() -> Box<dyn ScannerCommand> + Send + Sync>;

/// 命令注册条目：直接实例或工厂函数
enum RegistryEntry {
    /// 直接持有的命令实例
    Instance(Box<dyn ScannerCommand>),
    /// 工厂函数，每次调用返回新实例
    Factory(CommandFactory),
}

impl RegistryEntry {
    /// 获取命令实例（工厂模式则创建新实例）
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

/// 命令注册中心，管理所有可用的扫描命令
#[derive(Clone)]
pub struct CommandRegistry {
    commands: Arc<HashMap<String, Arc<RegistryEntry>>>,
}

impl CommandRegistry {
    /// 创建空的命令注册中心
    pub fn new() -> Self {
        Self {
            commands: Arc::new(HashMap::new()),
        }
    }

    /// 注册命令实例（便利方法，内部转换为工厂）
    pub fn register<C: ScannerCommand + 'static>(mut self, cmd: C) -> Self {
        let mut map = Arc::try_unwrap(self.commands).unwrap_or_else(|arc| (*arc).clone());
        let id = cmd.id().to_string();
        map.insert(id, Arc::new(RegistryEntry::Instance(Box::new(cmd))));
        self.commands = Arc::new(map);
        self
    }

    /// 注册工厂函数（支持带配置的命令，每次 get_instance 返回新实例）
    pub fn register_factory(mut self, id: &'static str, factory: CommandFactory) -> Self {
        let mut map = Arc::try_unwrap(self.commands).unwrap_or_else(|arc| (*arc).clone());
        map.insert(id.to_string(), Arc::new(RegistryEntry::Factory(factory)));
        self.commands = Arc::new(map);
        self
    }

    /// 获取命令引用（用于直接调用，返回克隆实例）
    pub fn get(&self, id: &str) -> Option<Box<dyn ScannerCommand>> {
        self.commands.get(id).map(|entry| entry.get_instance())
    }

    /// 列出所有已注册的命令（返回 ID 和描述的对列表）
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

pub mod curl;
pub mod fscan;
pub mod httpx;
pub mod nmap;
pub mod nuclei;
pub mod ping;
pub mod port_scan;
pub mod service_probes;

pub use fscan::FscanCommand;
pub use httpx::HttpxCommand;
pub use nmap::NmapCommand;
pub use nuclei::NucleiCommand;
pub use ping::PingCommand;
pub use port_scan::BuiltinPortScanCommand;
