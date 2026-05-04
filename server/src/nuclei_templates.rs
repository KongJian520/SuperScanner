use crate::config::NucleiTemplatesConfig;
use crate::error::AppError;
use chrono::Utc;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::process::Command;
use tokio::sync::RwLock;

#[derive(Debug, Clone)]
pub struct NucleiTemplatesStatus {
    pub source: String,
    pub configured_local_path: String,
    pub effective_path: String,
    pub repo_url: String,
    pub cache_path: String,
    pub last_sync_unix: i64,
    pub last_error: String,
    pub sync_supported: bool,
}

#[derive(Debug, Clone)]
struct NucleiTemplatesState {
    local_path: Option<String>,
    cache_path: String,
    repo_url: String,
    last_sync_unix: i64,
    last_error: Option<String>,
}

#[derive(Clone)]
pub struct NucleiTemplatesManager {
    state: Arc<RwLock<NucleiTemplatesState>>,
}

impl NucleiTemplatesManager {
    pub fn new(config: NucleiTemplatesConfig) -> Self {
        Self {
            state: Arc::new(RwLock::new(NucleiTemplatesState {
                local_path: config.local_path,
                cache_path: config.cache_path,
                repo_url: config.repo_url,
                last_sync_unix: 0,
                last_error: None,
            })),
        }
    }

    pub async fn effective_template_dir(&self) -> Option<String> {
        let status = self.status().await;
        if status.effective_path.is_empty() {
            None
        } else {
            Some(status.effective_path)
        }
    }

    pub async fn status(&self) -> NucleiTemplatesStatus {
        let state = self.state.read().await.clone();
        let local = state.local_path.clone().filter(|p| is_existing_dir(p));
        let cache = if is_existing_dir(&state.cache_path) {
            Some(state.cache_path.clone())
        } else {
            None
        };
        let (source, effective) = if let Some(path) = local.clone() {
            ("local".to_string(), path)
        } else if let Some(path) = cache {
            ("cache".to_string(), path)
        } else {
            ("none".to_string(), String::new())
        };

        NucleiTemplatesStatus {
            source,
            configured_local_path: state.local_path.unwrap_or_default(),
            effective_path: effective,
            repo_url: state.repo_url,
            cache_path: state.cache_path,
            last_sync_unix: state.last_sync_unix,
            last_error: state.last_error.unwrap_or_default(),
            sync_supported: true,
        }
    }

    pub async fn sync_now(
        &self,
        local_path: Option<String>,
        repo_url: Option<String>,
        clear_local_path: bool,
    ) -> Result<NucleiTemplatesStatus, AppError> {
        {
            let mut state = self.state.write().await;
            if clear_local_path {
                state.local_path = None;
            } else if let Some(local) = local_path.and_then(trimmed_non_empty) {
                state.local_path = Some(local);
            }
            if let Some(repo) = repo_url.and_then(trimmed_non_empty) {
                state.repo_url = repo;
            }
        }

        {
            let state = self.state.read().await;
            if let Some(local) = state.local_path.as_ref() {
                if is_existing_dir(local) {
                    drop(state);
                    let mut writable = self.state.write().await;
                    writable.last_error = None;
                    drop(writable);
                    return Ok(self.status().await);
                }
            }
        }

        let (repo, cache_path) = {
            let state = self.state.read().await;
            (state.repo_url.clone(), state.cache_path.clone())
        };

        let git_check = Command::new("git")
            .arg("--version")
            .output()
            .await
            .map_err(|e| AppError::Task(format!("git 不可用，无法同步 nuclei templates: {}", e)))?;
        if !git_check.status.success() {
            return Err(AppError::Task(
                "git 不可用，无法同步 nuclei templates".to_string(),
            ));
        }

        let sync_result = sync_repo(&repo, &cache_path).await;
        let mut state = self.state.write().await;
        match sync_result {
            Ok(_) => {
                state.last_sync_unix = Utc::now().timestamp();
                state.last_error = None;
            }
            Err(err) => {
                state.last_error = Some(err.clone());
                return Err(AppError::Task(err));
            }
        }
        drop(state);

        Ok(self.status().await)
    }
}

fn is_existing_dir(path: &str) -> bool {
    let p = Path::new(path);
    p.is_dir()
}

fn trimmed_non_empty(raw: String) -> Option<String> {
    let trimmed = raw.trim().to_string();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

async fn sync_repo(repo_url: &str, cache_path: &str) -> Result<(), String> {
    let cache = PathBuf::from(cache_path);
    if let Some(parent) = cache.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("创建缓存目录失败 {}: {}", parent.display(), e))?;
    }

    let is_git_repo = cache.join(".git").is_dir();
    let output = if is_git_repo {
        Command::new("git")
            .arg("-C")
            .arg(cache_path)
            .arg("pull")
            .arg("--ff-only")
            .output()
            .await
            .map_err(|e| format!("执行 git pull 失败: {}", e))?
    } else {
        if cache.exists() {
            tokio::fs::remove_dir_all(&cache)
                .await
                .map_err(|e| format!("清理旧缓存目录失败 {}: {}", cache.display(), e))?;
        }
        Command::new("git")
            .arg("clone")
            .arg("--depth")
            .arg("1")
            .arg(repo_url)
            .arg(cache_path)
            .output()
            .await
            .map_err(|e| format!("执行 git clone 失败: {}", e))?
    };

    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Err(format!(
            "同步 nuclei templates 失败: stderr='{}' stdout='{}'",
            stderr, stdout
        ))
    }
}
