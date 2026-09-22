// THE PROJECTION, HELD TOTAL AND PURE (404-07 · LIFE-03, D-21/D-22/D-23).
//
// `projectPostProcessingView` is the whole distance between "what the route said" and "what a
// person reads". It takes a `PostProcessingRead` and returns a view; it has no I/O, no clock and
// no envelope type in its signature — which is the structural half of D-17. These cells fix the
// PUBLISHED SENTENCES by their exported constants rather than by literal prose (403-05 D-5), so
// a copy change moves one line here and one line in the module, and never silently diverges.
//
// THE CELL THAT MATTERS MOST is the `failed`-with-no-envelope one. D-21 as narrowed in 404-03 put
// the masked reason on the in-process `*Failed` chip envelope and NOT on the durable notification
// row, because the daemon's pump folds with no masking context. So a daemon-drained failure has no
// reason anywhere, and the only honest renderings are "failed, reason not recorded — drained by the
// daemon" and a lie. Blank is a lie by omission; `pending` is a lie outright.

import { describe, expect, it } from 'vitest'
import type { CurationBreakdown, PostProcessingStatus } from '@vostride/agent-qa-schema'

import type { PostProcessingRead } from '@/lib/api'
import {
  ANALYSIS_COMPLETE_NO_ISSUES_TEXT,
  ANALYSIS_RUNNING_TEXT,
  BREAKDOWN_NOT_RECORDED_TEXT,
  BREAKDOWN_WITHHELD_TEXT,
  CHIPS_UNAVAILABLE_TEXT,
  COUNTS_NOT_RECORDED_TEXT,
  CURATION_RUNNING_TEXT,
  FAILED_REASON_ABSENT_TEXT,
  NO_MEMORY_CHANGES_TEXT,
  OPEN_KNOWLEDGE_TAB_TEXT,
  OPEN_VERDICT_TEXT,
  PENDING_POSTURE_TEXT,
  POST_PROCESSING_LOADING_LABEL,
  POST_PROCESSING_UNAVAILABLE_WORD,
  STAGE_INDICATOR_WORDS,
  STAGE_PRESENTATION_STATES,
  WILL_RETRY_TEXT,
  curationBreakdownLine,
  curationChipAccessibleName,
  legacyCurationPairText,
  projectPostProcessingView,
  stageFailedText,
  stageIndicatorAccessibleName,
  stageQueuedText,
} from '@/lib/post-processing-view'

const RUN_ID = 'run_view'

function status(
  analysis: string,
  curation: string,
  notification?: unknown,
  extra: Record<string, unknown> = {},
): PostProcessingStatus {
  return {
    runId: RUN_ID,
    chips: { analysis, curation },
    ...(notification === undefined ? {} : { notification }),
    ...extra,
  } as unknown as PostProcessingStatus
}

function breakdown(counts: Partial<CurationBreakdown> = {}): CurationBreakdown {
  return { added: 0, confirmed: 0, superseded: 0, deprecated: 0, proposed: 0, ...counts }
}

function notification(
  curation: Record<string, unknown>,
  verdictSummary: unknown = { total: 1, byClass: {} },
): unknown {
  return {
    schemaVersion: 2,
    runId: RUN_ID,
    outcome: 'done',
    verdictSummary,
    stages: { analysis: { status: 'done' }, curation },
  }
}

function read(body: Partial<Extract<PostProcessingRead, { kind: 'read' }>>): PostProcessingRead {
  return { kind: 'read', status: status('pending', 'pending'), ...body }
}

/** The chips arm, narrowed — every cell below reads two chips, and none of them may be a refusal. */
function chips(view: ReturnType<typeof projectPostProcessingView>) {
  if (view.kind !== 'chips') throw new Error(`expected chips, got ${view.kind}`)
  return view
}

describe('a refusal is its own state, never a pending chip (D-23)', () => {
  it('carries the refusal name and reason through, with no chips at all', () => {
    const view = projectPostProcessingView({
      kind: 'unavailable',
      error: 'job_store_schema_version',
      reason: 'the queue database is stamped by another build',
    })
    expect(view).toEqual({
      kind: 'unavailable',
      error: 'job_store_schema_version',
      reason: 'the queue database is stamped by another build',
    })
  })

  it('publishes the unavailable sentence as an exported constant, not as prose in a component', () => {
    expect(CHIPS_UNAVAILABLE_TEXT.length).toBeGreaterThan(0)
    expect(CHIPS_UNAVAILABLE_TEXT).toContain('unavailable')
  })
})

