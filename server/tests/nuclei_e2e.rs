// E2E tests for the builtin Nuclei HTTP engine.
// Exercises: engine loading, HTTP execution, matchers, findings pipeline, dedup.

use SuperScannerServer::engine::nuclei::executor::HttpExecutor;
use SuperScannerServer::engine::nuclei::template;
use SuperScannerServer::engine::nuclei::NucleiEngine;
use SuperScannerServer::storage::task_db;
use sqlx::sqlite::SqlitePoolOptions;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::time::Duration;
use tempfile::TempDir;

fn extract_ip(target: &str) -> Option<String> {
    let t = target.trim();
    let authority = t.split_once("://").map_or(t, |(_, r)| r.split('/').next().unwrap_or(""));
    if let Some(end) = authority.strip_prefix('[').and_then(|a| a.find(']')) {
        return Some(authority[1..end].to_string());
    }
    authority.rsplit_once(':').map_or(
        if authority.is_empty() { None } else { Some(authority.to_string()) },
        |(h, _)| if h.contains(':') { Some(authority.to_string()) } else { Some(h.to_string()) },
    )
}

fn extract_port(target: &str) -> Option<i64> {
    let t = target.trim();
    let authority = t.split_once("://").map_or(t, |(_, r)| r.split('/').next().unwrap_or(""));
    authority.rsplit_once(':').and_then(|(h, p)| {
        if h.contains(':') { None } else { p.parse().ok() }
    })
}

fn extract_scheme(target: &str) -> String {
    target.trim().split_once("://").map_or("http".to_string(), |(s, _)| s.to_ascii_lowercase())
}

fn start_test_server(body: &'static str) -> (u16, impl Drop) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let body_s = body.to_string();
    let handle = std::thread::spawn(move || {
        for _ in 0..30 {
            match listener.accept() {
                Ok((mut stream, _)) => {
                    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
                    let mut buf = [0u8; 4096];
                    let _ = stream.read(&mut buf);
                    let resp = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        body_s.len(),
                        body_s
                    );
                    let _ = stream.write_all(resp.as_bytes());
                    let _ = stream.flush();
                }
                Err(_) => break,
            }
        }
    });
    struct Guard(u16, std::thread::JoinHandle<()>);
    impl Drop for Guard {
        fn drop(&mut self) {
            // Thread exits on its own after accepting connections; just detach
        }
    }
    (port, Guard(port, handle))
}

async fn make_mem_db() -> sqlx::sqlite::SqlitePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    task_db::ensure_findings_table(&pool).await.unwrap();
    pool
}

const TPL_STATUS_MATCH: &str = r#"
id: e2e-status-match
info:
  name: E2E Status Match
  severity: critical
  tags: e2e
http:
  - method: GET
    path:
      - "{{BaseURL}}/test"
    matchers-condition: and
    matchers:
      - type: status
        status:
          - 200
"#;

const TPL_WORD_MATCH: &str = r#"
id: e2e-word-match
info:
  name: E2E Word Match
  severity: high
  tags: e2e
http:
  - method: GET
    path:
      - "{{BaseURL}}/admin"
    matchers-condition: and
    matchers:
      - type: word
        words:
          - "Admin"
      - type: status
        status:
          - 200
"#;

const TPL_NO_MATCH: &str = r#"
id: e2e-no-match
info:
  name: E2E No Match
  severity: medium
  tags: e2e
http:
  - method: GET
    path:
      - "{{BaseURL}}/admin"
    matchers-condition: and
    matchers:
      - type: word
        words:
          - "SuperSecretNotFound"
"#;

const TPL_LOW_SEV: &str = r#"
id: e2e-low-sev
info:
  name: E2E Low Severity
  severity: low
  tags: e2e
http:
  - method: GET
    path:
      - "{{BaseURL}}/"
    matchers-condition: and
    matchers:
      - type: status
        status:
          - 200
"#;

fn new_finding(target: &str, m: &template::MatchResult) -> task_db::NewFinding {
    task_db::NewFinding {
        dedupe_key: Some(format!(
            "nuclei|{}|{}|{}",
            target.trim().to_ascii_lowercase(),
            m.template_id.trim().to_ascii_lowercase(),
            m.name.trim().to_ascii_lowercase()
        )),
        finding_type: "vulnerability".to_string(),
        severity: template::normalize_severity(&m.severity).to_string(),
        title: m.name.clone(),
        detail: Some(m.detail.clone()),
        ip: Some("127.0.0.1".to_string()),
        port: extract_port(target),
        protocol: Some(extract_scheme(target)),
        source_tool: Some("nuclei".to_string()),
        source_command: Some("nuclei (builtin)".to_string()),
        metadata_json: Some(
            serde_json::json!({
                "template_id": m.template_id,
                "severity": m.severity,
                "matched_at": m.matched_at,
            })
            .to_string(),
        ),
    }
}

/// E2E: status matcher produces a finding in the DB.
#[tokio::test]
async fn e2e_status_match() {
    let (port, _guard) = start_test_server("<html><body>Hello</body></html>");
    let target = format!("http://127.0.0.1:{}", port);

    let tmp = TempDir::new().unwrap();
    std::fs::write(tmp.path().join("s.yaml"), TPL_STATUS_MATCH).unwrap();

    let engine = NucleiEngine::load_from_dir(tmp.path()).await.unwrap();
    assert_eq!(engine.template_count(), 1);

    let pool = make_mem_db().await;
    let executor = HttpExecutor::new().unwrap();

    for t in engine.all_templates() {
        if t.http.is_empty() {
            continue;
        }
        for m in executor.execute_template(t, &target).await.unwrap() {
            task_db::insert_or_update_finding(&pool, &new_finding(&target, &m))
                .await
                .unwrap();
        }
    }

    let findings = task_db::query_findings(&pool).await.unwrap();
    assert_eq!(findings.len(), 1);
    assert_eq!(findings[0].title, "E2E Status Match");
    assert_eq!(findings[0].severity, "critical");
    assert_eq!(findings[0].finding_type, "vulnerability");
    assert_eq!(findings[0].source_tool, "nuclei");
    assert_eq!(findings[0].ip, "127.0.0.1");
    assert_eq!(findings[0].port, port as i64);
}

