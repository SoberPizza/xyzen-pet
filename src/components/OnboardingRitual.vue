<script setup lang="ts">
/*
 * OnboardingRitual — first-time intro + default-buddy creation.
 *
 * Shown by `App.vue` when the user is authenticated and the cached
 * buddy envelope has `buddy === null`. Walks the user through a
 * 3-page ritual (see /docs/buddy-get.md), then POSTs to
 * `/xyzen/api/v1/buddy` with `race_code: 'lihuan'` + randomized
 * gender/generic traits. Attribute follows the race's default so the
 * server-derived attribute trait is consistent with the race.
 *
 * The overlay unmounts automatically: `buddy_create` writes the fresh
 * envelope into the cache, and `useIpcSetting` in the parent flips
 * the trigger condition.
 */

import { computed, onMounted, reactive, ref, shallowRef } from 'vue'

import type {
  BuddyAttribute,
  BuddyError,
  RaceReadDTO,
  TraitReadDTO,
} from '../ipc/bindings'
import { commands } from '../ipc/bindings'
import { MAX_NICKNAMES, saveNicknames } from '../utils/nicknames'
import {
  validateWakeTerm,
  wakeTermLength,
  wakeTermLimits,
} from '../utils/wake-word'

defineProps<{ open: boolean }>()

const localeIsZh = typeof navigator !== 'undefined'
  && (navigator.language || '').toLowerCase().startsWith('zh')

const DEFAULT_RACE_CODE = 'lihuan'
const DEFAULT_ATTRIBUTE: BuddyAttribute = 'earth'
// Server enforces `MAX_GENERIC_TRAITS`; pick a modest count well under any
// reasonable cap so a future schema tighten doesn't regress us.
const GENERIC_TRAIT_MIN = 2
const GENERIC_TRAIT_MAX = 3

const page = ref<0 | 1 | 2>(0)
const submitting = ref(false)
const errorMsg = ref<string | null>(null)

interface FormState {
  name: string
  nicknames: string[]
}
const form = reactive<FormState>({
  name: '',
  nicknames: Array.from({ length: MAX_NICKNAMES }, () => ''),
})

const races = shallowRef<RaceReadDTO[]>([])
const genericTraits = shallowRef<TraitReadDTO[]>([])

onMounted(async () => {
  try {
    const [racesRes, traitsRes] = await Promise.all([
      commands.buddyListRaces(),
      commands.buddyListTraits('generic'),
    ])
    if (racesRes.status === 'ok') races.value = racesRes.data
    if (traitsRes.status === 'ok') {
      genericTraits.value = traitsRes.data.filter(t => t.kind === 'generic')
    }
  } catch {
    // Non-fatal: the fallback defaults below keep submit working offline.
  }
})

function nameErrorText(raw: string, { allowEmpty }: { allowEmpty: boolean }): string | null {
  const t = raw.trim()
  if (!t) return allowEmpty ? null : (localeIsZh ? '请给它取个名字' : 'Give it a name')
  const r = validateWakeTerm(raw)
  if (r.ok) return null
  const { min, max } = wakeTermLimits(t)
  const len = wakeTermLength(t)
  if (r.reason === 'too-short') {
    return localeIsZh
      ? `至少 ${min} 个字符（当前 ${len}）`
      : `Need at least ${min} characters (have ${len}).`
  }
  if (r.reason === 'too-long') {
    return localeIsZh
      ? `最多 ${max} 个字符（当前 ${len}）`
      : `Keep it under ${max} characters (have ${len}).`
  }
  return localeIsZh
    ? '名字支持 2–8 个中文或 4–16 个英文字符'
    : 'Use 2–8 Chinese characters or 4–16 English characters.'
}

const nameError = computed(() => nameErrorText(form.name, { allowEmpty: false }))
const nicknameErrors = computed(() =>
  form.nicknames.map(n => nameErrorText(n, { allowEmpty: true })),
)
const canSubmit = computed(
  () =>
    !submitting.value
    && nameError.value === null
    && nicknameErrors.value.every(e => e === null),
)

