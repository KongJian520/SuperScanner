use crate::commands::CommandRegistry;
use crate::config::ToolCapability;
use crate::domain::traits::TaskStore;
use crate::handler::status::ServerInfoService;
use crate::nuclei_templates::NucleiTemplatesManager;
use crate::handler::tasks::TasksService;
use std::path::PathBuf;
use std::sync::Arc;

pub mod status;
pub mod tasks;

pub use super_scanner_shared::proto::status_proto;
pub use super_scanner_shared::proto::tasks_proto;

use status_proto::server_info_server;
use tasks_proto::tasks_server;

pub fn tasks_svc_with_store(
    root: PathBuf,
    store: Arc<dyn TaskStore>,
    registry: CommandRegistry,
) -> tasks_server::TasksServer<TasksService> {
    tasks_server::TasksServer::new(TasksService::new_with_store(root, store, registry))
}

pub fn server_info_svc(
    tool_capabilities: Vec<ToolCapability>,
    templates_manager: NucleiTemplatesManager,
) -> server_info_server::ServerInfoServer<ServerInfoService> {
    server_info_server::ServerInfoServer::new(ServerInfoService::new(
        tool_capabilities,
        templates_manager,
    ))
}