/// E2E: word matcher correctly matches body content.
#[tokio::test]
async fn e2e_word_match() {
    let (port, _guard) = start_test_server("<html><body><h1>Admin Panel</h1></body></html>");
    let target = format!("http://127.0.0.1:{}/admin", port);

    let tmp = TempDir::new().unwrap();
    std::fs::write(tmp.path().join("w.yaml"), TPL_WORD_MATCH).unwrap();

    let engine = NucleiEngine::load_from_dir(tmp.path()).await.unwrap();
    let pool = make_mem_db().await;
    let executor = HttpExecutor::new().unwrap();

    for t in engine.all_templates() {
        if t.http.is_empty() {
            continue;
        }
        for m in executor.execute_template(t, &target).await.unwrap() {
            task_db::insert_or_update_finding(&pool, &new_finding(&target, &m))
                .await
                .unwrap();
        }
    }

    let findings = task_db::query_findings(&pool).await.unwrap();
    assert_eq!(findings.len(), 1);
    assert_eq!(findings[0].title, "E2E Word Match");
    assert_eq!(findings[0].severity, "high");
}

/// E2E: no finding when nothing matches.
#[tokio::test]
async fn e2e_no_match() {
    let (port, _guard) = start_test_server("<html><body>Normal Page</body></html>");
    let target = format!("http://127.0.0.1:{}/admin", port);

    let tmp = TempDir::new().unwrap();
    std::fs::write(tmp.path().join("n.yaml"), TPL_NO_MATCH).unwrap();

    let engine = NucleiEngine::load_from_dir(tmp.path()).await.unwrap();
    let pool = make_mem_db().await;
    let executor = HttpExecutor::new().unwrap();

    let mut total = 0u64;
    for t in engine.all_templates() {
        if t.http.is_empty() {
            continue;
        }
        total += executor.execute_template(t, &target).await.unwrap().len() as u64;
    }

    assert_eq!(total, 0);
    let findings = task_db::query_findings(&pool).await.unwrap();
    assert!(findings.is_empty());
}

/// E2E: low severity templates are filtered out (weight < 3).
#[tokio::test]
async fn e2e_low_severity_filtered() {
    let (port, _guard) = start_test_server("<html><body>Test</body></html>");
    let target = format!("http://127.0.0.1:{}", port);

    let tmp = TempDir::new().unwrap();
    std::fs::write(tmp.path().join("l.yaml"), TPL_LOW_SEV).unwrap();

    let engine = NucleiEngine::load_from_dir(tmp.path()).await.unwrap();
    let executor = HttpExecutor::new().unwrap();

    // The template WOULD match if we ran it...
    let matches = executor
        .execute_template(&engine.all_templates()[0], &target)
        .await
        .unwrap();
    assert!(!matches.is_empty(), "template itself should match the target");

    // ...but the severity filter (weight >= 3) excludes it
    let weight = template::severity_weight(&engine.all_templates()[0].info.severity);
    assert!(weight < 3, "low severity should have weight < 3");
}

/// E2E: dedup by dedupe_key: second scan updates occurrences instead of inserting.
#[tokio::test]
async fn e2e_dedupe_on_repeat() {
    let (port, _guard) = start_test_server("<html><body>Dedup</body></html>");
    let target = format!("http://127.0.0.1:{}", port);

    let tmp = TempDir::new().unwrap();
    std::fs::write(tmp.path().join("d.yaml"), TPL_STATUS_MATCH).unwrap();

    let engine = NucleiEngine::load_from_dir(tmp.path()).await.unwrap();
    let pool = make_mem_db().await;
    let executor = HttpExecutor::new().unwrap();

    // Scan twice
    for _ in 0..2 {
        for t in engine.all_templates() {
            if t.http.is_empty() {
                continue;
            }
            for m in executor.execute_template(t, &target).await.unwrap() {
                task_db::insert_or_update_finding(&pool, &new_finding(&target, &m))
                    .await
                    .unwrap();
            }
        }
    }

    let findings = task_db::query_findings(&pool).await.unwrap();
    assert_eq!(findings.len(), 1, "dedupe should keep 1 row");
    assert_eq!(findings[0].occurrences, 2, "occurrences should be 2");
}

/// E2E: executor returns empty vec for templates with no HTTP requests.
#[tokio::test]
async fn e2e_template_no_http_requests() {
    let tpl_yaml = r#"
id: no-http
info:
  name: No HTTP Template
  severity: medium
  tags: test
"#;
    // Template with no "http:" section at all won't parse successfully
    // But if it did, http would be empty — handled by the empty-check in executor

    let executor = HttpExecutor::new().unwrap();
    let tpl: template::NucleiTemplate = serde_yaml::from_str(tpl_yaml).unwrap();
    assert!(tpl.http.is_empty());

    let results = executor
        .execute_template(&tpl, "http://127.0.0.1:1")
        .await
        .unwrap();
    assert!(results.is_empty());
}
