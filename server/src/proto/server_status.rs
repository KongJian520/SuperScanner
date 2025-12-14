use async_trait::async_trait;
use tonic::{Request, Response, Status};

// 注意：如果您的Cargo.toml中没有if-addrs, tonic, async-trait, sysinfo等依赖，需要添加。
// sysinfo 0.29.0+ 版本中，total_memory/free_memory 返回的是 bytes。
use sysinfo::Disks;

// 假设这些路径和结构体在您的项目中是正确的
use crate::proto::status_proto::{server_info_server, ServerInfoRequest, ServerInfoResponse};

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
        // ServerInfoRequest currently has no fields; ignore req

        // Perform blocking system calls in a blocking thread to avoid blocking the tokio runtime.
        let collect = tokio::task::spawn_blocking(move || -> Result<ServerInfoResponse, String> {
            // 初始化 system info，使用 new() 而不是 new_all()，然后按需刷新。
            let mut sys = sysinfo::System::new();

            // 刷新所有必要的组件
            // 注意: new() 只初始化一次，需要刷新才能获取最新数据
            sys.refresh_all();

            // Hostname and OS
            let hostname = sysinfo::System::host_name().unwrap_or_default();
            let os_name = sysinfo::System::name().unwrap_or_default();
            let os_version = sysinfo::System::os_version().unwrap_or_default();
            let os = if os_version.is_empty() {
                os_name.clone()
            } else {
                format!("{} {}", os_name, os_version)
            };

            // Uptime (seconds)
            let uptime_seconds = sysinfo::System::uptime();

            // CPU cores (from sysinfo cpus length)
            let cpu_cores = sys.cpus().len() as i32;

            // Memory: sysinfo 0.29.0+ 返回的是 bytes，因此移除 *1024 的乘法。
            let memory_total_bytes = sys.total_memory();
            let memory_free_bytes = sys.free_memory();

            // Disks: sum across disks using sysinfo (disk feature enabled)
            let mut disk_total: u64 = 0;
            let mut disk_free: u64 = 0;

            let disks = Disks::new_with_refreshed_list();
            for disk in disks.list() {
                // 将所有磁盘的总大小和可用大小相加
                disk_total = disk_total.saturating_add(disk.total_space());
                disk_free = disk_free.saturating_add(disk.available_space());
                // println!("{:?}: {:?}", disk.name(), disk.kind()); // 移除调试输出
            }

            // Version from compile-time package version
            let version = env!("CARGO_PKG_VERSION").to_string();

            // Build response with collected values
            let resp = ServerInfoResponse {
                hostname,
                os,
                uptime_seconds,
                cpu_cores,
                memory_total_bytes,
                memory_free_bytes,
                version,
                disk_total_bytes: disk_total,
                disk_free_bytes: disk_free,
                load_average: Vec::new(), // 保持原结构体初始化方式
            };

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
