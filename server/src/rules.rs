use serde::Deserialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use thiserror::Error;

/// 完整的工具规则架构，包含元数据、命令、解析、规范化和持久化规则
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ToolRuleSchema {
    /// 工具元数据
    pub tool: ToolMetadata,
    /// 命令执行规则
    pub command: CommandRule,
    /// 输出解析规则
    pub parse: ParseRule,
    /// 字段值规范化规则
    pub normalize: NormalizeRule,
    /// 持久化规则
    pub persist: PersistRule,
}

/// 工具的元数据：标识符、名称和描述
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ToolMetadata {
    /// 工具的唯一标识符（如 "nmap"、"httpx"）
    pub id: String,
    /// 工具的可读名称
    pub name: String,
    /// 工具的可选描述
    pub description: Option<String>,
}

/// 命令规则，定义工具的执行参数模板
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommandRule {
    /// 参数模板列表，其中必须包含 `{{target}}` 占位符
    pub args_template: Vec<String>,
}

/// 解析规则，定义输出格式和字段映射关系
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParseRule {
    /// 输出解析格式（json/jsonl/csv）
    pub format: ParseFormat,
    /// 原始字段名到统一字段名的映射
    pub field_mappings: HashMap<String, String>,
}

/// 解析格式，支持 JSON、JSONL 和 CSV
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ParseFormat {
    /// JSON 格式
    Json,
    /// JSONL（每行一个 JSON 对象）格式
    Jsonl,
    /// CSV 格式
    Csv,
}

/// 规范化规则，定义字段值的映射转换（如将不同输出统一为标准枚举值）
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct NormalizeRule {
    /// 字段名到映射表的字典，用于将工具输出的原始值映射为标准值
    pub maps: HashMap<String, HashMap<String, String>>,
}

/// 持久化规则，定义需要持久化到数据库的字段列表
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PersistRule {
    /// 需要持久化的目标字段名列表（须在 field_mappings 中有对应的映射）
    pub targets: Vec<String>,
}

/// 规则加载错误枚举，覆盖 IO 错误、解析错误和校验错误
#[derive(Debug, Error)]
pub enum RuleLoadError {
    /// IO 错误：无法读取规则文件
    #[error("无法读取规则文件 {path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    /// TOML 解析错误：规则文件语法错误
    #[error("规则文件 TOML 解析失败 {path}: {source}")]
    Parse {
        path: PathBuf,
        #[source]
        source: toml::de::Error,
    },
    /// 校验错误：规则内容不符合规范
    #[error("规则文件校验失败 {path}: {message}")]
    Validation { path: PathBuf, message: String },
}

/// 规则加载器，从指定目录加载 TOML 格式的工具规则文件
#[derive(Debug, Clone)]
pub struct RuleLoader {
    rules_dir: PathBuf,
}

impl RuleLoader {
    /// 创建一个新的规则加载器，指定规则文件目录
    pub fn new(rules_dir: PathBuf) -> Self {
        Self { rules_dir }
    }

    /// 返回默认的规则文件目录（`resources/rules`）
    pub fn default_rules_dir() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("rules")
    }

    /// 加载指定工具的规则，返回解析并校验后的 ToolRuleSchema
    pub fn load(&self, tool: &str) -> Result<ToolRuleSchema, RuleLoadError> {
        let path = self.rules_dir.join(format!("{tool}.toml"));
        self.load_from_path(&path, tool)
    }

    fn load_from_path(
        &self,
        path: &Path,
        expected_tool: &str,
    ) -> Result<ToolRuleSchema, RuleLoadError> {
        let text = std::fs::read_to_string(path).map_err(|source| RuleLoadError::Io {
            path: path.to_path_buf(),
            source,
        })?;

        let raw: RawToolRuleSchema =
            toml::from_str(&text).map_err(|source| RuleLoadError::Parse {
                path: path.to_path_buf(),
                source,
            })?;

        validate_rule(path, expected_tool, &raw)?;
        Ok(convert_raw_rule(raw))
    }
}

impl Default for RuleLoader {
    fn default() -> Self {
        Self::new(Self::default_rules_dir())
    }
}

#[derive(Debug, Clone, Deserialize)]
struct RawToolRuleSchema {
    tool: RawToolMetadata,
    command: RawCommandRule,
    parse: RawParseRule,
    #[serde(default)]
    normalize: RawNormalizeRule,
    persist: RawPersistRule,
}

