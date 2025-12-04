use tonic::transport::{Channel, Endpoint};
use tracing::info;
use crate::command::server_info_proto::server_info_client;
use crate::command::tasks_proto::tasks_client;

pub async fn channel_for(addr: &str, use_tls: bool) -> Result<Channel, tonic::transport::Error> {
    // Note: TLS support is optional; by default we attempt a plain connection.
    // If TLS is required in the future, enhance this function to configure
    // `ClientTlsConfig` and enable the necessary tonic features.
    info!(addr = %addr, use_tls = use_tls, "creating gRPC channel");
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
    info!(uri = %uri, "attempting to create gRPC endpoint");
    let ep = Endpoint::from_shared(uri)?;
    let ch = ep.connect().await?;
    info!(addr = %addr, "gRPC channel connected");
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
