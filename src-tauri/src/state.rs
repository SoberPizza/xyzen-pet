//! Shared app state registered with `app.manage()`.
//!
//! Today this holds only the VAD worker handle; other Rust-owned resources
//! (settings store, voice session registry) are registered directly by
//! their owning modules via `.manage()` calls in `lib.rs`.

use std::sync::Arc;

use crate::vad::worker::VadWorker;

pub struct AppState {
    pub vad: Arc<VadWorker>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            vad: Arc::new(VadWorker::new()),
        }
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn smoke_construct() {
        let _ = AppState::new();
    }
}
