// Data Transfer Objects (DTOs) used to marshal data from the backend
// into JSON-serializable structs consumed by the frontend UI.
use serde::Serialize;

/// 网络接口 DTO，包含接口名称和 IP 地址列表
#[derive(Serialize, Debug, Clone)]
pub struct NetworkInterfaceDto {
    pub name: String,
    pub ip_addresses: Vec<String>,
}

/// 服务端信息 DTO，包含主机名、操作系统、资源使用情况、工具能力和 nuclei 模板状态
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

/// 工具能力 DTO，声明工具是否可用及其来源路径
#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ToolCapabilityDto {
    pub tool_id: String,
    pub available: bool,
    pub source: String,
    pub path: String,
}

/// nuclei 模板状态 DTO，包含来源、路径和同步信息
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

/// 工作流步骤 DTO，定义每一步的类型和使用的工具
#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
pub struct WorkflowStepDto {
    pub r#type: i32,
    pub tool: String,
}

/// 工作流 DTO，包含多个有序执行的步骤
#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
pub struct WorkflowDto {
    pub steps: Vec<WorkflowStepDto>,
}

/// 扫描结果 DTO，包含 IP、端口、协议、状态和服务信息
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

/// 安全发现 DTO，包含漏洞类型、严重级别、IP/端口和元数据
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

/// 任务 DTO，包含任务名称、状态、进度、工作流、扫描结果和发现列表
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

/// 创建任务时使用的输入 DTO（反序列化自 JSON 输入）
#[derive(serde::Deserialize, Debug, Clone)]
pub struct CreateTaskDto {
    /// 任务名称
    pub name: String,
    /// 可选的任务描述
    pub description: Option<String>,
    /// 扫描目标列表
    pub targets: Option<Vec<String>>,
    /// 工作流定义
    pub workflow: WorkflowDto,
}

/// 任务流式事件 DTO，按类型分为进度、日志、快照和错误
#[derive(Serialize, Debug, Clone)]
#[serde(tag = "type", content = "payload")]
pub enum TaskEventDto {
    /// 进度更新事件
    Progress(ProgressDto),
    /// 日志输出事件
    Log(LogChunkDto),
    /// 任务快照事件（包含完整任务状态）
    TaskSnapshot(TaskDto),
    /// 错误事件
    Error(ErrorDto),
}

/// 进度 DTO，包含完成百分比和状态描述
#[derive(Serialize, Debug, Clone)]
pub struct ProgressDto {
    pub percent: i32,
    pub message: String,
    pub ts: Option<String>,
}

/// 日志片段 DTO，包含子任务名、文本内容和是否标准错误输出
#[derive(Serialize, Debug, Clone)]
pub struct LogChunkDto {
    pub subtask: String,
    pub text: String,
    pub is_stderr: bool,
    pub offset: i64,
    pub ts: Option<String>,
}

/// 错误 DTO，包含错误消息字符串
#[derive(Serialize, Debug, Clone)]
pub struct ErrorDto {
    pub message: String,
}
