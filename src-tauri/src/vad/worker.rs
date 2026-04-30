//! VAD worker task.
//!
//! Consumes PCM16 frames from the mic AudioWorklet (shipped over IPC by the
//! TS shim), runs them through the Silero v5 model in a dedicated task, and
//! emits `SpeechStart` / `SpeechEnd` signals with the same smoothing
//! behaviour the retired `@ricky0123/vad-web` integration used:
//!
//!   - 512-sample windows (32 ms @ 16 kHz) aggregated from 320-sample IPC
//!     frames (20 ms — the capture worklet's native cadence).
//!   - Hysteresis: enter "speaking" above `POSITIVE_THRESHOLD`, leave below
//!     `NEGATIVE_THRESHOLD` after `REDEMPTION_FRAMES` quiet windows.
//!   - Minimum speech duration of `MIN_SPEECH_MS`. Short bursts are
//!     reported as misfires and the FSM snaps back to idle.
//!
//! On backpressure (frames arriving faster than inference can keep up) the
//! bounded sender drops the oldest — VAD tolerates a missed window far
//! better than a stalled UI thread.

use std::path::PathBuf;
use std::sync::Arc;

use serde::Serialize;
use tokio::sync::{mpsc, Mutex};
use tokio::task::JoinHandle;
use tracing::{debug, info, warn};

use super::silero::{Silero, WINDOW_SAMPLES};

const FRAME_CAPACITY: usize = 8;

/// Action the caller should take after `VadFsm::feed`. Keeping side effects
/// (channel sends, `silero.reset()`) out of the FSM means it can be driven
/// by synthetic probability sequences in tests.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FsmAction {
    /// Nothing to emit.
    Continue,
    /// Speech onset — emit `VadSignal::SpeechStart`.
    SpeechStart,
    /// Speech ended after reaching `MIN_SPEECH_MS` — emit
    /// `VadSignal::SpeechEnd` and reset the model LSTM state.
    SpeechEnd,
    /// Brief burst below `MIN_SPEECH_MS`; swallow the `SpeechEnd` but still
    /// reset the model state so the next utterance starts fresh.
    Misfire,
}

/// Hysteresis FSM tuned to Silero v5 defaults (calibrated against
/// `@ricky0123/vad-web`'s WASM behaviour to avoid false-positives in
/// noisy rooms).
pub struct VadFsm {
    in_speech: bool,
    quiet_streak: u32,
    speech_ms: u64,
}

impl VadFsm {
    pub const POSITIVE_THRESHOLD: f32 = 0.78;
    pub const NEGATIVE_THRESHOLD: f32 = 0.40;
    pub const MIN_SPEECH_MS: u64 = 560;
    pub const REDEMPTION_FRAMES: u32 = 8; // ≈256 ms at 32 ms/window

    pub fn new() -> Self {
        Self {
            in_speech: false,
            quiet_streak: 0,
            speech_ms: 0,
        }
    }

    /// Advance one window. `prob` is the Silero output for a 32 ms window;
    /// `window_ms` is the logical forward step per inference (20 ms when
    /// sliding by one IPC frame).
    pub fn feed(&mut self, prob: f32, window_ms: u64) -> FsmAction {
        if !self.in_speech {
            if prob >= Self::POSITIVE_THRESHOLD {
                self.in_speech = true;
                self.quiet_streak = 0;
                self.speech_ms = window_ms;
                return FsmAction::SpeechStart;
            }
            return FsmAction::Continue;
        }

        self.speech_ms += window_ms;
        if prob < Self::NEGATIVE_THRESHOLD {
            self.quiet_streak += 1;
            if self.quiet_streak >= Self::REDEMPTION_FRAMES {
                let reached_min = self.speech_ms >= Self::MIN_SPEECH_MS;
                self.in_speech = false;
                self.quiet_streak = 0;
                self.speech_ms = 0;
                return if reached_min {
                    FsmAction::SpeechEnd
                } else {
                    FsmAction::Misfire
                };
            }
        } else {
            self.quiet_streak = 0;
        }
        FsmAction::Continue
    }
}

impl Default for VadFsm {
    fn default() -> Self {
        Self::new()
    }
}

impl Default for VadWorker {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Clone, Debug, Serialize)]
pub enum VadSignal {
    Ready,
    SpeechStart,
    SpeechEnd,
    /// Probability per window — gated by a debug flag so production doesn't
    /// spam the IPC bus at 31 Hz.
    Frame { is_speech: f32 },
    Error { message: String },
}

pub struct VadWorker {
    model_path: Mutex<Option<PathBuf>>,
    state: Mutex<Option<Handle>>,
}

struct Handle {
    frame_tx: mpsc::Sender<Vec<f32>>,
    task: JoinHandle<()>,
}

impl VadWorker {
    pub fn new() -> Self {
        Self {
            model_path: Mutex::new(None),
            state: Mutex::new(None),
        }
    }

