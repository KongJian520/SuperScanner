use clap::Parser;
use once_cell::sync::Lazy;
use serde::Deserialize;
use std::{env, path::{Path, PathBuf}};

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
}

#[derive(Debug, Clone)]
pub struct ToolCapability {
    pub tool_id: String,
    pub available: bool,
    pub source: String,
    pub path: Option<String>,
}

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
}

impl AppConfig {
    pub fn load() -> Self {
        let args = CliArgs::parse();
        let config_file = load_server_config_file(&ROOT_DIR.join("server-config.toml")).unwrap_or_default();

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

        let nmap_default_args = env::var("SUPERSCANNER_NMAP_ARGS")
            .map(|v| v.split_whitespace().map(|s| s.to_string()).collect())
            .or_else(|_| config_file.tools.nmap_args.clone().ok_or(env::VarError::NotPresent))
            .unwrap_or_else(|_| vec![
                "-n".to_string(),
                "-Pn".to_string(),
                "--open".to_string(),
                "-sV".to_string(),
            ]);
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
        }
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

fn resolve_binary(env_key: &str, config_path: Option<&str>, default_binary: &str) -> BinaryResolution {
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
