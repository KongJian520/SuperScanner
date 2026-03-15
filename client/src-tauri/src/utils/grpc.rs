use tonic::transport::Channel;
use tracing::info;
use crate::command::server_info_proto::server_info_client;
use crate::command::tasks_proto::tasks_client;
use crate::state::AppState;

pub async fn server_info_client(
    state: &AppState,
    addr: &str,
    use_tls: bool,
) -> Result<
    server_info_client::ServerInfoClient<Channel>,
    tonic::transport::Error,
> {
    info!(addr = %addr, use_tls, "creating server_info client");
    let ch = state.channel_for(addr, use_tls).await?;
    Ok(server_info_client::ServerInfoClient::new(ch))
}

pub async fn tasks_client(
    state: &AppState,
    addr: &str,
    use_tls: bool,
) -> Result<tasks_client::TasksClient<Channel>, tonic::transport::Error> {
    info!(addr = %addr, use_tls, "creating tasks client");
    let ch = state.channel_for(addr, use_tls).await?;
    Ok(tasks_client::TasksClient::new(ch))
}