function pickGender(): 'male' | 'female' {
  return Math.random() < 0.5 ? 'male' : 'female'
}

function pickGenericTraits(traits: TraitReadDTO[]): string[] {
  const pool = traits.filter(t => t.kind === 'generic')
  if (pool.length === 0) return []
  const shuffled = [...pool]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  const count = Math.min(
    pool.length,
    GENERIC_TRAIT_MIN + Math.floor(Math.random() * (GENERIC_TRAIT_MAX - GENERIC_TRAIT_MIN + 1)),
  )
  return shuffled.slice(0, count).map(t => t.code)
}

function resolveLihuanAttribute(): BuddyAttribute {
  const race = races.value.find(r => r.code === DEFAULT_RACE_CODE)
  return race?.default_attribute ?? DEFAULT_ATTRIBUTE
}

function mapError(err: BuddyError): string {
  switch (err.kind) {
    case 'unauthenticated':
      return localeIsZh
        ? '请先在「连接」页登录'
        : 'Sign in on the Connection tab first.'
    case 'unauthorized':
      return localeIsZh
        ? '登录已过期，请重新登录'
        : 'Your session expired — please sign in again.'
    case 'not_found':
      return localeIsZh ? '资源不存在' : 'Not found.'
    case 'conflict':
      return err.message
    case 'validation':
      return err.message
        || (localeIsZh ? '名字格式不正确' : 'Name must be 1–64 characters.')
    case 'server':
      return `${localeIsZh ? '服务错误' : 'Server error'} (${err.status}): ${err.message}`
    case 'transport':
      return localeIsZh
        ? `网络错误：${err.message}`
        : `Network error: ${err.message}`
  }
}

function next() {
  if (page.value < 2) page.value = (page.value + 1) as 0 | 1 | 2
}

