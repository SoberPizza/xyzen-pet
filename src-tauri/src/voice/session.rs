//! Voice session registry + skeleton lifecycle.
//!
//! Holds an in-memory map of session id → current `VoiceState`. `start` emits
//! `Idle → Listening`; `stop` emits `Listening → Idle`; `push_frame` is a
//! no-op today (consumed by a future inference + transport pipeline).

use std::collections::HashMap;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{AppHandle, Emitter, Runtime};
use tracing::{debug, info};

pub use super::fsm::VoiceState;

pub const VOICE_STATE_EVENT: &str = "voice://state";

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct VoiceStartOpts {
    pub buddy_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct VoiceStateChanged {
    pub session_id: String,
    pub state: VoiceState,
}

#[derive(Default)]
pub struct VoiceSessions {
    inner: Mutex<HashMap<String, VoiceState>>,
}

impl VoiceSessions {
    pub fn new() -> Self {
        Self::default()
    }

    fn set<R: Runtime>(&self, app: &AppHandle<R>, id: &str, state: VoiceState) {
        {
            let mut guard = self.inner.lock().expect("voice session lock");
            guard.insert(id.to_string(), state);
        }
        let _ = app.emit(
            VOICE_STATE_EVENT,
            VoiceStateChanged {
                session_id: id.to_string(),
                state,
            },
        );
    }

    fn remove<R: Runtime>(&self, app: &AppHandle<R>, id: &str) {
        let existed = {
            let mut guard = self.inner.lock().expect("voice session lock");
            guard.remove(id).is_some()
        };
        if existed {
            let _ = app.emit(
                VOICE_STATE_EVENT,
                VoiceStateChanged {
                    session_id: id.to_string(),
                    state: VoiceState::Idle,
                },
            );
        }
    }

    #[cfg(test)]
    pub fn state(&self, id: &str) -> Option<VoiceState> {
        self.inner.lock().ok()?.get(id).copied()
    }
}

fn new_session_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let ns = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("voice-{ns}")
}

#[tauri::command]
#[specta::specta]
pub fn voice_start<R: Runtime>(
    app: AppHandle<R>,
    sessions: tauri::State<'_, VoiceSessions>,
    opts: VoiceStartOpts,
) -> Result<String, String> {
    let id = new_session_id();
    info!(
        "[voice] start session={} buddy_id={}",
        id, opts.buddy_id
    );
    sessions.set(&app, &id, VoiceState::Idle);
    sessions.set(&app, &id, VoiceState::Listening);
    Ok(id)
}

#[tauri::command]
#[specta::specta]
pub fn voice_stop<R: Runtime>(
    app: AppHandle<R>,
    sessions: tauri::State<'_, VoiceSessions>,
    session_id: String,
) -> Result<(), String> {
    info!("[voice] stop session={}", session_id);
    sessions.remove(&app, &session_id);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn voice_push_frame(
    session_id: String,
    pcm: Vec<i16>,
) -> Result<(), String> {
    // Drop silently for now — the scaffold has nowhere to route audio.
    // Logged at debug so the dev console can confirm frames are arriving.
    debug!(
        "[voice] push_frame session={} len={}",
        session_id,
        pcm.len()
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_session_id_is_unique() {
        let a = new_session_id();
        std::thread::sleep(std::time::Duration::from_nanos(1));
        let b = new_session_id();
        assert_ne!(a, b);
    }

    #[test]
    fn voice_state_as_str_is_stable() {
        assert_eq!(VoiceState::Idle.as_str(), "idle");
        assert_eq!(VoiceState::BargeIn.as_str(), "barge-in");
    }
}
