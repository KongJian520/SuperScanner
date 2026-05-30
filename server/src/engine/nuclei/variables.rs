/// 替换字符串中的 nuclei 模板变量
///
/// 支持的变量：{{BaseURL}}, {{Hostname}}, {{Host}}, {{Port}}, {{Scheme}},
/// {{FQDN}}, {{Path}}, {{File}} 和 randstr 类占位符
pub fn replace_variables(input: &str, target: &str) -> String {
    let parsed = parse_target_url(target);

    let mut result = input.to_string();

    result = result.replace("{{BaseURL}}", &parsed.base_url);
    result = result.replace("{{Hostname}}", &parsed.hostname);
    result = result.replace("{{Host}}", &parsed.host);
    result = result.replace("{{Port}}", &parsed.port);
    result = result.replace("{{Scheme}}", &parsed.scheme);
    result = result.replace("{{FQDN}}", &parsed.hostname);
    result = result.replace("{{Path}}", &parsed.path);
    result = result.replace("{{File}}", &parsed.file);

    // Handle {{randstr}} — generate a random string
    result = replace_randstr(&result);
    // Handle {{randstr_hex}} — generate random hex
    result = replace_randstr_hex(&result);

    result
}

/// 替换请求头中的模板变量和动态变量
pub fn replace_headers(
    headers: &std::collections::HashMap<String, String>,
    target: &str,
    variables: &std::collections::HashMap<String, String>,
) -> std::collections::HashMap<String, String> {
    let mut out = std::collections::HashMap::new();
    for (k, v) in headers {
        let v = replace_variables(v, target);
        let v = replace_dynamic_vars(&v, variables);
        out.insert(k.clone(), v);
    }
    out
}

/// 替换字符串中的动态变量（提取器结果）
pub fn replace_dynamic_vars(input: &str, variables: &std::collections::HashMap<String, String>) -> String {
    let mut result = input.to_string();
    for (key, value) in variables {
        result = result.replace(&format!("{{{{{}}}}}", key), value);
    }
    result
}

fn replace_randstr(input: &str) -> String {
    if input.contains("{{randstr") {
        let mut result = input.to_string();
        while let Some(start) = result.find("{{randstr}}") {
            let random_str = generate_random_alpha(8);
            result.replace_range(start..start + 11, &random_str);
        }
        while let Some(start) = result.find("{{randstr_") {
            if let Some(end) = result[start..].find("}}") {
                let spec = &result[start + 10..start + end];
                if let Ok(n) = spec.parse::<usize>() {
                    let random_str = generate_random_alpha(n);
                    result.replace_range(start..start + end + 2, &random_str);
                } else {
                    let random_str = generate_random_alpha(8);
                    result.replace_range(start..start + end + 2, &random_str);
                }
            } else {
                break;
            }
        }
        result
    } else {
        input.to_string()
    }
}

fn replace_randstr_hex(input: &str) -> String {
    if input.contains("{{randstr_hex") {
        let mut result = input.to_string();
        while let Some(start) = result.find("{{randstr_hex}}") {
            let random_hex = generate_random_hex(8);
            result.replace_range(start..start + 16, &random_hex);
        }
        while let Some(start) = result.find("{{randstr_hex_") {
            if let Some(end) = result[start..].find("}}") {
                let spec = &result[start + 14..start + end];
                if let Ok(n) = spec.parse::<usize>() {
                    let random_hex = generate_random_hex(n);
                    result.replace_range(start..start + end + 2, &random_hex);
                } else {
                    let random_hex = generate_random_hex(8);
                    result.replace_range(start..start + end + 2, &random_hex);
                }
            } else {
                break;
            }
        }
        result
    } else {
        input.to_string()
    }
}

fn generate_random_alpha(n: usize) -> String {
    use std::sync::atomic::{AtomicU32, Ordering};
    static COUNTER: AtomicU32 = AtomicU32::new(0);
    let seed = COUNTER.fetch_add(1, Ordering::Relaxed);
    let chars: Vec<char> = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ".chars().collect();
    let mut s = String::with_capacity(n);
    let mut x = seed.wrapping_mul(1103515245).wrapping_add(12345);
    for _ in 0..n {
        x = x.wrapping_mul(1103515245).wrapping_add(12345);
        let idx = (x >> 16) as usize % chars.len();
        s.push(chars[idx]);
    }
    s
}

