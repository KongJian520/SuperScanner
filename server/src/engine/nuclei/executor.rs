use super::template::{Extractor, HttpRequest, MatchResult, NucleiTemplate};
use super::variables;
use crate::engine::nuclei::matcher::{evaluate_matchers, MatchContext};
use regex::Regex;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use std::collections::HashMap;
use std::time::Duration;
use tracing::debug;

/// HTTP 请求执行器，发送请求并执行匹配器/提取器
pub struct HttpExecutor {
    /// 复用的 reqwest HTTP 客户端
    client: reqwest::Client,
}

impl HttpExecutor {
    /// 创建新的 HTTP 执行器，配置超时和 TLS 选项
    pub fn new() -> Result<Self, crate::error::AppError> {
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(30))
            .redirect(reqwest::redirect::Policy::none())
            .danger_accept_invalid_certs(true)
            .build()
            .map_err(|e| crate::error::AppError::Config(format!("创建 HTTP 客户端失败: {}", e)))?;
        Ok(Self { client })
    }

    /// 返回底层的 HTTP 客户端引用
    pub fn client(&self) -> &reqwest::Client {
        &self.client
    }

    /// 对目标执行单个模板，返回所有匹配结果
    pub async fn execute_template(
        &self,
        template: &NucleiTemplate,
        target: &str,
    ) -> Result<Vec<MatchResult>, crate::error::AppError> {
        if template.http.is_empty() {
            return Ok(Vec::new());
        }

        let mut results: Vec<MatchResult> = Vec::new();
        let mut dynamic_vars: HashMap<String, String> = HashMap::new();

        for (request_idx, http_request) in template.http.iter().enumerate() {
            let paths = http_request.effective_paths();
            if paths.is_empty() {
                continue;
            }

            for (path_idx, path) in paths.iter().enumerate() {
                let replaced_path = variables::replace_variables(path, target);
                let replaced_headers =
                    variables::replace_headers(&http_request.headers, target, &dynamic_vars);
                let replaced_body = http_request
                    .body
                    .as_deref()
                    .map(|b| variables::replace_variables(b, target));

                debug!(
                    template_id = %template.id,
                    request = request_idx,
                    path = path_idx,
                    target = %replaced_path,
                    "executing nuclei request"
                );

                let response = self
                    .send_request(
                        http_request,
                        &replaced_path,
                        &replaced_headers,
                        replaced_body.as_deref(),
                        &dynamic_vars,
                    )
                    .await;

                match response {
                    Ok(resp_data) => {
                        let matchers = match &http_request.matchers {
                            Some(m) => m.as_slice(),
                            None => &[],
                        };
                        if matchers.is_empty() {
                            continue;
                        }

                        let ctx = MatchContext {
                            body: &resp_data.body,
                            headers: &resp_data.headers,
                            status_code: resp_data.status,
                            content_length: resp_data.body.len() as u64,
                        };

                        let condition = http_request
                            .matchers_condition
                            .as_deref()
                            .unwrap_or("or");

                        if evaluate_matchers(matchers, condition, &ctx) {
                            let matched_at = replaced_path.clone();
                            let extractor_data =
                                run_extractors(http_request, &ctx, &mut dynamic_vars);

                            results.push(MatchResult {
                                template_id: template.id.clone(),
                                name: template.info.name.clone(),
                                severity: template.info.severity.clone(),
                                matched_at,
                                matcher_name: None,
                                extractors: extractor_data,
                                detail: format!(
                                    "template_id={}, request={}, path={}",
                                    template.id,
                                    request_idx,
                                    path_idx
                                ),
                            });

                            if http_request.stop_at_first_match.unwrap_or(false) {
                                return Ok(results);
                            }
                        }
                    }
                    Err(e) => {
                        debug!(
                            template_id = %template.id,
                            target = %replaced_path,
                            error = %e,
                            "HTTP request failed for nuclei template"
                        );
                    }
                }
            }
        }

        Ok(results)
    }

    async fn send_request(
        &self,
        request: &HttpRequest,
        path: &str,
        headers: &HashMap<String, String>,
        body: Option<&str>,
        _dynamic_vars: &HashMap<String, String>,
    ) -> Result<HttpResponseData, reqwest::Error> {
        if request.has_raw() {
            self.send_raw_request(
                request,
                path,
                headers,
                body,
            )
            .await
        } else {
            self.send_named_request(request, path, headers, body).await
        }
    }

    async fn send_named_request(
        &self,
        request: &HttpRequest,
        url: &str,
        headers_map: &HashMap<String, String>,
        body: Option<&str>,
    ) -> Result<HttpResponseData, reqwest::Error> {
        let method = request.method.as_deref().unwrap_or("GET").to_uppercase();
        let reqwest_method = match method.as_str() {
            "GET" => reqwest::Method::GET,
            "POST" => reqwest::Method::POST,
            "PUT" => reqwest::Method::PUT,
            "DELETE" => reqwest::Method::DELETE,
            "PATCH" => reqwest::Method::PATCH,
            "HEAD" => reqwest::Method::HEAD,
            "OPTIONS" => reqwest::Method::OPTIONS,
            _ => reqwest::Method::GET,
        };

        let mut req = self.client.request(reqwest_method, url);

        for (k, v) in headers_map {
            if let (Ok(name), Ok(value)) = (HeaderName::from_bytes(k.as_bytes()), HeaderValue::from_str(v)) {
                req = req.header(name, value);
            }
        }

        if let Some(b) = body {
            if !b.is_empty() {
                req = req.body(b.to_string());
            }
        }

        let resp = req.send().await?;
        let status = resp.status().as_u16();
        let resp_headers = format_headers(resp.headers());
        let resp_body = resp.text().await?;

        Ok(HttpResponseData {
            status,
            headers: resp_headers,
            body: resp_body,
        })
    }

    async fn send_raw_request(
        &self,
        _request: &HttpRequest,
        raw_text: &str,
        headers_map: &HashMap<String, String>,
        _body: Option<&str>,
    ) -> Result<HttpResponseData, reqwest::Error> {
        let (url, method, raw_headers, raw_body) =
            parse_raw_http(raw_text, headers_map);

        let reqwest_method = match method.to_uppercase().as_str() {
            "GET" => reqwest::Method::GET,
            "POST" => reqwest::Method::POST,
            "PUT" => reqwest::Method::PUT,
            "DELETE" => reqwest::Method::DELETE,
            "PATCH" => reqwest::Method::PATCH,
            "HEAD" => reqwest::Method::HEAD,
            "OPTIONS" => reqwest::Method::OPTIONS,
            _ => reqwest::Method::GET,
        };

        let mut req = self.client.request(reqwest_method, &url);

        for (k, v) in headers_map {
            if let (Ok(name), Ok(value)) = (HeaderName::from_bytes(k.as_bytes()), HeaderValue::from_str(v)) {
                req = req.header(name, value);
            }
        }
        for (k, v) in &raw_headers {
            if let (Ok(name), Ok(value)) = (HeaderName::from_bytes(k.as_bytes()), HeaderValue::from_str(v)) {
                req = req.header(name, value);
            }
        }

        if !raw_body.is_empty() {
            req = req.body(raw_body);
        }

        let resp = req.send().await?;
        let status = resp.status().as_u16();
        let resp_headers = format_headers(resp.headers());
        let resp_body = resp.text().await?;

        Ok(HttpResponseData {
            status,
            headers: resp_headers,
            body: resp_body,
        })
    }
}

