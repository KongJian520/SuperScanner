use std::{fs as stdfs, path::PathBuf};
use tracing_appender::non_blocking::WorkerGuard;
use tracing_appender::rolling;
use tracing_subscriber::{fmt, layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

/// Initialize the `tracing` logging subsystem.
///
/// - Creates a file logger under the given `path` and returns a `WorkerGuard`.
/// - The console layer prints colored output for development; the file layer is plain text.
/// - The returned `WorkerGuard` must be kept alive for the program lifetime so
///   background non-blocking writes are flushed on shutdown.
///
/// 初始化 tracing 日志子系统（中文说明保留）。
pub fn init(path: PathBuf) -> WorkerGuard {
    // 确保日志目录存在（忽略错误）
    let _ = stdfs::create_dir_all(&path);

    // 创建文件 appender：不使用滚动（示例用途），实际可按需改为 hourly/daily
    let file_appender = rolling::never(&path, "client.log");
    // non_blocking 是可复制的写入端，guard 用来保持后台线程活跃并在退出时刷新
    let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);

    let console_layer = fmt::layer()
        .with_ansi(true)
        .with_writer(std::io::stdout)
        .with_target(false);

    // 文件 layer：不带颜色，写入 non_blocking（异步），同样不显示目标字段
    let file_layer = fmt::layer()
        .with_ansi(false)
        .with_writer(non_blocking.clone())
        .with_target(false);

    // 环境变量控制日志级别（RUST_LOG）或默认 info
    let env_filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));

    // 将 filter 与两层（控制台 + 文件）注册到全局 subscriber
    tracing_subscriber::registry()
        .with(env_filter)
        .with(console_layer)
        .with(file_layer)
        .init();

    // 返回 guard，调用者应保留它的所有权直到退出
    guard
}
