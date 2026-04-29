use tauri::{
    LogicalPosition, LogicalSize, Manager, PhysicalPosition, PhysicalSize,
    WebviewUrl, WebviewWindowBuilder,
};
use tracing_subscriber::EnvFilter;

// Modules are `pub` so the integration-test crate under `tests/` can
// exercise their public surface (VadFsm, AuthClient, SettingsChanged, …).
// The Tauri app itself only uses what's re-exported below.
pub mod auth;
pub mod buddy_stub;
pub mod events;
pub mod ipc;
pub mod settings;
pub mod state;
pub mod vad;
pub mod voice;

use auth::AuthSession;
use state::AppState;
use voice::VoiceSessions;

const MIN_W: f64 = 180.0;
const MIN_H: f64 = 240.0;
const MAX_W: f64 = 640.0;
const MAX_H: f64 = 900.0;
const MARGIN: f64 = 16.0;

fn clamp(w: f64, h: f64) -> (f64, f64) {
    (w.clamp(MIN_W, MAX_W), h.clamp(MIN_H, MAX_H))
}

#[tauri::command]
async fn resize_buddy_window(app: tauri::AppHandle, w: f64, h: f64) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;
    let (cw, ch) = clamp(w, h);

    let monitor = window
        .current_monitor()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "no monitor".to_string())?;
    let scale = monitor.scale_factor();
    let mon_pos = monitor.position();
    let mon_size = monitor.size();

    let mon_right_logical = (mon_pos.x as f64 + mon_size.width as f64) / scale;
    let mon_bottom_logical = (mon_pos.y as f64 + mon_size.height as f64) / scale;
    let new_x = mon_right_logical - cw - MARGIN;
    let new_y = mon_bottom_logical - ch - MARGIN;

    window
        .set_size(LogicalSize::new(cw, ch))
        .map_err(|e| e.to_string())?;
    window
        .set_position(LogicalPosition::new(new_x, new_y))
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn open_buddy_settings_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window("settings") {
        let _ = existing.show();
        let _ = existing.unminimize();
        let _ = existing.set_focus();
        return Ok(());
    }
    WebviewWindowBuilder::new(
        &app,
        "settings",
        WebviewUrl::App("index.html#/settings".into()),
    )
    .title("Buddy Settings")
    .inner_size(800.0, 600.0)
    .min_inner_size(360.0, 480.0)
    .resizable(true)
    .decorations(false)
    .transparent(true)
    .center()
    .build()
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn close_buddy_settings_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("settings") {
        w.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn init_tracing() {
    // Respect RUST_LOG if set; otherwise surface Buddy-side logs at info.
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("buddy_lib=info"));
    let _ = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(true)
        .try_init();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    init_tracing();

    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .manage(AppState::new())
        .manage(VoiceSessions::new())
        .manage(AuthSession::new())
        .setup(|app| {
            if let Some(win) = app.get_webview_window("main") {
                if let Ok(Some(monitor)) = win.current_monitor() {
                    let scale = monitor.scale_factor();
                    let size = win.outer_size().unwrap_or(PhysicalSize::new(
                        (240.0 * scale) as u32,
                        (320.0 * scale) as u32,
                    ));
                    let mon_pos = monitor.position();
                    let mon_size = monitor.size();
                    let margin_px = (MARGIN * scale) as i32;
                    let x = mon_pos.x + mon_size.width as i32
                        - size.width as i32
                        - margin_px;
                    let y = mon_pos.y + mon_size.height as i32
                        - size.height as i32
                        - margin_px;
                    let _ = win.set_position(PhysicalPosition::new(x, y));
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Window controls
            resize_buddy_window,
            open_buddy_settings_window,
            close_buddy_settings_window,
            // IPC surface reflected into src/ipc/bindings.ts via specta.
            ipc::app_info,
            settings::settings_get,
            settings::settings_set,
            settings::settings_delete,
            settings::settings_all,
            voice::session::voice_start,
            voice::session::voice_stop,
            voice::session::voice_push_frame,
            buddy_stub::buddy_get_active,
            buddy_stub::buddy_list,
            // Auth (Xyzen device-code flow).
            auth::session::auth_status,
            auth::session::auth_start,
            auth::session::auth_cancel,
            auth::session::auth_sign_out,
            // VAD (Silero-on-ort) — Rust-only concern; stays as a command
            // surface so the webview can hand over mic frames if needed.
            ipc::vad_cmd::vad_start,
            ipc::vad_cmd::vad_stop,
            ipc::vad_cmd::vad_push_frame,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
