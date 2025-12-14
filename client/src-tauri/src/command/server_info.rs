// Commands related to server probing and backend management.
// Logs at INFO level for each top-level action.
use uuid::Uuid;

use crate::utils::{config, convert, dto};
use tracing::info;
use crate::command::server_info_proto::ServerInfoRequest;
use crate::utils::grpc::server_info_client;

#[tauri::command]
pub async fn probe_server_info(
    address: String,
    use_tls: bool,
) -> Result<dto::ServerInfoDto, String> {
    info!(%address, use_tls, "probe_server_info called");
    let mut client = server_info_client(&address, use_tls)
        .await
        .map_err(|e| e.to_string())?;
    let req = tonic::Request::new(ServerInfoRequest {});
    let resp = client.get_info(req).await.map_err(|e| e.to_string())?;
    let info = resp.into_inner();
    info!(%address, "probe_server_info succeeded");
    Ok(convert::server_info_from_proto(info))
}

// Wrapper to provide the command name expected by the frontend (`get_server_info`).
// Accepts `use_tls` as an optional parameter for compatibility with older callers.
#[tauri::command]
pub async fn get_server_info(
    address: String,
    use_tls: Option<bool>,
) -> Result<dto::ServerInfoDto, String> {
    let use_tls = use_tls.unwrap_or(false);
    info!(%address, use_tls, "get_server_info wrapper called");
    probe_server_info(address, use_tls).await
}

#[tauri::command]
pub async fn add_backend_with_probe(
    name: String,
    address: String,
    description: Option<String>,
    use_tls: Option<bool>,
) -> Result<(), String> {
    // try probing first
    let use_tls = use_tls.unwrap_or(false);
    info!(%name, %address, use_tls, "add_backend_with_probe called");
    let _server_info = probe_server_info(address.clone(), use_tls).await?;
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
    .map_err(|e| e.to_string())?;
    info!("add_backend_with_probe completed and backend saved");
    Ok(())
}

#[tauri::command]
pub async fn get_backends() -> Result<Vec<config::BackendRecord>, String> {
    info!("get_backends called");
    let v = config::load_backends().await.map_err(|e| e.to_string())?;
    info!(count = v.len(), "get_backends completed");
    Ok(v)
}

#[tauri::command]
pub async fn delete_backend(identifier: String) -> Result<(), String> {
    info!(%identifier, "delete_backend called");
    config::delete_backend(&identifier)
        .await
        .map_err(|e| e.to_string())?;
    info!(%identifier, "delete_backend completed");
    Ok(())
}
