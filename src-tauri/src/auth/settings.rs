//! Reads and writes the four auth-related keys in the shared settings store.
//!
//! Keeping these behind thin typed helpers avoids sprinkling
//! `serde_json::Value::String` literals through the session code and makes
//! the settings-key schema reviewable in one place.

use serde_json::Value;
use tauri::{AppHandle, Emitter, Runtime};
use tauri_plugin_store::StoreExt;

use crate::settings::{SettingsChanged, SETTINGS_CHANGED_EVENT, STORE_FILENAME};

pub const KEY_ACCESS_TOKEN: &str = "settings/auth/access_token";
pub const KEY_REFRESH_TOKEN: &str = "settings/auth/refresh_token";
pub const KEY_BACKEND_URL: &str = "settings/auth/backend_url";
pub const KEY_CLIENT_ID: &str = "settings/auth/client_id";

/// Origin of the Xyzen gateway. The auth client appends the
/// `/xyzen/api/v1/auth/buddy/...` path prefix itself.
pub const DEFAULT_BACKEND_URL: &str = "http://localhost";
pub const DEFAULT_CLIENT_ID: &str = "buddy-desktop";

fn read_string<R: Runtime>(app: &AppHandle<R>, key: &str) -> Option<String> {
    let store = app.store(STORE_FILENAME).ok()?;
    match store.get(key) {
        Some(Value::String(s)) if !s.is_empty() => Some(s),
        _ => None,
    }
}

fn write_string<R: Runtime>(
    app: &AppHandle<R>,
    key: &str,
    value: &str,
) -> Result<(), String> {
    let store = app
        .store(STORE_FILENAME)
        .map_err(|e| format!("open store: {e}"))?;
    let json = Value::String(value.to_string());
    store.set(key.to_string(), json.clone());

    // Mirror what `settings_set` does so the Vue-side `useIpcSetting`
    // subscribers stay in sync across windows.
    let _ = app.emit(
        SETTINGS_CHANGED_EVENT,
        SettingsChanged {
            key: key.to_string(),
            value_json: Some(
                serde_json::to_string(&json).unwrap_or_else(|_| "null".into()),
            ),
        },
    );
    Ok(())
}

fn delete_key<R: Runtime>(app: &AppHandle<R>, key: &str) -> Result<(), String> {
    let store = app
        .store(STORE_FILENAME)
        .map_err(|e| format!("open store: {e}"))?;
    let removed = store.delete(key);
    if removed {
        let _ = app.emit(
            SETTINGS_CHANGED_EVENT,
            SettingsChanged {
                key: key.to_string(),
                value_json: None,
            },
        );
    }
    Ok(())
}

pub fn backend_url<R: Runtime>(app: &AppHandle<R>) -> Option<String> {
    read_string(app, KEY_BACKEND_URL)
}

pub fn client_id<R: Runtime>(app: &AppHandle<R>) -> Option<String> {
    read_string(app, KEY_CLIENT_ID)
}

pub fn store_tokens<R: Runtime>(
    app: &AppHandle<R>,
    access_token: &str,
    refresh_token: Option<&str>,
) -> Result<(), String> {
    write_string(app, KEY_ACCESS_TOKEN, access_token)?;
    match refresh_token {
        Some(rt) if !rt.is_empty() => write_string(app, KEY_REFRESH_TOKEN, rt)?,
        _ => delete_key(app, KEY_REFRESH_TOKEN)?,
    }
    Ok(())
}

pub fn clear_tokens<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    delete_key(app, KEY_ACCESS_TOKEN)?;
    delete_key(app, KEY_REFRESH_TOKEN)?;
    Ok(())
}
