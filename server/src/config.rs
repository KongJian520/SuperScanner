use clap::Parser;
use once_cell::sync::Lazy;
use serde::Deserialize;
use std::{
    env,
    fs,
    io::Write,
    path::{Path, PathBuf},
};
use tempfile::NamedTempFile;
use toml::map::Map;

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
    pub nmap_binary: Option<String>,
    pub nmap_default_args: Vec<String>,
    pub nmap_timeout_secs: u64,
    pub tool_capabilities: Vec<ToolCapability>,
    pub nuclei_templates: NucleiTemplatesConfig,
}

#[derive(Debug, Clone)]
pub struct ToolCapability {
    pub tool_id: String,
    pub available: bool,
    pub source: String,
    pub path: Option<String>,
}

#[derive(Debug, Clone)]
pub struct NucleiTemplatesConfig {
    pub local_path: Option<String>,
    pub cache_path: String,
    pub repo_url: String,
}

const SERVER_CONFIG_FILE_NAME: &str = "server-config.toml";

#[derive(Debug, Deserialize, Default)]
struct ServerConfigFile {
    #[serde(default)]
    tools: ToolsConfigSection,
}

#[derive(Debug, Deserialize, Default)]
struct ToolsConfigSection {
    nmap_binary: Option<String>,
    nmap_args: Option<Vec<String>>,
    nmap_timeout_secs: Option<u64>,
    httpx_binary: Option<String>,
    nuclei_binary: Option<String>,
    fscan_binary: Option<String>,
    nuclei_templates_dir: Option<String>,
    nuclei_templates_cache_dir: Option<String>,
    nuclei_templates_repo: Option<String>,
}

impl AppConfig {
    pub fn load() -> Self {
        let args = CliArgs::parse();
        let config_file =
            load_server_config_file(&ROOT_DIR.join(SERVER_CONFIG_FILE_NAME)).unwrap_or_default();

        let nmap_binary = resolve_binary(
            "SUPERSCANNER_NMAP_BINARY",
            config_file.tools.nmap_binary.as_deref(),
            "nmap",
        );
        let httpx_binary = resolve_binary(
            "SUPERSCANNER_HTTPX_BINARY",
            config_file.tools.httpx_binary.as_deref(),
            "httpx",
        );
        let nuclei_binary = resolve_binary(
            "SUPERSCANNER_NUCLEI_BINARY",
            config_file.tools.nuclei_binary.as_deref(),
            "nuclei",
        );
        let fscan_binary = resolve_binary(
            "SUPERSCANNER_FSCAN_BINARY",
            config_file.tools.fscan_binary.as_deref(),
            "fscan",
        );
        let nuclei_templates_local = env::var("SUPERSCANNER_NUCLEI_TEMPLATES_DIR")
            .ok()
            .and_then(|v| non_empty_string(&v))
            .or_else(|| {
                config_file
                    .tools
                    .nuclei_templates_dir
                    .as_deref()
                    .and_then(non_empty_string)
            });
        let nuclei_templates_cache = env::var("SUPERSCANNER_NUCLEI_TEMPLATES_CACHE_DIR")
            .ok()
            .and_then(|v| non_empty_string(&v))
            .or_else(|| {
                config_file
                    .tools
                    .nuclei_templates_cache_dir
                    .as_deref()
                    .and_then(non_empty_string)
            })
            .unwrap_or_else(|| {
                ROOT_DIR
                    .join("nuclei-templates")
                    .to_string_lossy()
                    .to_string()
            });
        let nuclei_templates_repo = env::var("SUPERSCANNER_NUCLEI_TEMPLATES_REPO")
            .ok()
            .and_then(|v| non_empty_string(&v))
            .or_else(|| {
                config_file
                    .tools
                    .nuclei_templates_repo
                    .as_deref()
                    .and_then(non_empty_string)
            })
            .unwrap_or_else(|| {
                "https://github.com/projectdiscovery/nuclei-templates.git".to_string()
            });

        let nmap_default_args = env::var("SUPERSCANNER_NMAP_ARGS")
            .map(|v| v.split_whitespace().map(|s| s.to_string()).collect())
            .or_else(|_| {
                config_file
                    .tools
                    .nmap_args
                    .clone()
                    .ok_or(env::VarError::NotPresent)
            })
            .unwrap_or_else(|_| {
                vec![
                    "-n".to_string(),
                    "-Pn".to_string(),
                    "--open".to_string(),
                    "-sV".to_string(),
                ]
            });
        let nmap_timeout_secs = env::var("SUPERSCANNER_NMAP_TIMEOUT_SECS")
            .ok()
            .and_then(|s| s.parse::<u64>().ok())
            .or(config_file.tools.nmap_timeout_secs)
            .unwrap_or(120);

        let tool_capabilities = vec![
            ToolCapability {
                tool_id: "builtin_port_scan".to_string(),
                available: true,
                source: "builtin".to_string(),
                path: None,
            },
            ToolCapability {
                tool_id: "nmap".to_string(),
                available: nmap_binary.path.is_some(),
                source: nmap_binary.source,
                path: nmap_binary.path.clone(),
            },
            ToolCapability {
                tool_id: "httpx".to_string(),
                available: httpx_binary.path.is_some(),
                source: httpx_binary.source,
                path: httpx_binary.path.clone(),
            },
            ToolCapability {
                tool_id: "nuclei".to_string(),
                available: nuclei_binary.path.is_some(),
                source: nuclei_binary.source,
                path: nuclei_binary.path.clone(),
            },
            ToolCapability {
                tool_id: "fscan".to_string(),
                available: fscan_binary.path.is_some(),
                source: fscan_binary.source,
                path: fscan_binary.path.clone(),
            },
        ];

        Self {
            ip: args.ip,
            port: args.port,
            tls: args.tls,
            root_dir: ROOT_DIR.clone(),
            certs_dir: ROOT_DIR.join("crts"),
            tasks_dir: ROOT_DIR.join("tasks"),
            nmap_binary: nmap_binary.path,
            nmap_default_args,
            nmap_timeout_secs,
            tool_capabilities,
            nuclei_templates: NucleiTemplatesConfig {
                local_path: nuclei_templates_local,
                cache_path: nuclei_templates_cache,
                repo_url: nuclei_templates_repo,
            },
        }
    }
}

