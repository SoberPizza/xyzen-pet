//! Auth credential bridge commands.
//!
//! `set_auth_credentials` is called by `tauriSibling` in the webview every
//! time it learns of new credentials (boot snapshot + event-driven rotations).
//! `get_auth_credentials` returns the cached snapshot — kept for backward
//! compatibility with the existing TS provider's boot path, which calls
//! `invoke('get_auth_credentials')` directly.

use tauri::State;

use crate::auth::AuthCredentials;
use crate::state::AppState;

#[tauri::command]
pub async fn set_auth_credentials(
    state: State<'_, AppState>,
    creds: AuthCredentials,
) -> Result<(), String> {
    state.auth.set(creds).await;
    Ok(())
}

#[tauri::command]
pub async fn get_auth_credentials(
    state: State<'_, AppState>,
) -> Result<AuthCredentials, String> {
    Ok(state.auth.snapshot().await)
}
