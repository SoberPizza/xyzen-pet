//! Voice WebSocket client for `/xyzen/ws/v1/buddy/voice/{topic_id}`.
//!
//! Maintains a single active connection at a time. Sends JSON control frames
//! plus raw PCM16 mono 16 kHz 20 ms frames; receives JSON events plus PCM16
//! mono 24 kHz TTS frames between `assistant.audio.start` and `.end`.
//!
//! Lifecycle is owned by `VoiceWsClient::open` / `close`; the IPC layer
//! translates incoming WS messages into Tauri events. Stage 5 will swap the
//! binary TTS path onto `tauri::ipc::Channel<Vec<u8>>` — for now, binary
//! chunks ride on a plain event so the JSON + control surface can be shipped
//! and validated independently.

use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::ipc::Channel;
use tokio::net::TcpStream;
use tokio::sync::{mpsc, Mutex};
use tokio::task::JoinHandle;
use tokio::time::{interval, Instant};
use tokio_tungstenite::tungstenite::protocol::Message;
use tokio_tungstenite::{connect_async, MaybeTlsStream, WebSocketStream};
use tracing::{debug, info, warn};

use crate::auth::AuthState;

const PING_INTERVAL: Duration = Duration::from_secs(15);
const DEFAULT_TTS_SAMPLE_RATE: u32 = 24_000;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceOpenArgs {
    pub topic_id: String,
    #[serde(default)]
    pub preempt: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceStartArgs {
    pub mode: String,
    #[serde(default)]
    pub wake_words: Option<Vec<String>>,
    #[serde(default)]
    pub wake_word_timeout_ms: Option<u64>,
}

#[derive(Clone, Debug, Serialize)]
pub struct VoiceStateChanged {
    pub state: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct VoiceSessionReady {
    pub topic_id: String,
    pub modes: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct VoiceText {
    pub text: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct VoiceAssistantText {
    pub text: String,
    pub final_flag: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct VoiceAudioStart {
    pub sample_rate_hz: u32,
}

#[derive(Clone, Debug, Serialize)]
pub struct VoiceAudioChunk {
    pub sample_rate_hz: u32,
    /// Raw PCM16 LE bytes. Now flowing through `tauri::ipc::Channel<Vec<u8>>`
    /// — see `ipc::voice_cmd`'s `audio_channel` argument — so the JSON
    /// serialiser is bypassed on the hot path.
    pub bytes: Vec<u8>,
}

#[derive(Clone, Debug, Serialize)]
pub struct VoiceClosed {
    pub code: u16,
    pub reason: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct VoiceError {
    pub message: String,
}

/// Outgoing signals the IPC layer re-emits as Tauri events.
#[derive(Clone, Debug, Serialize)]
pub enum VoiceSignal {
    Opened,
    SessionReady(VoiceSessionReady),
    StateChanged(VoiceStateChanged),
    StandbyEntered,
    StandbyHeard(VoiceText),
    WakeDetected(VoiceText),
    TranscriptFinal(VoiceText),
    AssistantText(VoiceAssistantText),
    AudioStart(VoiceAudioStart),
    AudioChunk(VoiceAudioChunk),
    AudioEnd,
    Interrupted,
    Error(VoiceError),
    Closed(VoiceClosed),
}

type WsStream = WebSocketStream<MaybeTlsStream<TcpStream>>;

/// Commands funneled from IPC into the running connection task.
enum OutCmd {
    Json(Value),
    Binary(Vec<u8>),
    Close,
}

pub struct VoiceWsClient {
    auth: Arc<AuthState>,
    inner: Mutex<Option<Handle>>,
}

struct Handle {
    tx: mpsc::UnboundedSender<OutCmd>,
    task: JoinHandle<()>,
    // Owned by the connection task; kept on the handle only to hold the Arc
    // alive alongside the session. Read path is `_tts_rate` inside the task.
    _tts_rate: Arc<Mutex<u32>>,
}

impl VoiceWsClient {
    pub fn new(auth: Arc<AuthState>) -> Self {
        Self {
            auth,
            inner: Mutex::new(None),
        }
    }

    pub async fn open(
        &self,
        args: VoiceOpenArgs,
        sink: mpsc::UnboundedSender<VoiceSignal>,
        audio_channel: Option<Channel<Vec<u8>>>,
    ) -> Result<(), String> {
        // Close any prior session — the UI only ever runs one active voice
        // WS at a time, same as the retired TS client.
        self.close().await;

        let creds = self.auth.snapshot().await;
        let token = creds.token.clone().unwrap_or_default();
        let base_url = creds.base_url.clone().unwrap_or_default();
        if token.is_empty() || base_url.is_empty() {
            return Err("no credentials".into());
        }
        let ws_base = if let Some(rest) = base_url.strip_prefix("https://") {
            format!("wss://{rest}")
        } else if let Some(rest) = base_url.strip_prefix("http://") {
            format!("ws://{rest}")
        } else {
            base_url.clone()
        };
        let preempt = if args.preempt { "&preempt=1" } else { "" };
        let url = format!(
            "{ws_base}/xyzen/ws/v1/buddy/voice/{topic}?token={token}{preempt}",
            topic = urlencoding::encode(&args.topic_id),
            token = urlencoding::encode(&token),
            preempt = preempt,
        );
        info!(
            "[voice:ws] connecting {}",
            url.replace(&token, "***")
        );

        let (ws, _resp) = connect_async(&url)
            .await
            .map_err(|e| format!("ws connect: {e}"))?;
        info!("[voice:ws] open");

        let (cmd_tx, cmd_rx) = mpsc::unbounded_channel::<OutCmd>();
        let tts_rate = Arc::new(Mutex::new(DEFAULT_TTS_SAMPLE_RATE));
        let task = {
            let sink = sink.clone();
            let tts_rate = tts_rate.clone();
            tokio::spawn(run_connection(ws, sink, cmd_rx, tts_rate, audio_channel))
        };

        let _ = sink.send(VoiceSignal::Opened);

        *self.inner.lock().await = Some(Handle {
            tx: cmd_tx,
            task,
            _tts_rate: tts_rate,
        });
        Ok(())
    }

    pub async fn close(&self) {
        let mut guard = self.inner.lock().await;
        if let Some(handle) = guard.take() {
            let _ = handle.tx.send(OutCmd::Close);
            handle.task.abort();
        }
    }

    pub async fn send_json(&self, payload: Value) -> Result<(), String> {
        let guard = self.inner.lock().await;
        let Some(handle) = guard.as_ref() else {
            return Err("voice ws not open".into());
        };
        handle
            .tx
            .send(OutCmd::Json(payload))
            .map_err(|e| e.to_string())
    }

    pub async fn send_frame(&self, pcm16: Vec<u8>) -> Result<(), String> {
        let guard = self.inner.lock().await;
        let Some(handle) = guard.as_ref() else {
            return Err("voice ws not open".into());
        };
        handle
            .tx
            .send(OutCmd::Binary(pcm16))
            .map_err(|e| e.to_string())
    }

    pub async fn start_session(&self, args: VoiceStartArgs) -> Result<(), String> {
        let mut data = serde_json::Map::new();
        data.insert("mode".into(), Value::String(args.mode));
        if let Some(words) = args.wake_words {
            if !words.is_empty() {
                data.insert(
                    "wake_words".into(),
                    Value::Array(words.into_iter().map(Value::String).collect()),
                );
            }
        }
        if let Some(t) = args.wake_word_timeout_ms {
            data.insert("wake_word_timeout_ms".into(), json!(t));
        }
        self.send_json(json!({ "type": "session.start", "data": Value::Object(data) }))
            .await
    }

    pub async fn input_start(&self) -> Result<(), String> {
        self.send_json(json!({ "type": "input_audio.start" })).await
    }

    pub async fn input_commit(&self) -> Result<(), String> {
        self.send_json(json!({ "type": "input_audio.commit" })).await
    }

    pub async fn interrupt(&self) -> Result<(), String> {
        self.send_json(json!({ "type": "interrupt" })).await
    }

    pub async fn stop_session(&self) -> Result<(), String> {
        self.send_json(json!({ "type": "session.stop" })).await
    }
}

async fn run_connection(
    ws: WsStream,
    sink: mpsc::UnboundedSender<VoiceSignal>,
    mut cmd_rx: mpsc::UnboundedReceiver<OutCmd>,
    tts_rate: Arc<Mutex<u32>>,
    audio_channel: Option<Channel<Vec<u8>>>,
) {
    let (mut write, mut read) = ws.split();
    let mut ping_timer = interval(PING_INTERVAL);
    ping_timer.tick().await; // consume immediate tick; we want drift after the first interval.
    let start = Instant::now();

    loop {
        tokio::select! {
            // Outbound: user commands + periodic ping.
            cmd = cmd_rx.recv() => {
                let Some(cmd) = cmd else {
                    break;
                };
                match cmd {
                    OutCmd::Json(v) => {
                        let serialized = match serde_json::to_string(&v) {
                            Ok(s) => s,
                            Err(e) => {
                                warn!("[voice:ws] json serialize: {e}");
                                continue;
                            }
                        };
                        if let Err(e) = write.send(Message::Text(serialized)).await {
                            warn!("[voice:ws] ws send text: {e}");
                            break;
                        }
                    }
                    OutCmd::Binary(bytes) => {
                        if let Err(e) = write.send(Message::Binary(bytes)).await {
                            warn!("[voice:ws] ws send binary: {e}");
                            break;
                        }
                    }
                    OutCmd::Close => {
                        let _ = write.send(Message::Close(None)).await;
                        break;
                    }
                }
            }
            _ = ping_timer.tick() => {
                let payload = json!({ "type": "ping" }).to_string();
                if let Err(e) = write.send(Message::Text(payload)).await {
                    warn!("[voice:ws] ping send: {e}");
                    break;
                }
            }
            // Inbound.
            msg = read.next() => {
                let Some(msg) = msg else { break; };
                match msg {
                    Ok(Message::Text(raw)) => {
                        handle_json(&raw, &sink, &tts_rate).await;
                    }
                    Ok(Message::Binary(bytes)) => {
                        let rate = *tts_rate.lock().await;
                        if let Some(ch) = audio_channel.as_ref() {
                            // Channel path: raw bytes travel as an
                            // ArrayBuffer on the TS side (no JSON array
                            // encoding). The sample-rate hint stays on the
                            // `audio-start` event that preceded the chunk.
                            let _ = ch.send(bytes);
                        } else {
                            let _ = sink.send(VoiceSignal::AudioChunk(VoiceAudioChunk {
                                sample_rate_hz: rate,
                                bytes,
                            }));
                        }
                    }
                    Ok(Message::Close(frame)) => {
                        let (code, reason) = frame
                            .map(|f| (f.code.into(), f.reason.into_owned()))
                            .unwrap_or((1000, String::new()));
                        let _ = sink.send(VoiceSignal::Closed(VoiceClosed { code, reason }));
                        break;
                    }
                    Ok(Message::Ping(payload)) => {
                        let _ = write.send(Message::Pong(payload)).await;
                    }
                    Ok(_) => {}
                    Err(err) => {
                        warn!("[voice:ws] read err: {err}");
                        let _ = sink.send(VoiceSignal::Error(VoiceError {
                            message: err.to_string(),
                        }));
                        break;
                    }
                }
            }
        }
    }

    debug!("[voice:ws] task ended after {:?}", start.elapsed());
    let _ = sink.send(VoiceSignal::Closed(VoiceClosed {
        code: 1006,
        reason: "task ended".into(),
    }));
}

async fn handle_json(
    raw: &str,
    sink: &mpsc::UnboundedSender<VoiceSignal>,
    tts_rate: &Arc<Mutex<u32>>,
) {
    let Ok(msg) = serde_json::from_str::<Value>(raw) else {
        warn!("[voice:ws] malformed json");
        return;
    };
    let msg_type = msg.get("type").and_then(Value::as_str).unwrap_or("").to_string();
    let data = msg.get("data").cloned().unwrap_or(Value::Object(serde_json::Map::new()));

    match msg_type.as_str() {
        "session.ready" => {
            let topic_id = data.get("topic_id").and_then(Value::as_str).unwrap_or("").to_string();
            let modes = data
                .get("modes")
                .and_then(Value::as_array)
                .map(|a| a.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
                .unwrap_or_default();
            let _ = sink.send(VoiceSignal::SessionReady(VoiceSessionReady { topic_id, modes }));
        }
        "state.changed" => {
            let state = data.get("state").and_then(Value::as_str).unwrap_or("idle").to_string();
            let _ = sink.send(VoiceSignal::StateChanged(VoiceStateChanged { state }));
        }
        "standby.entered" => {
            let _ = sink.send(VoiceSignal::StandbyEntered);
        }
        "standby.heard" => {
            let text = data.get("text").and_then(Value::as_str).unwrap_or("").to_string();
            let _ = sink.send(VoiceSignal::StandbyHeard(VoiceText { text }));
        }
        "wake.detected" => {
            let text = data.get("text").and_then(Value::as_str).unwrap_or("").to_string();
            let _ = sink.send(VoiceSignal::WakeDetected(VoiceText { text }));
        }
        "transcript.final" => {
            let text = data.get("text").and_then(Value::as_str).unwrap_or("").to_string();
            let _ = sink.send(VoiceSignal::TranscriptFinal(VoiceText { text }));
        }
        "assistant.text.delta" => {
            let text = data.get("text").and_then(Value::as_str).unwrap_or("").to_string();
            let _ = sink.send(VoiceSignal::AssistantText(VoiceAssistantText {
                text,
                final_flag: false,
            }));
        }
        "assistant.text.final" => {
            let text = data.get("text").and_then(Value::as_str).unwrap_or("").to_string();
            let _ = sink.send(VoiceSignal::AssistantText(VoiceAssistantText {
                text,
                final_flag: true,
            }));
        }
        "assistant.audio.start" => {
            let rate = data
                .get("sample_rate_hz")
                .and_then(Value::as_u64)
                .map(|v| v as u32)
                .unwrap_or(DEFAULT_TTS_SAMPLE_RATE);
            *tts_rate.lock().await = rate;
            let _ = sink.send(VoiceSignal::AudioStart(VoiceAudioStart {
                sample_rate_hz: rate,
            }));
        }
        "assistant.audio.end" => {
            let _ = sink.send(VoiceSignal::AudioEnd);
        }
        "interrupted" => {
            let _ = sink.send(VoiceSignal::Interrupted);
        }
        "error" => {
            let message = data.get("message").and_then(Value::as_str).unwrap_or("voice error").to_string();
            let _ = sink.send(VoiceSignal::Error(VoiceError { message }));
        }
        "pong" | "input_audio.committed" | "session.closed" => {}
        _ => {
            debug!("[voice:ws] ignored msg {}", msg_type);
        }
    }
}
