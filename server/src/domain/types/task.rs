use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use super_scanner_shared::models::TaskStatus;

use super::workflow::{Workflow, DomainPipelineState};

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
    pub workflow: Workflow,
    #[serde(default)]
    pub domain_state: DomainPipelineState,
}

impl TaskMetadata {
    /// 将 i32 状态码转换为 TaskStatus 枚举
    pub fn status_enum(&self) -> Option<TaskStatus> {
        TaskStatus::from_i32(self.status)
    }

    /// 将 TaskStatus 枚举写回 i32 状态码
    pub fn set_status_enum(&mut self, status: TaskStatus) {
        self.status = status.as_i32();
    }
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
    pub domain_state: Option<DomainPipelineState>,
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

/// 运行器事件：扫描过程中产生的各类事件，通过 channel 推送给 gRPC 流
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub enum RunnerEvent {
    /// 进度更新（百分比）
    Progress {
        percent: u8,
        ts: i64,
    },
    /// 日志输出（stdout / stderr）
    Log {
        subtask: String,
        data: Vec<u8>,
        is_stderr: bool,
        offset: i64,
        ts: i64,
    },
    /// 进程退出
    Exit {
        code: i32,
        ts: i64,
    },
    /// 快照：携带任务结束后的最终元数据
    Snapshot {
        meta: TaskMetadata,
        ts: i64,
    },
    /// 错误事件
    Error {
        message: String,
        ts: i64,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn task_metadata_backwards_compatible_without_domain_state() {
        let raw = r#"
    id = "task-1"
    name = "n"
    description = ""
    targets = []
    status = 1
    progress = 0
    exit_code = 0
    error_message = ""
    created_at = 1
    updated_at = 2
    started_at = 3
    finished_at = 4
    log_path = ""

    [workflow]
    steps = []
    "#;
        let meta: TaskMetadata = toml::from_str(raw).expect("legacy metadata should deserialize");
        assert_eq!(meta.domain_state, DomainPipelineState::default());
    }
}
