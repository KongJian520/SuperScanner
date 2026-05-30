/// 服务端信息相关的 Tauri 命令（探活、添加后端、获取信息等）
pub mod server_info;

pub use super_scanner_shared::proto::status_proto as server_info_proto;

/// 任务管理相关的 Tauri 命令（CRUD、流式事件等）
pub mod tasks;

pub use super_scanner_shared::proto::tasks_proto;
