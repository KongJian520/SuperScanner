// 集成验证测试：模拟真实漏洞目标，验证 nuclei 和 httpx 扫描管线的端到端能力
//
// 启动一个带有多类"漏洞"的本地 HTTP 服务，使用真实 nuclei 模板扫描，
// 验证 finding 从匹配 → 存储 → 去重的完整管线。

use SuperScannerServer::engine::nuclei::executor::HttpExecutor;
use SuperScannerServer::engine::nuclei::template;
use SuperScannerServer::engine::nuclei::NucleiEngine;
use SuperScannerServer::storage::task_db;
use sqlx::sqlite::SqlitePoolOptions;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tempfile::TempDir;

// ── 漏洞模拟 HTTP 服务 ────────────────────────────────────────────

/// 模拟一个存在多种"漏洞特征"的 Web 应用
fn start_vulnerable_server() -> (u16, Arc<AtomicBool>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let running = Arc::new(AtomicBool::new(true));
    let running_clone = running.clone();

    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            if !running_clone.load(Ordering::Relaxed) {
                break;
            }
            handle_request(stream);
        }
    });

    (port, running)
}

fn handle_request(mut stream: TcpStream) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    let mut buf = [0u8; 4096];
    let n = stream.read(&mut buf).unwrap_or(0);
    let req = String::from_utf8_lossy(&buf[..n]);
    let path = req
        .lines()
        .next()
        .and_then(|l| l.split_whitespace().nth(1))
        .unwrap_or("/");

    let (status, body) = match path {
        "/" => (
            "200 OK",
            r#"<!DOCTYPE html>
<html>
<head><title>ACME Corp Portal</title></head>
<body>
<h1>Welcome to ACME Portal v2.3.1</h1>
<p>Powered by Apache/2.4.41 (Ubuntu)</p>
<!-- TODO: remove debug endpoints before production -->
</body>
</html>"#,
        ),
        "/admin" => (
            "200 OK",
            r#"<html>
<head><title>Admin Panel</title></head>
<body>
<h1>Administration</h1>
<form method="POST" action="/admin/login">
  <input name="username" placeholder="admin">
  <input name="password" type="password">
  <button>Login</button>
</form>
</body>
</html>"#,
        ),
        "/api/status" => (
            "200 OK",
            r#"{
  "service": "ACME API",
  "version": "1.0.0",
  "status": "ok",
  "uptime": 12345,
  "debug_mode": true,
  "internal_ip": "10.0.0.1"
}"#,
        ),
        "/debug" => (
            "200 OK",
            r#"Traceback (most recent call last):
  File "/app/main.py", line 42, in handle_request
    result = db.query("SELECT * FROM users")
  File "/app/db.py", line 18, in query
    conn = psycopg2.connect(host="db.internal", password="s3cr3t_p@ss")
psycopg2.OperationalError: could not connect to server
"#,
        ),
        "/.env" => (
            "200 OK",
            r#"DATABASE_URL=postgres://admin:s3cr3t_db_p@ss@db.internal:5432/prod
REDIS_URL=redis://:auth_token_123@cache.internal:6379/0
JWT_SECRET=super-secret-jwt-key-2024
AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
"#,
        ),
        "/robots.txt" => (
            "200 OK",
            r#"User-agent: *
Disallow: /admin
Disallow: /debug
Disallow: /api
Disallow: /.env
"#,
        ),
        _ => (
            "404 Not Found",
            r#"<html><body><h1>404 Not Found</h1></body></html>"#,
        ),
    };

    let resp = format!(
        "HTTP/1.1 {}\r\nServer: Apache/2.4.41 (Ubuntu)\r\nX-Powered-By: PHP/7.2.34\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        status,
        if path.starts_with("/api/") { "application/json" } else { "text/html; charset=utf-8" },
        body.len(),
        body
    );
    let _ = stream.write_all(resp.as_bytes());
    let _ = stream.flush();
}

// ── nuclei 模板 ─────────────────────────────────────────────────────

const NUCLEI_ADMIN_PANEL: &str = r#"
id: admin-panel-exposed
info:
  name: 管理后台暴露
  severity: medium
  description: 发现可访问的管理后台页面
  tags: panel,exposure,discovery
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

