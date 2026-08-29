// THE KNOWLEDGE PROJECTION, HELD TOTAL AND PURE (407-02 · LERN-01, D-01/D-03/D-04/D-06/D-16).
//
// `projectKnowledgeView` is the whole distance between what `runs.knowledge` said and what a
// person reads in the Knowledge tab. It takes a `KnowledgeRead` — the client's own bytes — and
// returns a view; it has no I/O, no clock and no React in its signature, so a state the panel
// paints can never be one the op did not say.
//
// THE CELLS FIX THE PUBLISHED SENTENCES BY THEIR EXPORTED CONSTANTS (403-05 D-5), never by
// literal prose. Copy moves in one place and the tests move with it; prose inlined in a component
// is prose that drifts from prose inlined in a test, and both of them stay green while the two
// disagree.
//
// THE CELLS THAT MATTER MOST are the absence ones. D-03's summary line omits a zero segment, so
// "every segment zero" and "no steps at all" are two DIFFERENT sentences: the first says
// retrieval ran and served nothing, the second says this run has no briefed step to describe.
// Collapsing them would tell a reader the store is empty when in fact nothing asked it anything.

import { describe, expect, it } from 'vitest'
import { TRACE_TRUNCATION_TOP_K } from '@vostride/agent-qa-schema'
import type {
  RunKnowledgeCanaryAttribution,
  RunKnowledgeProjection,
  RunKnowledgeStep,
  TraceLine,
} from '@vostride/agent-qa-schema'

import type { KnowledgeRead } from '@/lib/api'
import {
  ATTRIBUTION_PENDING_TEXT,
  BROKE_CAUSE_LABELS,
  CANARY_BADGE_TEXT,
  CHANNEL_PAGE_SIZE,
  LEARNED_HEADING,
  NOT_ATTRIBUTED_TEXT,
  NO_BRIEF_LINES_TEXT,
  NO_BRIEF_SERVED_TEXT,
  NO_STORE_BODY,
  NO_STORE_HEADING,
  PROCEDURE_HINT_DEMOTED_TEXT,
  PROCEDURE_HINT_TEXT,
  PRE_TRACE_TEXT,
  READ_FAILED_HEADING,
  REPLAY_FACT,
  HINT_FACT,
  STEP_NOT_FOUND_TEXT,
  STEP_NO_BRIEF_TEXT,
  USED_HEADING,
  WHY_TRIGGER_TEXT,
  CHANNEL_EYEBROWS,
  briefLineViews,
  briefLinesFact,
  brokeAtText,
  canaryFact,
  canaryOutcomeWord,
  channelPage,
  cutCandidates,
  cutCandidatesLabel,
  planSourceSentence,
  planSourceView,
  projectKnowledgeView,
  readFailedBody,
  replayedText,
  showAllLinesLabel,
  stepRowTitle,
  traceLineText,
  usedSummaryLine,
} from '@/lib/knowledge-view'

const RUN_ID = 'r_knowledge_view'

/** One projected step, with everything absent unless a cell asks for it. */
function step(overrides: Partial<RunKnowledgeStep> = {}): RunKnowledgeStep {
  return {
    testId: 't_one',
    testIndex: 0,
    stepIndex: 0,
    stepText: 'click checkout',
    served: { channel1: [], channel2: [], channel3: [] },
    trace: { kind: 'no-trace', reason: 'pre-trace-run' },
    ...overrides,
  } as RunKnowledgeStep
}

/** One channel-1 brief line; `servedAsCanary` is the only field any cell here varies. */
function briefLine(servedAsCanary = false, id = 'rec_1'): RunKnowledgeStep['served']['channel1'][number] {
  return {
    id,
    kind: 'fact',
    summary: 'the cart page lives at /view_cart',
    trust: 0.9,
    status: 'active',
    servedAsCanary,
    tier: 'confirmed',
  }
}

