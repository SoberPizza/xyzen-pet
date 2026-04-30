//! `#[tauri::command]` wrappers for the buddy-info endpoints.
//!
//! Reads are cache-first: `buddy_get_me` is a pure local lookup, and
//! only `buddy_sync` / the write-through mutations hit the network.
//! The cache lives in `tauri-plugin-store` and is wiped on sign-out
//! (see `crate::auth::session::auth_sign_out`).
//!
//! Each network call builds a fresh [`BuddyClient`] so the access
//! token is read straight from the settings store — avoids a stale
//! client surviving a sign-out/re-auth round trip.

use tauri::{AppHandle, Runtime};
use tauri_plugin_store::StoreExt;
use tracing::instrument;

use super::cache::{self, CachedBuddyEnvelope};
use super::client::BuddyClient;
use super::types::{
    BuddyAttribute, BuddyError, BuddyGender, BuddyTraitKind, RaceReadDTO, TraitReadDTO,
};
use crate::auth::settings::{access_token, backend_url, DEFAULT_BACKEND_URL};

fn make_client<R: Runtime>(app: &AppHandle<R>) -> Result<BuddyClient, BuddyError> {
    let origin = backend_url(app).unwrap_or_else(|| DEFAULT_BACKEND_URL.to_string());
    let token = access_token(app).ok_or(BuddyError::Unauthenticated)?;
    Ok(BuddyClient::new(origin, token))
}

/// Shared body for `buddy_sync` and the post-auth warm path. Extracted
/// so the latter can reuse the logic without round-tripping through
/// the Tauri command handler.
pub(super) async fn buddy_sync_internal<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<CachedBuddyEnvelope, BuddyError> {
    let client = make_client(app)?;
    let envelope = client.get_me().await?;
    cache::write(app, &envelope)
}

/// Pure local read. Returns `Ok(None)` when the cache is cold — UI
/// prompts the user to sync in that case. No network call here by
/// design: normal panel opens must not cost bandwidth.
#[tauri::command]
#[specta::specta]
#[instrument(skip(app), err(Debug))]
pub fn buddy_get_me<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Option<CachedBuddyEnvelope>, BuddyError> {
    Ok(cache::read(&app))
}

/// Explicit refresh: hit `GET /me`, update the cache, return the
/// fresh wrapper. Vue's Refresh button and the post-auth warm path
/// both land here.
#[tauri::command]
#[specta::specta]
#[instrument(skip(app), err(Debug))]
pub async fn buddy_sync<R: Runtime>(
    app: AppHandle<R>,
) -> Result<CachedBuddyEnvelope, BuddyError> {
    buddy_sync_internal(&app).await
}

/// Clears the on-disk cache. Called from `auth_sign_out`; also exposed
/// to the UI in case someone wants a manual "forget my buddy" action.
#[tauri::command]
#[specta::specta]
#[instrument(skip(app), err(Debug))]
pub fn buddy_clear_cache<R: Runtime>(app: AppHandle<R>) -> Result<(), BuddyError> {
    cache::clear(&app)
}

#[tauri::command]
#[specta::specta]
#[instrument(skip(app), err(Debug))]
pub async fn buddy_list_races<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Vec<RaceReadDTO>, BuddyError> {
    // Reference data — not user-scoped, not cached. Only hit on
    // explicit user action (no callers today; wired for the future
    // create-buddy flow).
    make_client(&app)?.list_races().await
}

#[tauri::command]
#[specta::specta]
#[instrument(skip(app), err(Debug))]
pub async fn buddy_list_traits<R: Runtime>(
    app: AppHandle<R>,
    kind: Option<BuddyTraitKind>,
) -> Result<Vec<TraitReadDTO>, BuddyError> {
    make_client(&app)?.list_traits(kind).await
}

/// Write-through: server mutates, then we update the cache from the
/// response. A failed cache write after a successful remote call
/// surfaces as `Transport` — the server state is ahead, and a manual
/// Refresh will reconcile.
#[tauri::command]
#[specta::specta]
#[instrument(skip(app), err(Debug))]
pub async fn buddy_rename<R: Runtime>(
    app: AppHandle<R>,
    buddy_id: String,
    name: String,
) -> Result<CachedBuddyEnvelope, BuddyError> {
    let client = make_client(&app)?;
    let envelope = client.rename(&buddy_id, &name).await?;
    cache::write(&app, &envelope)
}

#[tauri::command]
#[specta::specta]
#[instrument(skip(app), err(Debug))]
pub async fn buddy_activate<R: Runtime>(
    app: AppHandle<R>,
    buddy_id: String,
) -> Result<CachedBuddyEnvelope, BuddyError> {
    let client = make_client(&app)?;
    let envelope = client.activate(&buddy_id).await?;
    cache::write(&app, &envelope)
}

/// "Break Bond" — permanent delete of a buddy on the server plus a wipe
/// of every local trace (cache envelope + any per-buddy nickname slot).
/// Safe to call when the server already 404s the id — we still clear the
/// local state so the UI can't end up stuck pointing at a ghost row.
#[tauri::command]
#[specta::specta]
#[instrument(skip(app), err(Debug))]
pub async fn buddy_delete<R: Runtime>(
    app: AppHandle<R>,
    buddy_id: String,
) -> Result<(), BuddyError> {
    let client = make_client(&app)?;
    match client.delete(&buddy_id).await {
        Ok(()) | Err(BuddyError::NotFound) => {}
        Err(e) => return Err(e),
    }
    cache::clear(&app)?;
    // Mirror the key shape used by the Vue `saveNicknames` helper +
    // `src/ipc/keys.ts::buddyNicknameKey`. We go through `settings_delete`
    // indirectly via the store so the `settings://changed` event fires
    // and any future subscriber drops its cached slots.
    let nickname_key = format!("buddy/nicknames/{buddy_id}");
    let store = app
        .store(crate::settings::STORE_FILENAME)
        .map_err(|e| BuddyError::Transport {
            message: format!("open store: {e}"),
        })?;
    if store.delete(&nickname_key) {
        use tauri::Emitter;
        let _ = app.emit(
            crate::settings::SETTINGS_CHANGED_EVENT,
            crate::settings::SettingsChanged {
                key: nickname_key,
                value_json: None,
            },
        );
    }
    Ok(())
}

/// First-time onboarding: `POST /xyzen/api/v1/buddy`. The server
/// enforces "one active buddy per user" and returns 409 if the caller
/// already has one — Vue resolves that by calling `buddy_sync` to pick
/// up the remote state.
#[tauri::command]
#[specta::specta]
#[instrument(skip(app, generic_trait_codes), err(Debug))]
pub async fn buddy_create<R: Runtime>(
    app: AppHandle<R>,
    name: String,
    race_code: String,
    attribute: BuddyAttribute,
    gender: BuddyGender,
    generic_trait_codes: Vec<String>,
) -> Result<CachedBuddyEnvelope, BuddyError> {
    let client = make_client(&app)?;
    let envelope = client
        .create(&name, &race_code, attribute, gender, &generic_trait_codes)
        .await?;
    cache::write(&app, &envelope)
}
