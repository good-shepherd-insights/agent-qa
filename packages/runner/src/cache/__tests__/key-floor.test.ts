// RED scaffold (Wave 0, CACHE-01 / MASK-FUT-01). Mirrors the v48 safety floor proof
// (safety/masking/__tests__/cache-key-floor.test.ts) against the runtime key builder.
// Fails until Plan 03 creates ../key.ts. Do NOT weaken any assertion to make it pass.
import { describe, expect, it } from 'vitest'

import { computeCacheKey, relevantEnvDigest } from '@vostride/agent-qa-schema'
import type { RedactedEnvVar } from '@vostride/agent-qa-schema'
import { createMaskingContext } from '@vostride/agent-qa-safety'

import { buildCacheableStepInput } from '../key.js'

const SECRET = 'sk-live-abcdef0123456789'
const ENV_SALT = 'salt'
const STEP_TEXT = `call API with ${SECRET}`

function redactedEnvVars(): RedactedEnvVar[] {
  return [{ name: 'API_KEY', present: true, kind: 'string', lengthBucket: 4 }]
}

function buildInput(stepText: string, masking?: ReturnType<typeof createMaskingContext>) {
  return buildCacheableStepInput({
    masking,
    platform: 'web',
    suiteConfigDigest: 'suite-digest',
    testConfigDigest: 'test-digest',
    stepText,
    stepIndex: 0,
    testIndex: 0,
    envVars: redactedEnvVars(),
    envSalt: ENV_SALT,
    screenIdentityHash: 'screen-hash',
  })
}

describe('runtime cache-key masking floor (CACHE-01 / MASK-FUT-01)', () => {
  it('masks stepText before it enters key material — masked key differs from raw key (D-05)', () => {
    const ctx = createMaskingContext()
    ctx.register(SECRET)

    const masked = buildInput(STEP_TEXT, ctx)
    const raw = buildInput(STEP_TEXT)

    // Leg 1: the masked step text carries no raw secret substring.
    expect(masked.stepText).not.toContain(SECRET)
    expect(raw.stepText).toContain(SECRET)

    // The env digest is value-free by construction (no secret leak through env).
    expect(masked.relevantEnvDigest).toBe(relevantEnvDigest(redactedEnvVars(), ENV_SALT))
    expect(JSON.stringify(redactedEnvVars())).not.toContain(SECRET)

    // Leg 2: masking before hashing changes the key — a raw secret can never reach it.
    expect(computeCacheKey(masked)).not.toBe(computeCacheKey(raw))
  })

  it('the ${key}.json filename derived from the masked input carries no raw secret (D-06)', () => {
    const ctx = createMaskingContext()
    ctx.register(SECRET)

    const masked = buildInput(STEP_TEXT, ctx)
    const filename = `${computeCacheKey(masked)}.json`

    expect(filename).not.toContain(SECRET)
    expect(filename.endsWith('.json')).toBe(true)
  })

  it('two masking contexts over the same secret produce the same masked key (deterministic mask)', () => {
    const a = createMaskingContext()
    const b = createMaskingContext()
    a.register(SECRET)
    b.register(SECRET)

    const maskedA = buildInput(STEP_TEXT, a)
    const maskedB = buildInput(STEP_TEXT, b)

    expect(maskedA.stepText).toBe(maskedB.stepText)
    expect(computeCacheKey(maskedA)).toBe(computeCacheKey(maskedB))
  })
})
