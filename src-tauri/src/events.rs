//! Event-name constants for app.emit(). Keep in sync with the TS listeners
//! in src/services/*.ts.

// Populated across stages 2-6; each constant lights up as its module lands.
#![allow(dead_code)]

pub const XYZEN_AUTH_FAILED: &str = "xyzen://auth-failed";

pub const XYZEN_SSE_CONNECTED: &str = "xyzen://sse/connected";
pub const XYZEN_SSE_DISCONNECTED: &str = "xyzen://sse/disconnected";
pub const XYZEN_SSE_EVENT: &str = "xyzen://sse/event";

pub const XYZEN_VOICE_STATE: &str = "xyzen://voice/state";
pub const XYZEN_VOICE_SESSION_READY: &str = "xyzen://voice/session-ready";
pub const XYZEN_VOICE_TRANSCRIPT_FINAL: &str = "xyzen://voice/transcript-final";
pub const XYZEN_VOICE_ASSISTANT_TEXT: &str = "xyzen://voice/assistant-text";
pub const XYZEN_VOICE_STANDBY_ENTERED: &str = "xyzen://voice/standby-entered";
pub const XYZEN_VOICE_STANDBY_HEARD: &str = "xyzen://voice/standby-heard";
pub const XYZEN_VOICE_WAKE_DETECTED: &str = "xyzen://voice/wake-detected";
pub const XYZEN_VOICE_AUDIO_START: &str = "xyzen://voice/audio-start";
pub const XYZEN_VOICE_AUDIO_END: &str = "xyzen://voice/audio-end";
pub const XYZEN_VOICE_INTERRUPTED: &str = "xyzen://voice/interrupted";
pub const XYZEN_VOICE_ERROR: &str = "xyzen://voice/error";
pub const XYZEN_VOICE_CLOSED: &str = "xyzen://voice/closed";

pub const VAD_SPEECH_START: &str = "vad://speech-start";
pub const VAD_SPEECH_END: &str = "vad://speech-end";