#[derive(Debug, Clone, Deserialize)]
struct RawToolMetadata {
    id: String,
    name: String,
    description: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct RawCommandRule {
    args_template: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct RawParseRule {
    format: String,
    field_mappings: HashMap<String, String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
struct RawNormalizeRule {
    #[serde(default)]
    maps: HashMap<String, HashMap<String, String>>,
}

#[derive(Debug, Clone, Deserialize)]
struct RawPersistRule {
    targets: Vec<String>,
}

fn validate_rule(
    path: &Path,
    expected_tool: &str,
    raw: &RawToolRuleSchema,
) -> Result<(), RuleLoadError> {
    if raw.tool.id.trim().is_empty() {
        return Err(validation_error(path, "缺少关键字段 tool.id"));
    }
    if raw.tool.name.trim().is_empty() {
        return Err(validation_error(path, "缺少关键字段 tool.name"));
    }
    if raw.tool.id != expected_tool {
        return Err(validation_error(
            path,
            format!(
                "tool.id 与文件名不一致: 期望 {expected_tool}, 实际 {}",
                raw.tool.id
            ),
        ));
    }
    if raw.command.args_template.is_empty() {
        return Err(validation_error(path, "缺少关键字段 command.args_template"));
    }
    if !raw
        .command
        .args_template
        .iter()
        .any(|arg| arg.contains("{{target}}"))
    {
        return Err(validation_error(
            path,
            "command.args_template 必须包含 {{target}} 占位符",
        ));
    }
    parse_format_from_str(path, &raw.parse.format)?;
    if raw.parse.field_mappings.is_empty() {
        return Err(validation_error(path, "缺少关键字段 parse.field_mappings"));
    }
    if raw.persist.targets.is_empty() {
        return Err(validation_error(path, "缺少关键字段 persist.targets"));
    }
    for target in &raw.persist.targets {
        if !raw
            .parse
            .field_mappings
            .values()
            .any(|mapped| mapped == target)
        {
            return Err(validation_error(
                path,
                format!("persist.targets 包含未映射字段: {target}"),
            ));
        }
    }
    for (field, mapping) in &raw.normalize.maps {
        if field.trim().is_empty() {
            return Err(validation_error(path, "normalize.maps 存在空字段名"));
        }
        if mapping.is_empty() {
            return Err(validation_error(
                path,
                format!("normalize.maps.{field} 不能为空"),
            ));
        }
    }
    Ok(())
}

fn convert_raw_rule(raw: RawToolRuleSchema) -> ToolRuleSchema {
    ToolRuleSchema {
        tool: ToolMetadata {
            id: raw.tool.id,
            name: raw.tool.name,
            description: raw.tool.description,
        },
        command: CommandRule {
            args_template: raw.command.args_template,
        },
        parse: ParseRule {
            format: parse_format_from_str(&PathBuf::new(), &raw.parse.format)
                .expect("format must be validated before conversion"),
            field_mappings: raw.parse.field_mappings,
        },
        normalize: NormalizeRule {
            maps: raw.normalize.maps,
        },
        persist: PersistRule {
            targets: raw.persist.targets,
        },
    }
}

fn parse_format_from_str(path: &Path, raw: &str) -> Result<ParseFormat, RuleLoadError> {
    match raw.trim().to_ascii_lowercase().as_str() {
        "json" => Ok(ParseFormat::Json),
        "jsonl" => Ok(ParseFormat::Jsonl),
        "csv" => Ok(ParseFormat::Csv),
        _ => Err(validation_error(
            path,
            format!("不支持的 parse.format: {raw} (仅支持 json/jsonl/csv)"),
        )),
    }
}

fn validation_error(path: &Path, message: impl Into<String>) -> RuleLoadError {
    RuleLoadError::Validation {
        path: path.to_path_buf(),
        message: message.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn load_default_httpx_rule_success() {
        let loader = RuleLoader::default();
        let rule = loader.load("httpx").expect("httpx rule should load");
        assert_eq!(rule.tool.id, "httpx");
        assert_eq!(rule.parse.format, ParseFormat::Jsonl);
        assert!(rule.command.args_template.iter().any(|v| v == "{{target}}"));
        assert!(rule.persist.targets.iter().all(|field| {
            rule.parse
                .field_mappings
                .values()
                .any(|mapped| mapped == field)
        }));
    }

    #[test]
    fn validate_unsupported_parse_format() {
        let dir = tempdir().expect("tempdir should work");
        let rule_path = dir.path().join("httpx.toml");
        std::fs::write(
            &rule_path,
            r#"
[tool]
id = "httpx"
name = "httpx"

[command]
args_template = ["-json", "{{target}}"]

[parse]
format = "xml"
field_mappings = { host = "host" }

[persist]
targets = ["host"]
"#,
        )
        .expect("write should work");

        let loader = RuleLoader::new(dir.path().to_path_buf());
        let err = loader.load("httpx").expect_err("load should fail");
        assert!(matches!(err, RuleLoadError::Validation { .. }));
        assert!(err.to_string().contains("不支持的 parse.format"));
    }

    #[test]
    fn validate_missing_args_template() {
        let dir = tempdir().expect("tempdir should work");
        let rule_path = dir.path().join("nuclei.toml");
        std::fs::write(
            &rule_path,
            r#"
[tool]
id = "nuclei"
name = "nuclei"

[command]
args_template = []

[parse]
format = "jsonl"
field_mappings = { template_id = "template_id" }

[persist]
targets = ["template_id"]
"#,
        )
        .expect("write should work");

        let loader = RuleLoader::new(dir.path().to_path_buf());
        let err = loader.load("nuclei").expect_err("load should fail");
        assert!(matches!(err, RuleLoadError::Validation { .. }));
        assert!(err.to_string().contains("command.args_template"));
    }

    #[test]
    fn validate_tool_id_mismatch() {
        let dir = tempdir().expect("tempdir should work");
        let rule_path = dir.path().join("fscan.toml");
        std::fs::write(
            &rule_path,
            r#"
[tool]
id = "wrong-id"
name = "fscan"

[command]
args_template = ["-h", "{{target}}"]

[parse]
format = "jsonl"
field_mappings = { ip = "target" }

[persist]
targets = ["target"]
"#,
        )
        .expect("write should work");

        let loader = RuleLoader::new(dir.path().to_path_buf());
        let err = loader.load("fscan").expect_err("load should fail");
        assert!(matches!(err, RuleLoadError::Validation { .. }));
        assert!(err.to_string().contains("tool.id 与文件名不一致"));
    }
}