struct HttpResponseData {
    status: u16,
    headers: String,
    body: String,
}

fn format_headers(headers: &HeaderMap) -> String {
    let mut lines = String::new();
    for (name, value) in headers.iter() {
        lines.push_str(&format!("{}: {}\n", name.as_str(), value.to_str().unwrap_or("")));
    }
    lines
}

fn parse_raw_http(
    raw_text: &str,
    extra_headers: &HashMap<String, String>,
) -> (String, String, HashMap<String, String>, String) {
    let mut lines = raw_text.lines();
    let request_line = lines.next().unwrap_or("GET / HTTP/1.1");

    let parts: Vec<&str> = request_line.split_whitespace().collect();
    let method = parts.first().map(|s| s.to_string()).unwrap_or_else(|| "GET".into());
    let raw_path = parts.get(1).map(|s| s.to_string()).unwrap_or_else(|| "/".into());

    let mut url = raw_path.clone();
    let mut headers: HashMap<String, String> = HashMap::new();
    let mut body_start = false;
    let mut body_lines: Vec<String> = Vec::new();

    for line in lines.by_ref() {
        if body_start {
            body_lines.push(line.to_string());
            continue;
        }
        if line.trim().is_empty() {
            body_start = true;
            continue;
        }
        if let Some((k, v)) = line.split_once(':') {
            let key = k.trim().to_string();
            let value = v.trim().to_string();
            if key.eq_ignore_ascii_case("Host") {
                if !raw_path.starts_with("http://") && !raw_path.starts_with("https://") {
                    url = format!("https://{}:443{}", value, raw_path);
                    if extra_headers.is_empty() {
                        url = format!("http://{}:80{}", value, raw_path);
                    }
                }
            }
            headers.insert(key, value);
        }
    }

    if raw_path.starts_with("http://") || raw_path.starts_with("https://") {
        url = raw_path;
    }

    // Determine scheme from extra_headers or default
    if !url.starts_with("http://") && !url.starts_with("https://") {
        let scheme = if extra_headers.is_empty() { "https" } else { "http" };
        url = format!("{}://{}", scheme, if url.starts_with('/') { &url[1..] } else { &url });
    }

    (url, method, headers, body_lines.join("\n"))
}

