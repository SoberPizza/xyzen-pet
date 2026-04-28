/**
 * Emotion enum and VRM expression mapping.
 *
 * The backend emits emotion names (see `XyzenEmotionUpdate` in
 * `services/xyzen/types.ts`) using these string values. The
 * `EMOTION_VRMExpressionName_value` map translates them into the
 * VRM expression preset names consumed by `useVRMEmote.setExpression()`.
 * Both layers happen to use the same vocabulary today — keep this
 * map in place so the translation remains explicit if that diverges.
 */

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
