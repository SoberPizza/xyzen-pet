//! Buddy session-status SSE consumer.
//!
//! Connects to `GET /xyzen/api/v1/buddy/session/events` (see
//! `service/buddy/session_stream.py`) using the cached access token, parses
//! the SSE frames, and re-emits them on the `buddy://session-status` Tauri
//! event so the Vue layer can route `BuddyVrmKeyword` transitions into the
//! VRM gesture driver and `BuddyUiKeyword` into the overlay status pill.

pub mod client;
pub mod session;
pub mod types;

pub use session::{
    session_stream_start, session_stream_status, session_stream_stop, SessionStreamSession,
};
pub use types::{BuddySessionEvent, BuddyUiKeyword, BuddyVrmKeyword};