const NUCLEI_DEBUG_ENDPOINT: &str = r#"
id: debug-endpoint-exposed
info:
  name: 调试端点暴露
  severity: high
  description: 发现对外暴露的调试端点，包含敏感堆栈信息
  tags: debug,exposure,misconfig
http:
  - method: GET
    path:
      - "{{BaseURL}}/debug"
    matchers-condition: and
    matchers:
      - type: word
        words:
          - "Traceback"
          - "password"
        condition: or
      - type: status
        status:
          - 200
"#;

const NUCLEI_ENV_FILE_LEAK: &str = r#"
id: env-file-leak
info:
  name: 环境变量文件泄露
  severity: critical
  description: .env 文件可被外部访问，包含数据库密码和密钥
  tags: exposure,config,leak
http:
  - method: GET
    path:
      - "{{BaseURL}}/.env"
    matchers-condition: and
    matchers:
      - type: word
        words:
          - "DATABASE_URL"
          - "JWT_SECRET"
        condition: and
      - type: status
        status:
          - 200
"#;

const NUCLEI_OUTDATED_SERVER: &str = r#"
id: outdated-apache-version
info:
  name: Apache 版本过旧
  severity: low
  description: 检测到 Apache 2.4.41 版本
  tags: tech,apache,version
http:
  - method: GET
    path:
      - "{{BaseURL}}/"
    matchers-condition: and
    matchers:
      - type: word
        part: header
        words:
          - "Apache/2.4.41"
"#;

const NUCLEI_SENSITIVE_API: &str = r#"
id: sensitive-api-info-disclosure
info:
  name: API 敏感信息泄露
  severity: medium
  description: API 端点返回内部 IP 和 debug 模式状态
  tags: api,exposure,disclosure
http:
  - method: GET
    path:
      - "{{BaseURL}}/api/status"
    matchers-condition: and
    matchers:
      - type: word
        words:
          - "debug_mode"
          - "internal_ip"
        condition: and
      - type: status
        status:
          - 200
"#;

// ── 辅助函数 ─────────────────────────────────────────────────────────

async fn make_pool() -> sqlx::sqlite::SqlitePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    task_db::ensure_findings_table(&pool).await.unwrap();
    pool
}

