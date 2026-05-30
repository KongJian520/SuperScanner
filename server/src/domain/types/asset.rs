use serde::{Deserialize, Serialize};

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
