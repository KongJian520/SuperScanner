pub mod worker;
pub mod scheduler;

use crate::domain::traits::{CommandParser, TaskManager, TaskStore};
use crate::domain::types::{CommandSpec, RunnerEvent};
use crate::commands::CommandRegistry;
use crate::engine::scheduler::Scheduler;
use crate::error::AppError;
use async_trait::async_trait;
use chrono::Utc;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::{RwLock, broadcast, mpsc, watch};
use tracing::info;

pub struct RunnerHandle {
    pub broadcaster: broadcast::Sender<RunnerEvent>,
    #[allow(dead_code)]
    pub join_handle: tokio::task::JoinHandle<()>,
    pub stop_tx: mpsc::Sender<()>,
    pub cancel_tx: watch::Sender<bool>,
}

pub struct BackgroundTaskRunner {
    pub tasks_dir: PathBuf,
    pub store: Arc<dyn TaskStore>,
    pub running_tasks: Arc<RwLock<HashMap<String, RunnerHandle>>>,
    pub parser: Box<dyn CommandParser>,
    pub registry: CommandRegistry,
    pub scheduler: Arc<dyn Scheduler>,
}

impl BackgroundTaskRunner {
    pub fn new(tasks_dir: PathBuf, store: Arc<dyn TaskStore>, registry: CommandRegistry, scheduler: Arc<dyn Scheduler>) -> Self {
        Self {
            tasks_dir,
            store,
            running_tasks: Arc::new(RwLock::new(HashMap::new())),
            parser: Box::new(worker::SimpleCommandParser {}),
            registry,
            scheduler,
        }
    }
}

#[async_trait]
impl TaskManager for BackgroundTaskRunner {
    async fn start(&self, id: &str) -> Result<i64, AppError> {
        let (tx, _) = mpsc::channel(100);
        self.start_with_event_sink(id, tx).await
    }

    async fn start_with_event_sink(
        &self,
        id: &str,
        sink: mpsc::Sender<RunnerEvent>,
    ) -> Result<i64, AppError> {
        let mut tasks = self.running_tasks.write().await;
        if tasks.contains_key(id) {
            return Err(AppError::Task("任务已在运行中".to_string()));
        }

        let meta = self.store.get_task(id).await?.ok_or(AppError::Task("Task not found".to_string()))?;
        let task_dir = self.tasks_dir.join(id);

        let specs = if !meta.workflow.steps.is_empty() {
            let workflow = &meta.workflow;
            let mut specs = Vec::new();
            for step in &workflow.steps {
                let cmd_id = if step.tool == "builtin" {
                    match step.r#type {
                        1 => "builtin_port_scan".to_string(),
                        2 => "httpx".to_string(),
                        3 => "nuclei".to_string(),
                        _ => return Err(AppError::Config(format!("无效的 workflow step type: {}", step.r#type))),
                    }
                } else {
                    step.tool.clone()
                };

                specs.push(CommandSpec {
                    id: cmd_id.clone(),
                    program: PathBuf::from(&cmd_id),
                    targets: meta.targets.clone(),
                    args: vec![],
                    env: None,
                    cwd: Some(task_dir.clone()),
                });
            }
            specs
        } else {
            self.parser.parse(&task_dir).await?
        };

        let logs_root = task_dir.join("logs");
        tokio::fs::create_dir_all(&logs_root).await?;

        let (broadcaster, _) = broadcast::channel(1024);
        let (stop_tx, stop_rx) = mpsc::channel(1);
        let (cancel_tx, cancel_rx) = watch::channel(false);

        // 桥接 broadcast -> mpsc sink
        let mut rx = broadcaster.subscribe();
        let sink_clone = sink.clone();
        tokio::spawn(async move {
            while let Ok(event) = rx.recv().await {
                if sink_clone.send(event).await.is_err() {
                    break;
                }
            }
        });

        let store = self.store.clone();
        let task_id = id.to_string();
        let bc_clone = broadcaster.clone();
        let registry = self.registry.clone();
        let scheduler = self.scheduler.clone();

        let running_tasks_clone = self.running_tasks.clone();
        let task_id_cleanup = id.to_string();

        let join_handle = tokio::spawn(async move {
            // 入队
            let _ = scheduler.enqueue(&task_id).await;
            worker::run_task_loop(task_id.clone(), specs, store, bc_clone, stop_rx, cancel_rx, task_dir, registry, scheduler.clone()).await;

            // Cleanup: remove from running_tasks when done
            let mut tasks = running_tasks_clone.write().await;
            if tasks.remove(&task_id_cleanup).is_some() {
                info!("Task {} removed from running_tasks map (finished naturally)", task_id_cleanup);
            }
        });

        tasks.insert(
            id.to_string(),
            RunnerHandle {
                broadcaster,
                join_handle,
                stop_tx,
                cancel_tx,
            },
        );

        Ok(Utc::now().timestamp_millis())
    }

    async fn stop(&self, id: &str) -> Result<(), AppError> {
        let mut tasks = self.running_tasks.write().await;
        if let Some(handle) = tasks.remove(id) {
            let _ = handle.cancel_tx.send(true);
            let _ = handle.stop_tx.send(()).await;
        }
        Ok(())
    }

    async fn attach_event_sink(
        &self,
        id: &str,
        sink: mpsc::Sender<RunnerEvent>,
    ) -> Result<(), AppError> {
        let tasks = self.running_tasks.read().await;
        if let Some(handle) = tasks.get(id) {
            let mut rx = handle.broadcaster.subscribe();
            tokio::spawn(async move {
                while let Ok(event) = rx.recv().await {
                    if sink.send(event).await.is_err() {
                        break;
                    }
                }
            });
            Ok(())
        } else {
            Err(AppError::Task("任务未运行".to_string()))
        }
    }
}
