use async_trait::async_trait;
use tonic::{Request, Response, Status};

use sysinfo::{System, SystemExt, DiskExt, NetworksExt};

use crate::proto::server_info_proto::{
    NetworkInterface, ServerInfoRequest, ServerInfoResponse, server_info_server,
};

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
        req: Request<ServerInfoRequest>,
    ) -> Result<Response<ServerInfoResponse>, Status> {
        let include_metrics = req.get_ref().include_metrics;

        // Perform blocking system calls in a blocking thread to avoid blocking the tokio runtime.
        let collect = tokio::task::spawn_blocking(move || -> Result<ServerInfoResponse, String> {
            // Initialize and refresh system info
            let mut sys = sysinfo::System::new_all();
            sys.refresh_all();

            // Hostname and OS
            let hostname = sys.host_name().unwrap_or_default();
            let os_name = sys.name().unwrap_or_default();
            let os_version = sys.os_version().unwrap_or_default();
            let os = if os_version.is_empty() {
                os_name.clone()
            } else {
                format!("{} {}", os_name, os_version)
            };

            // Uptime (seconds)
            let uptime_seconds = sys.uptime();

            // CPU cores (from sysinfo cpus length)
            let cpu_cores = sys.cpus().len() as i32;

            // Memory: sysinfo returns KB for total/free, convert to bytes
            let memory_total_bytes = sys.total_memory().saturating_mul(1024) as u64;
            let memory_free_bytes = sys.free_memory().saturating_mul(1024) as u64;

            // Disks: sum across disks
            let mut disk_total: u64 = 0;
            let mut disk_free: u64 = 0;
            for d in sys.disks() {
                disk_total = disk_total.saturating_add(d.total_space());
                disk_free = disk_free.saturating_add(d.available_space());
            }

            // Network interfaces: use if_addrs to collect IP addresses per interface.
            let mut interfaces: Vec<NetworkInterface> = Vec::new();
            match if_addrs::get_if_addrs() {
                Ok(ifaces) => {
                    use std::collections::HashMap;
                    let mut map: HashMap<String, Vec<String>> = HashMap::new();
                    for ifa in ifaces {
                        let name = ifa.name.clone();
                        let ip = ifa.ip().to_string();
                        map.entry(name).or_default().push(ip);
                    }
                    for (name, ips) in map {
                        interfaces.push(NetworkInterface { name, ip_addresses: ips });
                    }
                }
                Err(_) => {
                    // Fallback: include interface names from sysinfo (without IPs)
                    for (name, _data) in sys.networks().iter() {
                        interfaces.push(NetworkInterface {
                            name: name.clone(),
                            ip_addresses: Vec::new(),
                        });
                    }
                }
            }

            // Version from compile-time package version
            let version = env!("CARGO_PKG_VERSION").to_string();

            // Build response with collected values
            let mut resp = ServerInfoResponse {
                hostname,
                os,
                uptime_seconds,
                cpu_cores,
                memory_total_bytes,
                memory_free_bytes,
                version,
                load_average: Vec::new(),
                disk_total_bytes: disk_total,
                disk_free_bytes: disk_free,
                network_interfaces: interfaces,
            };

            // If caller doesn't want metrics, clear the expensive/volatile fields
            if !include_metrics {
                resp.uptime_seconds = 0;
                resp.memory_total_bytes = 0;
                resp.memory_free_bytes = 0;
                resp.disk_total_bytes = 0;
                resp.disk_free_bytes = 0;
                resp.network_interfaces = Vec::new();
            }

            Ok(resp)
        })
        .await
        .map_err(|e| Status::internal(format!("join error: {}", e)))?;

        match collect {
            Ok(resp) => Ok(Response::new(resp)),
            Err(e) => Err(Status::internal(e)),
        }
    }
}
