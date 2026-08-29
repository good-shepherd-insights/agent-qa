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
import type { PostProcessingStatus } from '@vostride/agent-qa-schema'

import type { PostProcessingRead } from '@/lib/api'
import {
  CHIPS_UNAVAILABLE_TEXT,
  COUNTS_NOT_RECORDED_TEXT,
  CURATION_CHIP_TITLE,
  FAILED_REASON_ABSENT_TEXT,
  PENDING_POSTURE_TEXT,
  curationChipAccessibleName,
  curationFactsText,
  projectPostProcessingView,
} from '@/lib/post-processing-view'

const RUN_ID = 'run_view'

function status(analysis: string, curation: string, notification?: unknown): PostProcessingStatus {
  return {
    runId: RUN_ID,
    chips: { analysis, curation },
    ...(notification === undefined ? {} : { notification }),
  } as unknown as PostProcessingStatus
}

function notification(curation: Record<string, unknown>): unknown {
  return {
    schemaVersion: 2,
    runId: RUN_ID,
    outcome: 'done',
    verdictSummary: { total: 1, byClass: {} },
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
    expect(view.analysis).toEqual({ status: 'pending' })
    expect(view.curation).toEqual({ status: 'pending' })
  })

  it('names each of the three postures by its published sentence', () => {
    for (const disposition of ['drained', 'handedOff', 'detached'] as const) {
      const view = chips(projectPostProcessingView(read({ disposition })))
      expect(view.analysis.posture).toBe(PENDING_POSTURE_TEXT[disposition])
    }
    expect(PENDING_POSTURE_TEXT.handedOff).toBe('daemon draining')
    expect(PENDING_POSTURE_TEXT.detached).toContain('not queued for drain')
  })
})

describe('a running chip says one word and nothing else', () => {
  it('carries no parenthetical, no facts and no error even with a disposition on the read', () => {
    const view = chips(projectPostProcessingView(read({
      status: status('running', 'running'),
      disposition: 'drained',
    })))
    expect(view.analysis).toEqual({ status: 'running' })
    expect(view.curation).toEqual({ status: 'running' })
  })
})

describe('a terminal curation chip says what it committed (D-21, D-09 wording of record)', () => {
  it('reads the count line off the notification row on the same read', () => {
    const view = chips(projectPostProcessingView(read({
      status: status('done', 'done', notification({ status: 'done', curated: 4, deprecated: 2 })),
      disposition: 'drained',
    })))
    expect(view.curation.facts).toBe('curated 4 facts, deprecated 2')
  })

  it('says `counts not recorded for this run` when the row committed no counts — never a zero (D-12)', () => {
    const view = chips(projectPostProcessingView(read({
      status: status('done', 'done', notification({ status: 'done' })),
    })))
    expect(view.curation.facts).toBe(COUNTS_NOT_RECORDED_TEXT)
    expect(COUNTS_NOT_RECORDED_TEXT).toBe('counts not recorded for this run')
  })

  it('says the counts-absent line when only ONE of the pair was recorded — half a pair is no pair', () => {
    const view = chips(projectPostProcessingView(read({
      status: status('done', 'done', notification({ status: 'done', curated: 4 })),
    })))
    expect(view.curation.facts).toBe(COUNTS_NOT_RECORDED_TEXT)
  })

  it('keeps a bare `done` when there is no notification row at all — nothing to say counts about', () => {
    const view = chips(projectPostProcessingView(read({ status: status('done', 'done') })))
    expect(view.curation).toEqual({ status: 'done' })
  })

  it('renders both-zero as `nothing curated` rather than as two zeros', () => {
    const view = chips(projectPostProcessingView(read({
      status: status('done', 'done', notification({ status: 'done', curated: 0, deprecated: 0 })),
    })))
    expect(view.curation.facts).toBe('nothing curated')
  })

  it('never invents facts for the analysis chip — that stage commits no counts', () => {
    const view = chips(projectPostProcessingView(read({
      status: status('done', 'done', notification({ status: 'done', curated: 4, deprecated: 2 })),
    })))
    expect(view.analysis).toEqual({ status: 'done' })
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
    expect(view.analysis.error).toBe(long)
    expect(view.analysis.willRetry).toBe(false)
    expect(view.analysis.reasonAbsent).toBeUndefined()
  })

  it('a handedOff failure with no envelope says so by posture, and carries no error', () => {
    const view = chips(projectPostProcessingView(read({
      status: status('failed', 'pending'),
      disposition: 'handedOff',
      failures: {},
    })))
    expect(view.analysis.status).toBe('failed')
    expect(view.analysis.error).toBeUndefined()
    expect(view.analysis.reasonAbsent).toBe(FAILED_REASON_ABSENT_TEXT.handedOff)
    expect(FAILED_REASON_ABSENT_TEXT.handedOff).toContain('drained by the daemon')
  })

  it('a detached failure with no envelope names the later drainer instead', () => {
    const view = chips(projectPostProcessingView(read({
      status: status('pending', 'failed'),
      disposition: 'detached',
      failures: {},
    })))
    expect(view.curation.reasonAbsent).toBe(FAILED_REASON_ABSENT_TEXT.detached)
    expect(FAILED_REASON_ABSENT_TEXT.detached).toContain('later process')
  })

  it('a failure on a read whose `failures` key is ABSENT falls back without a disposition word', () => {
    const view = chips(projectPostProcessingView(read({ status: status('failed', 'pending') })))
    expect(view.analysis.reasonAbsent).toBe(FAILED_REASON_ABSENT_TEXT.unknown)
    expect(view.analysis.error).toBeUndefined()
  })

  it('is never blank: every failed chip carries an error OR a reasonAbsent, on all four postures', () => {
    const postures = [undefined, 'drained', 'handedOff', 'detached'] as const
    for (const disposition of postures) {
      const view = chips(projectPostProcessingView(read({
        status: status('failed', 'failed'),
        ...(disposition === undefined ? {} : { disposition }),
        failures: {},
      })))
      for (const chip of [view.analysis, view.curation]) {
        expect(chip.status).toBe('failed')
        expect(chip.error ?? chip.reasonAbsent).toBeTruthy()
      }
    }
  })
})

describe('the count line is the wording of record, in one place (D-09)', () => {
  it('pluralises the curated noun and leaves the deprecated count bare', () => {
    expect(curationFactsText(3, 1)).toBe('curated 3 facts, deprecated 1')
    expect(curationFactsText(1, 0)).toBe('curated 1 fact, deprecated 0')
    expect(curationFactsText(0, 2)).toBe('curated 0 facts, deprecated 2')
  })

  it('collapses the both-zero pair to one phrase — two zeros read as a measurement nobody made', () => {
    expect(curationFactsText(0, 0)).toBe('nothing curated')
  })

  it('publishes the chip hover title and the accessible name as constants the cells name', () => {
    expect(CURATION_CHIP_TITLE).toBe('Open the Knowledge tab (7)')
    expect(curationChipAccessibleName('done')).toBe('curation done — open Knowledge tab')
    expect(curationChipAccessibleName('failed')).toBe('curation failed — open Knowledge tab')
  })
})
