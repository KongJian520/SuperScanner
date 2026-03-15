use async_trait::async_trait;
use tonic::{Request, Response, Status};
use sysinfo::Disks;
use crate::handler::status_proto::{server_info_server, ServerInfoRequest, ServerInfoResponse};

pub struct ServerInfoService;

impl ServerInfoService {
    pub fn new() -> Self {
        Self {}
    }
}

#[async_trait]
impl server_info_server::ServerInfo for ServerInfoService {
    async fn get_info(
        &self,
        _req: Request<ServerInfoRequest>,
    ) -> Result<Response<ServerInfoResponse>, Status> {
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
            })
        })
        .await
        .map_err(|e| Status::internal(format!("join error: {}", e)))?;

        match collect {
            Ok(resp) => Ok(Response::new(resp)),
            Err(e) => Err(Status::internal(e)),
        }
    }
}
