import { describe, expect, it } from 'vitest'

import { matchesDestination, matchesDestinations, matchesLabelSelector, matchesLabelSelectors, matchesRouteExpression } from './match-expression'

describe('matchesLabelSelector', () => {
  it('matches key=value when labels contain that pair', () => {
    expect(matchesLabelSelector('env=prod', { env: 'prod' })).toBe(true)
  })

  it('does not match key=value when labels have different value', () => {
    expect(matchesLabelSelector('env=dev', { env: 'prod' })).toBe(false)
  })

  it('matches key-only selector when key exists in labels', () => {
    expect(matchesLabelSelector('env', { env: 'prod' })).toBe(true)
  })

  it('does not match key-only selector when key is absent', () => {
    expect(matchesLabelSelector('missing', { env: 'prod' })).toBe(false)
  })

  it('returns false for empty key', () => {
    expect(matchesLabelSelector('', { env: 'prod' })).toBe(false)
  })
})

describe('matchesLabelSelectors', () => {
  it('returns true when all selectors match (AND logic)', () => {
    expect(matchesLabelSelectors(
      ['env=prod', 'role=worker'],
      { env: 'prod', role: 'worker' },
    )).toBe(true)
  })

  it('returns false when any selector does not match', () => {
    expect(matchesLabelSelectors(
      ['env=prod', 'role=admin'],
      { env: 'prod', role: 'worker' },
    )).toBe(false)
  })
})

function createMockPeer(overrides: Record<string, any> = {}) {
  return {
    name: 'test-module',
    peer: { id: 'peer-1' },
    identity: {
      id: 'instance-1',
      plugin: { id: 'plugin-1', labels: { env: 'prod' } },
      labels: { role: 'worker' },
    },
    ...overrides,
  } as any
}

