use serde::{Deserialize, Serialize};

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
}
