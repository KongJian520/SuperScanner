use prost_types::Timestamp;
use tonic::{Request, Response, Status};
use tracing::{error, info, trace};


use crate::proto::tasks_proto::{tasks_server, CreateTaskRequest, CreateTaskResponse, DeleteTaskRequest, DeleteTaskResponse, GetTaskRequest, GetTaskResponse, ListAllTasksRequest, ListTasksResponse, StartTaskRequest, StartTaskResponse, StopTaskRequest, StopTaskResponse, Task as ProtoTask, TaskStatus, UpdateTaskRequest, UpdateTaskResponse};
use crate::store::{SharedStore, StoreError, Task as StoreTask};

// Generated proto types are included from `proto::tasks_proto` (see `src/proto.rs`).
// This file implements the service wrapper and uses the generated types from
// `crate::proto::tasks_proto::tasks`.

#[derive(Clone)]
pub struct TasksService {
    store: SharedStore,
}

impl TasksService {
    pub fn new(store: SharedStore) -> Self {
        Self { store }
    }
}

#[tonic::async_trait]
impl tasks_server::Tasks for TasksService {
    async fn list_all_tasks(
        &self,
        request: Request<ListAllTasksRequest>,
    ) -> Result<Response<ListTasksResponse>, Status> {
        let _req = request.into_inner();

        trace!("list_all_tasks called");

        let metas = self.store.list().await.map_err(|e| Status::internal(format!("store error: {}", e)))?;

        let mut tasks = Vec::with_capacity(metas.len());
        for m in metas {
            let status_enum = match m.status.as_str() {
                "PENDING" => TaskStatus::Pending as i32,
                "RUNNING" => TaskStatus::Running as i32,
                "DONE" => TaskStatus::Done as i32,
                "FAILED" => TaskStatus::Failed as i32,
                _ => TaskStatus::Unspecified as i32,
            };

            let created_at_ts = Some(Timestamp {
                seconds: m.created_at,
                nanos: 0,
            });

            tasks.push(ProtoTask {
                id: m.id,
                name: m.name,
                description: m.description,
                status: status_enum,
                created_at: created_at_ts,
            });
        }

        let resp = ListTasksResponse {
            tasks,
            next_page_token: String::new(),
        };
        Ok(Response::new(resp))
    }

    async fn create_task(
        &self,
        request: Request<CreateTaskRequest>,
    ) -> Result<Response<CreateTaskResponse>, Status> {
        let req = request.into_inner();
        info!(op = "create_task", name = %req.name, "received create_task request");

        let task = self
            .store
            .create(req.name, req.description)
            .await
            .map_err(|e| Status::internal(format!("store create error: {}", e)))?;

        info!(op = "create_task", task_id = %task.id, "task created successfully");

        Ok(Response::new(CreateTaskResponse {
            task: Some(store_task_to_proto(task)),
        }))
    }

    async fn delete_task(
        &self,
        request: Request<DeleteTaskRequest>,
    ) -> Result<Response<DeleteTaskResponse>, Status> {
        let req = request.into_inner();
        let id = req.id;
        info!("delete_task called for id: {}", id);
        let deleted = self.store.delete(&id).await.map_err(|e| Status::internal(format!("store delete error: {}", e)))?;
        let resp = DeleteTaskResponse { success: deleted, deleted_count: if deleted { 1 } else { 0 } };
        Ok(Response::new(resp))
    }

    async fn get_task(
        &self,
        request: Request<GetTaskRequest>,
    ) -> Result<Response<GetTaskResponse>, Status> {
        let req = request.into_inner();
        info!(op = "get_task", task_id = %req.id, "received get_task request");

        let task = self
            .store
            .get(&req.id)
            .await
            .map_err(|e| match e {
                StoreError::NotFound => Status::not_found(format!("task {} not found", req.id)),
                _ => Status::internal(format!("store get error: {}", e)),
            })?;

        Ok(Response::new(GetTaskResponse {
            task: Some(store_task_to_proto(task)),
        }))
    }

    async fn update_task(
        &self,
        request: Request<UpdateTaskRequest>,
    ) -> Result<Response<UpdateTaskResponse>, Status> {
        unimplemented!()
    }

    async fn start_task(
        &self,
        request: Request<StartTaskRequest>,
    ) -> Result<Response<StartTaskResponse>, Status> {
        unimplemented!()
    }

    async fn stop_task(
        &self,
        request: Request<StopTaskRequest>,
    ) -> Result<Response<StopTaskResponse>, Status> {
        unimplemented!()
    }
}

fn store_task_to_proto(task: StoreTask) -> ProtoTask {
    let status_enum = match task.status.as_str() {
        "PENDING" => TaskStatus::Pending,
        "RUNNING" => TaskStatus::Running,
        "DONE" => TaskStatus::Done,
        "FAILED" => TaskStatus::Failed,
        _ => TaskStatus::Unspecified,
    };

    ProtoTask {
        id: task.id,
        name: task.name,
        description: task.description,
        status: status_enum as i32,
        created_at: Some(Timestamp {
            seconds: task.created_at,
            nanos: 0,
        }),
    }
}

// factory helper to register service in main
pub fn tasks_svc(store: SharedStore) -> tasks_server::TasksServer<TasksService> {
    tasks_server::TasksServer::new(TasksService::new(store))
}