function ready(overrides: Partial<Extract<RunKnowledgeProjection, { kind: 'ready' }>> = {}): KnowledgeRead {
  return {
    kind: 'read',
    projection: {
      kind: 'ready',
      runId: RUN_ID,
      buildOrdinal: 3,
      knowledgeStore: 'bound',
      steps: [],
      curation: { status: 'done' },
      learned: { changes: [], canaryAttributions: [] },
      ...overrides,
    } as Extract<RunKnowledgeProjection, { kind: 'ready' }>,
  }
}

/** The `ready` arm, narrowed — most cells below read a used half, and none of them may be a state. */
function usedOf(view: ReturnType<typeof projectKnowledgeView>) {
  if (view.state !== 'ready') throw new Error(`expected ready, got ${view.state}`)
  return view.used
}

describe('a failed read is its own state, never an empty panel (D-06)', () => {
  it('carries the read-failed heading and the masked reason with the doctor pointer', () => {
    const view = projectKnowledgeView({ kind: 'unavailable', error: 'read_failed' })

    expect(view.state).toBe('error')
    if (view.state !== 'error') throw new Error('unreachable')
    expect(view.heading).toBe(READ_FAILED_HEADING)
    expect(view.body).toBe(readFailedBody('read_failed'))
    expect(view.body).toContain('read_failed')
    expect(view.body).toContain('agent-qa doctor')
  })

  it('forwards the producer error VERBATIM — never sliced, never re-worded (T-407-07)', () => {
    const hostile = '<img src=x onerror=alert(1)>'
    const view = projectKnowledgeView({ kind: 'unavailable', error: hostile })

    if (view.state !== 'error') throw new Error('unreachable')
    expect(view.body.startsWith(hostile)).toBe(true)
  })
})

describe('a pruned handoff is a legible state, not a refusal (D-06)', () => {
  it('projects evidence-incomplete with no body of its own — the shipped component owns the words', () => {
    const view = projectKnowledgeView({
      kind: 'read',
      projection: { kind: 'evidence-incomplete', runId: RUN_ID },
    })

    expect(view).toEqual({ state: 'evidence-incomplete' })
  })
})

describe('no knowledge reader bound is not a rung, it is a state (D-16)', () => {
  it('projects empty-no-store from knowledgeStore: unbound, whatever the steps say', () => {
    const view = projectKnowledgeView(ready({ knowledgeStore: 'unbound', steps: [step()] }))

    expect(view.state).toBe('empty-no-store')
    if (view.state !== 'empty-no-store') throw new Error('unreachable')
    expect(view.heading).toBe(NO_STORE_HEADING)
    expect(view.body).toBe(NO_STORE_BODY)
    expect(NO_STORE_HEADING).toBe('No knowledge store configured for this project')
  })
})

describe('the Used summary is DERIVED from the rows the panel already holds (D-03)', () => {
  it('reads the sentence of record with every segment present, joined by a middot', () => {
    const summary = usedSummaryLine({ stepsBriefed: 12, canaryLines: 4, replays: 1, hints: 2 })

    expect(summary).toBe('12 steps briefed · 4 canary lines served · 1 procedure replay, 2 hints')
  })

  it('uses the singular form of every segment at one', () => {
    const summary = usedSummaryLine({ stepsBriefed: 1, canaryLines: 1, replays: 1, hints: 1 })

    expect(summary).toBe('1 step briefed · 1 canary line served · 1 procedure replay, 1 hint')
  })

  it('omits a zero segment rather than printing a zero somebody measured', () => {
    expect(usedSummaryLine({ stepsBriefed: 3, canaryLines: 0, replays: 0, hints: 2 }))
      .toBe('3 steps briefed · 2 hints')
    expect(usedSummaryLine({ stepsBriefed: 0, canaryLines: 2, replays: 3, hints: 0 }))
      .toBe('2 canary lines served · 3 procedure replays')
  })

  it('says nothing was served when every segment is zero — never an empty line', () => {
    expect(usedSummaryLine({ stepsBriefed: 0, canaryLines: 0, replays: 0, hints: 0 }))
      .toBe(NO_BRIEF_LINES_TEXT)
  })

  it('counts a step as briefed when ANY of its three channels carried a line', () => {
    const view = projectKnowledgeView(ready({
      steps: [
        step({ stepIndex: 0, served: { channel1: [briefLine()], channel2: [], channel3: [] } }),
        step({ stepIndex: 1, served: { channel1: [], channel2: [], channel3: [{ id: 'c1', summary: 'slow page' }] } }),
        step({ stepIndex: 2 }),
      ],
    }))

    expect(usedOf(view).summary).toBe('2 steps briefed')
  })

  it('counts canary lines served across every step, not steps that served one', () => {
    const view = projectKnowledgeView(ready({
      steps: [
        step({ stepIndex: 0, served: { channel1: [briefLine(true), briefLine(true)], channel2: [], channel3: [] } }),
        step({ stepIndex: 1, served: { channel1: [briefLine(true)], channel2: [], channel3: [] } }),
      ],
    }))

    expect(usedOf(view).summary).toBe('2 steps briefed · 3 canary lines served')
  })

  it('says NO BRIEF WAS SERVED — a different sentence — when the run has no steps at all', () => {
    const view = projectKnowledgeView(ready({ steps: [] }))

    expect(usedOf(view).summary).toBe(NO_BRIEF_SERVED_TEXT)
    expect(NO_BRIEF_SERVED_TEXT).not.toBe(NO_BRIEF_LINES_TEXT)
    expect(usedOf(view).steps).toEqual([])
  })
})