fn run_extractors(
    request: &HttpRequest,
    ctx: &MatchContext,
    dynamic_vars: &mut HashMap<String, String>,
) -> HashMap<String, Vec<String>> {
    let mut results: HashMap<String, Vec<String>> = HashMap::new();
    let extractors = match &request.extractors {
        Some(ext) => ext,
        None => return results,
    };

    for extractor in extractors {
        match extractor.extractor_type.as_str() {
            "regex" => run_regex_extractor(extractor, ctx, &mut results),
            "json" => run_json_extractor(extractor, ctx, &mut results),
            "kval" => run_kval_extractor(extractor, ctx, &mut results),
            _ => {}
        }
    }

    // Store first value of each extractor as a dynamic variable
    for (name, values) in &results {
        if let Some(first) = values.first() {
            dynamic_vars.insert(name.clone(), first.clone());
        }
    }

    results
}

fn run_regex_extractor(
    extractor: &Extractor,
    ctx: &MatchContext,
    results: &mut HashMap<String, Vec<String>>,
) {
    let patterns = match &extractor.regex {
        Some(p) => p,
        None => return,
    };

    let part = get_extractor_part(extractor, ctx);
    let group = extractor.group.unwrap_or(0) as usize;

    for pattern in patterns {
        match Regex::new(pattern) {
            Ok(re) => {
                if let Some(caps) = re.captures(&part) {
                    let value = if group > 0 && group < caps.len() {
                        caps.get(group).map(|m| m.as_str().to_string())
                    } else {
                        caps.get(0).map(|m| m.as_str().to_string())
                    };
                    if let Some(v) = value {
                        let name = extractor
                            .name
                            .clone()
                            .unwrap_or_else(|| "extracted".to_string());
                        results.entry(name).or_default().push(v);
                    }
                }
            }
            Err(_) => {}
        }
    }
}

fn run_json_extractor(
    extractor: &Extractor,
    ctx: &MatchContext,
    results: &mut HashMap<String, Vec<String>>,
) {
    let json_paths = match &extractor.json {
        Some(p) => p,
        None => return,
    };

    // Try to parse the body as JSON
    let part = get_extractor_part(extractor, ctx);
    let _ = serde_json::from_str::<serde_json::Value>(&part).map(|json_value| {
        for _path in json_paths {
            if let Some(value) = extract_json_value(&json_value) {
                let name = extractor
                    .name
                    .clone()
                    .unwrap_or_else(|| "json_extracted".to_string());
                results.entry(name).or_default().push(value);
            }
        }
    });
}

fn extract_json_value(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::String(s) => Some(s.clone()),
        serde_json::Value::Number(n) => Some(n.to_string()),
        serde_json::Value::Bool(b) => Some(b.to_string()),
        serde_json::Value::Null => Some("null".to_string()),
        serde_json::Value::Object(map) => {
            // Return all keys as concatenated values
            Some(map.keys().cloned().collect::<Vec<_>>().join(","))
        }
        _ => None,
    }
}

fn run_kval_extractor(
    extractor: &Extractor,
    ctx: &MatchContext,
    results: &mut HashMap<String, Vec<String>>,
) {
    let part = get_extractor_part(extractor, ctx);
    for line in part.lines() {
        if let Some((k, v)) = line.split_once(':') {
            let key = k.trim().to_string();
            let value = v.trim().to_string();
            if !value.is_empty() {
                results.entry(key).or_default().push(value);
            }
        }
    }
}

fn get_extractor_part(extractor: &Extractor, ctx: &MatchContext) -> String {
    match extractor.part.as_deref().unwrap_or("body") {
        "header" | "headers" => ctx.headers.to_string(),
        "body" => ctx.body.to_string(),
        "all" | "response" => format!("{}\n{}", ctx.headers, ctx.body),
        _ => ctx.body.to_string(),
    }
}
