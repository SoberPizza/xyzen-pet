//! Wire shape of the settings change event + store-level constants.

use buddy_lib::settings::{SettingsChanged, SETTINGS_CHANGED_EVENT, STORE_FILENAME};

#[test]
fn settings_changed_carries_key_and_optional_value() {
    let payload = SettingsChanged {
        key: "brightness".into(),
        value_json: Some("0.8".into()),
    };
    let s = serde_json::to_string(&payload).unwrap();
    assert!(s.contains("\"key\":\"brightness\""));
    assert!(s.contains("\"value_json\":\"0.8\""));
}

#[test]
fn settings_changed_encodes_deletion_as_null_value_json() {
    let payload = SettingsChanged {
        key: "brightness".into(),
        value_json: None,
    };
    let s = serde_json::to_string(&payload).unwrap();
    // Deleted keys flow as `value_json: null` so the Vue subscriber can
    // drop the cached value without a separate event name.
    assert!(s.contains("\"value_json\":null"), "expected null: {s}");
}

#[test]
fn settings_changed_round_trips() {
    let original = SettingsChanged {
        key: "settings/audio-device/input".into(),
        value_json: Some("\"default\"".into()),
    };
    let s = serde_json::to_string(&original).unwrap();
    let decoded: SettingsChanged = serde_json::from_str(&s).unwrap();
    assert_eq!(decoded.key, original.key);
    assert_eq!(decoded.value_json, original.value_json);
}

#[test]
fn store_filename_is_stable() {
    // `tauri-plugin-store` keys files by this name — any change is a
    // migration event.
    assert_eq!(STORE_FILENAME, "settings.json");
}

#[test]
fn event_name_is_stable() {
    // Hard-coded in TS listeners under src/ipc/client.ts — break it and
    // the Vue stores stop receiving invalidations.
    assert_eq!(SETTINGS_CHANGED_EVENT, "settings://changed");
}
