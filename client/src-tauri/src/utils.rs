pub mod config;
pub mod convert;
pub mod dto;
pub mod grpc;
pub mod logging;
use once_cell::sync::Lazy;
use std::{env, path::PathBuf};

/// 全局根目录，由环境变量 SUPERSCANNER_HOMEDIR 控制，默认路径为 home/scanner-projects
pub static ROOT_DIR: Lazy<PathBuf> = Lazy::new(|| {
    let base = if let Ok(env_dir) = env::var("SUPERSCANNER_HOMEDIR") {
        PathBuf::from(env_dir)
    } else {
        #[cfg(target_os = "android")]
        {
            env::temp_dir()
        }
        #[cfg(target_os = "windows")]
        {
            env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
        }
        #[cfg(all(not(target_os = "windows"), not(target_os = "android")))]
        {
            dirs::home_dir().unwrap_or_else(|| PathBuf::from("."))
        }
    };
    base.join("scanner-projects")
});
