//! Smoke coverage for the buddy-info IPC surface.
//!
//! These don't hit the network — they just assert the wire-format
//! contract the Vue side depends on (lowercase enum strings, tagged
//! error enum, envelope with defaulting nulls).

use buddy_lib::buddy::types::{
    BuddyAttribute, BuddyEnvelope, BuddyError, BuddyGender, BuddyStage, BuddyTraitKind,
};

#[test]
fn attribute_serialises_lowercase_for_fastapi_enum_parity() {
    assert_eq!(
        serde_json::to_string(&BuddyAttribute::Mountain).unwrap(),
        "\"mountain\""
    );
}

#[test]
fn gender_accepts_neutral() {
    let g: BuddyGender = serde_json::from_str("\"neutral\"").unwrap();
    assert!(matches!(g, BuddyGender::Neutral));
}

#[test]
fn stage_roundtrip() {
    for s in [BuddyStage::Infant, BuddyStage::Mature, BuddyStage::Elder] {
        let json = serde_json::to_string(&s).unwrap();
        let back: BuddyStage = serde_json::from_str(&json).unwrap();
        assert_eq!(s, back);
    }
}

#[test]
fn trait_kind_matches_python_strenum() {
    assert_eq!(
        serde_json::to_string(&BuddyTraitKind::Generic).unwrap(),
        "\"generic\""
    );
}

#[test]
fn empty_envelope_parses_like_backend_returns_for_new_user() {
    // `get_my_buddy` returns `BuddyEnvelope()` (all defaults) when the
    // user hasn't onboarded — the Vue side branches on `buddy == null`.
    let env: BuddyEnvelope = serde_json::from_str("{}").unwrap();
    assert!(env.buddy.is_none());
    assert!(env.race.is_none());
    assert!(env.traits.attribute.is_none());
    assert!(env.traits.generic.is_empty());
}

#[test]
fn error_tag_shape_matches_auth_status_convention() {
    let e = BuddyError::Server {
        status: 503,
        message: "upstream".into(),
    };
    let s = serde_json::to_string(&e).unwrap();
    assert!(s.contains("\"kind\":\"server\""));
    assert!(s.contains("\"status\":503"));
    assert!(s.contains("\"message\":\"upstream\""));
}

#[test]
fn unauthenticated_has_no_payload() {
    let s = serde_json::to_string(&BuddyError::Unauthenticated).unwrap();
    assert_eq!(s, "{\"kind\":\"unauthenticated\"}");
}
