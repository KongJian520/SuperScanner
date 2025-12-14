// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// Small main wrapper that delegates to the `client_lib::run` function.
// `client_lib::run` initializes logging and starts the Tauri runtime.
fn main() {
    client_lib::run()
}
