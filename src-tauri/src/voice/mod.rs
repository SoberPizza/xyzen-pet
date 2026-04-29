//! Voice session skeleton.
//!
//! The real FSM (preroll buffer, wake-word gating, barge-in, standby,
//! speech/assistant turn interleaving) is deferred to the new remote API
//! rebuild. Today this is a minimal scaffold so the Vue side can call
//! `voice_start` / `voice_stop` / `voice_push_frame`, subscribe to
//! `voice://state` events, and get realistic state transitions.
//!
//! State transitions emitted today:
//!   - `voice_start`  → `state: "idle"` → `state: "listening"`
//!   - `voice_stop`   → `state: "idle"`
//!
//! Mic frames are accepted but discarded — there's nothing to send them to.

pub mod fsm;
pub mod session;

pub use session::VoiceSessions;
