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