describe('a pending chip carries the run posture, read off the record (D-22)', () => {
  it('has NO posture while the run has not reached runFinished — no disposition is not a guess', () => {
    const view = chips(projectPostProcessingView(read({})))
    expect(view.analysis).toEqual({
      status: 'pending',
      state: 'pending',
      word: STAGE_INDICATOR_WORDS.analysis.pending,
      card: { outcome: 'Analysis queued' },
    })
    expect(view.curation).toEqual({
      status: 'pending',
      state: 'pending',
      word: STAGE_INDICATOR_WORDS.curation.pending,
      card: { outcome: 'Curation queued' },
    })
  })

  it('names each of the three postures by its published sentence', () => {
    for (const disposition of ['drained', 'handedOff', 'detached'] as const) {
      const view = chips(projectPostProcessingView(read({ disposition })))
      expect(view.analysis.card?.outcome)
        .toBe(stageQueuedText('analysis', PENDING_POSTURE_TEXT[disposition]))
    }
    expect(PENDING_POSTURE_TEXT.handedOff).toBe('daemon draining')
    expect(PENDING_POSTURE_TEXT.detached).toContain('not queued for drain')
  })
})

describe('a running chip says one word and nothing else', () => {
  it('carries no posture and no counts even with a disposition on the read', () => {
    const view = chips(projectPostProcessingView(read({
      status: status('running', 'running'),
      disposition: 'drained',
    })))
    expect(view.analysis).toEqual({
      status: 'running',
      state: 'running',
      word: STAGE_INDICATOR_WORDS.analysis.running,
      card: { outcome: ANALYSIS_RUNNING_TEXT },
    })
    expect(view.curation).toEqual({
      status: 'running',
      state: 'running',
      word: STAGE_INDICATOR_WORDS.curation.running,
      card: { outcome: CURATION_RUNNING_TEXT },
    })
  })
})

describe('a terminal curation card says what it committed (D-21, D-17/D-18 wording of record)', () => {
  it('reads the breakdown off the snapshot on the same read — five buckets, zeros omitted', () => {
    const view = chips(projectPostProcessingView(read({
      status: status('done', 'done', notification({ status: 'done' }), {
        curationSnapshot: { schemaVersion: 1, rows: [], breakdown: breakdown({ added: 4, deprecated: 2 }) },
      }),
      disposition: 'drained',
    })))
    expect(view.curation.card?.outcome).toBe('Curation complete — 4 added · 2 deprecated')
    expect(view.curation.card?.note).toBeUndefined()
  })

  it('says `counts not recorded for this run` when the row committed no counts — never a zero (D-12)', () => {
    const view = chips(projectPostProcessingView(read({
      status: status('done', 'done', notification({ status: 'done' })),
    })))
    expect(view.curation.card?.outcome).toBe(`Curation complete — ${COUNTS_NOT_RECORDED_TEXT}`)
    expect(COUNTS_NOT_RECORDED_TEXT).toBe('counts not recorded for this run')
  })

  it('says the counts-absent line when only ONE of the pair was recorded — half a pair is no pair', () => {
    const view = chips(projectPostProcessingView(read({
      status: status('done', 'done', notification({ status: 'done', curated: 4 })),
    })))
    expect(view.curation.card?.outcome).toBe(`Curation complete — ${COUNTS_NOT_RECORDED_TEXT}`)
  })

  it('keeps a bare `done` when there is no notification row at all — nothing to say counts about', () => {
    const view = chips(projectPostProcessingView(read({ status: status('done', 'done') })))
    expect(view.curation)
      .toEqual({ status: 'done', state: 'complete', word: STAGE_INDICATOR_WORDS.curation.complete })
  })

  it('renders an all-zero breakdown as `no memory changes` rather than as five zeros (D-17)', () => {
    const view = chips(projectPostProcessingView(read({
      status: status('done', 'done', notification({ status: 'done' }), {
        curationSnapshot: { schemaVersion: 1, rows: [], breakdown: breakdown() },
      }),
    })))
    expect(view.curation.card?.outcome).toBe(`Curation complete — ${NO_MEMORY_CHANGES_TEXT}`)
  })

  it('never invents a card for the analysis chip from curation counts', () => {
    const view = chips(projectPostProcessingView(read({
      status: status('done', 'done', notification({ status: 'done' }), {
        curationSnapshot: { schemaVersion: 1, rows: [], breakdown: breakdown({ added: 4 }) },
      }),
    })))
    expect(view.analysis)
      .toEqual({ status: 'done', state: 'complete', word: STAGE_INDICATOR_WORDS.analysis.complete })
  })
})