describe('matchesRouteExpression', () => {
  const peer = createMockPeer()

  describe('glob', () => {
    it('matches peer name', () => {
      expect(matchesRouteExpression({ type: 'glob', glob: 'test-module' }, peer)).toBe(true)
    })

    it('matches plugin id', () => {
      expect(matchesRouteExpression({ type: 'glob', glob: 'plugin-1' }, peer)).toBe(true)
    })

    it('matches instance id', () => {
      expect(matchesRouteExpression({ type: 'glob', glob: 'instance-1' }, peer)).toBe(true)
    })

    it('supports wildcard', () => {
      expect(matchesRouteExpression({ type: 'glob', glob: 'test-*' }, peer)).toBe(true)
    })

    it('does not match unrelated glob', () => {
      expect(matchesRouteExpression({ type: 'glob', glob: 'other-*' }, peer)).toBe(false)
    })

    it('supports inverted flag', () => {
      expect(matchesRouteExpression({ type: 'glob', glob: 'test-module', inverted: true }, peer)).toBe(false)
      expect(matchesRouteExpression({ type: 'glob', glob: 'no-match', inverted: true }, peer)).toBe(true)
    })
  })

  describe('ids', () => {
    it('matches peer id', () => {
      expect(matchesRouteExpression({ type: 'ids', ids: ['peer-1'] }, peer)).toBe(true)
    })

    it('does not match wrong peer id', () => {
      expect(matchesRouteExpression({ type: 'ids', ids: ['peer-2'] }, peer)).toBe(false)
    })
  })

  describe('plugin', () => {
    it('matches plugin id', () => {
      expect(matchesRouteExpression({ type: 'plugin', plugins: ['plugin-1'] }, peer)).toBe(true)
    })

    it('does not match wrong plugin id', () => {
      expect(matchesRouteExpression({ type: 'plugin', plugins: ['plugin-2'] }, peer)).toBe(false)
    })
  })

  describe('instance', () => {
    it('matches instance id', () => {
      expect(matchesRouteExpression({ type: 'instance', instances: ['instance-1'] }, peer)).toBe(true)
    })

    it('does not match wrong instance id', () => {
      expect(matchesRouteExpression({ type: 'instance', instances: ['instance-2'] }, peer)).toBe(false)
    })
  })

  describe('label', () => {
    it('matches labels from plugin and identity', () => {
      expect(matchesRouteExpression({ type: 'label', selectors: ['env=prod'] }, peer)).toBe(true)
      expect(matchesRouteExpression({ type: 'label', selectors: ['role=worker'] }, peer)).toBe(true)
    })

    it('does not match absent label', () => {
      expect(matchesRouteExpression({ type: 'label', selectors: ['env=staging'] }, peer)).toBe(false)
    })
  })

  describe('module', () => {
    it('matches peer name', () => {
      expect(matchesRouteExpression({ type: 'module', modules: ['test-module'] }, peer)).toBe(true)
    })

    it('does not match wrong name', () => {
      expect(matchesRouteExpression({ type: 'module', modules: ['other'] }, peer)).toBe(false)
    })
  })

  describe('source', () => {
    it('matches peer name', () => {
      expect(matchesRouteExpression({ type: 'source', sources: ['test-module'] }, peer)).toBe(true)
    })
  })

  describe('and', () => {
    it('returns true only when all sub-expressions match', () => {
      expect(matchesRouteExpression({
        type: 'and',
        all: [
          { type: 'module', modules: ['test-module'] },
          { type: 'label', selectors: ['env=prod'] },
        ],
      }, peer)).toBe(true)
    })

    it('returns false when any sub-expression fails', () => {
      expect(matchesRouteExpression({
        type: 'and',
        all: [
          { type: 'module', modules: ['test-module'] },
          { type: 'label', selectors: ['env=staging'] },
        ],
      }, peer)).toBe(false)
    })
  })

  describe('or', () => {
    it('returns true when any sub-expression matches', () => {
      expect(matchesRouteExpression({
        type: 'or',
        any: [
          { type: 'module', modules: ['no-match'] },
          { type: 'label', selectors: ['env=prod'] },
        ],
      }, peer)).toBe(true)
    })

    it('returns false when no sub-expression matches', () => {
      expect(matchesRouteExpression({
        type: 'or',
        any: [
          { type: 'module', modules: ['no-match'] },
          { type: 'label', selectors: ['env=staging'] },
        ],
      }, peer)).toBe(false)
    })
  })

  it('returns false for unknown expression type', () => {
    expect(matchesRouteExpression({ type: 'unknown' } as any, peer)).toBe(false)
  })
})

describe('matchesDestination', () => {
  const peer = createMockPeer()

  it('matches wildcard *', () => {
    expect(matchesDestination('*', peer)).toBe(true)
  })

  it('matches plugin: prefix', () => {
    expect(matchesDestination('plugin:plugin-1', peer)).toBe(true)
  })

  it('matches instance: prefix', () => {
    expect(matchesDestination('instance:instance-1', peer)).toBe(true)
  })

  it('matches peer: prefix', () => {
    expect(matchesDestination('peer:peer-1', peer)).toBe(true)
  })

  it('matches module: prefix', () => {
    expect(matchesDestination('module:test-module', peer)).toBe(true)
  })

  it('matches label: prefix', () => {
    expect(matchesDestination('label:env=prod', peer)).toBe(true)
  })

  it('uses glob matching for plain string against name/plugin/instance', () => {
    expect(matchesDestination('test-*', peer)).toBe(true)
    expect(matchesDestination('plugin-1', peer)).toBe(true)
    expect(matchesDestination('no-match', peer)).toBe(false)
  })

  it('delegates RouteTargetExpression objects to matchesRouteExpression', () => {
    expect(matchesDestination({ type: 'module', modules: ['test-module'] }, peer)).toBe(true)
  })
})

describe('matchesDestinations', () => {
  const peer = createMockPeer()

  it('returns true if any destination matches (OR logic)', () => {
    expect(matchesDestinations(['no-match', 'test-module'], peer)).toBe(true)
  })

  it('returns false if no destination matches', () => {
    expect(matchesDestinations(['no-match', 'also-no-match'], peer)).toBe(false)
  })
})
