use crate::config::NucleiTemplatesConfig;
use crate::error::AppError;
use chrono::Utc;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::process::Command;
use tokio::sync::RwLock;

/// nuclei 模板的状态快照，包含来源、路径和同步信息
#[derive(Debug, Clone)]
pub struct NucleiTemplatesStatus {
    /// 模板来源（"local" / "cache" / "none"）
    pub source: String,
    /// 配置的本地模板路径
    pub configured_local_path: String,
    /// 当前生效的模板路径
    pub effective_path: String,
    /// 模板仓库 URL
    pub repo_url: String,
    /// 缓存路径
    pub cache_path: String,
    /// 上次同步成功的时间戳（Unix 秒）
    pub last_sync_unix: i64,
    /// 上次同步失败的错误信息
    pub last_error: String,
    /// 是否支持自动同步
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

/// nuclei 模板管理器，负责模板的同步、状态查询和有效目录解析
#[derive(Clone)]
pub struct NucleiTemplatesManager {
    state: Arc<RwLock<NucleiTemplatesState>>,
}

impl NucleiTemplatesManager {
    /// 创建新的模板管理器，使用给定的配置初始化内部状态
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

    /// 返回当前生效的模板目录路径（若无可用的目录则返回 None）
    pub async fn effective_template_dir(&self) -> Option<String> {
        let status = self.status().await;
        if status.effective_path.is_empty() {
            None
        } else {
            Some(status.effective_path)
        }
    }

    /// 获取模板当前的状态信息，包括来源、路径、上次同步时间等
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

    /// 立即同步 nuclei 模板：更新配置路径并发起 git pull/clone
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
