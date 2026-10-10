// C439-JUDGE (439 D-06, D-07, D-09, D-10): the runner's judge over the verifier's per-condition
// output, case by case. judgeConditions is called directly with hand-built citation sources; the
// fallback cell drives a real LLMVerifier over a failing fake model.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMaskingContext } from '@vostride/agent-qa-safety'
import { asRef, stepOutcomeUnproven } from '@vostride/agent-qa-schema'
import type {
  CitationSource,
  ConditionRecord,
  ConditionVerdictsEvidence,
} from '@vostride/agent-qa-schema'
import type { Action } from '../../platform.js'
import { makeScreenState } from '../../testing/screen-fixtures.js'
import { judgeConditions } from '../requested-conditions.js'
import type { CitationSources, JudgeConditionsInput } from '../requested-conditions.js'
import type { ConditionJudgment, VerificationResult } from '../types.js'
import { LLMVerifier } from '../verifier.js'
import { makeFakeTokenAccounting } from './loop-harness.js'

vi.mock('ai', async (importActual) => {
  const actual = await importActual<typeof import('ai')>()
  return { ...actual, generateText: vi.fn() }
})

const STEP = 'Send the message'
const identity = (value: string) => value

function sources(parts: Partial<CitationSources> = {}): CitationSources {
  return { 'start-screen': '', 'final-screen': '', action: '', read: '', carried: '', ...parts }
}

function judgment(
  verdict: ConditionJudgment['verdict'],
  citations: { source: CitationSource; quote: string }[] = [],
  overrides: Partial<ConditionJudgment> = {},
): ConditionJudgment {
  return {
    quote: STEP,
    verdict,
    needs: 'none',
    controlRef: '',
    file: { name: '', match: 'none', text: '' },
    citations,
    reasoning: `judged ${verdict}`,
    ...overrides,
  }
}

function output(conditions: ConditionJudgment[], extra: Partial<VerificationResult> = {}): VerificationResult {
  return { conditions, dialogs: [], isAppError: false, reasoning: 'overall', ...extra }
}

function judge(input: Partial<JudgeConditionsInput> & Pick<JudgeConditionsInput, 'output'>) {
  return judgeConditions({
    stepText: STEP,
    sources: sources(),
    mask: identity,
    imageAttached: false,
    ending: 'completion',
    ...input,
  })
}

function record(verdict: ConditionRecord['verdict']): ConditionRecord {
  return { quote: STEP, verdict, reason: 'r', citations: [] }
}

function block(
  ending: ConditionVerdictsEvidence['ending'],
  verdicts: ConditionRecord['verdict'][],
): { conditionVerdicts: ConditionVerdictsEvidence } {
  return { conditionVerdicts: { ending, conditions: verdicts.map(record) } }
}

