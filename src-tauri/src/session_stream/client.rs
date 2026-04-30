//! HTTP client + SSE frame parser for the Buddy session-status stream.
//!
//! Path prefix mirrors `auth::client` so `backend_url` covers both flows —
//! user sets the origin, we append `/xyzen/api/v1/buddy/session/events`.

use reqwest::header::{ACCEPT, AUTHORIZATION};
use reqwest::{Client, Response, StatusCode};

/// Path under the Xyzen origin. Everything behind the Nginx gateway lives
/// under `/xyzen/` (see `infra/nginx/nginx.conf` in the service repo).
pub const API_PREFIX: &str = "/xyzen/api/v1/buddy/session/events";

/// Hard error from `connect` — the session task turns `Unauthorized` into
/// an idle state (waiting for the next auth event) and all others into
/// reconnect-with-backoff.
#[derive(Debug)]
pub enum ConnectError {
    /// 401 — bearer is missing or expired. Don't retry automatically;
    /// another auth cycle will re-trigger us.
    Unauthorized,
    /// 4xx/5xx that isn't 401, or an unreadable body.
    Http { status: StatusCode, body: String },
    /// Network, TLS, DNS, etc.
    Transport(String),
}

pub struct SessionStreamClient {
    origin: String,
    http: Client,
}

impl SessionStreamClient {
    pub fn new(origin: String) -> Self {
        // `read_timeout` > server keepalive (15 s) so a healthy stream
        // never spuriously errors, but a truly dead socket still exits
        // the read and the caller can reconnect.
        let http = Client::builder()
            .connect_timeout(std::time::Duration::from_secs(15))
            .read_timeout(std::time::Duration::from_secs(60))
            .build()
            .unwrap_or_else(|_| Client::new());
        Self {
            origin: origin.trim_end_matches('/').to_string(),
            http,
        }
    }

    /// Exposed for integration tests that assert the full URL layout.
    pub fn url(&self) -> String {
        format!("{}{}", self.origin, API_PREFIX)
    }

    /// Open the SSE stream. Returns the live `Response`; the caller drives
    /// it via `bytes_stream()` and feeds chunks through `parse_sse_chunk`.
    pub async fn connect(&self, access_token: &str) -> Result<Response, ConnectError> {
        let resp = self
            .http
            .get(self.url())
            .header(AUTHORIZATION, format!("Bearer {access_token}"))
            .header(ACCEPT, "text/event-stream")
            .send()
            .await
            .map_err(|e| ConnectError::Transport(format!("network: {e}")))?;

        let status = resp.status();
        if status.is_success() {
            return Ok(resp);
        }
        if status == StatusCode::UNAUTHORIZED {
            return Err(ConnectError::Unauthorized);
        }
        let body = resp.text().await.unwrap_or_default();
        Err(ConnectError::Http { status, body })
    }
}

/// One parsed SSE frame from the server. `data` is still JSON-encoded —
/// the caller deserializes against `BuddySessionEvent` (or ignores the
/// `heartbeat` payload shape).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SseFrame {
    pub event: String,
    pub data: String,
}

/// Drain every complete SSE frame from `buf`, leaving any trailing partial
/// frame in place. Frames are separated by a blank line (`\n\n`); inside a
/// frame, `event:` and `data:` lines are joined; comment lines (starting
/// with `:`, used for `:keepalive`) are dropped.
///
/// The spec allows `data:` to repeat across lines (the payload is the join
/// with `\n`); the Buddy server emits single-line `data:` today but we
/// support the general case anyway — it's two extra lines of code and
/// future-proofs against spec-compliant senders.
pub fn parse_sse_chunk(buf: &mut String) -> Vec<SseFrame> {
    let mut frames = Vec::new();
    loop {
        let Some(end) = find_frame_terminator(buf) else {
            return frames;
        };
        let (raw, rest_start) = {
            let raw = buf[..end.frame_end].to_string();
            (raw, end.after_terminator)
        };
        buf.drain(..rest_start);

        if let Some(frame) = parse_single_frame(&raw) {
            frames.push(frame);
        }
    }
}

struct TerminatorPos {
    /// End index of the frame body (exclusive), before the blank line.
    frame_end: usize,
    /// First index past the blank-line terminator.
    after_terminator: usize,
}

fn find_frame_terminator(buf: &str) -> Option<TerminatorPos> {
    // Accept both LF and CRLF line endings — some proxies rewrite them.
    if let Some(i) = buf.find("\n\n") {
        return Some(TerminatorPos {
            frame_end: i,
            after_terminator: i + 2,
        });
    }
    if let Some(i) = buf.find("\r\n\r\n") {
        return Some(TerminatorPos {
            frame_end: i,
            after_terminator: i + 4,
        });
    }
    None
}

fn parse_single_frame(raw: &str) -> Option<SseFrame> {
    let mut event = String::from("message");
    let mut data_lines: Vec<&str> = Vec::new();

    for line in raw.split('\n') {
        let line = line.strip_suffix('\r').unwrap_or(line);
        if line.is_empty() || line.starts_with(':') {
            // Comment / keepalive; ignore.
            continue;
        }
        let (field, value) = match line.split_once(':') {
            Some((f, v)) => (f, v.strip_prefix(' ').unwrap_or(v)),
            None => (line, ""),
        };
        match field {
            "event" => event = value.to_string(),
            "data" => data_lines.push(value),
            // `id` / `retry` are spec fields we don't need; drop silently.
            _ => {}
        }
    }

    if data_lines.is_empty() {
        return None;
    }
    Some(SseFrame {
        event,
        data: data_lines.join("\n"),
    })
}
