//! HTTP wrapper around `/xyzen/api/v1/buddy/*`.
//!
//! Same pattern as [`crate::auth::client::AuthClient`]: user-set origin
//! (persisted in settings) plus a hard-coded `/xyzen/` gateway prefix so
//! Buddy and the rest of Xyzen sit behind the same Nginx vhost.

use reqwest::{Client, Response, StatusCode};
use serde::Serialize;
use tracing::{debug, warn};

use super::types::{
    BuddyAttribute, BuddyEnvelope, BuddyError, BuddyGender, BuddyTraitKind,
    RaceReadDTO, TraitReadDTO,
};

/// Gateway-relative prefix. Everything Xyzen exposes lives under
/// `/xyzen/` — see `infra/nginx/nginx.conf` in the service repo.
const API_PREFIX: &str = "/xyzen/api/v1/buddy";

pub struct BuddyClient {
    origin: String,
    token: String,
    http: Client,
}

impl BuddyClient {
    pub fn new(origin: String, token: String) -> Self {
        // 15s matches the auth client. Buddy calls are all tiny JSON
        // payloads, so a hung server shouldn't wedge the UI.
        let http = Client::builder()
            .timeout(std::time::Duration::from_secs(15))
            .build()
            .unwrap_or_else(|_| Client::new());
        Self {
            origin: origin.trim_end_matches('/').to_string(),
            token,
            http,
        }
    }

    fn url(&self, endpoint: &str) -> String {
        format!("{}{}{}", self.origin, API_PREFIX, endpoint)
    }

    pub async fn get_me(&self) -> Result<BuddyEnvelope, BuddyError> {
        let url = self.url("/me");
        debug!(method = "GET", %url, "http start");
        let resp = self
            .http
            .get(&url)
            .bearer_auth(&self.token)
            .send()
            .await
            .map_err(transport)?;
        debug!(status = %resp.status(), "http resp");
        parse_json(resp).await
    }

    pub async fn list_races(&self) -> Result<Vec<RaceReadDTO>, BuddyError> {
        let url = self.url("/races");
        debug!(method = "GET", %url, "http start");
        let resp = self
            .http
            .get(&url)
            .bearer_auth(&self.token)
            .send()
            .await
            .map_err(transport)?;
        debug!(status = %resp.status(), "http resp");
        parse_json(resp).await
    }

    pub async fn list_traits(
        &self,
        kind: Option<BuddyTraitKind>,
    ) -> Result<Vec<TraitReadDTO>, BuddyError> {
        let url = self.url("/traits");
        debug!(method = "GET", %url, "http start");
        let mut req = self.http.get(&url).bearer_auth(&self.token);
        if let Some(k) = kind {
            // Serde gives us the lowercase string already.
            let v = serde_json::to_value(k)
                .ok()
                .and_then(|v| v.as_str().map(|s| s.to_string()))
                .unwrap_or_default();
            req = req.query(&[("kind", v)]);
        }
        let resp = req.send().await.map_err(transport)?;
        debug!(status = %resp.status(), "http resp");
        parse_json(resp).await
    }

    pub async fn create(
        &self,
        name: &str,
        race_code: &str,
        attribute: BuddyAttribute,
        gender: BuddyGender,
        generic_trait_codes: &[String],
    ) -> Result<BuddyEnvelope, BuddyError> {
        #[derive(Serialize)]
        struct Body<'a> {
            name: &'a str,
            race_code: &'a str,
            attribute: BuddyAttribute,
            gender: BuddyGender,
            generic_trait_codes: &'a [String],
            extra_metadata: serde_json::Map<String, serde_json::Value>,
        }
        let url = self.url("");
        debug!(method = "POST", %url, "http start");
        let resp = self
            .http
            .post(&url)
            .bearer_auth(&self.token)
            .json(&Body {
                name,
                race_code,
                attribute,
                gender,
                generic_trait_codes,
                extra_metadata: serde_json::Map::new(),
            })
            .send()
            .await
            .map_err(transport)?;
        debug!(status = %resp.status(), "http resp");
        parse_json(resp).await
    }

    pub async fn rename(
        &self,
        buddy_id: &str,
        name: &str,
    ) -> Result<BuddyEnvelope, BuddyError> {
        #[derive(Serialize)]
        struct Body<'a> {
            name: &'a str,
        }
        let url = self.url(&format!("/{buddy_id}/rename"));
        debug!(method = "POST", %url, "http start");
        let resp = self
            .http
            .post(&url)
            .bearer_auth(&self.token)
            .json(&Body { name })
            .send()
            .await
            .map_err(transport)?;
        debug!(status = %resp.status(), "http resp");
        parse_json(resp).await
    }

    pub async fn activate(&self, buddy_id: &str) -> Result<BuddyEnvelope, BuddyError> {
        let url = self.url(&format!("/{buddy_id}/activate"));
        debug!(method = "POST", %url, "http start");
        let resp = self
            .http
            .post(&url)
            .bearer_auth(&self.token)
            .send()
            .await
            .map_err(transport)?;
        debug!(status = %resp.status(), "http resp");
        parse_json(resp).await
    }

    /// Permanent delete. Server returns 204 on success — no envelope to
    /// parse. Caller is responsible for wiping the local cache.
    pub async fn delete(&self, buddy_id: &str) -> Result<(), BuddyError> {
        let url = self.url(&format!("/{buddy_id}"));
        debug!(method = "DELETE", %url, "http start");
        let resp = self
            .http
            .delete(&url)
            .bearer_auth(&self.token)
            .send()
            .await
            .map_err(transport)?;
        debug!(status = %resp.status(), "http resp");
        parse_empty(resp).await
    }
}

