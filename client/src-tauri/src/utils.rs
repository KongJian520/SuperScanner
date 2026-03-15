pub mod grpc;
pub mod config;
pub mod dto;
pub mod convert;
pub mod logging;
use once_cell::sync::Lazy;
use std::{env, path::PathBuf};

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
            dirs::home_dir().unwrap_or_else(|| PathBuf::from("."))
        }
    };
    base.join("scanner-projects")
});
