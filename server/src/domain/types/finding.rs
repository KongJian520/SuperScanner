use serde::{Deserialize, Serialize};

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
