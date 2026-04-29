//! SSE command surface. The TS shim in `src/services/sse.ts` calls these
//! and listens for the fanout events emitted below.

use tauri::{AppHandle, Emitter, State};
use tokio::sync::mpsc;

use crate::events::{
    XYZEN_AUTH_FAILED, XYZEN_SSE_CONNECTED, XYZEN_SSE_DISCONNECTED, XYZEN_SSE_EVENT,
};
use crate::net::sse::{SseSignal, SseStatus};
use crate::state::AppState;

#[tauri::command]
pub async fn xyzen_sse_connect(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let (tx, mut rx) = mpsc::unbounded_channel::<SseSignal>();

    // Dispatch loop: translate SseSignal into Tauri events. Lives as long
    // as the client holds the sender side; terminates when disconnect drops
    // it. Task is detached because the SSE stream owns its own lifetime.
    let app_for_task = app.clone();
    tokio::spawn(async move {
        while let Some(sig) = rx.recv().await {
            match sig {
                SseSignal::Connected => {
                    let _ = app_for_task.emit(XYZEN_SSE_CONNECTED, ());
                }
                SseSignal::Disconnected { code, reason } => {
                    #[derive(Clone, serde::Serialize)]
                    struct Payload {
                        code: u16,
                        reason: String,
                    }
                    let _ = app_for_task.emit(XYZEN_SSE_DISCONNECTED, Payload { code, reason });
                }
                SseSignal::AuthFailed => {
                    let _ = app_for_task.emit(XYZEN_AUTH_FAILED, ());
                }
                SseSignal::Event(evt) => {
                    let _ = app_for_task.emit(XYZEN_SSE_EVENT, evt);
                }
            }
        }
    });

    state.sse.connect(tx).await;
    Ok(())
}

#[tauri::command]
pub async fn xyzen_sse_disconnect(
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.sse.disconnect().await;
    Ok(())
}

#[tauri::command]
pub async fn xyzen_sse_status(
    state: State<'_, AppState>,
) -> Result<SseStatus, String> {
    Ok(state.sse.status().await)
}
