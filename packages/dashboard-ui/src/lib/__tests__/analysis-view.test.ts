// THE FAILURE VIEW'S PURE PROJECTION (406-01 · DETL-04, D-05 / D-10; 406-06 · D-08..D-11 / D-19).
//
// The page composes no sentence. Everything a member's block shows is a byte-identical copy of an
// `analysis.get` `sentences[].sentence`, joined to the member by `perTest`, with a provenance label
// this product owns. These cells pin exactly that: the join key, the totality of the map over an
// absent or empty analysis, and the two provenance readings.
//
// AND THE LIFECYCLE IS KEYED OFF THE CHIP WORD, NEVER OFF THE TEXT (406-06 · D-09/D-11). The
// marker cells below include a PAIR — one sentence carrying the deterministic floor's own
// "root cause undetermined" wording, one carrying none — and require the SAME marker for both. A
// projection that sniffed the sentence for fallback words would pass every other cell in this file
// and fail that pair, which is the whole reason it is written as a pair.

import { describe, expect, it } from 'vitest'
import type {
  AnalysisClusterView,
  AnalysisGetOutput,
  AnalysisResolvedVerdict,
} from '@vostride/agent-qa-schema'

import {
  ANALYSIS_FAILED_FALLBACK_TEXT,
  ANALYSIS_PROVISIONAL_TEXT,
  DETERMINISTIC_FALLBACK_LABEL,
  LLM_VERDICT_LABEL,
  MEMORY_ON_PATH_NONE_TEXT,
  MEMORY_ON_PATH_NOT_RECORDED_TEXT,
  MISDIRECTION_DECLARED_ONLY_TEXT,
  MISDIRECTION_HELD_TEXT,
  MISDIRECTION_NOT_RECORDED_TEXT,
  MISDIRECTION_UNRESOLVED_TEXT,
  markerFor,
  memoryOnPathLine,
  misdirectionAttributionLine,
  misdirectionUnbackedLine,
  missingEvidenceLine,
  projectAnalysisView,
  provenanceLabel,
  siblingLine,
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

function verdict(perTest: number, over: Partial<AnalysisResolvedVerdict> = {}): AnalysisResolvedVerdict {
  return {
    perTest,
    testId: `t_${String(perTest)}`,
    class: 'unknown',
    producer: 'deterministic-classifier',
    confidence: 0,
    ...over,
  }
}

function cluster(members: number[], over: Partial<AnalysisClusterView> = {}): AnalysisClusterView {
  return {
    fingerprint: 'timeout:submit',
    count: members.length,
    members: members.map((testIndex) => ({ testIndex, testId: `t_${String(testIndex)}` })),
    representative: { testIndex: members[0] ?? 0, sentence: 'the representative sentence' },
    ...over,
  }
}

describe('projectAnalysisView joins verdicts to members by perTest (D-05)', () => {
  it('joins by perTest and NEVER by array position — verdicts listed out of order', () => {
    const view = projectAnalysisView(
      analysis({
        verdicts: [
          verdict(3, { testId: 't_three', class: 'app_bug', producer: 'analyze-run', confidence: 0.86 }),
          verdict(1, { testId: 't_one' }),
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
    expect(projectAnalysisView(undefined, 'running').size).toBe(0)
    expect(projectAnalysisView(undefined, 'done').size).toBe(0)
    // A green run: the op answered, and it answered that nothing needs explaining.
    expect(projectAnalysisView(analysis(), 'done').size).toBe(0)
  })

  it('keys a verdict whose sentence never arrived, and drops a sentence with no verdict', () => {
    // 406-06 SUPERSEDES 406-01 HERE, and the plan says so in as many words. The verdict is what
    // carries `producer`, `confidence` and — through the chip — the marker; withholding the whole
    // entry because the renderer had not answered yet would withhold the provenance chip and the
    // "analysis running" marker too, which are exactly what a reader needs while it has not.
    // A SENTENCE with no verdict stays dropped: there is no producer to attribute it to.
    const view = projectAnalysisView(
      analysis({
        verdicts: [verdict(0)],
        sentences: [{ perTest: 4, testId: 't_4', sentence: 'a sentence about nobody' }],
      }),
      'running',
    )

    expect([...view.keys()]).toEqual([0])
    expect(view.get(0)?.sentence, 'empty, never invented').toBe('')
    expect(view.get(0)?.provenance).toBe(DETERMINISTIC_FALLBACK_LABEL)
    expect(view.get(4), 'a sentence nobody graded is not a block').toBeUndefined()
  })

  it("reads provenance from the verdict's own producer and confidence (D-10)", () => {
    expect(provenanceLabel('analyze-run', 0.86)).toBe(`${LLM_VERDICT_LABEL} · 0.86`)
    expect(provenanceLabel('analyze-run', 1)).toBe(`${LLM_VERDICT_LABEL} · 1.00`)
    // The classifier's confidence is 0 by construction on the floor, and printing "· 0.00" beside
    // "deterministic fallback" would offer a number that means nothing to compare.
    expect(provenanceLabel('deterministic-classifier', 0)).toBe(DETERMINISTIC_FALLBACK_LABEL)

    const view = projectAnalysisView(
      analysis({
        verdicts: [verdict(0)],
        sentences: [{ perTest: 0, testId: 't_0', sentence: 'observed (step 0): "boom"' }],
      }),
      'running',
    )
    expect(view.get(0)?.provenance).toBe(DETERMINISTIC_FALLBACK_LABEL)
  })
})

describe('the marker is the chip word and nothing else (D-09/D-11)', () => {
  it('maps every chip word — pending and running provisional, failed failed, done nothing', () => {
    expect(markerFor('pending')).toBe('provisional')
    expect(markerFor('running')).toBe('provisional')
    expect(markerFor('failed')).toBe('failed')
    expect(markerFor('done'), 'a terminal chain has nothing left to warn about').toBeUndefined()
    expect(markerFor(undefined), 'no read has landed — that is not a marker').toBeUndefined()
  })

  it('carries the marker and its exported sentence onto the member view', () => {
    const bytes = analysis({
      verdicts: [verdict(0)],
      sentences: [{ perTest: 0, testId: 't_0', sentence: 'observed (step 0): "boom"' }],
    })

    expect(projectAnalysisView(bytes, 'running').get(0)?.marker).toBe('provisional')
    expect(projectAnalysisView(bytes, 'running').get(0)?.markerText).toBe(ANALYSIS_PROVISIONAL_TEXT)
    expect(projectAnalysisView(bytes, 'pending').get(0)?.markerText).toBe(ANALYSIS_PROVISIONAL_TEXT)
    expect(projectAnalysisView(bytes, 'failed').get(0)?.marker).toBe('failed')
    expect(projectAnalysisView(bytes, 'failed').get(0)?.markerText).toBe(ANALYSIS_FAILED_FALLBACK_TEXT)
    expect(projectAnalysisView(bytes, 'done').get(0)?.marker).toBeUndefined()
    expect(projectAnalysisView(bytes, 'done').get(0)?.markerText).toBeUndefined()
  })

  it('gives the SAME marker to a sentence with the fallback words and one without them', () => {
    // THE PAIR. The floor renderer ends its sentence with "root cause undetermined", and an
    // implementation that read the marker off that phrase would look right until an LLM verdict
    // happened to contain it — or until the floor's copy changed. The chip word is the input.
    const withWords = analysis({
      verdicts: [verdict(0)],
      sentences: [
        { perTest: 0, testId: 't_0', sentence: 'observed (step 0): "boom" — root cause undetermined' },
      ],
    })
    const withoutWords = analysis({
      verdicts: [verdict(0)],
      sentences: [{ perTest: 0, testId: 't_0', sentence: 'the submit button never became enabled' }],
    })

    for (const chip of ['pending', 'running', 'done', 'failed'] as const) {
      expect(
        projectAnalysisView(withWords, chip).get(0)?.marker,
        `the ${chip} marker must not read the sentence`,
      ).toBe(projectAnalysisView(withoutWords, chip).get(0)?.marker)
    }

    // And a floor sentence under a `done` chain carries no marker at all: the analysis finished
    // and the deterministic verdict is the answer, not a provisional one.
    expect(projectAnalysisView(withWords, 'done').get(0)?.marker).toBeUndefined()
  })
})

describe('clusters render as a per-member sibling line (D-08)', () => {
  it('excludes self, keeps the producer order, and reads the plural line', () => {
    const view = projectAnalysisView(
      analysis({
        verdicts: [verdict(0), verdict(4), verdict(7)],
        sentences: [
          { perTest: 0, testId: 't_0', sentence: 's0' },
          { perTest: 4, testId: 't_4', sentence: 's4' },
          { perTest: 7, testId: 't_7', sentence: 's7' },
        ],
        clusters: [cluster([0, 4, 7])],
      }),
      'done',
    )

    expect(view.get(4)?.siblings).toEqual([
      { testIndex: 0, testId: 't_0' },
      { testIndex: 7, testId: 't_7' },
    ])
    expect(view.get(4)?.siblingText).toBe(siblingLine(2))
    expect(view.get(0)?.siblings.map((s) => s.testIndex), 'producer order, self removed').toEqual([4, 7])
  })

  it('says "1 other test" in the singular and "N other tests" in the plural', () => {
    expect(siblingLine(1)).toBe('same failure as 1 other test')
    expect(siblingLine(2)).toBe('same failure as 2 other tests')
    expect(siblingLine(39)).toBe('same failure as 39 other tests')
  })

  it('renders NO line for a cluster of one — a lone failure is not a group', () => {
    const view = projectAnalysisView(
      analysis({
        verdicts: [verdict(0)],
        sentences: [{ perTest: 0, testId: 't_0', sentence: 's0' }],
        clusters: [cluster([0])],
      }),
      'done',
    )

    expect(view.get(0)?.siblings).toEqual([])
    expect(view.get(0)?.siblingText, 'no siblings is no sentence').toBeUndefined()
  })

  it('leaves a member no cluster mentions with no siblings at all', () => {
    const view = projectAnalysisView(
      analysis({
        verdicts: [verdict(0), verdict(9)],
        sentences: [
          { perTest: 0, testId: 't_0', sentence: 's0' },
          { perTest: 9, testId: 't_9', sentence: 's9' },
        ],
        clusters: [cluster([0, 4])],
      }),
      'done',
    )

    expect(view.get(9)?.siblings).toEqual([])
    expect(view.get(9)?.siblingText).toBeUndefined()
  })
})

describe('cited evidence rides the verdict, and absence is counted (D-01/D-19)', () => {
  it('forwards citedSteps verbatim and answers an empty list when the op sent no evidence', () => {
    const view = projectAnalysisView(
      analysis({
        verdicts: [
          verdict(0, { evidence: { citedSteps: [2, 3], citedArtifacts: [] } }),
          verdict(1),
        ],
        sentences: [
          { perTest: 0, testId: 't_0', sentence: 's0' },
          { perTest: 1, testId: 't_1', sentence: 's1' },
        ],
      }),
      'done',
    )

    expect(view.get(0)?.citedSteps).toEqual([2, 3])
    expect(view.get(1)?.citedSteps, 'a reader compiled before 406 sent nothing').toEqual([])
    expect(view.get(1)?.citedArtifacts).toEqual([])
    expect(view.get(1)?.missingEvidence).toBeUndefined()
  })

  it('marks a ref incomplete from EITHER absence fact, and never from presence-unknown', () => {
    // `present` ABSENT IS NOT `present: false` (406-03). A host that cannot stat its blobs omits
    // the key, and rendering that as a claimed absence would invent a deletion nobody measured.
    const view = projectAnalysisView(
      analysis({
        verdicts: [
          verdict(0, {
            evidence: {
              citedSteps: [],
              citedArtifacts: [
                { id: 'a-present', sha: 'sha-present', present: true },
                { id: 'a-unknown', sha: 'sha-unknown' },
                { id: 'a-gone', sha: 'sha-gone', present: false },
                { id: 'a-never-attached', sha: 'sha-never', evidenceIncomplete: true },
              ],
            },
          }),
        ],
        sentences: [{ perTest: 0, testId: 't_0', sentence: 's0' }],
      }),
      'done',
    )

    expect(view.get(0)?.citedArtifacts).toEqual([
      { id: 'a-present', sha: 'sha-present', incomplete: false },
      { id: 'a-unknown', sha: 'sha-unknown', incomplete: false },
      { id: 'a-gone', sha: 'sha-gone', incomplete: true },
      { id: 'a-never-attached', sha: 'sha-never', incomplete: true },
    ])
    expect(view.get(0)?.missingEvidence).toEqual({ missing: 2, total: 4 })
    expect(view.get(0)?.missingEvidenceText).toBe(missingEvidenceLine({ missing: 2, total: 4 }))
  })

  it('counts nothing when every cited artifact is there', () => {
    const view = projectAnalysisView(
      analysis({
        verdicts: [
          verdict(0, {
            evidence: {
              citedSteps: [0],
              citedArtifacts: [{ id: 'a', sha: 'sha-a', present: true }],
            },
          }),
        ],
        sentences: [{ perTest: 0, testId: 't_0', sentence: 's0' }],
      }),
      'done',
    )

    expect(view.get(0)?.missingEvidence, 'nothing missing is no count line').toBeUndefined()
    expect(view.get(0)?.missingEvidenceText).toBeUndefined()
  })

  it('says "cited artifact" in the singular and "cited artifacts" in the plural (D-19)', () => {
    expect(missingEvidenceLine({ missing: 1, total: 1 })).toBe('1 of 1 cited artifact unavailable')
    expect(missingEvidenceLine({ missing: 1, total: 2 })).toBe('1 of 2 cited artifacts unavailable')
    expect(missingEvidenceLine({ missing: 3, total: 3 })).toBe('3 of 3 cited artifacts unavailable')
  })
})

// ── 422 D-17/D-19/D-20: THE CIRCULARITY EVIDENCE, AS THE FAILURE VIEW READS IT.
//
// THREE UPSTREAM SOURCES ARE DELIBERATELY THREE-VALUED AND A UI IS WHERE THEY GET FLATTENED.
// 422-15's guard can be stamped, absent or refused; 422-12's readers keep absent distinct from
// empty at every boundary; 422-17 established that a guard backed by the fail-closed `eval-root`
// posture must NOT be presented as `declared-only`. A badge reading "ruled out" over evidence that
// was never produced is the failure these cells exist to prevent, and #427 makes it the live case
// rather than a hypothetical: no composition binds the posture reader, so every gated run today
// resolves fail-closed.
//
// AND THE WHOLE ADDITION IS ADDITIVE. The last cell in this block hands the projection the same
// bytes a pre-422 run serves and requires NO evidence member at all — a historical failure view
// paints exactly what it painted before.

describe('the projection reads circularity evidence and invents none (422 D-17/D-19/D-20)', () => {
  const HELD = 'rec_held_0001'
  const FLIPPED = 'rec_flipped_01'

  function withMisdirection(misdirection: AnalysisResolvedVerdict['misdirection']) {
    return projectAnalysisView(
      analysis({
        verdicts: [verdict(0, misdirection === undefined ? {} : { misdirection })],
        sentences: [{ perTest: 0, testId: 't_0', sentence: 'observed (step 0): "boom"' }],
      }),
      'done',
    ).get(0)?.misdirectionEvidence
  }

  it('reads an all-HELD ledger as cross-check held, and names no causal record', () => {
    const evidence = withMisdirection({
      state: 'measured',
      crossCheck: 'held',
      results: [{ recordId: HELD, crossCheck: 'held' }],
      memoryOnPath: [{ recordId: HELD, trust: 'candidate' }],
    })

    expect(evidence?.state).toBe('held')
    expect(evidence?.text).toBe(MISDIRECTION_HELD_TEXT)
    expect(evidence?.causalRecords, 'nothing flipped, so nothing is attributed').toEqual([])
    expect(evidence?.onPath).toEqual([{ recordId: HELD, trust: 'candidate' }])
    expect(evidence?.onPathText).toBe(memoryOnPathLine(1))
  })

  it('names the FLIPPED records as the causal attribution, apart from every exposed record', () => {
    const evidence = withMisdirection({
      state: 'measured',
      crossCheck: 'flipped',
      results: [
        { recordId: HELD, crossCheck: 'held' },
        { recordId: FLIPPED, crossCheck: 'flipped' },
      ],
      memoryOnPath: [
        { recordId: HELD, trust: 'candidate' },
        { recordId: FLIPPED, trust: 'low-trust-active' },
      ],
    })

    expect(evidence?.state).toBe('flipped')
    expect(evidence?.text).toBe(misdirectionAttributionLine(1))
    // THE TWO SETS ARE DIFFERENT SETS. Causal names what the cross-check FLIPPED; on-path names
    // every low-trust record the run put in front of this member. Folding them would attribute the
    // failure to a record whose check HELD.
    expect(evidence?.causalRecords).toEqual([FLIPPED])
    expect(evidence?.onPath?.map((entry) => entry.recordId)).toEqual([HELD, FLIPPED])
  })

  it('refuses to soften a flipped ROW under a block word that says held', () => {
    const evidence = withMisdirection({
      state: 'measured',
      crossCheck: 'held',
      results: [{ recordId: FLIPPED, crossCheck: 'flipped' }],
    })

    expect(evidence?.state, 'the row wins, in the safe direction only').toBe('flipped')
    expect(evidence?.causalRecords).toEqual([FLIPPED])
  })

  it('retains every result and unresolved reason when another record flipped', () => {
    const results = [
      { recordId: HELD, crossCheck: 'held' as const },
      { recordId: FLIPPED, crossCheck: 'flipped' as const },
      { recordId: 'rec_capped', crossCheck: 'not-run' as const, reason: 'cap-exceeded' as const },
      { recordId: 'rec_interrupted', crossCheck: 'inconclusive' as const, reason: 'interrupted' as const },
    ]
    const evidence = withMisdirection({ state: 'measured', crossCheck: 'flipped', results })

    expect(evidence?.results, 'an aggregate attribution must not discard other recorded outcomes')
      .toEqual(results)
    expect(evidence?.state).toBe('flipped')
    expect(evidence?.causalRecords).toEqual([FLIPPED])
    expect(evidence?.onPath, 'the ledger does not invent an exposure declaration').toBeUndefined()
    expect(withMisdirection({ state: 'not-recorded' })?.results).toBeUndefined()
    expect(withMisdirection({ state: 'declared-only', crossCheck: 'not-run', results: [] })?.results)
      .toEqual([])
  })

  it('renders the D-19 declared-only backing as its own state, never as a measurement', () => {
    const evidence = withMisdirection({
      state: 'declared-only',
      crossCheck: 'not-run',
      results: [],
      backing: 'declared-only',
      memoryOnPath: [],
    })

    expect(evidence?.state).toBe('declared-only')
    expect(evidence?.text).toBe(MISDIRECTION_DECLARED_ONLY_TEXT)
    expect(evidence?.text, 'a declaration is not a result').not.toContain('held')
    expect(evidence?.causalRecords).toEqual([])
    // `[]` is the author declaring NO records; the absence cell below is a different claim.
    expect(evidence?.onPathText).toBe(MEMORY_ON_PATH_NONE_TEXT)
  })

  it('reports a BROKEN root as unresolved with its disclosed word, never as declared-only', () => {
    // D-19's one exemption is ABSENCE, not breakage. A root that exists and cannot be read leaves
    // the same empty ledger as one that is absent and has NOT earned the BYOM exemption.
    const evidence = withMisdirection({
      state: 'measured',
      crossCheck: 'not-run',
      results: [{ recordId: HELD, crossCheck: 'not-run', reason: 'posture-unavailable' }],
      memoryOnPath: [{ recordId: HELD, trust: 'candidate' }],
    })

    expect(evidence?.state).toBe('unresolved')
    expect(evidence?.text).toBe(MISDIRECTION_UNRESOLVED_TEXT)
    expect(evidence?.text).not.toContain('declared-only')
    expect(evidence?.unbackedReason).toBe('posture-unavailable')
    expect(evidence?.unbackedText).toBe(misdirectionUnbackedLine('posture-unavailable'))
  })

  it('reports a CAP-EXCEEDED row as unbacked too, with its own word', () => {
    const evidence = withMisdirection({
      state: 'measured',
      crossCheck: 'not-run',
      results: [{ recordId: HELD, crossCheck: 'not-run', reason: 'cap-exceeded' }],
    })

    expect(evidence?.state).toBe('unresolved')
    expect(evidence?.unbackedReason).toBe('cap-exceeded')
    expect(evidence?.unbackedText).toBe(misdirectionUnbackedLine('cap-exceeded'))
  })

  it('keeps a DECLARED path with no ledger at not recorded, and absent apart from empty', () => {
    const declared = withMisdirection({
      state: 'not-recorded',
      memoryOnPath: [{ recordId: HELD, trust: 'candidate' }],
    })
    expect(declared?.state).toBe('not-recorded')
    expect(declared?.text).toBe(MISDIRECTION_NOT_RECORDED_TEXT)
    expect(declared?.causalRecords).toEqual([])
    expect(declared?.onPath).toEqual([{ recordId: HELD, trust: 'candidate' }])

    // ABSENT IS NOT EMPTY, at the last reader as at every one before it (422-12).
    const undeclared = withMisdirection({ state: 'not-recorded' })
    expect(undeclared?.onPath, 'the author declared NOTHING').toBeUndefined()
    expect(undeclared?.onPathText).toBe(MEMORY_ON_PATH_NOT_RECORDED_TEXT)

    const empty = withMisdirection({ state: 'not-recorded', memoryOnPath: [] })
    expect(empty?.onPath, 'the author declared NO records').toEqual([])
    expect(empty?.onPathText).toBe(MEMORY_ON_PATH_NONE_TEXT)
  })

  it('projects a verdict with NO circularity member to NO evidence at all', () => {
    // THE ADDITIVE CLAIM, and it is measured rather than assumed: the bytes below are exactly what
    // `analysis.get` serves for every run written before 422 and for the deterministic floor.
    expect(withMisdirection(undefined), 'a historical run renders as it always did').toBeUndefined()
  })
})
