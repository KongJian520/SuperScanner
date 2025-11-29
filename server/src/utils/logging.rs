use std::{fs as stdfs, path::PathBuf};
use tracing_appender::non_blocking::WorkerGuard;
use tracing_appender::rolling;
use tracing_subscriber::{EnvFilter, fmt, layer::SubscriberExt, util::SubscriberInitExt};

/// 初始化 tracing 日志子系统。
///
/// - 在 `logs/` 目录创建一个不带 ANSI 的文件日志（`server.log`），并返回 `WorkerGuard`。
/// - 控制台使用带颜色输出以便开发时阅读，文件日志不带颜色便于分析/聚合。
/// - 返回的 `WorkerGuard` 必须在程序生命周期里保持（通常放在 `main` 中），
///   否则后台的非阻塞写入器会被丢弃，文件日志可能无法刷新到磁盘。
pub fn init(path: PathBuf) -> WorkerGuard {
    // 确保日志目录存在（忽略错误）
    let _ = stdfs::create_dir_all(&path);

    // 创建文件 appender：不使用滚动（示例用途），实际可按需改为 hourly/daily
    let file_appender = rolling::never(&path, "server.log");
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
