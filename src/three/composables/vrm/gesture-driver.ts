/**
 * Gesture driver — turns `avatar://gesture` Tauri events into VRM actions.
 *
 * The Rust side emits discrete gestures (currently a stub — no emitter is
 * wired until the new remote API rebuild) and leaves all playback policy
 * to us. This module owns:
 *
 *  - A **declarative registry** mapping each gesture name to a list of
 *    primitive `GestureAction`s composed from VRM capabilities the model
 *    already exposes (expression presets, look-at pulses, arbitrary
 *    blendshape pulses, and — reserved — VRMA clip playback).
 *  - A **dispatcher** that subscribes to the `avatar://gesture` IPC
 *    event and executes the registered actions, with a per-gesture
 *    cooldown so streaming chunks with repeated keywords don't
 *    machine-gun the avatar.
 *
 * Adding a gesture is one entry in `DEFAULT_GESTURE_ACTIONS`. Unknown
 * gesture names are logged in dev and dropped.
 *
 * Frontend owns dedup/cooldown/overlap handling and the mapping between
 * canonical gesture names and concrete VRM controls; Rust owns *when* to
 * fire + the gesture vocabulary.
 */

import { onBeforeUnmount } from 'vue'

import { useIpcEvent } from '../../../ipc/client'

interface GestureTriggerPayload {
  gesture: string
  intensity?: number
  timestamp_ms?: number
}

export interface GestureTarget {
  /** Named emotion preset from `useVRMEmote` (happy/angry/sad/…). */
  setExpression: (name: string, intensity?: number) => void
  /** Pulse a look-at direction preset. */
  setLookAt: (dir: 'lookUp' | 'lookDown' | 'lookLeft' | 'lookRight', ms?: number) => void
  /** Pulse an arbitrary blendshape by name (triangle envelope). */
  pulseMorph: (name: string, peak?: number, ms?: number) => void
}

/** Primitive actions a gesture can compose. */
export type GestureAction =
  | { kind: 'expression', name: string, intensity?: number }
  | { kind: 'look', dir: 'lookUp' | 'lookDown' | 'lookLeft' | 'lookRight', ms?: number }
  | { kind: 'morph', name: string, peak?: number, ms?: number }
  // Reserved for when gesture-specific VRMA clips are authored. Registered
  // entries that use this kind are forward-compatible: the dispatcher
  // currently logs-and-drops so adding descriptors now doesn't require
  // shipping the clip infrastructure first.
  | { kind: 'clip', url: string, fadeMs?: number }

export interface GestureDescriptor {
  /** Composed primitive actions — executed in declaration order. */
  actions: readonly GestureAction[]
  /** Minimum ms between two triggers of this gesture (default 800). */
  cooldownMs?: number
}

/**
 * Default registry. Keys are `BuddyGesture` string values from the backend.
 * Kept intentionally conservative — everything here is composed from the
 * primitives the VRM already ships with, so all 20 gestures play
 * *something* even before custom VRMA clips are authored.
 *
 * When real clips land, swap a descriptor's `actions` to include a
 * `{ kind: 'clip', url: ... }` entry; the fallback primitives can stay
 * for graceful degradation on models that lack the clip.
 */
