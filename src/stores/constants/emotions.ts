export enum Emotion {
  Happy = 'happy',
  Angry = 'angry',
  Sad = 'sad',
  Relaxed = 'relaxed',
  Surprised = 'surprised',
  Neutral = 'neutral',
}

export const EMOTION_VRMExpressionName_value = {
  [Emotion.Happy]: 'happy',
  [Emotion.Angry]: 'angry',
  [Emotion.Sad]: 'sad',
  [Emotion.Relaxed]: 'relaxed',
  [Emotion.Surprised]: 'surprised',
  [Emotion.Neutral]: 'neutral',
} satisfies Record<Emotion, string>

export interface EmotionPayload {
  name: Emotion
  intensity: number
}
