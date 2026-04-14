import type { ProviderValidationPlan } from './run'

import { describe, expect, it, vi } from 'vitest'

import { createConfigValidationSteps, createProviderValidationSteps, getValidatorsOfProvider, validateProvider } from './run'

vi.mock('@moeru/std', () => ({
  errorMessageFrom: (error: unknown) => {
    if (error instanceof Error)
      return error.message
    return String(error)
  },
  merge: (a: Record<string, unknown>, b: Record<string, unknown>) => ({ ...a, ...b }),
}))

const mockT = ((key: string) => key) as any

describe('createConfigValidationSteps', () => {
  it('maps validators to steps with status idle and kind config', () => {
    const validators = [
      { id: 'check-api-key', name: 'Check API Key', validator: vi.fn() },
      { id: 'check-url', name: 'Check URL', validator: vi.fn() },
    ]
    const steps = createConfigValidationSteps(validators)

    expect(steps).toHaveLength(2)
    expect(steps[0]).toEqual({
      id: 'check-api-key',
      label: 'Check API Key',
      status: 'idle',
      reason: '',
      kind: 'config',
    })
    expect(steps[1]).toEqual({
      id: 'check-url',
      label: 'Check URL',
      status: 'idle',
      reason: '',
      kind: 'config',
    })
  })

  it('returns empty array for empty validators', () => {
    expect(createConfigValidationSteps([])).toEqual([])
  })
})

describe('createProviderValidationSteps', () => {
  it('maps validators to steps with status idle and kind provider', () => {
    const validators = [
      { id: 'check-connectivity', name: 'Check Connectivity', validator: vi.fn() },
    ]
    const steps = createProviderValidationSteps(validators)

    expect(steps).toHaveLength(1)
    expect(steps[0]).toEqual({
      id: 'check-connectivity',
      label: 'Check Connectivity',
      status: 'idle',
      reason: '',
      kind: 'provider',
    })
  })
})

describe('getValidatorsOfProvider', () => {
  it('creates plan with config and provider validators', () => {
    const configValidator = { id: 'cfg-1', name: 'Config 1', validator: vi.fn() }
    const providerValidator = { id: 'prv-1', name: 'Provider 1', validator: vi.fn() }

    const definition = {
      validators: {
        validateConfig: [() => configValidator],
        validateProvider: [() => providerValidator],
      },
      validationRequiredWhen: undefined,
    } as any

    const plan = getValidatorsOfProvider({
      definition,
      config: { apiKey: 'test' },
      schemaDefaults: { apiKey: '' },
      contextOptions: { t: mockT },
    })

    expect(plan.steps).toHaveLength(2)
    expect(plan.steps[0].kind).toBe('config')
    expect(plan.steps[1].kind).toBe('provider')
    expect(plan.configValidators).toHaveLength(1)
    expect(plan.providerValidators).toHaveLength(1)
  })

  it('shouldValidate defaults to false when no validationRequiredWhen', () => {
    const definition = {
      validators: {},
      validationRequiredWhen: undefined,
    } as any

    const plan = getValidatorsOfProvider({
      definition,
      config: {},
      schemaDefaults: {},
      contextOptions: { t: mockT },
    })

    expect(plan.shouldValidate).toBe(false)
  })

  it('merges schema defaults with config', () => {
    const definition = {
      validators: {},
      validationRequiredWhen: undefined,
    } as any

    const plan = getValidatorsOfProvider({
      definition,
      config: { apiKey: 'my-key' },
      schemaDefaults: { apiKey: '', baseUrl: 'http://default.com' },
      contextOptions: { t: mockT },
    })

    expect(plan.config).toEqual({ apiKey: 'my-key', baseUrl: 'http://default.com' })
  })
})

