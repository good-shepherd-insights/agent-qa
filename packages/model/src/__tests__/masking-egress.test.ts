import type { LanguageModelV3CallOptions } from '@ai-sdk/provider'
import type { MaskFn, ModelProfile } from '@vostride/agent-qa-schema'
import {
  createMaskingContext,
  setActiveMaskingContextResolver,
} from '@vostride/agent-qa-safety'
import { afterEach, describe, expect, it } from 'vitest'

import type { ResolvedModelAuth } from '../auth.js'
import type { ModelCallEvent } from '../provider-call-report.js'
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

  it('redacts residual guardrail secret shapes when no masking context is active', async () => {
    const { captured, model } = createCapturingModel()
    const request = promptRequest(`use ${secret}`)

    await model.doGenerate(request)

    const text = capturedUserText(captured())
    expect(text).toBe('use <REDACTED:apiKey>')
    expect(text).not.toContain(secret)
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

  it('masks egress for any createModel consumer, covering variable-extractor and asserter', async () => {
    const ctx = createMaskingContext()
    ctx.register(secret)
    setActiveMaskingContextResolver(() => ctx)

    const { captured, model } = createCapturingModel()

    await model.doGenerate(promptRequest(`consumer uses ${secret}`))

    const text = capturedUserText(captured())
    expect(text).toContain('<SECRET_0>')
    expect(text).not.toContain(secret)

    // The removed role markers named live LLM-egress consumers:
    // packages/runner/src/loop/llm-variable-extractor.ts (LLMVariableExtractor, moved
    // in Phase 363 D-07) and packages/runner/src/loop/asserter.ts (LLMAssertionEvaluator,
    // wired via createAsserter). Both take a createModel-built LanguageModel, so
    // CONTEXT D-05's 2026-07-02 correction makes the unbypassable-last masking
    // middleware the structural proof; the old pending markers were a gap.
  })
})

describe('C441-EGRESS', () => {
  const declaredMask: MaskFn = (text) => text.replaceAll('q^7', '[secret:SHORT]')

  it('createModel masks a prompt with the mask it was given, after every other middleware', async () => {
    const seen: string[] = []
    const { captured, model } = createCapturingModel((text) => {
      seen.push(text)
      return declaredMask(text)
    })

    await model.doGenerate({
      prompt: [
        { role: 'system', content: '   ' },
        { role: 'user', content: [{ type: 'text', text: 'type q^7 now' }] },
      ],
    })

    expect(captured()?.prompt).toHaveLength(1)
    expect(capturedUserText(captured())).toBe('type [secret:SHORT] now')
    expect(seen).toEqual(['type q^7 now'])
  })

  it('a model built with the identity mask sends text unchanged', async () => {
    const { captured, model } = createCapturingModel((text) => text)

    await model.doGenerate(promptRequest('type q^7 now'))

    expect(capturedUserText(captured())).toBe('type q^7 now')
  })

  it('respondingModelId is masked with the injected mask', async () => {
    const events: ModelCallEvent[] = []
    const model = createModel({ ...baseModelProfile }, noneAuth, declaredMask, {
      providerReportOrigin: 'openai-chat',
      languageModels: {
        'override-model': stubModel({
          async doGenerate() {
            return { ...stubGenerateResult(), response: { modelId: 'model-q^7' } }
          },
        }),
      },
    }, { onCall: event => { events.push(event) } })

    await model.doGenerate(promptRequest('hello'))

    const success = events.find(event => event.kind === 'success')
    expect(success).toEqual({ kind: 'success', report: expect.objectContaining({
      respondingModelId: 'model-[secret:SHORT]',
    }) })
  })
})

function createCapturingModel(mask: MaskFn = (text) => text): {
  captured: () => LanguageModelV3CallOptions | undefined
  model: ReturnType<typeof createModel>
} {
  let captured: LanguageModelV3CallOptions | undefined
  const model = createModel({ ...baseModelProfile }, noneAuth, mask, {
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
