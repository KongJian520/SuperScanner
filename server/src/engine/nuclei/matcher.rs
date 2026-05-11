use super::template::Matcher;
use regex::Regex;

pub struct MatchContext<'a> {
    pub body: &'a str,
    pub headers: &'a str,
    pub status_code: u16,
    pub content_length: u64,
}

pub fn evaluate_matchers(
    matchers: &[Matcher],
    condition: &str,
    ctx: &MatchContext,
) -> bool {
    if matchers.is_empty() {
        return false;
    }

    let results: Vec<bool> = matchers.iter().map(|m| evaluate_single_matcher(m, ctx)).collect();

    if condition.eq_ignore_ascii_case("and") {
        results.iter().all(|&r| r)
    } else {
        results.iter().any(|&r| r)
    }
}

pub fn evaluate_single_matcher(matcher: &Matcher, ctx: &MatchContext) -> bool {
    let result = match matcher.matcher_type.as_str() {
        "word" => evaluate_word_matcher(matcher, ctx),
        "regex" => evaluate_regex_matcher(matcher, ctx),
        "status" => evaluate_status_matcher(matcher, ctx),
        "size" => evaluate_size_matcher(matcher, ctx),
        "dsl" => evaluate_dsl_matcher(matcher, ctx),
        _ => false,
    };

    if matcher.is_negative() {
        !result
    } else {
        result
    }
}

pub fn get_matcher_name(_matcher: &Matcher) -> Option<String> {
    None
}

fn select_parts<'a>(matcher: &Matcher, ctx: &'a MatchContext) -> Vec<&'a str> {
    let part = matcher.part.as_deref().unwrap_or("body");
    match part {
        "header" | "headers" => vec![ctx.headers],
        "body" => vec![ctx.body],
        "all" | "response" => vec![ctx.headers, ctx.body],
        "content_type" => {
            let ct = ctx
                .headers
                .lines()
                .find(|l| l.to_lowercase().starts_with("content-type:"))
                .unwrap_or("");
            vec![ct]
        }
        _ if part.starts_with("header=") => {
            let header_name = &part[7..];
            let value = ctx
                .headers
                .lines()
                .find(|l| l.to_lowercase().starts_with(&header_name.to_lowercase()))
                .map(|l| {
                    let colon = l.find(':').unwrap_or(0);
                    l[colon + 1..].trim()
                })
                .unwrap_or("");
            vec![value]
        }
        _ => vec![ctx.body],
    }
}

fn evaluate_word_matcher(matcher: &Matcher, ctx: &MatchContext) -> bool {
    let words = match &matcher.words {
        Some(w) => w,
        None => return false,
    };
    if words.is_empty() {
        return false;
    }

    let parts = select_parts(matcher, ctx);
    let check_fn: Box<dyn Fn(&str, &str) -> bool> = if matcher.is_case_insensitive() {
        Box::new(|haystack: &str, needle: &str| {
            haystack.to_lowercase().contains(&needle.to_lowercase())
        })
    } else {
        Box::new(|haystack: &str, needle: &str| haystack.contains(needle))
    };

    let cond = matcher.condition_and();
    let results: Vec<bool> = words
        .iter()
        .map(|word| parts.iter().any(|part| check_fn(part, word)))
        .collect();

    if cond {
        results.iter().all(|&r| r)
    } else {
        results.iter().any(|&r| r)
    }
}

fn evaluate_regex_matcher(matcher: &Matcher, ctx: &MatchContext) -> bool {
    let regex_patterns = match &matcher.regex {
        Some(r) => r,
        None => return false,
    };
    if regex_patterns.is_empty() {
        return false;
    }

    let parts = select_parts(matcher, ctx);
    let cond = matcher.condition_and();

    let results: Vec<bool> = regex_patterns
        .iter()
        .map(|pattern| {
            match Regex::new(pattern) {
                Ok(re) => parts.iter().any(|part| re.is_match(part)),
                Err(_) => false,
            }
        })
        .collect();

    if cond {
        results.iter().all(|&r| r)
    } else {
        results.iter().any(|&r| r)
    }
}

fn evaluate_status_matcher(matcher: &Matcher, ctx: &MatchContext) -> bool {
    let statuses = match &matcher.status {
        Some(s) => s,
        None => return false,
    };
    statuses.iter().any(|&s| s == ctx.status_code)
}

