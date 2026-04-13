import { describe, expect, it } from 'vitest'

import { Emotion } from '../constants/emotions'
import { extractSenseVoiceEmotion } from './sensevoice-emotion'

describe('extractSenseVoiceEmotion', () => {
  it('should parse HAPPY emotion tag', () => {
    const result = extractSenseVoiceEmotion('<|zh|><|HAPPY|><|Speech|>你好世界')
    expect(result.cleanText).toBe('你好世界')
    expect(result.emotion).toEqual({ name: Emotion.Happy, intensity: 1 })
  })

  it('should parse SAD emotion tag', () => {
    const result = extractSenseVoiceEmotion('<|en|><|SAD|><|Speech|>I feel sad')
    expect(result.cleanText).toBe('I feel sad')
    expect(result.emotion).toEqual({ name: Emotion.Sad, intensity: 1 })
  })

  it('should parse ANGRY emotion tag', () => {
    const result = extractSenseVoiceEmotion('<|ja|><|ANGRY|><|Speech|>怒っている')
    expect(result.cleanText).toBe('怒っている')
    expect(result.emotion).toEqual({ name: Emotion.Angry, intensity: 1 })
  })

  it('should parse NEUTRAL emotion tag', () => {
    const result = extractSenseVoiceEmotion('<|zh|><|NEUTRAL|><|Speech|>普通的句子')
    expect(result.cleanText).toBe('普通的句子')
    expect(result.emotion).toEqual({ name: Emotion.Neutral, intensity: 1 })
  })

  it('should parse SURPRISED emotion tag', () => {
    const result = extractSenseVoiceEmotion('<|en|><|SURPRISED|><|Speech|>Wow really')
    expect(result.cleanText).toBe('Wow really')
    expect(result.emotion).toEqual({ name: Emotion.Surprise, intensity: 1 })
  })

  it('should map FEARFUL to Sad', () => {
    const result = extractSenseVoiceEmotion('<|en|><|FEARFUL|><|Speech|>I am scared')
    expect(result.cleanText).toBe('I am scared')
    expect(result.emotion).toEqual({ name: Emotion.Sad, intensity: 1 })
  })

  it('should map DISGUSTED to Angry', () => {
    const result = extractSenseVoiceEmotion('<|en|><|DISGUSTED|><|Speech|>That is gross')
    expect(result.cleanText).toBe('That is gross')
    expect(result.emotion).toEqual({ name: Emotion.Angry, intensity: 1 })
  })

  it('should return null emotion when no emotion tag is present', () => {
    const result = extractSenseVoiceEmotion('<|zh|><|Speech|>没有情绪标签')
    expect(result.cleanText).toBe('没有情绪标签')
    expect(result.emotion).toBeNull()
  })

  it('should handle text with no tags at all', () => {
    const result = extractSenseVoiceEmotion('plain text without tags')
    expect(result.cleanText).toBe('plain text without tags')
    expect(result.emotion).toBeNull()
  })

  it('should handle empty string', () => {
    const result = extractSenseVoiceEmotion('')
    expect(result.cleanText).toBe('')
    expect(result.emotion).toBeNull()
  })

  it('should handle tags-only input with no text content', () => {
    const result = extractSenseVoiceEmotion('<|zh|><|HAPPY|><|Speech|>')
    expect(result.cleanText).toBe('')
    expect(result.emotion).toEqual({ name: Emotion.Happy, intensity: 1 })
  })

  it('should strip language tags', () => {
    const result = extractSenseVoiceEmotion('<|en|>Hello world')
    expect(result.cleanText).toBe('Hello world')
  })

  it('should strip event tags like BGM and Applause', () => {
    const result = extractSenseVoiceEmotion('<|zh|><|BGM|><|Applause|>欢迎')
    expect(result.cleanText).toBe('欢迎')
    expect(result.emotion).toBeNull()
  })

  it('should use only the first emotion tag when multiple are present', () => {
    const result = extractSenseVoiceEmotion('<|HAPPY|><|SAD|>mixed feelings')
    expect(result.cleanText).toBe('mixed feelings')
    expect(result.emotion).toEqual({ name: Emotion.Happy, intensity: 1 })
  })

  it('should handle whitespace around text after stripping tags', () => {
    const result = extractSenseVoiceEmotion('<|zh|><|NEUTRAL|><|Speech|>  some text  ')
    expect(result.cleanText).toBe('some text')
    expect(result.emotion).toEqual({ name: Emotion.Neutral, intensity: 1 })
  })
})