export const DEFAULT_GESTURE_ACTIONS: Readonly<Record<string, GestureDescriptor>> = {
  // ── idle ──
  look_around: { actions: [
    { kind: 'look', dir: 'lookLeft', ms: 500 },
    { kind: 'look', dir: 'lookRight', ms: 500 },
  ] },
  stretch: { actions: [
    { kind: 'expression', name: 'relaxed', intensity: 0.6 },
  ] },
  head_tilt: { actions: [
    { kind: 'look', dir: 'lookRight', ms: 700 },
  ] },
  yawn: { actions: [
    { kind: 'morph', name: 'aa', peak: 0.9, ms: 900 },
    { kind: 'expression', name: 'relaxed', intensity: 0.6 },
  ] },

  // ── listening ──
  nod: { actions: [
    { kind: 'look', dir: 'lookDown', ms: 280 },
    { kind: 'look', dir: 'lookUp', ms: 280 },
  ] },
  tilt_head_curious: { actions: [
    { kind: 'look', dir: 'lookLeft', ms: 600 },
    { kind: 'expression', name: 'surprised', intensity: 0.3 },
  ] },
  lean_in: { actions: [
    { kind: 'expression', name: 'surprised', intensity: 0.35 },
  ] },
  raise_brow: { actions: [
    { kind: 'expression', name: 'surprised', intensity: 0.5 },
  ] },

  // ── thinking ──
  think_pose: { actions: [
    { kind: 'look', dir: 'lookUp', ms: 700 },
    { kind: 'expression', name: 'neutral', intensity: 1 },
  ] },
  look_up: { actions: [
    { kind: 'look', dir: 'lookUp', ms: 650 },
  ] },
  tap_finger: { actions: [
    { kind: 'expression', name: 'neutral', intensity: 1 },
  ] },
  hum: { actions: [
    { kind: 'morph', name: 'ih', peak: 0.5, ms: 600 },
  ] },

  // ── speaking ──
  point: { actions: [
    { kind: 'look', dir: 'lookRight', ms: 400 },
    { kind: 'expression', name: 'neutral', intensity: 1 },
  ] },
  open_arms: { actions: [
    { kind: 'expression', name: 'happy', intensity: 0.5 },
  ] },
  emphasize: { actions: [
    { kind: 'expression', name: 'surprised', intensity: 0.6 },
  ] },
  shrug: { actions: [
    { kind: 'expression', name: 'neutral', intensity: 1 },
    { kind: 'morph', name: 'oh', peak: 0.4, ms: 400 },
  ] },
  wave: { actions: [
    { kind: 'expression', name: 'happy', intensity: 0.7 },
    { kind: 'look', dir: 'lookRight', ms: 350 },
  ] },
  bow: { actions: [
    { kind: 'look', dir: 'lookDown', ms: 800 },
    { kind: 'expression', name: 'relaxed', intensity: 0.6 },
  ] },
  facepalm: { actions: [
    { kind: 'expression', name: 'sad', intensity: 0.6 },
    { kind: 'look', dir: 'lookDown', ms: 500 },
  ] },
  clap: { actions: [
    { kind: 'expression', name: 'happy', intensity: 0.8 },
    { kind: 'morph', name: 'aa', peak: 0.4, ms: 220 },
  ] },

  // ── Buddy session-status VRM keywords (mirrors `BuddyVrmKeyword` in
  //    `src-tauri/src/session_stream/types.rs`, same snake_case). Composed
  //    only from `expression` + `look` primitives — mouth-open morphs are
  //    intentionally NOT fired here: real lipsync will come from the voice
  //    stream, and faking `aa` on `speaking` would desync with it. ──
  idle: { actions: [
    { kind: 'expression', name: 'neutral', intensity: 1 },
  ] },
  listening: { actions: [
    { kind: 'look', dir: 'lookDown', ms: 300 },
    { kind: 'expression', name: 'neutral', intensity: 1 },
  ] },
  thinking: { actions: [
    { kind: 'look', dir: 'lookUp', ms: 700 },
    { kind: 'expression', name: 'neutral', intensity: 1 },
  ] },
  speaking: { actions: [
    { kind: 'expression', name: 'happy', intensity: 0.55 },
  ] },
  tool_using: { actions: [
    { kind: 'look', dir: 'lookRight', ms: 600 },
    { kind: 'expression', name: 'neutral', intensity: 1 },
  ] },
  celebrating: { actions: [
    { kind: 'expression', name: 'happy', intensity: 0.85 },
  ] },
  confused: { actions: [
    { kind: 'expression', name: 'surprised', intensity: 0.65 },
    { kind: 'look', dir: 'lookDown', ms: 400 },
  ] },
  // Note: `idle` is already registered implicitly — the dispatcher drops
  // unknown gestures silently, and `idle` doesn't need an override since
  // the avatar's own idle animation reads as neutral.
}

const DEFAULT_COOLDOWN_MS = 800

export type GestureRegistry = Readonly<Record<string, GestureDescriptor>>

export interface UseVRMGestureDriverOptions {
  /** Access the current target — allow undefined while the VRM is loading. */
  target: () => GestureTarget | undefined
  /**
   * Extend / override the built-in registry. Either a static record (merged
   * once on top of `DEFAULT_GESTURE_ACTIONS`) or a getter that returns the
   * **fully-merged** registry — use the getter form when the active model's
   * per-VRM animation driver can change at runtime. When the getter returns
   * a reference-inequal registry the per-gesture cooldown map is flushed so
   * a model switch doesn't block the first gesture on the new model.
   */
  registry?: GestureRegistry | (() => GestureRegistry)
  /** Fires whenever a gesture is dispatched, for logging / analytics. */
  onDispatch?: (gesture: string, descriptor: GestureDescriptor) => void
}

/**
 * Subscribe to `XyzenGestureTrigger` and drive the VRM target. Returns
 * a manual dispatcher + registry mutation handles for tests and custom
 * overrides.
 *
 * Typical use (App.vue):
 *
 *   useVRMGestureDriver({ target: () => vrmViewerRef.value ?? undefined })
 *
 * The composable auto-unsubscribes on component unmount.
 */
