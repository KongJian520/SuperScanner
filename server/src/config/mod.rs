mod cli;
mod nuclei;
mod tools;

pub use cli::{CliArgs, ROOT_DIR};
pub use nuclei::{persist_nuclei_templates_config, NucleiTemplatesConfig};
pub use tools::ToolCapability;

use clap::Parser;
use cli::ROOT_DIR as _;
use nuclei::persist_nuclei_templates_config_at;
use serde::Deserialize;
use std::{env, path::Path, path::PathBuf};
use tools::resolve_binary;

const SERVER_CONFIG_FILE_NAME: &str = "server-config.toml";

/// 应用程序全局配置，包含监听地址、根目录、工具能力声明和 nuclei 模板配置
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
    pub nuclei_templates_dir: PathBuf,
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
    fscan_binary: Option<String>,
    nuclei_templates_dir: Option<String>,
    nuclei_templates_cache_dir: Option<String>,
    nuclei_templates_repo: Option<String>,
}

fn non_empty_string(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() { None } else { Some(trimmed.to_string()) }
}

fn load_server_config_file(path: &Path) -> Option<ServerConfigFile> {
    let text = std::fs::read_to_string(path).ok()?;
    toml::from_str::<ServerConfigFile>(&text).ok()
}

impl AppConfig {
    /// 加载全局配置：合并命令行参数、环境变量和配置文件，返回 AppConfig
    pub fn load() -> Self {
        let args = cli::CliArgs::parse();
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
        let _nuclei_binary = resolve_binary(
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
                available: true,
                source: "builtin".to_string(),
                path: None,
            },
            ToolCapability {
                tool_id: "fscan".to_string(),
                available: fscan_binary.path.is_some(),
                source: fscan_binary.source,
                path: fscan_binary.path.clone(),
            },
        ];

        let nuclei_templates_dir = {
            let local = nuclei_templates_local
                .as_deref()
                .filter(|p| Path::new(p).is_dir());
            let cache = Path::new(&nuclei_templates_cache);
            if let Some(p) = local {
                PathBuf::from(p)
            } else if cache.is_dir() {
                cache.to_path_buf()
            } else {
                cache.to_path_buf()
            }
        };

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
            nuclei_templates_dir,
        }
    }
}
