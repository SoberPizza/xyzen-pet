<script setup lang="ts">
/*
 * BuddyDetailsDialog — per-buddy edit modal.
 *
 * Reads a `BuddyEnvelope` from the parent (panel has already called
 * `commands.buddyGetMe()`). Save → `buddyRename`; Activate → `buddyActivate`.
 * Gender, stage, hatched_at, race details, and trait chips are read-only
 * until the backend grows matching endpoints.
 *
 * Note: the three nickname slots are UI-only local state. The remote API
 * has no nickname field; persisting them would mean committing a schema
 * to `extra_metadata`, which we want to avoid.
 */

import { computed, reactive, ref, watch } from 'vue'

import type { BuddyError, CachedBuddyEnvelope, RaceReadDTO, TraitReadDTO } from '../../../ipc/bindings'
import { commands } from '../../../ipc/bindings'
import { tBuddy } from '../../../locales'
import {
  validateWakeTerm,
  wakeTermLength,
  wakeTermLimits,
} from '../../../utils/wake-word'

const props = defineProps<{
  modelValue: boolean
  cached: CachedBuddyEnvelope | null
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
}>()

const open = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
})

// The Rust side writes the cache on every successful mutation, and
// `useIpcSetting` in the parent panel re-reads via the
// `settings://changed` event. So the dialog never has to emit the new
// envelope — it just re-derives from the prop.
const envelope = computed(() => props.cached?.envelope ?? null)
const buddy = computed(() => envelope.value?.buddy ?? null)
const race = computed(() => envelope.value?.race ?? null)
const attributeTrait = computed<TraitReadDTO | null>(
  () => envelope.value?.traits?.attribute ?? null,
)
const raceTrait = computed<TraitReadDTO | null>(
  () => envelope.value?.traits?.racial ?? null,
)
const genericTraits = computed<TraitReadDTO[]>(
  () => envelope.value?.traits?.generic ?? [],
)

const isActive = computed(() => buddy.value?.is_active ?? false)

const localeIsZh = typeof navigator !== 'undefined'
  && (navigator.language || '').toLowerCase().startsWith('zh')

function raceName(r: RaceReadDTO | null): string {
  if (!r) return ''
  return (localeIsZh ? r.name_zh : r.name_en) || r.code
}

function raceDescriptionText(r: RaceReadDTO | null): string {
  if (!r) return ''
  return (localeIsZh ? r.description_zh : r.description_en) || ''
}

function traitLabel(t: TraitReadDTO): string {
  return (localeIsZh ? t.name_zh : t.name_en) || t.code
}

const MAX_NICKNAMES = 3
const NICKNAME_HTML_MAXLENGTH = 16
const WAKE_TERM_HINT = 'Use 2–8 Chinese characters or 4–16 English characters.'

interface FormState {
  name: string
  nicknamesText: string
}

function emptyForm(): FormState {
  return { name: '', nicknamesText: '' }
}

const form = reactive<FormState>(emptyForm())
const saving = ref(false)
const activating = ref(false)
const saveError = ref<string | null>(null)

function fillFormFrom(cached: CachedBuddyEnvelope | null) {
  const b = cached?.envelope?.buddy ?? null
  if (!b) {
    Object.assign(form, emptyForm())
    return
  }
  form.name = b.name
  form.nicknamesText = ''
  saveError.value = null
}

watch(
  () => [props.modelValue, props.cached] as const,
  ([isOpen, c]) => {
    if (isOpen) fillFormFrom(c)
  },
  { immediate: true },
)

function wakeTermError(
  raw: string,
  { allowEmpty }: { allowEmpty: boolean },
): string | null {
  if (!raw.trim()) return allowEmpty ? null : WAKE_TERM_HINT
  const result = validateWakeTerm(raw)
  if (result.ok) return null
  const { min, max } = wakeTermLimits(raw.trim())
  const len = wakeTermLength(raw.trim())
  if (result.reason === 'too-short')
    return `Need at least ${min} characters (have ${len}).`
  if (result.reason === 'too-long')
    return `Keep it under ${max} characters (have ${len}).`
  return WAKE_TERM_HINT
}

