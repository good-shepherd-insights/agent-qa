// Gate 3 — adds-value (Phase 393, D-13/D-14/D-16 · WTST-02).
//
// SET SEMANTICS, NO THRESHOLD (D-14, spec §6.3 verbatim). The draft adds value when at least one
// of its fingerprint elements is absent from the union of the suite's. There is no similarity
// score on this lane and therefore no magic constant to defend: conservatism lives in the
// normalizer, where "near-same elements are the same element" already has exactly one definition.
// The receipt NAMES the uncovered elements rather than counting them, because a gate that says
// "0.31" tells an author nothing they can act on.
//
// BOTH SIDES OF THE COMPARISON ARE MINTED BY ONE FUNCTION. The suite union is folded from
// `testFingerprintElements`; so is the draft's own element list, from the draft's member outcome
// inside its gate-run document. The elements arrive here already computed — see `verify-draft.ts`
// — and this module never derives them, which is what stops a second recipe from appearing on
// the draft side and turning a comparison of two tests into a comparison of two derivations.

import type { AddsValueFinding } from '@vostride/agent-qa-schema'

import type { SuiteFingerprintIndexLike, SuiteTextCorpusEntryLike } from './ports.js'

export interface AddsValueGateInput {
  /** The draft's own fingerprint elements, in exercised order. */
  readonly draftElements: readonly string[]
  readonly index: SuiteFingerprintIndexLike
  /** D-16's evidence-less population: the authored suite MINUS `index.coveredTests()`. */
  readonly textCorpus: readonly SuiteTextCorpusEntryLike[]
}

export interface AddsValueGateResult {
  readonly pass: boolean
  readonly finding: AddsValueFinding
  readonly reason: string
}

/** The draft's elements that no suite test has exercised, deduplicated, in first-seen order. */
function novelElementsOf(
  draftElements: readonly string[],
  union: ReadonlySet<string>,
): string[] {
  const novel: string[] = []
  const seen = new Set<string>()
  for (const element of draftElements) {
    if (union.has(element) || seen.has(element)) continue
    seen.add(element)
    novel.push(element)
  }
  return novel
}

/**
 * Gate 3 over an already-minted draft element list.
 *
 * The tracer depth: the fingerprint lane alone. Each covered suite test contributes a row marked
 * `lane: 'fingerprint'`, with `covered` saying whether THAT test on its own subsumes every element
 * the draft exercised — the per-test statement behind the union-level verdict, so an author told
 * "already covered" can be told by what. D-16's text fallback for evidence-less suite tests, its
 * pinned threshold, and the empty-suite rule land in this plan's Task 3; `textCorpus` is in the
 * signature from the start so the lane joins without re-shaping every caller.
 */
export function addsValueGate(input: AddsValueGateInput): AddsValueGateResult {
  const union = input.index.elementUnion()
  const novelElements = novelElementsOf(input.draftElements, union)
  const draftElementSet = new Set(input.draftElements)

  const comparedTests: AddsValueFinding['comparedTests'] = input.index.coveredTests().map(
    (identity) => {
      const suiteElements = new Set(
        input.index.elementsForTest(identity.filePath, identity.testName),
      )
      return {
        filePath: identity.filePath,
        testName: identity.testName,
        lane: 'fingerprint' as const,
        covered: draftElementSet.size > 0
          && [...draftElementSet].every((element) => suiteElements.has(element)),
      }
    },
  )

  const pass = novelElements.length > 0

  return {
    pass,
    finding: { novelElements, comparedTests },
    reason: pass
      ? `${novelElements.length} element(s) absent from the suite union of ${union.size} (D-14)`
      : `every element the draft exercised (${draftElementSet.size}) is already in the suite union of ${union.size} (D-14)`,
  }
}
