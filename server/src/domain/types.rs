use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use super_scanner_shared::models::TaskStatus;

/// 工作流步骤：一个扫描阶段中使用的单个工具
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WorkflowStep {
    /// 步骤类型（1=端口扫描，2=指纹识别，3=漏洞验证）
    pub r#type: i32,
    /// 工具 ID（如 builtin / httpx / nuclei）
    pub tool: String,
}

/// 扫描工作流，由多个步骤组成，按添加顺序执行
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct Workflow {
    pub steps: Vec<WorkflowStep>,
}

impl WorkflowStep {
    /// 将步骤类型映射到对应的领域阶段
    pub fn domain_stage(&self) -> Option<DomainStage> {
        DomainStage::from_workflow_step_type(self.r#type)
    }
}

impl Workflow {
    /// 返回去重后的有序领域阶段列表，末尾自动追加 Reporting 阶段
    pub fn ordered_domain_stages(&self) -> Vec<DomainStage> {
        let mut stages = Vec::new();
        for stage in self.steps.iter().filter_map(WorkflowStep::domain_stage) {
            if !stages.contains(&stage) {
                stages.push(stage);
            }
        }
        if !stages.is_empty() && !stages.contains(&DomainStage::Reporting) {
            stages.push(DomainStage::Reporting);
        }
        stages
    }

    /// 根据工作流第一个有效阶段初始化流水线状态
    pub fn initial_domain_state(&self) -> DomainPipelineState {
        let mut state = DomainPipelineState::default();
        if let Some(stage) = self.ordered_domain_stages().first().copied() {
            state.current_stage = stage;
        }
        state
    }
}

/// 领域阶段：扫描流水线的四个阶段
#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum DomainStage {
    /// 资产发现
    #[default]
    AssetDiscovery,
    /// 指纹识别
    Fingerprinting,
    /// 漏洞分析
    VulnerabilityAnalysis,
    /// 报告生成
    Reporting,
}

impl DomainStage {
    /// 将工作流步骤类型编号映射为领域阶段
    pub fn from_workflow_step_type(step_type: i32) -> Option<Self> {
        match step_type {
            1 => Some(Self::AssetDiscovery),
            2 => Some(Self::Fingerprinting),
            3 => Some(Self::VulnerabilityAnalysis),
            _ => None,
        }
    }

    fn order(self) -> u8 {
        match self {
            Self::AssetDiscovery => 0,
            Self::Fingerprinting => 1,
            Self::VulnerabilityAnalysis => 2,
            Self::Reporting => 3,
        }
    }
}

/// 领域流水线状态：追踪当前阶段和各项计数
#[derive(Debug, Serialize, Deserialize, Clone, Default, PartialEq, Eq)]
pub struct DomainPipelineState {
    /// 当前所处的领域阶段
    #[serde(default)]
    pub current_stage: DomainStage,
    /// 已发现的资产数量
    #[serde(default)]
    pub assets_discovered: u32,
    /// 已采集的指纹数量
    #[serde(default)]
    pub fingerprints_collected: u32,
    /// 已识别的漏洞数量
    #[serde(default)]
    pub findings_identified: u32,
    /// 已生成的报告数量
    #[serde(default)]
    pub reports_generated: u32,
}

impl DomainPipelineState {
    /// 向前推进阶段，不允许回退
    pub fn advance_stage(&mut self, next: DomainStage) -> bool {
        if next.order() < self.current_stage.order() {
            return false;
        }
        self.current_stage = next;
        true
    }
}

/// 资产类型
#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum AssetKind {
    /// 主机
    #[default]
    Host,
    /// Web 服务
    WebService,
    /// 通用服务
    Service,
    /// 其他类型
    Other,
}

/// 漏洞严重程度
#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum FindingSeverity {
    /// 信息
    #[default]
    Info,
    /// 低危
    Low,
    /// 中危
    Medium,
    /// 高危
    High,
    /// 严重
    Critical,
}

/// 漏洞状态（生命周期追踪）
#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum FindingState {
    /// 未处理
    #[default]
    Open,
    /// 已确认
    Confirmed,
    /// 已修复
    Resolved,
    /// 误报
    FalsePositive,
}

