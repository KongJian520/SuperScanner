use crate::config::{ToolCapability, persist_nuclei_templates_config};
use crate::handler::status_proto::{ServerInfoRequest, ServerInfoResponse, server_info_server};
use crate::nuclei_templates::NucleiTemplatesManager;
use async_trait::async_trait;
use sysinfo::Disks;
use tonic::{Request, Response, Status};

pub struct ServerInfoService {
    tool_capabilities: Vec<ToolCapability>,
    templates_manager: NucleiTemplatesManager,
}

impl ServerInfoService {
    pub fn new(
        tool_capabilities: Vec<ToolCapability>,
        templates_manager: NucleiTemplatesManager,
    ) -> Self {
        Self {
            tool_capabilities,
            templates_manager,
        }
    }
}

#[async_trait]
impl server_info_server::ServerInfo for ServerInfoService {
    async fn get_info(
        &self,
        _req: Request<ServerInfoRequest>,
    ) -> Result<Response<ServerInfoResponse>, Status> {
        let tools = self.tool_capabilities.clone();
        let templates_status = self.templates_manager.status().await;
        let collect = tokio::task::spawn_blocking(move || -> Result<ServerInfoResponse, String> {
            let mut sys = sysinfo::System::new();
            sys.refresh_all();

            let hostname = sysinfo::System::host_name().unwrap_or_default();
            let os_name = sysinfo::System::name().unwrap_or_default();
            let os_version = sysinfo::System::os_version().unwrap_or_default();
            let os = if os_version.is_empty() {
                os_name.clone()
            } else {
                format!("{} {}", os_name, os_version)
            };

            let uptime_seconds = sysinfo::System::uptime();
            let cpu_cores = sys.cpus().len() as i32;
            let memory_total_bytes = sys.total_memory();
            let memory_free_bytes = sys.free_memory();

            let mut disk_total: u64 = 0;
            let mut disk_free: u64 = 0;
            let disks = Disks::new_with_refreshed_list();
            for disk in disks.list() {
                disk_total = disk_total.saturating_add(disk.total_space());
                disk_free = disk_free.saturating_add(disk.available_space());
            }

            let version = env!("CARGO_PKG_VERSION").to_string();

            Ok(ServerInfoResponse {
                hostname,
                os,
                uptime_seconds,
                cpu_cores,
                memory_total_bytes,
                memory_free_bytes,
                version,
                disk_total_bytes: disk_total,
                disk_free_bytes: disk_free,
                load_average: Vec::new(),
                tools: tools
                    .into_iter()
                    .map(|t| crate::handler::status_proto::ToolCapability {
                        tool_id: t.tool_id,
                        available: t.available,
                        source: t.source,
                        path: t.path.unwrap_or_default(),
                    })
                    .collect(),
                nuclei_templates: Some(crate::handler::status_proto::NucleiTemplatesStatus {
                    source: templates_status.source,
                    configured_local_path: templates_status.configured_local_path,
                    effective_path: templates_status.effective_path,
                    repo_url: templates_status.repo_url,
                    cache_path: templates_status.cache_path,
                    last_sync_unix: templates_status.last_sync_unix,
                    last_error: templates_status.last_error,
                    sync_supported: templates_status.sync_supported,
                }),
            })
        })
        .await
        .map_err(|e| Status::internal(format!("join error: {}", e)))?;

        match collect {
            Ok(resp) => Ok(Response::new(resp)),
            Err(e) => Err(Status::internal(e)),
        }
    }

    async fn sync_nuclei_templates(
        &self,
        req: Request<crate::handler::status_proto::SyncNucleiTemplatesRequest>,
    ) -> Result<Response<crate::handler::status_proto::SyncNucleiTemplatesResponse>, Status> {
        let body = req.into_inner();
        let synced = self
            .templates_manager
            .sync_now(
                if body.local_path.trim().is_empty() {
                    None
                } else {
                    Some(body.local_path)
                },
                if body.repo_url.trim().is_empty() {
                    None
                } else {
                    Some(body.repo_url)
                },
                body.clear_local_path,
            )
            .await
            .map_err(|e| Status::internal(e.to_string()))?;

        let local_for_persist = if synced.configured_local_path.trim().is_empty() {
            None
        } else {
            Some(synced.configured_local_path.clone())
        };
        let repo_for_persist = synced.repo_url.clone();
        tokio::task::spawn_blocking(move || {
            persist_nuclei_templates_config(local_for_persist.as_deref(), &repo_for_persist)
        })
        .await
        .map_err(|e| Status::internal(format!("persist join error: {}", e)))?
        .map_err(|e| Status::internal(format!("persist config failed: {}", e)))?;

        Ok(Response::new(
            crate::handler::status_proto::SyncNucleiTemplatesResponse {
                status: Some(crate::handler::status_proto::NucleiTemplatesStatus {
                    source: synced.source,
                    configured_local_path: synced.configured_local_path,
                    effective_path: synced.effective_path,
                    repo_url: synced.repo_url,
                    cache_path: synced.cache_path,
                    last_sync_unix: synced.last_sync_unix,
                    last_error: synced.last_error,
                    sync_supported: synced.sync_supported,
                }),
                message: "nuclei templates synced".to_string(),
            },
        ))
    }
}
