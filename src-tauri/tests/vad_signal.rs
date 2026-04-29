//! Wire shape of `VadSignal` — the enum that crosses from the inference
//! task into `ipc/vad_cmd.rs`.

use buddy_lib::vad::worker::VadSignal;

#[test]
fn serializes_frame_with_is_speech_field() {
    let s = serde_json::to_string(&VadSignal::Frame { is_speech: 0.42 }).unwrap();
    assert!(s.contains("\"Frame\""), "expected tagged variant: {s}");
    assert!(s.contains("\"is_speech\""));
    assert!(s.contains("0.42"));
}

#[test]
fn serializes_error_with_message_field() {
    let s = serde_json::to_string(&VadSignal::Error {
        message: "boom".into(),
    })
    .unwrap();
    assert!(s.contains("\"Error\""));
    assert!(s.contains("\"boom\""));
}

#[test]
fn speech_start_and_end_are_unit_variants() {
    let start = serde_json::to_string(&VadSignal::SpeechStart).unwrap();
    let end = serde_json::to_string(&VadSignal::SpeechEnd).unwrap();
    assert_eq!(start, "\"SpeechStart\"");
    assert_eq!(end, "\"SpeechEnd\"");
}

#[test]
fn ready_is_unit_variant() {
    assert_eq!(serde_json::to_string(&VadSignal::Ready).unwrap(), "\"Ready\"");
}
