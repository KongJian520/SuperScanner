use crate::config::AppConfig;
use crate::domain::traits::TaskStore;
use crate::commands::{CommandRegistry, PingCommand, NmapCommand, HttpxCommand, NucleiCommand, BuiltinPortScanCommand};
use crate::handler::{server_info_svc, tasks_svc_with_store};
use crate::storage::file::FileTaskStore;
use crate::engine::scheduler::{Scheduler, SqliteScheduler};
use crate::utils::logging;
use crate::utils::signal::wait_for_double_ctrl_c;
use anyhow::Context;
use std::net::SocketAddr;
use std::sync::Arc;
use tonic::transport::{Identity, Server, ServerTlsConfig};
use tracing::{error, info};

mod config;
mod domain;
mod engine;
mod commands;
mod error;
mod handler;
mod storage;
mod utils;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let config = AppConfig::load();

    if !config.root_dir.exists() {
        tokio::fs::create_dir_all(&config.root_dir)
            .await
            .context("无法创建根目录")?;
    }

    let _guard = logging::init(config.root_dir.clone());

    let addr: SocketAddr = format!("{}:{}", config.ip, config.port)
        .parse()
        .context("无法解析监听地址")?;

    let mut server_builder = Server::builder();

    if config.tls {
        info!("正在配置 TLS...");
        let tls_config = load_tls_config(&config).await?;
        server_builder = server_builder
            .tls_config(tls_config)
            .context("无法应用 TLS 配置")?;
        info!("服务器启动 (TLS) 于 {}", addr);
    } else {
        info!("服务器启动 (无 TLS) 于 {}", addr);
    }

    // 初始化文件存储
    let tasks_dir = config.tasks_dir.clone();
    if !tasks_dir.exists() {
        tokio::fs::create_dir_all(&tasks_dir).await.context("无法创建任务目录")?;
    }
    let store = FileTaskStore::new(tasks_dir.clone());
    let store = Arc::new(store) as Arc<dyn TaskStore>;

    // 初始化调度器
    let scheduler = Arc::new(
        SqliteScheduler::new(&config.root_dir)
            .await
            .context("无法初始化任务调度器")?
    );

    // 重启后恢复未完成任务（记录日志，暂不自动重新启动）
    match scheduler.recover_running().await {
        Ok(recovered) if !recovered.is_empty() => {
            info!("检测到 {} 个未完成任务（上次运行中断），可手动重启: {:?}", recovered.len(), recovered);
        }
        Ok(_) => {}
        Err(e) => {
            error!("恢复未完成任务失败: {}", e);
        }
    }

    // 初始化命令注册表
    let mut registry = CommandRegistry::new()
        .register(PingCommand)
        .register(BuiltinPortScanCommand);
    if let Some(nmap_binary) = config.nmap_binary.clone() {
        registry = registry.register(NmapCommand::new(
            nmap_binary,
            config.nmap_default_args.clone(),
            config.nmap_timeout_secs,
        ));
    }
    if let Some(httpx_binary) = config
        .tool_capabilities
        .iter()
        .find(|t| t.tool_id == "httpx")
        .and_then(|t| t.path.clone())
    {
        registry = registry.register(HttpxCommand::new(httpx_binary));
    }
    if let Some(nuclei_binary) = config
        .tool_capabilities
        .iter()
        .find(|t| t.tool_id == "nuclei")
        .and_then(|t| t.path.clone())
    {
        registry = registry.register(NucleiCommand::new(nuclei_binary));
    }
    info!("已加载命令: {:?}", registry.list_commands());

    server_builder
        .add_service(tasks_svc_with_store(tasks_dir, store, registry))
        .add_service(server_info_svc(config.tool_capabilities.clone()))
        .serve_with_shutdown(addr, wait_for_double_ctrl_c())
        .await
        .map_err(|e| {
            error!(%e, "服务器错误");
            e
        })
        .context("服务器运行时错误")?;
    Ok(())
}

async fn load_tls_config(config: &AppConfig) -> anyhow::Result<ServerTlsConfig> {
    let cert_path = config.certs_dir.join("server.pem");
    let key_path = config.certs_dir.join("server.key");

    let cert = tokio::fs::read(&cert_path)
        .await
        .with_context(|| format!("无法读取证书: {:?}", cert_path))?;
    let key = tokio::fs::read(&key_path)
        .await
        .with_context(|| format!("无法读取私钥: {:?}", key_path))?;

    let identity = Identity::from_pem(cert, key);
    Ok(ServerTlsConfig::new().identity(identity))
}
