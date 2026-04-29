//! Credential cache. Today this is just a typed holder — stage 2 will wire it
//! to the tauriSibling frontend provider (which pushes `auth-credentials-updated`
//! on the Tauri event bus) so Rust-side HTTP/SSE/WS clients share one source
//! of truth with the webview.

// Methods light up when the HTTP shim in stage 2 starts reading this cache.
#![allow(dead_code)]

use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct AuthCredentials {
    pub token: Option<String>,
    pub base_url: Option<String>,
}

#[derive(Debug, Default)]
pub struct AuthState {
    inner: RwLock<AuthCredentials>,
}

impl AuthState {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn snapshot(&self) -> AuthCredentials {
        self.inner.read().await.clone()
    }

    pub async fn set(&self, creds: AuthCredentials) {
        *self.inner.write().await = creds;
    }
}