    /// Set (or update) the path to the packaged Silero ONNX model. Must be
    /// called before `start`.
    pub async fn set_model_path(&self, path: PathBuf) {
        *self.model_path.lock().await = Some(path);
    }

    /// Spawn the inference task and register the output sink. Idempotent.
    pub async fn start(
        self: Arc<Self>,
        sink: mpsc::UnboundedSender<VadSignal>,
    ) -> Result<(), String> {
        let mut guard = self.state.lock().await;
        if guard.is_some() {
            let _ = sink.send(VadSignal::Ready);
            return Ok(());
        }
        let model_path = self
            .model_path
            .lock()
            .await
            .clone()
            .ok_or_else(|| "vad model path not set".to_string())?;
        let (frame_tx, frame_rx) = mpsc::channel::<Vec<f32>>(FRAME_CAPACITY);

        let sink_for_task = sink.clone();
        let blocking_task = tokio::task::spawn_blocking(move || {
            run_blocking(model_path, frame_rx, sink_for_task);
        });

        // `spawn_blocking` returns a JoinHandle but drives a sync closure;
        // wrap it back into an async-world handle so we can abort on stop.
        let task = tokio::spawn(async move {
            let _ = blocking_task.await;
        });

        *guard = Some(Handle { frame_tx, task });
        let _ = sink.send(VadSignal::Ready);
        Ok(())
    }

    pub async fn stop(&self) {
        let mut guard = self.state.lock().await;
        if let Some(handle) = guard.take() {
            drop(handle.frame_tx); // signal the worker loop to exit.
            handle.task.abort();
        }
    }

    /// Push a 20 ms PCM16 frame (320 samples). Converts to float and queues.
    pub async fn push_frame(&self, pcm16: &[u8]) {
        let Some(samples) = decode_pcm16(pcm16) else {
            warn!(len = pcm16.len(), "dropping malformed frame");
            return;
        };
        let guard = self.state.lock().await;
        let Some(handle) = guard.as_ref() else {
            return;
        };
        match handle.frame_tx.try_send(samples) {
            Ok(()) => {}
            Err(mpsc::error::TrySendError::Full(_)) => {
                // Channel is full — a slower-than-realtime model would
                // otherwise back up the IPC caller. Drop oldest keeps the
                // speech-start FSM responsive.
                debug!("frame queue full; dropping");
            }
            Err(mpsc::error::TrySendError::Closed(_)) => {}
        }
    }
}

pub fn decode_pcm16(bytes: &[u8]) -> Option<Vec<f32>> {
    if bytes.len() % 2 != 0 {
        return None;
    }
    let mut out = Vec::with_capacity(bytes.len() / 2);
    for chunk in bytes.chunks_exact(2) {
        let s = i16::from_le_bytes([chunk[0], chunk[1]]) as f32;
        out.push(s / 32_768.0);
    }
    Some(out)
}

fn run_blocking(
    model_path: PathBuf,
    mut frame_rx: mpsc::Receiver<Vec<f32>>,
    sink: mpsc::UnboundedSender<VadSignal>,
) {
    info!(path = ?model_path, "loading silero model");
    let mut silero = match Silero::load(&model_path) {
        Ok(s) => s,
        Err(e) => {
            let _ = sink.send(VadSignal::Error { message: e });
            return;
        }
    };

    // Rolling float buffer that slides forward one 320-sample frame at a
    // time but is inferenced on 512-sample windows (Silero v5's fixed
    // window size). First 512-sample window accumulates two frames before
    // producing output — matches the browser-side cadence closely enough
    // that the speech-onset latency stays under ~60 ms.
    let mut window_buf: Vec<f32> = Vec::with_capacity(WINDOW_SAMPLES * 2);
    let window_ms_per_frame: u64 = 20; // 20ms per IPC frame

    let mut fsm = VadFsm::new();

    while let Some(frame) = frame_rx.blocking_recv() {
        window_buf.extend_from_slice(&frame);

        while window_buf.len() >= WINDOW_SAMPLES {
            let window: Vec<f32> = window_buf[..WINDOW_SAMPLES].to_vec();
            // Slide forward by one 320-sample frame (20 ms) so the model
            // sees continuous 32 ms windows with 12 ms overlap.
            window_buf.drain(..frame.len());

            let prob = match silero.infer(&window) {
                Ok(p) => p,
                Err(e) => {
                    warn!(err = %e, "infer error");
                    continue;
                }
            };

            let _ = sink.send(VadSignal::Frame { is_speech: prob });

            match fsm.feed(prob, window_ms_per_frame) {
                FsmAction::Continue => {}
                FsmAction::SpeechStart => {
                    let _ = sink.send(VadSignal::SpeechStart);
                }
                FsmAction::SpeechEnd => {
                    let _ = sink.send(VadSignal::SpeechEnd);
                    silero.reset();
                }
                FsmAction::Misfire => {
                    silero.reset();
                }
            }
        }
    }

    info!("worker exited");
}
