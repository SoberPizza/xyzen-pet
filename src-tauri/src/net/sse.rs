//! SSE client for `/xyzen/api/v1/buddy/events`.
//!
//! Manages one long-lived streaming connection with:
//!   - `Authorization: Bearer <token>` pulled from the shared auth cache
//!   - jittered exponential backoff (500 ms → 30 s)
//!   - a sticky `auth_failed` flag that halts retries until a new token lands
//!
//! Each parsed frame is emitted onto a user-provided async channel rather
//! than being coupled directly to Tauri — the IPC wrapper in `ipc/sse_cmd.rs`
//! owns the `AppHandle::emit` dispatch.
//!
//! Not an `EventSource` because that API can't attach custom headers, and we
//! need the `Bearer` token rather than a query-string one.

use std::sync::Arc;
use std::time::Duration;

use chrono::SecondsFormat;
use futures_util::StreamExt;
use reqwest::header::{ACCEPT, AUTHORIZATION, CACHE_CONTROL};
use reqwest::StatusCode;
use serde::Serialize;
use serde_json::Value;
use tokio::sync::{mpsc, Mutex};
use tokio::task::JoinHandle;
use tokio::time::sleep;
use tracing::{debug, info, warn};

use crate::auth::AuthState;

const BACKOFF_MIN_MS: u64 = 500;
const BACKOFF_MAX_MS: u64 = 30_000;

#[derive(Clone, Debug, Serialize)]
pub struct SseEvent {
    pub event: String,
    pub data: Value,
}

#[derive(Clone, Debug, Serialize)]
pub enum SseSignal {
    Connected,
    Disconnected { code: u16, reason: String },
    AuthFailed,
    Event(SseEvent),
}

pub struct SseClient {
    auth: Arc<AuthState>,
    state: Arc<Mutex<SseState>>,
}

#[derive(Default)]
struct SseState {
    task: Option<JoinHandle<()>>,
    cancel: Option<tokio::sync::watch::Sender<bool>>,
    connected: bool,
    auth_failed: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct SseStatus {
    pub connected: bool,
    pub auth_failed: bool,
}

impl SseClient {
    pub fn new(auth: Arc<AuthState>) -> Self {
        Self {
            auth,
            state: Arc::new(Mutex::new(SseState::default())),
        }
    }

    pub async fn status(&self) -> SseStatus {
        let s = self.state.lock().await;
        SseStatus {
            connected: s.connected,
            auth_failed: s.auth_failed,
        }
    }

    /// Idempotent — a second call while already running is a no-op.
    pub async fn connect(&self, sink: mpsc::UnboundedSender<SseSignal>) {
        let mut state = self.state.lock().await;
        if state.task.is_some() {
            return;
        }
        state.auth_failed = false;
        let (cancel_tx, cancel_rx) = tokio::sync::watch::channel(false);
        state.cancel = Some(cancel_tx);

        let auth = self.auth.clone();
        let shared_state = self.state.clone();
        let task = tokio::spawn(run_stream(auth, shared_state, sink, cancel_rx));
        state.task = Some(task);
    }

    pub async fn disconnect(&self) {
        let mut state = self.state.lock().await;
        if let Some(sender) = state.cancel.take() {
            let _ = sender.send(true);
        }
        if let Some(task) = state.task.take() {
            // Abort is fine — the stream loop checks the cancel channel
            // on every reconnect tick and drops the response body cleanly.
            task.abort();
        }
        state.connected = false;
    }
}

/// Local midnight as ISO-8601 — the server get-or-creates today's buddy
/// topic from this anchor, so it needs the client's local day boundary.
fn local_start_of_today_iso() -> String {
    let now = chrono::Local::now();
    let midnight = now
        .date_naive()
        .and_hms_opt(0, 0, 0)
        .expect("valid midnight")
        .and_local_timezone(chrono::Local)
        .single()
        .unwrap_or(now);
    midnight
        .with_timezone(&chrono::Utc)
        .to_rfc3339_opts(SecondsFormat::Millis, true)
}

async fn run_stream(
    auth: Arc<AuthState>,
    state: Arc<Mutex<SseState>>,
    sink: mpsc::UnboundedSender<SseSignal>,
    mut cancel: tokio::sync::watch::Receiver<bool>,
) {
    let client = match reqwest::Client::builder()
        .tcp_keepalive(Some(Duration::from_secs(20)))
        .tcp_nodelay(true)
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            warn!("[sse] client build failed: {e}");
            let _ = sink.send(SseSignal::Disconnected {
                code: 1006,
                reason: "client build failed".into(),
            });
            return;
        }
    };

    let mut attempt: u32 = 0;

    loop {
        if *cancel.borrow() {
            return;
        }
        if state.lock().await.auth_failed {
            // Wait for the auth cache to rotate, then retry. Reader drops
            // out of this branch by disconnecting + reconnecting.
            sleep(Duration::from_millis(BACKOFF_MIN_MS)).await;
            continue;
        }

        let creds = auth.snapshot().await;
        let token = creds.token.clone().unwrap_or_default();
        let base_url = creds.base_url.clone().unwrap_or_default();
        if token.is_empty() || base_url.is_empty() {
            // Credentials haven't landed yet — nothing to hit.
            sleep(Duration::from_millis(BACKOFF_MIN_MS)).await;
            continue;
        }

        let since = urlencoding::encode(&local_start_of_today_iso()).into_owned();
        let url = format!("{base_url}/xyzen/api/v1/buddy/events?since={since}");
        debug!("[sse] connecting {}", url);

        let bearer = format!("Bearer {token}");
        let request = client
            .get(&url)
            .header(AUTHORIZATION, &bearer)
            .header(ACCEPT, "text/event-stream")
            .header(CACHE_CONTROL, "no-cache");

        let response = tokio::select! {
            biased;
            _ = cancel.changed() => return,
            r = request.send() => r,
        };

        let response = match response {
            Ok(r) => r,
            Err(err) => {
                warn!("[sse] fetch failed: {err}");
                schedule_reconnect(&mut attempt, &mut cancel).await;
                continue;
            }
        };

        if response.status() == StatusCode::UNAUTHORIZED {
            warn!("[sse] auth rejected (401)");
            {
                let mut s = state.lock().await;
                s.auth_failed = true;
                s.connected = false;
            }
            let _ = sink.send(SseSignal::AuthFailed);
            continue;
        }

        if !response.status().is_success() {
            warn!("[sse] non-2xx response {}", response.status());
            schedule_reconnect(&mut attempt, &mut cancel).await;
            continue;
        }

        attempt = 0;
        {
            let mut s = state.lock().await;
            s.connected = true;
        }
        info!("[sse] connected {}", url);
        let _ = sink.send(SseSignal::Connected);

        consume(response, &sink, &mut cancel).await;

        {
            let mut s = state.lock().await;
            s.connected = false;
        }
        if *cancel.borrow() {
            return;
        }
        let _ = sink.send(SseSignal::Disconnected {
            code: 1006,
            reason: "stream end".into(),
        });
        schedule_reconnect(&mut attempt, &mut cancel).await;
    }
}

