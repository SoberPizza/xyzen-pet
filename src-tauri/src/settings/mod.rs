//! Settings store facade.
//!
//! Sits on top of `tauri-plugin-store` so the Vue layer never has to worry
//! about file paths, debouncing, or cross-window sync — it just hits
//! `settings_get`/`settings_set` and subscribes to `settings://changed`.
//!
//! Values are typed as `serde_json::Value` for now; once the new remote API
//! is wired up we can tighten the schema in `schema.rs`.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{AppHandle, Emitter, Runtime};
use tauri_plugin_store::StoreExt;

pub const STORE_FILENAME: &str = "settings.json";
pub const SETTINGS_CHANGED_EVENT: &str = "settings://changed";

/// Values cross IPC as JSON strings so specta emits a simple `string` on the
/// TS side. The webview parses per-setting with its own `<T>`, so the loss
/// of structural typing is contained to one narrow helper.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct SettingsChanged {
    pub key: String,
    /// Raw JSON string of the new value, or `None` if the key was deleted.
    pub value_json: Option<String>,
}

fn with_store<R: Runtime, F, T>(app: &AppHandle<R>, f: F) -> Result<T, String>
where
    F: FnOnce(&tauri_plugin_store::Store<R>) -> T,
{
    let store = app
        .store(STORE_FILENAME)
        .map_err(|e| format!("open store: {e}"))?;
    Ok(f(&store))
}

#[tauri::command]
#[specta::specta]
pub fn settings_get<R: Runtime>(
    app: AppHandle<R>,
    key: String,
) -> Result<Option<String>, String> {
    with_store(&app, |s| {
        s.get(key)
            .map(|v| serde_json::to_string(&v).unwrap_or_else(|_| "null".into()))
    })
}

#[tauri::command]
#[specta::specta]
pub fn settings_set<R: Runtime>(
    app: AppHandle<R>,
    key: String,
    value_json: String,
) -> Result<(), String> {
    let value = serde_json::from_str::<serde_json::Value>(&value_json)
        .map_err(|e| format!("invalid json: {e}"))?;
    with_store(&app, |s| {
        s.set(key.clone(), value);
    })?;
    let _ = app.emit(
        SETTINGS_CHANGED_EVENT,
        SettingsChanged {
            key,
            value_json: Some(value_json),
        },
    );
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn settings_delete<R: Runtime>(
    app: AppHandle<R>,
    key: String,
) -> Result<bool, String> {
    let removed = with_store(&app, |s| s.delete(&key))?;
    if removed {
        let _ = app.emit(
            SETTINGS_CHANGED_EVENT,
            SettingsChanged {
                key,
                value_json: None,
            },
        );
    }
    Ok(removed)
}

#[tauri::command]
#[specta::specta]
pub fn settings_all<R: Runtime>(
    app: AppHandle<R>,
) -> Result<HashMap<String, String>, String> {
    with_store(&app, |s| {
        s.entries()
            .into_iter()
            .map(|(k, v)| {
                let encoded = serde_json::to_string(&v).unwrap_or_else(|_| "null".into());
                (k, encoded)
            })
            .collect()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn value_json_roundtrips_through_serde() {
        let original = serde_json::json!({"brightness": 0.8, "theme": "dark"});
        let encoded = serde_json::to_string(&original).unwrap();
        let decoded: serde_json::Value = serde_json::from_str(&encoded).unwrap();
        assert_eq!(original, decoded);
    }

    #[test]
    fn settings_changed_serialises() {
        let c = SettingsChanged {
            key: "brightness".into(),
            value_json: Some("0.8".into()),
        };
        let s = serde_json::to_string(&c).unwrap();
        assert!(s.contains("\"brightness\""));
        assert!(s.contains("\"0.8\""));
    }
}
