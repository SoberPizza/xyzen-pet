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
use tracing::{info, instrument};

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
#[instrument(skip(app, sessions), err(Debug))]
pub fn voice_start<R: Runtime>(
    app: AppHandle<R>,
    sessions: tauri::State<'_, VoiceSessions>,
    opts: VoiceStartOpts,
) -> Result<String, String> {
    let id = new_session_id();
    info!(session_id = %id, buddy_id = %opts.buddy_id, "voice start");
    sessions.set(&app, &id, VoiceState::Idle);
    sessions.set(&app, &id, VoiceState::Listening);
    Ok(id)
}

#[tauri::command]
#[specta::specta]
#[instrument(skip(app, sessions), err(Debug))]
pub fn voice_stop<R: Runtime>(
    app: AppHandle<R>,
    sessions: tauri::State<'_, VoiceSessions>,
    session_id: String,
) -> Result<(), String> {
    info!(%session_id, "voice stop");
    sessions.remove(&app, &session_id);
    Ok(())
}

#[tauri::command]
#[specta::specta]
#[allow(unused_variables)]
#[instrument(level = "trace", skip(pcm))]
pub fn voice_push_frame(
    session_id: String,
    pcm: Vec<i16>,
) -> Result<(), String> {
    // Drop silently for now — the scaffold has nowhere to route audio.
    // The trace-level span above is enough to confirm frames are arriving.
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // `new_session_id` is private; integration tests can't observe the
    // uniqueness guarantee, so it stays inline.
    #[test]
    fn new_session_id_is_unique() {
        let a = new_session_id();
        std::thread::sleep(std::time::Duration::from_nanos(1));
        let b = new_session_id();
        assert_ne!(a, b);
    }
}
