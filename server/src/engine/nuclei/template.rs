use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NucleiTemplate {
    pub id: String,
    pub info: TemplateInfo,
    #[serde(default)]
    pub http: Vec<HttpRequest>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemplateInfo {
    pub name: String,
    pub severity: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub tags: Option<String>,
    #[serde(default)]
    pub author: Option<String>,
    #[serde(default)]
    pub reference: Vec<String>,
    #[serde(default)]
    pub metadata: Option<TemplateMetadata>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemplateMetadata {
    #[serde(default)]
    pub verified: Option<bool>,
    #[serde(rename = "max-request", default)]
    pub max_request: Option<u32>,
    #[serde(default)]
    pub vendor: Option<String>,
    #[serde(default)]
    pub product: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HttpRequest {
    #[serde(default)]
    pub method: Option<String>,
    #[serde(default)]
    pub path: Vec<String>,
    #[serde(default)]
    pub raw: Vec<String>,
    #[serde(default)]
    pub headers: std::collections::HashMap<String, String>,
    #[serde(default)]
    pub body: Option<String>,
    #[serde(rename = "matchers-condition", default)]
    pub matchers_condition: Option<String>,
    #[serde(default)]
    pub matchers: Option<Vec<Matcher>>,
    #[serde(default)]
    pub extractors: Option<Vec<Extractor>>,
    #[serde(rename = "stop-at-first-match", default)]
    pub stop_at_first_match: Option<bool>,
    #[serde(default)]
    pub redirects: Option<bool>,
    #[serde(rename = "host-redirects", default)]
    pub host_redirects: Option<bool>,
    #[serde(rename = "max-redirects", default)]
    pub max_redirects: Option<usize>,
}

impl HttpRequest {
    pub fn matchers_condition_and(&self) -> bool {
        self.matchers_condition
            .as_deref()
            .map(|c| c.eq_ignore_ascii_case("and"))
            .unwrap_or(false)
    }

    pub fn matchers_condition_or(&self) -> bool {
        self.matchers_condition
            .as_deref()
            .map(|c| c.eq_ignore_ascii_case("or"))
            .unwrap_or(true)
    }

    pub fn has_raw(&self) -> bool {
        !self.raw.is_empty()
    }

    pub fn has_named_method(&self) -> bool {
        self.method.is_some()
    }

    pub fn effective_paths(&self) -> &[String] {
        if self.has_raw() {
            &self.raw
        } else {
            &self.path
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Matcher {
    #[serde(rename = "type")]
    pub matcher_type: String,
    #[serde(default)]
    pub part: Option<String>,
    #[serde(default)]
    pub words: Option<Vec<String>>,
    #[serde(default)]
    pub regex: Option<Vec<String>>,
    #[serde(default)]
    pub status: Option<Vec<u16>>,
    #[serde(default)]
    pub dsl: Option<Vec<String>>,
    #[serde(default)]
    pub condition: Option<String>,
    #[serde(default)]
    pub negative: Option<bool>,
    #[serde(rename = "case-insensitive", default)]
    pub case_insensitive: Option<bool>,
}

impl Matcher {
    pub fn condition_and(&self) -> bool {
        self.condition
            .as_deref()
            .map(|c| c.eq_ignore_ascii_case("and"))
            .unwrap_or(false)
    }

    pub fn condition_or(&self) -> bool {
        self.condition
            .as_deref()
            .map(|c| c.eq_ignore_ascii_case("or"))
            .unwrap_or(true)
    }

    pub fn is_negative(&self) -> bool {
        self.negative.unwrap_or(false)
    }

    pub fn is_case_insensitive(&self) -> bool {
        self.case_insensitive.unwrap_or(false)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Extractor {
    #[serde(rename = "type")]
    pub extractor_type: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub regex: Option<Vec<String>>,
    #[serde(default)]
    pub json: Option<Vec<String>>,
    #[serde(default)]
    pub part: Option<String>,
    #[serde(default)]
    pub group: Option<u32>,
}

#[derive(Debug, Clone)]
pub struct MatchResult {
    pub template_id: String,
    pub name: String,
    pub severity: String,
    pub matched_at: String,
    pub matcher_name: Option<String>,
    pub extractors: std::collections::HashMap<String, Vec<String>>,
    pub detail: String,
}

#[derive(Debug, Clone, Default)]
pub struct TemplateFilter {
    pub severity_min: Option<String>,
    pub tags_include: Vec<String>,
    pub tags_exclude: Vec<String>,
    pub template_ids: Option<Vec<String>>,
}

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
