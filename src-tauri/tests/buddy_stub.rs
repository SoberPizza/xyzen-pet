//! Placeholder buddy surface — asserts the stub keeps returning something the
//! Vue layer can render until the real API lands.

use buddy_lib::buddy_stub::{buddy_get_active, buddy_list};

#[test]
fn active_has_placeholder_id_and_neutral_emotion() {
    let active = buddy_get_active();
    assert_eq!(active.id, "placeholder");
    assert_eq!(active.emotion, "neutral");
    // Name is shown in the UI — keep it non-empty.
    assert!(!active.name.is_empty());
}

#[test]
fn list_contains_active_buddy() {
    let list = buddy_list();
    let active = buddy_get_active();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].id, active.id);
}
