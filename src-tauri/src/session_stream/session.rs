//! Spawned task that owns the SSE connection and emits
//! `buddy://session-status` to the webview.
//!
//! Lifecycle mirrors `auth::session`: the struct is `.manage()`'d by
//! `lib.rs`; `start()` spawns a task and stores the handle, `stop()` aborts
//! it. Auto-driven by the `auth://status` transitions — call sites in
//! `lib.rs::setup()` listen for `{"kind":"authenticated"}` /
//! `{"kind":"idle"}` and flip this session on/off accordingly.

use std::sync::Mutex;
use std::time::Duration;

use futures_util::StreamExt;
use tauri::async_runtime::{spawn, JoinHandle};
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tracing::{debug, info, warn};

use crate::auth::settings::{access_token, backend_url, DEFAULT_BACKEND_URL};
use crate::events::BUDDY_SESSION_EVENT;
use crate::session_stream::client::{
    parse_sse_chunk, ConnectError, SessionStreamClient, SseFrame,
};
use crate::session_stream::types::BuddySessionEvent;

const BACKOFF_START: Duration = Duration::from_secs(1);
const BACKOFF_CAP: Duration = Duration::from_secs(30);

pub struct SessionStreamSession {
    snapshot: Mutex<Option<BuddySessionEvent>>,
    // `tauri::async_runtime::JoinHandle` so we can spawn before Tauri's
    // Tokio runtime is the "current" one on this thread — notably from
    // inside `tauri::Builder::setup`, which runs on the main thread
    // before the runtime is entered. Using `tokio::spawn` there panics
    // with "there is no reactor running".
    task: Mutex<Option<JoinHandle<()>>>,
}

impl SessionStreamSession {
    pub fn new() -> Self {
        Self {
            snapshot: Mutex::new(None),
            task: Mutex::new(None),
        }
    }

    pub fn snapshot(&self) -> Option<BuddySessionEvent> {
        self.snapshot.lock().expect("session_stream snapshot lock").clone()
    }

    fn set_snapshot(&self, next: Option<BuddySessionEvent>) {
        let mut guard = self.snapshot.lock().expect("session_stream snapshot lock");
        *guard = next;
    }

    fn replace_task(&self, handle: Option<JoinHandle<()>>) {
        let mut guard = self.task.lock().expect("session_stream task lock");
        if let Some(old) = guard.take() {
            old.abort();
        }
        *guard = handle;
    }

    /// Idempotent: if a task is already running, this is a no-op.
    pub fn start<R: Runtime>(&self, app: AppHandle<R>) {
        let already = {
            let guard = self.task.lock().expect("session_stream task lock");
            // `tauri::async_runtime::JoinHandle` doesn't expose
            // `is_finished`; a stored handle means "we asked the
            // runtime to run this", which is good enough for
            // idempotency — the run loop itself short-circuits on a
            // missing token.
            guard.is_some()
        };
        info!("[session_stream] start requested (already_running={already})");
        if already {
            return;
        }
        let handle = spawn(run_loop(app));
        self.replace_task(Some(handle));
    }

    pub fn stop(&self) {
        info!("[session_stream] stop requested");
        self.replace_task(None);
        self.set_snapshot(None);
    }
}

impl Default for SessionStreamSession {
    fn default() -> Self {
        Self::new()
    }
}

/// Returns the last snapshot the stream has observed, or `None` if nothing
/// has arrived yet. The Vue composable calls this on mount so the pill +
/// VRM gesture can seed without waiting for a live frame.
#[tauri::command]
#[specta::specta]
pub fn session_stream_status(
    session: tauri::State<'_, SessionStreamSession>,
) -> Option<BuddySessionEvent> {
    session.snapshot()
}

#[tauri::command]
#[specta::specta]
pub fn session_stream_start<R: Runtime>(
    app: AppHandle<R>,
    session: tauri::State<'_, SessionStreamSession>,
) -> Result<(), String> {
    session.start(app);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn session_stream_stop(
    session: tauri::State<'_, SessionStreamSession>,
) -> Result<(), String> {
    session.stop();
    Ok(())
}

async fn run_loop<R: Runtime>(app: AppHandle<R>) {
    let mut backoff = BACKOFF_START;
    loop {
        let token_opt = access_token(&app);
        info!(
            "[session_stream] loop iteration token_present={}",
            token_opt.is_some()
        );
        let Some(token) = token_opt else {
            info!("[session_stream] no access token; exiting loop");
            return;
        };
        let origin = backend_url(&app).unwrap_or_else(|| DEFAULT_BACKEND_URL.to_string());
        info!("[session_stream] connecting to {origin}");
        let client = SessionStreamClient::new(origin);

        match client.connect(&token).await {
            Ok(resp) => {
                info!("[session_stream] connected");
                backoff = BACKOFF_START;
                if let Err(err) = read_stream(&app, resp).await {
                    warn!("[session_stream] stream ended: {err}");
                } else {
                    info!("[session_stream] stream closed cleanly by server");
                }
            }
            Err(ConnectError::Unauthorized) => {
                let prefix_len = token.len().min(8);
                warn!(
                    "[session_stream] 401: bearer rejected; bailing (bearer_prefix={}…)",
                    &token[..prefix_len]
                );
                return;
            }
            Err(ConnectError::Http { status, body }) => {
                warn!("[session_stream] http {status}: {body}");
            }
            Err(ConnectError::Transport(err)) => {
                warn!("[session_stream] transport: {err}");
            }
        }

        info!("[session_stream] sleeping {:?} before reconnect", backoff);
        tokio::time::sleep(backoff).await;
        backoff = (backoff * 2).min(BACKOFF_CAP);
    }
}

/// Consume the SSE byte stream until the server closes or a read errors.
/// On every parseable `snapshot`/`status` frame, cache the snapshot and
/// emit `buddy://session-status`. `heartbeat` frames are logged at debug
/// and otherwise ignored.
async fn read_stream<R: Runtime>(
    app: &AppHandle<R>,
    resp: reqwest::Response,
) -> Result<(), String> {
    let mut stream = resp.bytes_stream();
    let mut buf = String::new();

    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|e| format!("read: {e}"))?;
        if bytes.is_empty() {
            continue;
        }
        buf.push_str(&String::from_utf8_lossy(&bytes));
        debug!(
            "[session_stream] chunk bytes={} buf_len={}",
            bytes.len(),
            buf.len()
        );

        for frame in parse_sse_chunk(&mut buf) {
            dispatch_frame(app, frame);
        }
    }
    Ok(())
}

fn dispatch_frame<R: Runtime>(app: &AppHandle<R>, frame: SseFrame) {
    match frame.event.as_str() {
        "snapshot" | "status" => match serde_json::from_str::<BuddySessionEvent>(&frame.data) {
            Ok(event) => {
                info!(
                    "[session_stream] {} event ui={:?} vrm={:?} session_id={:?}",
                    frame.event, event.ui, event.vrm, event.session_id
                );
                if let Some(session) = app.try_state::<SessionStreamSession>() {
                    session.set_snapshot(Some(event.clone()));
                }
                let windows = app.webview_windows().len();
                debug!(
                    "[session_stream] emit {} on {} window(s)",
                    BUDDY_SESSION_EVENT, windows
                );
                let _ = app.emit(BUDDY_SESSION_EVENT, event);
            }
            Err(err) => warn!(
                "[session_stream] parse {} failed: {err} data={}",
                frame.event, frame.data
            ),
        },
        "heartbeat" => {
            debug!("[session_stream] heartbeat");
        }
        other => {
            warn!("[session_stream] unknown event kind: {other}");
        }
    }
}
