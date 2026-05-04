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
use tracing::warn;

#[derive(Clone)]
pub struct FscanCommand {
    binary: String,
    rule_loader: RuleLoader,
}

impl FscanCommand {
    pub fn new(binary: String) -> Self {
        Self {
            binary,
            rule_loader: RuleLoader::default(),
        }
    }

    fn load_rule(&self) -> Result<ToolRuleSchema, AppError> {
        self.rule_loader
            .load("fscan")
            .map_err(|e| AppError::Config(format!("加载 fscan 规则失败: {}", e)))
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
struct ParsedFscanRecord {
    target: String,
    port: i32,
    protocol: String,
    service: String,
    banner: Option<String>,
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

fn parse_port(raw: &str) -> Option<i32> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Ok(v) = trimmed.parse::<i32>() {
        return Some(v);
    }
    let candidate = trimmed
        .split('/')
        .next()
        .unwrap_or_default()
        .trim()
        .parse::<i32>()
        .ok()?;
    Some(candidate)
}

fn build_parsed_record(
    line: &str,
    rule: &ToolRuleSchema,
    source_file: &str,
    line_no: usize,
) -> Result<ParsedFscanRecord, AppError> {
    let value: Value = serde_json::from_str(line).map_err(|e| {
        AppError::Task(format!(
            "解析 fscan JSON 失败 ({}:{}): {}",
            source_file, line_no, e
        ))
    })?;
    let object = value.as_object().ok_or_else(|| {
        AppError::Task(format!(
            "fscan 输出不是 JSON 对象 ({}:{})",
            source_file, line_no
        ))
    })?;

    let mapped = extract_mapped_fields(object, &rule.parse.field_mappings);
    let normalized = apply_normalize_maps(mapped, &rule.normalize.maps);

    let target = normalized
        .get("target")
        .or_else(|| normalized.get("host"))
        .cloned()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            AppError::Task(format!(
                "fscan 输出缺少 target ({}:{})",
                source_file, line_no
            ))
        })?;

    let port = normalized
        .get("port")
        .and_then(|v| parse_port(v))
        .ok_or_else(|| {
            AppError::Task(format!(
                "fscan 输出缺少或无效 port ({}:{})",
                source_file, line_no
            ))
        })?;

    let protocol = normalized
        .get("protocol")
        .cloned()
        .map(|s| s.trim().to_ascii_lowercase())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "tcp".to_string());

    let protocol = rule
        .normalize
        .maps
        .get("protocol")
        .and_then(|m| m.get(&protocol))
        .cloned()
        .unwrap_or(protocol);

    let service = normalized
        .get("service")
        .cloned()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "unknown".to_string());

    let banner = normalized
        .get("banner")
        .cloned()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    Ok(ParsedFscanRecord {
        target,
        port,
        protocol,
        service,
        banner,
        metadata_json: value.to_string(),
    })
}

