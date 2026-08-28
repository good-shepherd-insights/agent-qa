// THE FAILURE VIEW'S PURE PROJECTION (406-01 · DETL-04, D-05 / D-10).
//
// The page composes no sentence. Everything a member's block shows is a byte-identical copy of an
// `analysis.get` `sentences[].sentence`, joined to the member by `perTest`, with a provenance label
// this product owns. These cells pin exactly that: the join key, the totality of the map over an
// absent or empty analysis, and the two provenance readings.

import { describe, expect, it } from 'vitest'
import type { AnalysisGetOutput } from '@vostride/agent-qa-schema'

import {
  DETERMINISTIC_FALLBACK_LABEL,
  LLM_VERDICT_LABEL,
  projectAnalysisView,
  provenanceLabel,
} from '@/lib/analysis-view'

function analysis(over: Partial<AnalysisGetOutput> = {}): AnalysisGetOutput {
  return {
    runId: 'run-406',
    verdicts: [],
    sentences: [],
    clusters: [],
    ...over,
  }
}

describe('projectAnalysisView joins verdicts to members by perTest (D-05)', () => {
  it('joins by perTest and NEVER by array position — verdicts listed out of order', () => {
    const view = projectAnalysisView(
      analysis({
        verdicts: [
          { perTest: 3, testId: 't_three', class: 'app_bug', producer: 'analyze-run', confidence: 0.86 },
          { perTest: 1, testId: 't_one', class: 'unknown', producer: 'deterministic-classifier', confidence: 0 },
        ],
        sentences: [
          { perTest: 1, testId: 't_one', sentence: 'the sentence for member ONE' },
          { perTest: 3, testId: 't_three', sentence: 'the sentence for member THREE' },
        ],
      }),
      'done',
    )

    expect([...view.keys()].sort((a, b) => a - b), 'keyed by the member handle').toEqual([1, 3])
    // Array position would have paired verdict[0] with sentence[0] and swapped both members.
    expect(view.get(1)?.sentence).toBe('the sentence for member ONE')
    expect(view.get(3)?.sentence).toBe('the sentence for member THREE')
    expect(view.get(3)?.producer).toBe('analyze-run')
    expect(view.get(3)?.confidence).toBe(0.86)
    expect(view.get(1)?.testIndex).toBe(1)
  })

  it('projects an undefined analysis and an empty verdicts list to an EMPTY map (the green run)', () => {
    expect(projectAnalysisView(undefined, undefined).size).toBe(0)
    expect(projectAnalysisView(undefined, 'done').size).toBe(0)
    // A green run: the op answered, and it answered that nothing needs explaining.
    expect(projectAnalysisView(analysis(), 'done').size).toBe(0)
  })

  it('omits a verdict with no sentence rather than inventing one', () => {
    const view = projectAnalysisView(
      analysis({
        verdicts: [
          { perTest: 0, testId: 't_zero', class: 'unknown', producer: 'deterministic-classifier', confidence: 0 },
        ],
        sentences: [],
      }),
      'done',
    )
    expect(view.size, 'no sentence is no block — never an empty one').toBe(0)
  })

  it('reads provenance from the verdict\'s own producer and confidence (D-10)', () => {
    expect(provenanceLabel('analyze-run', 0.86)).toBe(`${LLM_VERDICT_LABEL} · 0.86`)
    expect(provenanceLabel('analyze-run', 1)).toBe(`${LLM_VERDICT_LABEL} · 1.00`)
    // The classifier's confidence is 0 by construction on the floor, and printing "· 0.00" beside
    // "deterministic fallback" would offer a number that means nothing to compare.
    expect(provenanceLabel('deterministic-classifier', 0)).toBe(DETERMINISTIC_FALLBACK_LABEL)

    const view = projectAnalysisView(
      analysis({
        verdicts: [
          { perTest: 0, testId: 't0', class: 'unknown', producer: 'deterministic-classifier', confidence: 0 },
        ],
        sentences: [{ perTest: 0, testId: 't0', sentence: 'observed (step 0): "boom"' }],
      }),
      'running',
    )
    expect(view.get(0)?.provenance).toBe(DETERMINISTIC_FALLBACK_LABEL)
  })
})