// FIVE BUCKETS ARE NEVER SYNTHESIZED FROM TWO (D-18). A pre-423 row carries a pair and nothing
// else; a withheld snapshot carries a reason and nothing else. Each renders what EXISTS, labelled,
// rather than a breakdown the run never recorded.
describe('the curation breakdown is one function, and legacy rows say what they are (D-17/D-18)', () => {
  it('lists only the non-zero buckets, in the schema order, joined by a middle dot', () => {
    expect(curationBreakdownLine(breakdown({
      added: 1, confirmed: 1, superseded: 1, deprecated: 1, proposed: 1,
    }))).toBe('1 added · 1 confirmed · 1 superseded · 1 deprecated · 1 proposed')
    expect(curationBreakdownLine(breakdown({ added: 1, superseded: 1, proposed: 2 })))
      .toBe('1 added · 1 superseded · 2 proposed')
    expect(curationBreakdownLine(breakdown())).toBe(NO_MEMORY_CHANGES_TEXT)
    expect(NO_MEMORY_CHANGES_TEXT).toBe('no memory changes')
  })

  it('renders a legacy pair verbatim and labels it as the absence of a breakdown', () => {
    expect(legacyCurationPairText(2, 0)).toBe('2 curated · 0 deprecated')
    const view = chips(projectPostProcessingView(read({
      status: status('done', 'done', notification({ status: 'done', curated: 2, deprecated: 0 })),
    })))
    expect(view.curation.card?.outcome).toBe('Curation complete — 2 curated · 0 deprecated')
    expect(view.curation.card?.note).toBe(BREAKDOWN_NOT_RECORDED_TEXT)
    expect(BREAKDOWN_NOT_RECORDED_TEXT).toBe('Breakdown not recorded for this run')
  })

  it('names the withheld category rather than inventing counts for it', () => {
    for (const reason of ['masking-unavailable', 'projection-refused'] as const) {
      const view = chips(projectPostProcessingView(read({
        status: status('done', 'done', notification({ status: 'done' }), {
          curationSnapshotWithheld: { reason },
        }),
      })))
      expect(view.curation.card?.outcome).toBe('Curation complete')
      expect(view.curation.card?.note).toBe(BREAKDOWN_WITHHELD_TEXT[reason])
    }
    expect(BREAKDOWN_WITHHELD_TEXT['masking-unavailable'])
      .toBe('Breakdown not available for this run — masking unavailable')
    expect(BREAKDOWN_WITHHELD_TEXT['projection-refused'])
      .toBe('Breakdown not available for this run — projection refused')
  })

  it('prefers the snapshot over the legacy pair — a snapshot-bearing row never says `curated`', () => {
    const view = chips(projectPostProcessingView(read({
      status: status('done', 'done', notification({ status: 'done', curated: 2, deprecated: 0 }), {
        curationSnapshot: { schemaVersion: 1, rows: [], breakdown: breakdown({ added: 2 }) },
      }),
    })))
    expect(view.curation.card?.outcome).toBe('Curation complete — 2 added')
    expect(view.curation.card?.note).toBeUndefined()
  })
})

