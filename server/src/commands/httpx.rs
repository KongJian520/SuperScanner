use super::ScannerCommand;
use crate::domain::types::CommandSpec;
use crate::error::AppError;
use crate::rules::{ParseFormat, RuleLoader, ToolRuleSchema};
use crate::storage::task_db::{self, NewFinding};
use async_trait::async_trait;
use serde_json::Value;
use sqlx::sqlite::SqlitePool;
use std::collections::HashMap;
use std::path::PathBuf;
use tokio::process::Command;

#[derive(Clone)]
pub struct HttpxCommand {
    binary: String,
    rule_loader: RuleLoader,
}

impl HttpxCommand {
    pub fn new(binary: String) -> Self {
        Self {
            binary,
            rule_loader: RuleLoader::default(),
        }
    }

    fn load_rule(&self) -> Result<ToolRuleSchema, AppError> {
        self.rule_loader
            .load("httpx")
            .map_err(|e| AppError::Config(format!("加载 httpx 规则失败: {}", e)))
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
struct ParsedHttpxRecord {
    target: String,
    host: String,
    url: String,
    title: Option<String>,
    status_code: Option<i32>,
    scheme: String,
    port: i32,
}

fn string_from_json_value(v: &Value) -> Option<String> {
    match v {
        Value::String(s) => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        Value::Bool(b) => Some(b.to_string()),
        _ => None,
    }
}

fn extract_mapped_fields(
    object: &serde_json::Map<String, Value>,
    mappings: &HashMap<String, String>,
) -> HashMap<String, String> {
    let mut out = HashMap::new();
    for (raw_key, normalized_key) in mappings {
        if let Some(value) =
            extract_json_value_by_path(object, raw_key).and_then(string_from_json_value)
        {
            out.insert(normalized_key.clone(), value);
        }
    }
    out
}

fn extract_json_value_by_path<'a>(
    object: &'a serde_json::Map<String, Value>,
    path: &str,
) -> Option<&'a Value> {
    let mut iter = path.split('.');
    let first = iter.next()?;
    let mut current = object.get(first)?;
    for key in iter {
        current = current.as_object()?.get(key)?;
    }
    Some(current)
}

fn apply_normalize_maps(
    mut fields: HashMap<String, String>,
    maps: &HashMap<String, HashMap<String, String>>,
) -> HashMap<String, String> {
    for (field, normalize_map) in maps {
        if let Some(current) = fields.get(field).cloned() {
            if let Some(mapped) = normalize_map.get(&current) {
                fields.insert(field.clone(), mapped.clone());
            }
        }
    }
    fields
}

fn parse_url_host_port(url: &str) -> (Option<String>, Option<String>, Option<i32>) {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return (None, None, None);
    }

    let (scheme_opt, rest) = if let Some((scheme, remain)) = trimmed.split_once("://") {
        (Some(scheme.to_string()), remain)
    } else {
        (None, trimmed)
    };

    let authority = rest.split('/').next().unwrap_or_default();
    if authority.is_empty() {
        return (scheme_opt, None, None);
    }

    if authority.starts_with('[') {
        if let Some(end_idx) = authority.find(']') {
            let host = authority[1..end_idx].to_string();
            let remain = &authority[end_idx + 1..];
            if let Some(port_text) = remain.strip_prefix(':') {
                if let Ok(port) = port_text.parse::<i32>() {
                    return (scheme_opt, Some(host), Some(port));
                }
            }
            return (scheme_opt, Some(host), None);
        }
    }

    if let Some((host, port_text)) = authority.rsplit_once(':') {
        if !host.contains(':') {
            if let Ok(port) = port_text.parse::<i32>() {
                return (scheme_opt, Some(host.to_string()), Some(port));
            }
        }
    }

    (scheme_opt, Some(authority.to_string()), None)
}

fn default_port_for_scheme(scheme: &str) -> i32 {
    match scheme {
        "https" => 443,
        _ => 80,
    }
}

