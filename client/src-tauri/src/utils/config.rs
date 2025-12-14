use anyhow::Result;
use chrono::Utc;
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use tokio::fs;
use tokio::task;
use tracing::info;
use uuid::Uuid;

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BackendRecord {
    #[serde(default)]
    pub id: String,
    pub name: String,
    pub address: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub use_tls: bool,
    #[serde(default)]
    pub created_at: i64,
}

fn config_dir() -> PathBuf {
    if let Some(mut d) = dirs::config_dir() {
        d.push("SuperScanner");
        d
    } else {
        PathBuf::from(".")
    }
}

fn backends_file() -> PathBuf {
    let mut p = config_dir();
    p.push("backends.json");
    p
}

pub async fn load_backends() -> Result<Vec<BackendRecord>> {
    let f = backends_file();
    info!(path = ?f, "load_backends called");
    if !f.exists() {
        return Ok(vec![]);
    }
    let s = fs::read_to_string(&f).await?;
    let v: Vec<BackendRecord> = serde_json::from_str(&s)?;
    info!(count = v.len(), "load_backends completed");
    Ok(v)
}

pub async fn save_backend(record: BackendRecord) -> Result<()> {
    let dir = config_dir();
    fs::create_dir_all(&dir).await?;
    let mut v = load_backends().await?;
    // preserve existing id/created_at if replacing an existing record with same name
    let mut new_record = record.clone();
    info!(name = %new_record.name, address = %new_record.address, "save_backend called");
    if let Some(existing) = v.iter().find(|r| r.name == new_record.name) {
        // preserve existing id/created_at when incoming record has empty/default values
        if new_record.id.is_empty() {
            new_record.id = existing.id.clone();
        }
        if new_record.created_at == 0 {
            new_record.created_at = existing.created_at;
        }
        // preserve description and use_tls if incoming doesn't provide them
        if new_record.description.is_none() {
            new_record.description = existing.description.clone();
        }
        if !new_record.use_tls {
            new_record.use_tls = existing.use_tls;
        }
    }

    // ensure id and created_at exist (use empty string / 0 as absence markers)
    if new_record.id.is_empty() {
        new_record.id = Uuid::new_v4().to_string();
        info!(id = %new_record.id, "assigned new id for backend");
    }
    if new_record.created_at == 0 {
        new_record.created_at = Utc::now().timestamp_millis();
        info!(created_at = new_record.created_at, "assigned created_at timestamp");
    }

    // replace records with same name (allowing multiple same-name entries if desired by id)
    v.retain(|r| r.name != new_record.name || r.id != new_record.id);
    // capture values for logging before moving the record into the vector
    let saved_name = new_record.name.clone();
    let saved_id = new_record.id.clone();
    v.push(new_record);
    let s = serde_json::to_string_pretty(&v)?;
    let path = backends_file();
    // Use blocking write with file lock inside spawn_blocking to avoid blocking the async runtime
    let s_clone = s.clone();
    task::spawn_blocking(move || -> Result<()> {
        let mut file = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&path)?;
        // exclusive lock
        file.lock_exclusive()?;
        // write and flush
        file.write_all(s_clone.as_bytes())?;
        file.flush()?;
        // unlock
        file.unlock()?;
        Ok(())
    })
    .await??;

    info!(name = %saved_name, id = %saved_id, "save_backend completed");

    Ok(())
}

pub async fn delete_backend(identifier: &str) -> Result<()> {
    // identifier may be either an id (UUID string) or a name (for backward compatibility)
    info!(identifier = %identifier, "delete_backend called");
    let mut v = load_backends().await?;
    v.retain(|r| {
        // if id matches identifier -> remove
        if r.id == identifier {
            return false;
        }
        // if name matches identifier -> remove (backward compatibility)
        if r.name == identifier {
            return false;
        }
        true
    });
    let s = serde_json::to_string_pretty(&v)?;
    let path = backends_file();
    let s_clone = s.clone();
    task::spawn_blocking(move || -> Result<()> {
        let mut file = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&path)?;
        file.lock_exclusive()?;
        file.write_all(s_clone.as_bytes())?;
        file.flush()?;
        file.unlock()?;
        Ok(())
    })
    .await??;

    info!(identifier = %identifier, "delete_backend completed");

    Ok(())
}
