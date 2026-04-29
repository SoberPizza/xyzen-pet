//! Networking transport layer. Plain Rust — no Tauri types — so modules can
//! be unit-tested without `AppHandle`. IPC wrappers live in `ipc/`.

pub mod http;
pub mod sse;
pub mod voice_ws;
