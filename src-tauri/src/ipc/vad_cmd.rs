//! VAD command surface. `useVad.ts` streams mic PCM here and listens for
//! `vad://speech-{start,end}` events.

use std::path::PathBuf;

use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::mpsc;

use crate::events::{VAD_SPEECH_END, VAD_SPEECH_START};
use crate::state::AppState;
use crate::vad::worker::VadSignal;

#[tauri::command]
pub async fn vad_start(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    // Resolve the packaged Silero model. On `yarn tauri dev` this is the
    // source-tree `resources/` folder; in release bundles it sits under the
    // platform resource dir Tauri populates from `bundle.resources` in
    // tauri.conf.json.
    let path = resolve_model_path(&app)?;
    state.vad.set_model_path(path).await;

    let (tx, mut rx) = mpsc::unbounded_channel::<VadSignal>();

    let app_for_task = app.clone();
    tokio::spawn(async move {
        while let Some(sig) = rx.recv().await {
            match sig {
                VadSignal::Ready => {}
                VadSignal::SpeechStart => {
                    let _ = app_for_task.emit(VAD_SPEECH_START, ());
                }
                VadSignal::SpeechEnd => {
                    let _ = app_for_task.emit(VAD_SPEECH_END, ());
                }
                VadSignal::Frame { is_speech } => {
                    // Gated by env so production doesn't spam. Turn on with
                    // BUDDY_VAD_DEBUG_FRAMES=1.
                    if std::env::var("BUDDY_VAD_DEBUG_FRAMES").is_ok() {
                        #[derive(Clone, serde::Serialize)]
                        struct P {
                            is_speech: f32,
                        }
                        let _ = app_for_task.emit("vad://frame", P { is_speech });
                    }
                }
                VadSignal::Error { message } => {
                    #[derive(Clone, serde::Serialize)]
                    struct E {
                        message: String,
                    }
                    let _ = app_for_task.emit("vad://error", E { message });
                }
            }
        }
    });

    state.vad.clone().start(tx).await
}

#[tauri::command]
pub async fn vad_stop(state: State<'_, AppState>) -> Result<(), String> {
    state.vad.stop().await;
    Ok(())
}

#[tauri::command]
pub async fn vad_push_frame(
    state: State<'_, AppState>,
    pcm16: Vec<u8>,
) -> Result<(), String> {
    state.vad.push_frame(&pcm16).await;
    Ok(())
}

fn resolve_model_path(app: &AppHandle) -> Result<PathBuf, String> {
    // `resource_dir()` lands on `$APPDIR/resources` in bundled builds and
    // `src-tauri/` in dev.
    let base = app
        .path()
        .resource_dir()
        .map_err(|e| format!("resource_dir: {e}"))?;
    let candidate = base.join("resources/silero_vad_v5.onnx");
    if candidate.exists() {
        return Ok(candidate);
    }
    let fallback = base.join("_up_/resources/silero_vad_v5.onnx");
    if fallback.exists() {
        return Ok(fallback);
    }
    // Dev fallback: hunt from CWD / cargo manifest.
    let manifest_relative = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join("silero_vad_v5.onnx");
    if manifest_relative.exists() {
        return Ok(manifest_relative);
    }
    Err(format!(
        "silero model not found; tried {candidate:?}, {fallback:?}, and {manifest_relative:?}"
    ))
}