fn generate_random_hex(n: usize) -> String {
    use std::sync::atomic::{AtomicU32, Ordering};
    static COUNTER: AtomicU32 = AtomicU32::new(0);
    let seed = COUNTER.fetch_add(1, Ordering::Relaxed);
    let chars: Vec<char> = "0123456789abcdef".chars().collect();
    let mut s = String::with_capacity(n);
    let mut x = seed.wrapping_mul(1103515245).wrapping_add(12345);
    for _ in 0..n {
        x = x.wrapping_mul(1103515245).wrapping_add(12345);
        let idx = (x >> 16) as usize % chars.len();
        s.push(chars[idx]);
    }
    s
}

#[derive(Debug, Clone)]
struct ParsedTarget {
    base_url: String,
    hostname: String,
    host: String,
    port: String,
    scheme: String,
    path: String,
    file: String,
}

fn parse_target_url(target: &str) -> ParsedTarget {
    let trimmed = target.trim();
    if trimmed.is_empty() {
        return ParsedTarget {
            base_url: String::new(),
            hostname: String::new(),
            host: String::new(),
            port: String::new(),
            scheme: String::new(),
            path: String::new(),
            file: String::new(),
        };
    }

    let (scheme, rest) = if let Some((s, r)) = trimmed.split_once("://") {
        (s.to_ascii_lowercase(), r.to_string())
    } else {
        ("http".to_string(), trimmed.to_string())
    };

    let (host_part, path_part) = if let Some(idx) = rest.find('/') {
        (rest[..idx].to_string(), rest[idx..].to_string())
    } else {
        (rest, "/".to_string())
    };

    let (hostname, port) = if host_part.starts_with('[') {
        if let Some(end_idx) = host_part.find(']') {
            let h = host_part[1..end_idx].to_string();
            let p = host_part[end_idx + 1..]
                .strip_prefix(':')
                .unwrap_or(if scheme == "https" { "443" } else { "80" })
                .to_string();
            (h, p)
        } else {
            (host_part.clone(), String::new())
        }
    } else if let Some((h, p)) = host_part.rsplit_once(':') {
        if !h.contains(':') {
            (h.to_string(), p.to_string())
        } else {
            (host_part.clone(), if scheme == "https" { "443".into() } else { "80".into() })
        }
    } else {
        let p = if scheme == "https" { "443" } else { "80" };
        (host_part, p.to_string())
    };

    let file = if let Some(last_slash) = path_part.rfind('/') {
        let candidate = &path_part[last_slash + 1..];
        if candidate.contains('.') {
            candidate.to_string()
        } else {
            String::new()
        }
    } else {
        String::new()
    };

    let base_url = if port == "80" || port == "443" {
        format!("{}://{}", scheme, hostname)
    } else {
        format!("{}://{}:{}", scheme, hostname, port)
    };

    ParsedTarget {
        host: hostname.clone(),
        base_url,
        hostname,
        port,
        scheme,
        path: path_part,
        file,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_replace_baseurl() {
        let result = replace_variables("{{BaseURL}}/admin", "http://10.0.0.1:8080");
        assert_eq!(result, "http://10.0.0.1:8080/admin");
    }

    #[test]
    fn test_replace_hostname() {
        let result = replace_variables("Host: {{Hostname}}", "https://example.com/path");
        assert_eq!(result, "Host: example.com");
    }

    #[test]
    fn test_replace_randstr() {
        let result = replace_variables("{{randstr}}", "http://10.0.0.1");
        assert!(!result.contains("{{randstr}}"));
        assert_eq!(result.len(), 8);
    }

    #[test]
    fn test_parse_target_https_default_port() {
        let result = replace_variables("{{BaseURL}}/api", "https://example.com/api");
        assert_eq!(result, "https://example.com/api");
    }

    #[test]
    fn test_replace_headers() {
        let mut headers = std::collections::HashMap::new();
        headers.insert("Host".to_string(), "{{Hostname}}".to_string());
        headers.insert("X-Custom".to_string(), "{{BaseURL}}/test".to_string());
        let result = replace_headers(&headers, "http://10.0.0.1:8080", &Default::default());
        assert_eq!(result.get("Host").unwrap(), "10.0.0.1");
        assert_eq!(result.get("X-Custom").unwrap(), "http://10.0.0.1:8080/test");
    }
}
