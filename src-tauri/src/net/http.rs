//! HTTP client for the Xyzen REST API. Mirrors the behaviour of the retired
//! `src/services/http.ts`:
//!   - Auto-prefixes `/xyzen/api/v1` when `absolute` is false and the path
//!     isn't already an absolute URL.
//!   - Attaches `Authorization: Bearer <token>` unless `auth=false`.
//!   - 20 s default timeout.
//!   - On 401, calls into the credential cache to refresh once (single-flight
//!     retry). A second 401 surfaces as `AuthFailed` — the IPC wrapper emits
//!     `xyzen://auth-failed` so the UI can react.
//!
//! The transport layer is plain Rust (no Tauri types) so it can be exercised
//! from `wiremock` tests without an `AppHandle`.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use reqwest::header::{HeaderMap, HeaderName, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use reqwest::{Method, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;
use tokio::sync::Mutex;

use crate::auth::AuthState;

pub const API_PREFIX: &str = "/xyzen/api/v1";
const DEFAULT_TIMEOUT_MS: u64 = 20_000;

#[derive(Debug, Error)]
pub enum HttpError {
    #[error("no credentials: baseUrl is empty")]
    NoBaseUrl,
    #[error("network error: {0}")]
    Network(String),
    #[error("timeout after {0}ms")]
    Timeout(u64),
    #[error("auth failed (401)")]
    AuthFailed,
    #[error("http {status}: {message}")]
    Status {
        status: u16,
        message: String,
        body: Option<Value>,
    },
    #[error("invalid header: {0}")]
    InvalidHeader(String),
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpRequest {
    pub method: Option<String>,
    pub path: String,
    #[serde(default)]
    pub body: Option<Value>,
    #[serde(default)]
    pub headers: Option<HashMap<String, String>>,
    #[serde(default = "default_auth")]
    pub auth: bool,
    #[serde(default)]
    pub absolute: bool,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
}

fn default_auth() -> bool {
    true
}

#[derive(Clone, Debug, Serialize)]
pub struct HttpResponse {
    pub status: u16,
    /// Parsed JSON when the response `content-type` is JSON, otherwise a
    /// plain string. `Null` when the body was empty or unreadable.
    pub body: Value,
    pub headers: HashMap<String, String>,
}

pub struct HttpClient {
    inner: reqwest::Client,
    auth: Arc<AuthState>,
    // Single-flight around the 401 invalidate path so a burst of parallel
    // requests only kicks off one refresh attempt.
    refresh_gate: Mutex<()>,
}

impl HttpClient {
    pub fn new(auth: Arc<AuthState>) -> Result<Self, HttpError> {
        let inner = reqwest::Client::builder()
            // Pi often sits on flaky wifi; keepalive keeps the socket warm
            // for back-to-back requests without TCP handshake cost.
            .tcp_keepalive(Some(Duration::from_secs(20)))
            .tcp_nodelay(true)
            .build()
            .map_err(|e| HttpError::Network(e.to_string()))?;
        Ok(Self {
            inner,
            auth,
            refresh_gate: Mutex::new(()),
        })
    }

    /// Build the fully-qualified URL. `absolute=true` or a scheme-prefixed path
    /// bypasses the `/xyzen/api/v1` prefix (used for `/xyzen/api/health`).
    fn build_url(base_url: &str, path: &str, absolute: bool) -> Result<String, HttpError> {
        if absolute || path.starts_with("http://") || path.starts_with("https://") {
            return Ok(path.to_string());
        }
        if base_url.is_empty() {
            return Err(HttpError::NoBaseUrl);
        }
        let sep = if path.starts_with('/') { "" } else { "/" };
        Ok(format!("{base_url}{API_PREFIX}{sep}{path}"))
    }

    pub async fn request(
        &self,
        req: HttpRequest,
    ) -> Result<HttpResponse, HttpError> {
        self.request_impl(&req, false).await
    }

    async fn request_impl(
        &self,
        req: &HttpRequest,
        retried: bool,
    ) -> Result<HttpResponse, HttpError> {
        let creds = self.auth.snapshot().await;
        let base_url = creds.base_url.clone().unwrap_or_default();
        let url = Self::build_url(&base_url, &req.path, req.absolute)?;

        let method = match req.method.as_deref().unwrap_or("GET").to_uppercase().as_str() {
            "GET" => Method::GET,
            "POST" => Method::POST,
            "PUT" => Method::PUT,
            "PATCH" => Method::PATCH,
            "DELETE" => Method::DELETE,
            other => return Err(HttpError::InvalidHeader(format!("unsupported method {other}"))),
        };

        let mut headers = HeaderMap::new();
        if let Some(user_headers) = &req.headers {
            for (k, v) in user_headers {
                let name = HeaderName::from_bytes(k.as_bytes())
                    .map_err(|e| HttpError::InvalidHeader(e.to_string()))?;
                let value = HeaderValue::from_str(v)
                    .map_err(|e| HttpError::InvalidHeader(e.to_string()))?;
                headers.insert(name, value);
            }
        }
        if req.body.is_some() && !headers.contains_key(CONTENT_TYPE) {
            headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
        }
        if req.auth {
            if let Some(token) = creds.token.as_deref() {
                if !token.is_empty() {
                    let bearer = format!("Bearer {token}");
                    let value = HeaderValue::from_str(&bearer)
                        .map_err(|e| HttpError::InvalidHeader(e.to_string()))?;
                    headers.insert(AUTHORIZATION, value);
                }
            }
        }

        let timeout = Duration::from_millis(req.timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS));

