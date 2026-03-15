use clap::Parser;
use once_cell::sync::Lazy;
use std::{env, path::PathBuf};

// 全局根目录，由环境变量 SUPERSCANNER_HOMEDIR 控制，默认为当前目录/home 下的 scanner-projects
pub static ROOT_DIR: Lazy<PathBuf> = Lazy::new(|| {
    let base = if let Ok(env_dir) = env::var("SUPERSCANNER_HOMEDIR") {
        PathBuf::from(env_dir)
    } else {
        #[cfg(target_os = "windows")]
        {
            env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
        }
        #[cfg(not(target_os = "windows"))]
        {
            dirs_next::home_dir().unwrap_or_else(|| PathBuf::from("."))
        }
    };
    base.join("scanner-projects")
});

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
    pub certs_dir: PathBuf,
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
            certs_dir: ROOT_DIR.join("crts"),
            tasks_dir: ROOT_DIR.join("tasks"),
        }
    }
}