fn build_parsed_record(
    line: &str,
    rule: &ToolRuleSchema,
    source_file: &str,
    line_no: usize,
) -> Result<ParsedHttpxRecord, AppError> {
    let value: Value = serde_json::from_str(line).map_err(|e| {
        AppError::Task(format!(
            "解析 httpx JSON 失败 ({}:{}): {}",
            source_file, line_no, e
        ))
    })?;
    let object = value.as_object().ok_or_else(|| {
        AppError::Task(format!(
            "httpx 输出不是 JSON 对象 ({}:{})",
            source_file, line_no
        ))
    })?;

    let mapped = extract_mapped_fields(object, &rule.parse.field_mappings);
    let normalized = apply_normalize_maps(mapped, &rule.normalize.maps);
    if !rule
        .persist
        .targets
        .iter()
        .any(|field| normalized.contains_key(field))
    {
        return Err(AppError::Task(format!(
            "httpx 输出不包含可持久化字段 ({}:{})",
            source_file, line_no
        )));
    }

    let raw_target = normalized.get("target").cloned().unwrap_or_default();
    let raw_host = normalized.get("host").cloned().unwrap_or_default();
    let raw_url = normalized.get("url").cloned().unwrap_or_default();

    if raw_target.is_empty() && raw_host.is_empty() && raw_url.is_empty() {
        return Err(AppError::Task(format!(
            "httpx 输出缺少 target/host/url ({}:{})",
            source_file, line_no
        )));
    }

    let (url_scheme, url_host, url_port) = parse_url_host_port(&raw_url);

    let host = if !raw_host.is_empty() {
        raw_host
    } else if let Some(h) = url_host {
        h
    } else {
        raw_target.clone()
    };

    let target = if !raw_target.is_empty() {
        raw_target
    } else {
        host.clone()
    };

    let mut scheme = normalized
        .get("scheme")
        .cloned()
        .or(url_scheme)
        .unwrap_or_else(|| "http".to_string());
    scheme = rule
        .normalize
        .maps
        .get("scheme")
        .and_then(|m| m.get(&scheme))
        .cloned()
        .unwrap_or(scheme);

    let status_code = normalized
        .get("status_code")
        .and_then(|v| v.parse::<i32>().ok());

    let port = url_port.unwrap_or_else(|| default_port_for_scheme(&scheme));
    let title = normalized
        .get("title")
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty());

    Ok(ParsedHttpxRecord {
        target,
        host,
        url: raw_url,
        title,
        status_code,
        scheme,
        port,
    })
}

fn should_write_finding(record: &ParsedHttpxRecord) -> bool {
    record.title.is_some() || record.status_code.map(|c| c >= 400).unwrap_or(false)
}

fn finding_severity(status_code: Option<i32>) -> &'static str {
    match status_code.unwrap_or_default() {
        500..=599 => "high",
        401 | 403 => "medium",
        400..=499 => "low",
        _ => "info",
    }
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

