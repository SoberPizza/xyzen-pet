/**
 * Settings-store keys shared between Rust and Vue.
 *
 * The canonical declarations live in Rust (e.g.
 * `src-tauri/src/buddy/cache.rs::KEY_BUDDY_CACHE`); this file mirrors
 * them so Vue components can subscribe via `useIpcSetting` without
 * hard-coding the string at every call site.
 */

/** Mirrors `crate::buddy::cache::KEY_BUDDY_CACHE`. */
export const CACHE_KEY_BUDDY_ENVELOPE = 'buddy/cache/envelope'