fn evaluate_size_matcher(matcher: &Matcher, ctx: &MatchContext) -> bool {
    let _ = matcher;
    ctx.content_length > 0
}

/// Simple DSL evaluator supporting common nuclei DSL expressions:
/// - status_code == N / status_code_1 == N, etc.
/// - contains(body, "...") / contains(header, "...")
/// - numeric comparisons
pub fn evaluate_dsl_matcher(matcher: &Matcher, ctx: &MatchContext) -> bool {
    let expressions = match &matcher.dsl {
        Some(expressions) => expressions,
        None => return false,
    };
    if expressions.is_empty() {
        return false;
    }

    let cond = matcher.condition_and();
    let results: Vec<bool> = expressions
        .iter()
        .map(|expr| evaluate_dsl_expression(expr.trim(), ctx))
        .collect();

    if cond {
        results.iter().all(|&r| r)
    } else {
        results.iter().any(|&r| r)
    }
}

fn evaluate_dsl_expression(expr: &str, ctx: &MatchContext) -> bool {
    let expr = expr.trim();

    if expr.contains("==") {
        return evaluate_dsl_equals(expr, ctx);
    }
    if expr.contains("!=") {
        return evaluate_dsl_not_equals(expr, ctx);
    }
    if let Some(inner) = expr
        .strip_prefix("contains(")
        .and_then(|rest| rest.strip_suffix(')'))
    {
        return evaluate_dsl_contains(inner, ctx);
    }
    if expr == "true" || expr == "True" {
        return true;
    }
    if expr == "false" || expr == "False" {
        return false;
    }

    false
}

fn evaluate_dsl_equals(expr: &str, ctx: &MatchContext) -> bool {
    let parts: Vec<&str> = expr.split("==").map(|s| s.trim()).collect();
    if parts.len() != 2 {
        return false;
    }
    let left_val = resolve_dsl_value(parts[0], ctx);
    let right_val = resolve_dsl_value(parts[1], ctx);
    left_val == right_val
}

fn evaluate_dsl_not_equals(expr: &str, ctx: &MatchContext) -> bool {
    let parts: Vec<&str> = expr.split("!=").map(|s| s.trim()).collect();
    if parts.len() != 2 {
        return false;
    }
    let left_val = resolve_dsl_value(parts[0], ctx);
    let right_val = resolve_dsl_value(parts[1], ctx);
    left_val != right_val
}

fn evaluate_dsl_contains(inner: &str, ctx: &MatchContext) -> bool {
    let parts: Vec<&str> = inner.split(',').map(|s| s.trim().trim_matches('"').trim_matches('\'')).collect();
    if parts.len() != 2 {
        return false;
    }
    let target = resolve_dsl_value(parts[0], ctx);
    let needle = parts[1];
    target.contains(needle)
}

