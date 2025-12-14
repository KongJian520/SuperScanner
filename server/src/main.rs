use crate::config::AppConfig;
use crate::core::traits::TaskStore;
use crate::core::command::{CommandRegistry, PingCommand, CurlCommand};
use crate::proto::{server_info_svc, tasks_svc_with_store};
use crate::storage::file::FileTaskStore;
use crate::utils::logging;
use crate::utils::signal::wait_for_double_ctrl_c;
use anyhow::Context;
use std::net::SocketAddr;
use std::sync::Arc;
use tonic::transport::{Identity, Server, ServerTlsConfig};
use tracing::{error, info};

mod config;
mod core;
mod error;
mod proto;
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
    let tasks_dir = config.root_dir.join("tasks");
    if !tasks_dir.exists() {
        tokio::fs::create_dir_all(&tasks_dir).await.context("无法创建任务目录")?;
    }
    let store = FileTaskStore::new(tasks_dir);
    let store = Arc::new(store) as Arc<dyn TaskStore>;

    // 初始化命令注册表
    let registry = CommandRegistry::new()
        .register(PingCommand);
        //.register(CurlCommand);
    info!("已加载命令: {:?}", registry.list_commands());

    server_builder
        .add_service(tasks_svc_with_store(store, registry))
        .add_service(server_info_svc())
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
