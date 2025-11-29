pub mod logging;
pub mod cli;
pub mod signal;

use std::{env, path::PathBuf};
use once_cell::sync::Lazy;


pub static ROOT_DIR: Lazy<PathBuf> = Lazy::new(|| {
    let base = if let Ok(env_dir) = env::var("SUPPERSCANNER_HOMEDIR") {
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