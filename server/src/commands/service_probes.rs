use once_cell::sync::Lazy;
use regex::bytes::{Regex, RegexBuilder};
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use tracing::warn;

const DEFAULT_PROBES_PATH: &str =
    concat!(env!("CARGO_MANIFEST_DIR"), "/resources/nmap-service-probes");

#[derive(Debug)]
struct ProbeMatch {
    service: String,
    product: Option<String>,
    regex: Regex,
}

#[derive(Debug, Default)]
struct ServiceProbeMatcher {
    rules: Vec<ProbeMatch>,
}

impl ServiceProbeMatcher {
    fn from_content(content: &str) -> Self {
        let mut rules = Vec::new();
        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') {
                continue;
            }
            if let Some(rule) = parse_probe_line(trimmed, false) {
                rules.push(rule);
                continue;
            }
            if let Some(rule) = parse_probe_line(trimmed, true) {
                rules.push(rule);
            }
        }
        Self { rules }
    }

    fn match_service(&self, banner: &[u8]) -> Option<String> {
        self.rules.iter().find_map(|rule| {
            if rule.regex.is_match(banner) {
                Some(
                    rule.product
                        .as_ref()
                        .map_or_else(|| rule.service.clone(), |p| p.clone()),
                )
            } else {
                None
            }
        })
    }
}

fn parse_probe_line(line: &str, soft: bool) -> Option<ProbeMatch> {
    let prefix = if soft { "softmatch " } else { "match " };
    if !line.starts_with(prefix) {
        return None;
    }
    let rest = &line[prefix.len()..];
    let (service, after_service) = rest.split_once(' ')?;
    let after_service = after_service.trim_start();
    if !after_service.starts_with('m') {
        return None;
    }

    let (raw_pattern, after_pattern) = parse_delimited(after_service, 'm')?;
    let mut chars = after_pattern.chars().peekable();
    let mut flags = String::new();
    while let Some(&ch) = chars.peek() {
        if ch.is_ascii_alphabetic() {
            flags.push(ch);
            chars.next();
        } else {
            break;
        }
    }
    let metadata = chars.collect::<String>();
    let fields = parse_fields(&metadata);
    let product = fields.get(&'p').cloned();

    let pattern = normalize_pattern(&raw_pattern);
    let mut builder = RegexBuilder::new(&pattern);
    builder
        .case_insensitive(flags.contains('i'))
        .dot_matches_new_line(flags.contains('s'))
        .multi_line(flags.contains('m'));
    let regex = builder.build().ok()?;

    Some(ProbeMatch {
        service: service.to_string(),
        product,
        regex,
    })
}

fn parse_delimited(input: &str, marker: char) -> Option<(String, &str)> {
    let mut iter = input.char_indices();
    let (_, first) = iter.next()?;
    if first != marker {
        return None;
    }
    let (delim_idx, delim) = iter.next()?;
    let body_start = delim_idx + delim.len_utf8();
    let mut escaped = false;
    for (idx, ch) in input[body_start..].char_indices() {
        if escaped {
            escaped = false;
            continue;
        }
        if ch == '\\' {
            escaped = true;
            continue;
        }
        if ch == delim {
            let end = body_start + idx;
            let value = input[body_start..end].to_string();
            let rest_start = end + delim.len_utf8();
            return Some((value, &input[rest_start..]));
        }
    }
    None
}

fn parse_fields(input: &str) -> HashMap<char, String> {
    let mut out = HashMap::new();
    let bytes = input.as_bytes();
    let mut i = 0usize;
    while i < bytes.len() {
        while i < bytes.len() && bytes[i].is_ascii_whitespace() {
            i += 1;
        }
        if i + 1 >= bytes.len() {
            break;
        }
        let key = bytes[i] as char;
        if !matches!(key, 'p' | 'v' | 'i' | 'o' | 'd' | 'h') {
            while i < bytes.len() && !bytes[i].is_ascii_whitespace() {
                i += 1;
            }
            continue;
        }
        let delim = bytes[i + 1] as char;
        if delim.is_ascii_whitespace() {
            i += 1;
            continue;
        }
        i += 2;
        let start = i;
        let mut escaped = false;
        while i < bytes.len() {
            let ch = bytes[i] as char;
            if escaped {
                escaped = false;
                i += 1;
                continue;
            }
            if ch == '\\' {
                escaped = true;
                i += 1;
                continue;
            }
            if ch == delim {
                let value = &input[start..i];
                out.entry(key).or_insert_with(|| value.to_string());
                i += 1;
                break;
            }
            i += 1;
        }
    }
    out
}

fn normalize_pattern(pattern: &str) -> String {
    pattern.replace("\\0", "\\x00")
}

static MATCHER: Lazy<Option<ServiceProbeMatcher>> = Lazy::new(|| {
    let path = std::env::var("SUPERSCANNER_NMAP_SERVICE_PROBES")
        .unwrap_or_else(|_| DEFAULT_PROBES_PATH.to_string());
    let probe_path = Path::new(&path);
    let content = match fs::read_to_string(probe_path) {
        Ok(c) => c,
        Err(e) => {
            warn!(
                "无法读取 nmap-service-probes [{}]: {}",
                probe_path.display(),
                e
            );
            return None;
        }
    };
    let matcher = ServiceProbeMatcher::from_content(&content);
    if matcher.rules.is_empty() {
        warn!(
            "nmap-service-probes 加载成功但无可用规则: {}",
            probe_path.display()
        );
        None
    } else {
        Some(matcher)
    }
});

pub fn match_service_banner(banner: &[u8]) -> Option<String> {
    if banner.is_empty() {
        return None;
    }
    MATCHER.as_ref().and_then(|m| m.match_service(banner))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_match_with_product() {
        let line = r#"match http m|^HTTP/1\.[01] \d{3}| p/Apache httpd/ v/$1/"#;
        let parsed = parse_probe_line(line, false).expect("parse failed");
        assert_eq!(parsed.service, "http");
        assert_eq!(parsed.product.as_deref(), Some("Apache httpd"));
        assert!(parsed.regex.is_match(b"HTTP/1.1 200 OK\r\n"));
    }

    #[test]
    fn parse_softmatch_line() {
        let line = r#"softmatch ssh m|^SSH-\d\.\d-OpenSSH| p/OpenSSH/"#;
        let parsed = parse_probe_line(line, true).expect("softmatch parse failed");
        assert_eq!(parsed.service, "ssh");
        assert!(parsed.regex.is_match(b"SSH-2.0-OpenSSH_9.9\r\n"));
    }

    #[test]
    fn matcher_prefers_product_name() {
        let content = "match redis m|^-ERR unknown command| p/Redis key-value store/\n";
        let matcher = ServiceProbeMatcher::from_content(content);
        let svc = matcher.match_service(b"-ERR unknown command 'PING'\r\n");
        assert_eq!(svc.as_deref(), Some("Redis key-value store"));
    }
}
