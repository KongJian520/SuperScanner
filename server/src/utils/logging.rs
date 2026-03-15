use std::path::PathBuf;
use tracing_appender::non_blocking::WorkerGuard;

pub fn init(path: PathBuf) -> WorkerGuard {
    super_scanner_shared::logging::init(path, "server.log")
}
