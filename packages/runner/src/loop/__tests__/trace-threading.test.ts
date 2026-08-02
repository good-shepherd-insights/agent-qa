/**
 * D-16's LAST HOP: no consumer may drop the trace between the reader port and evidence
 * (Phase 387-04, KREV-02).
 *
 * The structural half of this is a signature — `recordServedBrief` and `recordServedCautions` take
 * the trace as a REQUIRED parameter, so a loop that obtained a composite and discarded its trace
 * cannot compile. That half is enforced by `tsc` and exercised by every runner suite.
 *
 * This file covers what a type cannot see: that the loop actually threads the trace it received
 * rather than manufacturing a fresh empty one at the recorder call. A `trace: emptyTrace()` at the
 * call site would type-check perfectly and would make D-16 vacuous at the exact hop it is meant to
 * protect — so it is scanned for, with a planted violation confirming the scan can reject.
 *
 * `grep` is deliberately unused: it has silently returned nothing for patterns demonstrably
 * present in this tree, and a gate that can fail open is worse than no gate.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { computeBriefDigest, type BriefBlock, type TraceLine } from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'

import type { KnowledgeHintReader, ServedCautions } from '../../knowledge-hint-reader.js'
import { executeStep } from '../index.js'
import type { LoopPorts } from '../ports.js'
import { makeActionPlan, makeAdapter, makePlanner, makeStepContext } from './loop-harness.js'
import { noCautions, servedBrief, servedCautions } from './fixtures/served-trace.js'

const loopDir = join(dirname(fileURLToPath(import.meta.url)), '..')

function statementsOf(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n')
}

function occurrences(source: string, needle: string): number {
  return source.split(needle).length - 1
}

describe('the loop threads the serve-time trace to the evidence seam (387-04)', () => {
  const source = statementsOf(readFileSync(join(loopDir, 'index.ts'), 'utf8'))

  it('hands the recorder the trace it was served, never a fabricated one', () => {
    // The composite is destructured once and its own `trace` is what reaches the recorder.
    expect(occurrences(source, 'trace: served.trace')).toBe(1)
    expect(occurrences(source, 'recorder.recordServedCautions(injected, cautionsForTurn.trace)'))
      .toBe(1)

    // No empty/synthetic trace is constructed anywhere in the loop.
    for (const forbidden of [
      'servedLines: []',
      'truncated: []',
      'schemaVersion: 1',
    ]) {
      expect(occurrences(source, forbidden)).toBe(0)
    }

    // POSITIVE CONTROL: the fabricated-trace shape this scan exists to reject is rejected.
    const planted = `${source}\n  recorder.recordServedBrief({ block, trace: { schemaVersion: 1, servedLines: [], truncated: [] } })\n`
    expect(occurrences(planted, 'servedLines: []')).toBe(1)
    expect(occurrences(planted, 'schemaVersion: 1')).toBe(1)

    // INVERSE CONTROL: the same shape in PROSE must not be flagged, which is the failure mode a
    // naive substring scan hits in this file — it explains the contract it implements.
    expect(occurrences(
      statementsOf('// never write servedLines: [] here\n/* nor schemaVersion: 1 */\nconst x = 1\n'),
      'servedLines: []',
    )).toBe(0)
  })

  it('reads both composite entries exactly once each', () => {
    // Two serving entries cross this seam; a third call would be a serve nobody attributed.
    expect(occurrences(source, '.getRunBrief(')).toBe(1)
    expect(occurrences(source, '.getCautions(')).toBe(1)
    expect(occurrences(`${source}\nports.knowledgeReader?.getRunBrief(s, b)\n`, '.getRunBrief(')).toBe(2)
  })
})

/**
 * WR-10 (Phase 387-13): the scan above proves the loop hands over the trace it was SERVED. It
 * cannot see whether the loop hands it over AT ALL on a turn that injected nothing — that is a
 * control-flow fact, and the source text of a call site says nothing about the gate enclosing it.
 *
 * This section runs the loop. Shape A is the zero-injection case whose drop gate lives HERE, in
 * `index.ts`: the reader ranked candidates and budget-cut every one of them, so `block.cautions`
 * is empty, the caution turn's enclosing condition is false, and the recorder is never reached.
 * That is precisely the step "why didn't it mention X" is asked about.
 */
