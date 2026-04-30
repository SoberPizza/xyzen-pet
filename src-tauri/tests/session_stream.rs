//! SSE parser + wire-type coverage for `session_stream`.
//!
//! The client-side connect path (reqwest, tokio, Tauri emit) is exercised
//! in the app itself; here we focus on two things the parser and types get
//! right on their own — frame demarcation and keyword snake_case round-trip
//! against the Python server schema.

use buddy_lib::session_stream::client::{parse_sse_chunk, SessionStreamClient, SseFrame};
use buddy_lib::session_stream::types::{BuddySessionEvent, BuddyUiKeyword, BuddyVrmKeyword};

#[test]
fn url_joins_origin_with_trailing_slash() {
    let c = SessionStreamClient::new("http://localhost/".into());
    assert_eq!(c.url(), "http://localhost/xyzen/api/v1/buddy/session/events");
}

#[test]
fn url_handles_origin_without_trailing_slash() {
    let c = SessionStreamClient::new("http://localhost".into());
    assert_eq!(c.url(), "http://localhost/xyzen/api/v1/buddy/session/events");
}

#[test]
fn parse_chunk_extracts_snapshot_status_heartbeat() {
    let mut buf = String::from(
        "event: snapshot\ndata: {\"ui\":\"idle\",\"vrm\":\"idle\",\"ts\":1.0,\"meta\":{}}\n\n\
         :keepalive\n\n\
         event: status\ndata: {\"ui\":\"thinking\",\"vrm\":\"thinking\",\"ts\":2.0,\"meta\":{}}\n\n\
         event: heartbeat\ndata: {\"ts\":3.0}\n\n",
    );
    let frames = parse_sse_chunk(&mut buf);
    assert_eq!(frames.len(), 3);
    assert_eq!(frames[0].event, "snapshot");
    assert_eq!(frames[1].event, "status");
    assert_eq!(frames[2].event, "heartbeat");
    assert!(frames[0].data.contains("\"ui\":\"idle\""));
    assert!(buf.is_empty(), "buf should be fully drained");
}

#[test]
fn parse_chunk_leaves_partial_trailing_frame() {
    let mut buf = String::from("event: status\ndata: {\"ui\":\"idle\"");
    let frames = parse_sse_chunk(&mut buf);
    assert!(frames.is_empty());
    assert!(buf.starts_with("event: status"), "partial frame kept in buf");
}

#[test]
fn parse_chunk_handles_split_at_every_byte_offset() {
    // Feed one known frame byte-by-byte to simulate the TCP stream
    // chopping at arbitrary offsets. We must get exactly one frame, and
    // the final buf must be empty.
    let raw = "event: status\n\
               data: {\"ui\":\"speaking\",\"vrm\":\"speaking\",\"ts\":5.0,\"meta\":{}}\n\n";
    for split in 1..raw.len() {
        let mut buf = String::new();
        buf.push_str(&raw[..split]);
        let first = parse_sse_chunk(&mut buf);
        buf.push_str(&raw[split..]);
        let mut frames = first;
        frames.extend(parse_sse_chunk(&mut buf));
        assert_eq!(frames.len(), 1, "split at {split}: {frames:?}");
        assert_eq!(frames[0].event, "status");
        assert!(buf.is_empty(), "split at {split}: buf={buf:?}");
    }
}

#[test]
fn parse_chunk_accepts_crlf_line_endings() {
    let mut buf = String::from(
        "event: status\r\ndata: {\"ui\":\"idle\",\"ts\":1.0}\r\n\r\n",
    );
    let frames = parse_sse_chunk(&mut buf);
    assert_eq!(
        frames,
        vec![SseFrame {
            event: "status".into(),
            data: "{\"ui\":\"idle\",\"ts\":1.0}".into(),
        }]
    );
}

#[test]
fn ui_keyword_snake_case_round_trip() {
    // Exercise every variant the Python schema defines so a mismatch with
    // `BuddyUiKeyword` in session_schemas.py fails here rather than in
    // production.
    for (json, expected) in [
        ("\"idle\"", BuddyUiKeyword::Idle),
        ("\"session_started\"", BuddyUiKeyword::SessionStarted),
        ("\"session_ended\"", BuddyUiKeyword::SessionEnded),
        ("\"thinking\"", BuddyUiKeyword::Thinking),
        ("\"speaking\"", BuddyUiKeyword::Speaking),
        ("\"tool_running\"", BuddyUiKeyword::ToolRunning),
        ("\"tool_done\"", BuddyUiKeyword::ToolDone),
        ("\"disconnected\"", BuddyUiKeyword::Disconnected),
        ("\"reconnected\"", BuddyUiKeyword::Reconnected),
        ("\"error\"", BuddyUiKeyword::Error),
    ] {
        let parsed: BuddyUiKeyword = serde_json::from_str(json).unwrap();
        assert_eq!(parsed, expected);
        assert_eq!(serde_json::to_string(&parsed).unwrap(), json);
    }
}

#[test]
fn vrm_keyword_snake_case_round_trip() {
    for (json, expected) in [
        ("\"idle\"", BuddyVrmKeyword::Idle),
        ("\"listening\"", BuddyVrmKeyword::Listening),
        ("\"thinking\"", BuddyVrmKeyword::Thinking),
        ("\"speaking\"", BuddyVrmKeyword::Speaking),
        ("\"tool_using\"", BuddyVrmKeyword::ToolUsing),
        ("\"celebrating\"", BuddyVrmKeyword::Celebrating),
        ("\"confused\"", BuddyVrmKeyword::Confused),
    ] {
        let parsed: BuddyVrmKeyword = serde_json::from_str(json).unwrap();
        assert_eq!(parsed, expected);
        assert_eq!(serde_json::to_string(&parsed).unwrap(), json);
    }
}

#[test]
fn session_event_parses_full_payload() {
    // Shape matches `BuddySessionEvent.model_dump_json()` on the server.
    // `meta` is present on the wire but we drop it from the Rust mirror —
    // the deserializer still needs to accept it without erroring.
    let raw = r#"{
        "ui":"thinking",
        "vrm":"thinking",
        "session_id":"c11f0000-0000-4000-8000-000000000001",
        "topic_id":"c11f0000-0000-4000-8000-000000000002",
        "ts":1700000000.125,
        "meta":{"turn":3}
    }"#;
    let parsed: BuddySessionEvent = serde_json::from_str(raw).unwrap();
    assert_eq!(parsed.ui, Some(BuddyUiKeyword::Thinking));
    assert_eq!(parsed.vrm, Some(BuddyVrmKeyword::Thinking));
    assert_eq!(parsed.session_id.as_deref(), Some("c11f0000-0000-4000-8000-000000000001"));
    assert_eq!(parsed.topic_id.as_deref(), Some("c11f0000-0000-4000-8000-000000000002"));
    assert!((parsed.ts - 1700000000.125).abs() < 1e-6);
}

#[test]
fn session_event_parses_nulls() {
    // `status` frames may null out one surface when only the other
    // changes; `snapshot` always populates both but the schema permits
    // nulls, so we test the loosest shape the server can emit.
    let raw = r#"{"ui":null,"vrm":"listening","session_id":null,"topic_id":null,"ts":0.0}"#;
    let parsed: BuddySessionEvent = serde_json::from_str(raw).unwrap();
    assert!(parsed.ui.is_none());
    assert_eq!(parsed.vrm, Some(BuddyVrmKeyword::Listening));
    assert!(parsed.session_id.is_none());
    assert!(parsed.topic_id.is_none());
}