#[async_trait]
impl ScannerCommand for HttpxCommand {
    fn id(&self) -> &'static str {
        "httpx"
    }

    fn description(&self) -> &'static str {
        "HTTPX Fingerprint Scanner"
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
                "-json".to_string(),
                "-u".to_string(),
                "{{target}}".to_string(),
            ];
        }

        CommandSpec {
            id: "httpx".to_string(),
            program: PathBuf::from(&self.binary),
            args: merged_args,
            targets: targets.to_vec(),
            env: None,
            cwd: None,
        }
    }

    async fn init_db(&self, pool: &SqlitePool) -> Result<(), AppError> {
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS port_results (
                ip TEXT,
                port INTEGER,
                protocol TEXT,
                state TEXT,
                service TEXT,
                tool TEXT,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (ip, port, protocol)
            )",
        )
        .execute(pool)
        .await
        .map_err(|e| AppError::Storage(format!("无法创建 port_results 表: {}", e)))?;

        task_db::ensure_findings_table(pool).await?;

        Ok(())
    }

    async fn execute_target(
        &self,
        target: &str,
        task_dir: &PathBuf,
        _pool: &SqlitePool,
    ) -> Result<(), AppError> {
        let rule = self.load_rule()?;
        let args = Self::build_target_args(&rule, target);

        let output = Command::new(&self.binary)
            .args(&args)
            .output()
            .await
            .map_err(|e| AppError::Task(format!("启动 httpx 失败 [{}]: {}", target, e)))?;

        if !output.status.success() {
            let code = output.status.code().unwrap_or(-1);
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            return Err(AppError::Task(format!(
                "httpx 执行失败 [{}] (exit={}): stderr='{}' stdout='{}'",
                target, code, stderr, stdout
            )));
        }

        let raw_dir = task_dir.join("commands").join(self.id()).join("raw");
        tokio::fs::create_dir_all(&raw_dir).await.map_err(|e| {
            AppError::Io(std::io::Error::new(
                e.kind(),
                format!("无法创建 httpx 输出目录 {}: {}", raw_dir.display(), e),
            ))
        })?;

        let output_path = raw_dir.join(format!("{}.jsonl", sanitize_target_file_name(target)));
        tokio::fs::write(&output_path, &output.stdout)
            .await
            .map_err(|e| {
                AppError::Io(std::io::Error::new(
                    e.kind(),
                    format!("写入 httpx 原始输出失败 {}: {}", output_path.display(), e),
                ))
            })?;

        Ok(())
    }

    async fn process_result(&self, task_dir: &PathBuf) -> Result<(), AppError> {
        let rule = self.load_rule()?;
        if rule.parse.format != ParseFormat::Jsonl {
            return Err(AppError::Config(format!(
                "httpx 当前仅支持 jsonl 解析，实际为 {:?}",
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
                format!("读取 httpx 输出目录失败 {}: {}", raw_dir.display(), e),
            ))
        })?;

        while let Some(entry) = entries.next_entry().await.map_err(|e| {
            AppError::Io(std::io::Error::new(
                e.kind(),
                format!("遍历 httpx 输出目录失败 {}: {}", raw_dir.display(), e),
            ))
        })? {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) != Some("jsonl") {
                continue;
            }

            let content = tokio::fs::read_to_string(&path).await.map_err(|e| {
                AppError::Io(std::io::Error::new(
                    e.kind(),
                    format!("读取 httpx 输出文件失败 {}: {}", path.display(), e),
                ))
            })?;

            for (idx, line) in content.lines().enumerate() {
                if line.trim().is_empty() {
                    continue;
                }

                let record =
                    build_parsed_record(line, &rule, path.to_string_lossy().as_ref(), idx + 1)?;

                let state = match record.status_code {
                    Some(code) if code >= 400 => "error",
                    Some(_) => "open",
                    None => "open",
                };

                sqlx::query(
                    "INSERT OR REPLACE INTO port_results (ip, port, protocol, state, service, tool)
                     VALUES (?, ?, ?, ?, ?, ?)",
                )
                .bind(&record.target)
                .bind(record.port)
                .bind(&record.scheme)
                .bind(state)
                .bind("http")
                .bind("httpx")
                .execute(&pool)
                .await
                .map_err(|e| AppError::Storage(format!("写入 httpx port_results 失败: {}", e)))?;

                if should_write_finding(&record) {
                    let title = record.title.clone().unwrap_or_else(|| {
                        format!(
                            "HTTP {} on {}",
                            record.status_code.unwrap_or_default(),
                            record.host
                        )
                    });
                    let detail = format!(
                        "url={}, status_code={}",
                        if record.url.is_empty() {
                            "-"
                        } else {
                            record.url.as_str()
                        },
                        record
                            .status_code
                            .map(|s| s.to_string())
                            .unwrap_or_else(|| "-".to_string())
                    );
                    let finding = NewFinding {
                        dedupe_key: None,
                        finding_type: "http_response".to_string(),
                        severity: finding_severity(record.status_code).to_string(),
                        title,
                        detail: Some(detail),
                        ip: Some(record.target.clone()),
                        port: Some(record.port as i64),
                        protocol: Some(record.scheme.clone()),
                        source_tool: Some("httpx".to_string()),
                        source_command: Some("httpx".to_string()),
                        metadata_json: Some(
                            serde_json::json!({
                                "url": record.url,
                                "status_code": record.status_code
                            })
                            .to_string(),
                        ),
                    };
                    task_db::insert_or_update_finding(&pool, &finding).await?;
                }
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
        let cmd = HttpxCommand::new("httpx".to_string());
        let spec = cmd.build_spec(&["127.0.0.1".to_string()], &[]);
        assert_eq!(spec.id, "httpx");
        assert!(spec.args.iter().any(|v| v == "-json"));
        assert!(spec.args.iter().any(|v| v == "{{target}}"));
    }

    #[test]
    fn test_parse_httpx_record_success() {
        let cmd = HttpxCommand::new("httpx".to_string());
        let rule = cmd.load_rule().expect("rule should load");
        let line = r#"{"input":"10.0.0.1","host":"10.0.0.1","url":"https://10.0.0.1:8443/login","status_code":401,"title":"Login"}"#;

        let parsed = build_parsed_record(line, &rule, "sample.jsonl", 1).expect("record should parse");
        assert_eq!(parsed.target, "10.0.0.1");
        assert_eq!(parsed.host, "10.0.0.1");
        assert_eq!(parsed.scheme, "https");
        assert_eq!(parsed.port, 8443);
        assert_eq!(parsed.status_code, Some(401));
        assert_eq!(parsed.title.as_deref(), Some("Login"));
    }

    #[test]
    fn test_parse_httpx_record_uses_url_host_when_host_missing() {
        let cmd = HttpxCommand::new("httpx".to_string());
        let rule = cmd.load_rule().expect("rule should load");
        let line = r#"{"url":"http://example.com/admin","status_code":200}"#;

        let parsed = build_parsed_record(line, &rule, "sample.jsonl", 2).expect("record should parse");
        assert_eq!(parsed.target, "example.com");
        assert_eq!(parsed.host, "example.com");
        assert_eq!(parsed.scheme, "http");
        assert_eq!(parsed.port, 80);
    }

    #[test]
    fn test_parse_httpx_record_missing_target_host_url() {
        let cmd = HttpxCommand::new("httpx".to_string());
        let rule = cmd.load_rule().expect("rule should load");
        let line = r#"{"status_code":500}"#;

        let err = build_parsed_record(line, &rule, "sample.jsonl", 3).expect_err("should fail");
        assert!(err.to_string().contains("target/host/url"));
    }
}
