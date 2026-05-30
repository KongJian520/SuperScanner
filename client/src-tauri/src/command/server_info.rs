use uuid::Uuid;

use crate::command::server_info_proto::{ServerInfoRequest, SyncNucleiTemplatesRequest};
use crate::error::Result;
use crate::state::AppState;
use crate::utils::grpc::server_info_client;
use crate::utils::{config, convert, dto};
use anyhow::Context;
use tauri::State;
use tracing::info;

/// 探测指定后端的服务器信息，用于验证连接并获取运行状态
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
    let resp = client
        .get_info(req)
        .await
        .context("Failed to get server info")?;
    let info_resp = resp.into_inner();
    info!(%address, "probe_server_info succeeded");
    Ok(convert::server_info_from_proto(info_resp))
}

/// 获取指定后端的服务器信息（探活后再获取）
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

/// 添加后端：先执行探活，成功后将后端记录持久化到配置文件
#[tauri::command]
pub async fn add_backend_with_probe(
    state: State<'_, AppState>,
    name: String,
    address: String,
    description: Option<String>,
    use_tls: Option<bool>,
) -> Result<config::BackendRecord> {
    let use_tls = use_tls.unwrap_or(false);
    info!(%name, %address, use_tls, "add_backend_with_probe called");
    let _server_info = probe_server_info(state, address.clone(), use_tls).await?;
    info!(%address, "probe successful, saving backend record");
    let saved = config::save_backend(config::BackendRecord {
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
    Ok(saved)
}

/// 获取所有已保存的后端服务器记录列表
#[tauri::command]
pub async fn get_backends() -> Result<Vec<config::BackendRecord>> {
    info!("get_backends called");
    let v = config::load_backends()
        .await
        .context("Failed to load backends")?;
    info!(count = v.len(), "get_backends completed");
    Ok(v)
}

/// 根据标识符（ID 或名称）删除后端记录
#[tauri::command]
pub async fn delete_backend(identifier: String) -> Result<()> {
    info!(%identifier, "delete_backend called");
    config::delete_backend(&identifier)
        .await
        .context("Failed to delete backend")?;
    info!(%identifier, "delete_backend completed");
    Ok(())
}

/// 远程同步 nuclei 模板：发送同步请求到后端，返回更新后的模板状态
#[tauri::command]
pub async fn sync_nuclei_templates(
    state: State<'_, AppState>,
    address: String,
    use_tls: Option<bool>,
    local_path: Option<String>,
    repo_url: Option<String>,
    clear_local_path: Option<bool>,
) -> Result<dto::NucleiTemplatesStatusDto> {
    let use_tls = use_tls.unwrap_or(false);
    let mut client = server_info_client(&*state, &address, use_tls)
        .await
        .context("Failed to connect to server")?;
    let req = tonic::Request::new(SyncNucleiTemplatesRequest {
        local_path: local_path.unwrap_or_default(),
        repo_url: repo_url.unwrap_or_default(),
        clear_local_path: clear_local_path.unwrap_or(false),
    });
    let resp = client
        .sync_nuclei_templates(req)
        .await
        .context("Failed to sync nuclei templates")?
        .into_inner();
    let status = resp
        .status
        .ok_or_else(|| anyhow::anyhow!("server returned empty nuclei templates status"))?;
    Ok(dto::NucleiTemplatesStatusDto {
        source: status.source,
        configured_local_path: status.configured_local_path,
        effective_path: status.effective_path,
        repo_url: status.repo_url,
        cache_path: status.cache_path,
        last_sync_unix: status.last_sync_unix,
        last_error: status.last_error,
        sync_supported: status.sync_supported,
    })
}