// EVERY STATE HAS AN HONEST FIRST LINE (D-13). A card that could open blank is a hover that rewards
// the reader with nothing — which is the failure the whole card exists to fix.
describe('running, queued and failed stages each read their own sentence (D-12/D-13)', () => {
  it('names a running stage in its own words', () => {
    const view = chips(projectPostProcessingView(read({ status: status('running', 'running') })))
    expect(view.analysis.card?.outcome).toBe(ANALYSIS_RUNNING_TEXT)
    expect(view.curation.card?.outcome).toBe(CURATION_RUNNING_TEXT)
    expect(ANALYSIS_RUNNING_TEXT).toBe('Analysis running')
    expect(CURATION_RUNNING_TEXT).toBe('Curation running')
  })

  it('puts the drain posture in the CARD, and says the bare word when no posture was recorded', () => {
    const withPosture = chips(projectPostProcessingView(read({ disposition: 'handedOff' })))
    expect(withPosture.analysis.card?.outcome)
      .toBe(stageQueuedText('analysis', PENDING_POSTURE_TEXT.handedOff))
    expect(withPosture.analysis.card?.outcome)
      .toBe(`Analysis queued — ${PENDING_POSTURE_TEXT.handedOff}`)

    const bare = chips(projectPostProcessingView(read({})))
    expect(bare.analysis.card?.outcome).toBe('Analysis queued')
    expect(bare.curation.card?.outcome).toBe('Curation queued')
  })

  it('carries the masked failure reason, or the posture-qualified absence, plus the retry line', () => {
    const withReason = chips(projectPostProcessingView(read({
      status: status('failed', 'pending'),
      disposition: 'drained',
      failures: { analysis: { error: 'analysis stage blew up on step 3', willRetry: true } },
    })))
    expect(withReason.analysis.card?.outcome)
      .toBe(stageFailedText('analysis', 'analysis stage blew up on step 3'))
    expect(withReason.analysis.card?.outcome)
      .toBe('Analysis failed — analysis stage blew up on step 3')
    expect(withReason.analysis.card?.retry).toBe(WILL_RETRY_TEXT)
    expect(WILL_RETRY_TEXT).toBe('Will retry')

    const noReason = chips(projectPostProcessingView(read({
      status: status('failed', 'pending'),
      disposition: 'handedOff',
      failures: {},
    })))
    expect(noReason.analysis.card?.outcome)
      .toBe(stageFailedText('analysis', FAILED_REASON_ABSENT_TEXT.handedOff))
    expect(noReason.analysis.card?.retry).toBeUndefined()
  })
})

describe('a failed chip says why, or says honestly that nobody recorded why (D-21 as narrowed)', () => {
  it('renders the producer masked text VERBATIM — the page slices nothing', () => {
    const long = `a${'b'.repeat(480)}`
    const view = chips(projectPostProcessingView(read({
      status: status('failed', 'pending'),
      disposition: 'drained',
      failures: { analysis: { error: long, willRetry: false } },
    })))
    expect(view.analysis.card?.outcome).toBe(stageFailedText('analysis', long))
    expect(view.analysis.card?.retry).toBeUndefined()
  })

  it('a handedOff failure with no envelope says so by posture, and names no reason', () => {
    const view = chips(projectPostProcessingView(read({
      status: status('failed', 'pending'),
      disposition: 'handedOff',
      failures: {},
    })))
    expect(view.analysis.status).toBe('failed')
    expect(view.analysis.card?.outcome)
      .toBe(stageFailedText('analysis', FAILED_REASON_ABSENT_TEXT.handedOff))
    expect(FAILED_REASON_ABSENT_TEXT.handedOff).toContain('drained by the daemon')
  })

  it('a detached failure with no envelope names the later drainer instead', () => {
    const view = chips(projectPostProcessingView(read({
      status: status('pending', 'failed'),
      disposition: 'detached',
      failures: {},
    })))
    expect(view.curation.card?.outcome)
      .toBe(stageFailedText('curation', FAILED_REASON_ABSENT_TEXT.detached))
    expect(FAILED_REASON_ABSENT_TEXT.detached).toContain('later process')
  })

  it('a failure on a read whose `failures` key is ABSENT falls back without a disposition word', () => {
    const view = chips(projectPostProcessingView(read({ status: status('failed', 'pending') })))
    expect(view.analysis.card?.outcome)
      .toBe(stageFailedText('analysis', FAILED_REASON_ABSENT_TEXT.unknown))
  })

  it('is never blank: every failed chip carries an outcome sentence, on all four postures', () => {
    const postures = [undefined, 'drained', 'handedOff', 'detached'] as const
    for (const disposition of postures) {
      const view = chips(projectPostProcessingView(read({
        status: status('failed', 'failed'),
        ...(disposition === undefined ? {} : { disposition }),
        failures: {},
      })))
      for (const chip of [view.analysis, view.curation]) {
        expect(chip.status).toBe('failed')
        expect(chip.card?.outcome).toBeTruthy()
      }
    }
  })
})

