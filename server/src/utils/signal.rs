// src/utils/signal.rs
use tokio::time::Instant;
use std::time::Duration;
use tracing::{info, warn, error};

/// 等待双击 Ctrl+C 的信号
/// 该函数会在满足退出条件时返回，从而触发 Server Shutdown
pub async fn wait_for_double_ctrl_c() {
    let mut last_click = None::<Instant>;

    loop {
        // 1. 等待下一次 Ctrl+C 信号
        if let Err(e) = tokio::signal::ctrl_c().await {
            error!("Failed to listen for Ctrl+C event: {}", e);
            // 如果监听信号失败，为了安全通常应该直接退出，而不是死循环
            break;
        }

        let now = Instant::now();

        // 2. 检查逻辑
        if let Some(prev) = last_click {
            // 如果距离上次按下的时间小于 5 秒
            if now.duration_since(prev) <= Duration::from_secs(5) {
                info!("Received second Ctrl-C, initiating shutdown...");

                // 保留原逻辑：给一点时间缓冲（例如让广播消息发出去）
                tokio::time::sleep(Duration::from_secs(1)).await;

                return;
            }
        }

        // 3. 第一次按下（或超时后重新按下）
        warn!("Press Ctrl-C again within 5s to force shutdown");
        last_click = Some(now);
    }
}