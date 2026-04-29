use tauri::{
    LogicalPosition, LogicalSize, Manager, PhysicalPosition, PhysicalSize,
    WebviewUrl, WebviewWindowBuilder,
};
use tracing_subscriber::EnvFilter;

mod auth;
mod error;
mod events;
mod ipc;
mod net;
mod state;
mod vad;

use state::AppState;

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
    .inner_size(480.0, 640.0)
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
    // Respect RUST_LOG if set; otherwise give each Rust-side module its own
    // bucket so noisy subsystems can be quieted without touching the rest.
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("buddy_lib=info,reqwest=warn,tokio_tungstenite=warn"));
    let _ = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(true)
        .try_init();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    init_tracing();

    tauri::Builder::default()
        .manage(AppState::new())
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
            resize_buddy_window,
            open_buddy_settings_window,
            close_buddy_settings_window,
            ipc::auth_cmd::get_auth_credentials,
            ipc::auth_cmd::set_auth_credentials,
            ipc::http_cmd::xyzen_http_request,
            ipc::sse_cmd::xyzen_sse_connect,
            ipc::sse_cmd::xyzen_sse_disconnect,
            ipc::sse_cmd::xyzen_sse_status,
            ipc::voice_cmd::xyzen_voice_ws_open,
            ipc::voice_cmd::xyzen_voice_ws_close,
            ipc::voice_cmd::xyzen_voice_ws_start_session,
            ipc::voice_cmd::xyzen_voice_ws_input_start,
            ipc::voice_cmd::xyzen_voice_ws_input_commit,
            ipc::voice_cmd::xyzen_voice_ws_interrupt,
            ipc::voice_cmd::xyzen_voice_ws_stop_session,
            ipc::voice_cmd::xyzen_voice_ws_send_frame,
            ipc::vad_cmd::vad_start,
            ipc::vad_cmd::vad_stop,
            ipc::vad_cmd::vad_push_frame,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
