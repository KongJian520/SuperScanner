use std::{env, path::Path};

/// 工具能力声明，记录某个扫描工具是否可用及其来源路径
#[derive(Debug, Clone)]
pub struct ToolCapability {
    pub tool_id: String,
    pub available: bool,
    pub source: String,
    pub path: Option<String>,
}

#[derive(Debug, Clone)]
pub(super) struct BinaryResolution {
    pub path: Option<String>,
    pub source: String,
}

pub(super) fn resolve_binary(
    env_key: &str,
    config_path: Option<&str>,
    default_binary: &str,
) -> BinaryResolution {
    if let Ok(raw) = env::var(env_key) {
        let candidate = raw.trim();
        if !candidate.is_empty() && executable_exists(candidate) {
            return BinaryResolution {
                path: Some(candidate.to_string()),
                source: "env".to_string(),
            };
        }
    }

    if let Some(raw) = config_path {
        let candidate = raw.trim();
        if !candidate.is_empty() && executable_exists(candidate) {
            return BinaryResolution {
                path: Some(candidate.to_string()),
                source: "config".to_string(),
            };
        }
    }

    if let Some(found) = find_in_path(default_binary) {
        return BinaryResolution {
            path: Some(found),
            source: "system".to_string(),
        };
    }

    BinaryResolution {
        path: None,
        source: "missing".to_string(),
    }
}

pub(super) fn executable_exists(candidate: &str) -> bool {
    let p = Path::new(candidate);
    if p.is_absolute() || candidate.contains('\\') || candidate.contains('/') {
        return p.exists();
    }
    find_in_path(candidate).is_some()
}

fn find_in_path(binary: &str) -> Option<String> {
    let path_var = env::var_os("PATH")?;
    #[cfg(windows)]
    let pathext: Vec<String> = env::var("PATHEXT")
        .unwrap_or_else(|_| ".EXE;.BAT;.CMD;.COM".to_string())
        .split(';')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();

    for dir in env::split_paths(&path_var) {
        let plain = dir.join(binary);
        if plain.is_file() {
            return Some(plain.to_string_lossy().to_string());
        }
        #[cfg(windows)]
        {
            for ext in &pathext {
                let ext = ext.trim_start_matches('.');
                let with_ext = dir.join(format!("{binary}.{ext}"));
                if with_ext.is_file() {
                    return Some(with_ext.to_string_lossy().to_string());
                }
            }
        }
    }
    None
}
