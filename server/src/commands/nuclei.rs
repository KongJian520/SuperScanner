use super::ScannerCommand;
use crate::domain::types::CommandSpec;
use crate::error::AppError;
use crate::nuclei_templates::NucleiTemplatesManager;
use crate::rules::{ParseFormat, RuleLoader, ToolRuleSchema};
use crate::storage::task_db::{self, NewFinding};
use async_trait::async_trait;
use serde_json::Value;
use sqlx::sqlite::SqlitePool;
use std::collections::HashMap;
use std::path::PathBuf;
use tokio::process::Command;
use tracing::warn;

#[derive(Clone)]
pub struct NucleiCommand {
    binary: String,
    rule_loader: RuleLoader,
    templates_manager: NucleiTemplatesManager,
}

impl NucleiCommand {
    pub fn new(binary: String, templates_manager: NucleiTemplatesManager) -> Self {
        Self {
            binary,
            rule_loader: RuleLoader::default(),
            templates_manager,
        }
    }

    fn load_rule(&self) -> Result<ToolRuleSchema, AppError> {
        self.rule_loader
            .load("nuclei")
            .map_err(|e| AppError::Config(format!("加载 nuclei 规则失败: {}", e)))
    }

    fn build_target_args(rule: &ToolRuleSchema, target: &str) -> Vec<String> {
        rule.command
            .args_template
            .iter()
            .map(|arg| arg.replace("{{target}}", target))
            .collect()
    }
}

#[derive(Debug, Clone)]
struct ParsedNucleiRecord {
    target: String,
    template_id: String,
    severity: String,
    name: String,
    finding_type: String,
    ip: Option<String>,
    port: Option<i64>,
    protocol: Option<String>,
    detail: String,
    metadata_json: String,
}

fn sanitize_target_file_name(target: &str) -> String {
    target
        .chars()
        .map(|c| match c {
            '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            _ => c,
        })
        .collect()
}

fn string_from_json_value(v: &Value) -> Option<String> {
    match v {
        Value::String(s) => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        Value::Bool(b) => Some(b.to_string()),
        _ => None,
    }
}

fn object_get_string(object: &serde_json::Map<String, Value>, key: &str) -> Option<String> {
    object.get(key).and_then(string_from_json_value)
}

fn extract_mapped_fields(
    object: &serde_json::Map<String, Value>,
    mappings: &HashMap<String, String>,
) -> HashMap<String, String> {
    let mut out = HashMap::new();
    for (raw_key, normalized_key) in mappings {
        if let Some(value) = object.get(raw_key).and_then(string_from_json_value) {
            out.insert(normalized_key.clone(), value);
        }
    }
    out
}

fn apply_normalize_maps(
    mut fields: HashMap<String, String>,
    maps: &HashMap<String, HashMap<String, String>>,
) -> HashMap<String, String> {
    for (field, normalize_map) in maps {
        if let Some(current) = fields.get(field).cloned() {
            let mapped = normalize_map
                .get(&current)
                .cloned()
                .or_else(|| normalize_map.get(&current.to_ascii_lowercase()).cloned());
            if let Some(v) = mapped {
                fields.insert(field.clone(), v);
            }
        }
    }
    fields
}

fn parse_endpoint_fields(target: &str) -> (Option<String>, Option<i64>, Option<String>) {
    let trimmed = target.trim();
    if trimmed.is_empty() {
        return (None, None, None);
    }

    let (scheme_opt, rest) = if let Some((scheme, remain)) = trimmed.split_once("://") {
        (Some(scheme.to_ascii_lowercase()), remain)
    } else {
        (None, trimmed)
    };

    let authority = rest.split('/').next().unwrap_or_default();
    if authority.is_empty() {
        return (None, None, scheme_opt);
    }

    if authority.starts_with('[') {
        if let Some(end_idx) = authority.find(']') {
            let host = authority[1..end_idx].to_string();
            let remain = &authority[end_idx + 1..];
            let port = remain
                .strip_prefix(':')
                .and_then(|port_text| port_text.parse::<i64>().ok());
            return (Some(host), port, scheme_opt);
        }
    }

    if let Some((host, port_text)) = authority.rsplit_once(':') {
        if !host.contains(':') {
            if let Ok(port) = port_text.parse::<i64>() {
                return (Some(host.to_string()), Some(port), scheme_opt);
            }
        }
    }

    (Some(authority.to_string()), None, scheme_opt)
}

fn build_dedupe_key(record: &ParsedNucleiRecord) -> String {
    format!(
        "nuclei|{}|{}|{}",
        record.target.trim().to_ascii_lowercase(),
        record.template_id.trim().to_ascii_lowercase(),
        record.name.trim().to_ascii_lowercase()
    )
}

