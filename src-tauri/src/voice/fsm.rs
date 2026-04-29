//! Voice session state enum. Intentionally broader than what the scaffold
//! currently emits so the UI can be designed against the full state space.

use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "kebab-case")]
pub enum VoiceState {
    Idle,
    Listening,
    Preroll,
    Speaking,
    BargeIn,
    Standby,
}

impl VoiceState {
    /// Serde's kebab-case output — exposed for test assertions that want
    /// to avoid JSON round-tripping.
    #[cfg(test)]
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Listening => "listening",
            Self::Preroll => "preroll",
            Self::Speaking => "speaking",
            Self::BargeIn => "barge-in",
            Self::Standby => "standby",
        }
    }
}