async function adopt() {
  if (!canSubmit.value) return
  submitting.value = true
  errorMsg.value = null
  try {
    const result = await commands.buddyCreate(
      form.name.trim(),
      DEFAULT_RACE_CODE,
      resolveLihuanAttribute(),
      pickGender(),
      pickGenericTraits(genericTraits.value),
    )
    if (result.status === 'ok') {
      const buddy = result.data.envelope.buddy
      if (buddy) await saveNicknames(buddy.id, form.nicknames)
      // Parent removes us once the cache observer sees buddy != null.
      return
    }
    if (result.error.kind === 'conflict') {
      // Server says a buddy already exists — pull remote state and let
      // the parent's `useIpcSetting` observer unmount us.
      await commands.buddySync().catch(() => {})
      return
    }
    errorMsg.value = mapError(result.error)
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : String(err)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="onboarding">
      <div
        v-if="open"
        class="onboarding-overlay"
        @keydown.esc.prevent
      >
        <div class="starfield" />
        <div class="data-river" />

        <div class="onboarding-content">
          <!-- Page 0 · 灵域 -->
          <section
            v-if="page === 0"
            class="ritual-page"
          >
            <h1 class="ritual-title">
              {{ localeIsZh ? '灵域' : 'The Spirit Realm' }}
            </h1>
            <p class="ritual-line stagger-1">
              {{ localeIsZh
                ? '《山海经》所载灵兽，'
                : 'The spirit beasts of the Classic of Mountains and Seas' }}
            </p>
            <p class="ritual-line stagger-2">
              {{ localeIsZh
                ? '自古栖息于「灵域」——'
                : 'have dwelt since ancient times in the Spirit Realm —' }}
            </p>
            <p class="ritual-line stagger-3">
              {{ localeIsZh
                ? '一个与人世平行的时空。'
                : 'a world parallel to our own.' }}
            </p>
            <button
              class="ritual-next"
              @click="next"
            >
              {{ localeIsZh ? '继续' : 'Continue' }}
            </button>
          </section>

          <!-- Page 1 · 数据之河 -->
          <section
            v-else-if="page === 1"
            class="ritual-page"
          >
            <div class="glow-egg" />
            <h1 class="ritual-title">
              {{ localeIsZh ? '数据之河' : 'The River of Data' }}
            </h1>
            <p class="ritual-line stagger-1">
              {{ localeIsZh
                ? '这个时代，数据奔流成河。'
                : 'In this age, data flows like a river.' }}
            </p>
            <p class="ritual-line stagger-2">
              {{ localeIsZh
                ? '灵域法则被重新激活。'
                : 'The laws of the Spirit Realm awaken again.' }}
            </p>
            <p class="ritual-line stagger-3">
              {{ localeIsZh
                ? '灵宠们穿越数据之河，'
                : 'Spirit companions traverse the river,' }}
            </p>
            <p class="ritual-line stagger-4">
              {{ localeIsZh
                ? '借由电子设备，寻找共鸣的灵魂。'
                : 'seeking kindred souls through electronic vessels.' }}
            </p>
            <button
              class="ritual-next"
              @click="next"
            >
              {{ localeIsZh ? '继续' : 'Continue' }}
            </button>
          </section>

          <!-- Page 2 · 被选中的人 -->
          <section
            v-else
            class="ritual-page"
          >
            <div class="glow-egg glow-egg--large" />
            <h1 class="ritual-title">
              {{ localeIsZh ? '被选中的人' : 'The Chosen One' }}
            </h1>
            <p class="ritual-line stagger-1">
              {{ localeIsZh
                ? '一枚灵蛋，选择了你。'
                : 'A spirit egg has chosen you.' }}
            </p>
            <p class="ritual-line stagger-2">
              {{ localeIsZh
                ? '里面孕育着一只尚未觉醒的灵魂。'
                : 'A soul sleeps within, not yet awake.' }}
            </p>
            <p class="ritual-line stagger-3 ritual-line--emph">
              {{ localeIsZh
                ? '「你，就是被选中的人。」'
                : '"You are the chosen one."' }}
            </p>

            <div class="ritual-form">
              <label class="field">
                <span class="field-label">
                  {{ localeIsZh ? '给它取个名字' : 'Name your companion' }}
                  <span class="field-required">*</span>
                </span>
                <input
                  v-model="form.name"
                  type="text"
                  class="field-input"
                  :class="{ 'field-invalid': nameError }"
                  :placeholder="localeIsZh ? '2–8 中文 / 4–16 英文' : '2–8 CJK or 4–16 Latin chars'"
                  maxlength="16"
                >
                <span
                  v-if="nameError"
                  class="field-error"
                >
                  {{ nameError }}
                </span>
              </label>

              <div class="field">
                <span class="field-label">
                  {{ localeIsZh
                    ? '昵称（最多 3 个，可选，仅本地）'
                    : 'Nicknames (up to 3, optional, local only)' }}
                </span>
                <div class="nickname-grid">
                  <input
                    v-for="(_, idx) in form.nicknames"
                    :key="idx"
                    v-model="form.nicknames[idx]"
                    type="text"
                    class="field-input nickname-slot"
                    :class="{ 'field-invalid': nicknameErrors[idx] }"
                    :placeholder="`#${idx + 1}`"
                    maxlength="16"
                  >
                </div>
                <span
                  v-if="nicknameErrors.some(e => e !== null)"
                  class="field-error"
                >
                  {{ nicknameErrors.find(e => e !== null) }}
                </span>
              </div>

              <div
                v-if="errorMsg"
                class="error-banner"
              >
                {{ errorMsg }}
              </div>

              <button
                class="ritual-cta"
                :disabled="!canSubmit"
                @click="adopt"
              >
                {{ submitting
                  ? (localeIsZh ? '正在唤醒…' : 'Awakening…')
                  : (localeIsZh ? '[ 获得灵宠 ]' : '[ Adopt ]') }}
              </button>
            </div>
          </section>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.onboarding-overlay {
  position: fixed;
  inset: 0;
  z-index: 220;
  display: flex;
  align-items: center;
  justify-content: center;
  background: radial-gradient(
      ellipse at center,
      rgba(40, 25, 80, 0.85) 0%,
      rgba(15, 10, 30, 0.95) 60%,
      rgba(5, 3, 15, 0.98) 100%
    );
  backdrop-filter: blur(8px);
  overflow: hidden;
  color: #e8dfff;
  font-family: inherit;
}

/* Drifting starfield. */
.starfield {
  position: absolute;
  inset: -25%;
  background-image:
    radial-gradient(1px 1px at 20% 30%, rgba(255, 255, 255, 0.8), transparent 60%),
    radial-gradient(1px 1px at 60% 70%, rgba(200, 180, 255, 0.7), transparent 60%),
    radial-gradient(1px 1px at 80% 20%, rgba(255, 255, 255, 0.5), transparent 60%),
    radial-gradient(1px 1px at 40% 85%, rgba(180, 160, 240, 0.6), transparent 60%),
    radial-gradient(2px 2px at 10% 60%, rgba(255, 240, 200, 0.5), transparent 60%),
    radial-gradient(1px 1px at 90% 45%, rgba(220, 200, 255, 0.6), transparent 60%);
  background-size: 400px 400px, 300px 300px, 500px 500px, 350px 350px, 600px 600px, 450px 450px;
  animation: drift 60s linear infinite;
  opacity: 0.8;
  pointer-events: none;
}

@keyframes drift {
  from { transform: translate(0, 0); }
  to { transform: translate(-200px, -100px); }
}

/* Horizontal data-stream ribbon behind the content. */
.data-river {
  position: absolute;
  inset: auto 0 0 0;
  height: 50%;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(100, 70, 200, 0.12) 25%,
    rgba(140, 120, 220, 0.18) 50%,
    rgba(100, 70, 200, 0.12) 75%,
    transparent 100%
  );
  filter: blur(28px);
  animation: river 18s ease-in-out infinite alternate;
  pointer-events: none;
}

@keyframes river {
  from { transform: translateX(-8%); }
  to { transform: translateX(8%); }
}

.onboarding-content {
  position: relative;
  width: min(520px, 88vw);
  padding: 32px 28px;
  z-index: 2;
  text-align: center;
}

.ritual-page {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  animation: fade-in 520ms ease-out;
}

@keyframes fade-in {
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
}

.ritual-title {
  margin: 0 0 8px;
  font-size: 28px;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: #f0e6ff;
  text-shadow: 0 0 24px rgba(180, 150, 255, 0.4);
}

.ritual-line {
  margin: 0;
  font-size: 15px;
  line-height: 1.7;
  letter-spacing: 0.04em;
  color: #d8cfff;
  opacity: 0;
  animation: line-in 700ms ease-out forwards;
}
.ritual-line--emph {
  font-size: 17px;
  font-weight: 600;
  color: #f0e0ff;
  margin-top: 6px;
}
.stagger-1 { animation-delay: 180ms; }
.stagger-2 { animation-delay: 360ms; }
.stagger-3 { animation-delay: 540ms; }
.stagger-4 { animation-delay: 720ms; }

@keyframes line-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 0.96; transform: translateY(0); }
}

