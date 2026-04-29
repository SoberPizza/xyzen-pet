//! Shared app state registered with `app.manage()`. Every handle lives behind
//! Arc so commands can cheaply hand off to spawned tasks.

use std::sync::Arc;

use crate::auth::AuthState;
use crate::net::http::HttpClient;
use crate::net::sse::SseClient;
use crate::net::voice_ws::VoiceWsClient;
use crate::vad::worker::VadWorker;

#[allow(dead_code)]
pub struct AppState {
    pub auth: Arc<AuthState>,
    pub http: Arc<HttpClient>,
    pub sse: Arc<SseClient>,
    pub voice_ws: Arc<VoiceWsClient>,
    pub vad: Arc<VadWorker>,
}

impl AppState {
    pub fn new() -> Self {
        let auth = Arc::new(AuthState::new());
        // Panics here are a boot-time config error — there's no graceful path
        // that lets the webview carry on meaningfully without HTTP.
        let http = Arc::new(
            HttpClient::new(auth.clone())
                .expect("HttpClient::new should not fail at boot"),
        );
        let sse = Arc::new(SseClient::new(auth.clone()));
        let voice_ws = Arc::new(VoiceWsClient::new(auth.clone()));
        let vad = Arc::new(VadWorker::new());
        Self {
            auth,
            http,
            sse,
            voice_ws,
            vad,
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
