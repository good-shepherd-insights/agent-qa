import { APICallError } from '@ai-sdk/provider'
import { globSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ModelProfile } from '@vostride/agent-qa-schema'

import { capabilityKey, overrideStore } from '../capability/override-store.js'
import { resolveCapabilities } from '../capability/resolve.js'
import { createModel } from '../registry.js'
import type { ResolvedModelAuth } from '../auth.js'
import { stubModel } from './stub-model.js'

const noneAuth: ResolvedModelAuth = { kind: 'none' }
const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

function profile(): ModelProfile {
  return {
    provider: 'openai-compatible',
    model: 'override-model',
    baseURL: 'http://localhost:11434/v1',
    auth: { mode: 'none' },
  }
}

function overflowError(): APICallError {
  return new APICallError({
    message: "This model's maximum context length is 32768 tokens. However, you requested 40000 tokens",
    url: 'http://localhost/v1/chat/completions',
    requestBodyValues: {},
    statusCode: 400,
    responseHeaders: {},
    responseBody: '',
    isRetryable: false,
  })
}

describe('capability resolution network boundary', () => {
  beforeEach(() => {
    overrideStore.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does not call fetch while resolving, auto-filling, or observing overflow', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const modelProfile = profile()
    const overflow = overflowError()
    const model = createModel(modelProfile, noneAuth, {
      languageModels: {
        'override-model': stubModel({
          async generate() {
            throw overflow
          },
        }),
      },
    })

    resolveCapabilities(modelProfile)
    await expect(model.doGenerate({ prompt: [] })).rejects.toBe(overflow)

    expect(overrideStore.get(capabilityKey(modelProfile.provider, modelProfile.model))).toBe(32768)
    expect(fetchSpy).toHaveBeenCalledTimes(0)
  })
})

describe('capability generator runtime import guard', () => {
  it('keeps models.dev generation out of runtime source', () => {
    const offenders = globSync('**/*.ts', { cwd: srcRoot })
      .filter(file => !file.includes('__tests__'))
      .filter((file) => {
        const source = readFileSync(join(srcRoot, file), 'utf8')
        return /gen-capability-table|family-table\.generated/.test(source)
      })

    expect(offenders).toEqual([])
  })
})
