use crate::proto::{server_info_svc, tasks_svc};
use crate::utils::cli::Cli;
use crate::utils::logging;
use crate::utils::signal::wait_for_double_ctrl_c;
use anyhow::Context;
use clap::Parser;
use std::net::SocketAddr;
use std::path::PathBuf;
use tonic::transport::{Identity, Server, ServerTlsConfig};
use tracing::{error, info};
use utils::ROOT_DIR;

mod proto;
mod services;
mod utils;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    if !ROOT_DIR.exists() {
        tokio::fs::create_dir_all(ROOT_DIR.as_path())
            .await
            .context("failed to create scanner projects dir")?;
    }
    // 主程序日志放在 `ROOT_DIR` 下（server.log）
    let _guard = logging::init(ROOT_DIR.clone());
    let args = Cli::parse();
    let use_tls = args.tls;
    let addr: SocketAddr = format!("{}:{}", args.ip, args.port)
        .parse()
        .context("failed to parse listening address")?;

    let mut server_builder = Server::builder();

    if use_tls {
        info!("Configuring TLS...");
        let tls_config = load_tls_config().await?; // 逻辑清晰
        server_builder = server_builder
            .tls_config(tls_config)
            .context("failed to apply TLS config")?;
        info!("Server starting WITH TLS on {}", addr);
    } else {
        info!("Server starting WITHOUT TLS on {}", addr);
    }

    server_builder
        .add_service(tasks_svc())
        .add_service(server_info_svc())
        .serve_with_shutdown(addr, wait_for_double_ctrl_c())
        .await
        .map_err(|e| {
            error!(%e, "server error");
            e
        })
        .context("server runtime error")?;
    Ok(())
}

async fn load_tls_config() -> anyhow::Result<ServerTlsConfig> {
    let cert_path = ROOT_DIR.join("crts/server.pem");
    let key_path = ROOT_DIR.join("crts/server.key");

    let cert = tokio::fs::read(&cert_path)
        .await
        .with_context(|| format!("failed to read cert: {:?}", cert_path))?;
    let key = tokio::fs::read(&key_path)
        .await
        .with_context(|| format!("failed to read key: {:?}", key_path))?;

    let identity = Identity::from_pem(cert, key);
    Ok(ServerTlsConfig::new().identity(identity))
}