fn non_empty_string(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

#[derive(Debug, Clone)]
struct BinaryResolution {
    path: Option<String>,
    source: String,
}

fn load_server_config_file(path: &Path) -> Option<ServerConfigFile> {
    let text = std::fs::read_to_string(path).ok()?;
    toml::from_str::<ServerConfigFile>(&text).ok()
}

pub fn persist_nuclei_templates_config(
    local_path: Option<&str>,
    repo_url: &str,
) -> Result<(), String> {
    persist_nuclei_templates_config_at(&ROOT_DIR, local_path, repo_url)
}

fn persist_nuclei_templates_config_at(
    root_dir: &Path,
    local_path: Option<&str>,
    repo_url: &str,
) -> Result<(), String> {
    let repo_url = non_empty_string(repo_url)
        .ok_or_else(|| "nuclei templates repo 不能为空".to_string())?;

    let config_path = root_dir.join(SERVER_CONFIG_FILE_NAME);
    let mut doc = if config_path.exists() {
        let text = fs::read_to_string(&config_path)
            .map_err(|e| format!("读取配置文件失败 {}: {}", config_path.display(), e))?;
        toml::from_str::<toml::Value>(&text)
            .map_err(|e| format!("解析配置文件失败 {}: {}", config_path.display(), e))?
    } else {
        toml::Value::Table(Map::new())
    };

    let root = doc
        .as_table_mut()
        .ok_or_else(|| "配置文件格式错误：顶层必须是 table".to_string())?;

    let tools_value = root
        .entry("tools".to_string())
        .or_insert_with(|| toml::Value::Table(Map::new()));
    if !tools_value.is_table() {
        *tools_value = toml::Value::Table(Map::new());
    }
    let tools = tools_value
        .as_table_mut()
        .ok_or_else(|| "配置文件格式错误：[tools] 不是 table".to_string())?;

    tools.insert(
        "nuclei_templates_repo".to_string(),
        toml::Value::String(repo_url),
    );
    match local_path.and_then(non_empty_string) {
        Some(local) => {
            tools.insert(
                "nuclei_templates_dir".to_string(),
                toml::Value::String(local),
            );
        }
        None => {
            tools.remove("nuclei_templates_dir");
        }
    }

    let serialized = toml::to_string_pretty(&doc).map_err(|e| format!("序列化配置失败: {}", e))?;
    fs::create_dir_all(root_dir)
        .map_err(|e| format!("创建配置目录失败 {}: {}", root_dir.display(), e))?;

    let parent = config_path
        .parent()
        .ok_or_else(|| "配置文件路径错误，缺少父目录".to_string())?;
    let mut temp_file = NamedTempFile::new_in(parent)
        .map_err(|e| format!("创建临时配置文件失败 {}: {}", parent.display(), e))?;
    temp_file
        .write_all(serialized.as_bytes())
        .map_err(|e| format!("写入临时配置文件失败: {}", e))?;
    temp_file
        .as_file_mut()
        .sync_all()
        .map_err(|e| format!("刷新临时配置文件失败: {}", e))?;

    temp_file
        .persist(&config_path)
        .map_err(|e| format!("原子替换配置文件失败 {}: {}", config_path.display(), e.error))?;
    Ok(())
}

fn resolve_binary(
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

fn executable_exists(candidate: &str) -> bool {
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

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn persist_nuclei_templates_config_creates_and_updates_tools_section() {
        let dir = tempdir().expect("create temp dir");
        persist_nuclei_templates_config_at(
            dir.path(),
            Some("C:\\nuclei\\templates"),
            "https://example.com/repo.git",
        )
        .expect("persist config");

        let config_path = dir.path().join(SERVER_CONFIG_FILE_NAME);
        let content = fs::read_to_string(&config_path).expect("read config");
        let parsed: toml::Value = toml::from_str(&content).expect("parse config");
        let tools = parsed
            .get("tools")
            .and_then(|v| v.as_table())
            .expect("tools table");
        assert_eq!(
            tools
                .get("nuclei_templates_dir")
                .and_then(|v| v.as_str())
                .expect("templates dir"),
            "C:\\nuclei\\templates"
        );
        assert_eq!(
            tools
                .get("nuclei_templates_repo")
                .and_then(|v| v.as_str())
                .expect("repo url"),
            "https://example.com/repo.git"
        );
    }

    #[test]
    fn persist_nuclei_templates_config_preserves_unrelated_fields_and_clears_local() {
        let dir = tempdir().expect("create temp dir");
        let config_path = dir.path().join(SERVER_CONFIG_FILE_NAME);
        fs::write(
            &config_path,
            r#"
[server]
name = "prod"

[tools]
nmap_binary = "/usr/bin/nmap"
nuclei_templates_dir = "/old/path"
nuclei_templates_cache_dir = "/cache/path"
"#,
        )
        .expect("write config");

        persist_nuclei_templates_config_at(dir.path(), None, "https://new.repo/templates.git")
            .expect("persist config");

        let content = fs::read_to_string(&config_path).expect("read config");
        let parsed: toml::Value = toml::from_str(&content).expect("parse config");
        assert_eq!(
            parsed
                .get("server")
                .and_then(|v| v.get("name"))
                .and_then(|v| v.as_str()),
            Some("prod")
        );
        let tools = parsed
            .get("tools")
            .and_then(|v| v.as_table())
            .expect("tools table");
        assert!(tools.get("nuclei_templates_dir").is_none());
        assert_eq!(
            tools
                .get("nmap_binary")
                .and_then(|v| v.as_str())
                .expect("nmap binary"),
            "/usr/bin/nmap"
        );
        assert_eq!(
            tools
                .get("nuclei_templates_cache_dir")
                .and_then(|v| v.as_str())
                .expect("cache"),
            "/cache/path"
        );
        assert_eq!(
            tools
                .get("nuclei_templates_repo")
                .and_then(|v| v.as_str())
                .expect("repo"),
            "https://new.repo/templates.git"
        );
    }
}
