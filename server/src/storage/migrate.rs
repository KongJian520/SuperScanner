use crate::storage::{TaskMetadata};
use anyhow::Context;
use std::path::Path;
use tokio::fs;
use toml;

pub async fn migrate_toml_to_sqlite(root: &Path, store: &dyn crate::storage::TaskStore) -> anyhow::Result<()> {
    // list directories under root/tasks
    let tasks_dir = root.join("tasks");
    if !tasks_dir.exists() {
        return Ok(());
    }

    let mut entries = fs::read_dir(&tasks_dir).await.context("read tasks dir failed")?;
    while let Some(entry) = entries.next_entry().await.context("read dir entry failed")? {
        if !entry.file_type().await.context("get file type failed")?.is_dir() {
            continue;
        }
        let dirname = entry.file_name().to_string_lossy().to_string();
        let task_dir = entry.path();
        if dirname.contains(".migrated.") {
            continue;
        }
        let toml_path = task_dir.join("metadata.toml");
        if !toml_path.exists() {
            continue;
        }
        let content = fs::read_to_string(&toml_path).await.context("read metadata failed")?;
        let meta: TaskMetadata = toml::from_str(&content).context("parse metadata toml failed")?;
        // insert into sqlite
        let _ = store.create_task(&meta).await;
        // mark migrated
        let _ = fs::write(task_dir.join(format!(".migrated.{}", chrono::Utc::now().timestamp_millis())), "").await;
    }
    Ok(())
}

