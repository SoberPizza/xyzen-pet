// Variants light up as each port lands.
#![allow(dead_code)]

use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("http: {0}")]
    Http(String),
    #[error("ws: {0}")]
    Ws(String),
    #[error("sse: {0}")]
    Sse(String),
    #[error("vad: {0}")]
    Vad(String),
    #[error("auth: {0}")]
    Auth(String),
    #[error("state: {0}")]
    State(String),
    #[error("{0}")]
    Other(String),
}

impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
