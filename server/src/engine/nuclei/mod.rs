pub mod executor;
pub mod matcher;
pub mod template;
pub mod variables;

use crate::error::AppError;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use template::{NucleiTemplate, TemplateFilter};
use tracing::{info, warn};

pub struct NucleiEngine {
    templates: Vec<NucleiTemplate>,
    by_tag: HashMap<String, Vec<usize>>,
}

impl NucleiEngine {
    pub fn empty() -> Self {
        Self {
            templates: Vec::new(),
            by_tag: HashMap::new(),
        }
    }

    /// Load all .yaml templates from a directory recursively.
    pub async fn load_from_dir(dir: &Path) -> Result<Self, AppError> {
        let mut templates = Vec::new();
        load_templates_recursive(dir, &mut templates).await?;
        info!("Loaded {} nuclei templates from {}", templates.len(), dir.display());

        let mut by_tag: HashMap<String, Vec<usize>> = HashMap::new();
        for (idx, template) in templates.iter().enumerate() {
            if let Some(tags) = &template.info.tags {
                for tag in tags.split(',') {
                    let tag = tag.trim().to_ascii_lowercase();
                    if !tag.is_empty() {
                        by_tag.entry(tag).or_default().push(idx);
                    }
                }
            }
        }

        Ok(Self { templates, by_tag })
    }

    /// Reload templates from a directory.
    pub async fn reload(&mut self, dir: &Path) -> Result<(), AppError> {
        let new_engine = Self::load_from_dir(dir).await?;
        *self = new_engine;
        Ok(())
    }

    pub fn template_count(&self) -> usize {
        self.templates.len()
    }

    pub fn all_templates(&self) -> &[NucleiTemplate] {
        &self.templates
    }

    pub fn select_templates(&self, filter: &TemplateFilter) -> Vec<&NucleiTemplate> {
        if let Some(ids) = &filter.template_ids {
            return self
                .templates
                .iter()
                .filter(|t| ids.contains(&t.id))
                .collect();
        }

        let mut candidate_indices: Option<Vec<usize>> = None;

        // Apply tag includes (intersection of tag matches)
        if !filter.tags_include.is_empty() {
            for tag in &filter.tags_include {
                let indices = self.by_tag.get(&tag.to_ascii_lowercase());
                match indices {
                    Some(idxs) => {
                        let idx_set: std::collections::HashSet<usize> =
                            idxs.iter().copied().collect();
                        match &mut candidate_indices {
                            Some(existing) => {
                                *existing = existing
                                    .iter()
                                    .filter(|i| idx_set.contains(i))
                                    .copied()
                                    .collect();
                            }
                            None => {
                                candidate_indices = Some(idxs.clone());
                            }
                        }
                    }
                    None => {
                        return Vec::new();
                    }
                }
            }
        }

        // Apply tag excludes
        if !filter.tags_exclude.is_empty() {
            for tag in &filter.tags_exclude {
                if let Some(idxs) = self.by_tag.get(&tag.to_ascii_lowercase()) {
                    let exclude_set: std::collections::HashSet<usize> =
                        idxs.iter().copied().collect();
                    match &mut candidate_indices {
                        Some(existing) => {
                            *existing = existing
                                .iter()
                                .filter(|i| !exclude_set.contains(i))
                                .copied()
                                .collect();
                        }
                        None => {
                            let all_indices: Vec<usize> = (0..self.templates.len()).collect();
                            candidate_indices = Some(
                                all_indices
                                    .into_iter()
                                    .filter(|i| !exclude_set.contains(i))
                                    .collect(),
                            );
                        }
                    }
                }
            }
        }

        let is_http_template =
            |t: &&NucleiTemplate| !t.http.is_empty();

        let result: Vec<&NucleiTemplate> = match candidate_indices {
            Some(indices) => indices
                .into_iter()
                .filter_map(|i| self.templates.get(i))
                .filter(is_http_template)
                .collect(),
            None => self.templates.iter().filter(is_http_template).collect(),
        };

        // Apply severity filter
        if let Some(min_sev) = &filter.severity_min {
            let min_weight = template::severity_weight(min_sev);
            result
                .into_iter()
                .filter(|t| template::severity_weight(&t.info.severity) >= min_weight)
                .collect()
        } else {
            // Default: severity >= medium
            result
                .into_iter()
                .filter(|t| template::severity_weight(&t.info.severity) >= 3)
                .collect()
        }
    }

