import type { SystemMessage } from '@xsai/shared-chat'

import { EMOTION_EmotionMotionName_value, EMOTION_VALUES } from '../emotions'

// NOTICE: Language-adaptive instruction ensures the LLM responds in the same language
// as the user's input, regardless of the system prompt's locale. This prevents the common
// issue where the English system prompt forces English replies to Chinese/Japanese/etc input.
const LANGUAGE_ADAPTIVE_INSTRUCTION = 'Always respond in the same language as the user\'s most recent message. If the user writes in Chinese, respond in Chinese. If the user writes in English, respond in English. Match the user\'s language naturally.'

function message(prefix: string, suffix: string) {
  return {
    role: 'system',
    content: [
      prefix,
      EMOTION_VALUES
        .map(emotion => `- ${emotion} (Emotion for feeling ${EMOTION_EmotionMotionName_value[emotion]})`)
        .join('\n'),
      suffix,
      LANGUAGE_ADAPTIVE_INSTRUCTION,
    ].join('\n\n'),
  } satisfies SystemMessage
}

export default message
