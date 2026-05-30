use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use tonic::transport::{Channel, Endpoint};
use tracing::info;

/// 应用全局状态，维护 gRPC 连接池（地址到 Channel 的映射）
pub struct AppState {
    pool: Arc<Mutex<HashMap<String, Channel>>>,
}

impl AppState {
    /// 创建一个新的空状态实例
    pub fn new() -> Self {
        Self {
            pool: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// 获取（或创建）指定地址的 gRPC Channel，支持连接池复用
    pub async fn channel_for(
        &self,
        addr: &str,
        use_tls: bool,
    ) -> Result<Channel, tonic::transport::Error> {
        let uri = if addr.starts_with("http://") || addr.starts_with("https://") {
            addr.to_string()
        } else if use_tls {
            format!("https://{}", addr)
        } else {
            format!("http://{}", addr)
        };

        {
            let pool = self.pool.lock().await;
            if let Some(ch) = pool.get(&uri) {
                info!(uri = %uri, "reusing existing gRPC channel");
                return Ok(ch.clone());
            }
        }

        info!(uri = %uri, use_tls, "creating new gRPC channel");
        let ep = Endpoint::from_shared(uri.clone())?
            .connect_timeout(std::time::Duration::from_secs(5))
            .timeout(std::time::Duration::from_secs(30))
            .keep_alive_timeout(std::time::Duration::from_secs(20))
            .keep_alive_while_idle(true)
            .http2_keep_alive_interval(std::time::Duration::from_secs(10));

        let ch = ep.connect().await?;
        info!(uri = %uri, "gRPC channel connected");

        self.pool.lock().await.insert(uri, ch.clone());
        Ok(ch)
    }
}
