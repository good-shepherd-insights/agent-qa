import { describe, it, expect } from 'vitest'
import { hashScreenState, hashStepInstruction, truncateScreenState } from '../observation.js'
import { buildAgentScreenState as makeScreenState } from './screen-fixtures.js'

describe('hashStepInstruction', () => {
  it('returns a 16-char hex string', () => {
    const hash = hashStepInstruction({ step: 'Click login' })
    expect(hash).toMatch(/^[0-9a-f]{16}$/)
  })

  it('positional overload still works', () => {
    const hash = hashStepInstruction('Click login', 'web', 'cfg', 'test')
    expect(hash).toMatch(/^[0-9a-f]{16}$/)
  })

  it('produces different hashes for different configContent', () => {
    const a = hashStepInstruction({ step: 'Click login', configContent: 'A', testFileContent: 'test' })
    const b = hashStepInstruction({ step: 'Click login', configContent: 'B', testFileContent: 'test' })
    expect(a).not.toBe(b)
  })

  it('produces different hashes for different testFileContent', () => {
    const a = hashStepInstruction({ step: 'Click login', configContent: 'cfg', testFileContent: 'A' })
    const b = hashStepInstruction({ step: 'Click login', configContent: 'cfg', testFileContent: 'B' })
    expect(a).not.toBe(b)
  })

  it('produces different hashes for different step text', () => {
    const a = hashStepInstruction({ step: 'Click login', configContent: 'cfg' })
    const b = hashStepInstruction({ step: 'Click submit', configContent: 'cfg' })
    expect(a).not.toBe(b)
  })

  it('is deterministic — same inputs produce same hash', () => {
    const inputs = { step: 'Click login', platform: 'web' as const, configContent: 'cfg' }
    expect(hashStepInstruction(inputs)).toBe(hashStepInstruction(inputs))
  })

  it('produces different hashes for different stepIndex', () => {
    const a = hashStepInstruction({ step: 'Click login', stepIndex: 0 })
    const b = hashStepInstruction({ step: 'Click login', stepIndex: 1 })
    expect(a).not.toBe(b)
  })

  it('defaults stepIndex to 0 when omitted', () => {
    const explicit = hashStepInstruction({ step: 'Click', stepIndex: 0 })
    const omitted = hashStepInstruction({ step: 'Click' })
    expect(explicit).toBe(omitted)
  })

  it('produces different hashes for different suiteFileContent', () => {
    const a = hashStepInstruction({ step: 'Click', suiteFileContent: 'suite-a.yaml content' })
    const b = hashStepInstruction({ step: 'Click', suiteFileContent: 'suite-b.yaml content' })
    expect(a).not.toBe(b)
  })

  it('produces different hashes for different suiteTestIndex', () => {
    const a = hashStepInstruction({ step: 'Click', suiteFileContent: 'suite', suiteTestIndex: 0 })
    const b = hashStepInstruction({ step: 'Click', suiteFileContent: 'suite', suiteTestIndex: 1 })
    expect(a).not.toBe(b)
  })

  it('suite run and individual run produce different hashes', () => {
    const individual = hashStepInstruction({ step: 'navigate', testFileContent: 'test.yaml' })
    const inSuite = hashStepInstruction({ step: 'navigate', testFileContent: 'test.yaml', suiteFileContent: 'suite content' })
    expect(individual).not.toBe(inSuite)
  })

  it('same test in different suites produces different hashes', () => {
    const base = { step: 'navigate', testFileContent: 'test.yaml', suiteTestIndex: 0 }
    const a = hashStepInstruction({ ...base, suiteFileContent: 'suite-a' })
    const b = hashStepInstruction({ ...base, suiteFileContent: 'suite-b' })
    expect(a).not.toBe(b)
  })

  it('same test at different suite positions gets different hashes', () => {
    const base = { step: 'navigate', testFileContent: 'test.yaml', suiteFileContent: 'suite', stepIndex: 0 }
    const t0 = hashStepInstruction({ ...base, suiteTestIndex: 0 })
    const t2 = hashStepInstruction({ ...base, suiteTestIndex: 2 })
    expect(t0).not.toBe(t2)
  })

  it('defaults suiteFileContent to empty when omitted', () => {
    const explicit = hashStepInstruction({ step: 'Click', suiteFileContent: '' })
    const omitted = hashStepInstruction({ step: 'Click' })
    expect(explicit).toBe(omitted)
  })

  it('positional overload matches object form for individual runs', () => {
    const positional = hashStepInstruction('Click', 'web', 'cfg', 'test', 2)
    const object = hashStepInstruction({ step: 'Click', platform: 'web', configContent: 'cfg', testFileContent: 'test', stepIndex: 2 })
    expect(positional).toBe(object)
  })
})

// D-06: the hash/truncate recipe is preserved verbatim across the type re-point —
// role:name join over elements + first-20 refMap bounds.y sample + viewportHeight,
// sha256 sliced to 16 hex. These pin the recipe against the typed v2 fields.
describe('hashScreenState (D-06 recipe pinned)', () => {
  it('returns a 16-char hex hash', () => {
    const hash = hashScreenState(makeScreenState())
    expect(hash).toMatch(/^[0-9a-f]{16}$/)
  })

  it('is deterministic for the same screen', () => {
    expect(hashScreenState(makeScreenState())).toBe(hashScreenState(makeScreenState()))
  })

  it('ignores element ref/value — same role:name join hashes equal', () => {
    const a = makeScreenState({
      elements: [{ ref: 'a1', role: 'button', name: 'Submit', value: 'x', attributes: {} }],
    })
    const b = makeScreenState({
      elements: [{ ref: 'z9', role: 'button', name: 'Submit', value: 'y', attributes: {} }],
    })
    expect(hashScreenState(a)).toBe(hashScreenState(b))
  })

  it('detects structural change — different role:name join', () => {
    const a = makeScreenState({ elements: [{ ref: 'e1', role: 'button', name: 'Submit', attributes: {} }] })
    const b = makeScreenState({ elements: [{ ref: 'e1', role: 'button', name: 'Cancel', attributes: {} }] })
    expect(hashScreenState(a)).not.toBe(hashScreenState(b))
  })

  it('refMap bounds.y participates — scroll changes the hash', () => {
    const a = makeScreenState({ refMap: { e1: { bounds: { x: 0, y: 100, width: 10, height: 10 } } } })
    const b = makeScreenState({ refMap: { e1: { bounds: { x: 0, y: 400, width: 10, height: 10 } } } })
    expect(hashScreenState(a)).not.toBe(hashScreenState(b))
  })
})

describe('truncateScreenState (D-06 recipe pinned)', () => {
  it('prefixes with Current page URL and returns the tree', () => {
    const result = truncateScreenState(makeScreenState({ url: 'https://example.com/dashboard', tree: 'button "Go"' }))
    expect(result).toMatch(/^Current page: https:\/\/example\.com\/dashboard/)
    expect(result).toContain('button "Go"')
  })

  it('emits a viewport summary partitioned by refMap bounds.y and viewportHeight', () => {
    const result = truncateScreenState(makeScreenState({
      metadata: { coordSpace: 'viewport', viewportWidth: 1280, viewportHeight: 800 },
      refMap: {
        e1: { bounds: { x: 0, y: 100, width: 100, height: 40 } },
        e2: { bounds: { x: 0, y: -50, width: 100, height: 40 } },
        e3: { bounds: { x: 0, y: 900, width: 100, height: 40 } },
      },
    }))
    expect(result).toContain('[viewport: 1 elements visible, 1 scrolled above, 1 below viewport]')
  })
})
