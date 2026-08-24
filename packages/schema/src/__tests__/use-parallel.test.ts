import { describe, expect, it } from 'vitest'

import { DEFAULT_PARALLEL_WORKERS, resolveEffectiveWorkers, useSchema } from '../config/use'

/**
 * 402-03 (D-12): member concurrency is a CONFIG fact.
 *
 * Two halves are pinned here and nowhere else: the shape a config author may write, and the ONE
 * formula that turns it into a worker count. The formula lives beside the fields it reads so a
 * reader of either finds the other, and so both doors (`agent-qa run` and the service's
 * `runs.start`) reach one spelling rather than each folding the default themselves.
 *
 * The request half of D-12 — that a CALLER cannot name either field — is pinned in
 * `runs-start-input-posture.test.ts`.
 */
describe('use.parallel / use.workers — the authored shape', () => {
  it('accepts parallel on its own', () => {
    const result = useSchema.safeParse({ platform: 'web', parallel: true })

    expect(result.success).toBe(true)
  })

  it('accepts parallel with an explicit worker count', () => {
    const result = useSchema.safeParse({ platform: 'web', parallel: true, workers: 5 })

    expect(result.success).toBe(true)
    if (result.success) expect(result.data).toMatchObject({ parallel: true, workers: 5 })
  })

  it('accepts the fields on the mobile arms too — concurrency is not a web-only knob', () => {
    for (const platform of ['android', 'ios'] as const) {
      const result = useSchema.safeParse({ platform, device: 'pixel', parallel: true, workers: 2 })

      expect(result.success).toBe(true)
    }
  })

  it('parses with both fields absent — the addition is optional, not a new requirement', () => {
    const result = useSchema.safeParse({ platform: 'web', browser: { name: 'chromium' } })

    expect(result.success).toBe(true)
    if (result.success) {
      expect('parallel' in result.data).toBe(false)
      expect('workers' in result.data).toBe(false)
    }
  })

  it('refuses workers: 0', () => {
    const result = useSchema.safeParse({ platform: 'web', parallel: true, workers: 0 })

    expect(result.success).toBe(false)
  })

  it('refuses a negative worker count', () => {
    const result = useSchema.safeParse({ platform: 'web', parallel: true, workers: -2 })

    expect(result.success).toBe(false)
  })

  it('refuses a non-integer worker count', () => {
    const result = useSchema.safeParse({ platform: 'web', parallel: true, workers: 2.5 })

    expect(result.success).toBe(false)
  })

  it('refuses a worker count that is not a number at all', () => {
    const result = useSchema.safeParse({ platform: 'web', parallel: true, workers: '4' })

    expect(result.success).toBe(false)
  })
})

describe('resolveEffectiveWorkers — the one formula', () => {
  it('resolves 1 when parallel is absent, whatever workers says', () => {
    expect(resolveEffectiveWorkers({ memberCount: 8 })).toBe(1)
    expect(resolveEffectiveWorkers({ workers: 6, memberCount: 8 })).toBe(1)
  })

  it('resolves 1 when parallel is explicitly false', () => {
    expect(resolveEffectiveWorkers({ parallel: false, workers: 6, memberCount: 8 })).toBe(1)
  })

  it('resolves the default ceiling when parallel is true and workers is absent', () => {
    expect(DEFAULT_PARALLEL_WORKERS).toBe(3)
    expect(resolveEffectiveWorkers({ parallel: true, memberCount: 8 })).toBe(DEFAULT_PARALLEL_WORKERS)
  })

  it('is bounded by the member count — 8 workers over 4 members is 4', () => {
    expect(resolveEffectiveWorkers({ parallel: true, workers: 8, memberCount: 4 })).toBe(4)
  })

  it('is bounded by the requested count — 2 workers over 9 members is 2', () => {
    expect(resolveEffectiveWorkers({ parallel: true, workers: 2, memberCount: 9 })).toBe(2)
  })

  it('never resolves below 1, including for a zero-member run', () => {
    expect(resolveEffectiveWorkers({ parallel: true, workers: 4, memberCount: 0 })).toBe(1)
    expect(resolveEffectiveWorkers({ parallel: true, memberCount: 0 })).toBe(1)
  })

  it('resolves the default ceiling for a value the schema would have refused', () => {
    // Defence in depth, not a second policy: the schema refuses 0/negative/non-integer/non-finite,
    // so these inputs can only arrive from a door that skipped it. They resolve to the SAME
    // conservative answer an absent count does rather than to unbounded concurrency (T-402-12).
    expect(resolveEffectiveWorkers({ parallel: true, workers: 0, memberCount: 8 })).toBe(DEFAULT_PARALLEL_WORKERS)
    expect(resolveEffectiveWorkers({ parallel: true, workers: -4, memberCount: 8 })).toBe(DEFAULT_PARALLEL_WORKERS)
    expect(resolveEffectiveWorkers({ parallel: true, workers: Number.NaN, memberCount: 8 })).toBe(DEFAULT_PARALLEL_WORKERS)
    expect(resolveEffectiveWorkers({ parallel: true, workers: Number.POSITIVE_INFINITY, memberCount: 8 }))
      .toBe(DEFAULT_PARALLEL_WORKERS)
  })

  it('floors a fractional worker count rather than handing the pool a fraction', () => {
    expect(resolveEffectiveWorkers({ parallel: true, workers: 2.9, memberCount: 8 })).toBe(2)
  })
})

describe('the source pin: one declaration of the formula', () => {
  it('declares resolveEffectiveWorkers exactly once, in the module that owns the fields', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const source = readFileSync(join(import.meta.dirname, '..', 'config', 'use.ts'), 'utf8')

    expect(source.match(/export function resolveEffectiveWorkers/g)).toHaveLength(1)
    // The default lives with the formula and is exported, so no consumer needs to retype a 3.
    expect(source.match(/export const DEFAULT_PARALLEL_WORKERS = 3/g)).toHaveLength(1)
  })
})
