use crate::proto::server_info::ServerInfoService;
use crate::proto::server_info_proto::server_info_server;
use crate::proto::tasks::TasksService;
use crate::proto::tasks_proto::tasks_server;

pub mod tasks;

pub mod tasks_proto {
    tonic::include_proto!("tasks.v1");
}

pub mod server_info;

pub mod server_info_proto {
    tonic::include_proto!("server.v1");
}

pub fn tasks_svc() -> tasks_server::TasksServer<TasksService> {
    tasks_server::TasksServer::new(TasksService::new())
}

pub fn server_info_svc() -> server_info_server::ServerInfoServer<ServerInfoService> {
    server_info_server::ServerInfoServer::new(ServerInfoService::new())
}
