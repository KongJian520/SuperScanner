use std::io;
use std::path::Path;
use std::sync::Arc;
use tonic::async_trait;

#[derive(Debug, Clone)]
pub struct ProjectMetadata {
    pub id: String,
    pub name: String,
    pub description: String,
    pub status: String,
    // created_at is optional; RFC3339 if present
    pub created_at: Option<String>,
}
