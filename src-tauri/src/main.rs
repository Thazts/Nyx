#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]
#![allow(non_snake_case)]

use std::sync::{Arc, Mutex};
use tauri::Manager;

mod agent_runtime;
mod commands;
mod renderer;
mod security;
mod skills;
mod state;

use commands::agent::ApprovalState;
use renderer::NyxRenderer;
use state::AppState;

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let main_window = app.get_window("main").ok_or("main window not found")?;

            let ParentHwnd = {
                use raw_window_handle::{HasRawWindowHandle, RawWindowHandle};
                match main_window.raw_window_handle() {
                    RawWindowHandle::Win32(h) => h.hwnd as isize,
                    _ => return Err("Expected a Win32 window".into()),
                }
            };

            let _ = main_window.set_icon(tauri::Icon::File(
                std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("icons/icon.ico"),
            ));

            match NyxRenderer::new(ParentHwnd, app.handle()) {
                Ok(r) => {
                    app.manage(Arc::new(Mutex::new(r)));
                }
                Err(e) => {
                    eprintln!("NyxRenderer::new failed: {e}");
                }
            }

            app.manage(Arc::new(Mutex::new(ApprovalState::default())));
            app.manage(AppState::default());
            app.manage(commands::scene_runner::LiveSceneState::default());

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_app_state_snapshot,
            commands::list_files,
            commands::list_files_recursive,
            commands::open_file,
            commands::save_file,
            commands::run_terminal_command,
            commands::select_folder,
            commands::open_workspace,
            commands::charon_start,
            commands::charon_sync,
            commands::get_file_metadata,
            commands::capture_command,
            commands::run_file,
            commands::run_scene,
            commands::start_live_scene,
            commands::stop_live_scene,
            commands::delete_path,
            commands::rename_path,
            commands::create_folder,
            commands::renderer_load_scene,
            commands::renderer_set_bounds,
            commands::renderer_set_visible,
            commands::renderer_detach,
            commands::renderer_attach,
            commands::renderer_camera_orbit,
            commands::renderer_camera_pan,
            commands::renderer_camera_zoom,
            commands::renderer_camera_wasd,
            commands::renderer_camera_right_mouse,
            commands::renderer_click,
            commands::renderer_gizmo_hit_test,
            commands::renderer_gizmo_drag,
            commands::renderer_set_on_top,
            commands::renderer_get_part,
            commands::renderer_set_part_properties,
            commands::renderer_set_gizmo_mode,
            commands::renderer_rotate_drag,
            commands::renderer_scale_drag,
            commands::renderer_undo,
            commands::renderer_redo,
            commands::renderer_delete_part,
            commands::renderer_return_to_script,
            commands::renderer_subdivide_selected,
            commands::renderer_extrude_selected_face,
            commands::renderer_delete_selected_face,
            commands::renderer_frame_selected,
            commands::renderer_end_drag,
            commands::get_system_stats,
            commands::ai_get_config,
            commands::ai_start_agent,
            commands::ai_tool_respond,
            commands::ai_question_respond,
            commands::ai_rate_limit_respond,
            commands::ai_launch_keyman,
            commands::ai_launch_nyx_cli,
            commands::get_app_settings,
            commands::save_app_settings,
            commands::load_model_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
