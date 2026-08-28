// The ANLZ-01 seam cell (Phase 406, plan 07 — D-13's "reproduce first, then fix").
//
// WHAT THIS REPRODUCES, and where the message came from. Three `analyze-run` jobs in the 399
// session's own job store (`demo/init/.agent-qa/agent-jobs.db`, rows `job_2bfec42063342721`,
// `job_fa214f7c8256323a`, `job_e32e38493a147e68`) died `permanent` after three attempts, all
// on the identical `last_failure_reason`:
//
//     handler-threw: Guardrail blocked outbound prompt leaf: creditCard
//
// That string is minted at `egress-hook.ts`'s `GuardrailBlockError` and nowhere else, so the
// seam is THIS package — not the test-history read, not the evidence-blob read, not the
// provider adapter's prelude (406-ANLZ-01-REPRODUCTION.md § Seam disproves all three).
//
// WHICH LEAF MATCHED, measured 2026-08-29. The job store keeps the detector name, not the
// text, so the analyze-run prompt was rebuilt from each failed run's own persisted handoff and
// scanned with this same pure `scan()`. Every one blocked on a MEMORY-RETRIEVAL RELEVANCE
// SCORE inside the failing step's `retrievalTrace` — `1.1428571428571428`, `1.4869565217391303`
// and `1.0285714285714285`. `CREDIT_CARD_CANDIDATE_RE` cannot see across the `.`, so what it
// offers for scoring is the 16-digit fraction, and that fraction is Luhn-valid. No card, no
// PII: this is exactly the "genuine NONZERO-integer float" the `isFractionalTail` doc block
// names as its ACCEPTED COST, hit by a real page for the first time.
//
// The leaf below is the VERBATIM `retrievalTrace` rendering from the 399 acceptance handoff,
// which the committed fixture `agent/src/jobs/__tests__/fixtures/399-red-handoff.json` still
// carries; the run outcome is INCIDENTAL (one of the three failed jobs is on a run whose
// status is `passed`), so nothing here keys on red.

import { describe, expect, it } from 'vitest'

import type { ProviderRequestParams } from '../../index'
import {
  defaultGuardrailPolicyInput,
  loadGuardrailPolicy,
} from '../policy-loader'
import {
  createGuardrailProviderRequestHook,
  GuardrailBlockError,
} from '../egress-hook'
import { findDetectorMatches } from '../detectors'
import { luhnValid } from '../luhn'

const policy = loadGuardrailPolicy(defaultGuardrailPolicyInput)

/** The measured leaf, verbatim from the analyze-run prompt built over the 399 red handoff. */
const RETRIEVAL_TRACE_LEAF =
  '"retrievalTrace":{"schemaVersion":1,"servedLines":[{"leg":"anchor","rank":1,' +
  '"recordId":"fact-page-https-automationexercise-com-products-4ccac2f8443decea",' +
  '"score":1.0285714285714285}],"truncated":[]}'

/** The other two scores the same measurement recovered, from the two 2026-08-27 rows. */
const OTHER_MEASURED_SCORES = ['1.1428571428571428', '1.4869565217391303'] as const

function analyzeRunRequest(leaf: string): ProviderRequestParams {
  return {
    prompt: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text:
              'agent_context: analyze-run: authoring root-cause verdicts and sentence parts ' +
              `for one completed run\n\nTest 0: Automation Exercise products smoke\n{${leaf}}`,
          },
        ],
      },
    ],
  } as unknown as ProviderRequestParams
}

describe('ANLZ-01: handler-threw: Guardrail blocked outbound prompt leaf: creditCard', () => {
  it('does not block the analyze-run prompt carrying the 399 retrieval-trace leaf', () => {
    const hook = createGuardrailProviderRequestHook(policy)

    expect(() => hook(analyzeRunRequest(RETRIEVAL_TRACE_LEAF))).not.toThrow()
  })

  it('does not block either of the other two measured relevance scores', () => {
    const hook = createGuardrailProviderRequestHook(policy)

    for (const score of OTHER_MEASURED_SCORES) {
      expect(() =>
        hook(analyzeRunRequest(`"servedLines":[{"leg":"anchor","score":${score}}]`)),
      ).not.toThrow()
    }
  })

  it('names what the detector actually matched: the Luhn-valid fraction of a real float', () => {
    // Provenance, pinned. The candidate is the FRACTION — the regex stops at the `.` — and it
    // is Luhn-valid, which is the whole reason a probability-shaped number ever looked like a
    // card. The literal is also the shortest round-trip decimal of the double it denotes,
    // i.e. a number a float formatter PRINTED rather than a digit run somebody assembled.
    const fraction = '0285714285714285'

    expect(luhnValid(fraction)).toBe(true)
    expect(String(Number('1.0285714285714285'))).toBe('1.0285714285714285')
    for (const score of OTHER_MEASURED_SCORES) {
      expect(String(Number(score))).toBe(score)
    }
  })

  it('still blocks a real PAN riding the same analyze-run prompt shape', () => {
    // The control the fix must not cost: the seam is an EGRESS control, and a card in an
    // evidence pack must still halt the request.
    const card = '4111111111111111'
    const hook = createGuardrailProviderRequestHook(policy)

    expect(() => hook(analyzeRunRequest(`"observedValue":"card ${card} end"`))).toThrow(
      GuardrailBlockError,
    )
    expect(findDetectorMatches('creditCard', `card ${card} end`)).toHaveLength(1)
  })
})
