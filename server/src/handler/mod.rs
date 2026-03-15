use crate::handler::status::ServerInfoService;
use crate::handler::tasks::TasksService;
use crate::domain::traits::TaskStore;
use crate::commands::CommandRegistry;
use std::path::PathBuf;
use std::sync::Arc;

pub mod tasks;
pub mod status;

pub use super_scanner_shared::proto::tasks_proto;
pub use super_scanner_shared::proto::status_proto;

use tasks_proto::tasks_server;
use status_proto::server_info_server;

pub fn tasks_svc_with_store(root: PathBuf, store: Arc<dyn TaskStore>, registry: CommandRegistry) -> tasks_server::TasksServer<TasksService> {
    tasks_server::TasksServer::new(TasksService::new_with_store(root, store, registry))
}

pub fn server_info_svc() -> server_info_server::ServerInfoServer<ServerInfoService> {
    server_info_server::ServerInfoServer::new(ServerInfoService::new())
}
