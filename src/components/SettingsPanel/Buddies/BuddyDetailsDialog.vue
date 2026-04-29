<script setup lang="ts">
/*
 * BuddyDetailsDialog — per-buddy edit / activate modal.
 *
 * UI shell restored after the remote-API strip. The old `useBuddyStore` +
 * `useSettingsStageModel` + SSE wiring is gone; this file now works against
 * the Rust-side `BuddyDisplayInfo` stub plus locally-default placeholder
 * fields (birthday, level, xp, traits, race meta). Save / Activate are
 * no-ops that surface a "not wired yet" banner so the visual flow stays
 * testable while the new API is rebuilt.
 *
 * Template and styles are preserved verbatim from the pre-strip version.
 */

import { computed, reactive, ref, watch } from 'vue'

import type { BuddyDisplayInfo } from '../../../ipc/bindings'
import { tBuddy } from '../../../locales'
import {
  validateWakeTerm,
  wakeTermLength,
  wakeTermLimits,
} from '../../../utils/wake-word'

type BuddyStage = 'egg' | 'juvenile' | 'adult' | 'metamorphosis'
type BuddyGender = 'unknown' | 'male' | 'female'

// Placeholder shape mirroring the old `Buddy` store type. The restored
// template reads these fields; real values land once the rebuild wires a
// richer `BuddyDisplayInfo` (or a successor type) from Rust.
interface BuddyShell {
  id: string
  name: string
  emotion: string
  avatar: string | null
  nicknames: string[] | null
  birthday: string | null
  gender: BuddyGender
  raceCode: string
  stage: BuddyStage
  level: number
  xp: number
  totalInteractions: number
  attributes: Record<string, unknown>
  genericTraitCodes: string[]
  categoryTraitCode: string | null
  attributeTraitCode: string | null
  raceTraitCode: string | null
  race: {
    description: string | null
    source: string | null
    category: string | null
    attribute: string | null
  } | null
  isActive: boolean
}

const props = defineProps<{
  modelValue: boolean
  buddyId: string | null
  buddies: BuddyDisplayInfo[]
}>()

const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void }>()

const open = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
})

function toShell(info: BuddyDisplayInfo | undefined): BuddyShell | undefined {
  if (!info) return undefined
  return {
    id: info.id,
    name: info.name,
    emotion: info.emotion,
    avatar: null,
    nicknames: null,
    birthday: null,
    gender: 'unknown',
    raceCode: 'egg',
    stage: 'egg',
    level: 1,
    xp: 0,
    totalInteractions: 0,
    attributes: {},
    genericTraitCodes: [],
    categoryTraitCode: null,
    attributeTraitCode: null,
    raceTraitCode: null,
    race: null,
    isActive: true,
  }
}

const buddy = computed<BuddyShell | undefined>(() =>
  toShell(props.buddies.find(b => b.id === props.buddyId)),
)
const isActive = computed(() => buddy.value?.isActive ?? false)
// The other `view` flags (avatar URL, advanced editor, gender edit) used to
// be browser-dev escape hatches and stay hidden in the streamlined Tauri UI.
const view = {
  showAvatarUrlField: false,
  showAdvanced: false,
  canEditGender: false,
} as const

const BUDDY_STAGES: BuddyStage[] = [
  'egg',
  'juvenile',
  'adult',
  'metamorphosis',
]
const BUDDY_GENDERS: BuddyGender[] = ['unknown', 'male', 'female']
const MAX_NICKNAMES = 3

// --- Edit form state ---
interface FormState {
  name: string
  nicknamesText: string
  avatar: string

  gender: BuddyGender

  raceCode: string
  stage: BuddyStage
  level: number
  xp: number
  totalInteractions: number
  attributesText: string
  genericTraitCodesText: string
}

function emptyForm(): FormState {
  return {
    name: '',
    nicknamesText: '',
    avatar: '',
    gender: 'unknown',
    raceCode: 'egg',
    stage: 'egg',
    level: 1,
    xp: 0,
    totalInteractions: 0,
    attributesText: '{}',
    genericTraitCodesText: '[]',
  }
}

