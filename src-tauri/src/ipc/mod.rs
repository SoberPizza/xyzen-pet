//! Every `#[tauri::command]` the frontend calls lives here so the IPC
//! contract is reviewable in one folder.

pub mod vad_cmd;

use serde::{Deserialize, Serialize};
use specta::Type;
use tauri_specta::{collect_commands, collect_events, Builder};

use crate::buddy_stub;
use crate::settings;
use crate::voice::session as voice_session;

/// Smoke/introspection type — lets the Vue app display the packaged version.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct AppInfo {
    pub version: String,
}

#[tauri::command]
#[specta::specta]
pub fn app_info() -> AppInfo {
    AppInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
    }
}

/// Single source of truth for the IPC surface that `bindings.ts` reflects.
/// Both the main Tauri builder (`lib.rs`) and the `gen-bindings` binary call
/// this so the two views can never drift.
pub fn bindings_builder() -> Builder<tauri::Wry> {
    Builder::<tauri::Wry>::new()
        .commands(collect_commands![
            app_info,
            settings::settings_get::<tauri::Wry>,
            settings::settings_set::<tauri::Wry>,
            settings::settings_delete::<tauri::Wry>,
            settings::settings_all::<tauri::Wry>,
            voice_session::voice_start::<tauri::Wry>,
            voice_session::voice_stop::<tauri::Wry>,
            voice_session::voice_push_frame,
            buddy_stub::buddy_get_active,
            buddy_stub::buddy_list,
        ])
        .events(collect_events![])
}
