use std::path::PathBuf;
use tracing_appender::non_blocking::WorkerGuard;

/// 初始化服务端日志（输出到指定目录下的 server.log）
pub fn init(path: PathBuf) -> WorkerGuard {
    super_scanner_shared::logging::init(path, "server.log")
}
