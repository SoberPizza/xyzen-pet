//! Tauri command surface for the buddy voice WebSocket.

use tauri::ipc::Channel;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::mpsc;

use crate::events::*;
use crate::net::voice_ws::{VoiceOpenArgs, VoiceSignal, VoiceStartArgs};
use crate::state::AppState;

#[tauri::command]
pub async fn xyzen_voice_ws_open(
    app: AppHandle,
    state: State<'_, AppState>,
    args: VoiceOpenArgs,
    audio_channel: Channel<Vec<u8>>,
) -> Result<(), String> {
    let (tx, mut rx) = mpsc::unbounded_channel::<VoiceSignal>();

    let app_for_task = app.clone();
    tokio::spawn(async move {
        while let Some(sig) = rx.recv().await {
            emit_signal(&app_for_task, sig);
        }
    });

    state.voice_ws.open(args, tx, Some(audio_channel)).await
}

#[tauri::command]
pub async fn xyzen_voice_ws_close(state: State<'_, AppState>) -> Result<(), String> {
    state.voice_ws.close().await;
    Ok(())
}

#[tauri::command]
pub async fn xyzen_voice_ws_start_session(
    state: State<'_, AppState>,
    args: VoiceStartArgs,
) -> Result<(), String> {
    state.voice_ws.start_session(args).await
}

#[tauri::command]
pub async fn xyzen_voice_ws_input_start(state: State<'_, AppState>) -> Result<(), String> {
    state.voice_ws.input_start().await
}

#[tauri::command]
pub async fn xyzen_voice_ws_input_commit(state: State<'_, AppState>) -> Result<(), String> {
    state.voice_ws.input_commit().await
}

#[tauri::command]
pub async fn xyzen_voice_ws_interrupt(state: State<'_, AppState>) -> Result<(), String> {
    state.voice_ws.interrupt().await
}

#[tauri::command]
pub async fn xyzen_voice_ws_stop_session(state: State<'_, AppState>) -> Result<(), String> {
    state.voice_ws.stop_session().await
}

#[tauri::command]
pub async fn xyzen_voice_ws_send_frame(
    state: State<'_, AppState>,
    pcm16: Vec<u8>,
) -> Result<(), String> {
    state.voice_ws.send_frame(pcm16).await
}

fn emit_signal(app: &AppHandle, sig: VoiceSignal) {
    match sig {
        VoiceSignal::Opened => {
            let _ = app.emit(XYZEN_VOICE_STATE, StatePayload { state: "opened" });
        }
        VoiceSignal::SessionReady(r) => {
            let _ = app.emit(XYZEN_VOICE_SESSION_READY, r);
        }
        VoiceSignal::StateChanged(s) => {
            let _ = app.emit(XYZEN_VOICE_STATE, s);
        }
        VoiceSignal::StandbyEntered => {
            let _ = app.emit(XYZEN_VOICE_STANDBY_ENTERED, ());
        }
        VoiceSignal::StandbyHeard(t) => {
            let _ = app.emit(XYZEN_VOICE_STANDBY_HEARD, t);
        }
        VoiceSignal::WakeDetected(t) => {
            let _ = app.emit(XYZEN_VOICE_WAKE_DETECTED, t);
        }
        VoiceSignal::TranscriptFinal(t) => {
            let _ = app.emit(XYZEN_VOICE_TRANSCRIPT_FINAL, t);
        }
        VoiceSignal::AssistantText(t) => {
            let _ = app.emit(XYZEN_VOICE_ASSISTANT_TEXT, t);
        }
        VoiceSignal::AudioStart(p) => {
            let _ = app.emit(XYZEN_VOICE_AUDIO_START, p);
        }
        VoiceSignal::AudioChunk(p) => {
            // Only reached when no `Channel<Vec<u8>>` was supplied to `open()`
            // (an escape hatch for callers / tests that don't wire the
            // zero-copy path). Production always uses the channel.
            let _ = app.emit("xyzen://voice/audio-chunk", p);
        }
        VoiceSignal::AudioEnd => {
            let _ = app.emit(XYZEN_VOICE_AUDIO_END, ());
        }
        VoiceSignal::Interrupted => {
            let _ = app.emit(XYZEN_VOICE_INTERRUPTED, ());
        }
        VoiceSignal::Error(e) => {
            let _ = app.emit(XYZEN_VOICE_ERROR, e);
        }
        VoiceSignal::Closed(c) => {
            let _ = app.emit(XYZEN_VOICE_CLOSED, c);
        }
    }
}

#[derive(Clone, serde::Serialize)]
struct StatePayload {
    state: &'static str,
}
