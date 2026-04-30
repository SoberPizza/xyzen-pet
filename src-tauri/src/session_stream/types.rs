//! Wire types for the Buddy session-status stream.
//!
//! Mirrors `service/buddy/session_schemas.py`. `serde` tags match the
//! Pydantic `StrEnum` values (snake_case); `specta` reflects them into
//! `src/ipc/bindings.ts` so the Vue layer gets typed keyword unions.
//!
//! The server payload also carries a `meta: dict[str, Any]` field marked
//! "reserved for future metadata" — we intentionally drop it from this
//! mirror. `#[serde(default)]` on the other fields plus serde's default
//! of ignoring unknown keys means the JSON still deserializes cleanly;
//! wiring `meta` into the TS bindings would require a concrete schema
//! for the values, which the server doesn't provide yet.

use serde::{Deserialize, Serialize};
use specta::Type;

/// UI-surface keyword. Mirrors `buddy.session_schemas.BuddyUiKeyword`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum BuddyUiKeyword {
    Idle,
    SessionStarted,
    SessionEnded,
    Thinking,
    Speaking,
    ToolRunning,
    ToolDone,
    Disconnected,
    Reconnected,
    Error,
}

/// VRM-surface keyword. Mirrors `buddy.session_schemas.BuddyVrmKeyword`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum BuddyVrmKeyword {
    Idle,
    Listening,
    Thinking,
    Speaking,
    ToolUsing,
    Celebrating,
    Confused,
}

/// Payload carried by every `snapshot` / `status` SSE frame. Mirrors
/// `buddy.session_schemas.BuddySessionEvent` — UUIDs cross the wire as
/// strings so specta emits plain `string` typings.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct BuddySessionEvent {
    #[serde(default)]
    pub ui: Option<BuddyUiKeyword>,
    #[serde(default)]
    pub vrm: Option<BuddyVrmKeyword>,
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub topic_id: Option<String>,
    pub ts: f64,
}