fn transport(e: reqwest::Error) -> BuddyError {
    warn!(err = %e, "transport error");
    BuddyError::Transport {
        message: e.to_string(),
    }
}

/// 2xx → parse JSON. Non-2xx → map the status to a typed variant and
/// try to extract a message from FastAPI's `{"detail": ...}` envelope.
async fn parse_json<T: serde::de::DeserializeOwned>(resp: Response) -> Result<T, BuddyError> {
    let status = resp.status();
    if status.is_success() {
        return resp.json::<T>().await.map_err(|e| BuddyError::Transport {
            message: format!("parse response: {e}"),
        });
    }

    let body = resp.text().await.unwrap_or_default();
    let snippet: String = body.chars().take(512).collect();
    warn!(status = %status, body = %snippet, "http error");
    let message = extract_detail(&body).unwrap_or_else(|| body.clone());
    Err(match status {
        StatusCode::UNAUTHORIZED => BuddyError::Unauthorized,
        StatusCode::NOT_FOUND => BuddyError::NotFound,
        StatusCode::CONFLICT => BuddyError::Conflict { message },
        StatusCode::UNPROCESSABLE_ENTITY => BuddyError::Validation { message },
        other => BuddyError::Server {
            status: other.as_u16(),
            message,
        },
    })
}

/// 2xx → success (no body parsed). Non-2xx → same error mapping as
/// [`parse_json`]. Used for 204 responses like DELETE.
async fn parse_empty(resp: Response) -> Result<(), BuddyError> {
    let status = resp.status();
    if status.is_success() {
        return Ok(());
    }
    let body = resp.text().await.unwrap_or_default();
    let snippet: String = body.chars().take(512).collect();
    warn!(status = %status, body = %snippet, "http error");
    let message = extract_detail(&body).unwrap_or_else(|| body.clone());
    Err(match status {
        StatusCode::UNAUTHORIZED => BuddyError::Unauthorized,
        StatusCode::NOT_FOUND => BuddyError::NotFound,
        StatusCode::CONFLICT => BuddyError::Conflict { message },
        StatusCode::UNPROCESSABLE_ENTITY => BuddyError::Validation { message },
        other => BuddyError::Server {
            status: other.as_u16(),
            message,
        },
    })
}

/// FastAPI's `HTTPException(detail=...)` serialises as `{"detail": "..."}`
/// (string) or `{"detail": [...]}` (validation list). Extract a readable
/// string from either shape; fall back to `None` so callers use the raw
/// body.
fn extract_detail(body: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(body).ok()?;
    let detail = v.get("detail")?;
    match detail {
        serde_json::Value::String(s) => Some(s.clone()),
        other => Some(other.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn url_joins_origin_and_prefix() {
        let c = BuddyClient::new("http://localhost/".to_string(), "t".to_string());
        assert_eq!(c.url("/me"), "http://localhost/xyzen/api/v1/buddy/me");
        assert_eq!(
            c.url("/abc/rename"),
            "http://localhost/xyzen/api/v1/buddy/abc/rename"
        );
    }

    #[test]
    fn extract_detail_string() {
        let raw = r#"{"detail":"Buddy not found"}"#;
        assert_eq!(extract_detail(raw).as_deref(), Some("Buddy not found"));
    }

    #[test]
    fn extract_detail_list_is_stringified() {
        let raw = r#"{"detail":[{"loc":["body","name"],"msg":"field required"}]}"#;
        let got = extract_detail(raw).unwrap();
        assert!(got.contains("field required"));
    }

    #[test]
    fn extract_detail_missing() {
        assert!(extract_detail("not json").is_none());
        assert!(extract_detail("{}").is_none());
    }
}
