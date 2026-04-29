//! Placeholder buddy information until the new remote API is wired up.
//!
//! The Vue layer only needs enough data to decide which VRM to mount and
//! what emotion to render. One hard-coded entry is plenty to validate the
//! IPC shape without blocking on backend work.

use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct BuddyDisplayInfo {
    pub id: String,
    pub name: String,
    /// Relative path served from the Vue dev/build output — the frontend
    /// already bundles a default VRM under `src/three/assets/vrm/...`.
    pub model_url: String,
    pub emotion: String,
}

fn default_buddy() -> BuddyDisplayInfo {
    BuddyDisplayInfo {
        id: "placeholder".into(),
        name: "Buddy".into(),
        model_url: "".into(),
        emotion: "neutral".into(),
    }
}

#[tauri::command]
#[specta::specta]
pub fn buddy_get_active() -> BuddyDisplayInfo {
    default_buddy()
}

#[tauri::command]
#[specta::specta]
pub fn buddy_list() -> Vec<BuddyDisplayInfo> {
    vec![default_buddy()]
}
