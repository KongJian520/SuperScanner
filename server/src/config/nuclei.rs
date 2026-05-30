use super::cli::ROOT_DIR;
use std::{fs, io::Write, path::Path};
use tempfile::NamedTempFile;
use toml::map::Map;

/// nuclei 模板配置，包含本地路径、缓存路径和仓库地址
#[derive(Debug, Clone)]
pub struct NucleiTemplatesConfig {
    pub local_path: Option<String>,
    pub cache_path: String,
    pub repo_url: String,
}

const SERVER_CONFIG_FILE_NAME: &str = "server-config.toml";

fn non_empty_string(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() { None } else { Some(trimmed.to_string()) }
}

/// 持久化 nuclei 模板配置到 server-config.toml
pub fn persist_nuclei_templates_config(
    local_path: Option<&str>,
    repo_url: &str,
) -> Result<(), String> {
    persist_nuclei_templates_config_at(&ROOT_DIR, local_path, repo_url)
}

pub(super) fn persist_nuclei_templates_config_at(
    root_dir: &Path,
    local_path: Option<&str>,
    repo_url: &str,
) -> Result<(), String> {
    let repo_url = non_empty_string(repo_url)
        .ok_or_else(|| "nuclei templates repo 不能为空".to_string())?;

    let config_path = root_dir.join(SERVER_CONFIG_FILE_NAME);
    let mut doc = if config_path.exists() {
        let text = fs::read_to_string(&config_path)
            .map_err(|e| format!("读取配置文件失败 {}: {}", config_path.display(), e))?;
        toml::from_str::<toml::Value>(&text)
            .map_err(|e| format!("解析配置文件失败 {}: {}", config_path.display(), e))?
    } else {
        toml::Value::Table(Map::new())
    };

    let root = doc
        .as_table_mut()
        .ok_or_else(|| "配置文件格式错误：顶层必须是 table".to_string())?;

    let tools_value = root
        .entry("tools".to_string())
        .or_insert_with(|| toml::Value::Table(Map::new()));
    if !tools_value.is_table() {
        *tools_value = toml::Value::Table(Map::new());
    }
    let tools = tools_value
        .as_table_mut()
        .ok_or_else(|| "配置文件格式错误：[tools] 不是 table".to_string())?;

    tools.insert("nuclei_templates_repo".to_string(), toml::Value::String(repo_url));
    match local_path.and_then(non_empty_string) {
        Some(local) => {
            tools.insert("nuclei_templates_dir".to_string(), toml::Value::String(local));
        }
        None => {
            tools.remove("nuclei_templates_dir");
        }
    }

    let serialized = toml::to_string_pretty(&doc).map_err(|e| format!("序列化配置失败: {}", e))?;
    fs::create_dir_all(root_dir)
        .map_err(|e| format!("创建配置目录失败 {}: {}", root_dir.display(), e))?;

    let parent = config_path
        .parent()
        .ok_or_else(|| "配置文件路径错误，缺少父目录".to_string())?;
    let mut temp_file = NamedTempFile::new_in(parent)
        .map_err(|e| format!("创建临时配置文件失败 {}: {}", parent.display(), e))?;
    temp_file
        .write_all(serialized.as_bytes())
        .map_err(|e| format!("写入临时配置文件失败: {}", e))?;
    temp_file
        .as_file_mut()
        .sync_all()
        .map_err(|e| format!("刷新临时配置文件失败: {}", e))?;

    temp_file
        .persist(&config_path)
        .map_err(|e| format!("原子替换配置文件失败 {}: {}", config_path.display(), e.error))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn persist_nuclei_templates_config_creates_and_updates_tools_section() {
        let dir = tempdir().expect("create temp dir");
        persist_nuclei_templates_config_at(
            dir.path(),
            Some("C:\\nuclei\\templates"),
            "https://example.com/repo.git",
        )
        .expect("persist config");

        let config_path = dir.path().join(SERVER_CONFIG_FILE_NAME);
        let content = fs::read_to_string(&config_path).expect("read config");
        let parsed: toml::Value = toml::from_str(&content).expect("parse config");
        let tools = parsed.get("tools").and_then(|v| v.as_table()).expect("tools table");
        assert_eq!(
            tools.get("nuclei_templates_dir").and_then(|v| v.as_str()).expect("templates dir"),
            "C:\\nuclei\\templates"
        );
        assert_eq!(
            tools.get("nuclei_templates_repo").and_then(|v| v.as_str()).expect("repo url"),
            "https://example.com/repo.git"
        );
    }

    #[test]
    fn persist_nuclei_templates_config_preserves_unrelated_fields_and_clears_local() {
        let dir = tempdir().expect("create temp dir");
        let config_path = dir.path().join(SERVER_CONFIG_FILE_NAME);
        fs::write(
            &config_path,
            r#"
[server]
name = "prod"

[tools]
nmap_binary = "/usr/bin/nmap"
nuclei_templates_dir = "/old/path"
nuclei_templates_cache_dir = "/cache/path"
"#,
        )
        .expect("write config");

        persist_nuclei_templates_config_at(dir.path(), None, "https://new.repo/templates.git")
            .expect("persist config");

        let content = fs::read_to_string(&config_path).expect("read config");
        let parsed: toml::Value = toml::from_str(&content).expect("parse config");
        assert_eq!(
            parsed.get("server").and_then(|v| v.get("name")).and_then(|v| v.as_str()),
            Some("prod")
        );
        let tools = parsed.get("tools").and_then(|v| v.as_table()).expect("tools table");
        assert!(tools.get("nuclei_templates_dir").is_none());
        assert_eq!(
            tools.get("nmap_binary").and_then(|v| v.as_str()).expect("nmap binary"),
            "/usr/bin/nmap"
        );
        assert_eq!(
            tools.get("nuclei_templates_cache_dir").and_then(|v| v.as_str()).expect("cache"),
            "/cache/path"
        );
        assert_eq!(
            tools.get("nuclei_templates_repo").and_then(|v| v.as_str()).expect("repo"),
            "https://new.repo/templates.git"
        );
    }
}
