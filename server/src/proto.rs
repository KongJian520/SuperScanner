use crate::proto::tasks::TasksService;
use crate::proto::tasks_proto::tasks_server;

pub mod tasks;

pub mod tasks_proto {
    tonic::include_proto!("tasks.v1");
}

pub fn tasks_svc() -> tasks_server::TasksServer<TasksService> {
    tasks_server::TasksServer::new(TasksService::new())
}