#[async_trait]
impl ScannerCommand for FscanCommand {
    fn id(&self) -> &'static str {
        "fscan"
    }

    fn description(&self) -> &'static str {
        "Fscan Fast Internal Scanner"
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
                "-json".to_string(),
                "-h".to_string(),
                "{{target}}".to_string(),
            ];
        }

        CommandSpec {
            id: "fscan".to_string(),
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
            .map_err(|e| AppError::Task(format!("启动 fscan 失败 [{}]: {}", target, e)))?;

        if !output.status.success() {
            let code = output.status.code().unwrap_or(-1);
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            return Err(AppError::Task(format!(
                "fscan 执行失败 [{}] (exit={}): stderr='{}' stdout='{}'",
                target, code, stderr, stdout
            )));
        }

        let raw_dir = task_dir.join("commands").join(self.id()).join("raw");
        tokio::fs::create_dir_all(&raw_dir).await.map_err(|e| {
            AppError::Io(std::io::Error::new(
                e.kind(),
                format!("无法创建 fscan 输出目录 {}: {}", raw_dir.display(), e),
            ))
        })?;

        let output_path = raw_dir.join(format!("{}.jsonl", sanitize_target_file_name(target)));
        tokio::fs::write(&output_path, &output.stdout)
            .await
            .map_err(|e| {
                AppError::Io(std::io::Error::new(
                    e.kind(),
                    format!("写入 fscan 原始输出失败 {}: {}", output_path.display(), e),
                ))
            })?;

        Ok(())
    }

    async fn process_result(&self, task_dir: &PathBuf) -> Result<(), AppError> {
        let rule = self.load_rule()?;
        if rule.parse.format != ParseFormat::Jsonl {
            return Err(AppError::Config(format!(
                "fscan 当前仅支持 jsonl 解析，实际为 {:?}",
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
                format!("读取 fscan 输出目录失败 {}: {}", raw_dir.display(), e),
            ))
        })?;

        while let Some(entry) = entries.next_entry().await.map_err(|e| {
            AppError::Io(std::io::Error::new(
                e.kind(),
                format!("遍历 fscan 输出目录失败 {}: {}", raw_dir.display(), e),
            ))
        })? {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) != Some("jsonl") {
                continue;
            }

            let content = tokio::fs::read_to_string(&path).await.map_err(|e| {
                AppError::Io(std::io::Error::new(
                    e.kind(),
                    format!("读取 fscan 输出文件失败 {}: {}", path.display(), e),
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

                sqlx::query(
                    "INSERT OR REPLACE INTO port_results (ip, port, protocol, state, service, tool)
                     VALUES (?, ?, ?, ?, ?, ?)",
                )
                .bind(&record.target)
                .bind(record.port)
                .bind(&record.protocol)
                .bind("open")
                .bind(&record.service)
                .bind("fscan")
                .execute(&pool)
                .await
                .map_err(|e| AppError::Storage(format!("写入 fscan port_results 失败: {}", e)))?;

                let finding = NewFinding {
                    dedupe_key: Some(format!(
                        "fscan|{}|{}|{}",
                        record.target.to_ascii_lowercase(),
                        record.port,
                        record.protocol.to_ascii_lowercase()
                    )),
                    finding_type: "open_port".to_string(),
                    severity: "info".to_string(),
                    title: format!(
                        "Open {} port {}",
                        record.protocol.to_ascii_uppercase(),
                        record.port
                    ),
                    detail: Some(format!(
                        "service={}, banner={}",
                        record.service,
                        record.banner.as_deref().unwrap_or("-")
                    )),
                    ip: Some(record.target),
                    port: Some(record.port as i64),
                    protocol: Some(record.protocol),
                    source_tool: Some("fscan".to_string()),
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
        let cmd = FscanCommand::new("fscan".to_string());
        let spec = cmd.build_spec(&["127.0.0.1".to_string()], &[]);
        assert_eq!(spec.id, "fscan");
        assert!(spec.args.iter().any(|v| v == "-json"));
        assert!(spec.args.iter().any(|v| v == "{{target}}"));
    }

    #[test]
    fn test_parse_fscan_record_success() {
        let cmd = FscanCommand::new("fscan".to_string());
        let rule = cmd.load_rule().expect("rule should load");
        let line =
            r#"{"host":"10.0.0.1","port":445,"protocol":"tcp","service":"smb","banner":"SMBv2"}"#;
        let parsed =
            build_parsed_record(line, &rule, "sample.jsonl", 1).expect("record should parse");
        assert_eq!(parsed.target, "10.0.0.1");
        assert_eq!(parsed.port, 445);
        assert_eq!(parsed.protocol, "tcp");
        assert_eq!(parsed.service, "smb");
        assert_eq!(parsed.banner.as_deref(), Some("SMBv2"));
    }

    #[test]
    fn test_parse_fscan_record_missing_port() {
        let cmd = FscanCommand::new("fscan".to_string());
        let rule = cmd.load_rule().expect("rule should load");
        let line = r#"{"host":"10.0.0.1","protocol":"tcp","service":"smb"}"#;
        let err = build_parsed_record(line, &rule, "sample.jsonl", 2).expect_err("should fail");
        assert!(err.to_string().contains("port"));
    }
}
