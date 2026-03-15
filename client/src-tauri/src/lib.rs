use crate::command::{server_info, tasks};

mod command;
mod error;
mod state;
mod utils;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _guard = utils::logging::init(utils::ROOT_DIR.clone());
    tracing::info!("client_lib starting: initializing Tauri application");
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(state::AppState::new())
        .invoke_handler(tauri::generate_handler![
            server_info::probe_server_info,
            server_info::add_backend_with_probe,
            server_info::get_backends,
            server_info::get_server_info,
            server_info::delete_backend,
            tasks::list_tasks,
            tasks::get_task,
            tasks::create_task,
            tasks::restart_task,
            tasks::start_task,
            tasks::stop_task,
            tasks::delete_task,
            tasks::stream_task_events,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
