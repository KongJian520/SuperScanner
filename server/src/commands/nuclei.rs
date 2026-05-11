use super::ScannerCommand;
use crate::domain::types::CommandSpec;
use crate::engine::nuclei::executor::HttpExecutor;
use crate::engine::nuclei::template::{self, NucleiTemplate};
use crate::engine::nuclei::NucleiEngine;
use crate::error::AppError;
use crate::storage::task_db::{self, NewFinding};
use async_trait::async_trait;
use sqlx::sqlite::SqlitePool;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::OnceCell;
use tracing::{debug, info, warn};

#[derive(Clone)]
pub struct NucleiCommand {
    engine: Arc<OnceCell<NucleiEngine>>,
    executor: Arc<HttpExecutor>,
    templates_dir: PathBuf,
}

impl NucleiCommand {
    pub fn new(templates_dir: PathBuf) -> Self {
        let executor = HttpExecutor::new().unwrap_or_else(|e| {
            warn!("Failed to create HTTP executor: {}", e);
            HttpExecutor::new().unwrap()
        });

        Self {
            engine: Arc::new(OnceCell::new()),
            executor: Arc::new(executor),
            templates_dir,
        }
    }

    async fn get_engine(&self) -> &NucleiEngine {
        self.engine
            .get_or_init(|| async {
                if self.templates_dir.is_dir() {
                    match NucleiEngine::load_from_dir(&self.templates_dir).await {
                        Ok(e) => {
                            info!(
                                "Loaded {} nuclei templates from {}",
                                e.template_count(),
                                self.templates_dir.display()
                            );
                            e
                        }
                        Err(e) => {
                            warn!("Failed to load nuclei templates: {}", e);
                            NucleiEngine::empty()
                        }
                    }
                } else {
                    warn!(
                        "Nuclei templates directory not found: {}",
                        self.templates_dir.display()
                    );
                    NucleiEngine::empty()
                }
            })
            .await
    }
}

#[async_trait]
impl ScannerCommand for NucleiCommand {
    fn id(&self) -> &'static str {
        "nuclei"
    }

    fn description(&self) -> &'static str {
        "Nuclei POC Scanner (Builtin HTTP Engine)"
    }

    fn build_spec(&self, _targets: &[String], _args: &[String]) -> CommandSpec {
        CommandSpec {
            id: "nuclei".to_string(),
            program: PathBuf::from("nuclei"),
            args: vec![],
            targets: vec![],
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
        _task_dir: &PathBuf,
        pool: &SqlitePool,
    ) -> Result<(), AppError> {
        let normalized_target = normalize_target(target);

        let engine = self.get_engine().await;
        let templates = engine.all_templates();

        if templates.is_empty() {
            debug!("No nuclei templates loaded, skipping target {}", normalized_target);
            return Ok(());
        }

        let applicable: Vec<NucleiTemplate> = templates
            .iter()
            .filter(|t| !t.http.is_empty())
            .filter(|t| {
                let sev = template::severity_weight(&t.info.severity);
                sev >= 3
            })
            .cloned()
            .collect();

        if applicable.is_empty() {
            return Ok(());
        }

        debug!(
            target = %normalized_target,
            template_count = applicable.len(),
            "executing nuclei templates"
        );

        let mut total_matches = 0u64;
        for template in &applicable {
            match self.executor.execute_template(template, &normalized_target).await {
                Ok(matches) => {
                    for m in matches {
                        let finding = NewFinding {
                            dedupe_key: Some(format!(
                                "nuclei|{}|{}|{}",
                                normalized_target.trim().to_ascii_lowercase(),
                                m.template_id.trim().to_ascii_lowercase(),
                                m.name.trim().to_ascii_lowercase()
                            )),
                            finding_type: "vulnerability".to_string(),
                            severity: template::normalize_severity(&m.severity).to_string(),
                            title: m.name.clone(),
                            detail: Some(m.detail.clone()),
                            ip: extract_ip(&normalized_target),
                            port: extract_port(&normalized_target),
                            protocol: Some(extract_scheme(&normalized_target)),
                            source_tool: Some("nuclei".to_string()),
                            source_command: Some("nuclei (builtin)".to_string()),
                            metadata_json: Some(
                                serde_json::json!({
                                    "template_id": m.template_id,
                                    "severity": m.severity,
                                    "matched_at": m.matched_at,
                                    "extractors": m.extractors,
                                })
                                .to_string(),
                            ),
                        };

                        match task_db::insert_or_update_finding(pool, &finding).await {
                            Ok(_) => total_matches += 1,
                            Err(e) => {
                                debug!("Failed to insert finding: {}", e);
                            }
                        }
                    }
                }
                Err(e) => {
                    debug!(
                        template_id = %template.id,
                        error = %e,
                        "template execution failed"
                    );
                }
            }
        }

        if total_matches > 0 {
            info!(
                target = %normalized_target,
                matches = total_matches,
                "nuclei scan complete"
            );
        }

        Ok(())
    }

    async fn process_result(&self, _task_dir: &PathBuf) -> Result<(), AppError> {
        // Results are written directly to the findings table during execute_target,
        // so there's no separate processing step needed.
        Ok(())
    }

    fn box_clone(&self) -> Box<dyn ScannerCommand> {
        Box::new(self.clone())
    }
}

