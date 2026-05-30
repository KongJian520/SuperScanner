use std::path::PathBuf;
use tracing_appender::non_blocking::WorkerGuard;

/// 初始化客户端日志（输出到指定目录下的 client.log）
pub fn init(path: PathBuf) -> WorkerGuard {
    super_scanner_shared::logging::init(path, "client.log")
}