fn build_parsed_record(
    line: &str,
    rule: &ToolRuleSchema,
    source_file: &str,
    line_no: usize,
) -> Result<ParsedNucleiRecord, AppError> {
    let value: Value = serde_json::from_str(line).map_err(|e| {
        AppError::Task(format!(
            "解析 nuclei JSON 失败 ({}:{}): {}",
            source_file, line_no, e
        ))
    })?;
    let object = value.as_object().ok_or_else(|| {
        AppError::Task(format!(
            "nuclei 输出不是 JSON 对象 ({}:{})",
            source_file, line_no
        ))
    })?;

    let mapped = extract_mapped_fields(object, &rule.parse.field_mappings);
    let normalized = apply_normalize_maps(mapped, &rule.normalize.maps);

    let target = normalized
        .get("target")
        .cloned()
        .or_else(|| object_get_string(object, "matched-at"))
        .or_else(|| object_get_string(object, "matched_at"))
        .or_else(|| object_get_string(object, "target"))
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .ok_or_else(|| {
            AppError::Task(format!(
                "nuclei 输出缺少 target ({}:{})",
                source_file, line_no
            ))
        })?;

    let template_id = normalized
        .get("template_id")
        .cloned()
        .or_else(|| object_get_string(object, "template-id"))
        .or_else(|| object_get_string(object, "template_id"))
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .ok_or_else(|| {
            AppError::Task(format!(
                "nuclei 输出缺少 template_id ({}:{})",
                source_file, line_no
            ))
        })?;

    let severity = normalized
        .get("severity")
        .cloned()
        .or_else(|| object_get_string(object, "severity"))
        .or_else(|| {
            object
                .get("info")
                .and_then(Value::as_object)
                .and_then(|info| object_get_string(info, "severity"))
        })
        .map(|v| v.trim().to_ascii_lowercase())
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| "info".to_string());
    let severity = rule
        .normalize
        .maps
        .get("severity")
        .and_then(|m| m.get(&severity))
        .cloned()
        .unwrap_or(severity);

    let name = normalized
        .get("name")
        .cloned()
        .or_else(|| object_get_string(object, "name"))
        .or_else(|| {
            object
                .get("info")
                .and_then(Value::as_object)
                .and_then(|info| object_get_string(info, "name"))
        })
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| template_id.clone());
    let finding_type = normalized
        .get("type")
        .cloned()
        .or_else(|| object_get_string(object, "type"))
        .map(|v| v.trim().to_ascii_lowercase())
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| "vulnerability".to_string());

    let (ip, port, protocol) = parse_endpoint_fields(&target);
    let detail = format!("template_id={}, matched_at={}", template_id, target);

    Ok(ParsedNucleiRecord {
        target,
        template_id,
        severity,
        name,
        finding_type,
        ip,
        port,
        protocol,
        detail,
        metadata_json: value.to_string(),
    })
}

