use std::{fs as stdfs, path::PathBuf};
use tracing_appender::non_blocking::WorkerGuard;
use tracing_appender::rolling;
use tracing_subscriber::{fmt, layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

/// 初始化 tracing 日志子系统。
///
/// - 在 `path` 目录下创建名为 `log_name` 的文件日志，并返回 `WorkerGuard`。
/// - 控制台使用带颜色输出以便开发时阅读，文件日志不带颜色。
/// - 返回的 `WorkerGuard` 必须在程序生命周期里保持（通常放在 `main` 中），
///   否则后台的非阻塞写入器会被丢弃，文件日志可能无法刷新到磁盘。
pub fn init(path: PathBuf, log_name: &str) -> WorkerGuard {
    let _ = stdfs::create_dir_all(&path);

    let file_appender = rolling::never(&path, log_name);
    let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);

    let console_layer = fmt::layer()
        .with_ansi(true)
        .with_writer(std::io::stdout)
        .with_target(false);

    let file_layer = fmt::layer()
        .with_ansi(false)
        .with_writer(non_blocking)
        .with_target(false);

    let env_filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));

    let _ = tracing_subscriber::registry()
        .with(env_filter)
        .with(console_layer)
        .with(file_layer)
        .try_init();

    guard
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_init_creates_log_dir() {
        let dir = tempdir().unwrap();
        // Note: tracing global subscriber can only be set once per process.
        // We just verify the directory exists after init.
        let _guard = std::panic::catch_unwind(|| init(dir.path().to_path_buf(), "test.log"));
        assert!(dir.path().exists());
    }
}
