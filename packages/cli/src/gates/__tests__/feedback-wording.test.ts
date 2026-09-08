import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { LOCAL_CURATION_CAPABILITIES } from '@vostride/agent-qa-agent-local'
import { createMaskingContext, getActiveMaskingContext } from '@vostride/agent-qa-safety'
import type { createModel } from '@vostride/agent-qa-model'
import type { ImprovementPlan } from '@vostride/agent-qa-schema'
import { generateText } from 'ai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveEvalSession } from '../../eval-session-composition.js'
import * as llm from '../../llm-utils.js'
import { assertSameStructure, wordImprovementPlan, WORDING_MAX_OUTPUT_TOKENS, WORDING_TIMEOUT_MS, type WordingInput } from '../feedback-wording.js'
import { markFixture } from './feedback-fixture.js'

vi.mock('ai', async original => ({ ...await original<typeof import('ai')>(), generateText: vi.fn() }))

describe('419 bounded feedback wording', () => {
  let root: string
  let input: WordingInput
  let model: ReturnType<typeof vi.fn<typeof createModel>>
  beforeEach(async () => {
    const f = markFixture(); root = f.root
    const member = f.handoff.tests[0]!
    const facts = LOCAL_CURATION_CAPABILITIES.readFeedbackRecord({ knowledgeRoot: f.knowledgeRoot,
      recordId: f.published.id, evidenceRef: member.steps[0]!.subActions[0]!.decisionScreenshotRef })
    if (!facts) throw new Error('fixture facts required')
    const plan = LOCAL_CURATION_CAPABILITIES.applyFeedback({ mark: { markId: 'mark_0123456789ab',
      runId: f.handoff.runId, runSlug: 'fixture', testIndex: 0, kind: 'false-fail' },
      handoff: f.handoff, resolvedStepIndex: 0, served: [facts] })
    const session = await resolveEvalSession({ configPath: f.configPath, keyOnly: true })
    session.config.registry = { llms: [{ name: 'fixture', provider: 'openai-compatible', model: 'fixture-model', vision: false, baseURL: 'http://127.0.0.1:1/v1' }] }
    session.config.use = { ...session.config.use, llm: 'fixture' }
    model = vi.fn<typeof createModel>(() => ({}) as ReturnType<typeof createModel>)
    input = { plan, config: session.config, executionContext: 'ci', maskingContextFactory: createMaskingContext,
      auditDir: join(root, 'word-audit'), createModelForTest: model }
    vi.spyOn(llm, 'resolveModelAuth').mockResolvedValue({ kind: 'unauthenticated', credentialKey: 'fixture', provider: 'openai-compatible', optional: true, message: 'controlled fixture' })
    vi.mocked(generateText).mockReset()
  })
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); rmSync(root, { recursive: true, force: true }) })

  it('no model config returns floor immediately with zero model, auth and masking calls', async () => {
    const maskingContextFactory = vi.fn(createMaskingContext)
    const started = performance.now()
    expect(await wordImprovementPlan({ ...input, config: undefined, maskingContextFactory })).toEqual(input.plan)
    const elapsed = performance.now() - started
    expect(elapsed).toBeLessThan(100)
    console.info(`419 wording floor latency: ${elapsed.toFixed(3)} ms`)
    expect(model).not.toHaveBeenCalled()
    expect(llm.resolveModelAuth).not.toHaveBeenCalled()
    expect(maskingContextFactory).not.toHaveBeenCalled()
  })

  it('valid text uses one model inside the safety scope with fixed token/retry/timeout bounds', async () => {
    vi.mocked(generateText).mockImplementation(async options => {
      expect(getActiveMaskingContext()).toBeDefined()
      expect(options).toMatchObject({ maxOutputTokens: WORDING_MAX_OUTPUT_TOKENS, maxRetries: 0, temperature: 0 })
      expect(options.abortSignal).toBeInstanceOf(AbortSignal)
      return { text: JSON.stringify({ summary: 'Clarified record', body: 'Clarified evidence only.' }) } as Awaited<ReturnType<typeof generateText>>
    })
    const result = await wordImprovementPlan(input)
    expect(result).toMatchObject({ wording: 'model' })
    assertSameStructure(input.plan, result)
    expect(model).toHaveBeenCalledOnce()
    expect(generateText).toHaveBeenCalledOnce()
  })

  it.each([
    { kind: 'caution', summary: 'Changed kind', body: 'Untrusted shape' },
    { summary: 's'.repeat(161), body: 'Too long' },
    { summary: 'Fine', body: 'b'.repeat(1201) },
  ])('structural or length violation returns the original floor', async payload => {
    vi.mocked(generateText).mockResolvedValue({ text: JSON.stringify(payload) } as Awaited<ReturnType<typeof generateText>>)
    expect(await wordImprovementPlan(input)).toEqual(input.plan)
    expect(model).toHaveBeenCalledOnce()
  })

  it('model failure returns floor and does not retry', async () => {
    vi.mocked(generateText).mockRejectedValue(new Error('controlled provider failure'))
    expect(await wordImprovementPlan(input)).toEqual(input.plan)
    expect(generateText).toHaveBeenCalledOnce()
  })

  it('missing credentials or a model-construction failure preserve floor without generation', async () => {
    vi.mocked(llm.resolveModelAuth).mockResolvedValueOnce({ kind: 'missing', credentialKey: 'fixture', provider: 'openai-compatible', required: true, message: 'No fixture credential' })
    expect(await wordImprovementPlan(input)).toEqual(input.plan)
    expect(model).not.toHaveBeenCalled()
    model.mockImplementation(() => { throw new Error('controlled construction failure') })
    expect(await wordImprovementPlan(input)).toEqual(input.plan)
    expect(model).toHaveBeenCalledOnce()
    expect(generateText).not.toHaveBeenCalled()
  })

  it('a model that ignores abort still returns floor at 8 seconds', async () => {
    vi.useFakeTimers()
    vi.mocked(generateText).mockImplementation(() => new Promise(() => {}))
    const pending = wordImprovementPlan(input)
    await vi.advanceTimersByTimeAsync(WORDING_TIMEOUT_MS)
    expect(await pending).toEqual(input.plan)
    expect(vi.mocked(generateText).mock.calls[0]![0].abortSignal!.aborted).toBe(true)
  })

  it('assertSameStructure rejects target, anchor, origin and delta-count drift', () => {
    if (input.plan.kind !== 'knowledge') throw new Error('knowledge fixture required')
    const changed = structuredClone(input.plan)
    changed.target = { grain: 'record', recordId: 'foreign' }
    expect(() => assertSameStructure(input.plan, changed)).toThrow()
    const deltas = structuredClone(input.plan)
    deltas.deltas.push(deltas.deltas[0]!)
    expect(() => assertSameStructure(input.plan, deltas)).toThrow()
    const origin = structuredClone(input.plan)
    origin.deltas[0]!.origin = 'agent'
    expect(() => assertSameStructure(input.plan, origin)).toThrow()
    const anchors = structuredClone(input.plan)
    const delta = anchors.deltas[0]!
    if (delta.kind !== 'Supersede') throw new Error('supersede fixture required')
    delta.newBundle.anchors = []
    expect(() => assertSameStructure(input.plan, anchors)).toThrow()
  })

  it('words only test-edit intent and returns no-draftable-fix untouched', async () => {
    const { plan } = input
    const base = { schemaVersion: 1 as const, markId: plan.markId, feedbackSource: plan.feedbackSource, runTraceRef: plan.runTraceRef }
    const edit: ImprovementPlan = { ...base, kind: 'test-edit', fix: 'test-edit', testRef: 'test.yaml::Checkout', intent: 'Fix expectation', wording: 'floor' }
    vi.mocked(generateText).mockResolvedValue({ text: '{"intent":"Correct the recorded expectation"}' } as Awaited<ReturnType<typeof generateText>>)
    const result = await wordImprovementPlan({ ...input, plan: edit })
    expect(result).toMatchObject({ intent: 'Correct the recorded expectation', wording: 'model' })
    assertSameStructure(edit, result)
    const empty: ImprovementPlan = { ...base, kind: 'no-draftable-fix', checked: { servedRecords: 0, procedureReads: 0, assertionDrift: false } }
    expect(await wordImprovementPlan({ ...input, plan: empty })).toBe(empty)
    expect(model).toHaveBeenCalledOnce()
  })
})