const EMPTY_BRIEF: BriefBlock = {
  tiers: { L0: '', L1: '', L2: '' },
  lines: [],
  truncation: '',
  admissions: [],
}

const BUDGETS = { brief: 64, searchResults: 64, caution: 24, readBody: 64, recordCap: 8 }

function cut(recordId: string, rank: number, score: number): TraceLine {
  return { recordId, leg: 'anchor', rank, score }
}

function readerServing(cautions: ServedCautions): KnowledgeHintReader {
  return {
    // The Channel-1 trace is deliberately empty, so any cut candidate reaching evidence can only
    // have come through Channel 3. A brief-borne cut would make the assertion below pass for a
    // reason that has nothing to do with the caution turn.
    getRunBrief: () => servedBrief(EMPTY_BRIEF),
    search: () => [],
    read: () => { throw new Error('not used') },
    getCautions: () => cautions,
    getProcedure: () => undefined,
    emitCanaryOutcome: () => {},
  }
}

function ports(cautions: ServedCautions): LoopPorts {
  return {
    adapter: makeAdapter({
      executeResults: [
        { success: false, error: 'Browser process disconnected' },
        { success: true },
      ],
    }),
    planner: makePlanner([
      makeActionPlan({ action: { type: 'click', ref: 'e2' } }),
      makeActionPlan({ action: { type: 'click', ref: 'e1' } }),
    ]),
    knowledgeReader: readerServing(cautions),
    knowledgeBudgets: BUDGETS,
  }
}

/** One action failure followed by a success — the shape that triggers exactly one caution turn. */
async function replanAfterFailure(cautions: ServedCautions): ReturnType<typeof executeStep> {
  return executeStep('Click Log in', ports(cautions), makeStepContext({ testName: 'Checkout Flow' }))
}

describe('a turn that injected ZERO cautions still lands the reader cut ledger (WR-10, 387-13)', () => {
  it('Shape A: the reader ranked candidates and cut them all', async () => {
    // RED BASELINE, observed against unmodified production code before the fix:
    //   AssertionError: expected [] to deeply equal [ 'caution-cut-a', 'caution-cut-b' ]
    // `retrievalTrace` was PRESENT but its `truncated` ledger was EMPTY — the Channel-1 record
    // makes the trace object exist, so an assertion that merely checked for its presence would
    // have passed over the defect. The drop is at the caution turn's own gate in `index.ts`:
    // with `block.cautions` empty the branch is skipped entirely and `recordServedCautions` is
    // never called, so the recorder body never sees this trace at all.
    const served = await replanAfterFailure(servedCautions(
      { cautions: [], budgetUsed: 0, admissions: [] },
      {
        schemaVersion: 1,
        servedLines: [],
        truncated: [cut('caution-cut-a', 4, 0.31), cut('caution-cut-b', 5, 0.22)],
      },
    ))

    const persisted = served.evidence?.retrievalTrace
    expect(persisted?.truncated.map(({ recordId }) => recordId))
      .toEqual(['caution-cut-a', 'caution-cut-b'])
    // Honesty (D-2 / 387-04 probe r4, extended to the all-cut case): nothing was rendered into
    // the turn, so nothing may be claimed as served testimony.
    expect(persisted?.servedLines).toEqual([])
  })

  it('Shape A leaves the ServedBrief bytes exactly where the no-caution baseline left them', async () => {
    // D-13: the repair may not dent byte-stability. The comparison is against a real replan that
    // served no caution trace at all, not against a hand-built empty brief — the two runs differ
    // ONLY in what the reader's caution trace carried.
    const laden = await replanAfterFailure(servedCautions(
      { cautions: [], budgetUsed: 0, admissions: [] },
      { schemaVersion: 1, servedLines: [], truncated: [cut('caution-cut-a', 4, 0.31)] },
    ))
    const baseline = await replanAfterFailure(noCautions())

    expect(laden.evidence?.servedBrief.channel3).toHaveLength(0)
    expect(JSON.stringify(laden.evidence?.servedBrief))
      .toBe(JSON.stringify(baseline.evidence?.servedBrief))
    expect(laden.evidence?.servedBrief.briefDigest)
      .toBe(computeBriefDigest({ ...laden.evidence!.servedBrief, briefDigest: '' }))
    // The guard is not vacuously true over two empty things: the laden run really did carry a cut.
    expect(laden.evidence?.retrievalTrace?.truncated).toHaveLength(1)
  })
})
