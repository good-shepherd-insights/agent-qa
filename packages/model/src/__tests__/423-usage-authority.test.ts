import { generateText } from 'ai'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ModelProfile } from '@vostride/agent-qa-schema'
import { GuardrailBlockError, setActiveMaskingContextResolver } from '@vostride/agent-qa-safety'
import { createModel } from '../registry.js'
import { stubGenerateResult, stubModel } from './stub-model.js'
import type { ModelCallEvent, ModelCallReport } from '../index.js'

// A structural consumer lets RED exercise the existing invocation boundary without
// a missing-export/type/load failure standing in for the planned behavior.
type Event = { kind: ModelCallEvent['kind']; report?: ModelCallReport }
const transports = [
  'openai-compatible', 'openai-subscription', 'anthropic-compatible',
  'anthropic-subscription', 'gemini',
] as const
type Transport = typeof transports[number]
const declared = 'fixture-model'

function profile(provider: string): ModelProfile {
  return { provider, model: declared, baseURL: 'https://fixture.invalid/v1', auth: { mode: 'none' } }
}

function body(provider: Transport, cache?: number, model: string | undefined = 'reported-model') {
  if (provider.startsWith('anthropic')) return {
    id: 'msg_fixture', type: 'message', role: 'assistant', model,
    content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', stop_sequence: null,
    usage: { input_tokens: 60, output_tokens: 7, cache_creation_input_tokens: 10,
      ...(cache === undefined ? {} : { cache_read_input_tokens: cache }) },
  }
  if (provider === 'gemini') return {
    candidates: [{ content: { role: 'model', parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
    modelVersion: model,
    usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 7,
      ...(cache === undefined ? {} : { cachedContentTokenCount: cache }) },
  }
  if (provider === 'openai-subscription') return {
    id: 'resp_fixture', created_at: 1, model, object: 'response',
    output: [{ type: 'message', id: 'item_fixture', role: 'assistant',
      content: [{ type: 'output_text', text: 'ok', annotations: [] }] }],
    usage: { input_tokens: 100, output_tokens: 7,
      ...(cache === undefined ? {} : { input_tokens_details: { cached_tokens: cache } }) },
  }
  return {
    id: 'chat_fixture', created: 1, model,
    choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 100, completion_tokens: 7,
      ...(cache === undefined ? {} : { prompt_tokens_details: { cached_tokens: cache } }) },
  }
}

function transportModel(provider: Transport, cache?: number, model?: string) {
  const events: Event[] = []
  const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(
    JSON.stringify(body(provider, cache, model)), { headers: { 'content-type': 'application/json' } },
  ))
  vi.stubGlobal('fetch', fetch)
  const observation = { onCall: (event: Event) => events.push(event), onProviderCall: vi.fn() }
  const raw = createModel(profile(provider), provider.endsWith('subscription')
    ? { kind: 'auth-fetch', modelAdapter: provider.startsWith('openai')
      ? 'openai-responses' : 'anthropic-messages', fetch }
    : { kind: 'none' }, {}, observation)
  return { raw, events, fetch, observation }
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); setActiveMaskingContextResolver(() => undefined) })

describe.each(transports)('423 usage authority: %s', (provider) => {
  it.each([
    ['USAGE-RAW-ABSENT', undefined], ['USAGE-RAW-ZERO', 0], ['USAGE-RAW-NONZERO', 30],
  ] as const)('%s', async (_cell, cache) => {
    const { raw, events, fetch, observation } = transportModel(provider, cache)
    const result = await raw.doGenerate({ prompt: [] })
    expect(result.usage.inputTokens.cacheRead).toBe(cache ?? 0)
    expect(events.map(event => event.kind)).toEqual(['start', 'success'])
    expect(events[1]?.report).toEqual({ inputTokens: provider.startsWith('anthropic')
      ? 70 + (cache ?? 0) : 100, outputTokens: 7, respondingModelId: 'reported-model',
      ...(cache === undefined ? {} : { cachedInputTokens: cache }) })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(observation.onProviderCall.mock.calls).toEqual([[]])
  })

  it.each(['MODEL-REPORTED', 'MODEL-SAME-AS-DECLARED'])('%s', async (cell) => {
    const identity = cell === 'MODEL-REPORTED' ? 'routed-model' : declared
    const { raw, events } = transportModel(provider, 0, identity)
    await generateText({ model: raw, prompt: 'hello', maxRetries: 0 })
    expect(events[1]?.report?.respondingModelId).toBe(identity)
  })
})

it('MODEL-SDK-FALLBACK and CUSTOM-UNKNOWN reject normalized custom facts', async () => {
  const events: Event[] = []
  const result = stubGenerateResult([{ type: 'text', text: 'ok' }])
  result.usage.inputTokens.total = 100
  result.usage.outputTokens.total = 7
  const observation = { onProviderCall: vi.fn(), onCall: (event: Event) => events.push(event) }
  const raw = createModel(profile('openai-compatible'), { kind: 'none' }, {
    languageModels: { [declared]: stubModel({ modelId: declared, generate: async () => result }) },
  }, observation)
  const generated = await generateText({ model: raw, prompt: 'hello', maxRetries: 0 })
  expect(generated.response.modelId).toBe(declared)
  expect(events).toEqual([{ kind: 'start' }, { kind: 'success', report: { inputTokens: 100, outputTokens: 7 } }])
})

it('PRE-DISPATCH-REFUSAL does not start or complete an observed call', async () => {
  const { raw, events, fetch, observation } = transportModel('openai-compatible')
  await expect(raw.doGenerate({ prompt: [{ role: 'user', content: [
    { type: 'text', text: 'AKIAIOSFODNN7EXAMPLE' },
  ] }] })).rejects.toBeInstanceOf(GuardrailBlockError)
  expect(events).toEqual([])
  expect(fetch).not.toHaveBeenCalled()
  expect(observation.onProviderCall).not.toHaveBeenCalled()
})
