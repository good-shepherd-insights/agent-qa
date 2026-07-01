import { describe, expect, it } from 'vitest'

import { computeCacheKey, relevantEnvDigest } from '@vostride/agent-qa-schema'
import type { CacheableStepInput, RedactedEnvVar } from '@vostride/agent-qa-schema'

import { createMaskingContext } from '../context'

// Cache-key safety depends on the masked-input discipline, not on the opaque hash output.
const SECRET = 'sk-live-abcdef0123456789'
const ENV_SALT = 'salt'

function redactedEnvVars(): RedactedEnvVar[] {
  return [{ name: 'API_KEY', present: true, kind: 'string', lengthBucket: 4 }]
}

function makeInput(stepText: string, envVars: RedactedEnvVar[] = redactedEnvVars()): CacheableStepInput {
  return {
    platform: 'web',
    suiteConfigDigest: 'suite-digest',
    testConfigDigest: 'test-digest',
    stepText,
    stepIndex: 0,
    testIndex: 0,
    relevantEnvDigest: relevantEnvDigest(envVars, ENV_SALT),
    screenIdentityHash: 'screen-hash',
  }
}

function maskedInput(ctx: ReturnType<typeof createMaskingContext>): CacheableStepInput {
  return makeInput(ctx.mask(`call API with ${SECRET}`))
}

describe('cache-key masking floor', () => {
  it('computes cache keys from masked step text and value-free env digests', () => {
    const a = createMaskingContext()
    const b = createMaskingContext()
    const envVars = redactedEnvVars()

    a.register(SECRET)
    b.register(SECRET)

    const maskedA = maskedInput(a)
    const maskedB = maskedInput(b)
    const unmasked = makeInput(`call API with ${SECRET}`, envVars)

    expect(maskedA.stepText).not.toContain(SECRET)
    expect(maskedB.stepText).not.toContain(SECRET)
    expect(maskedA.stepText).toBe(maskedB.stepText)

    expect(JSON.stringify(envVars)).not.toContain(SECRET)
    expect(Object.hasOwn(envVars[0], 'value')).toBe(false)
    expect(maskedA.relevantEnvDigest).toBe(relevantEnvDigest(envVars, ENV_SALT))

    expect(computeCacheKey(maskedA)).toBe(computeCacheKey(maskedB))
    expect(computeCacheKey(unmasked)).not.toBe(computeCacheKey(maskedA))
  })
})