#[async_trait]
impl ScannerCommand for NucleiCommand {
    fn id(&self) -> &'static str {
        "nuclei"
    }

    fn description(&self) -> &'static str {
        "Nuclei POC Scanner"
    }

    fn build_spec(&self, targets: &[String], args: &[String]) -> CommandSpec {
        let default_args = self
            .load_rule()
            .map(|r| r.command.args_template)
            .unwrap_or_default();
        let mut merged_args = if args.is_empty() {
            default_args
        } else {
            args.to_vec()
        };
        if merged_args.is_empty() {
            merged_args = vec![
                "-silent".to_string(),
                "-jsonl".to_string(),
                "-u".to_string(),
                "{{target}}".to_string(),
            ];
        }

        CommandSpec {
            id: "nuclei".to_string(),
            program: PathBuf::from(&self.binary),
            args: merged_args,
            targets: targets.to_vec(),
            env: None,
            cwd: None,
        }
    }

    async fn init_db(&self, pool: &SqlitePool) -> Result<(), AppError> {
        task_db::ensure_findings_table(pool).await
    }

    async fn execute_target(
        &self,
        target: &str,
        task_dir: &PathBuf,
        _pool: &SqlitePool,
    ) -> Result<(), AppError> {
        let rule = self.load_rule()?;
        let mut args = Self::build_target_args(&rule, target);
        let has_templates_arg = args
            .iter()
            .any(|a| a == "-t" || a == "-templates" || a.starts_with("-t=") || a.starts_with("-templates="));
        if !has_templates_arg {
            if let Some(template_dir) = self.templates_manager.effective_template_dir().await {
                args.push("-t".to_string());
                args.push(template_dir);
            }
        }
        let output = Command::new(&self.binary)
            .args(&args)
            .output()
            .await
            .map_err(|e| AppError::Task(format!("启动 nuclei 失败 [{}]: {}", target, e)))?;

        if !output.status.success() {
            let code = output.status.code().unwrap_or(-1);
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            return Err(AppError::Task(format!(
                "nuclei 执行失败 [{}] (exit={}): stderr='{}' stdout='{}'",
                target, code, stderr, stdout
            )));
        }

        let raw_dir = task_dir.join("commands").join(self.id()).join("raw");
        tokio::fs::create_dir_all(&raw_dir).await.map_err(|e| {
            AppError::Io(std::io::Error::new(
                e.kind(),
                format!("无法创建 nuclei 输出目录 {}: {}", raw_dir.display(), e),
            ))
        })?;

        let output_path = raw_dir.join(format!("{}.jsonl", sanitize_target_file_name(target)));
        tokio::fs::write(&output_path, &output.stdout)
            .await
            .map_err(|e| {
                AppError::Io(std::io::Error::new(
                    e.kind(),
                    format!("写入 nuclei 原始输出失败 {}: {}", output_path.display(), e),
                ))
            })?;

        Ok(())
    }

    async fn process_result(&self, task_dir: &PathBuf) -> Result<(), AppError> {
        let rule = self.load_rule()?;
        if rule.parse.format != ParseFormat::Jsonl {
            return Err(AppError::Config(format!(
                "nuclei 当前仅支持 jsonl 解析，实际为 {:?}",
                rule.parse.format
            )));
        }

        let raw_dir = task_dir.join("commands").join(self.id()).join("raw");
        if !raw_dir.exists() {
            return Ok(());
        }

        let pool = task_db::open_targets_db(task_dir).await?;
        let mut entries = tokio::fs::read_dir(&raw_dir).await.map_err(|e| {
            AppError::Io(std::io::Error::new(
                e.kind(),
                format!("读取 nuclei 输出目录失败 {}: {}", raw_dir.display(), e),
            ))
        })?;

        while let Some(entry) = entries.next_entry().await.map_err(|e| {
            AppError::Io(std::io::Error::new(
                e.kind(),
                format!("遍历 nuclei 输出目录失败 {}: {}", raw_dir.display(), e),
            ))
        })? {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) != Some("jsonl") {
                continue;
            }

            let content = tokio::fs::read_to_string(&path).await.map_err(|e| {
                AppError::Io(std::io::Error::new(
                    e.kind(),
                    format!("读取 nuclei 输出文件失败 {}: {}", path.display(), e),
                ))
            })?;

            for (idx, line) in content.lines().enumerate() {
                if line.trim().is_empty() {
                    continue;
                }

                let record = match build_parsed_record(
                    line,
                    &rule,
                    path.to_string_lossy().as_ref(),
                    idx + 1,
                ) {
                    Ok(v) => v,
                    Err(err) => {
                        warn!("{}", err);
                        continue;
                    }
                };

                let finding = NewFinding {
                    dedupe_key: Some(build_dedupe_key(&record)),
                    finding_type: record.finding_type,
                    severity: record.severity,
                    title: record.name,
                    detail: Some(record.detail),
                    ip: record.ip,
                    port: record.port,
                    protocol: record.protocol,
                    source_tool: Some("nuclei".to_string()),
                    source_command: Some(self.binary.clone()),
                    metadata_json: Some(record.metadata_json),
                };

                task_db::insert_or_update_finding(&pool, &finding).await?;
            }
        }
        pool.close().await;

        Ok(())
    }

    fn box_clone(&self) -> Box<dyn ScannerCommand> {
        Box::new(self.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_spec_uses_rule_defaults() {
        let cmd = NucleiCommand::new(
            "nuclei".to_string(),
            NucleiTemplatesManager::new(crate::config::NucleiTemplatesConfig {
                local_path: None,
                cache_path: "cache".to_string(),
                repo_url: "repo".to_string(),
            }),
        );
        let spec = cmd.build_spec(&["127.0.0.1".to_string()], &[]);
        assert_eq!(spec.id, "nuclei");
        assert!(spec.args.iter().any(|v| v == "-jsonl"));
        assert!(spec.args.iter().any(|v| v == "{{target}}"));
    }

    #[test]
    fn test_parse_nuclei_record_success() {
        let cmd = NucleiCommand::new(
            "nuclei".to_string(),
            NucleiTemplatesManager::new(crate::config::NucleiTemplatesConfig {
                local_path: None,
                cache_path: "cache".to_string(),
                repo_url: "repo".to_string(),
            }),
        );
        let rule = cmd.load_rule().expect("rule should load");
        let line = r#"{"template_id":"cve-2024-0001","info":{"severity":"high","name":"Test vuln"},"type":"http","matched_at":"http://10.0.0.1:8080"}"#;

        let parsed =
            build_parsed_record(line, &rule, "sample.jsonl", 1).expect("record should parse");
        assert_eq!(parsed.template_id, "cve-2024-0001");
        assert_eq!(parsed.severity, "high");
        assert_eq!(parsed.name, "Test vuln");
        assert_eq!(parsed.finding_type, "http");
        assert_eq!(parsed.ip.as_deref(), Some("10.0.0.1"));
        assert_eq!(parsed.port, Some(8080));
        assert_eq!(parsed.protocol.as_deref(), Some("http"));
    }

    #[test]
    fn test_parse_nuclei_record_missing_required_field() {
        let cmd = NucleiCommand::new(
            "nuclei".to_string(),
            NucleiTemplatesManager::new(crate::config::NucleiTemplatesConfig {
                local_path: None,
                cache_path: "cache".to_string(),
                repo_url: "repo".to_string(),
            }),
        );
        let rule = cmd.load_rule().expect("rule should load");
        let line = r#"{"severity":"low","name":"no template id","target":"https://example.com"}"#;
        let err = build_parsed_record(line, &rule, "sample.jsonl", 3).expect_err("should fail");
        assert!(err.to_string().contains("template_id"));
    }
}