        let mut builder = self.inner.request(method, &url).headers(headers).timeout(timeout);
        if let Some(body) = &req.body {
            builder = builder.json(body);
        }

        let response = match builder.send().await {
            Ok(r) => r,
            Err(err) if err.is_timeout() => {
                return Err(HttpError::Timeout(timeout.as_millis() as u64));
            }
            Err(err) => return Err(HttpError::Network(err.to_string())),
        };

        let status = response.status();

        if status == StatusCode::UNAUTHORIZED && req.auth && !retried {
            // Single-flight: only one task at a time may trigger a refresh.
            let _guard = self.refresh_gate.lock().await;
            // Re-check — another task may have already landed a fresh token
            // while we were queued on the gate. If so, skip the invalidate
            // round-trip and just retry.
            let after = self.auth.snapshot().await;
            if after.token == creds.token {
                // TODO(stage 2-follow-up): call the TS-side provider's
                // `invalidate()` via a Tauri event. For the first cut the
                // webview is the source of truth and pushes updates on its
                // own cadence, so we simply wait briefly for a rotation.
                tokio::time::sleep(Duration::from_millis(250)).await;
            }
            drop(_guard);
            return Box::pin(self.request_impl(req, true)).await;
        }

        let mut headers_out = HashMap::with_capacity(response.headers().len());
        for (k, v) in response.headers() {
            if let Ok(vs) = v.to_str() {
                headers_out.insert(k.as_str().to_string(), vs.to_string());
            }
        }
        let content_type = response
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();

        let bytes = response
            .bytes()
            .await
            .map_err(|e| HttpError::Network(e.to_string()))?;

        let body_value = if bytes.is_empty() {
            Value::Null
        } else if content_type.contains("application/json") {
            serde_json::from_slice::<Value>(&bytes).unwrap_or(Value::Null)
        } else {
            Value::String(String::from_utf8_lossy(&bytes).into_owned())
        };

        if !status.is_success() {
            if status == StatusCode::UNAUTHORIZED {
                return Err(HttpError::AuthFailed);
            }
            let message = match &body_value {
                Value::Object(map) => map
                    .get("detail")
                    .map(|v| match v {
                        Value::String(s) => s.clone(),
                        other => other.to_string(),
                    })
                    .unwrap_or_else(|| format!("HTTP {}", status.as_u16())),
                Value::String(s) if !s.is_empty() => s.clone(),
                _ => format!("HTTP {}", status.as_u16()),
            };
            return Err(HttpError::Status {
                status: status.as_u16(),
                message,
                body: Some(body_value),
            });
        }

        Ok(HttpResponse {
            status: status.as_u16(),
            body: body_value,
            headers: headers_out,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefix_relative_path() {
        let url =
            HttpClient::build_url("http://localhost:8000", "/buddies/", false).unwrap();
        assert_eq!(url, "http://localhost:8000/xyzen/api/v1/buddies/");
    }

    #[test]
    fn prefix_relative_path_without_leading_slash() {
        let url = HttpClient::build_url("http://localhost:8000", "buddies/", false).unwrap();
        assert_eq!(url, "http://localhost:8000/xyzen/api/v1/buddies/");
    }

    #[test]
    fn absolute_path_bypasses_prefix() {
        let url = HttpClient::build_url(
            "http://localhost:8000",
            "http://localhost:8000/xyzen/api/health",
            false,
        )
        .unwrap();
        assert_eq!(url, "http://localhost:8000/xyzen/api/health");
    }

    #[test]
    fn absolute_flag_bypasses_prefix() {
        let url = HttpClient::build_url(
            "http://localhost:8000",
            "/xyzen/api/health",
            true,
        )
        .unwrap();
        assert_eq!(url, "/xyzen/api/health");
    }

    #[test]
    fn no_base_url_rejects_relative() {
        assert!(matches!(
            HttpClient::build_url("", "/buddies/", false),
            Err(HttpError::NoBaseUrl)
        ));
    }
}
