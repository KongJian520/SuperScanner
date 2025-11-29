use crate::proto::tasks::TasksService;
use crate::proto::tasks_proto::tasks_server;
use crate::store::SharedStore;

pub mod tasks;

pub mod tasks_proto {
    tonic::include_proto!("tasks");
}
pub fn tasks_svc(store: SharedStore) -> tasks_server::TasksServer<TasksService> {
    tasks_server::TasksServer::new(TasksService::new(store))
}