    pub fn templates_dir(&self) -> Option<&Path> {
        None
    }

    pub fn default_dir() -> PathBuf {
        crate::config::ROOT_DIR.join("nuclei-templates")
    }
}

async fn load_templates_recursive(
    dir: &Path,
    templates: &mut Vec<NucleiTemplate>,
) -> Result<(), AppError> {
    if !dir.is_dir() {
        return Ok(());
    }

    let mut entries = tokio::fs::read_dir(dir).await.map_err(|e| {
        AppError::Io(std::io::Error::new(
            e.kind(),
            format!("读取模板目录失败 {}: {}", dir.display(), e),
        ))
    })?;

    while let Some(entry) = entries.next_entry().await.map_err(|e| {
        AppError::Io(std::io::Error::new(
            e.kind(),
            format!("遍历模板目录失败 {}: {}", dir.display(), e),
        ))
    })? {
        let path = entry.path();
        if path.is_dir() {
            Box::pin(load_templates_recursive(&path, templates)).await?;
        } else if path.extension().and_then(|s| s.to_str()) == Some("yaml")
            || path.extension().and_then(|s| s.to_str()) == Some("yml")
        {
            match tokio::fs::read_to_string(&path).await {
                Ok(content) => match serde_yaml::from_str::<NucleiTemplate>(&content) {
                    Ok(template) => {
                        templates.push(template);
                    }
                    Err(e) => {
                        warn!(
                            "跳过无效模板 {}: {}",
                            path.display(),
                            e
                        );
                    }
                },
                Err(e) => {
                    warn!("读取模板文件失败 {}: {}", path.display(), e);
                }
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    const SAMPLE_TEMPLATE: &str = r#"
id: test-template

info:
  name: Test Template
  severity: medium
  description: A test template
  tags: test,discovery

http:
  - method: GET
    path:
      - "{{BaseURL}}/test"
    matchers-condition: and
    matchers:
      - type: word
        words:
          - "Test"
      - type: status
        status:
          - 200
"#;

    #[tokio::test]
    async fn test_load_yaml_template() {
        let tmp = TempDir::new().unwrap();
        let template_path = tmp.path().join("test.yaml");
        tokio::fs::write(&template_path, SAMPLE_TEMPLATE).await.unwrap();

        let engine = NucleiEngine::load_from_dir(tmp.path()).await.unwrap();
        assert_eq!(engine.template_count(), 1);
        assert_eq!(engine.templates[0].id, "test-template");
        assert_eq!(engine.templates[0].info.severity, "medium");
        assert_eq!(engine.templates[0].http.len(), 1);
        assert_eq!(engine.templates[0].http[0].path.len(), 1);
    }

    #[tokio::test]
    async fn test_tag_index() {
        let tmp = TempDir::new().unwrap();
        let template_path = tmp.path().join("test.yaml");
        tokio::fs::write(&template_path, SAMPLE_TEMPLATE).await.unwrap();

        let engine = NucleiEngine::load_from_dir(tmp.path()).await.unwrap();

        let filter = TemplateFilter {
            tags_include: vec!["discovery".to_string()],
            ..Default::default()
        };
        let selected = engine.select_templates(&filter);
        assert_eq!(selected.len(), 1);
    }

    #[tokio::test]
    async fn test_empty_dir() {
        let tmp = TempDir::new().unwrap();
        let engine = NucleiEngine::load_from_dir(tmp.path()).await.unwrap();
        assert_eq!(engine.template_count(), 0);
    }
}
