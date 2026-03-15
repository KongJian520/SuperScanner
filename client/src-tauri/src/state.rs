use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use tonic::transport::{Channel, Endpoint};
use tracing::info;

pub struct AppState {
    pool: Arc<Mutex<HashMap<String, Channel>>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            pool: Arc::new(Mutex::new(HashMap::new())),
        }
    }

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
            .keep_alive_timeout(std::time::Duration::from_secs(20))
            .keep_alive_while_idle(true);

        let ch = ep.connect().await?;
        info!(uri = %uri, "gRPC channel connected");

        self.pool.lock().await.insert(uri, ch.clone());
        Ok(ch)
    }
}
