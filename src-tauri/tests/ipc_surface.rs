//! Smoke coverage for the IPC facade types.

use buddy_lib::ipc::{app_info, AppInfo};

#[test]
fn app_info_reports_cargo_pkg_version() {
    let info: AppInfo = app_info();
    assert_eq!(info.version, env!("CARGO_PKG_VERSION"));
    // Sanity: CARGO_PKG_VERSION is always populated and non-empty.
    assert!(!info.version.is_empty());
}