/// 资产记录
#[derive(Debug, Serialize, Deserialize, Clone, Default, PartialEq, Eq)]
pub struct AssetRecord {
    pub asset_id: String,
    pub task_id: String,
    pub address: String,
    #[serde(default)]
    pub kind: AssetKind,
    pub first_seen_at: i64,
    pub last_seen_at: Option<i64>,
}

/// 服务指纹
#[derive(Debug, Serialize, Deserialize, Clone, Default, PartialEq, Eq)]
pub struct ServiceFingerprint {
    pub fingerprint_id: String,
    pub asset_id: String,
    pub port: i32,
    pub protocol: String,
    pub service: String,
    pub product: String,
    pub version: String,
    pub confidence: u8,
    pub observed_at: i64,
}

/// 领域层漏洞发现（与存储层 FindingRow 互补，面向业务语义）
#[derive(Debug, Serialize, Deserialize, Clone, Default, PartialEq, Eq)]
pub struct VulnerabilityFinding {
    pub finding_id: String,
    pub task_id: String,
    pub asset_id: String,
    pub template_id: String,
    pub title: String,
    #[serde(default)]
    pub severity: FindingSeverity,
    #[serde(default)]
    pub state: FindingState,
    pub description: String,
    pub evidence: String,
    #[serde(default)]
    pub references: Vec<String>,
    pub discovered_at: i64,
    pub resolved_at: Option<i64>,
}

/// 漏洞报告汇总
#[derive(Debug, Serialize, Deserialize, Clone, Default, PartialEq, Eq)]
pub struct VulnerabilityReport {
    pub report_id: String,
    pub task_id: String,
    pub generated_at: i64,
    pub asset_count: u32,
    pub fingerprint_count: u32,
    pub finding_count: u32,
    pub critical_count: u32,
    pub summary: String,
}

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
    fn workflow_step_maps_to_domain_stage() {
        assert_eq!(
            WorkflowStep {
                r#type: 1,
                tool: "builtin".to_string()
            }
            .domain_stage(),
            Some(DomainStage::AssetDiscovery)
        );
        assert_eq!(
            WorkflowStep {
                r#type: 2,
                tool: "httpx".to_string()
            }
            .domain_stage(),
            Some(DomainStage::Fingerprinting)
        );
        assert_eq!(
            WorkflowStep {
                r#type: 3,
                tool: "nuclei".to_string()
            }
            .domain_stage(),
            Some(DomainStage::VulnerabilityAnalysis)
        );
    }

    #[test]
    fn workflow_builds_ordered_domain_stages() {
        let workflow = Workflow {
            steps: vec![
                WorkflowStep {
                    r#type: 1,
                    tool: "builtin".to_string(),
                },
                WorkflowStep {
                    r#type: 2,
                    tool: "httpx".to_string(),
                },
                WorkflowStep {
                    r#type: 2,
                    tool: "httpx".to_string(),
                },
                WorkflowStep {
                    r#type: 3,
                    tool: "nuclei".to_string(),
                },
            ],
        };

        assert_eq!(
            workflow.ordered_domain_stages(),
            vec![
                DomainStage::AssetDiscovery,
                DomainStage::Fingerprinting,
                DomainStage::VulnerabilityAnalysis,
                DomainStage::Reporting
            ]
        );
    }

    #[test]
    fn domain_state_only_allows_forward_transition() {
        let mut state = DomainPipelineState::default();
        assert!(state.advance_stage(DomainStage::Fingerprinting));
        assert!(!state.advance_stage(DomainStage::AssetDiscovery));
    }

    #[test]
    fn workflow_initial_state_uses_first_valid_stage() {
        let workflow = Workflow {
            steps: vec![
                WorkflowStep {
                    r#type: 99,
                    tool: "unknown".to_string(),
                },
                WorkflowStep {
                    r#type: 2,
                    tool: "httpx".to_string(),
                },
            ],
        };

        let state = workflow.initial_domain_state();
        assert_eq!(state.current_stage, DomainStage::Fingerprinting);
    }

    #[test]
    fn workflow_without_known_stages_keeps_default_initial_state() {
        let workflow = Workflow {
            steps: vec![WorkflowStep {
                r#type: 99,
                tool: "unknown".to_string(),
            }],
        };

        let state = workflow.initial_domain_state();
        assert_eq!(state.current_stage, DomainStage::AssetDiscovery);
    }

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
