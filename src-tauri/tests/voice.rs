//! `VoiceState` wire shape + the DTOs attached to voice commands.

use buddy_lib::voice::session::{VoiceStartOpts, VoiceState, VoiceStateChanged};

fn json(s: VoiceState) -> String {
    serde_json::to_string(&s).unwrap()
}

#[test]
fn voice_state_serializes_in_kebab_case() {
    assert_eq!(json(VoiceState::Idle), "\"idle\"");
    assert_eq!(json(VoiceState::Listening), "\"listening\"");
    assert_eq!(json(VoiceState::Preroll), "\"preroll\"");
    assert_eq!(json(VoiceState::Speaking), "\"speaking\"");
    assert_eq!(json(VoiceState::BargeIn), "\"barge-in\"");
    assert_eq!(json(VoiceState::Standby), "\"standby\"");
}

#[test]
fn voice_state_round_trips() {
    for s in [
        VoiceState::Idle,
        VoiceState::Listening,
        VoiceState::Preroll,
        VoiceState::Speaking,
        VoiceState::BargeIn,
        VoiceState::Standby,
    ] {
        let encoded = serde_json::to_string(&s).unwrap();
        let decoded: VoiceState = serde_json::from_str(&encoded).unwrap();
        assert_eq!(decoded, s);
    }
}

#[test]
fn voice_start_opts_shape() {
    let raw = r#"{"buddy_id":"placeholder"}"#;
    let parsed: VoiceStartOpts = serde_json::from_str(raw).unwrap();
    assert_eq!(parsed.buddy_id, "placeholder");
}

#[test]
fn voice_state_changed_carries_session_id_and_state() {
    let payload = VoiceStateChanged {
        session_id: "voice-42".into(),
        state: VoiceState::BargeIn,
    };
    let s = serde_json::to_string(&payload).unwrap();
    assert!(s.contains("\"session_id\":\"voice-42\""));
    assert!(s.contains("\"state\":\"barge-in\""));
}
