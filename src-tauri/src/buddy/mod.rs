//! Buddy-info IPC surface.
//!
//! Wraps the remote `/xyzen/api/v1/buddy/*` endpoints (see
//! `service/buddy/info_api.py`) behind a small reqwest client and exposes
//! five `#[tauri::command]`s to the Vue panels. Authenticated via the
//! bearer token the device-code flow in [`crate::auth`] persists.

pub mod cache;
pub mod client;
pub mod commands;
pub mod types;

use tauri::{AppHandle, Runtime};

/// Fire-and-forget warm of the cache after a successful sign-in.
/// Logs on failure so callers don't need to branch on the result.
pub async fn sync_after_auth<R: Runtime>(app: AppHandle<R>) {
    match commands::buddy_sync_internal(&app).await {
        Ok(_) => tracing::info!("post-auth sync ok"),
        Err(e) => tracing::warn!(err = ?e, "post-auth sync failed"),
    }
}
