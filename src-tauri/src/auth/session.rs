//! Device-code flow state machine.
//!
//! Holds the current [`AuthStatus`] plus the spawned poll-loop task handle
//! so `auth_cancel` can abort it. State transitions are emitted on
//! `auth://status` (see `crate::events::AUTH_STATUS_EVENT`).

use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tokio::task::JoinHandle;
use tracing::{info, warn};

use crate::auth::client::{AuthClient, AuthorizeResponse, PollOutcome, DEFAULT_SCOPE};
use crate::auth::settings::{
    backend_url, client_id, clear_tokens, store_tokens, DEFAULT_BACKEND_URL, DEFAULT_CLIENT_ID,
};
use crate::events::AUTH_STATUS_EVENT;

/// Snapshot of the current flow state. `kind` drives the UI switch in
/// `ConnectionPanel.vue`.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AuthStatus {
    Idle,
    Pending {
        user_code: String,
        verification_uri: String,
        verification_uri_complete: String,
        expires_at_ms: i64,
    },
    Authenticated,
    Error {
        code: String,
        message: String,
    },
}

impl AuthStatus {
    fn idle() -> Self {
        Self::Idle
    }
}

/// Payload returned synchronously from `auth_start` so the UI can show the
/// user code immediately without waiting for the first `auth://status` event.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct AuthStartResponse {
    pub user_code: String,
    pub verification_uri: String,
    pub verification_uri_complete: String,
    pub expires_in: u64,
    pub interval: u64,
}

pub struct AuthSession {
    status: Mutex<AuthStatus>,
    poll_task: Mutex<Option<JoinHandle<()>>>,
}

impl AuthSession {
    pub fn new() -> Self {
        Self {
            status: Mutex::new(AuthStatus::idle()),
            poll_task: Mutex::new(None),
        }
    }

    pub fn snapshot(&self) -> AuthStatus {
        self.status.lock().expect("auth status lock").clone()
    }

    fn set_status<R: Runtime>(&self, app: &AppHandle<R>, next: AuthStatus) {
        {
            let mut guard = self.status.lock().expect("auth status lock");
            *guard = next.clone();
        }
        let _ = app.emit(AUTH_STATUS_EVENT, next);
    }

    /// Abort the running poll task, if any.
    fn cancel_task(&self) {
        if let Some(handle) = self
            .poll_task
            .lock()
            .expect("auth poll task lock")
            .take()
        {
            handle.abort();
        }
    }
}

impl Default for AuthSession {
    fn default() -> Self {
        Self::new()
    }
}

#[tauri::command]
#[specta::specta]
pub fn auth_status(session: tauri::State<'_, AuthSession>) -> AuthStatus {
    session.snapshot()
}

#[tauri::command]
#[specta::specta]
pub async fn auth_start<R: Runtime>(
    app: AppHandle<R>,
) -> Result<AuthStartResponse, String> {
    // Read settings synchronously before spawning the poll task so the UI
    // gets a fast error if the store isn't available.
    let origin = backend_url(&app).unwrap_or_else(|| DEFAULT_BACKEND_URL.to_string());
    let cid = client_id(&app).unwrap_or_else(|| DEFAULT_CLIENT_ID.to_string());

    let client = AuthClient::new(origin);
    let authorize: AuthorizeResponse = client.authorize(&cid, DEFAULT_SCOPE).await?;
    info!(
        "[auth] authorize ok: user_code={} expires_in={}s interval={}s",
        authorize.user_code, authorize.expires_in, authorize.interval
    );

    let session = app.state::<AuthSession>();
    // Any previous flow is superseded.
    session.cancel_task();

    let now_ms = now_ms();
    let expires_at_ms = now_ms + (authorize.expires_in as i64) * 1000;

    session.set_status(
        &app,
        AuthStatus::Pending {
            user_code: authorize.user_code.clone(),
            verification_uri: authorize.verification_uri.clone(),
            verification_uri_complete: authorize.verification_uri_complete.clone(),
            expires_at_ms,
        },
    );

    // Spawn the poll loop. It owns its own AppHandle + client so it can
    // keep running after this command returns.
    let app_for_task = app.clone();
    let handle = tokio::spawn(run_poll_loop(
        app_for_task,
        client,
        authorize.buddy_code.clone(),
        authorize.interval,
        expires_at_ms,
    ));
    *session.poll_task.lock().expect("auth poll task lock") = Some(handle);

    Ok(AuthStartResponse {
        user_code: authorize.user_code,
        verification_uri: authorize.verification_uri,
        verification_uri_complete: authorize.verification_uri_complete,
        expires_in: authorize.expires_in,
        interval: authorize.interval,
    })
}

