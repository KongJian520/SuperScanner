pub fn tasks_svc(store: SharedStore) -> tasks_server::TasksServer<TasksService> {
    tasks_server::TasksServer::new(TasksService::new(store))
}
