// Data Transfer Objects (DTOs) used to marshal data from the backend
// into JSON-serializable structs consumed by the frontend UI.
use serde::Serialize;

#[derive(Serialize, Debug, Clone)]
pub struct NetworkInterfaceDto {
    pub name: String,
    pub ip_addresses: Vec<String>,
}

#[derive(Serialize, Debug, Clone)]
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
}

#[derive(Serialize, Debug, Clone)]
pub struct TaskDto {
    // Task properties exposed to the front-end
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub targets: Option<Vec<String>>,
    pub status: i32,
    pub progress: i32,
    pub created_at: Option<String>,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
}

/// DTO used when creating a new task (deserialized from JSON input)
#[derive(serde::Deserialize, Debug, Clone)]
pub struct CreateTaskDto {
    pub name: String,
    pub description: Option<String>,
    pub targets: Option<Vec<String>>,
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
