//! `AuthClient` URL layout + response struct shapes.
//!
//! We stop short of spinning up an HTTP mock server; the poll-loop logic
//! that actually calls the client is covered by the inline test for
//! `oauth_message` and by the response-shape checks here.

use buddy_lib::auth::client::{
    AuthClient, AuthorizeResponse, TokenResponse, DEFAULT_SCOPE, DEVICE_CODE_GRANT,
};

#[test]
fn url_joins_origin_and_prefix_with_trailing_slash() {
    let c = AuthClient::new("http://localhost/".into());
    assert_eq!(
        c.url("/authorize"),
        "http://localhost/xyzen/api/v1/auth/buddy/authorize"
    );
}

#[test]
fn url_handles_origin_without_trailing_slash() {
    let c = AuthClient::new("http://localhost".into());
    assert_eq!(
        c.url("/token"),
        "http://localhost/xyzen/api/v1/auth/buddy/token"
    );
}

#[test]
fn token_response_accepts_missing_refresh() {
    let raw = r#"{"access_token":"at","token_type":"Bearer"}"#;
    let parsed: TokenResponse = serde_json::from_str(raw).unwrap();
    assert_eq!(parsed.access_token, "at");
    assert!(parsed.refresh_token.is_none());
    assert_eq!(parsed.token_type, "Bearer");
}

#[test]
fn token_response_defaults_token_type_to_bearer() {
    // Server may omit `token_type`; the serde default should fill it.
    let raw = r#"{"access_token":"at"}"#;
    let parsed: TokenResponse = serde_json::from_str(raw).unwrap();
    assert_eq!(parsed.token_type, "Bearer");
}

#[test]
fn token_response_preserves_refresh_when_present() {
    let raw = r#"{"access_token":"at","refresh_token":"rt","token_type":"Bearer"}"#;
    let parsed: TokenResponse = serde_json::from_str(raw).unwrap();
    assert_eq!(parsed.refresh_token.as_deref(), Some("rt"));
}

#[test]
fn authorize_response_shape_round_trip() {
    let raw = r#"{
        "buddy_code":"dc-1234",
        "user_code":"ABCD-1234",
        "verification_uri":"https://example/device",
        "verification_uri_complete":"https://example/device?u=ABCD-1234",
        "expires_in":900,
        "interval":5
    }"#;
    let parsed: AuthorizeResponse = serde_json::from_str(raw).unwrap();
    assert_eq!(parsed.user_code, "ABCD-1234");
    assert_eq!(parsed.expires_in, 900);
    assert_eq!(parsed.interval, 5);
    assert_eq!(parsed.buddy_code, "dc-1234");
}

#[test]
fn constants_match_rfc_and_server_defaults() {
    assert_eq!(DEVICE_CODE_GRANT, "urn:ietf:params:oauth:grant-type:device_code");
    assert_eq!(DEFAULT_SCOPE, "openid profile email");
}
