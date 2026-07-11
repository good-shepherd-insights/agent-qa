// Phase 370 judge-port provider-boundary proofs (JUDGE-03). Every test drives bindJudgePort over
// the capturingStub seam injected through createModel's `overrides.languageModels`: doGenerate
// params are captured POST the pinned-last mask/guardrail middleware — the exact provider
// boundary. Offline by construction: the caller profile points at an unreachable baseURL, so any
// accidental live call fails fast; no network configuration exists anywhere in this file.
//
// Scope note: safety-scope AUDIT coverage of judge calls (guardrail/execution rows under the
// replay output dir) is asserted in the composition test (370-07) — this file proves the
// provider boundary only: temperature 0, framed prompt transport, structured text-JSON verdicts,
// typed error degradation, and per-call independence.

import { describe, expect, it } from 'vitest'

import { bindJudgePort } from '../judge-binding.js'
import {
  allContentParts,
  capturingStub,
  judgeGenerateResult,
  noneAuth,
  stubProfile,
  throwingStub,
} from './fixtures/replay-fixtures.js'
import type { CapturedCallOptions, StubGenerateResult } from './fixtures/replay-fixtures.js'

const SYSTEM = 'You are a strict equivalence judge. Respond with a JSON verdict object.'

const FRAMED_PROMPT = [
  'Are ITEM A and ITEM B the same control?',
  '--- BEGIN UNTRUSTED DATA ---',
  'ITEM A: button Continue',
  'ITEM B: button "Continue"',
  '--- END UNTRUSTED DATA ---',
].join('\n')

/** The user-turn text at the provider boundary (the transported judge prompt). */
function boundaryUserText(captured: CapturedCallOptions): string {
  return allContentParts(captured)
    .filter((part) => part.type === 'text')
    .map((part) => String(part.text))
    .join('\n')
}

/** A prose (non-JSON) response over the judge skeleton — the unparseable path. */
function proseGenerateResult(): StubGenerateResult {
  return {
    ...judgeGenerateResult('equivalent', 'high'),
    content: [{ type: 'text', text: 'the two items look like the same control to me' }],
  }
}

describe('judgeGenerateResult fixture', () => {
  it('returns a text content part whose text JSON-parses to the verdict object', () => {
    const result = judgeGenerateResult('different', 'medium', 'the labels disagree')
    expect(result.content).toHaveLength(1)
    const part = result.content[0]!
    expect(part.type).toBe('text')
    expect(JSON.parse((part as { type: 'text'; text: string }).text)).toEqual({
      verdict: 'different',
      confidence: 'medium',
      rationale: 'the labels disagree',
    })
  })
})

describe('bindJudgePort provider boundary', () => {
  it('sends temperature 0 and the framed prompt intact at the provider boundary', async () => {
    const stub = capturingStub(() => judgeGenerateResult('equivalent', 'high'))
    const port = bindJudgePort({
      profile: stubProfile(),
      auth: noneAuth,
      modelOverrides: { languageModels: stub.languageModels },
    })

    await port.call({ system: SYSTEM, prompt: FRAMED_PROMPT, order: 'ab' })

    expect(stub.captured).toHaveLength(1)
    const captured = stub.captured[0]!
    expect(captured.temperature).toBe(0)
    const text = boundaryUserText(captured)
    expect(text).toContain('--- BEGIN UNTRUSTED DATA ---')
    expect(text).toContain('--- END UNTRUSTED DATA ---')
    expect(text).toContain('ITEM A: button Continue')
    expect(text).toContain('Are ITEM A and ITEM B the same control?')
  })

  it('maps a scripted text-JSON verdict to a typed verdict result with usage', async () => {
    const stub = capturingStub(() =>
      judgeGenerateResult('equivalent', 'high', 'both frame the recorded Continue button'),
    )
    const port = bindJudgePort({
      profile: stubProfile(),
      auth: noneAuth,
      modelOverrides: { languageModels: stub.languageModels },
    })

    const result = await port.call({ system: SYSTEM, prompt: FRAMED_PROMPT, order: 'ab' })

    expect(result).toEqual({
      kind: 'verdict',
      verdict: 'equivalent',
      confidence: 'high',
      rationale: 'both frame the recorded Continue button',
      usage: { calls: 1, inputTokens: 10, outputTokens: 2 },
    })
    expect(port.judgeModelId).toBe(stubProfile().model)
  })

  it('mints call-error{unparseable-output} for non-verdict text — and resolves, never rejects', async () => {
    const stub = capturingStub(() => proseGenerateResult())
    const port = bindJudgePort({
      profile: stubProfile(),
      auth: noneAuth,
      modelOverrides: { languageModels: stub.languageModels },
    })

    await expect(
      port.call({ system: SYSTEM, prompt: FRAMED_PROMPT, order: 'ab' }),
    ).resolves.toMatchObject({ kind: 'call-error', reason: 'unparseable-output' })
  })

  it('mints call-error{provider-error} with the thrown message when doGenerate throws', async () => {
    const stub = throwingStub()
    const port = bindJudgePort({
      profile: stubProfile(),
      auth: noneAuth,
      modelOverrides: { languageModels: stub.languageModels },
    })

    const result = await port.call({ system: SYSTEM, prompt: FRAMED_PROMPT, order: 'ab' })

    expect(result.kind).toBe('call-error')
    if (result.kind !== 'call-error') throw new Error('expected a call-error result')
    expect(result.reason).toBe('provider-error')
    expect(result.detail).toContain('planner must not be invoked')
    expect(stub.calls()).toBeGreaterThan(0)
  })

  it('keeps sequential order-swapped calls independent — two captures with their own prompts', async () => {
    const stub = capturingStub((call) =>
      call === 0
        ? judgeGenerateResult('equivalent', 'high')
        : judgeGenerateResult('different', 'low'),
    )
    const port = bindJudgePort({
      profile: stubProfile(),
      auth: noneAuth,
      modelOverrides: { languageModels: stub.languageModels },
    })

    const promptAb = `${FRAMED_PROMPT}\norder marker: ab-first`
    const promptBa = `${FRAMED_PROMPT}\norder marker: ba-second`

    const first = await port.call({ system: SYSTEM, prompt: promptAb, order: 'ab' })
    const second = await port.call({ system: SYSTEM, prompt: promptBa, order: 'ba' })

    expect(stub.captured).toHaveLength(2)
    expect(boundaryUserText(stub.captured[0]!)).toContain('order marker: ab-first')
    expect(boundaryUserText(stub.captured[0]!)).not.toContain('order marker: ba-second')
    expect(boundaryUserText(stub.captured[1]!)).toContain('order marker: ba-second')
    expect(boundaryUserText(stub.captured[1]!)).not.toContain('order marker: ab-first')
    expect(first).toMatchObject({ kind: 'verdict', verdict: 'equivalent', confidence: 'high' })
    expect(second).toMatchObject({ kind: 'verdict', verdict: 'different', confidence: 'low' })
  })
})
