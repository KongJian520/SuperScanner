use super::ScannerCommand;
use super::service_probes::match_service_banner;
use crate::domain::types::CommandSpec;
use crate::error::AppError;
use async_trait::async_trait;
use sqlx::sqlite::SqlitePool;
use std::path::PathBuf;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

pub struct BuiltinPortScanCommand;

#[async_trait]
impl ScannerCommand for BuiltinPortScanCommand {
    fn id(&self) -> &'static str {
        "builtin_port_scan"
    }

    fn description(&self) -> &'static str {
        "Builtin TCP Port Scanner"
    }

    fn build_spec(&self, targets: &[String], args: &[String]) -> CommandSpec {
        CommandSpec {
            id: "builtin_port_scan".to_string(),
            program: PathBuf::from("builtin_port_scan"),
            args: args.to_vec(),
            targets: targets.to_vec(),
            env: None,
            cwd: None,
        }
    }

    async fn init_db(&self, pool: &SqlitePool) -> Result<(), AppError> {
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS port_results (
                ip TEXT,
                port INTEGER,
                protocol TEXT,
                state TEXT,
                service TEXT,
                tool TEXT,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (ip, port, protocol)
            )",
        )
        .execute(pool)
        .await
        .map_err(|e| AppError::Storage(format!("无法创建 port_results 表: {}", e)))?;
        Ok(())
    }

    async fn execute_target(
        &self,
        target: &str,
        _task_dir: &PathBuf,
        pool: &SqlitePool,
    ) -> Result<(), AppError> {
        let top_ports = vec![21, 22, 23, 25, 53, 80, 110, 143, 443, 445, 3306, 3389, 8080];
        for port in top_ports {
            let addr = format!("{}:{}", target, port);
            let is_open =
                tokio::time::timeout(Duration::from_millis(500), TcpStream::connect(&addr))
                    .await
                    .map(|r| r.is_ok())
                    .unwrap_or(false);

            if is_open {
                let banner = grab_banner(target, port as u16).await;
                let service = match_service_banner(&banner)
                    .unwrap_or_else(|| fallback_service_by_port(port as u16).to_string());
                sqlx::query("INSERT OR REPLACE INTO port_results (ip, port, protocol, state, service, tool) VALUES (?, ?, ?, ?, ?, ?)")
                    .bind(target)
                    .bind(port as i32)
                    .bind("tcp")
                    .bind("open")
                    .bind(service)
                    .bind("builtin")
                    .execute(pool)
                    .await
                    .map_err(|e| AppError::Storage(format!("保存端口结果失败: {}", e)))?;
            }
        }
        Ok(())
    }

    async fn process_result(&self, _task_dir: &PathBuf) -> Result<(), AppError> {
        Ok(())
    }

    fn box_clone(&self) -> Box<dyn ScannerCommand> {
        Box::new(BuiltinPortScanCommand)
    }
}

async fn grab_banner(target: &str, port: u16) -> Vec<u8> {
    let addr = format!("{}:{}", target, port);
    let connect = tokio::time::timeout(Duration::from_millis(600), TcpStream::connect(&addr)).await;
    let mut stream = match connect {
        Ok(Ok(s)) => s,
        _ => return Vec::new(),
    };

    let mut out = Vec::new();
    let mut buf = [0u8; 2048];

    if let Ok(Ok(n)) = tokio::time::timeout(Duration::from_millis(220), stream.read(&mut buf)).await
    {
        if n > 0 {
            out.extend_from_slice(&buf[..n]);
        }
    }

    if out.is_empty() {
        for payload in probe_payloads(target, port) {
            let _ = stream.write_all(payload.as_bytes()).await;
            if let Ok(Ok(n)) =
                tokio::time::timeout(Duration::from_millis(420), stream.read(&mut buf)).await
            {
                if n > 0 {
                    out.extend_from_slice(&buf[..n]);
                    break;
                }
            }
        }
    }

    out
}

fn probe_payloads(target: &str, port: u16) -> Vec<String> {
    match port {
        80 | 8080 | 8000 | 8888 => vec![format!("GET / HTTP/1.0\r\nHost: {}\r\n\r\n", target)],
        25 | 587 | 2525 => vec!["EHLO superscanner.local\r\n".to_string()],
        110 => vec!["CAPA\r\n".to_string()],
        143 => vec!["a001 CAPABILITY\r\n".to_string()],
        53 => vec!["\r\n".to_string()],
        _ => vec!["\r\n".to_string()],
    }
}

fn fallback_service_by_port(port: u16) -> &'static str {
    match port {
        21 => "ftp",
        22 => "ssh",
        23 => "telnet",
        25 => "smtp",
        53 => "dns",
        80 | 8080 | 8000 | 8888 => "http",
        110 => "pop3",
        143 => "imap",
        443 | 8443 => "https",
        445 => "microsoft-ds",
        3306 => "mysql",
        3389 => "rdp",
        _ => "unknown",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_id_and_description() {
        let cmd = BuiltinPortScanCommand;
        assert_eq!(cmd.id(), "builtin_port_scan");
        assert!(!cmd.description().is_empty());
    }

    #[test]
    fn test_build_spec() {
        let cmd = BuiltinPortScanCommand;
        let targets = vec!["192.168.1.1".to_string()];
        let spec = cmd.build_spec(&targets, &[]);
        assert_eq!(spec.id, "builtin_port_scan");
        assert_eq!(spec.targets, targets);
    }

    #[test]
    fn test_fallback_service_by_port() {
        assert_eq!(fallback_service_by_port(22), "ssh");
        assert_eq!(fallback_service_by_port(80), "http");
        assert_eq!(fallback_service_by_port(9999), "unknown");
    }
}
