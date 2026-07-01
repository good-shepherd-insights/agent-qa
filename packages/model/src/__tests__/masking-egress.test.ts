import type { LanguageModelV3CallOptions } from '@ai-sdk/provider'
import type { ModelProfile } from '@vostride/agent-qa-schema'
import {
  createMaskingContext,
  setActiveMaskingContextResolver,
} from '@vostride/agent-qa-safety'
import { afterEach, describe, expect, it } from 'vitest'

import type { ResolvedModelAuth } from '../auth.js'
import { createModel } from '../registry.js'
import { stubGenerateResult, stubModel } from './stub-model.js'

const noneAuth: ResolvedModelAuth = { kind: 'none' }
const secret = 'sk-live-abcdef0123456789'

const baseModelProfile: ModelProfile = {
  provider: 'openai-compatible',
  model: 'override-model',
  baseURL: 'http://localhost:11434/v1',
  auth: { mode: 'none' },
}

afterEach(() => {
  setActiveMaskingContextResolver(() => undefined)
})

describe('masking egress middleware', () => {
  it('masks active-context prompt secrets at the captured provider boundary', async () => {
    const ctx = createMaskingContext()
    ctx.register(secret)
    // The ALS adapter itself is proven in 345-03. This test installs the
    // resolver directly to prove createModel egress reaches the masking hook.
    setActiveMaskingContextResolver(() => ctx)

    const { captured, model } = createCapturingModel()

    await model.doGenerate(promptRequest(`use ${secret}`))

    const text = capturedUserText(captured())
    expect(text).toContain('<SECRET_0>')
    expect(text).not.toContain(secret)
  })

  it('passes params through unchanged when no masking context is active', async () => {
    const { captured, model } = createCapturingModel()
    const request = promptRequest(`use ${secret}`)

    await model.doGenerate(request)

    expect(captured()).toEqual(request)
  })

  it('masks planner-shaped and verifier-shaped createModel results', async () => {
    const ctx = createMaskingContext()
    ctx.register(secret)
    setActiveMaskingContextResolver(() => ctx)

    const planner = createCapturingModel()
    const verifier = createCapturingModel()

    await planner.model.doGenerate(promptRequest(`planner uses ${secret}`))
    await verifier.model.doGenerate(promptRequest(`verifier uses ${secret}`))

    for (const captured of [planner.captured(), verifier.captured()]) {
      const text = capturedUserText(captured)
      expect(text).toContain('<SECRET_0>')
      expect(text).not.toContain(secret)
    }

    // Curator reuses plannerModel (cli/src/commands/run.ts:2623), so it rides
    // the same createModel seam and needs no separate model fixture here.
  })

  it.todo('variable-extractor egress masking - pending M1 (role does not exist yet)')
  it.todo('asserter egress masking - pending M4 (role is thin today)')
})

function createCapturingModel(): {
  captured: () => LanguageModelV3CallOptions | undefined
  model: ReturnType<typeof createModel>
} {
  let captured: LanguageModelV3CallOptions | undefined
  const model = createModel({ ...baseModelProfile }, noneAuth, {
    languageModels: {
      'override-model': stubModel({
        async doGenerate(params) {
          captured = params
          return stubGenerateResult()
        },
      }),
    },
  })

  return {
    captured: () => captured,
    model,
  }
}

function promptRequest(text: string): LanguageModelV3CallOptions {
  return {
    prompt: [
      {
        role: 'user',
        content: [{ type: 'text', text }],
      },
    ],
  }
}

function capturedUserText(captured: LanguageModelV3CallOptions | undefined): string {
  expect(captured).toBeDefined()
  const message = captured?.prompt[0]
  expect(message?.role).toBe('user')
  if (message?.role !== 'user') throw new Error('expected captured user message')

  const part = message.content[0]
  expect(part?.type).toBe('text')
  if (part?.type !== 'text') throw new Error('expected captured text part')

  return part.text
}
