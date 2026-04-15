<script setup lang="ts">
import type { TTSInputChunk } from '../../../utils/tts'

import { createQueue } from '@proj-airi/stream-kit'
import { animate } from 'animejs'
import { ref } from 'vue'

import { createAudioManager, disposeAudioManager, playAudioStream, startVolumeTracking, stopVolumeTracking } from '../../../libs/audio/manager'
import { useAudioContext } from '../../../stores/audio'
import { chunkTTSInput } from '../../../utils/tts'

const props = defineProps<{
  text: string
  // Provider-specific handlers (provided from parent)
  generateSpeech: (input: string, voice: string, useSSML: boolean) => Promise<ArrayBuffer>
  generateSpeechStream?: (input: string, voice: string) => Promise<ReadableStream<ArrayBuffer>>
  voice: string
}>()

const { audioContext } = useAudioContext()
const nowSpeaking = ref(false)
const ttsInputChunks = ref<TTSInputChunk[]>([])
const speechGenerationIndex = ref(-1)
const isStreamPlaying = ref(false)
const streamChunkCount = ref(0)

const audioQueue = createQueue<{ audioBuffer: AudioBuffer, text: string }>({
  handlers: [
    (ctx) => {
      return new Promise((resolve) => {
        const source = audioContext.createBufferSource()
        source.buffer = ctx.data.audioBuffer
        source.connect(audioContext.destination)

        nowSpeaking.value = true
        source.start(0)
        source.onended = () => {
          nowSpeaking.value = false
          resolve()
        }
      })
    },
  ],
})

async function handleSpeechGeneration(ctx: { data: string }) {
  speechGenerationIndex.value++

  try {
    const input = ctx.data

    const res = await props.generateSpeech(input, props.voice, false)

    const audioBuffer = await audioContext.decodeAudioData(res)
    audioQueue.enqueue({ audioBuffer, text: ctx.data })
  }
  catch (error) {
    console.error('Speech generation failed:', error)
  }
}

const ttsQueue = createQueue<string>({ handlers: [handleSpeechGeneration] })

async function testStreaming() {
  speechGenerationIndex.value = -1
  for await (const chunk of chunkTTSInput(props.text, { boost: 1, minimumWords: 4, maximumWords: 12 })) {
    if (!chunk.text)
      continue
    ttsQueue.enqueue(chunk.text)
  }
}

async function testStreamPlayback() {
  if (!props.generateSpeechStream || !props.voice || !props.text)
    return

  isStreamPlaying.value = true
  streamChunkCount.value = 0

  const manager = createAudioManager()
  startVolumeTracking(manager, (vol) => {
    nowSpeaking.value = vol > 0
  })

  try {
    const rawStream = await props.generateSpeechStream(props.text, props.voice)

    // Wrap stream to count chunks as they pass through
    const reader = rawStream.getReader()
    const countingStream = new ReadableStream<ArrayBuffer>({
      async start(controller) {
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) {
              controller.close()
              return
            }
            streamChunkCount.value++
            controller.enqueue(value)
          }
        }
        catch (err) {
          controller.error(err)
        }
      },
      cancel() {
        reader.cancel()
      },
    })

    await playAudioStream(manager, countingStream)
  }
  catch (error) {
    console.error('Stream playback failed:', error)
  }
  finally {
    stopVolumeTracking(manager)
    disposeAudioManager(manager)
    isStreamPlaying.value = false
    nowSpeaking.value = false
  }
}

async function testChunking() {
  const chunks: TTSInputChunk[] = []
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(props.text))
      controller.close()
    },
  })

  for await (const chunk of chunkTTSInput(stream.getReader(), { boost: 1, minimumWords: 4, maximumWords: 12 })) {
    chunks.push(chunk)
  }

  ttsInputChunks.value = chunks
}
</script>

<template>
  <div class="flex items-center gap-1 text-sm font-medium">
    Streaming Playground
  </div>
  <div flex="~ row wrap" gap-4>
    <button
      border="neutral-800 dark:neutral-200 solid 2" transition="border duration-250 ease-in-out"
      rounded-lg px-4 text="neutral-100 dark:neutral-900" py-2 text-sm
      bg="neutral-700 dark:neutral-300" @click="testChunking"
    >
      <div flex="~ row" items-center gap-2>
        <div i-solar:round-double-alt-arrow-right-bold-duotone />
        <span>Test chunking</span>
      </div>
    </button>

    <button
      v-if="ttsInputChunks.length > 0"
      border="neutral-800 dark:neutral-200 solid 2" transition="border duration-250 ease-in-out"
      rounded-lg px-4 text="neutral-100 dark:neutral-900" py-2 text-sm
      bg="neutral-700 dark:neutral-300" @click="testStreaming"
    >
      <div flex="~ row" items-center gap-2>
        <div i-solar:round-double-alt-arrow-right-bold-duotone />
        <span>Test streaming</span>
      </div>
    </button>

    <button
      v-if="generateSpeechStream"
      :disabled="isStreamPlaying || !voice || !text"
      :class="{ 'opacity-50 cursor-not-allowed': isStreamPlaying || !voice || !text }"
      border="emerald-700 dark:emerald-300 solid 2" transition="border duration-250 ease-in-out"
      rounded-lg px-4 text="neutral-100 dark:neutral-900" py-2 text-sm
      bg="emerald-600 dark:emerald-400" @click="testStreamPlayback"
    >
      <div flex="~ row" items-center gap-2>
        <div i-solar:soundwave-bold-duotone />
        <span>{{ isStreamPlaying ? `Playing (${streamChunkCount} chunks)...` : 'Test stream playback' }}</span>
      </div>
    </button>
  </div>

  <div flex="~ col gap-2 items-start" py-4>
    <div
      v-for="(chunk, i) in ttsInputChunks"
      :key="i"
      flex="~ row gap-2 items-center"
    >
      <div
        flex="~ row gap-2 items-center"
        rounded-xl px-2 py-1.5
        :class="{
          'bg-neutral-100 dark:bg-neutral-800': speechGenerationIndex < i,
          'bg-neutral-200 dark:bg-neutral-700': speechGenerationIndex >= i,
        }"
      >
        <span ml-1>{{ chunk.text }}</span>
        <span
          rounded-full px-2 py-.5 text-nowrap text-xs
          b="~ dashed"
          :class="{
            'b-green text-green': chunk.reason === 'boost',
            'b-orange text-orange': chunk.reason === 'limit',
            'b-red text-red': chunk.reason === 'hard',
            'b-purple text-purple': chunk.reason === 'flush',
          }"
        >
          {{ chunk.words }} words,
          {{ chunk.reason }}
        </span>
      </div>
      <Transition
        :css="false"
        @enter="(el) => animate(el, {
          opacity: [0, 1],
          translateX: [10, 0],
          duration: 200,
          ease: 'inOut',
        })"
      >
        <div
          v-if="speechGenerationIndex >= i"
          tag="div"
          flex="~ row items-center gap-1"
          text-sm
        >
          <div i-solar-check-circle-line-duotone />
          <div>Queued</div>
        </div>
      </Transition>
    </div>
  </div>
</template>