describe('C439-JUDGE', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('a quote differing only in whitespace and line breaks is found', () => {
    const result = judge({
      output: output([judgment('met', [{ source: 'final-screen', quote: 'heading  "Message\n sent"' }])]),
      sources: sources({ 'final-screen': '- heading "Message sent" [ref=e1]' }),
    })

    expect(result.pass).toBe(true)
    expect(result.evidence.conditions[0].verdict).toBe('met')
    expect(result.evidence.conditions[0].citations[0]).toMatchObject({
      source: 'final-screen',
      found: true,
    })
  })

  it('a masked placeholder in a quote matches the clear value in the record', () => {
    const masking = createMaskingContext()
    const placeholder = masking.mask('sam.taylor@example.test')
    expect(placeholder).not.toContain('@')

    const result = judge({
      output: output([judgment('met', [{ source: 'final-screen', quote: `Signed in as ${placeholder}` }])]),
      sources: sources({ 'final-screen': '- text "Signed in as sam.taylor@example.test" [ref=e2]' }),
      mask: masking.mask,
    })

    expect(result.pass).toBe(true)
    expect(result.evidence.conditions[0].citations[0]).toEqual({
      source: 'final-screen',
      quote: `Signed in as ${placeholder}`,
      found: true,
    })
  })

  it('a quote under three non-space characters never counts', () => {
    const result = judge({
      output: output([judgment('met', [{ source: 'final-screen', quote: 'OK' }])]),
      sources: sources({ 'final-screen': '- button "OK" [ref=e1]' }),
    })

    expect(result.pass).toBe(false)
    expect(result.evidence.conditions[0]).toMatchObject({
      verdict: 'unverified',
      judged: 'met',
      guard: 'citation-missing',
    })
    expect(result.evidence.conditions[0].citations[0].found).toBe(false)
  })

  it('a citation found in another part records where it was found', () => {
    const result = judge({
      output: output([judgment('met', [{ source: 'start-screen', quote: 'Message sent' }])]),
      sources: sources({
        'start-screen': '- button "Send" [ref=e1]',
        'final-screen': '- heading "Message sent" [ref=e2]',
      }),
    })

    expect(result.pass).toBe(true)
    expect(result.evidence.conditions[0].citations[0]).toEqual({
      source: 'final-screen',
      quote: 'Message sent',
      found: true,
    })
  })

  it('a verifier error is unverified, never a pass', () => {
    const result = judge({
      output: output([judgment('met', [{ source: 'final-screen', quote: 'Message sent' }])], {
        verifierError: 'Overloaded',
      }),
      sources: sources({ 'final-screen': '- heading "Message sent"' }),
    })

    expect(result.pass).toBe(false)
    expect(result.evidence.conditions).toHaveLength(1)
    expect(result.evidence.conditions[0]).toMatchObject({
      quote: STEP,
      verdict: 'unverified',
      guard: 'verifier-error',
    })
    expect(result.evidence.conditions[0].reason).toContain('Overloaded')
    expect(result.reason.startsWith('Unverified:')).toBe(true)
  })

  it('the real verifier falls back to no conditions when the model call fails', async () => {
    const { generateText } = await import('ai')
    const before = makeScreenState()
    const after = makeScreenState()
    const action: Action = { type: 'click', ref: asRef('e2') }
    vi.mocked(generateText).mockRejectedValueOnce(new Error('Overloaded'))

    const verifier = new LLMVerifier({} as never, makeFakeTokenAccounting())
    const result = await verifier.verify(STEP, before, after, action)

    expect(result.verification.verifierError).toBe('Overloaded')
    expect(result.verification.conditions).toEqual([])
    const judged = judge({ output: result.verification })
    expect(judged.pass).toBe(false)
    expect(judged.evidence.conditions[0].guard).toBe('verifier-error')

    vi.mocked(generateText).mockRejectedValueOnce(new Error('The operation was aborted'))
    const controller = new AbortController()
    controller.abort()
    await expect(
      verifier.verify(STEP, before, after, action, undefined, controller.signal),
    ).rejects.toThrow('The operation was aborted')
  })

  it('not-met, unverified and inconclusive each block the pass and the reason lists them in that order', () => {
    const masking = createMaskingContext()
    const long = `The receipt was sent to sam.taylor@example.test ${'and more words '.repeat(30)}`
    const result = judge({
      output: output([
        judgment('unverified', [], { quote: 'the message', reasoning: long }),
        judgment('not-met', [], { quote: 'Send', reasoning: 'The Send button is still enabled' }),
        judgment('inconclusive', [], { quote: 'green', reasoning: 'Colour needs an image' }),
      ]),
      mask: masking.mask,
    })

    expect(result.pass).toBe(false)
    const notMet = result.reason.indexOf('Not met:')
    const unverified = result.reason.indexOf('Unverified:')
    const inconclusive = result.reason.indexOf('Inconclusive:')
    expect(notMet).toBe(0)
    expect(unverified).toBeGreaterThan(notMet)
    expect(inconclusive).toBeGreaterThan(unverified)
    expect(result.reason).toContain('"Send" (The Send button is still enabled)')
    expect(result.reason).not.toContain('sam.taylor@example.test')
    expect(result.reason).toContain(masking.mask('sam.taylor@example.test'))
    for (const condition of result.evidence.conditions) {
      expect(condition.reason.length).toBeLessThanOrEqual(200)
    }
    expect(result.evidence.conditions.map((condition) => condition.verdict)).toEqual([
      'unverified',
      'not-met',
      'inconclusive',
    ])
  })

  it('stepOutcomeUnproven reads only verifier endings', () => {
    expect(stepOutcomeUnproven(block('completion', ['met', 'unverified']))).toBe(true)
    expect(stepOutcomeUnproven(block('completion', ['unverified', 'not-met']))).toBe(false)
    expect(stepOutcomeUnproven(block('timeout', ['unverified']))).toBe(false)
    expect(stepOutcomeUnproven({})).toBe(false)
  })
})
