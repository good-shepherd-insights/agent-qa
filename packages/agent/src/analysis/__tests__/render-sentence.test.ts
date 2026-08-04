// The ONE deterministic sentence renderer (Phase 389, D-05/D-06/D-08).
//
// Four claims, each an obligation the composed sentence carries: the verbatim grounding
// quote with its step ref, the discriminator, the recurrence clause (a LIVE join through
// the provider seam — never a stored number), and the recommended next action with its
// `agentqa://` links. The renderer is producer-keyed by CONSTRUCTION: it composes typed
// parts identically whoever authored them, which is what lets plan 04's LLM parts and the
// deterministic template parts flow through one rule (D-06) — and what makes SC3's
// "no second code path" structural when plan 07's CLI print imports this same symbol.

import type { Verdict, VerdictSentenceParts } from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'

import { renderVerdictSentence } from '../render-sentence.js'
import type { RecurrenceProvider, RecurrenceQuery } from '../render-sentence.js'

const QUERY: RecurrenceQuery = {
  product: 'shop',
  filePath: 'tests/checkout.yaml',
  testName: 'checks out',
}

function verdictOf(
  overrides: Partial<Pick<Verdict, 'class' | 'producer' | 'confidence' | 'perTest'>> = {},
): Verdict {
  return {
    class: 'app_bug',
    producer: 'analyze-run',
    confidence: 0.9,
    evidence: {
      citedSteps: [2],
      citedAnchors: [],
      citedArtifacts: [],
      rationale: 'classifier self-trace — never the sentence',
    },
    memoryMisdirectionRuledOut: true,
    perTest: 0,
    ...overrides,
  } as Verdict
}

const LLM_PARTS: VerdictSentenceParts = {
  perTest: 0,
  groundingQuote: { stepIndex: 2, quote: 'Error: element "Submit" not found' },
  discriminator: 'the submit button disappeared after the cart update',
  nextAction: 'file the failure against the application with the quoted evidence',
  links: ['agentqa://memory/MEM-001', 'agentqa://run/RUN-042'],
}

const TEMPLATE_PARTS: VerdictSentenceParts = {
  perTest: 1,
  groundingQuote: { stepIndex: 0, quote: 'net::ERR_CONNECTION_REFUSED' },
  discriminator: 'environment: the app under test refused the connection',
  nextAction: 'check the environment or infrastructure dependency the run relied on',
  links: [],
}

const HONEST_UNKNOWN_PARTS: VerdictSentenceParts = {
  perTest: 2,
  groundingQuote: { source: 'test-outcome', quote: 'failed' },
  discriminator: 'root cause undetermined',
  nextAction: 'inspect the run manually — no deterministic signal matched',
  links: [],
}

interface RecordingProvider {
  readonly provider: RecurrenceProvider
  readonly asked: RecurrenceQuery[]
}

function providerAnswering(
  answer: () => { kth: number; windowBuilds: number } | undefined,
): RecordingProvider {
  const asked: RecurrenceQuery[] = []
  return {
    provider: {
      failureRecurrence(query) {
        asked.push(query)
        return answer()
      },
    },
    asked,
  }
}

describe('renderVerdictSentence — the four obligations (ANLZ-03)', () => {
  it('renders quote, discriminator, recurrence and next action, each at its section marker', () => {
    const { provider } = providerAnswering(() => ({ kth: 3, windowBuilds: 5 }))
    const sentence = renderVerdictSentence(verdictOf(), LLM_PARTS, provider, QUERY)

    // Obligation a: the verbatim quote, with its step ref.
    expect(sentence).toContain('observed (step 2): "Error: element "Submit" not found"')
    // Obligation b: the discriminator, verbatim.
    expect(sentence).toContain('the submit button disappeared after the cart update')
    // Obligation c: the recurrence clause — typed data in, prose out.
    expect(sentence).toContain('failure 3 of this test in the last 5 builds')
    // Obligation d: the next action with its agentqa:// links.
    expect(sentence).toContain(
      'next: file the failure against the application with the quoted evidence',
    )
    expect(sentence).toContain('see: agentqa://memory/MEM-001, agentqa://run/RUN-042')
    // The lead frame is the RESOLVED class, from the verdict — the one field every reader
    // wants before the prose starts.
    expect(sentence.startsWith('app_bug: ')).toBe(true)
  })

  it('renders the step-less grounding arm as the typed test-outcome ref, never a step index', () => {
    const { provider } = providerAnswering(() => undefined)
    const sentence = renderVerdictSentence(
      verdictOf({ class: 'unknown', producer: 'deterministic-classifier', confidence: 0 }),
      HONEST_UNKNOWN_PARTS,
      provider,
      QUERY,
    )

    expect(sentence).toContain('observed (test outcome): "failed"')
    expect(sentence).not.toContain('observed (step')
  })
})