/* The glowing spirit egg. */
.glow-egg {
  width: 120px;
  height: 150px;
  margin: 8px auto 20px;
  border-radius: 50% / 55% 55% 45% 45%;
  background: radial-gradient(
    circle at 35% 30%,
    rgba(255, 255, 255, 0.95) 0%,
    rgba(200, 180, 255, 0.8) 20%,
    rgba(140, 110, 220, 0.6) 50%,
    rgba(80, 50, 160, 0.4) 75%,
    rgba(40, 20, 80, 0.3) 100%
  );
  box-shadow:
    0 0 40px rgba(180, 150, 255, 0.6),
    0 0 80px rgba(140, 110, 220, 0.4),
    inset 0 -20px 40px rgba(40, 20, 80, 0.4);
  animation: egg-float 6s ease-in-out infinite, egg-spin 14s linear infinite;
}
.glow-egg--large {
  width: 150px;
  height: 190px;
  box-shadow:
    0 0 60px rgba(180, 150, 255, 0.75),
    0 0 120px rgba(140, 110, 220, 0.5),
    inset 0 -24px 48px rgba(40, 20, 80, 0.5);
}

@keyframes egg-float {
  0%, 100% { transform: translateY(0) rotate(0deg); }
  50% { transform: translateY(-8px) rotate(2deg); }
}