async fn schedule_reconnect(
    attempt: &mut u32,
    cancel: &mut tokio::sync::watch::Receiver<bool>,
) {
    let exp = (BACKOFF_MIN_MS.saturating_mul(1u64 << (*attempt).min(8))).min(BACKOFF_MAX_MS);
    // Half-jitter: half fixed, half random — same shape as the retired TS
    // client so operational expectations don't move.
    let half = exp / 2;
    let jitter = rand::random::<u64>() % half.max(1);
    let delay = half + jitter;
    *attempt = attempt.saturating_add(1);
    debug!("[sse] reconnect in {}ms (attempt {})", delay, *attempt);
    tokio::select! {
        biased;
        _ = cancel.changed() => {}
        _ = sleep(Duration::from_millis(delay)) => {}
    }
}

async fn consume(
    response: reqwest::Response,
    sink: &mpsc::UnboundedSender<SseSignal>,
    cancel: &mut tokio::sync::watch::Receiver<bool>,
) {
    let mut stream = response.bytes_stream();
    let mut buf = String::new();
    loop {
        let chunk = tokio::select! {
            biased;
            _ = cancel.changed() => return,
            c = stream.next() => c,
        };
        let chunk = match chunk {
            Some(Ok(bytes)) => bytes,
            Some(Err(err)) => {
                warn!("[sse] stream error: {err}");
                return;
            }
            None => return,
        };
        // Frames may arrive split across chunks; accumulate until we see a
        // terminating blank line. Normalize CRLF to LF once per append so
        // the \n\n split works regardless of the upstream proxy.
        buf.push_str(&String::from_utf8_lossy(&chunk));
        while let Some(idx) = buf.find("\n\n").or_else(|| buf.find("\r\n\r\n")) {
            let frame_end = if buf[idx..].starts_with("\r\n\r\n") { 4 } else { 2 };
            let frame = buf[..idx].to_string();
            buf.drain(..idx + frame_end);
            if frame.is_empty() {
                continue;
            }
            if let Some(evt) = parse_frame(&frame) {
                let _ = sink.send(SseSignal::Event(evt));
            }
        }
    }
}

fn parse_frame(frame: &str) -> Option<SseEvent> {
    let mut event_name = "message".to_string();
    let mut data_lines: Vec<&str> = Vec::new();
    for line in frame.split('\n') {
        let line = line.trim_end_matches('\r');
        if line.is_empty() || line.starts_with(':') {
            continue;
        }
        if let Some(rest) = line.strip_prefix("event:") {
            event_name = rest.trim().to_string();
        } else if let Some(rest) = line.strip_prefix("data:") {
            // Per SSE spec: one optional leading space is stripped.
            let rest = rest.strip_prefix(' ').unwrap_or(rest);
            data_lines.push(rest);
        }
    }
    let payload = data_lines.join("\n");
    let data = if payload.is_empty() {
        Value::Object(serde_json::Map::new())
    } else {
        match serde_json::from_str::<Value>(&payload) {
            Ok(v) => v,
            Err(_) => {
                debug!("[sse] malformed json for event={}", event_name);
                return None;
            }
        }
    };
    Some(SseEvent {
        event: event_name,
        data,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_simple_frame() {
        let evt = parse_frame("event: foo\ndata: {\"x\":1}").unwrap();
        assert_eq!(evt.event, "foo");
        assert_eq!(evt.data["x"], 1);
    }

    #[test]
    fn parse_multiline_data() {
        let evt = parse_frame("event: bar\ndata: {\"y\":\ndata: 2}").unwrap();
        assert_eq!(evt.event, "bar");
        assert_eq!(evt.data["y"], 2);
    }

    #[test]
    fn parse_comment_only_returns_message_default() {
        let evt = parse_frame(": keepalive\ndata: {}").unwrap();
        assert_eq!(evt.event, "message");
    }

    #[test]
    fn parse_malformed_json_drops_frame() {
        let res = parse_frame("event: x\ndata: nope");
        assert!(res.is_none());
    }
}