fn normalize_target(target: &str) -> String {
    let trimmed = target.trim();
    if trimmed.is_empty() {
        return trimmed.to_string();
    }
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        return trimmed.to_string();
    }
    // Default to http:// for IP/domain targets
    format!("http://{}", trimmed)
}

fn extract_ip(target: &str) -> Option<String> {
    let t = target.trim();
    let authority = if let Some((_, rest)) = t.split_once("://") {
        rest.split('/').next().unwrap_or("")
    } else {
        t.split('/').next().unwrap_or("")
    };
    if authority.starts_with('[') {
        if let Some(end) = authority.find(']') {
            return Some(authority[1..end].to_string());
        }
    }
    if let Some((host, _)) = authority.rsplit_once(':') {
        if !host.contains(':') {
            return Some(host.to_string());
        }
    }
    if !authority.is_empty() {
        return Some(authority.to_string());
    }
    None
}

fn extract_port(target: &str) -> Option<i64> {
    let t = target.trim();
    let authority = if let Some((_, rest)) = t.split_once("://") {
        rest.split('/').next().unwrap_or("")
    } else {
        t.split('/').next().unwrap_or("")
    };
    if authority.starts_with('[') {
        if let Some(end) = authority.find(']') {
            let remain = &authority[end + 1..];
            return remain.strip_prefix(':').and_then(|p| p.parse().ok());
        }
    }
    if let Some((host, port)) = authority.rsplit_once(':') {
        if !host.contains(':') {
            return port.parse().ok();
        }
    }
    None
}

fn extract_scheme(target: &str) -> String {
    if let Some((scheme, _)) = target.trim().split_once("://") {
        scheme.to_ascii_lowercase()
    } else {
        "http".to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_target_preserves_http() {
        assert_eq!(normalize_target("http://10.0.0.1:8080"), "http://10.0.0.1:8080");
    }

    #[test]
    fn test_normalize_target_adds_http() {
        assert_eq!(normalize_target("10.0.0.1:8080"), "http://10.0.0.1:8080");
    }

    #[test]
    fn test_extract_ip() {
        assert_eq!(extract_ip("http://10.0.0.1:8080/path"), Some("10.0.0.1".to_string()));
        assert_eq!(extract_ip("https://example.com/path"), Some("example.com".to_string()));
    }

    #[test]
    fn test_extract_port() {
        assert_eq!(extract_port("http://10.0.0.1:8080/path"), Some(8080));
        assert_eq!(extract_port("https://example.com/path"), None);
    }

    #[test]
    fn test_extract_scheme() {
        assert_eq!(extract_scheme("https://example.com/path"), "https");
        assert_eq!(extract_scheme("http://10.0.0.1:8080"), "http");
    }

    #[test]
    fn test_build_spec() {
        let cmd = NucleiCommand::new(std::path::PathBuf::from("/nonexistent"));
        let spec = cmd.build_spec(&["127.0.0.1".to_string()], &[]);
        assert_eq!(spec.id, "nuclei");
    }
}
