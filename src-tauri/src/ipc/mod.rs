//! Every `#[tauri::command]` the frontend calls lives here so the IPC
//! contract is reviewable in one folder. Each stage adds one submodule.

pub mod auth_cmd;
pub mod http_cmd;
pub mod sse_cmd;
pub mod vad_cmd;
pub mod voice_cmd;
