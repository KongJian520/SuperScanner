use tonic::transport::{Channel, Endpoint};
use tracing::info;
use crate::command::server_info_proto::server_info_client;
use crate::command::tasks_proto::tasks_client;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use once_cell::sync::Lazy;

// Global connection pool: Map<Address, Channel>
// We use a Mutex to protect the map during concurrent access.
// Tonic Channels are cheap to clone and internally manage connection multiplexing.
static CONNECTION_POOL: Lazy<Arc<Mutex<HashMap<String, Channel>>>> = Lazy::new(|| {
    Arc::new(Mutex::new(HashMap::new()))
});

pub async fn channel_for(addr: &str, use_tls: bool) -> Result<Channel, tonic::transport::Error> {
    // Note: TLS support is optional; by default we attempt a plain connection.
    // If TLS is required in the future, enhance this function to configure
    // `ClientTlsConfig` and enable the necessary tonic features.
    
    // Ensure the provided address is a valid URL for `Endpoint::from_shared`.
    // Many users provide addresses like `127.0.0.1:50051` (no scheme). Tonic
    // requires a scheme (http:// or https://). Prefix based on `use_tls`.
    let uri = if addr.starts_with("http://") || addr.starts_with("https://") {
        addr.to_string()
    } else if use_tls {
        format!("https://{}", addr)
    } else {
        format!("http://{}", addr)
    };

    // Check pool first
    let pool = CONNECTION_POOL.lock().await;
    if let Some(channel) = pool.get(&uri) {
        info!(uri = %uri, "reusing existing gRPC channel");
        return Ok(channel.clone());
    }
    drop(pool); // Release lock before connecting (connecting might take time)

    info!(uri = %uri, use_tls = use_tls, "creating new gRPC channel");
    let ep = Endpoint::from_shared(uri.clone())?;
    // Configure keep-alive to keep connection open
    let ep = ep
        .keep_alive_timeout(std::time::Duration::from_secs(20))
        .keep_alive_while_idle(true);

    let ch = ep.connect().await?;
    info!(uri = %uri, "gRPC channel connected");

    // Save to pool
    let mut pool = CONNECTION_POOL.lock().await;
    pool.insert(uri, ch.clone());
    
    Ok(ch)
}

pub async fn server_info_client(
    addr: &str,
    use_tls: bool,
) -> Result<
    server_info_client::ServerInfoClient<Channel>,
    tonic::transport::Error,
> {
    info!(addr = %addr, use_tls, "creating server_info client");
    let ch = channel_for(addr, use_tls).await?;
    info!(addr = %addr, "server_info client ready");
    Ok(server_info_client::ServerInfoClient::new(ch))
}

pub async fn tasks_client(
    addr: &str,
    use_tls: bool,
) -> Result<tasks_client::TasksClient<Channel>, tonic::transport::Error>
{
    info!(addr = %addr, use_tls, "creating tasks client");
    let ch = channel_for(addr, use_tls).await?;
    info!(addr = %addr, "tasks client ready");
    Ok(tasks_client::TasksClient::new(
        ch,
    ))
}
