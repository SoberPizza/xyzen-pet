import type { EmotionPayload } from '../constants/emotions'

import { Emotion } from '../constants/emotions'

// SenseVoice emotion tag to internal Emotion mapping.
// FEARFUL -> Sad (closest approximation), DISGUSTED -> Angry (closest approximation).
const SENSEVOICE_EMOTION_MAP: Record<string, Emotion> = {
  HAPPY: Emotion.Happy,
  SAD: Emotion.Sad,
  ANGRY: Emotion.Angry,
  NEUTRAL: Emotion.Neutral,
  SURPRISED: Emotion.Surprise,
  FEARFUL: Emotion.Sad,
  DISGUSTED: Emotion.Angry,
}

// Matches SenseVoice special tags: <|TAG|> for emotion, language, and event labels.
const SENSEVOICE_TAG_RE = /<\|([A-Z]+)\|>/gi

export interface SenseVoiceParseResult {
  cleanText: string
  emotion: EmotionPayload | null
}

/**
 * Parse SenseVoice output text to extract emotion tags and clean text.
 *
 * SenseVoice prefixes transcription results with special tags:
 * - Language: `<|zh|>`, `<|en|>`, `<|ja|>`, etc.
 * - Event: `<|BGM|>`, `<|Speech|>`, `<|Applause|>`, etc.
 * - Emotion: `<|HAPPY|>`, `<|SAD|>`, `<|ANGRY|>`, `<|NEUTRAL|>`, `<|FEARFUL|>`, `<|DISGUSTED|>`, `<|SURPRISED|>`
 *
 * Returns clean text with all tags stripped and the first recognized emotion (if any).
 */
export function extractSenseVoiceEmotion(raw: string): SenseVoiceParseResult {
  let emotion: EmotionPayload | null = null

  // Extract the first matching emotion tag
  for (const match of raw.matchAll(SENSEVOICE_TAG_RE)) {
    const tag = match[1].toUpperCase()
    const mapped = SENSEVOICE_EMOTION_MAP[tag]
    if (mapped && !emotion) {
      emotion = { name: mapped, intensity: 1 }
    }
  }

  const cleanText = raw.replace(SENSEVOICE_TAG_RE, '').trim()

  return { cleanText, emotion }
}