const nicknamesList = computed<string[]>(() =>
  form.nicknamesText
    .split(',')
    .map(s => s.trim())
    .filter(Boolean),
)

const nicknameSlots = reactive<string[]>(['', '', ''])

const nameError = computed(() =>
  wakeTermError(form.name, { allowEmpty: false }),
)
const nicknameErrors = computed(() =>
  nicknameSlots.map(v => wakeTermError(v, { allowEmpty: true })),
)
const wakeWordsInvalid = computed(
  () =>
    nameError.value !== null || nicknameErrors.value.some(e => e !== null),
)

watch(
  () => form.nicknamesText,
  () => {
    const parsed = nicknamesList.value
    for (let i = 0; i < MAX_NICKNAMES; i++) nicknameSlots[i] = parsed[i] ?? ''
  },
  { immediate: true },
)

function commitSlots() {
  const next = nicknameSlots.map(s => s.trim()).filter(Boolean)
  form.nicknamesText = next.join(', ')
}

const raceLabel = computed(() => raceName(race.value))
const stageLabel = computed(() => tBuddy('stage', buddy.value?.stage))
const genderLabel = computed(() => tBuddy('gender', buddy.value?.gender))
const attributeLabel = computed(() =>
  tBuddy('attribute', buddy.value?.attribute),
)

const raceDescription = computed(() => raceDescriptionText(race.value))
const raceSource = computed<string | null>(
  () => race.value?.source_text ?? null,
)
const raceSourceIsUrl = computed(() => {
  const src = raceSource.value
  if (!src) return false
  return /^https?:\/\//i.test(src)
})

const traitChips = computed<TraitReadDTO[]>(() => {
  const chips: TraitReadDTO[] = []
  if (attributeTrait.value) chips.push(attributeTrait.value)
  if (raceTrait.value) chips.push(raceTrait.value)
  for (const t of genericTraits.value) chips.push(t)
  return chips
})

const hatchedDisplay = computed(() => {
  const raw = buddy.value?.hatched_at
  if (!raw) return null
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
})

function mapError(err: BuddyError): string {
  switch (err.kind) {
    case 'unauthenticated':
      return 'Sign in on the Connection tab first.'
    case 'unauthorized':
      return 'Your session expired — please sign in again.'
    case 'not_found':
      return 'This buddy no longer exists.'
    case 'validation':
      return err.message || 'Name must be 1–64 characters.'
    case 'conflict':
      return err.message
    case 'server':
      return `Server error (${err.status}): ${err.message}`
    case 'transport':
      return err.message
  }
}

async function save() {
  const b = buddy.value
  if (!b) return
  if (wakeWordsInvalid.value) return
  if (form.name.trim() === b.name) {
    open.value = false
    return
  }
  saving.value = true
  saveError.value = null
  try {
    const result = await commands.buddyRename(b.id, form.name.trim())
    if (result.status === 'ok') {
      // Cache write fires a `settings://changed` event; `useIpcSetting`
      // in the parent panel will re-read and re-render us via the
      // `cached` prop.
      open.value = false
    } else {
      saveError.value = mapError(result.error)
    }
  } catch (err) {
    saveError.value = err instanceof Error ? err.message : String(err)
  } finally {
    saving.value = false
  }
}

function cancel() {
  fillFormFrom(props.cached)
  open.value = false
}

function onOverlayClick(e: MouseEvent) {
  if (e.target === e.currentTarget) cancel()
}