fn resolve_dsl_value(expr: &str, ctx: &MatchContext) -> String {
    let expr = expr.trim().trim_matches('"').trim_matches('\'');
    match expr {
        "status_code" => ctx.status_code.to_string(),
        "status_code_1" | "status_code1" => ctx.status_code.to_string(),
        s if s.starts_with("status_code_") => {
            let idx: usize = s
                .strip_prefix("status_code_")
                .and_then(|n| n.parse().ok())
                .unwrap_or(1);
            if idx == 1 {
                ctx.status_code.to_string()
            } else {
                "0".to_string()
            }
        }
        "body" | "body_1" => ctx.body.to_string(),
        s if s.starts_with("body_") => {
            let idx: usize = s
                .strip_prefix("body_")
                .and_then(|n| n.parse().ok())
                .unwrap_or(1);
            if idx == 1 {
                ctx.body.to_string()
            } else {
                String::new()
            }
        }
        "header" => ctx.headers.to_string(),
        s if s.starts_with("header_") => ctx.headers.to_string(),
        _ => expr.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::nuclei::template::Matcher;

    fn make_ctx() -> MatchContext<'static> {
        MatchContext {
            body: "<html><title>Admin Panel</title></html>",
            headers: "HTTP/1.1 200 OK\r\nServer: nginx\r\nContent-Type: text/html",
            status_code: 200,
            content_length: 42,
        }
    }

    #[test]
    fn test_word_matcher_basic() {
        let ctx = make_ctx();
        let matcher = Matcher {
            matcher_type: "word".into(),
            part: Some("body".into()),
            words: Some(vec!["Admin Panel".into()]),
            regex: None,
            status: None,
            dsl: None,
            condition: None,
            negative: None,
            case_insensitive: None,
        };
        assert!(evaluate_single_matcher(&matcher, &ctx));
    }

    #[test]
    fn test_word_matcher_case_insensitive() {
        let ctx = make_ctx();
        let matcher = Matcher {
            matcher_type: "word".into(),
            part: Some("body".into()),
            words: Some(vec!["admin panel".into()]),
            regex: None,
            status: None,
            dsl: None,
            condition: None,
            negative: None,
            case_insensitive: Some(true),
        };
        assert!(evaluate_single_matcher(&matcher, &ctx));
    }

    #[test]
    fn test_word_matcher_negative() {
        let ctx = make_ctx();
        let matcher = Matcher {
            matcher_type: "word".into(),
            part: Some("body".into()),
            words: Some(vec!["Not Found".into()]),
            regex: None,
            status: None,
            dsl: None,
            condition: None,
            negative: Some(true),
            case_insensitive: None,
        };
        assert!(evaluate_single_matcher(&matcher, &ctx));
    }

    #[test]
    fn test_status_matcher() {
        let ctx = make_ctx();
        let matcher = Matcher {
            matcher_type: "status".into(),
            part: None,
            words: None,
            regex: None,
            status: Some(vec![200]),
            dsl: None,
            condition: None,
            negative: None,
            case_insensitive: None,
        };
        assert!(evaluate_single_matcher(&matcher, &ctx));
    }

    #[test]
    fn test_regex_matcher() {
        let ctx = make_ctx();
        let matcher = Matcher {
            matcher_type: "regex".into(),
            part: Some("body".into()),
            words: None,
            regex: Some(vec!["<title>[^<]+</title>".into()]),
            status: None,
            dsl: None,
            condition: None,
            negative: None,
            case_insensitive: None,
        };
        assert!(evaluate_single_matcher(&matcher, &ctx));
    }

    #[test]
    fn test_dsl_contains() {
        let ctx = make_ctx();
        let matcher = Matcher {
            matcher_type: "dsl".into(),
            part: None,
            words: None,
            regex: None,
            status: None,
            dsl: Some(vec!["contains(body, 'Admin Panel')".into()]),
            condition: None,
            negative: None,
            case_insensitive: None,
        };
        assert!(evaluate_single_matcher(&matcher, &ctx));
    }

    #[test]
    fn test_dsl_status_code() {
        let ctx = make_ctx();
        let matcher = Matcher {
            matcher_type: "dsl".into(),
            part: None,
            words: None,
            regex: None,
            status: None,
            dsl: Some(vec!["status_code == 200".into()]),
            condition: None,
            negative: None,
            case_insensitive: None,
        };
        assert!(evaluate_single_matcher(&matcher, &ctx));
    }

    #[test]
    fn test_matchers_and_condition() {
        let ctx = make_ctx();
        let matchers = vec![
            Matcher {
                matcher_type: "word".into(),
                part: Some("body".into()),
                words: Some(vec!["Admin".into()]),
                regex: None,
                status: None,
                dsl: None,
                condition: None,
                negative: None,
                case_insensitive: None,
            },
            Matcher {
                matcher_type: "status".into(),
                part: None,
                words: None,
                regex: None,
                status: Some(vec![200]),
                dsl: None,
                condition: None,
                negative: None,
                case_insensitive: None,
            },
        ];
        assert!(evaluate_matchers(&matchers, "and", &ctx));
    }

    #[test]
    fn test_matchers_or_condition() {
        let ctx = make_ctx();
        let matchers = vec![
            Matcher {
                matcher_type: "word".into(),
                part: Some("body".into()),
                words: Some(vec!["NotExist".into()]),
                regex: None,
                status: None,
                dsl: None,
                condition: None,
                negative: None,
                case_insensitive: None,
            },
            Matcher {
                matcher_type: "status".into(),
                part: None,
                words: None,
                regex: None,
                status: Some(vec![500]),
                dsl: None,
                condition: None,
                negative: None,
                case_insensitive: None,
            },
        ];
        assert!(!evaluate_matchers(&matchers, "and", &ctx));
        assert!(!evaluate_matchers(&matchers, "or", &ctx));
    }
}