describe('one row per step, whatever the row served (D-03)', () => {
  it('titles a row by its ONE-BASED ordinal and the step text', () => {
    const view = projectKnowledgeView(ready({
      steps: [step({ stepIndex: 2, stepText: 'click checkout' })],
    }))

    expect(usedOf(view).steps[0].title).toBe('Step 3 — click checkout')
    expect(stepRowTitle(2, 'click checkout')).toBe('Step 3 — click checkout')
  })

  it('carries both indices, because stepIndex is numbered PER MEMBER TEST', () => {
    const view = projectKnowledgeView(ready({
      steps: [
        step({ testIndex: 0, stepIndex: 0 }),
        step({ testId: 't_two', testIndex: 1, stepIndex: 0 }),
      ],
    }))

    const rows = usedOf(view).steps
    expect(rows.map(r => [r.testIndex, r.stepIndex])).toEqual([[0, 0], [1, 0]])
  })

  it('badges a briefed row with its line counts and marks no plan source', () => {
    const view = projectKnowledgeView(ready({
      steps: [step({
        served: { channel1: [briefLine(true), briefLine()], channel2: [], channel3: [] },
      })],
    }))

    const row = usedOf(view).steps[0]
    expect(row.briefLines).toBe(2)
    expect(row.canaryLines).toBe(1)
    expect(row.planSource).toBe('none')
    expect(row.facts).toEqual([briefLinesFact(2), canaryFact(1)])
    expect(row.noBrief).toBeUndefined()
  })

  it('uses the singular brief-line fact at one', () => {
    expect(briefLinesFact(1)).toBe('1 brief line')
    expect(briefLinesFact(4)).toBe('4 brief lines')
    expect(canaryFact(1)).toBe('1 canary')
  })

  it('states a replay row as a replay, and a hint row as a hint (D-07)', () => {
    const view = projectKnowledgeView(ready({
      steps: [
        step({
          stepIndex: 0,
          served: { channel1: [briefLine()], channel2: [], channel3: [] },
          planSource: { kind: 'procedure-replay', procedureId: 'p_1', guard: { checksPassed: 5, total: 5 } },
        }),
        step({
          stepIndex: 1,
          served: { channel1: [briefLine()], channel2: [], channel3: [] },
          planSource: { kind: 'procedure-hint', procedureId: 'p_2', demotion: 'body-empty' },
        }),
      ],
    }))

    const [replay, hint] = usedOf(view).steps
    expect(replay.planSource).toBe('procedure-replay')
    expect(replay.facts).toContain(REPLAY_FACT)
    expect(hint.planSource).toBe('procedure-hint')
    expect(hint.facts).toContain(HINT_FACT)
    expect(usedOf(view).summary).toBe('2 steps briefed · 1 procedure replay, 1 hint')
  })

  it('marks a step that served nothing rather than dropping the row (D-04)', () => {
    const view = projectKnowledgeView(ready({ steps: [step()] }))

    const row = usedOf(view).steps[0]
    expect(row.noBrief).toBe(true)
    expect(row.facts).toEqual([])
    expect(row.briefLines).toBe(0)
    expect(usedOf(view).summary).toBe(NO_BRIEF_LINES_TEXT)
  })
})

