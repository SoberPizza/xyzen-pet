//! Event-name constants for `app.emit()`. Keep in sync with the TS listeners
//! in `src/ipc/client.ts` and the composables that subscribe directly.

pub const VAD_SPEECH_START: &str = "vad://speech-start";
pub const VAD_SPEECH_END: &str = "vad://speech-end";

pub const AUTH_STATUS_EVENT: &str = "auth://status";

/// Buddy session-status SSE frames forwarded from the Xyzen server. Carries
/// a `BuddySessionEvent` payload; see `session_stream::types`.
pub const BUDDY_SESSION_EVENT: &str = "buddy://session-status";
