//! On-disk cache for the most recent `BuddyEnvelope`.
//!
//! Lives in the same `tauri-plugin-store` file as the rest of the
//! settings and emits `settings://changed` on write/clear, so the Vue
//! side can subscribe with `useIpcSetting('buddy/cache/envelope', null)`
//! and re-render across windows for free.
//!
//! The cache is read-through — [`crate::buddy::commands::buddy_get_me`]
//! returns whatever is in the store without a network hop. Writes only
//! happen from explicit `buddy_sync` calls, from mutation
//! write-throughs (`rename` / `activate`), or from the post-auth sync
//! kicked off in [`crate::auth::session`].

use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{AppHandle, Emitter, Runtime};
use tauri_plugin_store::StoreExt;

use super::types::{BuddyEnvelope, BuddyError};
use crate::settings::{SettingsChanged, SETTINGS_CHANGED_EVENT, STORE_FILENAME};

pub const KEY_BUDDY_CACHE: &str = "buddy/cache/envelope";

/// What we write to disk. The envelope is stored alongside a
/// wall-clock sync timestamp so the panel can show "last synced Xm
/// ago" without a second key.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct CachedBuddyEnvelope {
    pub envelope: BuddyEnvelope,
    /// Unix epoch millis at the moment the envelope was written.
    pub synced_at_ms: i64,
}

fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn store_error(e: impl std::fmt::Display) -> BuddyError {
    BuddyError::Transport {
        message: format!("cache store: {e}"),
    }
}

/// Returns `None` if the key is absent or the stored blob no longer
/// round-trips through serde (e.g. a shape change that invalidated an
/// older cache). Parse failures are swallowed — the next `buddy_sync`
/// will overwrite the bad blob.
pub fn read<R: Runtime>(app: &AppHandle<R>) -> Option<CachedBuddyEnvelope> {
    let store = app.store(STORE_FILENAME).ok()?;
    let raw = store.get(KEY_BUDDY_CACHE)?;
    serde_json::from_value::<CachedBuddyEnvelope>(raw).ok()
}

/// Stamps `synced_at_ms = now`, writes the wrapper into the store, and
/// emits `settings://changed` so every `useIpcSetting` subscriber
/// re-renders. Returns the freshly-wrapped value so callers don't need
/// to re-read.
pub fn write<R: Runtime>(
    app: &AppHandle<R>,
    envelope: &BuddyEnvelope,
) -> Result<CachedBuddyEnvelope, BuddyError> {
    let wrapped = CachedBuddyEnvelope {
        envelope: envelope.clone(),
        synced_at_ms: now_ms(),
    };
    let value = serde_json::to_value(&wrapped).map_err(store_error)?;
    let store = app.store(STORE_FILENAME).map_err(store_error)?;
    store.set(KEY_BUDDY_CACHE.to_string(), value.clone());

    // Mirror `settings_set`: `value_json` is a single-level JSON encoding of
    // the stored `Value`, so the Vue-side `useIpcSetting` gets an object back
    // from its single `JSON.parse`.
    let _ = app.emit(
        SETTINGS_CHANGED_EVENT,
        SettingsChanged {
            key: KEY_BUDDY_CACHE.to_string(),
            value_json: Some(
                serde_json::to_string(&value).unwrap_or_else(|_| "null".into()),
            ),
        },
    );
    Ok(wrapped)
}

pub fn clear<R: Runtime>(app: &AppHandle<R>) -> Result<(), BuddyError> {
    let store = app.store(STORE_FILENAME).map_err(store_error)?;
    let removed = store.delete(KEY_BUDDY_CACHE);
    if removed {
        let _ = app.emit(
            SETTINGS_CHANGED_EVENT,
            SettingsChanged {
                key: KEY_BUDDY_CACHE.to_string(),
                value_json: None,
            },
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cached_wrapper_round_trips() {
        let env = BuddyEnvelope::default();
        let c = CachedBuddyEnvelope {
            envelope: env,
            synced_at_ms: 1_700_000_000_000,
        };
        let s = serde_json::to_string(&c).unwrap();
        let back: CachedBuddyEnvelope = serde_json::from_str(&s).unwrap();
        assert_eq!(back.synced_at_ms, 1_700_000_000_000);
        assert!(back.envelope.buddy.is_none());
    }

    #[test]
    fn cached_wrapper_exposes_stable_field_names() {
        let c = CachedBuddyEnvelope {
            envelope: BuddyEnvelope::default(),
            synced_at_ms: 42,
        };
        let s = serde_json::to_string(&c).unwrap();
        assert!(s.contains("\"envelope\""));
        assert!(s.contains("\"synced_at_ms\":42"));
    }
}
