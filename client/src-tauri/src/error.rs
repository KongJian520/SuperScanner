use serde::Serialize;

/// Tauri 命令错误类型，包装 anyhow 错误并实现 Serialize 以便前端处理
#[derive(Debug, thiserror::Error)]
pub enum CommandError {
    #[error(transparent)]
    Anyhow(#[from] anyhow::Error),
}

impl Serialize for CommandError {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(self.to_string().as_str())
    }
}

/// Tauri 命令的统一 Result 类型
pub type Result<T> = std::result::Result<T, CommandError>;
