//! Silero VAD v5 ONNX wrapper.
//!
//! The model expects a 512-sample Float32 window at 16 kHz plus a `state`
//! tensor of shape [2, 1, 128] (LSTM h+c) that must be carried across calls.
//! The `sr` input is a scalar. Output is a probability in [0, 1] indicating
//! speech presence in the window; `stateN` is the updated state tensor.

use std::path::Path;

use ort::session::{builder::GraphOptimizationLevel, Session};
use ort::value::Tensor;

const SAMPLE_RATE: i64 = 16_000;
/// Silero v5 fixed window length — anything shorter is zero-padded by the
/// caller. 512 samples = 32 ms @ 16 kHz.
pub const WINDOW_SAMPLES: usize = 512;

pub struct Silero {
    session: Session,
    // Flat LSTM state — [2, 1, 128] → 256 floats, zeroed at start.
    state: Vec<f32>,
}

const STATE_SHAPE: [usize; 3] = [2, 1, 128];
const STATE_LEN: usize = 2 * 128;

impl Silero {
    pub fn load(model_path: &Path) -> Result<Self, String> {
        let session = Session::builder()
            .map_err(|e| format!("ort builder: {e}"))?
            .with_optimization_level(GraphOptimizationLevel::Level3)
            .map_err(|e| format!("ort opt level: {e}"))?
            .with_intra_threads(1)
            .map_err(|e| format!("ort threads: {e}"))?
            .commit_from_file(model_path)
            .map_err(|e| format!("ort load: {e}"))?;

        Ok(Self {
            session,
            state: vec![0.0; STATE_LEN],
        })
    }

    /// Reset the LSTM state. Useful between speech segments.
    pub fn reset(&mut self) {
        for s in &mut self.state {
            *s = 0.0;
        }
    }

    /// Run one inference pass. `samples` must be exactly `WINDOW_SAMPLES` long.
    pub fn infer(&mut self, samples: &[f32]) -> Result<f32, String> {
        if samples.len() != WINDOW_SAMPLES {
            return Err(format!(
                "expected {WINDOW_SAMPLES}-sample window, got {}",
                samples.len()
            ));
        }

        let input = Tensor::from_array(([1usize, WINDOW_SAMPLES], samples.to_vec()))
            .map_err(|e| e.to_string())?;
        let state = Tensor::from_array((STATE_SHAPE, self.state.clone()))
            .map_err(|e| e.to_string())?;
        let sr = Tensor::from_array(([1usize], vec![SAMPLE_RATE]))
            .map_err(|e| e.to_string())?;

        let inputs = ort::inputs![
            "input" => input,
            "state" => state,
            "sr" => sr,
        ];

        let outputs = self
            .session
            .run(inputs)
            .map_err(|e| format!("ort run: {e}"))?;

        let output = outputs
            .get("output")
            .ok_or_else(|| "missing output tensor".to_string())?;
        let (_shape, data) = output
            .try_extract_tensor::<f32>()
            .map_err(|e| format!("extract output: {e}"))?;
        let prob = *data.first().ok_or_else(|| "empty output".to_string())?;

        // Persist the new LSTM state for next frame.
        let state_out = outputs
            .get("stateN")
            .ok_or_else(|| "missing stateN tensor".to_string())?;
        let (_s, state_data) = state_out
            .try_extract_tensor::<f32>()
            .map_err(|e| format!("extract state: {e}"))?;
        if state_data.len() == self.state.len() {
            self.state.copy_from_slice(state_data);
        }

        Ok(prob)
    }
}
