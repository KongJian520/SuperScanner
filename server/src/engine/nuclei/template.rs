use serde::{Deserialize, Serialize};

/// Nuclei 模板的完整结构
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NucleiTemplate {
    /// 模板唯一标识
    pub id: String,
    /// 模板元信息
    pub info: TemplateInfo,
    /// HTTP 请求定义列表
    #[serde(default)]
    pub http: Vec<HttpRequest>,
}

/// 模板元信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemplateInfo {
    /// 模板名称
    pub name: String,
    /// 严重级别（info/low/medium/high/critical）
    pub severity: String,
    /// 模板描述
    #[serde(default)]
    pub description: Option<String>,
    /// 标签（逗号分隔）
    #[serde(default)]
    pub tags: Option<String>,
    /// 作者
    #[serde(default)]
    pub author: Option<String>,
    /// 参考链接
    #[serde(default)]
    pub reference: Vec<String>,
    /// 额外元数据
    #[serde(default)]
    pub metadata: Option<TemplateMetadata>,
}

/// 模板的额外元数据
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemplateMetadata {
    /// 是否已验证
    #[serde(default)]
    pub verified: Option<bool>,
    /// 最大请求数
    #[serde(rename = "max-request", default)]
    pub max_request: Option<u32>,
    /// 厂商
    #[serde(default)]
    pub vendor: Option<String>,
    /// 产品
    #[serde(default)]
    pub product: Option<String>,
}

/// HTTP 请求定义
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HttpRequest {
    /// HTTP 方法（GET/POST 等）
    #[serde(default)]
    pub method: Option<String>,
    /// 请求路径列表
    #[serde(default)]
    pub path: Vec<String>,
    /// 原始 HTTP 请求列表
    #[serde(default)]
    pub raw: Vec<String>,
    /// 自定义请求头
    #[serde(default)]
    pub headers: std::collections::HashMap<String, String>,
    /// 请求体
    #[serde(default)]
    pub body: Option<String>,
    /// 匹配器条件（and/or）
    #[serde(rename = "matchers-condition", default)]
    pub matchers_condition: Option<String>,
    /// 匹配器列表
    #[serde(default)]
    pub matchers: Option<Vec<Matcher>>,
    /// 提取器列表
    #[serde(default)]
    pub extractors: Option<Vec<Extractor>>,
    /// 首次匹配后是否停止
    #[serde(rename = "stop-at-first-match", default)]
    pub stop_at_first_match: Option<bool>,
    /// 是否跟随重定向
    #[serde(default)]
    pub redirects: Option<bool>,
    /// 是否跟随主机级别重定向
    #[serde(rename = "host-redirects", default)]
    pub host_redirects: Option<bool>,
    /// 最大重定向次数
    #[serde(rename = "max-redirects", default)]
    pub max_redirects: Option<usize>,
}

impl HttpRequest {
    /// 匹配器条件是否为 and
    pub fn matchers_condition_and(&self) -> bool {
        self.matchers_condition
            .as_deref()
            .map(|c| c.eq_ignore_ascii_case("and"))
            .unwrap_or(false)
    }

    /// 匹配器条件是否为 or
    pub fn matchers_condition_or(&self) -> bool {
        self.matchers_condition
            .as_deref()
            .map(|c| c.eq_ignore_ascii_case("or"))
            .unwrap_or(true)
    }

    /// 是否存在原始 HTTP 请求
    pub fn has_raw(&self) -> bool {
        !self.raw.is_empty()
    }

    /// 是否指定了命名 HTTP 方法
    pub fn has_named_method(&self) -> bool {
        self.method.is_some()
    }

    /// 获取有效的请求路径列表（raw 优先于 path）
    pub fn effective_paths(&self) -> &[String] {
        if self.has_raw() {
            &self.raw
        } else {
            &self.path
        }
    }
}

