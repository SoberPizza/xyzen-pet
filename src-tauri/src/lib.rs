use std::sync::OnceLock;

use tauri::{
    LogicalPosition, LogicalSize, Manager, PhysicalPosition, PhysicalSize,
    WebviewUrl, WebviewWindowBuilder,
};
use tracing_appender::non_blocking::{NonBlocking, WorkerGuard};
use tracing_appender::rolling::{RollingFileAppender, Rotation};
use tracing_subscriber::{fmt, layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

// Modules are `pub` so the integration-test crate under `tests/` can
// exercise their public surface (VadFsm, AuthClient, SettingsChanged, …).
// The Tauri app itself only uses what's re-exported below.
pub mod auth;
pub mod buddy;
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
#[tracing::instrument(skip(app), err(Debug))]
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
#[tracing::instrument(skip(app), err(Debug))]
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
#[tracing::instrument(skip(app), err(Debug))]
async fn close_buddy_settings_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("settings") {
        w.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

// Kept alive for the process lifetime so buffered log writes flush on exit.
// Dropping the guard truncates any in-flight lines.
static LOG_GUARD: OnceLock<WorkerGuard> = OnceLock::new();

fn init_tracing<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    // Respect RUST_LOG if set; otherwise surface Buddy-side logs at info.
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("buddy_lib=info"));

    let stderr_layer = fmt::layer()
        .with_target(true)
        .with_writer(std::io::stderr);

    // Best-effort file layer: a failure here (no log dir, permissions,
    // builder error) disables file logging but must never panic the app.
    let file_layer = match build_file_writer(app) {
        Ok(writer) => Some(
            fmt::layer()
                .with_target(true)
                .with_ansi(false)
                .with_writer(writer),
        ),
        Err(e) => {
            eprintln!("buddy: file logging disabled: {e}");
            None
        }
    };

    let _ = tracing_subscriber::registry()
        .with(filter)
        .with(stderr_layer)
        .with(file_layer)
        .try_init();
}

fn build_file_writer<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<NonBlocking, String> {
    let dir = app
        .path()
        .app_log_dir()
        .map_err(|e| format!("app_log_dir: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("create log dir {dir:?}: {e}"))?;
    let appender = RollingFileAppender::builder()
        .rotation(Rotation::DAILY)
        .filename_prefix("buddy")
        .filename_suffix("log")
        .max_log_files(7)
        .build(&dir)
        .map_err(|e| format!("rolling appender: {e}"))?;
    let (writer, guard) = tracing_appender::non_blocking(appender);
    // Ignore the error path — set_once can only fail if called twice,
    // which would mean init_tracing ran twice. try_init above is a no-op
    // the second time so losing a guard there is harmless.
    let _ = LOG_GUARD.set(guard);
    Ok(writer)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .manage(AppState::new())
        .manage(VoiceSessions::new())
        .manage(AuthSession::new())
        .setup(|app| {
            init_tracing(app.handle());
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
            buddy::commands::buddy_get_me,
            buddy::commands::buddy_sync,
            buddy::commands::buddy_clear_cache,
            buddy::commands::buddy_list_races,
            buddy::commands::buddy_list_traits,
            buddy::commands::buddy_rename,
            buddy::commands::buddy_activate,
            buddy::commands::buddy_create,
            buddy::commands::buddy_delete,
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
