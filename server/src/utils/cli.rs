use clap::Parser;

#[derive(Parser, Debug)]
#[command(about = "gRPC server", long_about = None)]
pub struct Cli {
    /// 监听 IP（默认: 127.0.0.1）
    #[arg(long, default_value = "127.0.0.1")]
    pub ip: String,

    /// 监听端口（默认: 50051）
    #[arg(long, default_value_t = 50051)]
    pub port: u16,

    /// 启用 TLS
    #[arg(long,default_value_t = false)]
    pub tls: bool,
}
