//! `AuthStatus` and `AuthStartResponse` wire shapes.
//!
//! The Vue-side `ConnectionPanel.vue` switches on `kind`, so the tag name
//! and its casing are load-bearing.

use buddy_lib::auth::session::{AuthStartResponse, AuthStatus};

fn deserialize_status(raw: &str) -> AuthStatus {
    serde_json::from_str(raw).unwrap_or_else(|e| panic!("deserialize {raw:?}: {e}"))
}

#[test]
fn idle_serializes_as_bare_kind_tag() {
    let s = serde_json::to_string(&AuthStatus::Idle).unwrap();
    assert_eq!(s, "{\"kind\":\"idle\"}");
}

#[test]
fn authenticated_serializes_as_bare_kind_tag() {
    let s = serde_json::to_string(&AuthStatus::Authenticated).unwrap();
    assert_eq!(s, "{\"kind\":\"authenticated\"}");
}

#[test]
fn pending_uses_snake_case_kind_tag() {
    let pending = AuthStatus::Pending {
        user_code: "ABCD-1234".into(),
        verification_uri: "https://example".into(),
        verification_uri_complete: "https://example?u=ABCD".into(),
        expires_at_ms: 1_700_000_000_000,
    };
    let s = serde_json::to_string(&pending).unwrap();
    assert!(s.contains("\"kind\":\"pending\""));
    assert!(s.contains("\"user_code\":\"ABCD-1234\""));
    assert!(s.contains("\"expires_at_ms\":1700000000000"));
}

#[test]
fn error_carries_code_and_message() {
    let err = AuthStatus::Error {
        code: "access_denied".into(),
        message: "denied by user".into(),
    };
    let s = serde_json::to_string(&err).unwrap();
    assert!(s.contains("\"kind\":\"error\""));
    assert!(s.contains("\"code\":\"access_denied\""));
    assert!(s.contains("\"message\":\"denied by user\""));
}

#[test]
fn idle_and_authenticated_round_trip() {
    match deserialize_status("{\"kind\":\"idle\"}") {
        AuthStatus::Idle => {}
        other => panic!("expected Idle, got {other:?}"),
    }
    match deserialize_status("{\"kind\":\"authenticated\"}") {
        AuthStatus::Authenticated => {}
        other => panic!("expected Authenticated, got {other:?}"),
    }
}

#[test]
fn start_response_round_trip() {
    let r = AuthStartResponse {
        user_code: "ABCD-1234".into(),
        verification_uri: "https://example".into(),
        verification_uri_complete: "https://example?u=ABCD-1234".into(),
        expires_in: 900,
        interval: 5,
    };
    let s = serde_json::to_string(&r).unwrap();
    let back: AuthStartResponse = serde_json::from_str(&s).unwrap();
    assert_eq!(back.user_code, r.user_code);
    assert_eq!(back.expires_in, r.expires_in);
    assert_eq!(back.interval, r.interval);
}