// RETIRED 425-06 (D-16). The two cells that stood here pinned the legacy pair's folded sentence,
// whose last reader — the Knowledge tab's Learned heading — now calls `curationBreakdownLine` and
// `legacyCurationPairText` instead. Both of those are pinned in this file's breakdown cells, so
// retiring the function retired its cells rather than leaving them asserting over nothing.
describe('the count line is the wording of record, in one place (D-09)', () => {
  it('publishes the curation door name as a thin call into the one accessible-name function', () => {
    const settled = { status: 'done', state: 'complete', word: STAGE_INDICATOR_WORDS.curation.complete } as const
    expect(curationChipAccessibleName(settled)).toBe('Curation: complete — open Knowledge tab')
    expect(curationChipAccessibleName({ ...settled, card: { outcome: 'Curation complete — 2 added' } }))
      .toBe('Curation: complete, 2 added — open Knowledge tab')
    expect(OPEN_KNOWLEDGE_TAB_TEXT).toBe('Open Knowledge tab')
    expect(OPEN_VERDICT_TEXT).toBe('Open verdict')
  })
})

// THE PASSING RUN EXPLAINS ITSELF (425-01 · D-13, roadmap SC3). The sentence a person reads on the
// one run shape that ships every day — analysis settled, nothing to report — is the phase's copy
// cell, and it is a CONSTANT so the card, the accessible name and this cell cannot drift apart.
describe('a settled analysis with nothing to report says so in one sentence (D-13)', () => {
  it('ANALYSIS-COMPLETE-COPY: publishes the sentence and projects it onto a no-verdict pass', () => {
    expect(ANALYSIS_COMPLETE_NO_ISSUES_TEXT).toBe('Analysis complete — no issues found')

    const view = chips(projectPostProcessingView(read({
      status: status('done', 'done', notification({ status: 'done' }, { total: 0, byClass: {} })),
      disposition: 'drained',
    })))

    expect(view.analysis.state).toBe('complete')
    expect(view.analysis.word).toBe(STAGE_INDICATOR_WORDS.analysis.complete)
    expect(view.analysis.card?.outcome).toBe(ANALYSIS_COMPLETE_NO_ISSUES_TEXT)
    expect(stageIndicatorAccessibleName('analysis', 'complete', ANALYSIS_COMPLETE_NO_ISSUES_TEXT))
      .toBe('Analysis: complete, no issues found')
  })
})

// THE VISIBLE WORD (425-01 · D-07). A settled stage is quiet — the name alone. Every other state
// says itself, because those are the states a person can act on. The set is six and the order is
// the one the never-bar pins; a cell that only walked the reachable ones would not see a gap.
describe('an indicator says the stage, and says the state when it needs attention (D-07)', () => {
  it('STAGE-INDICATOR-WORDS: the stage name alone for complete, name plus state word otherwise', () => {
    expect(STAGE_PRESENTATION_STATES).toEqual([
      'complete',
      'running',
      'pending',
      'failed',
      'excluded',
      'unavailable',
    ])
    expect(STAGE_PRESENTATION_STATES).toHaveLength(6)

    expect(STAGE_INDICATOR_WORDS.analysis).toEqual({
      complete: 'Analysis',
      running: 'Analysis running',
      pending: 'Analysis pending',
      failed: 'Analysis failed',
      excluded: 'Analysis excluded',
    })
    expect(STAGE_INDICATOR_WORDS.curation).toEqual({
      complete: 'Curation',
      running: 'Curation running',
      pending: 'Curation pending',
      failed: 'Curation failed',
      excluded: 'Curation excluded',
    })
    expect(POST_PROCESSING_UNAVAILABLE_WORD).toBe('Post-processing unavailable')
    expect(POST_PROCESSING_LOADING_LABEL).toBe('Post-processing status loading')
  })
})