/// 匹配器定义，支持 word/regex/status/size/dsl 等多种匹配类型
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Matcher {
    /// 匹配器类型（word/regex/status/size/dsl）
    #[serde(rename = "type")]
    pub matcher_type: String,
    /// 匹配的目标部分（body/header/all）
    #[serde(default)]
    pub part: Option<String>,
    /// 关键词匹配列表
    #[serde(default)]
    pub words: Option<Vec<String>>,
    /// 正则匹配列表
    #[serde(default)]
    pub regex: Option<Vec<String>>,
    /// 状态码匹配列表
    #[serde(default)]
    pub status: Option<Vec<u16>>,
    /// DSL 表达式匹配列表
    #[serde(default)]
    pub dsl: Option<Vec<String>>,
    /// 匹配条件（and/or）
    #[serde(default)]
    pub condition: Option<String>,
    /// 是否为否定匹配
    #[serde(default)]
    pub negative: Option<bool>,
    /// 是否忽略大小写
    #[serde(rename = "case-insensitive", default)]
    pub case_insensitive: Option<bool>,
}

impl Matcher {
    /// 匹配条件是否为 and
    pub fn condition_and(&self) -> bool {
        self.condition
            .as_deref()
            .map(|c| c.eq_ignore_ascii_case("and"))
            .unwrap_or(false)
    }

    /// 匹配条件是否为 or
    pub fn condition_or(&self) -> bool {
        self.condition
            .as_deref()
            .map(|c| c.eq_ignore_ascii_case("or"))
            .unwrap_or(true)
    }

    /// 是否为否定匹配
    pub fn is_negative(&self) -> bool {
        self.negative.unwrap_or(false)
    }

    /// 是否忽略大小写
    pub fn is_case_insensitive(&self) -> bool {
        self.case_insensitive.unwrap_or(false)
    }
}

/// 提取器定义，支持 regex/json/kval 提取方式
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Extractor {
    /// 提取器类型（regex/json/kval）
    #[serde(rename = "type")]
    pub extractor_type: String,
    /// 提取结果名称
    #[serde(default)]
    pub name: Option<String>,
    /// 正则提取模式列表
    #[serde(default)]
    pub regex: Option<Vec<String>>,
    /// JSON 路径提取列表
    #[serde(default)]
    pub json: Option<Vec<String>>,
    /// 提取目标部分（body/header/all）
    #[serde(default)]
    pub part: Option<String>,
    /// 正则捕获组编号
    #[serde(default)]
    pub group: Option<u32>,
}

/// 匹配结果
#[derive(Debug, Clone)]
pub struct MatchResult {
    /// 匹配的模板 ID
    pub template_id: String,
    /// 模板名称
    pub name: String,
    /// 严重级别
    pub severity: String,
    /// 匹配的目标 URL
    pub matched_at: String,
    /// 匹配器名称
    pub matcher_name: Option<String>,
    /// 提取器结果映射
    pub extractors: std::collections::HashMap<String, Vec<String>>,
    /// 匹配详情
    pub detail: String,
}

/// 模板过滤器，支持按标签和严重级别筛选
#[derive(Debug, Clone, Default)]
pub struct TemplateFilter {
    /// 最低严重级别
    pub severity_min: Option<String>,
    /// 需要包含的标签列表（取交集）
    pub tags_include: Vec<String>,
    /// 需要排除的标签列表
    pub tags_exclude: Vec<String>,
    /// 指定模板 ID 列表（优先级最高）
    pub template_ids: Option<Vec<String>>,
}

/// 标准化严重级别字符串
pub fn normalize_severity(severity: &str) -> &str {
    match severity.to_lowercase().as_str() {
        "critical" => "critical",
        "high" => "high",
        "medium" => "medium",
        "low" => "low",
        "info" | "informational" | "unknown" => "info",
        _ => "info",
    }
}

/// 严重级别权重值（critical=5, high=4, medium=3, low=2, info=1）
pub fn severity_weight(severity: &str) -> u8 {
    match severity.to_lowercase().as_str() {
        "critical" => 5,
        "high" => 4,
        "medium" => 3,
        "low" => 2,
        "info" | "informational" | "unknown" => 1,
        _ => 0,
    }
}