async function setActive() {
  const b = buddy.value
  if (!b) return
  activating.value = true
  saveError.value = null
  try {
    const result = await commands.buddyActivate(b.id)
    if (result.status === 'error') {
      saveError.value = mapError(result.error)
    }
    // On success the cache write propagates through `useIpcSetting`.
  } catch (err) {
    saveError.value = err instanceof Error ? err.message : String(err)
  } finally {
    activating.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="details-dialog">
      <div
        v-if="open && buddy"
        class="details-overlay"
        @click="onOverlayClick"
      >
        <div class="details-content">
          <!-- Compact header -->
          <div class="tauri-header">
            <button
              class="close-btn tauri-close-btn"
              @click="cancel"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
            <div class="tauri-avatar">
              <div class="tauri-avatar-img tauri-avatar-placeholder">
                <svg
                  width="40"
                  height="40"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.5"
                >
                  <circle
                    cx="12"
                    cy="8"
                    r="4"
                  />
                  <path d="M4 21v-1a8 8 0 0 1 16 0v1" />
                </svg>
              </div>
            </div>
            <div class="tauri-header-meta">
              <div class="identity-name-row">
                <input
                  v-model="form.name"
                  type="text"
                  class="identity-name-input"
                  :class="{ 'field-invalid': nameError }"
                  placeholder="Buddy name"
                  :maxlength="NICKNAME_HTML_MAXLENGTH"
                >
                <span
                  v-if="isActive"
                  class="identity-badge"
                >Active</span>
              </div>
              <p
                v-if="nameError"
                class="wake-error"
              >
                {{ nameError }}
              </p>
              <div class="nickname-row">
                <div class="nickname-header">
                  <label class="section-title">Nicknames</label>
                  <span class="nickname-hint">Wake words · 2–8 中文 / 4–16 English · local only</span>
                </div>
                <div class="nickname-inputs">
                  <input
                    v-for="(_, idx) in nicknameSlots"
                    :key="idx"
                    v-model="nicknameSlots[idx]"
                    type="text"
                    class="nickname-input"
                    :class="{ 'field-invalid': nicknameErrors[idx] }"
                    :maxlength="NICKNAME_HTML_MAXLENGTH"
                    :placeholder="`#${idx + 1}`"
                    @change="commitSlots"
                    @blur="commitSlots"
                  >
                </div>
                <p
                  v-if="nicknameErrors.some((e) => e !== null)"
                  class="wake-error"
                >
                  {{ nicknameErrors.find((e) => e !== null) }}
                </p>
              </div>
              <div class="meta-row">
                <div
                  v-if="hatchedDisplay"
                  class="meta-item"
                  :title="buddy.hatched_at ?? undefined"
                >
                  <span class="meta-label">Hatched:</span>
                  <span class="meta-value">{{ hatchedDisplay }}</span>
                </div>
                <div class="meta-item">
                  <span class="meta-label">Gender:</span>
                  <span class="meta-value">{{ genderLabel }}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Body -->
          <div class="details-body">
            <!-- Read-only stats -->
            <div class="stats stats-4">
              <div class="stat">
                <span class="stat-value">{{ raceLabel || '—' }}</span>
                <span class="stat-label">Race</span>
              </div>
              <div class="stat">
                <span class="stat-value">{{ attributeLabel || '—' }}</span>
                <span class="stat-label">Attribute</span>
              </div>
              <div class="stat">
                <span class="stat-value">{{ stageLabel || '—' }}</span>
                <span class="stat-label">Stage</span>
              </div>
              <div class="stat">
                <span class="stat-value">{{ buddy.bonding_level }} · {{ buddy.bonding_points }}</span>
                <span class="stat-label">Bonding</span>
              </div>
            </div>

            <!-- Error banner -->
            <div
              v-if="saveError"
              class="error-banner"
            >
              {{ saveError }}
            </div>

            <!-- Race -->
            <section
              v-if="raceDescription || raceSource"
              class="section"
            >
              <h3 class="section-title">
                Description
              </h3>
              <p class="section-text read-only-value">
                {{ raceDescription || '—' }}
              </p>
              <a
                v-if="raceSource && raceSourceIsUrl"
                class="race-source"
                :href="raceSource"
                target="_blank"
                rel="noopener noreferrer"
              >
                {{ raceSource }}
              </a>
              <p
                v-else-if="raceSource"
                class="race-source"
              >
                {{ raceSource }}
              </p>
            </section>

            <!-- Traits -->
            <section class="section">
              <h3 class="section-title">
                Traits
              </h3>
              <div
                v-if="traitChips.length"
                class="keyword-chips"
              >
                <span
                  v-for="t in traitChips"
                  :key="t.code"
                  class="keyword-chip"
                  :title="localeIsZh ? t.description_zh : t.description_en"
                >
                  {{ traitLabel(t) }}
                </span>
              </div>
              <p
                v-else
                class="section-text read-only-value"
              >
                —
              </p>
            </section>
          </div>

          <!-- Footer -->
          <div class="details-footer">
            <button
              v-if="!isActive"
              class="activate-btn"
              :disabled="activating || saving"
              @click="setActive"
            >
              {{ activating ? 'Activating…' : 'Activate' }}
            </button>
            <div class="footer-spacer" />
            <button
              class="secondary-btn"
              :disabled="saving"
              @click="cancel"
            >
              Cancel
            </button>
            <button
              class="primary-btn"
              :disabled="saving || wakeWordsInvalid"
              @click="save"
            >
              {{ saving ? 'Saving...' : 'Save' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.details-overlay {
  position: fixed;
  inset: 0;
  z-index: 210;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
}

.details-content {
  width: 90vw;
  max-width: 560px;
  max-height: 85vh;
  border-radius: 16px;
  overflow: hidden;
  background: #1a1a1e;
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.6);
  display: flex;
  flex-direction: column;
}

.close-btn {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 2;
  border-radius: 8px;
  padding: 6px;
  border: none;
  background: rgba(0, 0, 0, 0.35);
  color: #ddd;
  cursor: pointer;
  transition: all 0.2s;
  backdrop-filter: blur(6px);
}
.close-btn:hover {
  color: #fff;
  background: rgba(0, 0, 0, 0.55);
}

.details-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px 24px 20px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.details-body::-webkit-scrollbar {
  width: 6px;
}
.details-body::-webkit-scrollbar-track {
  background: transparent;
}
.details-body::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.08);
  border-radius: 3px;
}

.identity-name-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.identity-name-input {
  flex: 1;
  margin: 0;
  padding: 4px 8px;
  font-size: 22px;
  font-weight: 700;
  color: #f0f0f0;
  letter-spacing: -0.01em;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 8px;
  outline: none;
  transition: all 0.15s;
}
.identity-name-input:hover,
.identity-name-input:focus {
  background: rgba(255, 255, 255, 0.04);
  border-color: rgba(255, 255, 255, 0.08);
}
.identity-name-input:focus {
  border-color: rgba(140, 120, 220, 0.4);
}
.identity-badge {
  font-size: 10px;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: 12px;
  background: rgba(100, 70, 200, 0.3);
  color: #b8a0ff;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  flex-shrink: 0;
}
.stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  padding: 12px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.05);
}
.stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}
.stat-value {
  font-size: 14px;
  font-weight: 600;
  color: #e8e8e8;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  text-align: center;
}
.stat-label {
  font-size: 10px;
  font-weight: 500;
  color: #777;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.error-banner {
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(220, 70, 70, 0.12);
  border: 1px solid rgba(220, 70, 70, 0.25);
  color: #f2a0a0;
  font-size: 13px;
  line-height: 1.4;
  white-space: pre-wrap;
}