describe('the recorded rung rides the view when the evidence recorded one (D-13)', () => {
  it('carries the rung and its cause through untouched', () => {
    const view = projectKnowledgeView(ready({
      steps: [step()],
      retrievalRung: { schemaVersion: 1, rung: 'static-floor', reason: 'native-runtime-unavailable' },
    }))

    if (view.state !== 'ready') throw new Error('unreachable')
    expect(view.rung).toEqual({ rung: 'static-floor', reason: 'native-runtime-unavailable' })
  })

  it('leaves the rung ABSENT — not null — when the run recorded none', () => {
    const view = projectKnowledgeView(ready({ steps: [step()] }))

    if (view.state !== 'ready') throw new Error('unreachable')
    expect(view.rung).toBeUndefined()
    expect('rung' in view).toBe(false)
  })
})

describe('absence is an absent key, everywhere (the layer idiom)', () => {
  it('never puts a null anywhere in any arm of the view', () => {
    const views = [
      projectKnowledgeView({ kind: 'unavailable', error: 'boom' }),
      projectKnowledgeView({ kind: 'read', projection: { kind: 'evidence-incomplete', runId: RUN_ID } }),
      projectKnowledgeView(ready({ knowledgeStore: 'unbound' })),
      projectKnowledgeView(ready({ steps: [] })),
      projectKnowledgeView(ready({
        steps: [step({ served: { channel1: [briefLine(true)], channel2: [], channel3: [] } })],
        retrievalRung: { schemaVersion: 1, rung: 'lexical-only', reason: 'floor-disabled' },
      })),
    ]

    for (const view of views) {
      expect(JSON.stringify(view)).not.toContain('null')
    }
  })
})

