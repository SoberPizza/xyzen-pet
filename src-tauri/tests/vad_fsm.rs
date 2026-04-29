//! VAD hysteresis FSM behaviour.
//!
//! These tests drive the pure `VadFsm` with synthetic probability sequences;
//! the ONNX side of the pipeline is deliberately not exercised here — see
//! `silero.rs` for the load-path coverage.

use buddy_lib::vad::worker::{FsmAction, VadFsm};

const WINDOW_MS: u64 = 20;

/// Drain the FSM for `n` windows at a constant probability, returning every
/// emitted action.
fn drive(fsm: &mut VadFsm, prob: f32, n: usize) -> Vec<FsmAction> {
    (0..n).map(|_| fsm.feed(prob, WINDOW_MS)).collect()
}

#[test]
fn idle_stays_idle_below_positive_threshold() {
    let mut fsm = VadFsm::new();
    let actions = drive(&mut fsm, 0.5, 50);
    assert!(actions.iter().all(|a| *a == FsmAction::Continue));
}

#[test]
fn single_high_window_emits_speech_start() {
    let mut fsm = VadFsm::new();
    assert_eq!(fsm.feed(0.9, WINDOW_MS), FsmAction::SpeechStart);
}

#[test]
fn sustained_speech_then_silence_emits_speech_end() {
    let mut fsm = VadFsm::new();
    // 40 × 20ms = 800ms > MIN_SPEECH_MS (560ms).
    let mut actions = drive(&mut fsm, 0.9, 40);
    actions.extend(drive(&mut fsm, 0.1, VadFsm::REDEMPTION_FRAMES as usize));

    assert_eq!(actions[0], FsmAction::SpeechStart);
    assert_eq!(*actions.last().unwrap(), FsmAction::SpeechEnd);
    // No SpeechEnd or Misfire before the redemption threshold is hit.
    assert!(
        actions[1..actions.len() - 1]
            .iter()
            .all(|a| *a == FsmAction::Continue),
        "unexpected action during sustained speech + partial silence: {actions:?}"
    );
}

#[test]
fn short_burst_emits_misfire_not_speech_end() {
    let mut fsm = VadFsm::new();
    // 5 × 20ms = 100ms < MIN_SPEECH_MS.
    let mut actions = drive(&mut fsm, 0.9, 5);
    actions.extend(drive(&mut fsm, 0.1, VadFsm::REDEMPTION_FRAMES as usize));

    assert_eq!(actions[0], FsmAction::SpeechStart);
    assert_eq!(*actions.last().unwrap(), FsmAction::Misfire);
    assert!(
        !actions.contains(&FsmAction::SpeechEnd),
        "short burst must not produce SpeechEnd: {actions:?}"
    );
}

#[test]
fn quiet_streak_resets_on_non_negative_window() {
    let mut fsm = VadFsm::new();
    drive(&mut fsm, 0.9, 40); // enter speech + accumulate 800ms.
    drive(&mut fsm, 0.1, 4); // 4 quiet frames — below redemption threshold.
    // A single high window must reset the streak.
    assert_eq!(fsm.feed(0.9, WINDOW_MS), FsmAction::Continue);
    // 7 more quiet frames are still one short of redemption.
    let after = drive(&mut fsm, 0.1, 7);
    assert!(after.iter().all(|a| *a == FsmAction::Continue));
    // The 8th quiet frame trips redemption and emits SpeechEnd.
    assert_eq!(fsm.feed(0.1, WINDOW_MS), FsmAction::SpeechEnd);
}

#[test]
fn redemption_requires_eight_consecutive_sub_negative() {
    let mut fsm = VadFsm::new();
    drive(&mut fsm, 0.9, 40);
    // 7 sub-negative frames: no transition.
    let seven = drive(&mut fsm, 0.1, 7);
    assert!(seven.iter().all(|a| *a == FsmAction::Continue));
    // 8th sub-negative frame: redemption fires.
    assert_eq!(fsm.feed(0.1, WINDOW_MS), FsmAction::SpeechEnd);
}

#[test]
fn hysteresis_band_resets_quiet_streak() {
    // The FSM's guard is `prob < NEGATIVE_THRESHOLD` on the increment side
    // and a plain `else` on the reset side — so anything ≥ 0.40 clears the
    // quiet counter, not just windows that cross POSITIVE_THRESHOLD. This
    // is what keeps noisy-but-voiced regions from prematurely ending
    // speech, and it's load-bearing for the tuning.
    let mut fsm = VadFsm::new();
    drive(&mut fsm, 0.9, 40); // enter speech.
    drive(&mut fsm, 0.1, 7); // 7 quiet frames — one short of redemption.
    // A single mid-band window resets the quiet_streak.
    assert_eq!(fsm.feed(0.5, WINDOW_MS), FsmAction::Continue);
    // 7 more quiet frames are still below the redemption ladder.
    let seven = drive(&mut fsm, 0.1, 7);
    assert!(seven.iter().all(|a| *a == FsmAction::Continue));
    // The 8th one trips it.
    assert_eq!(fsm.feed(0.1, WINDOW_MS), FsmAction::SpeechEnd);
}

#[test]
fn misfire_resets_state_so_next_burst_triggers_speech_start_again() {
    let mut fsm = VadFsm::new();
    drive(&mut fsm, 0.9, 5); // short burst
    let tail = drive(&mut fsm, 0.1, VadFsm::REDEMPTION_FRAMES as usize);
    assert_eq!(*tail.last().unwrap(), FsmAction::Misfire);
    // New high window must re-enter from the idle state.
    assert_eq!(fsm.feed(0.9, WINDOW_MS), FsmAction::SpeechStart);
}

#[test]
fn feed_is_threshold_inclusive_on_positive_edge() {
    // Exactly POSITIVE_THRESHOLD counts as speech onset.
    let mut fsm = VadFsm::new();
    assert_eq!(
        fsm.feed(VadFsm::POSITIVE_THRESHOLD, WINDOW_MS),
        FsmAction::SpeechStart
    );
}

#[test]
fn feed_is_threshold_exclusive_on_negative_edge() {
    // Exactly NEGATIVE_THRESHOLD does NOT count toward quiet_streak —
    // the FSM uses `prob < NEGATIVE_THRESHOLD`.
    let mut fsm = VadFsm::new();
    drive(&mut fsm, 0.9, 40);
    let eight = drive(&mut fsm, VadFsm::NEGATIVE_THRESHOLD, 8);
    assert!(
        eight.iter().all(|a| *a == FsmAction::Continue),
        "at-threshold windows must not accumulate quiet_streak: {eight:?}"
    );
}
