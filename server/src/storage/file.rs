use crate::core::traits::TaskStore;
use crate::core::types::{TaskMetadata, TaskMetadataPatch};
use crate::error::AppError;
use async_trait::async_trait;
use std::path::PathBuf;
use tokio::fs;
use tokio::io::AsyncWriteExt;

pub struct FileTaskStore {
    root_dir: PathBuf,
}

impl FileTaskStore {
    pub fn new(root_dir: PathBuf) -> Self {
        Self { root_dir }
    }

    async fn get_task_path(&self, id: &str) -> PathBuf {
        self.root_dir.join(id).join("metadata.toml")
    }

    async fn save_metadata(&self, path: &PathBuf, meta: &TaskMetadata) -> Result<(), AppError> {
        let content = toml::to_string_pretty(meta)
            .map_err(|e| AppError::Storage(format!("序列化失败: {}", e)))?;
        
        // 原子写入: 写入临时文件 -> 重命名
        let tmp_path = path.with_extension("tmp");
        let mut file = fs::File::create(&tmp_path).await
            .map_err(|e| AppError::Storage(format!("无法创建临时文件: {}", e)))?;
        file.write_all(content.as_bytes()).await
            .map_err(|e| AppError::Storage(format!("写入失败: {}", e)))?;
        file.flush().await
            .map_err(|e| AppError::Storage(format!("刷新失败: {}", e)))?;
        
        fs::rename(&tmp_path, path).await
            .map_err(|e| AppError::Storage(format!("重命名失败: {}", e)))?;
            
        Ok(())
    }
}

#[async_trait]
impl TaskStore for FileTaskStore {
    async fn list_tasks(&self) -> Result<Vec<TaskMetadata>, AppError> {
        let mut tasks = Vec::new();
        let mut entries = fs::read_dir(&self.root_dir).await
            .map_err(|e| AppError::Storage(format!("无法读取任务目录: {}", e)))?;

        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            if path.is_dir() {
                let meta_path = path.join("metadata.toml");
                if meta_path.exists() {
                    let content_res = fs::read_to_string(&meta_path).await;
                    if let Ok(content) = content_res {
                        if let Ok(meta) = toml::from_str::<TaskMetadata>(&content) {
                            tasks.push(meta);
                        }
                    }
                }
            }
        }
        
        // 按创建时间倒序排序
        tasks.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        Ok(tasks)
    }

    async fn get_task(&self, id: &str) -> Result<Option<TaskMetadata>, AppError> {
        let path = self.get_task_path(id).await;
        if !path.exists() {
            return Ok(None);
        }

        let content = fs::read_to_string(&path).await
            .map_err(|e| AppError::Storage(format!("读取任务失败: {}", e)))?;
        let meta = toml::from_str(&content)
            .map_err(|e| AppError::Storage(format!("解析任务失败: {}", e)))?;
            
        Ok(Some(meta))
    }

    async fn create_task(&self, meta: &TaskMetadata) -> Result<(), AppError> {
        let task_dir = self.root_dir.join(&meta.id);
        if !task_dir.exists() {
            fs::create_dir_all(&task_dir).await
                .map_err(|e| AppError::Storage(format!("创建任务目录失败: {}", e)))?;
        }
        
        // 创建子目录结构
        let _ = fs::create_dir_all(task_dir.join("commands")).await;
        let _ = fs::create_dir_all(task_dir.join("logs")).await;

        let path = task_dir.join("metadata.toml");
        self.save_metadata(&path, meta).await
    }

    async fn update_task(&self, id: &str, patch: &TaskMetadataPatch) -> Result<(), AppError> {
        let path = self.get_task_path(id).await;
        if !path.exists() {
            return Err(AppError::Storage("任务不存在".to_string()));
        }

        // 读取现有数据
        let content = fs::read_to_string(&path).await
            .map_err(|e| AppError::Storage(format!("读取任务失败: {}", e)))?;
        let mut meta: TaskMetadata = toml::from_str(&content)
            .map_err(|e| AppError::Storage(format!("解析任务失败: {}", e)))?;

        // 应用补丁
        if let Some(v) = &patch.name { meta.name = v.clone(); }
        if let Some(v) = &patch.description { meta.description = v.clone(); }
        if let Some(v) = &patch.targets { meta.targets = v.clone(); }
        if let Some(v) = patch.status { meta.status = v; }
        if let Some(v) = patch.exit_code { meta.exit_code = v; }
        if let Some(v) = &patch.error_message { meta.error_message = v.clone(); }
        if let Some(v) = patch.updated_at { meta.updated_at = Some(v); }
        if let Some(v) = patch.started_at { meta.started_at = Some(v); }
        if let Some(v) = patch.finished_at { meta.finished_at = Some(v); }
        if let Some(v) = &patch.log_path { meta.log_path = v.clone(); }

        self.save_metadata(&path, &meta).await
    }

    async fn delete_task(&self, id: &str) -> Result<(), AppError> {
        let task_dir = self.root_dir.join(id);
        if task_dir.exists() {
            fs::remove_dir_all(&task_dir).await
                .map_err(|e| AppError::Storage(format!("删除任务失败: {}", e)))?;
        }
        Ok(())
    }

    async fn set_status(&self, id: &str, status: i32, progress: Option<u8>, exit_code: Option<i32>, error: Option<String>, finished_at: Option<i64>) -> Result<(), AppError> {
        let patch = TaskMetadataPatch {
            status: Some(status),
            progress: Some(progress.unwrap_or(0)),
            exit_code,
            error_message: error,
            finished_at,
            updated_at: Some(chrono::Utc::now().timestamp_millis()),
            ..Default::default()
        };
        self.update_task(id, &patch).await
    }

    async fn reset_task_for_restart(&self, id: &str, now_ms: i64) -> Result<TaskMetadata, AppError> {
        let path = self.get_task_path(id).await;
        if !path.exists() {
            return Err(AppError::Storage("任务不存在".to_string()));
        }

        let content = fs::read_to_string(&path).await
            .map_err(|e| AppError::Storage(format!("读取任务失败: {}", e)))?;
        let mut meta: TaskMetadata = toml::from_str(&content)
            .map_err(|e| AppError::Storage(format!("解析任务失败: {}", e)))?;

        meta.status = 1; // PENDING
        meta.exit_code = 0;
        meta.error_message = String::new();
        meta.started_at = None;
        meta.finished_at = None;
        meta.updated_at = Some(now_ms);

        self.save_metadata(&path, &meta).await?;
        Ok(meta)
    }
}
