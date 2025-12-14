use crate::proto::server_info::ServerInfoService;
use crate::proto::server_info_proto::server_info_server;
use crate::proto::tasks::TasksService;
use crate::proto::tasks_proto::tasks_server;
use crate::storage::TaskStore;
use crate::utils::ROOT_DIR;
use std::sync::Arc;

pub mod tasks;

pub mod tasks_proto {
    tonic::include_proto!("tasks.v1");
}

pub mod server_info;

pub mod server_info_proto {
    tonic::include_proto!("server.v1");
}

// Construct a TasksServer given a ready TaskStore (async init should happen in main)
pub fn tasks_svc_with_store(store: Arc<dyn TaskStore>) -> tasks_server::TasksServer<TasksService> {
    tasks_server::TasksServer::new(TasksService::new_with_store(ROOT_DIR.join("tasks"), store))
}

pub fn server_info_svc() -> server_info_server::ServerInfoServer<ServerInfoService> {
    server_info_server::ServerInfoServer::new(ServerInfoService::new())
}
