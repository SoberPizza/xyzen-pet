//! Silero load error path.
//!
//! We don't exercise `infer()` here — that requires the packaged ONNX model
//! and would turn this suite into an integration test. What we can pin down
//! without dragging in the model is that a missing path yields a sane
//! error instead of panicking.
//!
//! Gated to the `ort-download` feature: under `ort-dynamic` (Pi builds),
//! `ort` panics at session-builder time when it can't dlopen
//! `libonnxruntime.so`, which defeats the error-propagation check. Run as:
//!     cargo test --manifest-path src-tauri/Cargo.toml
//! (the default feature set bundles a desktop onnxruntime binary).

#![cfg(feature = "ort-download")]

use buddy_lib::vad::silero::Silero;
use tempfile::TempDir;

#[test]
fn load_returns_error_for_missing_file() {
    let dir = TempDir::new().expect("tempdir");
    let missing = dir.path().join("does_not_exist.onnx");
    let err = match Silero::load(&missing) {
        Ok(_) => panic!("expected error for missing model"),
        Err(e) => e,
    };
    // Error message bubbled up from `ort::session::Session::builder().commit_from_file`.
    assert!(
        err.to_lowercase().contains("load") || err.contains("ort"),
        "unexpected error: {err}"
    );
}
