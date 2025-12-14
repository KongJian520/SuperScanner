use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

/// 任务元数据
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TaskMetadata {
    pub id: String,
    pub name: String,
    pub description: String,
    pub targets: Vec<String>,
    pub status: i32,
    #[serde(default)]
    pub progress: u8,
    pub exit_code: i32,
    pub error_message: String,
    pub created_at: i64,
    pub updated_at: Option<i64>,
    pub started_at: Option<i64>,
    pub finished_at: Option<i64>,
    pub log_path: String,
}

/// 任务元数据更新补丁
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[allow(dead_code)]
pub struct TaskMetadataPatch {
    pub name: Option<String>,
    pub description: Option<String>,
    pub targets: Option<Vec<String>>,
    pub status: Option<i32>,
    pub progress: Option<u8>,
    pub exit_code: Option<i32>,
    pub error_message: Option<String>,
    pub updated_at: Option<i64>,
    pub started_at: Option<i64>,
    pub finished_at: Option<i64>,
    pub log_path: Option<String>,
}

/// 命令执行规范
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandSpec {
    pub id: String,
    pub program: PathBuf,
    pub targets: Vec<String>,
    pub args: Vec<String>,
    #[allow(dead_code)]
    pub env: Option<HashMap<String, String>>,
    pub cwd: Option<PathBuf>,
}

/// 运行器事件
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub enum RunnerEvent {
    Progress {
        percent: u8,
        ts: i64,
    },
    Log {
        subtask: String,
        data: Vec<u8>,
        is_stderr: bool,
        offset: i64,
        ts: i64,
    },
    Exit {
        code: i32,
        ts: i64,
    },
    /// 快照携带任务结束后的最终元数据
    Snapshot {
        meta: TaskMetadata,
        ts: i64,
    },
    Error {
        message: String,
        ts: i64,
    },
}
