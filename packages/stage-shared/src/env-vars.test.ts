import { describe, expect, it } from 'vitest'

import { isEnvTruthy } from './env-vars'

describe('isEnvTruthy', () => {
  it('returns false for null', () => {
    expect(isEnvTruthy(null)).toBe(false)
  })

  it('returns false for undefined', () => {
    expect(isEnvTruthy(undefined)).toBe(false)
  })

  it.each([
    '1',
    'true',
    'TRUE',
    'True',
    't',
    'T',
    'yes',
    'YES',
    'y',
    'Y',
    'on',
    'ON',
  ])('returns true for %j', (value) => {
    expect(isEnvTruthy(value)).toBe(true)
  })

  it.each([
    '0',
    'false',
    'no',
    'off',
    '',
    'random',
    '2',
  ])('returns false for %j', (value) => {
    expect(isEnvTruthy(value)).toBe(false)
  })

  it('trims whitespace before checking', () => {
    expect(isEnvTruthy(' true ')).toBe(true)
  })
})
