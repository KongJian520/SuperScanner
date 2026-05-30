use clap::Parser;
use once_cell::sync::Lazy;
use std::{env, path::PathBuf};

/// 全局根目录，由环境变量 SUPERSCANNER_HOMEDIR 控制，默认为用户目录下的 scanner-projects
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

/// 命令行参数解析，用于配置 gRPC 服务端的监听地址和 TLS 选项
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
