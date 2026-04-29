//! Xyzen device-code auth flow.
//!
//! The buddy boots unauthenticated. On the user's command (`auth_start` from
//! `ConnectionPanel.vue`) we hit the server's `/authorize` endpoint to get a
//! user_code + verification URL, then poll `/token` on the server-provided
//! interval until the user approves in the web UI. Tokens are persisted to
//! the shared settings store (plaintext — see CLAUDE.md posture; acceptable
//! for the Tauri app-data dir today).
//!
//! Refresh is deferred: the server's buddy router only exposes the
//! device-code grant, so when the access_token expires the user has to
//! re-run the flow. See `auth_api.py:56-60` for the server-side note.

pub mod client;
pub mod session;
pub mod settings;

pub use session::AuthSession;
