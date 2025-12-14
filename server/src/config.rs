use clap::Parser;
use std::path::PathBuf;
use crate::utils::ROOT_DIR;

#[derive(Parser, Debug)]
#[command(about = "SuperScanner gRPC 服务端", long_about = None)]
pub struct CliArgs {
    /// 监听 IP（默认: 127.0.0.1）
    #[arg(long, default_value = "127.0.0.1")]
    pub ip: String,

    /// 监听端口（默认: 50051）
    #[arg(long, default_value_t = 50051)]
    pub port: u16,

    /// 启用 TLS
    #[arg(long, default_value_t = false)]
    pub tls: bool,
}

#[derive(Debug, Clone)]
pub struct AppConfig {
    pub ip: String,
    pub port: u16,
    pub tls: bool,
    pub root_dir: PathBuf,
    pub db_path: PathBuf,
    pub certs_dir: PathBuf,
    #[allow(dead_code)]
    pub tasks_dir: PathBuf,
}

impl AppConfig {
    pub fn load() -> Self {
        let args = CliArgs::parse();
        Self {
            ip: args.ip,
            port: args.port,
            tls: args.tls,
            root_dir: ROOT_DIR.clone(),
            db_path: ROOT_DIR.join("tasks.db"),
            certs_dir: ROOT_DIR.join("crts"),
            tasks_dir: ROOT_DIR.join("tasks"),
        }
    }
}