describe('the recurrence clause is a LIVE join (D-08)', () => {
  it('reflects each provider answer at call time — nothing cached, nothing stored', () => {
    let current: { kth: number; windowBuilds: number } | undefined = { kth: 2, windowBuilds: 6 }
    const recording = providerAnswering(() => current)

    const first = renderVerdictSentence(verdictOf(), LLM_PARTS, recording.provider, QUERY)
    current = { kth: 7, windowBuilds: 9 }
    const second = renderVerdictSentence(verdictOf(), LLM_PARTS, recording.provider, QUERY)

    expect(first).toContain('failure 2 of this test in the last 6 builds')
    expect(second).toContain('failure 7 of this test in the last 9 builds')
    expect(first).not.toBe(second)
    // The provider was consulted per call, with the caller's query, both times.
    expect(recording.asked).toEqual([QUERY, QUERY])
  })

  it('renders the explicit no-history clause when no provider is bound at all', () => {
    const sentence = renderVerdictSentence(verdictOf(), LLM_PARTS, undefined, QUERY)

    expect(sentence).toContain('no failure history is recorded for this test')
  })

  it('renders the explicit no-history clause when the provider answers undefined', () => {
    const { provider } = providerAnswering(() => undefined)
    const sentence = renderVerdictSentence(verdictOf(), LLM_PARTS, provider, QUERY)

    expect(sentence).toContain('no failure history is recorded for this test')
  })

  it('renders the explicit no-history clause for the zero-history answer {0, 0}', () => {
    const { provider } = providerAnswering(() => ({ kth: 0, windowBuilds: 0 }))
    const sentence = renderVerdictSentence(verdictOf(), LLM_PARTS, provider, QUERY)

    expect(sentence).toContain('no failure history is recorded for this test')
  })

  it('says honestly when a window exists but records no prior failure of this test', () => {
    const { provider } = providerAnswering(() => ({ kth: 0, windowBuilds: 4 }))
    const sentence = renderVerdictSentence(verdictOf(), LLM_PARTS, provider, QUERY)

    expect(sentence).toContain('no prior failure of this test is recorded in the last 4 builds')
  })
})

describe('producer-keyed composition through ONE rule (D-06)', () => {
  it('renders LLM parts for producer analyze-run', () => {
    const { provider } = providerAnswering(() => ({ kth: 1, windowBuilds: 3 }))
    const sentence = renderVerdictSentence(
      verdictOf({ producer: 'analyze-run' }),
      LLM_PARTS,
      provider,
      QUERY,
    )

    expect(sentence).toContain('observed (step 2)')
    expect(sentence).toContain('the submit button disappeared after the cart update')
  })

  it('renders template parts for producer deterministic-classifier, absence as absence', () => {
    const { provider } = providerAnswering(() => ({ kth: 1, windowBuilds: 3 }))
    const sentence = renderVerdictSentence(
      verdictOf({ class: 'environment', producer: 'deterministic-classifier', confidence: 1 }),
      TEMPLATE_PARTS,
      provider,
      QUERY,
    )

    expect(sentence).toContain('observed (step 0): "net::ERR_CONNECTION_REFUSED"')
    expect(sentence).toContain('environment: the app under test refused the connection')
    expect(sentence).toContain('failure 1 of this test in the last 3 builds')
    expect(sentence).toContain('next: check the environment or infrastructure dependency')
    // Empty links render as NO see-section — never a dangling header.
    expect(sentence).not.toContain('see:')
  })

  it('renders the honest root-cause-undetermined sentence with a manual-inspection action', () => {
    const sentence = renderVerdictSentence(
      verdictOf({ class: 'unknown', producer: 'deterministic-classifier', confidence: 0 }),
      HONEST_UNKNOWN_PARTS,
      undefined,
      QUERY,
    )

    expect(sentence).toContain('root cause undetermined')
    expect(sentence).toContain('next: inspect the run manually — no deterministic signal matched')
    // Obligation c still renders, honestly, on the fallback sentence too.
    expect(sentence).toContain('no failure history is recorded for this test')
  })
})

describe('byte determinism (D-05)', () => {
  it('same (verdict, parts, provider answer) → the same string, byte for byte', () => {
    const first = renderVerdictSentence(
      verdictOf(),
      LLM_PARTS,
      providerAnswering(() => ({ kth: 3, windowBuilds: 5 })).provider,
      QUERY,
    )
    const second = renderVerdictSentence(
      verdictOf(),
      LLM_PARTS,
      providerAnswering(() => ({ kth: 3, windowBuilds: 5 })).provider,
      QUERY,
    )

    expect(first).toBe(second)
  })
})
