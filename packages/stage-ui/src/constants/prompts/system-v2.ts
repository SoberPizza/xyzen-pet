import type { SystemMessage } from '@xsai/shared-chat'

import { EMOTION_EmotionMotionName_value, EMOTION_VALUES } from '../emotions'

// NOTICE: Language-adaptive instruction ensures the LLM responds in the same language
// as the user's input, regardless of the system prompt's locale. This prevents the common
// issue where the English system prompt forces English replies to Chinese/Japanese/etc input.
// Placed at the very beginning of the system prompt for maximum priority with small models.
const LANGUAGE_ADAPTIVE_INSTRUCTION = 'CRITICAL: You MUST respond in the same language the user uses. 用户说中文你必须用中文回复。If the user writes in Chinese, respond entirely in Chinese. If the user writes in English, respond in English. Match the user\'s language naturally.'

function message(prefix: string, suffix: string) {
  return {
    role: 'system',
    content: [
      LANGUAGE_ADAPTIVE_INSTRUCTION,
      prefix,
      EMOTION_VALUES
        .map(emotion => `- ${emotion} (Emotion for feeling ${EMOTION_EmotionMotionName_value[emotion]})`)
        .join('\n'),
      suffix,
    ].join('\n\n'),
  } satisfies SystemMessage
}

export default message
