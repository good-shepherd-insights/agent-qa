// 422-17-T2: the third chain stage is CHIP-LESS, and that is a declared decision (D-13).
//
// WHY A DECLARATION AND NOT A FALL-THROUGH. `propose-improvements` is a member of this run's
// chain — the tail lists its id in `chainJobIds`, the emitter's drop-guard therefore ADMITS its
// outcome, and only the chip table then finds nothing to draw. Before this file, that "nothing"
// was produced by the same `undefined` lookup that answers for `chat` and `consolidate`: kinds
// that are not chain stages at all. Two different facts, one silence, and no cell could tell
// them apart — which is the exact defect class this package has named twice already (the
// `STAGE_DRAINER` record in `post-run-tail.ts` exists because a handed-off leg once inherited a
// promise from a fall-through).
//
// So the chip decision is TOTAL over the shipped job-kind vocabulary and it is observable. The
// emissions are unchanged — a chip is a claim, and a stage with no chip vocabulary may not make
// one — but the day a sixth kind is declared, it has to choose here rather than inherit.
//
// The progress the proposal stage DOES carry is durable: its `proposals-authored` checkpoint and
// the one chain-terminal line, both pinned in `adversarial-disclosure.test.ts`.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import {
  POST_PROCESSING_CHIP_STATUSES,
  type JobKind,
  type PostProcessingStatus,
} from '@vostride/agent-qa-schema'

import {
  createPostRunChipEmitter,
  postRunChipDecision,
  type ObservedJobOutcome,
} from '../post-run-chip-emitter.js'
import { completedRunEventsPath, completedRunDir } from '../curation-tail.js'
import { renderPostProcessingSummaryLine } from '../post-run-tail.js'

/** The shipped vocabulary, restated HERE so a kind added to the union reds this file by name. */
const SHIPPED_JOB_KINDS: readonly JobKind[] = [
  'chat',
  'analyze-run',
  'curate-memory',
  'consolidate',
  'propose-improvements',
]

const created: string[] = []
afterAll(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true })
})

const RUN_ID = 'chip-fixture-run'
const CHAIN = {
  analyzeRun: 'job-analyze',
  curateMemory: 'job-curate',
  proposeImprovements: 'job-propose',
} as const

function fixture() {
  const agentQaRoot = mkdtempSync(join(tmpdir(), 'post-run-chip-'))
  created.push(agentQaRoot)
  mkdirSync(completedRunDir(agentQaRoot, RUN_ID), { recursive: true })
  // The run's own log as `runFinished` left it: the emitter continues this seq.
  writeFileSync(
    completedRunEventsPath(agentQaRoot, RUN_ID),
    `${JSON.stringify({ seq: 9, ts: 1, runId: RUN_ID, type: 'runFinished', payload: {} })}\n`,
  )
  const emitter = createPostRunChipEmitter({
    agentQaRoot,
    runId: RUN_ID,
    chainJobIds: Object.values(CHAIN),
    now: () => 1,
  })
  const trail = (): Array<{ seq: number; type: string }> =>
    readFileSync(completedRunEventsPath(agentQaRoot, RUN_ID), 'utf8')
      .split('\n')
      .filter(line => line.length > 0)
      .map(line => JSON.parse(line) as { seq: number; type: string })
  return { agentQaRoot, emitter, trail }
}

function outcome(
  id: string,
  kind: JobKind,
  disposition: ObservedJobOutcome['disposition'],
): ObservedJobOutcome {
  return { ran: true, job: { id, kind }, disposition }
}

describe('the chip decision is total over the shipped job kinds (D-13)', () => {
  it('declares propose-improvements chip-less rather than letting it fall through', () => {
    expect(postRunChipDecision('propose-improvements')).toEqual({ kind: 'declared-chip-less' })
    // The two chain stages that DO speak through chips still do, unchanged.
    expect(postRunChipDecision('analyze-run')).toEqual({
      kind: 'chips',
      chips: { started: 'analysisStarted', completed: 'analysisCompleted', failed: 'analysisFailed' },
    })
    expect(postRunChipDecision('curate-memory')).toEqual({
      kind: 'chips',
      chips: { started: 'curationStarted', completed: 'curationCompleted', failed: 'curationFailed' },
    })
  })

  it('answers every shipped kind, so a sixth must choose here rather than inherit', () => {
    for (const kind of SHIPPED_JOB_KINDS) {
      expect(postRunChipDecision(kind).kind).not.toBe('unknown-kind')
    }
  })

  it('keeps a kind this build does not know DISTINCT from one it declares chip-less', () => {
    expect(postRunChipDecision('a-kind-from-a-later-build')).toEqual({ kind: 'unknown-kind' })
    expect(postRunChipDecision('propose-improvements')).not.toEqual({ kind: 'unknown-kind' })
  })
})

describe('the proposal stage moves no chip and disturbs no trail', () => {
  it('appends nothing for a proposal job that IS in this run own chain', () => {
    const f = fixture()
    f.emitter.observe(outcome(CHAIN.proposeImprovements, 'propose-improvements', 'completed'))
    f.emitter.observe(outcome(CHAIN.proposeImprovements, 'propose-improvements', 'failed'))
    expect(f.emitter.emitted()).toBe(0)
    expect(f.trail().map(row => row.type)).toEqual(['runFinished'])
  })

  it('lets curation COMPLETE before the proposal stage ends, and never re-fails it after', () => {
    const f = fixture()
    f.emitter.observe(outcome(CHAIN.curateMemory, 'curate-memory', 'completed'))
    // The third stage runs afterwards and fails permanently. The curation chip is settled and
    // must stay settled: the fold committed its bundle, and a `curationFailed` appended here
    // would contradict the durable row that says `done`.
    f.emitter.observe(outcome(CHAIN.proposeImprovements, 'propose-improvements', 'failed'))
    expect(f.trail().map(row => row.type)).toEqual([
      'runFinished',
      'curationStarted',
      'curationCompleted',
    ])
    // The seq continues from the run's own log and is not advanced by the chip-less stage.
    expect(f.trail().map(row => row.seq)).toEqual([9, 10, 11])
  })

  it('keeps the CLI summary line reporting curation done while the third stage is still out', () => {
    // The pull half of the same claim, in the CLI's own vocabulary: the chip set is closed at
    // two (`analysis`, `curation`) and the third stage has no word in it, so a proposal stage
    // that is still running — or has failed — cannot red a chip for work that durably succeeded.
    const status: PostProcessingStatus = {
      runId: RUN_ID,
      chips: { analysis: 'done', curation: 'done' },
    }
    const line = renderPostProcessingSummaryLine(status, 'none')
    expect(line).toContain('analysis: done')
    expect(line).toContain('curation: done')
    expect(line).not.toContain('proposal')
    // The vocabulary itself is closed and unwidened: four words, and no fifth for a third stage.
    expect([...POST_PROCESSING_CHIP_STATUSES]).toEqual(['pending', 'running', 'done', 'failed'])
    expect(Object.keys(status.chips)).toEqual(['analysis', 'curation'])
  })
})
