use uuid::Uuid;

use crate::utils::{config, convert, dto};
use tracing::info;
use crate::command::server_info_proto::ServerInfoRequest;
use crate::utils::grpc::server_info_client;
use crate::error::Result;
use crate::state::AppState;
use anyhow::Context;
use tauri::State;

#[tauri::command]
pub async fn probe_server_info(
    state: State<'_, AppState>,
    address: String,
    use_tls: bool,
) -> Result<dto::ServerInfoDto> {
    info!(%address, use_tls, "probe_server_info called");
    let mut client = server_info_client(&*state, &address, use_tls)
        .await
        .context("Failed to connect to server")?;
    let req = tonic::Request::new(ServerInfoRequest {});
    let resp = client.get_info(req).await.context("Failed to get server info")?;
    let info_resp = resp.into_inner();
    info!(%address, "probe_server_info succeeded");
    Ok(convert::server_info_from_proto(info_resp))
}

#[tauri::command]
pub async fn get_server_info(
    state: State<'_, AppState>,
    address: String,
    use_tls: Option<bool>,
) -> Result<dto::ServerInfoDto> {
    let use_tls = use_tls.unwrap_or(false);
    info!(%address, use_tls, "get_server_info wrapper called");
    probe_server_info(state, address, use_tls).await
}

#[tauri::command]
pub async fn add_backend_with_probe(
    state: State<'_, AppState>,
    name: String,
    address: String,
    description: Option<String>,
    use_tls: Option<bool>,
) -> Result<()> {
    let use_tls = use_tls.unwrap_or(false);
    info!(%name, %address, use_tls, "add_backend_with_probe called");
    let _server_info = probe_server_info(state, address.clone(), use_tls).await?;
    info!(%address, "probe successful, saving backend record");
    config::save_backend(config::BackendRecord {
        id: Uuid::new_v4().to_string(),
        name,
        address,
        description,
        use_tls,
        created_at: chrono::Utc::now().timestamp_millis(),
    })
    .await
    .context("Failed to save backend record")?;
    info!("add_backend_with_probe completed and backend saved");
    Ok(())
}

#[tauri::command]
pub async fn get_backends() -> Result<Vec<config::BackendRecord>> {
    info!("get_backends called");
    let v = config::load_backends().await.context("Failed to load backends")?;
    info!(count = v.len(), "get_backends completed");
    Ok(v)
}

#[tauri::command]
pub async fn delete_backend(identifier: String) -> Result<()> {
    info!(%identifier, "delete_backend called");
    config::delete_backend(&identifier)
        .await
        .context("Failed to delete backend")?;
    info!(%identifier, "delete_backend completed");
    Ok(())
}
