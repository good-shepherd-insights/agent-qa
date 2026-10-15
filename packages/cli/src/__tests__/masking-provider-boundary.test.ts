// The captured provider boundary of a run-shaped createModel (C441-EGRESS). 2026-10-15 (441-30,
// D-12/D-15): the stamped-audit integration proof is deleted with the per-run hook registrar.

import { SecretRedactor, SecretStore } from '@vostride/agent-qa-runner'
import { createModel } from '@vostride/agent-qa-model'
import type { ResolvedModelAuth } from '@vostride/agent-qa-model'
import { describe, expect, it } from 'vitest'

// Derive the AI-SDK shapes from `createModel` itself — the CLI package declares neither
// @ai-sdk/provider nor @vostride/agent-qa-schema, and this proof needs neither.
type StubLanguageModel = ReturnType<typeof createModel>
type CapturedCallOptions = Parameters<StubLanguageModel['doGenerate']>[0]
type StubGenerateResult = Awaited<ReturnType<StubLanguageModel['doGenerate']>>

const noneAuth: ResolvedModelAuth = { kind: 'none' }

const fileSecret = 'file-secret-passphrase-alpha'
const envSecret = 'env-token-passphrase-bravo'
const cookieSecret = 'cookie-session-passphrase-charlie'

function stubGenerateResult(): StubGenerateResult {
  return {
    content: [],
    finishReason: { unified: 'stop', raw: 'stop' },
    usage: {
      inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 0, text: 0, reasoning: 0 },
    },
    warnings: [],
  }
}

function createCapturingModel(mask: (text: string) => string): {
  captured: () => CapturedCallOptions | undefined
  model: StubLanguageModel
} {
  let captured: CapturedCallOptions | undefined
  const stub: StubLanguageModel = {
    specificationVersion: 'v3',
    provider: 'stub',
    modelId: 'stub',
    supportedUrls: {},
    async doGenerate(params) {
      captured = params
      return stubGenerateResult()
    },
    async doStream() {
      return { stream: new ReadableStream() }
    },
  }
  const model = createModel(
    {
      provider: 'openai-compatible',
      model: 'override-model',
      baseURL: 'http://localhost:11434/v1',
      auth: { mode: 'none' },
    },
    noneAuth,
    mask,
    { languageModels: { 'override-model': stub } },
  )
  return { captured: () => captured, model }
}

function promptRequest(text: string): CapturedCallOptions {
  return {
    prompt: [
      {
        role: 'user',
        content: [{ type: 'text', text }],
      },
    ],
  }
}

function capturedUserText(captured: CapturedCallOptions | undefined): string {
  expect(captured).toBeDefined()
  const message = captured?.prompt[0]
  expect(message?.role).toBe('user')
  if (message?.role !== 'user') throw new Error('expected captured user message')

  const part = message.content[0]
  expect(part?.type).toBe('text')
  if (part?.type !== 'text') throw new Error('expected captured text part')

  return part.text
}

describe('C441-EGRESS', () => {
  it('a run-shaped model masks the declared value and nothing else', async () => {
    const redactor = new SecretRedactor(
      SecretStore.fromEnvContent(`MY_SERVICE_SECRET=${fileSecret}`),
    )
    const { captured, model } = createCapturingModel((text) => redactor.redactString(text))

    await model.doGenerate(
      promptRequest(`file=${fileSecret} env=${envSecret} cookie=${cookieSecret}`),
    )

    expect(capturedUserText(captured())).toBe(
      `file=[secret:MY_SERVICE_SECRET] env=${envSecret} cookie=${cookieSecret}`,
    )
    expect(JSON.stringify(captured())).not.toContain(fileSecret)
  })
})