@keyframes egg-spin {
  from { background-position: 0% 50%; }
  to { background-position: 100% 50%; }
}

.ritual-next {
  margin-top: 14px;
  padding: 10px 28px;
  font-size: 13px;
  font-weight: 500;
  letter-spacing: 0.1em;
  color: #d8c8ff;
  background: rgba(100, 70, 200, 0.25);
  border: 1px solid rgba(140, 120, 220, 0.35);
  border-radius: 999px;
  cursor: pointer;
  transition: all 0.2s;
}
.ritual-next:hover {
  background: rgba(100, 70, 200, 0.45);
  border-color: rgba(140, 120, 220, 0.6);
  color: #fff;
}

.ritual-form {
  margin-top: 18px;
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 14px;
  text-align: left;
  animation: line-in 700ms ease-out 720ms forwards;
  opacity: 0;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.field-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #a89cc8;
}
.field-required {
  color: #e8a0a0;
  margin-left: 4px;
}
.field-input {
  padding: 9px 12px;
  font-size: 14px;
  color: #f0e8ff;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  outline: none;
  transition: all 0.15s;
  font-family: inherit;
}
.field-input::placeholder {
  color: #6a5f80;
}
.field-input:hover {
  border-color: rgba(255, 255, 255, 0.2);
}
.field-input:focus {
  border-color: rgba(140, 120, 220, 0.6);
  background: rgba(255, 255, 255, 0.06);
}
.nickname-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}
.nickname-slot {
  min-width: 0;
  padding: 7px 10px;
  font-size: 13px;
}
.field-invalid {
  border-color: rgba(220, 90, 90, 0.6) !important;
}
.field-error {
  font-size: 11px;
  color: #e08a8a;
  line-height: 1.3;
}

.error-banner {
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(220, 70, 70, 0.12);
  border: 1px solid rgba(220, 70, 70, 0.25);
  color: #f2a0a0;
  font-size: 13px;
  line-height: 1.4;
}

.ritual-cta {
  margin-top: 6px;
  padding: 12px 20px;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.14em;
  color: #f0e6ff;
  background: linear-gradient(
    135deg,
    rgba(100, 70, 200, 0.35) 0%,
    rgba(140, 120, 220, 0.3) 100%
  );
  border: 1px solid rgba(140, 120, 220, 0.55);
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.2s;
  text-shadow: 0 0 12px rgba(180, 150, 255, 0.4);
}
.ritual-cta:hover:not(:disabled) {
  background: linear-gradient(
    135deg,
    rgba(100, 70, 200, 0.55) 0%,
    rgba(140, 120, 220, 0.5) 100%
  );
  border-color: rgba(180, 150, 255, 0.75);
  color: #fff;
  box-shadow: 0 0 20px rgba(140, 110, 220, 0.35);
}
.ritual-cta:disabled {
  background: rgba(255, 255, 255, 0.04);
  border-color: rgba(255, 255, 255, 0.08);
  color: #6a5f80;
  cursor: default;
  text-shadow: none;
}

.onboarding-enter-active,
.onboarding-leave-active {
  transition: opacity 0.4s ease;
}
.onboarding-enter-from,
.onboarding-leave-to {
  opacity: 0;
}
</style>