#[tauri::command]
#[specta::specta]
pub fn auth_cancel<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let session = app.state::<AuthSession>();
    session.cancel_task();
    session.set_status(&app, AuthStatus::idle());
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn auth_sign_out<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let session = app.state::<AuthSession>();
    session.cancel_task();
    clear_tokens(&app)?;
    // Drop the cached buddy envelope so a subsequent sign-in on this
    // device doesn't inherit the previous user's buddy.
    if let Err(e) = crate::buddy::cache::clear(&app) {
        warn!("[auth] buddy cache clear failed on sign-out: {e:?}");
    }
    session.set_status(&app, AuthStatus::idle());
    Ok(())
}

/// Runs the `/buddy/token` poll loop until terminal state. Emits `auth://status`
/// on every transition.
async fn run_poll_loop<R: Runtime>(
    app: AppHandle<R>,
    client: AuthClient,
    buddy_code: String,
    initial_interval: u64,
    expires_at_ms: i64,
) {
    // RFC 8628 §3.5: server sends `slow_down` to request a +5s bump.
    let mut interval = initial_interval.max(1);

    loop {
        if now_ms() >= expires_at_ms {
            warn!("[auth] poll loop hit expires_in; giving up");
            if let Some(session) = app.try_state::<AuthSession>() {
                session.set_status(
                    &app,
                    AuthStatus::Error {
                        code: "expired_token".into(),
                        message: "The sign-in request expired before it was approved.".into(),
                    },
                );
            }
            return;
        }

        tokio::time::sleep(Duration::from_secs(interval)).await;

        match client.poll_token(&buddy_code).await {
            PollOutcome::Success(token) => {
                info!("[auth] token acquired");
                if let Err(e) = store_tokens(&app, &token.access_token, token.refresh_token.as_deref()) {
                    warn!("[auth] token persist failed: {e}");
                    if let Some(session) = app.try_state::<AuthSession>() {
                        session.set_status(
                            &app,
                            AuthStatus::Error {
                                code: "persist_failed".into(),
                                message: e,
                            },
                        );
                    }
                    return;
                }
                if let Some(session) = app.try_state::<AuthSession>() {
                    session.set_status(&app, AuthStatus::Authenticated);
                }
                // Warm the buddy cache so the settings panel renders
                // from local data on first open. Best-effort — errors
                // are logged inside the helper.
                let app_for_sync = app.clone();
                tokio::spawn(async move {
                    crate::buddy::sync_after_auth(app_for_sync).await;
                });
                return;
            }
            PollOutcome::OAuthError(code) => match code.as_str() {
                "authorization_pending" => continue,
                "slow_down" => {
                    interval += 5;
                    info!("[auth] slow_down: bumping interval to {interval}s");
                    continue;
                }
                "access_denied" | "expired_token" => {
                    let message = oauth_message(&code);
                    if let Some(session) = app.try_state::<AuthSession>() {
                        session.set_status(
                            &app,
                            AuthStatus::Error {
                                code,
                                message,
                            },
                        );
                    }
                    return;
                }
                other => {
                    // `unsupported_grant_type`, `server_error`, or anything
                    // else the server throws back. Surface as-is.
                    let message = oauth_message(other);
                    if let Some(session) = app.try_state::<AuthSession>() {
                        session.set_status(
                            &app,
                            AuthStatus::Error {
                                code: other.to_string(),
                                message,
                            },
                        );
                    }
                    return;
                }
            },
            PollOutcome::Transport(err) => {
                warn!("[auth] transport error: {err}");
                if let Some(session) = app.try_state::<AuthSession>() {
                    session.set_status(
                        &app,
                        AuthStatus::Error {
                            code: "network_error".into(),
                            message: err,
                        },
                    );
                }
                return;
            }
        }
    }
}

fn oauth_message(code: &str) -> String {
    match code {
        "access_denied" => "The sign-in request was denied.".into(),
        "expired_token" => "The sign-in request expired before it was approved.".into(),
        "unsupported_grant_type" => {
            "The server does not support this grant type — Buddy may be out of date.".into()
        }
        "server_error" => "The Xyzen server returned an error. Please try again.".into(),
        other => format!("Sign-in failed: {other}"),
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    // `oauth_message` is a private helper; integration tests can't reach it,
    // so its copy-coverage lives here.
    #[test]
    fn oauth_message_known_codes() {
        assert!(oauth_message("access_denied").contains("denied"));
        assert!(oauth_message("expired_token").contains("expired"));
    }
}
