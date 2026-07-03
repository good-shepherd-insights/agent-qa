import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ActionPlan } from '@vostride/agent-qa-runner'
import { hashStepInstruction } from '../step-hash.js'
import { FileActionCache } from '../file-cache.js'
import {
  CoreActionPlanCacheAdapter,
  computeSubActionStepHash,
  type CacheKeyConstants,
} from '../action-plan-cache-adapter.js'

const plan = (reasoning: string): ActionPlan => ({
  reasoning,
  action: { type: 'click', ref: 'e2' },
  confidence: 1,
  stepComplete: true,
})

describe('computeSubActionStepHash — v1 key compatibility (D-03)', () => {
  it('is byte-identical to the v1 hashStepInstruction for fixed inputs', () => {
    const constants: CacheKeyConstants = {
      platform: 'web',
      configContent: 'cfg-content',
      testFileContent: 'test-content',
      stepIndex: 3,
      suiteFileContent: 'suite-content',
      suiteTestIndex: 2,
    }
    const step = 'click the login button'

    const adapterKey = computeSubActionStepHash(step, constants)
    const v1Key = hashStepInstruction({ step, ...constants })

    expect(adapterKey).toBe(v1Key)
    expect(adapterKey).toMatch(/^[0-9a-f]{16}$/)
  })

  it('matches v1 default handling for omitted constants', () => {
    const step = 'open settings'
    expect(computeSubActionStepHash(step, {})).toBe(hashStepInstruction({ step }))
  })

  it('differs when any keyed constant differs (poisoning guard)', () => {
    const step = 'click login'
    const a = computeSubActionStepHash(step, { configContent: 'A' })
    const b = computeSubActionStepHash(step, { configContent: 'B' })
    expect(a).not.toBe(b)
  })
})

describe('CoreActionPlanCacheAdapter — round-trip through FileActionCache', () => {
  let dir: string
  let cache: FileActionCache
  let adapter: CoreActionPlanCacheAdapter
  const constants: CacheKeyConstants = { platform: 'web', configContent: 'cfg', stepIndex: 0 }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'apc-adapter-'))
    cache = new FileActionCache({ dir, ttl: '7d' })
    adapter = new CoreActionPlanCacheAdapter(cache, constants)
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('set/get round-trips through the composed v1 key', async () => {
    const key = { stepInstruction: 'click the login button' }
    expect(await adapter.getSubAction(key, 0)).toBeNull()

    await adapter.setSubAction(key, 0, plan('first'))
    const got = await adapter.getSubAction(key, 0)
    expect(got?.reasoning).toBe('first')

    // The composed key equals the v1 hash — the on-disk entry is byte-addressable by v1.
    const v1Hash = hashStepInstruction({ step: key.stepInstruction, ...constants })
    expect((await cache.getSubAction(v1Hash, 0))?.reasoning).toBe('first')
  })

  it('invalidateSubActionsFrom removes entries at and after the index', async () => {
    const key = { stepInstruction: 'multi-action step' }
    await adapter.setSubAction(key, 0, plan('a0'))
    await adapter.setSubAction(key, 1, plan('a1'))
    await adapter.setSubAction(key, 2, plan('a2'))

    await adapter.invalidateSubActionsFrom(key, 1)

    expect((await adapter.getSubAction(key, 0))?.reasoning).toBe('a0')
    expect(await adapter.getSubAction(key, 1)).toBeNull()
    expect(await adapter.getSubAction(key, 2)).toBeNull()
  })
})