const form = reactive<FormState>(emptyForm())
const saving = ref(false)
const saveError = ref<string | null>(null)

function fillFormFrom(b: BuddyShell) {
  form.name = b.name
  form.nicknamesText = (b.nicknames ?? []).join(', ')
  form.avatar = b.avatar ?? ''
  form.gender = b.gender
  form.raceCode = b.raceCode
  form.stage = b.stage
  form.level = b.level
  form.xp = b.xp
  form.totalInteractions = b.totalInteractions
  form.attributesText = JSON.stringify(b.attributes ?? {}, null, 2)
  form.genericTraitCodesText = JSON.stringify(
    b.genericTraitCodes ?? [],
    null,
    2,
  )
  saveError.value = null
}

watch(
  () => [props.modelValue, props.buddyId, buddy.value] as const,
  ([isOpen, _id, b]) => {
    if (isOpen && b) fillFormFrom(b)
  },
  { immediate: true },
)

const avatarSrc = computed(() => form.avatar || buddy.value?.avatar || '')

// Wake-term limits are language-aware (see utils/wake-word.ts):
// CJK text 2–8 chars, Latin text 4–16 chars. We still pin a hard HTML
// `maxlength` at 16 because it's the larger of the two; the validator
// below enforces the real bound by code-point count.
const NICKNAME_HTML_MAXLENGTH = 16

const WAKE_TERM_HINT = 'Use 2–8 Chinese characters or 4–16 English characters.'

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

const raceLabel = computed(() => tBuddy('race', buddy.value?.raceCode))
const stageLabel = computed(() => tBuddy('stage', buddy.value?.stage))
const genderLabel = computed(() => tBuddy('gender', buddy.value?.gender))
const categoryLabel = computed(() =>
  tBuddy('category', buddy.value?.race?.category),
)
const attributeLabel = computed(() =>
  tBuddy('attribute', buddy.value?.race?.attribute),
)

const raceDescription = computed<string | null>(
  () => buddy.value?.race?.description ?? null,
)
const raceSource = computed<string | null>(
  () => buddy.value?.race?.source ?? null,
)
const raceSourceIsUrl = computed(() => {
  const src = raceSource.value
  if (!src) return false
  return /^https?:\/\//i.test(src)
})

const traitChips = computed<string[]>(() => {
  const b = buddy.value
  if (!b) return []
  return [
    b.categoryTraitCode,
    b.attributeTraitCode,
    b.raceTraitCode,
    ...b.genericTraitCodes,
  ].filter((code): code is string => Boolean(code))
})

const birthdayDisplay = computed(() => {
  const raw = buddy.value?.birthday
  if (!raw) return null
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
})

function save() {
  // No-op until the new backend API is wired up. Surface a banner so the
  // UI flow is still exercisable in dev.
  saveError.value = 'Saving is disabled until the new backend API is wired up.'
}

function cancel() {
  if (buddy.value) fillFormFrom(buddy.value)
  open.value = false
}

function onOverlayClick(e: MouseEvent) {
  if (e.target === e.currentTarget) cancel()
}

const activating = ref(false)

