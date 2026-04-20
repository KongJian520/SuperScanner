use crate::utils::{convert, dto};
use tracing::info;
use crate::utils::grpc::tasks_client;
use crate::state::AppState;
use tauri::{Emitter, State};
use crate::error::Result;
use anyhow::Context;

fn sanitize_event_segment(input: &str) -> String {
    input
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect()
}

#[tauri::command]
pub async fn list_tasks(
    state: State<'_, AppState>,
    address: String,
    use_tls: Option<bool>,
) -> Result<Vec<dto::TaskDto>> {
    let use_tls = use_tls.unwrap_or(false);
    info!(%address, use_tls, "list_tasks called");
    let mut client = tasks_client(&*state, &address, use_tls).await.context("Failed to connect to server")?;
    let req = tonic::Request::new(crate::command::tasks_proto::ListTasksRequest {});
    let resp = client.list_tasks(req).await.context("Failed to list tasks")?;
    let tasks: Vec<dto::TaskDto> = resp.into_inner().tasks.into_iter().map(convert::task_from_proto).collect();
    info!(%address, count = tasks.len(), "list_tasks completed");
    Ok(tasks)
}

#[tauri::command]
pub async fn get_task(
    state: State<'_, AppState>,
    address: String,
    id: String,
    use_tls: Option<bool>,
) -> Result<dto::TaskDto> {
    let use_tls = use_tls.unwrap_or(false);
    info!(%address, %id, use_tls, "get_task called");
    let mut client = tasks_client(&*state, &address, use_tls).await.context("Failed to connect to server")?;
    let req = tonic::Request::new(crate::command::tasks_proto::GetTaskRequest { id });
    let resp = client.get_task(req).await.context("Failed to get task")?;
    let task = resp.into_inner();
    info!(%address, %task.id, "get_task completed");
    Ok(convert::task_from_proto(task))
}

#[tauri::command]
pub async fn create_task(
    state: State<'_, AppState>,
    address: String,
    input: dto::CreateTaskDto,
    use_tls: Option<bool>,
) -> Result<dto::TaskDto> {
    let use_tls = use_tls.unwrap_or(false);
    info!(%address, name = %input.name, "create_task called");
    let mut client = tasks_client(&*state, &address, use_tls).await.context("Failed to connect to server")?;

    let workflow = Some(crate::command::tasks_proto::Workflow {
        steps: input.workflow.steps.into_iter().map(|s| crate::command::tasks_proto::WorkflowStep {
            r#type: s.r#type,
            tool: s.tool,
        }).collect(),
    });

    let req = tonic::Request::new(crate::command::tasks_proto::CreateTaskRequest {
        name: input.name,
        description: input.description.unwrap_or_default(),
        targets: input.targets.unwrap_or_default(),
        workflow,
    });
    let resp = client.create_task(req).await.context("Failed to create task")?;
    let task = resp.into_inner();
    info!(%address, %task.id, "create_task completed");
    Ok(convert::task_from_proto(task))
}

#[tauri::command]
pub async fn start_task(
    state: State<'_, AppState>,
    address: String,
    id: String,
    use_tls: Option<bool>,
) -> Result<()> {
    let use_tls = use_tls.unwrap_or(false);
    info!(%address, %id, "start_task called");
    let mut client = tasks_client(&*state, &address, use_tls).await.context("Failed to connect to server")?;
    let req = tonic::Request::new(crate::command::tasks_proto::StartTaskRequest { id: id.clone() });
    client.start_task(req).await.context("Failed to start task")?;
    info!(%address, %id, "start_task completed");
    Ok(())
}

#[tauri::command]
pub async fn stop_task(
    state: State<'_, AppState>,
    address: String,
    id: String,
    use_tls: Option<bool>,
) -> Result<()> {
    let use_tls = use_tls.unwrap_or(false);
    info!(%address, %id, "stop_task called");
    let mut client = tasks_client(&*state, &address, use_tls).await.context("Failed to connect to server")?;
    let req = tonic::Request::new(crate::command::tasks_proto::StopTaskRequest { id: id.clone() });
    client.stop_task(req).await.context("Failed to stop task")?;
    info!(%address, %id, "stop_task completed");
    Ok(())
}

#[tauri::command]
pub async fn delete_task(
    state: State<'_, AppState>,
    address: String,
    id: String,
    use_tls: Option<bool>,
) -> Result<()> {
    let use_tls = use_tls.unwrap_or(false);
    info!(%address, %id, "delete_task called");
    let mut client = tasks_client(&*state, &address, use_tls).await.context("Failed to connect to server")?;
    let req = tonic::Request::new(crate::command::tasks_proto::DeleteTaskRequest { id: id.clone() });
    client.delete_task(req).await.context("Failed to delete task")?;
    info!(%address, %id, "delete_task completed");
    Ok(())
}

#[tauri::command]
pub async fn restart_task(
    state: State<'_, AppState>,
    address: String,
    id: String,
    clear_logs: Option<bool>,
    start_now: Option<bool>,
    use_tls: Option<bool>,
) -> Result<dto::TaskDto> {
    let clear_logs = clear_logs.unwrap_or(true);
    let start_now = start_now.unwrap_or(true);
    let use_tls = use_tls.unwrap_or(false);
    info!(%address, %id, clear_logs, start_now, use_tls, "restart_task called");
    let mut client = tasks_client(&*state, &address, use_tls).await.context("Failed to connect to server")?;
    let req = tonic::Request::new(crate::command::tasks_proto::RestartTaskRequest { id: id.clone(), clear_logs, start_now });
    let resp = client.restart_task(req).await.context("Failed to restart task")?;
    let task = resp.into_inner();
    info!(%address, %task.id, "restart_task completed");
    Ok(convert::task_from_proto(task))
}

#[tauri::command]
pub async fn stream_task_events(
    state: State<'_, AppState>,
    window: tauri::Window,
    address: String,
    id: String,
    use_tls: Option<bool>,
) -> Result<()> {
    let use_tls = use_tls.unwrap_or(false);
    info!(%address, %id, "stream_task_events called");
    let event_topic = format!("task-event://{}::{}", sanitize_event_segment(&address), id);

    // 提前获取 channel，避免 state 生命周期问题
    let ch = state.channel_for(
        &if address.starts_with("http://") || address.starts_with("https://") {
            address.clone()
        } else if use_tls {
            format!("https://{}", address)
        } else {
            format!("http://{}", address)
        },
        use_tls,
    ).await.context("Failed to connect to server")?;

    tauri::async_runtime::spawn(async move {
        let mut client = crate::command::tasks_proto::tasks_client::TasksClient::new(ch);
        let event_topic = event_topic.clone();

        let req = tonic::Request::new(crate::command::tasks_proto::StreamTaskEventsRequest {
            id: id.clone(),
            start_if_not_running: false,
            start_offset: 0,
            subtask_filter: vec![],
        });

        match client.stream_task_events(req).await {
            Ok(resp) => {
                let mut stream = resp.into_inner();
                while let Ok(Some(event)) = stream.message().await {
                    if let Some(dto) = convert::task_event_from_proto(event) {
                        if let Err(e) = window.emit(&event_topic, dto) {
                            tracing::error!("failed to emit event: {}", e);
                            break;
                        }
                    }
                }
            }
            Err(e) => {
                let _ = window.emit(
                    &event_topic,
                    crate::utils::dto::TaskEventDto::Error(crate::utils::dto::ErrorDto { message: e.to_string() }),
                );
            }
        }
    });

    Ok(())
}
