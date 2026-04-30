//! HTTP client wrapping the Xyzen `/buddy/*` auth endpoints.
//!
//! The user sets an origin (e.g. `http://localhost`) in settings; the
//! `/xyzen/api/v1/auth/buddy/...` path prefix is compiled in to keep the
//! UI simple and match the Nginx gateway the rest of Xyzen sits behind.

use reqwest::Client;
use serde::{Deserialize, Serialize};
use tracing::{debug, warn};

/// RFC 8628 grant identifier — kept literal to match the server router at
/// `service/buddy/auth_api.py:23`.
pub const DEVICE_CODE_GRANT: &str = "urn:ietf:params:oauth:grant-type:device_code";

/// Path under the Xyzen origin. Everything behind the Nginx gateway lives
/// under `/xyzen/` (see `infra/nginx/nginx.conf:67`).
const API_PREFIX: &str = "/xyzen/api/v1/auth/buddy";

/// Default scope used when the buddy kicks off a flow. Matches the server's
/// Form default at `auth_api.py:90`.
pub const DEFAULT_SCOPE: &str = "openid profile email";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthorizeResponse {
    pub buddy_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub verification_uri_complete: String,
    pub expires_in: u64,
    pub interval: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenResponse {
    pub access_token: String,
    #[serde(default)]
    pub refresh_token: Option<String>,
    #[serde(default = "default_token_type")]
    pub token_type: String,
}

fn default_token_type() -> String {
    "Bearer".to_string()
}

/// Outcome of a single `/buddy/token` poll.
#[derive(Debug)]
pub enum PollOutcome {
    Success(TokenResponse),
    /// OAuth-shaped error code returned by the server in the `detail.error`
    /// field, e.g. `authorization_pending`, `slow_down`, `access_denied`,
    /// `expired_token`.
    OAuthError(String),
    /// Anything else — network, TLS, malformed response, unexpected HTTP
    /// status. Exit the poll loop.
    Transport(String),
}

pub struct AuthClient {
    origin: String,
    http: Client,
}

impl AuthClient {
    pub fn new(origin: String) -> Self {
        // Small default timeout so a hung server doesn't wedge the poll loop.
        let http = Client::builder()
            .timeout(std::time::Duration::from_secs(15))
            .build()
            .unwrap_or_else(|_| Client::new());
        Self {
            origin: origin.trim_end_matches('/').to_string(),
            http,
        }
    }

    /// Exposed for integration tests that assert the full URL layout.
    pub fn url(&self, endpoint: &str) -> String {
        format!("{}{}{}", self.origin, API_PREFIX, endpoint)
    }

    pub async fn authorize(
        &self,
        client_id: &str,
        scope: &str,
    ) -> Result<AuthorizeResponse, String> {
        let url = self.url("/authorize");
        debug!(method = "POST", %url, "http start");
        let resp = self
            .http
            .post(&url)
            .form(&[("client_id", client_id), ("scope", scope)])
            .send()
            .await
            .map_err(|e| {
                warn!(err = %e, "transport error");
                format!("network: {e}")
            })?;
        debug!(status = %resp.status(), "http resp");

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            let snippet: String = body.chars().take(512).collect();
            warn!(status = %status, body = %snippet, "http error");
            return Err(format!("authorize failed ({status}): {body}"));
        }

        resp.json::<AuthorizeResponse>()
            .await
            .map_err(|e| format!("parse authorize response: {e}"))
    }

    /// Polls `/buddy/token` once. Returns `Success` on 200, `OAuthError` on
    /// the RFC 8628 error envelope, and `Transport` otherwise.
    pub async fn poll_token(&self, buddy_code: &str) -> PollOutcome {
        let url = self.url("/token");
        debug!(method = "POST", %url, "http start");
        let req = self
            .http
            .post(&url)
            .form(&[("grant_type", DEVICE_CODE_GRANT), ("buddy_code", buddy_code)])
            .send()
            .await;

        let resp = match req {
            Ok(r) => r,
            Err(e) => {
                warn!(err = %e, "transport error");
                return PollOutcome::Transport(format!("network: {e}"));
            }
        };
        debug!(status = %resp.status(), "http resp");

        if resp.status().is_success() {
            return match resp.json::<TokenResponse>().await {
                Ok(t) => PollOutcome::Success(t),
                Err(e) => PollOutcome::Transport(format!("parse token response: {e}")),
            };
        }

        // FastAPI `HTTPException(detail={"error": ...})` serializes as
        // `{"detail": {"error": "<code>"}}`.
        let status = resp.status();
        match resp.json::<OAuthErrorBody>().await {
            Ok(body) => PollOutcome::OAuthError(body.detail.error),
            Err(e) => PollOutcome::Transport(format!("unexpected status {status}: {e}")),
        }
    }
}

#[derive(Debug, Deserialize)]
struct OAuthErrorBody {
    detail: OAuthErrorDetail,
}

#[derive(Debug, Deserialize)]
struct OAuthErrorDetail {
    error: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    // OAuthErrorBody is private; the integration suite can't see it, so the
    // one assertion that keeps the FastAPI error-envelope contract honest
    // stays inline.
    #[test]
    fn oauth_error_body_parses() {
        let raw = r#"{"detail":{"error":"authorization_pending"}}"#;
        let parsed: OAuthErrorBody = serde_json::from_str(raw).unwrap();
        assert_eq!(parsed.detail.error, "authorization_pending");
    }
}
