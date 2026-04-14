<script setup lang="ts">
import type { OrbActivity, OrbEmotion } from '@proj-airi/stage-ui-three'

import { Button, FieldCheckbox, FieldRange } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'

import { useLightOrbDebugStore } from '../../../../stores/light-orb-debug'
import { Section } from '../../../layouts'

const debugStore = useLightOrbDebugStore()
const {
  debugEnabled,
  debugEmotion,
  debugActivity,
  debugMood,
  debugEnergy,
  debugAudioLevel,
  debugSpeakingLevel,
  debugCameraDistance,
  debugPepperGhost,
  debugEnableControls,
} = storeToRefs(debugStore)

const emotions: OrbEmotion[] = ['neutral', 'happy', 'sad', 'angry', 'surprised', 'fear', 'disgust', 'think']
const activities: OrbActivity[] = ['idle', 'listening', 'thinking', 'speaking']
</script>

<template>
  <Section
    title="Debug Controls"
    icon="i-solar:bug-bold-duotone"
    :class="[
      'rounded-xl',
      'bg-white/80 dark:bg-black/75',
      'backdrop-blur-lg',
    ]"
    size="sm"
    :expand="true"
  >
    <FieldCheckbox
      v-model="debugEnabled"
      label="Enable Debug Overrides"
      placement="right"
    />
  </Section>

  <Section
    title="Camera & Display"
    icon="i-solar:camera-bold-duotone"
    :class="[
      'rounded-xl',
      'bg-white/80 dark:bg-black/75',
      'backdrop-blur-lg',
    ]"
    size="sm"
    :expand="true"
  >
    <FieldRange
      v-model="debugCameraDistance"
      as="div"
      :min="0.5"
      :max="5"
      :step="0.1"
      label="Camera Distance"
      :disabled="!debugEnabled"
    />
    <FieldCheckbox
      v-model="debugPepperGhost"
      label="Pepper's Ghost Mode"
      placement="right"
      :disabled="!debugEnabled"
    />
    <FieldCheckbox
      v-model="debugEnableControls"
      label="Orbit Controls"
      placement="right"
      :disabled="!debugEnabled"
    />
  </Section>

  <Section
    title="Emotion Preview"
    icon="i-solar:emoji-funny-circle-bold-duotone"
    :class="[
      'rounded-xl',
      'bg-white/80 dark:bg-black/75',
      'backdrop-blur-lg',
    ]"
    size="sm"
    :expand="true"
  >
    <div :class="['flex flex-wrap gap-2']">
      <Button
        v-for="emotion in emotions"
        :key="emotion"
        :variant="debugEmotion === emotion ? 'primary' : 'secondary'"
        :disabled="!debugEnabled"
        @click="debugEmotion = emotion"
      >
        {{ emotion }}
      </Button>
    </div>
  </Section>

  <Section
    title="Activity Preview"
    icon="i-solar:play-circle-bold-duotone"
    :class="[
      'rounded-xl',
      'bg-white/80 dark:bg-black/75',
      'backdrop-blur-lg',
    ]"
    size="sm"
    :expand="true"
  >
    <div :class="['flex flex-wrap gap-2']">
      <Button
        v-for="act in activities"
        :key="act"
        :variant="debugActivity === act ? 'primary' : 'secondary'"
        :disabled="!debugEnabled"
        @click="debugActivity = act"
      >
        {{ act }}
      </Button>
    </div>
  </Section>

  <Section
    title="Parameters"
    icon="i-solar:settings-bold-duotone"
    :class="[
      'rounded-xl',
      'bg-white/80 dark:bg-black/75',
      'backdrop-blur-lg',
    ]"
    size="sm"
    :expand="true"
  >
    <FieldRange
      v-model="debugMood"
      as="div"
      :min="0"
      :max="1"
      :step="0.01"
      label="Mood"
      :disabled="!debugEnabled"
    />
    <FieldRange
      v-model="debugEnergy"
      as="div"
      :min="0"
      :max="1"
      :step="0.01"
      label="Energy"
      :disabled="!debugEnabled"
    />
    <FieldRange
      v-model="debugAudioLevel"
      as="div"
      :min="0"
      :max="1"
      :step="0.01"
      label="Simulated Audio Level"
      :disabled="!debugEnabled"
    />
    <FieldRange
      v-model="debugSpeakingLevel"
      as="div"
      :min="0"
      :max="1"
      :step="0.01"
      label="Simulated Speaking Level"
      :disabled="!debugEnabled"
    />
  </Section>

  <Section
    title="Interaction"
    icon="i-solar:hand-shake-bold-duotone"
    :class="[
      'rounded-xl',
      'bg-white/80 dark:bg-black/75',
      'backdrop-blur-lg',
    ]"
    size="sm"
    :expand="false"
  >
    <Button
      variant="secondary"
      :disabled="!debugEnabled"
      @click="debugStore.triggerInteraction()"
    >
      Trigger Interaction
    </Button>
  </Section>
</template>
