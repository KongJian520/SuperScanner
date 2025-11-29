use std::io;
use std::path::Path;
use std::sync::Arc;
use async_trait::async_trait;
use crate::project_store::ProjectMetadata;

pub mod sqlite_db;



#[derive(thiserror::Error, Debug)]
pub enum StoreError {
    #[error("not found")]
    NotFound,
    #[error("already exists")]
    AlreadyExists,
    #[error("io: {0}")]
    Io(#[from] io::Error),
    #[error("invalid input: {0}")]
    InvalidInput(String),
    #[error("data_store: {0}")]
    Db(String),
}

#[async_trait]
pub trait ProjectStore: Send + Sync + 'static {
    async fn create(&self, name: String, description: String) -> Result<ProjectMetadata, StoreError>;
    async fn get(&self, id: &str) -> Result<ProjectMetadata, StoreError>;
    async fn list(&self) -> Result<Vec<ProjectMetadata>, StoreError>;
    async fn update(&self, id: &str, name: Option<String>, description: Option<String>) -> Result<ProjectMetadata, StoreError>;
    async fn delete(&self, id: &str) -> Result<bool, StoreError>;
    // update the task status string (e.g. PENDING, RUNNING, DONE, FAILED)
    async fn set_status(&self, id: &str, status: &str) -> Result<(), StoreError>;
    fn root(&self) -> &Path;
}
pub type SharedStore = Arc<dyn ProjectStore>;
