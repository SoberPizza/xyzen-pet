//! HTTP wrapper around `/xyzen/api/v1/buddy/*`.
//!
//! Same pattern as [`crate::auth::client::AuthClient`]: user-set origin
//! (persisted in settings) plus a hard-coded `/xyzen/` gateway prefix so
//! Buddy and the rest of Xyzen sit behind the same Nginx vhost.

use reqwest::{Client, Response, StatusCode};
use serde::Serialize;

use super::types::{
    BuddyEnvelope, BuddyError, BuddyTraitKind, RaceReadDTO, TraitReadDTO,
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
        let resp = self
            .http
            .get(self.url("/me"))
            .bearer_auth(&self.token)
            .send()
            .await
            .map_err(transport)?;
        parse_json(resp).await
    }

    pub async fn list_races(&self) -> Result<Vec<RaceReadDTO>, BuddyError> {
        let resp = self
            .http
            .get(self.url("/races"))
            .bearer_auth(&self.token)
            .send()
            .await
            .map_err(transport)?;
        parse_json(resp).await
    }

    pub async fn list_traits(
        &self,
        kind: Option<BuddyTraitKind>,
    ) -> Result<Vec<TraitReadDTO>, BuddyError> {
        let mut req = self.http.get(self.url("/traits")).bearer_auth(&self.token);
        if let Some(k) = kind {
            // Serde gives us the lowercase string already.
            let v = serde_json::to_value(k)
                .ok()
                .and_then(|v| v.as_str().map(|s| s.to_string()))
                .unwrap_or_default();
            req = req.query(&[("kind", v)]);
        }
        let resp = req.send().await.map_err(transport)?;
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
        let resp = self
            .http
            .post(self.url(&format!("/{buddy_id}/rename")))
            .bearer_auth(&self.token)
            .json(&Body { name })
            .send()
            .await
            .map_err(transport)?;
        parse_json(resp).await
    }

    pub async fn activate(&self, buddy_id: &str) -> Result<BuddyEnvelope, BuddyError> {
        let resp = self
            .http
            .post(self.url(&format!("/{buddy_id}/activate")))
            .bearer_auth(&self.token)
            .send()
            .await
            .map_err(transport)?;
        parse_json(resp).await
    }
}

fn transport(e: reqwest::Error) -> BuddyError {
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
