//! PCM16 LE → normalized f32 conversion.

use buddy_lib::vad::worker::decode_pcm16;

#[test]
fn decodes_little_endian_sample() {
    // i16::MAX = 0x7FFF = [0xFF, 0x7F] little-endian.
    let bytes = [0xFFu8, 0x7F];
    let out = decode_pcm16(&bytes).expect("decode");
    assert_eq!(out.len(), 1);
    // i16::MAX / 32768 ≈ 0.99997.
    assert!((out[0] - (i16::MAX as f32 / 32_768.0)).abs() < 1e-6);
}

#[test]
fn decodes_negative_sample() {
    // i16::MIN = -32768 → -1.0 exactly.
    let bytes = [0x00u8, 0x80];
    let out = decode_pcm16(&bytes).expect("decode");
    assert_eq!(out.len(), 1);
    assert!((out[0] - -1.0).abs() < 1e-6);
}

#[test]
fn rejects_odd_length_input() {
    assert!(decode_pcm16(&[0x01u8]).is_none());
    assert!(decode_pcm16(&[0x01u8, 0x02, 0x03]).is_none());
}

#[test]
fn normalizes_within_unit_range() {
    let mut bytes = Vec::new();
    for s in [i16::MIN, -16384, 0, 16384, i16::MAX] {
        bytes.extend_from_slice(&s.to_le_bytes());
    }
    let out = decode_pcm16(&bytes).expect("decode");
    assert_eq!(out.len(), 5);
    assert!(out.iter().all(|v| (-1.0..1.0).contains(v) || *v == -1.0));
}

#[test]
fn handles_empty_input() {
    let out = decode_pcm16(&[]).expect("decode empty");
    assert!(out.is_empty());
}
