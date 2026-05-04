// Data Transfer Objects (DTOs) used to marshal data from the backend
// into JSON-serializable structs consumed by the frontend UI.
use serde::Serialize;

#[derive(Serialize, Debug, Clone)]
pub struct NetworkInterfaceDto {
    pub name: String,
    pub ip_addresses: Vec<String>,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ServerInfoDto {
    pub hostname: String,
    pub os: String,
    pub uptime_seconds: Option<u64>,
    pub cpu_cores: Option<u32>,
    pub memory_total_bytes: Option<u64>,
    pub memory_free_bytes: Option<u64>,
    pub version: Option<String>,
    pub load_average: Vec<f64>,
    pub disk_total_bytes: Option<u64>,
    pub disk_free_bytes: Option<u64>,
    pub tools: Vec<ToolCapabilityDto>,
    pub nuclei_templates: Option<NucleiTemplatesStatusDto>,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ToolCapabilityDto {
    pub tool_id: String,
    pub available: bool,
    pub source: String,
    pub path: String,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NucleiTemplatesStatusDto {
    pub source: String,
    pub configured_local_path: String,
    pub effective_path: String,
    pub repo_url: String,
    pub cache_path: String,
    pub last_sync_unix: i64,
    pub last_error: String,
    pub sync_supported: bool,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
pub struct WorkflowStepDto {
    pub r#type: i32,
    pub tool: String,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
pub struct WorkflowDto {
    pub steps: Vec<WorkflowStepDto>,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ScanResultDto {
    pub ip: String,
    pub port: i32,
    pub protocol: String,
    pub state: String,
    pub service: String,
    pub tool: String,
    pub timestamp: String,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FindingDto {
    pub id: i64,
    pub dedupe_key: String,
    pub finding_type: String,
    pub severity: String,
    pub title: String,
    pub detail: String,
    pub ip: String,
    pub port: i32,
    pub protocol: String,
    pub source_tool: String,
    pub source_command: String,
    pub metadata_json: String,
    pub occurrences: i64,
    pub first_seen_at: String,
    pub last_seen_at: String,
    pub updated_at: String,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TaskDto {
    // Task properties exposed to the front-end
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub targets: Option<Vec<String>>,
    pub status: i32,
    pub exit_code: Option<i32>,
    pub error_message: Option<String>,
    pub progress: i32,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub workflow: WorkflowDto,
    pub results: Vec<ScanResultDto>,
    pub findings: Vec<FindingDto>,
}

/// DTO used when creating a new task (deserialized from JSON input)
#[derive(serde::Deserialize, Debug, Clone)]
pub struct CreateTaskDto {
    pub name: String,
    pub description: Option<String>,
    pub targets: Option<Vec<String>>,
    pub workflow: WorkflowDto,
}

#[derive(Serialize, Debug, Clone)]
#[serde(tag = "type", content = "payload")]
pub enum TaskEventDto {
    Progress(ProgressDto),
    Log(LogChunkDto),
    TaskSnapshot(TaskDto),
    Error(ErrorDto),
}

#[derive(Serialize, Debug, Clone)]
pub struct ProgressDto {
    pub percent: i32,
    pub message: String,
    pub ts: Option<String>,
}

#[derive(Serialize, Debug, Clone)]
pub struct LogChunkDto {
    pub subtask: String,
    pub text: String,
    pub is_stderr: bool,
    pub offset: i64,
    pub ts: Option<String>,
}

#[derive(Serialize, Debug, Clone)]
pub struct ErrorDto {
    pub message: String,
}