describe('the reserved copy the expansion plans consume is published NOW', () => {
  it('names the three channel eyebrows exactly as the contract spells them', () => {
    expect(CHANNEL_EYEBROWS).toEqual({
      1: 'CHANNEL 1 · BRIEF',
      2: 'CHANNEL 2 · READ TRACES',
      3: 'CHANNEL 3 · CAUTIONS',
    })
    expect(WHY_TRIGGER_TEXT).toBe('Why this line?')
  })

  it('renders a trace line with its score to three decimal places', () => {
    expect(traceLineText('dense', 2, 0.5)).toBe('leg dense · rank 2 · score 0.500')
  })

  it('labels the cut-candidates ledger from the PRODUCER cap, never a typed 20', () => {
    expect(cutCandidatesLabel(3)).toBe(`Cut candidates (3 of top ${String(TRACE_TRUNCATION_TOP_K)})`)
    expect(TRACE_TRUNCATION_TOP_K).toBe(20)
  })

  it('gives every no-trace arm and every half heading its own sentence (D-04)', () => {
    expect(PRE_TRACE_TEXT).toBe('no trace was captured for this run')
    expect(STEP_NOT_FOUND_TEXT).toBe('no evidence recorded for this step')
    expect(STEP_NO_BRIEF_TEXT).toBe('no brief served')
    expect(USED_HEADING).toBe('Used')
    expect(LEARNED_HEADING).toBe('Learned')
    expect(new Set([PRE_TRACE_TEXT, STEP_NOT_FOUND_TEXT, STEP_NO_BRIEF_TEXT]).size).toBe(3)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 407-06 — the Used half in full: the per-line why-trace, the cut ledger, the
// canary outcome word, the replay/hint sentence and the channel page.
// ─────────────────────────────────────────────────────────────────────────────

/** One answered trace, carrying whatever served/cut ledgers a cell hands it. */
function answered(
  servedLines: readonly TraceLine[] = [],
  truncated: readonly TraceLine[] = [],
): RunKnowledgeStep['trace'] {
  return {
    kind: 'answered',
    trace: { schemaVersion: 1, servedLines: [...servedLines], truncated: [...truncated] },
  }
}

function traceLine(recordId: string, over: Partial<TraceLine> = {}): TraceLine {
  return { recordId, leg: 'anchor', rank: 1, score: 1.48695, ...over }
}

function attribution(
  over: Partial<RunKnowledgeCanaryAttribution> = {},
): RunKnowledgeCanaryAttribution {
  return {
    testIndex: 0,
    stepIndex: 0,
    recordId: 'rec_1',
    observationId: 'canary-outcome:abc',
    outcome: 'confirmed',
    ...over,
  }
}

/** The one detail of the one row of a ready view — most cells below want exactly this. */
function detailOf(view: ReturnType<typeof projectKnowledgeView>, index = 0) {
  return usedOf(view).steps[index].detail
}

describe('a served line carries the trace answer that explains IT, and nothing it computed (D-04)', () => {
  it('answers a served line from the trace ledger — leg, rank and score, matched by recordId', () => {
    const lines = briefLineViews(
      step({ served: { channel1: [briefLine(false, 'rec_a')], channel2: [], channel3: [] } }),
      answered([traceLine('rec_a', { leg: 'dense', rank: 4, score: 0.25 })]),
    )

    expect(lines).toHaveLength(1)
    expect(lines[0].why).toEqual({ kind: 'answered', leg: 'dense', rank: 4, score: 0.25 })
  })

  it('forwards the LEG WORD the trace recorded, never a re-worded one', () => {
    for (const leg of ['lexical', 'dense', 'anchor'] as const) {
      const lines = briefLineViews(
        step({ served: { channel1: [briefLine(false, 'rec_a')], channel2: [], channel3: [] } }),
        answered([traceLine('rec_a', { leg })]),
      )
      if (lines[0].why.kind !== 'answered') throw new Error('unreachable')
      expect(lines[0].why.leg).toBe(leg)
    }
  })

  it('maps a line the ANSWERED trace recorded nothing for to the step-not-found arm', () => {
    const lines = briefLineViews(
      step({ served: { channel1: [briefLine(false, 'rec_a')], channel2: [], channel3: [] } }),
      answered([traceLine('rec_other')]),
    )

    expect(lines[0].why).toEqual({ kind: 'no-trace', reason: 'step-not-found' })
  })

  it('gives EVERY line the step trace\'s own reason, verbatim, when the step has no trace', () => {
    for (const reason of ['pre-trace-run', 'artifact-missing', 'step-not-found'] as const) {
      const lines = briefLineViews(
        step({
          served: { channel1: [briefLine(false, 'rec_a'), briefLine(false, 'rec_b')], channel2: [], channel3: [] },
        }),
        { kind: 'no-trace', reason },
      )
      expect(lines.map(line => line.why)).toEqual([
        { kind: 'no-trace', reason },
        { kind: 'no-trace', reason },
      ])
    }
  })

  it('has exactly TWO kinds of why — answered, and a named absence', () => {
    const kinds = new Set([
      ...briefLineViews(
        step({ served: { channel1: [briefLine(false, 'rec_a')], channel2: [], channel3: [] } }),
        answered([traceLine('rec_a')]),
      ).map(line => line.why.kind),
      ...briefLineViews(
        step({ served: { channel1: [briefLine(false, 'rec_a')], channel2: [], channel3: [] } }),
        { kind: 'no-trace', reason: 'pre-trace-run' },
      ).map(line => line.why.kind),
    ])

    expect(kinds).toEqual(new Set(['answered', 'no-trace']))
  })

  it('keeps the served line\'s own fields beside the why — the panel paints one object', () => {
    const lines = briefLineViews(
      step({ served: { channel1: [briefLine(true, 'rec_a')], channel2: [], channel3: [] } }),
      answered([traceLine('rec_a')]),
    )

    expect(lines[0].id).toBe('rec_a')
    expect(lines[0].summary).toBe('the cart page lives at /view_cart')
    expect(lines[0].servedAsCanary).toBe(true)
  })
})

describe('the cut ledger is the answer to "why did it NOT say X" (D-04)', () => {
  it('labels the ledger from the producer cap and carries the cut lines through', () => {
    const cut = cutCandidates(answered([], [traceLine('rec_x'), traceLine('rec_y'), traceLine('rec_z')]))

    expect(cut).toEqual({
      label: cutCandidatesLabel(3),
      lines: [traceLine('rec_x'), traceLine('rec_y'), traceLine('rec_z')],
    })
    expect(cut?.label).toBe(`Cut candidates (3 of top ${String(TRACE_TRUNCATION_TOP_K)})`)
  })

  it('has NO ledger at all when the step has no trace — an empty one would claim nothing was cut', () => {
    expect(cutCandidates({ kind: 'no-trace', reason: 'artifact-missing' })).toBeUndefined()
  })

  it('keeps the ledger on an answered trace that truncated nothing — zero cut IS a recorded fact', () => {
    expect(cutCandidates(answered([traceLine('rec_a')]))).toEqual({
      label: cutCandidatesLabel(0),
      lines: [],
    })
  })
})

describe('a canary line is never blank — it says pending, not-attributed, or the outcome (D-08)', () => {
  it('says PENDING while curation has not settled, whatever the attributions hold', () => {
    expect(canaryOutcomeWord('pending', attribution())).toBe('pending')
    expect(canaryOutcomeWord('running', undefined)).toBe('pending')
  })

  it('says the attributed OUTCOME WORD once curation is done', () => {
    for (const outcome of ['confirmed', 'contradicted', 'helpful', 'harmful'] as const) {
      expect(canaryOutcomeWord('done', attribution({ outcome }))).toBe(outcome)
    }
  })

  it('says NOT-ATTRIBUTED when curation is done and nothing was attributed to this line', () => {
    expect(canaryOutcomeWord('done', undefined)).toBe('not-attributed')
  })

  it('says NOT-ATTRIBUTED when curation FAILED — a stale outcome is not this run\'s answer', () => {
    expect(canaryOutcomeWord('failed', attribution())).toBe('not-attributed')
    expect(canaryOutcomeWord('failed', undefined)).toBe('not-attributed')
  })
})

describe('a replay states its guard outcome and a hint states its demotion (D-07)', () => {
  it('reads replayed n/n when every check passed and nothing broke', () => {
    expect(planSourceSentence({
      kind: 'procedure-replay',
      procedureId: 'p_1',
      guard: { checksPassed: 5, total: 5 },
    })).toBe(replayedText(5, 5))
    expect(replayedText(5, 5)).toBe('replayed 5/5')
  })

  it('names the broken step ONE-BASED, with the cause word the contract spells', () => {
    expect(planSourceSentence({
      kind: 'procedure-replay',
      procedureId: 'p_1',
      guard: { checksPassed: 2, total: 5, miss: { procedureStepIndex: 2, reason: 'gate-refused' } },
    })).toBe('broke at step 3: miss')

    expect(planSourceSentence({
      kind: 'procedure-replay',
      procedureId: 'p_1',
      guard: { checksPassed: 1, total: 5, executionFailure: { procedureStepIndex: 1 } },
    })).toBe('broke at step 2: adapter failure')

    expect(planSourceSentence({
      kind: 'procedure-replay',
      procedureId: 'p_1',
      guard: { checksPassed: 3, total: 5, verifierRejection: { procedureStepIndex: 3 } },
    })).toBe('broke at step 4: verifier rejection')
  })

  it('breaks at the FIRST cause in precedence order — miss, then adapter, then verifier', () => {
    expect(planSourceSentence({
      kind: 'procedure-replay',
      procedureId: 'p_1',
      guard: {
        checksPassed: 0,
        total: 5,
        miss: { procedureStepIndex: 0, reason: 'descriptor-missing' },
        executionFailure: { procedureStepIndex: 1 },
        verifierRejection: { procedureStepIndex: 2 },
      },
    })).toBe(brokeAtText(1, 'miss'))
  })

  it('does NOT read replayed n/n when a guard member broke, even at full checksPassed', () => {
    expect(planSourceSentence({
      kind: 'procedure-replay',
      procedureId: 'p_1',
      guard: { checksPassed: 5, total: 5, verifierRejection: { procedureStepIndex: 4 } },
    })).toBe('broke at step 5: verifier rejection')
  })

  it('says procedure hint, and says so it was DEMOTED when the evidence recorded a demotion', () => {
    expect(planSourceSentence({ kind: 'procedure-hint', procedureId: 'p_2' })).toBe(PROCEDURE_HINT_TEXT)
    expect(planSourceSentence({ kind: 'procedure-hint', procedureId: 'p_2', demotion: 'body-empty' }))
      .toBe(PROCEDURE_HINT_DEMOTED_TEXT)
    expect(PROCEDURE_HINT_TEXT).toBe('procedure hint')
    expect(PROCEDURE_HINT_DEMOTED_TEXT).toBe('procedure hint (demoted from replay)')
  })

  it('tones the row ok, broke or hint — the three looks the UI-SPEC colours', () => {
    expect(planSourceView({
      kind: 'procedure-replay', procedureId: 'p', guard: { checksPassed: 2, total: 2 },
    })).toEqual({ kind: 'procedure-replay', sentence: 'replayed 2/2', tone: 'ok' })

    expect(planSourceView({
      kind: 'procedure-replay',
      procedureId: 'p',
      guard: { checksPassed: 0, total: 2, miss: { procedureStepIndex: 0, reason: 'gate-refused' } },
    })).toEqual({ kind: 'procedure-replay', sentence: 'broke at step 1: miss', tone: 'broke' })

    expect(planSourceView({ kind: 'procedure-hint', procedureId: 'p' }))
      .toEqual({ kind: 'procedure-hint', sentence: PROCEDURE_HINT_TEXT, tone: 'hint' })
  })

  it('names the three broke causes exactly as the Copywriting Contract spells them', () => {
    expect(BROKE_CAUSE_LABELS).toEqual({
      miss: 'miss',
      executionFailure: 'adapter failure',
      verifierRejection: 'verifier rejection',
    })
  })
})

describe('a long channel shows a page, and says how many it is holding back', () => {
  it('shows every line and holds nothing back at or below the page size', () => {
    const lines = Array.from({ length: CHANNEL_PAGE_SIZE }, (_, i) => `line ${String(i)}`)
    const page = channelPage(lines)

    expect(page.lines).toHaveLength(CHANNEL_PAGE_SIZE)
    expect(page.hiddenCount).toBeUndefined()
    expect(page.showAllLabel).toBeUndefined()
    expect(CHANNEL_PAGE_SIZE).toBe(50)
  })

  it('shows the first 50 and offers the WHOLE count in the trigger, not the hidden one', () => {
    const lines = Array.from({ length: 60 }, (_, i) => `line ${String(i)}`)
    const page = channelPage(lines)

    expect(page.lines).toHaveLength(50)
    expect(page.lines[49]).toBe('line 49')
    expect(page.hiddenCount).toBe(10)
    expect(page.showAllLabel).toBe(showAllLinesLabel(60))
    expect(showAllLinesLabel(60)).toBe('Show all 60 lines')
  })
})

describe('the projection joins the trace, the ledger, the outcome and the plan source per step', () => {
  it('builds one detail per step, with the three channels the op recorded', () => {
    const view = projectKnowledgeView(ready({
      steps: [step({
        served: {
          channel1: [briefLine(false, 'rec_a')],
          channel2: [{ id: 'rec_b', detailLevel: 'full', bodyDigest: 'sha256:b' }],
          channel3: [{ id: 'rec_c', summary: 'this page is slow' }],
        },
        trace: answered([traceLine('rec_a', { leg: 'lexical', rank: 2, score: 0.5 })]),
      })],
    }))

    const detail = detailOf(view)
    expect(detail.channel1.map(l => l.id)).toEqual(['rec_a'])
    expect(detail.channel1[0].why).toEqual({ kind: 'answered', leg: 'lexical', rank: 2, score: 0.5 })
    expect(detail.channel2).toEqual([{ id: 'rec_b', detailLevel: 'full' }])
    expect(detail.channel3).toEqual([{ id: 'rec_c', summary: 'this page is slow' }])
  })

  it('joins the canary outcome on testIndex, stepIndex AND recordId — all three, or none', () => {
    const view = projectKnowledgeView(ready({
      steps: [
        step({
          testIndex: 0,
          stepIndex: 0,
          served: { channel1: [briefLine(true, 'rec_a')], channel2: [], channel3: [] },
        }),
        step({
          testIndex: 1,
          stepIndex: 0,
          served: { channel1: [briefLine(true, 'rec_a')], channel2: [], channel3: [] },
        }),
      ],
      curation: { status: 'done' },
      learned: {
        changes: [],
        canaryAttributions: [attribution({ testIndex: 0, stepIndex: 0, recordId: 'rec_a', outcome: 'helpful' })],
      },
    }))

    expect(detailOf(view, 0).channel1[0].canaryOutcome).toBe('helpful')
    // The SAME record id on a NEIGHBOURING member test is a different served line.
    expect(detailOf(view, 1).channel1[0].canaryOutcome).toBe('not-attributed')
  })

  it('leaves a non-canary line with NO outcome key at all — never a word it did not earn', () => {
    const view = projectKnowledgeView(ready({
      steps: [step({ served: { channel1: [briefLine(false, 'rec_a')], channel2: [], channel3: [] } })],
      curation: { status: 'done' },
    }))

    const line = detailOf(view).channel1[0]
    expect(line.canaryOutcome).toBeUndefined()
    expect('canaryOutcome' in line).toBe(false)
  })

  it('reads the curation word from the projection, so an unsettled chain says pending', () => {
    const view = projectKnowledgeView(ready({
      steps: [step({ served: { channel1: [briefLine(true, 'rec_a')], channel2: [], channel3: [] } })],
      curation: { status: 'running' },
      learned: { changes: [], canaryAttributions: [attribution({ recordId: 'rec_a' })] },
    }))

    expect(detailOf(view).channel1[0].canaryOutcome).toBe('pending')
  })

  it('carries the plan-source row and the cut ledger onto the detail', () => {
    const view = projectKnowledgeView(ready({
      steps: [step({
        served: { channel1: [briefLine(false, 'rec_a')], channel2: [], channel3: [] },
        trace: answered([traceLine('rec_a')], [traceLine('rec_cut')]),
        planSource: { kind: 'procedure-replay', procedureId: 'p_1', guard: { checksPassed: 5, total: 5 } },
      })],
    }))

    const detail = detailOf(view)
    expect(detail.cut?.label).toBe(cutCandidatesLabel(1))
    expect(detail.planSource).toEqual({ kind: 'procedure-replay', sentence: 'replayed 5/5', tone: 'ok' })
  })

  it('leaves the cut ledger and the plan source ABSENT — not null — when the step recorded neither', () => {
    const view = projectKnowledgeView(ready({ steps: [step()] }))

    const detail = detailOf(view)
    expect('cut' in detail).toBe(false)
    expect('planSource' in detail).toBe(false)
    expect(JSON.stringify(detail)).not.toContain('null')
  })

  it('gives a step that served nothing an EMPTY detail rather than no detail', () => {
    const view = projectKnowledgeView(ready({ steps: [step()] }))

    expect(detailOf(view)).toEqual({ channel1: [], channel2: [], channel3: [] })
  })
})

describe('the 407-06 copy is published as constants, like every sentence before it', () => {
  it('spells the canary marker and both unsettled words exactly once', () => {
    expect(CANARY_BADGE_TEXT).toBe('canary')
    expect(ATTRIBUTION_PENDING_TEXT).toBe('attribution pending')
    expect(NOT_ATTRIBUTED_TEXT).toBe('not attributed')
    expect(new Set([CANARY_BADGE_TEXT, ATTRIBUTION_PENDING_TEXT, NOT_ATTRIBUTED_TEXT]).size).toBe(3)
  })

  it('rounds a trace score to three places, so two adjacent candidates stop looking identical', () => {
    expect(traceLineText('anchor', 1, 1.48695)).toBe('leg anchor · rank 1 · score 1.487')
  })
})