.section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.section-title {
  margin: 0;
  font-size: 11px;
  font-weight: 600;
  color: #888;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.section-text {
  margin: 0;
  font-size: 14px;
  color: #ddd;
  line-height: 1.55;
  white-space: pre-wrap;
}

.details-footer {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 24px 20px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}
.footer-spacer {
  flex: 1;
}
.primary-btn,
.secondary-btn {
  border: none;
  border-radius: 10px;
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
}
.primary-btn {
  background: rgba(100, 70, 200, 0.25);
  color: #d8c8ff;
}
.primary-btn:hover:not(:disabled) {
  background: rgba(100, 70, 200, 0.45);
  color: #fff;
}
.primary-btn:disabled {
  background: rgba(255, 255, 255, 0.05);
  color: #666;
  cursor: default;
}
.secondary-btn {
  background: rgba(255, 255, 255, 0.05);
  color: #bbb;
}
.secondary-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.08);
  color: #eee;
}
.secondary-btn:disabled {
  color: #666;
  cursor: default;
}

/* --- Tauri-specific layout --- */
.tauri-header {
  position: relative;
  flex-shrink: 0;
  display: flex;
  gap: 16px;
  padding: 20px 24px 12px;
  background: linear-gradient(180deg, rgba(100, 70, 200, 0.08), transparent);
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
}
.tauri-close-btn {
  top: 12px;
  right: 12px;
}
.tauri-avatar {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}
.tauri-avatar-img {
  width: 96px;
  height: 96px;
  border-radius: 20px;
  object-fit: cover;
  object-position: center top;
  background: #1a1a1e;
  border: 2px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
}
.tauri-avatar-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #555;
}
.meta-row {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 16px;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.meta-item {
  display: flex;
  align-items: baseline;
  gap: 6px;
  color: #aaa;
}
.meta-label {
  color: #777;
  font-weight: 500;
}
.meta-value {
  color: #ddd;
}
.tauri-header-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-right: 40px;
}
.activate-btn {
  padding: 8px 16px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  border: 1px solid rgba(140, 120, 220, 0.45);
  border-radius: 10px;
  background: rgba(100, 70, 200, 0.28);
  color: #d8c8ff;
  cursor: pointer;
  transition: all 0.15s;
}
.activate-btn:hover:not(:disabled) {
  background: rgba(100, 70, 200, 0.5);
  color: #fff;
  border-color: rgba(140, 120, 220, 0.7);
}
.activate-btn:disabled {
  background: rgba(255, 255, 255, 0.04);
  border-color: rgba(255, 255, 255, 0.08);
  color: #888;
  cursor: default;
}
.nickname-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.nickname-header {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.nickname-hint {
  font-size: 10px;
  color: #666;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.nickname-inputs {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}
.race-source {
  margin: 4px 0 0;
  font-size: 11px;
  color: #888;
  text-decoration: none;
  word-break: break-all;
}
a.race-source:hover {
  color: #b8a0ff;
  text-decoration: underline;
}
.nickname-input {
  min-width: 0;
  padding: 5px 8px;
  font-size: 12px;
  color: #ddd;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  outline: none;
  transition: all 0.15s;
  font-family: inherit;
}
.nickname-input::placeholder {
  color: #555;
}
.nickname-input:hover {
  border-color: rgba(255, 255, 255, 0.15);
}
.nickname-input:focus {
  border-color: rgba(140, 120, 220, 0.5);
  background: rgba(255, 255, 255, 0.05);
}
.field-invalid {
  border-color: rgba(220, 90, 90, 0.6) !important;
}
.wake-error {
  margin: 4px 0 0;
  font-size: 11px;
  color: #e08a8a;
  line-height: 1.3;
}

.keyword-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.keyword-chip {
  display: inline-block;
  padding: 3px 10px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.06);
  color: #cfcfcf;
  font-size: 12px;
  font-weight: 500;
  line-height: 1.4;
}

.read-only-value {
  color: #cfcfcf;
}

.details-dialog-enter-active,
.details-dialog-leave-active {
  transition: all 0.25s ease;
}
.details-dialog-enter-active .details-content,
.details-dialog-leave-active .details-content {
  transition: all 0.25s ease;
}
.details-dialog-enter-from,
.details-dialog-leave-to {
  opacity: 0;
}
.details-dialog-enter-from .details-content,
.details-dialog-leave-to .details-content {
  transform: scale(0.95) translateY(10px);
  opacity: 0;
}
</style>
