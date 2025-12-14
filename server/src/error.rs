use thiserror::Error;
use tonic::Status;

#[derive(Error, Debug)]
pub enum AppError {
    #[error("配置错误: {0}")]
    Config(String),
    #[error("数据库错误: {0}")]
    Database(#[from] sqlx::Error),
    #[error("IO 错误: {0}")]
    Io(#[from] std::io::Error),
    #[error("任务错误: {0}")]
    Task(String),
    #[error("TLS 错误: {0}")]
    Tls(String),
    #[error("序列化错误: {0}")]
    Serialization(String),
    #[error("未知错误: {0}")]
    Unknown(#[from] anyhow::Error),
}

impl From<AppError> for Status {
    fn from(err: AppError) -> Self {
        match err {
            AppError::Database(e) => Status::internal(format!("数据库错误: {}", e)),
            AppError::Io(e) => Status::internal(format!("IO 错误: {}", e)),
            AppError::Task(e) => Status::internal(format!("任务错误: {}", e)),
            AppError::Config(e) => Status::invalid_argument(format!("配置错误: {}", e)),
            _ => Status::internal(format!("内部错误: {}", err)),
        }
    }
}