function setActive() {
  saveError.value = 'Activation is disabled until the new backend API is wired up.'
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
              <img
                v-if="avatarSrc"
                :src="avatarSrc"
                :alt="buddy.name"
                class="tauri-avatar-img"
              >
              <div
                v-else
                class="tauri-avatar-img tauri-avatar-placeholder"
              >
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
                  <span class="nickname-hint">Wake words · 2–8 中文 / 4–16 English</span>
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
                  v-if="birthdayDisplay"
                  class="meta-item"
                  :title="buddy.birthday ?? undefined"
                >
                  <span class="meta-label">Birthday:</span>
                  <span class="meta-value">{{ birthdayDisplay }}</span>
                </div>
                <div class="meta-item">
                  <span class="meta-label">Gender:</span>
                  <select
                    v-if="view.canEditGender"
                    v-model="form.gender"
                    class="meta-select"
                  >
                    <option
                      v-for="g in BUDDY_GENDERS"
                      :key="g"
                      :value="g"
                    >
                      {{ tBuddy('gender', g) }}
                    </option>
                  </select>
                  <span
                    v-else
                    class="meta-value"
                  >{{ genderLabel }}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Body -->
          <div class="details-body">
            <!-- Read-only stats -->
            <div class="stats stats-6">
              <div class="stat">
                <span class="stat-value">{{ raceLabel || '—' }}</span>
                <span class="stat-label">Race</span>
              </div>
              <div class="stat">
                <span class="stat-value">{{ categoryLabel || '—' }}</span>
                <span class="stat-label">Category</span>
              </div>
              <div class="stat">
                <span class="stat-value">{{ attributeLabel || '—' }}</span>
                <span class="stat-label">Attribute</span>
              </div>
              <div class="stat">
                <span class="stat-value">{{ stageLabel || '—' }}</span>
                <span class="stat-label">Evolution</span>
              </div>
              <div class="stat">
                <span class="stat-value">{{ buddy.level }}</span>
                <span class="stat-label">Level</span>
              </div>
              <div class="stat">
                <span class="stat-value">{{ buddy.xp }}</span>
                <span class="stat-label">XP</span>
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
                  v-for="(code, idx) in traitChips"
                  :key="`${code}-${idx}`"
                  class="keyword-chip"
                  :title="code"
                >
                  {{ tBuddy('trait', code) }}
                </span>
              </div>
              <p
                v-else
                class="section-text read-only-value"
              >
                —
              </p>
            </section>

            <!-- Avatar URL (dev) -->
            <section
              v-if="view.showAvatarUrlField"
              class="section"
            >
              <div class="field">
                <label
                  class="section-title"
                  for="buddy-avatar"
                >Avatar URL</label>
                <input
                  id="buddy-avatar"
                  v-model="form.avatar"
                  type="url"
                  class="section-input"
                  placeholder="https://..."
                >
              </div>
            </section>

            <!-- Advanced (dev-only) -->
            <section
              v-if="view.showAdvanced"
              class="section advanced"
            >
              <div class="advanced-header">
                <h3 class="section-title">
                  Advanced
                </h3>
                <span class="advanced-pill">dev</span>
              </div>
              <div class="field-grid">
                <div class="field">
                  <label
                    class="section-title"
                    for="buddy-race-code"
                  >Race code</label>
                  <input
                    id="buddy-race-code"
                    v-model="form.raceCode"
                    type="text"
                    class="section-input"
                    maxlength="50"
                  >
                </div>
                <div class="field">
                  <label
                    class="section-title"
                    for="buddy-stage"
                  >Stage</label>
                  <select
                    id="buddy-stage"
                    v-model="form.stage"
                    class="section-input"
                  >
                    <option
                      v-for="s in BUDDY_STAGES"
                      :key="s"
                      :value="s"
                    >
                      {{ tBuddy('stage', s) }}
                    </option>
                  </select>
                </div>
                <div class="field">
                  <label
                    class="section-title"
                    for="buddy-level"
                  >Level</label>
                  <input
                    id="buddy-level"
                    v-model.number="form.level"
                    type="number"
                    min="1"
                    class="section-input"
                  >
                </div>
                <div class="field">
                  <label
                    class="section-title"
                    for="buddy-xp"
                  >XP</label>
                  <input
                    id="buddy-xp"
                    v-model.number="form.xp"
                    type="number"
                    min="0"
                    class="section-input"
                  >
                </div>
                <div class="field">
                  <label
                    class="section-title"
                    for="buddy-interactions"
                  >Total interactions</label>
                  <input
                    id="buddy-interactions"
                    v-model.number="form.totalInteractions"
                    type="number"
                    min="0"
                    class="section-input"
                  >
                </div>
              </div>
              <div
                class="field"
                style="margin-top: 12px"
              >
                <label
                  class="section-title"
                  for="buddy-attributes"
                >Attributes (JSON)</label>
                <textarea
                  id="buddy-attributes"
                  v-model="form.attributesText"
                  class="section-textarea mono"
                  rows="3"
                />
              </div>
              <div
                class="field"
                style="margin-top: 12px"
              >
                <label
                  class="section-title"
                  for="buddy-generic-traits"
                >Generic trait codes (JSON array)</label>
                <textarea
                  id="buddy-generic-traits"
                  v-model="form.genericTraitCodesText"
                  class="section-textarea mono"
                  rows="3"
                />
              </div>
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
  grid-template-columns: repeat(3, 1fr);
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
  font-size: 16px;
  font-weight: 600;
  color: #e8e8e8;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
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
.section-empty {
  color: #666;
  font-style: italic;
}

.section-input,
.section-textarea {
  width: 100%;
  padding: 8px 10px;
  font-size: 14px;
  color: #ddd;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  outline: none;
  transition: all 0.15s;
  font-family: inherit;
  resize: vertical;
}
.section-input:hover,
.section-textarea:hover {
  border-color: rgba(255, 255, 255, 0.15);
}
.section-input:focus,
.section-textarea:focus {
  border-color: rgba(140, 120, 220, 0.5);
  background: rgba(255, 255, 255, 0.05);
}
.section-textarea {
  line-height: 1.55;
}
.section-textarea.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
}
select.section-input {
  appearance: none;
  background-image:
    linear-gradient(45deg, transparent 50%, #888 50%),
    linear-gradient(135deg, #888 50%, transparent 50%);
  background-position:
    calc(100% - 16px) 14px,
    calc(100% - 11px) 14px;
  background-size:
    5px 5px,
    5px 5px;
  background-repeat: no-repeat;
  padding-right: 28px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.field-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}

.advanced {
  padding: 14px;
  border-radius: 12px;
  background: rgba(255, 200, 80, 0.03);
  border: 1px dashed rgba(255, 200, 80, 0.2);
}
.advanced-header {
  display: flex;
  align-items: center;
  gap: 8px;
}
.advanced-pill {
  font-size: 9px;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 10px;
  background: rgba(255, 200, 80, 0.15);
  color: #e6c25a;
  text-transform: uppercase;
  letter-spacing: 0.08em;
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
.secondary-btn,
.ghost-btn {
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
.ghost-btn {
  background: transparent;
  color: #888;
  border: 1px solid rgba(255, 255, 255, 0.08);
}
.ghost-btn:hover:not(:disabled) {
  color: #d8c8ff;
  border-color: rgba(140, 120, 220, 0.35);
}
.ghost-btn:disabled {
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
.meta-select {
  padding: 2px 20px 2px 6px;
  font-size: 12px;
  color: #ddd;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  outline: none;
  cursor: pointer;
  font-family: inherit;
  appearance: none;
  background-image:
    linear-gradient(45deg, transparent 50%, #888 50%),
    linear-gradient(135deg, #888 50%, transparent 50%);
  background-position:
    calc(100% - 11px) 10px,
    calc(100% - 7px) 10px;
  background-size:
    4px 4px,
    4px 4px;
  background-repeat: no-repeat;
  transition: all 0.15s;
}
.meta-select:hover {
  border-color: rgba(255, 255, 255, 0.15);
}
.meta-select:focus {
  border-color: rgba(140, 120, 220, 0.5);
  background-color: rgba(255, 255, 255, 0.05);
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

.stats-4 {
  grid-template-columns: repeat(4, 1fr);
}
.stats-4 .stat-value {
  font-size: 14px;
}
.stats-6 {
  grid-template-columns: repeat(3, 1fr);
  row-gap: 12px;
}
.stats-6 .stat-value {
  font-size: 13px;
  text-align: center;
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
