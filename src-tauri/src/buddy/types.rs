//! DTOs that mirror `service/buddy/info_api.py` one-to-one.
//!
//! Field names stay snake_case so the generated TS bindings match the
//! JSON wire format (and the style already used by `AuthStartResponse`
//! etc.). Enums serialise as lowercase strings — the FastAPI side uses
//! `StrEnum` subclasses, which is effectively the same contract.

use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum BuddyAttribute {
    Sky,
    Earth,
    Thunder,
    Wind,
    Water,
    Fire,
    Mountain,
    Marsh,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum BuddyStage {
    Infant,
    Mature,
    Elder,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum BuddyGender {
    Male,
    Female,
    Neutral,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum BuddyTraitKind {
    Attribute,
    Racial,
    Generic,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct TraitReadDTO {
    pub code: String,
    pub kind: BuddyTraitKind,
    pub name_en: String,
    pub name_zh: String,
    pub description_zh: String,
    pub description_en: String,
    pub sort_order: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct RaceReadDTO {
    pub code: String,
    pub name_en: String,
    pub name_zh: String,
    pub default_attribute: BuddyAttribute,
    pub source_text: String,
    pub description_zh: String,
    pub description_en: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, Type)]
pub struct BuddyExpandedTraits {
    #[serde(default)]
    pub attribute: Option<TraitReadDTO>,
    #[serde(default)]
    pub racial: Option<TraitReadDTO>,
    #[serde(default)]
    pub generic: Vec<TraitReadDTO>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct BuddyCoreDTO {
    pub id: String,
    pub user_id: String,
    pub name: String,
    pub race_code: String,
    pub attribute: BuddyAttribute,
    pub gender: BuddyGender,
    pub stage: BuddyStage,
    pub vrm_model: String,
    pub trait_codes: Vec<String>,
    pub bonding_level: i32,
    pub bonding_points: i32,
    pub hatched_at: Option<String>,
    pub is_active: bool,
    // `extra_metadata` intentionally omitted: the backend returns it as a
    // free-form JSON object, but no panel consumes it and committing a
    // shape here would de-facto lock the server schema. Serde's default
    // `deny_unknown_fields` is off, so the field is silently dropped on
    // deserialise.
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, Type)]
pub struct BuddyEnvelope {
    #[serde(default)]
    pub buddy: Option<BuddyCoreDTO>,
    #[serde(default)]
    pub race: Option<RaceReadDTO>,
    #[serde(default)]
    pub traits: BuddyExpandedTraits,
}

/// Typed error surface. Mirrors `AuthStatus`'s `#[serde(tag = "kind")]`
/// convention so the Vue side has one mental model for "typed enum
/// coming from Rust".
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum BuddyError {
    /// No access token in the settings store — user hasn't run the
    /// device-code flow yet.
    Unauthenticated,
    /// Server returned 401 — token exists but is no longer accepted.
    Unauthorized,
    /// Server returned 404 — buddy id doesn't exist or isn't owned by us.
    NotFound,
    /// Server returned 409 — only surfaces if/when `buddy_create` is
    /// wired up; kept here so the enum matches the server contract.
    Conflict { message: String },
    /// Server returned 422 — usually a validation failure on a field
    /// like `name` length.
    Validation { message: String },
    /// Any other non-2xx status.
    Server { status: u16, message: String },
    /// Network error, DNS failure, TLS, JSON parse, etc.
    Transport { message: String },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn attribute_serialises_lowercase() {
        assert_eq!(
            serde_json::to_string(&BuddyAttribute::Thunder).unwrap(),
            "\"thunder\""
        );
    }

    #[test]
    fn stage_deserialises_lowercase() {
        let s: BuddyStage = serde_json::from_str("\"mature\"").unwrap();
        assert_eq!(s, BuddyStage::Mature);
    }

    #[test]
    fn empty_envelope_parses() {
        let env: BuddyEnvelope = serde_json::from_str("{}").unwrap();
        assert!(env.buddy.is_none());
        assert!(env.race.is_none());
        assert!(env.traits.generic.is_empty());
    }

    #[test]
    fn empty_buddy_null_envelope_parses() {
        let raw = r#"{"buddy":null,"race":null,"traits":{"attribute":null,"racial":null,"generic":[]}}"#;
        let env: BuddyEnvelope = serde_json::from_str(raw).unwrap();
        assert!(env.buddy.is_none());
        assert!(env.race.is_none());
        assert!(env.traits.attribute.is_none());
    }

    #[test]
    fn error_tag_roundtrips() {
        let e = BuddyError::Validation {
            message: "name too long".into(),
        };
        let s = serde_json::to_string(&e).unwrap();
        assert!(s.contains("\"kind\":\"validation\""));
        assert!(s.contains("\"message\":\"name too long\""));
    }
}