export function useVRMGestureDriver(options: UseVRMGestureDriverOptions) {
  const resolveBaseRegistry: () => GestureRegistry = typeof options.registry === 'function'
    ? options.registry
    : (() => {
        const snapshot: GestureRegistry = { ...DEFAULT_GESTURE_ACTIONS, ...(options.registry ?? {}) }
        return () => snapshot
      })()

  // Runtime overrides from `register`/`unregister` live on a separate layer so
  // they survive identity changes of the base registry (dev tooling, tests).
  const overrides: Record<string, GestureDescriptor | null> = {}

  let lastBase: GestureRegistry | undefined
  let mergedDirty = true
  let merged: Record<string, GestureDescriptor> = {}
  const lastFiredAt = new Map<string, number>()

  function currentRegistry(): Readonly<Record<string, GestureDescriptor>> {
    const base = resolveBaseRegistry()
    if (base !== lastBase) {
      lastBase = base
      mergedDirty = true
      // A new base registry means a different active driver — previous
      // cooldowns are no longer meaningful for the new model.
      lastFiredAt.clear()
    }
    if (mergedDirty) {
      mergedDirty = false
      merged = { ...base }
      for (const [name, descriptor] of Object.entries(overrides)) {
        if (descriptor === null) delete merged[name]
        else merged[name] = descriptor
      }
    }
    return merged
  }

  function runAction(target: GestureTarget, action: GestureAction, intensityScale: number) {
    switch (action.kind) {
      case 'expression': {
        const scaled = (action.intensity ?? 1) * intensityScale
        target.setExpression(action.name, scaled)
        break
      }
      case 'look':
        target.setLookAt(action.dir, action.ms)
        break
      case 'morph':
        target.pulseMorph(action.name, (action.peak ?? 1) * intensityScale, action.ms)
        break
      case 'clip':
        // Reserved; see module doc. Silently no-op until the clip
        // loader is wired up — we still want registry entries to be
        // future-proof.
        if (import.meta.env.DEV)
          console.debug('[gesture-driver] clip action not yet implemented:', action.url)
        break
    }
  }

  /** Fire a gesture programmatically (bypasses the bus). Respects cooldown. */
  function dispatch(gesture: string, intensity = 1, at: number = performance.now()): boolean {
    const descriptor = currentRegistry()[gesture]
    if (!descriptor) {
      if (import.meta.env.DEV)
        console.debug('[gesture-driver] unknown gesture:', gesture)
      return false
    }
    const cooldown = descriptor.cooldownMs ?? DEFAULT_COOLDOWN_MS
    const prev = lastFiredAt.get(gesture) ?? -Infinity
    if (at - prev < cooldown) {
      if (import.meta.env.DEV)
        console.debug('[gesture-driver] cooldown block', gesture, { sinceMs: at - prev, cooldown })
      return false
    }

    const target = options.target()
    if (!target) {
      if (import.meta.env.DEV)
        console.debug('[gesture-driver] no target for', gesture)
      return false
    }

    lastFiredAt.set(gesture, at)
    const scale = Math.min(1, Math.max(0, intensity))
    for (const action of descriptor.actions) {
      try {
        runAction(target, action, scale)
      }
      catch (err) {
        console.warn('[gesture-driver] action failed', gesture, action, err)
      }
    }
    if (import.meta.env.DEV)
      console.debug('[gesture-driver] dispatched', gesture, 'actions=', descriptor.actions.length)
    options.onDispatch?.(gesture, descriptor)
    return true
  }

  useIpcEvent<GestureTriggerPayload>('avatar://gesture', (payload) => {
    const gesture = String(payload.gesture ?? '')
    if (!gesture) return
    // `timestamp_ms` is authoritative when present — lets us reconcile
    // out-of-order arrivals against the same cooldown window.
    const at = typeof payload.timestamp_ms === 'number' && payload.timestamp_ms > 0
      ? payload.timestamp_ms
      : performance.now()
    dispatch(gesture, Number(payload.intensity ?? 1), at)
  })

  // `useIpcEvent` handles teardown on scope dispose; `onBeforeUnmount` kept
  // as an explicit nudge so future additions see the pattern.
  onBeforeUnmount(() => {})

  return {
    dispatch,
    register(name: string, descriptor: GestureDescriptor) {
      overrides[name] = descriptor
      mergedDirty = true
    },
    unregister(name: string) {
      overrides[name] = null
      mergedDirty = true
    },
    /** Snapshot of current (merged) registry — base ⊕ overrides. */
    snapshot(): Readonly<Record<string, GestureDescriptor>> {
      return { ...currentRegistry() }
    },
  }
}