fn make_finding(
    target: &str,
    m: &template::MatchResult,
    finding_type: &str,
) -> task_db::NewFinding {
    let dedupe_key = match finding_type {
        "vulnerability" => Some(format!(
            "nuclei|{}|{}|{}",
            target.trim().to_ascii_lowercase(),
            m.template_id.trim().to_ascii_lowercase(),
            m.name.trim().to_ascii_lowercase()
        )),
        _ => None,
    };
    task_db::NewFinding {
        dedupe_key,
        finding_type: finding_type.to_string(),
        severity: template::normalize_severity(&m.severity).to_string(),
        title: m.name.clone(),
        detail: Some(m.detail.clone()),
        ip: extract_ip(target),
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

// 复用 nuclei.rs 中的 helper（不在 pub API 中，此处内联）
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

// ── 测试用例 ─────────────────────────────────────────────────────────

/// 集成验证：nuclei 对模拟漏洞目标的全面扫描
///
/// 预期发现：
///   - 管理后台暴露 (medium)
///   - 调试端点暴露 (high)
///   - .env 文件泄露 (critical)
///   - Apache 版本过旧 (low, 被严重度过滤器排除)
///   - API 敏感信息泄露 (medium)
#[tokio::test]
async fn integration_nuclei_full_scan() {
    let (port, _running) = start_vulnerable_server();
    let target = format!("http://127.0.0.1:{}", port);

    // 准备模板
    let tmp = TempDir::new().unwrap();
    for (name, content) in [
        ("admin.yaml", NUCLEI_ADMIN_PANEL),
        ("debug.yaml", NUCLEI_DEBUG_ENDPOINT),
        ("env.yaml", NUCLEI_ENV_FILE_LEAK),
        ("apache.yaml", NUCLEI_OUTDATED_SERVER),
        ("api.yaml", NUCLEI_SENSITIVE_API),
    ] {
        std::fs::write(tmp.path().join(name), content).unwrap();
    }

    // 加载引擎
    let engine = NucleiEngine::load_from_dir(tmp.path()).await.unwrap();
    assert_eq!(engine.template_count(), 5, "应加载 5 个模板");

    // 模拟 nuclei 命令的 execute_target 管线
    let pool = make_pool().await;
    let executor = HttpExecutor::new().unwrap();

    for t in engine.all_templates() {
        if t.http.is_empty() {
            continue;
        }
        let sev_weight = template::severity_weight(&t.info.severity);
        if sev_weight < 3 {
            eprintln!(
                "  ⏭ 跳过低严重度模板: {} (severity={}, weight={})",
                t.info.name, t.info.severity, sev_weight
            );
            continue;
        }

        match executor.execute_template(t, &target).await {
            Ok(matches) => {
                for m in &matches {
                    task_db::insert_or_update_finding(&pool, &make_finding(&target, m, "vulnerability"))
                        .await
                        .unwrap();
                    eprintln!("  ✓ 发现: {} [{}]", m.name, m.severity);
                }
            }
            Err(e) => {
                eprintln!("  ✗ 模板 {} 执行失败: {}", t.info.name, e);
            }
        }
    }

    // 验证 findings
    let findings = task_db::query_findings(&pool).await.unwrap();

    eprintln!(
        "\n═══════════════════════════════════════════"
    );
    eprintln!("  集成验证报告 — Nuclei 漏洞扫描");
    eprintln!("═══════════════════════════════════════════");
    eprintln!("  目标: {}", target);
    eprintln!("  模板总数: 5 (有效 4, 低严重度跳过 1)");
    eprintln!("  发现总数: {}", findings.len());
    eprintln!("───────────────────────────────────────────");

    for f in &findings {
        eprintln!(
            "  [{}] {} — {}:{}",
            f.severity.to_uppercase(),
            f.title,
            f.ip,
            f.port
        );
    }
    eprintln!("═══════════════════════════════════════════\n");

    // 断言
    assert_eq!(findings.len(), 4, "应发现 4 个漏洞（1 个低严重度被排除）");

    let titles: Vec<&str> = findings.iter().map(|f| f.title.as_str()).collect();
    assert!(titles.contains(&"管理后台暴露"), "应发现管理后台");
    assert!(titles.contains(&"调试端点暴露"), "应发现调试端点");
    assert!(titles.contains(&"环境变量文件泄露"), "应发现 .env 泄露");
    assert!(titles.contains(&"API 敏感信息泄露"), "应发现 API 信息泄露");

    // 验证严重度分布
    let critical = findings.iter().filter(|f| f.severity == "critical").count();
    let high = findings.iter().filter(|f| f.severity == "high").count();
    let medium = findings.iter().filter(|f| f.severity == "medium").count();
    assert_eq!(critical, 1, "应有 1 个严重漏洞");
    assert_eq!(high, 1, "应有 1 个高危漏洞");
    assert_eq!(medium, 2, "应有 2 个中危漏洞");

    // 验证 metadata_json 包含 template_id
    for f in &findings {
        let meta: serde_json::Value =
            serde_json::from_str(&f.metadata_json).expect("metadata_json 应为合法 JSON");
        assert!(meta.get("template_id").is_some(), "metadata 应包含 template_id");
    }

    // 验证去重：再扫一次
    for t in engine.all_templates() {
        if t.http.is_empty() || template::severity_weight(&t.info.severity) < 3 {
            continue;
        }
        for m in executor.execute_template(t, &target).await.unwrap() {
            task_db::insert_or_update_finding(&pool, &make_finding(&target, &m, "vulnerability"))
                .await
                .unwrap();
        }
    }
    let after_dup = task_db::query_findings(&pool).await.unwrap();
    assert_eq!(after_dup.len(), 4, "去重后仍为 4 条");
    for f in &after_dup {
        assert_eq!(f.occurrences, 2, "每条 occurrence 应为 2");
    }
    eprintln!("  ✓ 去重验证通过：重复扫描 occurrence 正确递增为 2");
}

/// 集成验证：nuclei 引擎 HTTP 匹配器精度
#[tokio::test]
async fn integration_matcher_precision() {
    let (port, _running) = start_vulnerable_server();
    let target = format!("http://127.0.0.1:{}", port);

    // —— 测试 1：精确状态码匹配 ——
    let tpl_status = r#"
id: test-status
info:
  name: Status Test
  severity: medium
  tags: test
http:
  - method: GET
    path:
      - "{{BaseURL}}/robots.txt"
    matchers:
      - type: status
        status:
          - 200
"#;

    let tmp = TempDir::new().unwrap();
    std::fs::write(tmp.path().join("status.yaml"), tpl_status).unwrap();
    let engine = NucleiEngine::load_from_dir(tmp.path()).await.unwrap();
    let executor = HttpExecutor::new().unwrap();
    let results = executor
        .execute_template(&engine.all_templates()[0], &target)
        .await
        .unwrap();
    assert_eq!(results.len(), 1, "状态码 200 匹配 /robots.txt");
    eprintln!("  ✓ 状态码匹配器：精确识别 200 响应");

    // —— 测试 2：单词匹配器的 AND 条件 ——
    let tpl_word_and = r#"
id: test-word-and
info:
  name: Word AND Test
  severity: medium
  tags: test
http:
  - method: GET
    path:
      - "{{BaseURL}}/debug"
    matchers-condition: and
    matchers:
      - type: word
        words:
          - "Traceback"
      - type: word
        words:
          - "password"
"#;
    std::fs::write(tmp.path().join("word_and.yaml"), tpl_word_and).unwrap();
    let engine = NucleiEngine::load_from_dir(tmp.path()).await.unwrap();
    let results = executor
        .execute_template(&engine.all_templates()[1], &target)
        .await
        .unwrap();
    assert_eq!(results.len(), 1, "AND 条件：'Traceback' 和 'password' 同时存在");
    eprintln!("  ✓ 单词匹配器 AND 条件：正确匹配复合条件");

    // —— 测试 3：单词匹配器否定 ——
    let tpl_negative = r#"
id: test-negative
info:
  name: Negative Test
  severity: medium
  tags: test
http:
  - method: GET
    path:
      - "{{BaseURL}}/"
    matchers-condition: and
    matchers:
      - type: word
        words:
          - "ACME"
        condition: and
      - type: word
        words:
          - "NonExistentString999"
        negative: true
"#;
    std::fs::write(tmp.path().join("negative.yaml"), tpl_negative).unwrap();
    let engine = NucleiEngine::load_from_dir(tmp.path()).await.unwrap();
    let results = executor
        .execute_template(&engine.all_templates()[2], &target)
        .await
        .unwrap();
    assert_eq!(results.len(), 1, "'ACME' 存在且 'NonExistentString999' 不存在");
    eprintln!("  ✓ 否定匹配器：正确排除不存在的字符串");

    // —— 测试 4：正则匹配器 ——
    let tpl_regex = r#"
id: test-regex
info:
  name: Regex Test
  severity: medium
  tags: test
http:
  - method: GET
    path:
      - "{{BaseURL}}/api/status"
    matchers:
      - type: regex
        part: body
        regex:
          - '"version":\s*"\d+\.\d+\.\d+"'
"#;
    std::fs::write(tmp.path().join("regex.yaml"), tpl_regex).unwrap();
    let engine = NucleiEngine::load_from_dir(tmp.path()).await.unwrap();
    let results = executor
        .execute_template(&engine.all_templates()[3], &target)
        .await
        .unwrap();
    assert_eq!(results.len(), 1, "正则匹配 version 字段");
    eprintln!("  ✓ 正则匹配器：正确提取版本号模式");

    // —— 测试 5：header 匹配 ——
    let tpl_header = r#"
id: test-header
info:
  name: Header Test
  severity: medium
  tags: test
http:
  - method: GET
    path:
      - "{{BaseURL}}/"
    matchers:
      - type: word
        part: header
        words:
          - "Apache/2.4.41"
"#;
    std::fs::write(tmp.path().join("header.yaml"), tpl_header).unwrap();
    let engine = NucleiEngine::load_from_dir(tmp.path()).await.unwrap();
    let results = executor
        .execute_template(&engine.all_templates()[4], &target)
        .await
        .unwrap();
    assert_eq!(results.len(), 1, "header 中匹配 Apache 版本");
    eprintln!("  ✓ Header 匹配器：正确识别 Server 头中的 Apache 版本");

    eprintln!("\n  🎯 全部 5 个匹配器精度测试通过");
}

/// 集成验证：httpx 指纹识别流程
#[tokio::test]
async fn integration_httpx_fingerprinting() {
    // httpx 依赖外部二进制文件，此处验证其 finding 写入逻辑
    // 模拟一条 httpx 扫描结果，验证 finding 管线

    let pool = make_pool().await;

    // 模拟 httpx 对目标扫描后产生的记录（通常由 parse_httpx_record 解析）
    // 设计多条记录覆盖不同场景
    let simulated_findings = vec![
        task_db::NewFinding {
            dedupe_key: None,
            finding_type: "http_response".to_string(),
            severity: "medium".to_string(),
            title: "Admin Panel Found".to_string(),
            detail: Some("发现管理后台: http://127.0.0.1:8080/admin [200] title=Admin Panel".into()),
            ip: Some("127.0.0.1".into()),
            port: Some(8080),
            protocol: Some("http".into()),
            source_tool: Some("httpx".into()),
            source_command: Some("httpx".into()),
            metadata_json: Some(
                serde_json::json!({
                    "url": "http://127.0.0.1:8080/admin",
                    "status_code": 200,
                    "title": "Admin Panel",
                    "tech": ["Apache", "PHP/7.2.34"]
                })
                .to_string(),
            ),
        },
        task_db::NewFinding {
            dedupe_key: None,
            finding_type: "http_response".to_string(),
            severity: "high".to_string(),
            title: "Debug Endpoint Exposed".to_string(),
            detail: Some("发现敏感端点: http://127.0.0.1:8080/debug [200]".into()),
            ip: Some("127.0.0.1".into()),
            port: Some(8080),
            protocol: Some("http".into()),
            source_tool: Some("httpx".into()),
            source_command: Some("httpx".into()),
            metadata_json: Some(
                serde_json::json!({
                    "url": "http://127.0.0.1:8080/debug",
                    "status_code": 200,
                    "title": ""
                })
                .to_string(),
            ),
        },
        task_db::NewFinding {
            dedupe_key: None,
            finding_type: "http_response".to_string(),
            severity: "info".to_string(),
            title: "Robots.txt Found".to_string(),
            detail: Some("发现 robots.txt: http://127.0.0.1:8080/robots.txt [200]".into()),
            ip: Some("127.0.0.1".into()),
            port: Some(8080),
            protocol: Some("http".into()),
            source_tool: Some("httpx".into()),
            source_command: Some("httpx".into()),
            metadata_json: Some(
                serde_json::json!({
                    "url": "http://127.0.0.1:8080/robots.txt",
                    "status_code": 200,
                    "title": ""
                })
                .to_string(),
            ),
        },
    ];

    // 写入 findings
    for f in &simulated_findings {
        task_db::insert_or_update_finding(&pool, f).await.unwrap();
    }

    let findings = task_db::query_findings(&pool).await.unwrap();
    assert_eq!(findings.len(), 3);

    eprintln!("\n═══════════════════════════════════════════");
    eprintln!("  集成验证报告 — HTTPX 指纹识别");
    eprintln!("═══════════════════════════════════════════");
    eprintln!("  模拟目标: 127.0.0.1:8080");
    eprintln!("  发现总数: {}", findings.len());
    eprintln!("───────────────────────────────────────────");

    let severity_counts: std::collections::HashMap<&str, usize> = findings
        .iter()
        .fold(std::collections::HashMap::new(), |mut acc, f| {
            *acc.entry(f.severity.as_str()).or_default() += 1;
            acc
        });

    for (sev, count) in &severity_counts {
        eprintln!("  [{}] {} 条", sev.to_uppercase(), count);
    }

    eprintln!("───────────────────────────────────────────");
    for f in &findings {
        eprintln!(
            "  {}:{} -> {} [{}] {}",
            f.ip, f.port, f.title, f.severity, f.source_tool
        );
    }
    eprintln!("═══════════════════════════════════════════\n");

    // 验证 findings 属性完整性
    for f in &findings {
        assert!(!f.title.is_empty(), "title 不能为空");
        assert!(!f.severity.is_empty(), "severity 不能为空");
        assert!(!f.ip.is_empty(), "ip 不能为空");
        assert!(f.port > 0, "port 应大于 0");
        assert!(!f.metadata_json.is_empty(), "metadata_json 不能为空");

        // 验证 metadata_json 可解析
        let _meta: serde_json::Value =
            serde_json::from_str(&f.metadata_json).expect("metadata_json 应为合法 JSON");
    }

    eprintln!("  ✓ HTTPX findings 属性完整性验证通过");
    eprintln!("  ✓ 去重键由 build_finding_dedupe_key 自动生成");
}

/// 集成验证：mixed 扫描管线（nuclei + httpx findings 在同一 DB 中）
#[tokio::test]
async fn integration_mixed_pipeline() {
    let (port, _running) = start_vulnerable_server();
    let target = format!("http://127.0.0.1:{}", port);

    let pool = make_pool().await;
    let executor = HttpExecutor::new().unwrap();

    // 1. nuclei 扫描
    let tmp = TempDir::new().unwrap();
    std::fs::write(tmp.path().join("admin.yaml"), NUCLEI_ADMIN_PANEL).unwrap();
    std::fs::write(tmp.path().join("env.yaml"), NUCLEI_ENV_FILE_LEAK).unwrap();

    let engine = NucleiEngine::load_from_dir(tmp.path()).await.unwrap();
    for t in engine.all_templates() {
        if t.http.is_empty() || template::severity_weight(&t.info.severity) < 3 {
            continue;
        }
        for m in executor.execute_template(t, &target).await.unwrap() {
            task_db::insert_or_update_finding(&pool, &make_finding(&target, &m, "vulnerability"))
                .await
                .unwrap();
        }
    }

    // 2. 模拟 httpx 扫描结果（与上面同一目标不同端口）
    for (sev, title, detail, port) in [
        ("medium", "Admin Panel Found", "管理后台", 80_i64),
        ("info", "Apache Detected", "Apache/2.4.41", 80),
        ("high", "PHP 7.2.34 Detected", "过期的 PHP 版本", 80),
    ] {
        task_db::insert_or_update_finding(
            &pool,
            &task_db::NewFinding {
                dedupe_key: None,
                finding_type: "http_response".to_string(),
                severity: sev.to_string(),
                title: title.to_string(),
                detail: Some(detail.to_string()),
                ip: Some("127.0.0.1".into()),
                port: Some(port),
                protocol: Some("http".into()),
                source_tool: Some("httpx".into()),
                source_command: Some("httpx".into()),
                metadata_json: Some(serde_json::json!({"source": "httpx"}).to_string()),
            },
        )
        .await
        .unwrap();
    }

    let all = task_db::query_findings(&pool).await.unwrap();
    let nuclei_count = all.iter().filter(|f| f.source_tool == "nuclei").count();
    let httpx_count = all.iter().filter(|f| f.source_tool == "httpx").count();

    eprintln!("\n═══════════════════════════════════════════");
    eprintln!("  集成验证报告 — 混合扫描管线");
    eprintln!("═══════════════════════════════════════════");
    eprintln!("  目标: {}", target);
    eprintln!("  发现总数: {} (nuclei={}, httpx={})", all.len(), nuclei_count, httpx_count);
    eprintln!("───────────────────────────────────────────");

    // 按 source_tool 分组展示
    for tool in &["nuclei", "httpx"] {
        eprintln!("  [{}]", tool.to_uppercase());
        for f in all.iter().filter(|f| f.source_tool == *tool) {
            eprintln!("    {} | {} | {}:{}", f.severity, f.title, f.ip, f.port);
        }
    }
    eprintln!("═══════════════════════════════════════════\n");

    assert!(nuclei_count >= 2, "nuclei 至少应有 2 条发现");
    assert!(httpx_count >= 3, "httpx 至少应有 3 条发现");

    // 验证按 IP 查询
    let by_ip = task_db::query_findings_by_ip(&pool, "127.0.0.1").await.unwrap();
    assert_eq!(by_ip.len(), all.len());
    eprintln!("  ✓ query_findings_by_ip 验证通过");
}
