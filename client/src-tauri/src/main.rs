// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// Small main wrapper that delegates to the `client_lib::run` function.
// `client_lib::run` initializes logging and starts the Tauri runtime.
/// 客户端入口：委托 client_lib::run 启动日志和 Tauri 运行时
fn main() {
    client_lib::run()
}