describe('validateProvider', () => {
  function createPlan(overrides: Partial<ProviderValidationPlan> = {}): ProviderValidationPlan {
    return {
      steps: [],
      config: {},
      definition: { createProvider: vi.fn() } as any,
      configValidators: [],
      providerValidators: [],
      providerExtra: undefined,
      shouldValidate: true,
      ...overrides,
    }
  }

  it('runs config validators first', async () => {
    const configValidator = {
      id: 'cfg-1',
      name: 'Config 1',
      validator: vi.fn().mockResolvedValue({ valid: true, reason: '' }),
    }
    const plan = createPlan({
      configValidators: [configValidator],
      steps: [{ id: 'cfg-1', label: 'Config 1', status: 'idle', reason: '', kind: 'config' }],
      definition: { createProvider: vi.fn().mockReturnValue({}) } as any,
    })

    const steps = await validateProvider(plan, { t: mockT })

    expect(configValidator.validator).toHaveBeenCalledOnce()
    expect(steps[0].status).toBe('valid')
  })

  it('marks provider validators as invalid when config fails', async () => {
    const configValidator = {
      id: 'cfg-1',
      name: 'Config 1',
      validator: vi.fn().mockResolvedValue({ valid: false, reason: 'Missing API key' }),
    }
    const providerValidator = {
      id: 'prv-1',
      name: 'Provider 1',
      validator: vi.fn(),
    }
    const plan = createPlan({
      configValidators: [configValidator],
      providerValidators: [providerValidator],
      steps: [
        { id: 'cfg-1', label: 'Config 1', status: 'idle', reason: '', kind: 'config' },
        { id: 'prv-1', label: 'Provider 1', status: 'idle', reason: '', kind: 'provider' },
      ],
    })

    const steps = await validateProvider(plan, { t: mockT })

    expect(steps[0].status).toBe('invalid')
    expect(steps[1].status).toBe('invalid')
    expect(steps[1].reason).toBe('Fix configuration checks first.')
    expect(providerValidator.validator).not.toHaveBeenCalled()
  })

  it('creates provider and runs provider validators when config passes', async () => {
    const mockProviderInstance = { chat: vi.fn() }
    const configValidator = {
      id: 'cfg-1',
      name: 'Config 1',
      validator: vi.fn().mockResolvedValue({ valid: true, reason: '' }),
    }
    const providerValidator = {
      id: 'prv-1',
      name: 'Provider 1',
      validator: vi.fn().mockResolvedValue({ valid: true, reason: '' }),
    }
    const createProvider = vi.fn().mockReturnValue(mockProviderInstance)

    const plan = createPlan({
      configValidators: [configValidator],
      providerValidators: [providerValidator],
      definition: { createProvider } as any,
      steps: [
        { id: 'cfg-1', label: 'Config 1', status: 'idle', reason: '', kind: 'config' },
        { id: 'prv-1', label: 'Provider 1', status: 'idle', reason: '', kind: 'provider' },
      ],
    })

    const steps = await validateProvider(plan, { t: mockT })

    expect(createProvider).toHaveBeenCalledOnce()
    expect(providerValidator.validator).toHaveBeenCalledOnce()
    expect(steps[0].status).toBe('valid')
    expect(steps[1].status).toBe('valid')
  })

  it('calls onValidatorStart, onValidatorSuccess, and onValidatorError callbacks', async () => {
    const onValidatorStart = vi.fn()
    const onValidatorSuccess = vi.fn()
    const onValidatorError = vi.fn()

    const configValidator = {
      id: 'cfg-1',
      name: 'Config 1',
      validator: vi.fn().mockResolvedValue({ valid: true, reason: '' }),
    }
    const providerValidator = {
      id: 'prv-1',
      name: 'Provider 1',
      validator: vi.fn().mockRejectedValue(new Error('Connection failed')),
    }

    const plan = createPlan({
      configValidators: [configValidator],
      providerValidators: [providerValidator],
      definition: { createProvider: vi.fn().mockReturnValue({}) } as any,
      steps: [
        { id: 'cfg-1', label: 'Config 1', status: 'idle', reason: '', kind: 'config' },
        { id: 'prv-1', label: 'Provider 1', status: 'idle', reason: '', kind: 'provider' },
      ],
    })

    await validateProvider(plan, { t: mockT }, { onValidatorStart, onValidatorSuccess, onValidatorError })

    expect(onValidatorStart).toHaveBeenCalledTimes(2)
    expect(onValidatorSuccess).toHaveBeenCalledTimes(1)
    expect(onValidatorSuccess).toHaveBeenCalledWith(expect.objectContaining({ kind: 'config', index: 0 }))
    expect(onValidatorError).toHaveBeenCalledTimes(1)
    expect(onValidatorError).toHaveBeenCalledWith(expect.objectContaining({ kind: 'provider', index: 0 }))
  })

  it('marks all provider steps as invalid when createProvider throws', async () => {
    const configValidator = {
      id: 'cfg-1',
      name: 'Config 1',
      validator: vi.fn().mockResolvedValue({ valid: true, reason: '' }),
    }
    const providerValidator = {
      id: 'prv-1',
      name: 'Provider 1',
      validator: vi.fn(),
    }
    const createProvider = vi.fn().mockRejectedValue(new Error('Init failed'))

    const plan = createPlan({
      configValidators: [configValidator],
      providerValidators: [providerValidator],
      definition: { createProvider } as any,
      steps: [
        { id: 'cfg-1', label: 'Config 1', status: 'idle', reason: '', kind: 'config' },
        { id: 'prv-1', label: 'Provider 1', status: 'idle', reason: '', kind: 'provider' },
      ],
    })

    const steps = await validateProvider(plan, { t: mockT })

    expect(steps[0].status).toBe('valid')
    expect(steps[1].status).toBe('invalid')
    expect(steps[1].reason).toBe('Init failed')
    expect(providerValidator.validator).not.toHaveBeenCalled()
  })
})
