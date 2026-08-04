// The D-12 sentence surface on the post-run tail (Phase 389, plan 07 — ANLZ-03/ANLZ-04).
//
// Two legs, decided from THIS process's knowledge of the drain — never from chip status:
//
//   1. The in-process drain completed `analyze-run` under the one budget → the tail prints
//      the clustered sentence block after the exit line. The sentence BYTES come from the
//      `analysis.get` op result verbatim (SC3's one-renderer law) — the byte-equality legs
//      below compose the expected sentence through the REAL agent-barrel renderer and assert
//      the printed bytes are identical, so a local re-composition is a RED here.
//   2. Anything else — handed off, `--detach`, budget spent — → NO block, NO wait; the exit
//      summary line is extended with the exact fetch command (`agent-qa fn analysis.get
//      --input '{"runId": …}'`, the real `fn` syntax) so the sentence is one copy-paste away.
//
// The never-wait prohibition (388 D-03 / 386 D-15) and the C13 print-not-publish posture are
// pinned as source and behavioral assertions at the bottom.

import { describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

import { chainJobIdsForRun, renderVerdictSentence } from '@vostride/agent-qa-agent'
import { DIGEST_JOB_ID_SOURCE } from '@vostride/agent-qa-agent-local'
import type { AuditSink } from '@vostride/agent-qa-safety'
import type {
  AnalysisGetOutput,
  GuardrailPolicy,
  MaskingContext,
  PostProcessingStatus,
  RunNotification,
  Verdict,
  VerdictSentenceParts,
} from '@vostride/agent-qa-schema'

import {
  analysisFetchCommand,
  renderAnalysisClusterBlock,
  runPostRunTail,
  type PostRunTailOperations,
  type RunPostRunTailOptions,
} from '../post-run-tail.js'

const agentQaRoot = '/workspace/project/.agent-qa'
const configDir = '/workspace/project'
const configPath = '/workspace/project/agent-qa.config.yaml'
const knowledgeRoot = '/workspace/project/agent-qa-knowledge'
const runId = 'run-post-run-tail-sentences'
const OWN_CHAIN = chainJobIdsForRun(runId, DIGEST_JOB_ID_SOURCE)

/** The exact fetch command the extended exit line must carry — the real `fn` invocation. */
const FETCH_COMMAND = `agent-qa fn analysis.get --input '{"runId":"${runId}"}'`

const handoff = {
  runId,
  schemaVersion: 5,
  executionContext: 'local-headless',
} as unknown as ReturnType<PostRunTailOperations['loadCompletedRunHandoff']>

// ------------------------------------------------------------------------------------------
// The op-rendered fixture: sentences composed through the REAL barrel renderer, so the
// byte-equality assertion compares the tail's print against the one renderer's own output.
// ------------------------------------------------------------------------------------------

function appBugVerdict(perTest: number): Verdict {
  return {
    class: 'app_bug',
    producer: 'analyze-run',
    confidence: 0.9,
    evidence: {
      citedSteps: [0],
      citedAnchors: [],
      citedArtifacts: [],
      rationale: 'the submit control is gone from the checkout DOM',
    },
    memoryMisdirectionRuledOut: true,
    perTest,
  } as Verdict
}

function partsFor(perTest: number, discriminator: string): VerdictSentenceParts {
  return {
    perTest,
    groundingQuote: { stepIndex: 2, quote: 'Error: element "Submit" not found' },
    discriminator,
    nextAction: 'file the failure against the application with the quoted evidence',
    links: [],
  }
}

const QUERY = { product: 'synthetic', filePath: 'tests/checkout.yaml', testName: 'checks out' }

/** The representative sentence of the two-member cluster — REAL renderer output. */
const CLUSTER_SENTENCE = renderVerdictSentence(
  appBugVerdict(0),
  partsFor(0, 'the same step passed on the previous build'),
  undefined,
  QUERY,
)
/** The singleton cluster's one sentence — also REAL renderer output. */
const SINGLETON_SENTENCE = renderVerdictSentence(
  appBugVerdict(2),
  partsFor(2, 'only this member exercised the legacy checkout'),
  undefined,
  QUERY,
)

function analysisOutput(): AnalysisGetOutput {
  return {
    runId,
    verdicts: [
      { perTest: 0, testId: 'TST-101', class: 'app_bug', producer: 'analyze-run', confidence: 0.9 },
      { perTest: 1, testId: 'TST-102', class: 'app_bug', producer: 'analyze-run', confidence: 0.8 },
      { perTest: 2, testId: 'TST-201', class: 'app_bug', producer: 'analyze-run', confidence: 0.7 },
    ],
    sentences: [
      { perTest: 0, testId: 'TST-101', sentence: CLUSTER_SENTENCE },
      { perTest: 1, testId: 'TST-102', sentence: CLUSTER_SENTENCE },
      { perTest: 2, testId: 'TST-201', sentence: SINGLETON_SENTENCE },
    ],
    clusters: [
      {
        fingerprint: 'fp-shared-anchor',
        count: 2,
        members: [
          { testIndex: 0, testId: 'TST-101' },
          { testIndex: 1, testId: 'TST-102' },
        ],
        representative: { testIndex: 0, sentence: CLUSTER_SENTENCE },
      },
      {
        fingerprint: 'fp-lonely',
        count: 1,
        members: [{ testIndex: 2, testId: 'TST-201' }],
        representative: { testIndex: 2, sentence: SINGLETON_SENTENCE },
      },
    ],
  }
}

function pendingStatus(): PostProcessingStatus {
  return {
    runId,
    chips: { analysis: 'pending', curation: 'pending', issues: 'reserved' },
  }
}

function doneStatus(): PostProcessingStatus {
  return {
    runId,
    chips: { analysis: 'done', curation: 'pending', issues: 'reserved' },
  }
}

function terminalNotification(): RunNotification {
  return {
    schemaVersion: 1,
    runId,
    outcome: 'done',
    verdictSummary: { total: 3, byClass: { app_bug: 3 } },
    stages: {
      analysis: { status: 'done' },
      curation: { status: 'done', curated: 2, deprecated: 0 },
      issues: { status: 'reserved' },
    },
  } as unknown as RunNotification
}

// ------------------------------------------------------------------------------------------
// Harness: every operation injected, `info` captured — what is under test is which LINES the
// tail prints, from which posture, sourced from which op result.
// ------------------------------------------------------------------------------------------

interface Harness {
  operations: PostRunTailOperations
  runNextJob: ReturnType<typeof vi.fn>
  readRunAnalysis: ReturnType<typeof vi.fn>
  chipObserve: ReturnType<typeof vi.fn>
  info: Mock<(message: string) => void>
  warn: Mock<(message: string) => void>
  clock: { value: number }
}

function harness(overrides: {
  lease?: ReturnType<PostRunTailOperations['acquireWriterLease']>
  runNextJob?: ReturnType<typeof vi.fn>
  status?: PostProcessingStatus
  analysis?: AnalysisGetOutput
  readRunAnalysis?: ReturnType<typeof vi.fn>
} = {}): Harness {
  const clock = { value: 1_000 }
  const info = vi.fn<(message: string) => void>()
  const warn = vi.fn<(message: string) => void>()
  const runNextJob = overrides.runNextJob
    ?? vi.fn(async () => ({ ran: false, reason: 'no-job' }))
  const readRunAnalysis = overrides.readRunAnalysis
    ?? vi.fn(async () => overrides.analysis ?? analysisOutput())
  const chipObserve = vi.fn()

  const operations = {
    loadCompletedRunHandoff: vi.fn(() => handoff),
    resolveKnowledgeRoot: vi.fn(() => knowledgeRoot),
    composeHost: vi.fn(() => ({
      jobs: async () => ({
        queue: {
          enqueue: vi.fn(async () => ({ job: { id: 'job_analyze' }, deduped: false })),
          runNextJob,
          recoverAbandonedClaims: vi.fn(async () => ({ recovered: 0 })),
        },
        store: { adoptEpoch: vi.fn(async () => ({ epoch: 7 })) },
        idSource: DIGEST_JOB_ID_SOURCE,
      }),
      close: vi.fn(async () => undefined),
    })),
    acquireWriterLease: vi.fn(() => overrides.lease
      ?? { kind: 'acquired', leaseId: 'lease-1', epoch: 7 }),
    releaseLease: vi.fn(() => ({ kind: 'released' })),
    nudgeDaemon: vi.fn(async () => undefined),
    curateCompletedRun: vi.fn(async () => ({
      curated: 0,
      deprecated: 0,
      complete: true,
      drainKind: 'drained' as const,
    })),
    runCurationTail: vi.fn(async () => undefined),
    createChipEmitter: vi.fn(() => ({ observe: chipObserve })),
    readPostProcessingStatus: vi.fn(async () => overrides.status ?? pendingStatus()),
    readRunAnalysis,
    now: () => clock.value,
  } as unknown as PostRunTailOperations

  return { operations, runNextJob, readRunAnalysis, chipObserve, info, warn, clock }
}

function options(h: Harness): RunPostRunTailOptions {
  return {
    runId,
    agentQaRoot,
    configPath,
    knowledgeConfig: { dir: 'agent-qa-knowledge' },
    configDir,
    auditSink: {} as AuditSink,
    maskingContext: {} as MaskingContext,
    policy: {} as GuardrailPolicy,
    log: {
      warn: (message: string) => h.warn(message),
      info: (message: string) => h.info(message),
    },
    operations: h.operations,
  }
}

/** A pump script: the given outcomes in order, then an emptied queue. */
function pump(outcomes: readonly unknown[]): ReturnType<typeof vi.fn> {
  let call = 0
  return vi.fn(async () => outcomes[call++] ?? { ran: false, reason: 'no-job' })
}

const ANALYZE_COMPLETED = {
  ran: true,
  disposition: 'completed',
  job: { id: String(OWN_CHAIN.analyzeRun) },
}

describe('the clustered sentence block — in-process analyze-run completed (D-12/D-15)', () => {
  it('prints the block after the exit line, bytes identical to the op-rendered sentences', async () => {
    const h = harness({ runNextJob: pump([ANALYZE_COMPLETED]), status: doneStatus() })
    const tail = runPostRunTail(options(h))
    await tail.enqueue()
    await tail.drain()
    await tail.finish()

    const lines = h.info.mock.calls.map(([message]) => String(message))
    expect(lines).toHaveLength(2)
    // The exit line first — untouched vocabulary, and NO fetch command on this leg: the
    // sentences themselves are one line down.
    expect(lines[0]).toBe('post-processing — analysis: done · curation: pending · issues: reserved')
    expect(lines[0]).not.toContain('analysis.get')

    // The block: one representative sentence per cluster; the multi-member cluster carries
    // its occurrence count and member refs; the singleton reads as one sentence (D-15).
    const block = lines[1] as string
    expect(block).toBe(
      'analysis — 2 distinct problems:\n'
      + `×2: TST-101, TST-102\n${CLUSTER_SENTENCE}\n`
      + SINGLETON_SENTENCE,
    )
    // Byte-equality, stated on its own: the printed sentence IS the renderer's output for the
    // same (verdict, parts, recurrence answer) — composed above through the real barrel
    // renderer, never a local composer.
    expect(block).toContain(CLUSTER_SENTENCE)
    expect(block).toContain(SINGLETON_SENTENCE)
    expect(h.readRunAnalysis).toHaveBeenCalledTimes(1)
    expect(h.readRunAnalysis.mock.calls[0]![1]).toBe(runId)
  })

  it('prints the block after the terminal human line when the chain finished (D-09 + D-12)', async () => {
    const h = harness({
      runNextJob: pump([ANALYZE_COMPLETED]),
      status: { ...doneStatus(), notification: terminalNotification() },
    })
    const tail = runPostRunTail(options(h))
    await tail.enqueue()
    await tail.drain()
    await tail.finish()

    const lines = h.info.mock.calls.map(([message]) => String(message))
    expect(lines).toHaveLength(2)
    // The D-09 line is rendered from the row and NOTHING else — no fetch command grafted on.
    expect(lines[0]).toContain(`post-processing done for ${runId}`)
    expect(lines[0]).not.toContain('analysis.get')
    expect(lines[1]).toContain(CLUSTER_SENTENCE)
  })

  it('still prints the block when the budget ran out AFTER analyze-run completed in-process',
    async () => {
      // D-12's own wording: the block prints whenever the drain completed analyze-run UNDER
      // the budget — the drain outcome is not the trigger, this process's knowledge of the
      // analyze-run completion is (the 700–716 house rule).
      const h = harness({
        runNextJob: vi.fn(async () => ANALYZE_COMPLETED),
        status: doneStatus(),
      })
      let reads = 0
      ;(h.operations as { now: () => number }).now = () => 1_000 + (reads++) * 30_000
      const tail = runPostRunTail(options(h))
      await tail.enqueue()
      await tail.drain()
      expect(tail.report().drain).toBe('budget-exhausted')
      await tail.finish()

      const lines = h.info.mock.calls.map(([message]) => String(message))
      expect(lines.some((line) => line.includes(CLUSTER_SENTENCE))).toBe(true)
      expect(lines.some((line) => line.includes('analysis.get'))).toBe(false)
    })

  it('prints no block line at all for a zero-failure run (empty clusters)', async () => {
    const h = harness({
      runNextJob: pump([ANALYZE_COMPLETED]),
      status: doneStatus(),
      analysis: { runId, verdicts: [], sentences: [], clusters: [] },
    })
    const tail = runPostRunTail(options(h))
    await tail.enqueue()
    await tail.drain()
    await tail.finish()

    const lines = h.info.mock.calls.map(([message]) => String(message))
    expect(lines).toHaveLength(1)
    expect(lines[0]).toBe('post-processing — analysis: done · curation: pending · issues: reserved')
  })

  it('a failed analysis read costs the BLOCK and nothing else — warned, never thrown', async () => {
    const h = harness({
      runNextJob: pump([ANALYZE_COMPLETED]),
      status: doneStatus(),
      readRunAnalysis: vi.fn(async () => {
        throw new Error('the analysis artifact is unreadable')
      }),
    })
    const tail = runPostRunTail(options(h))
    await tail.enqueue()
    await tail.drain()
    await expect(tail.finish()).resolves.toBeUndefined()

    const lines = h.info.mock.calls.map(([message]) => String(message))
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('post-processing —')
    expect(h.warn).toHaveBeenCalledTimes(1)
    const warning = String(h.warn.mock.calls[0]![0])
    expect(warning).toContain('the analysis artifact is unreadable')
    // The warning names the recovery path: the same fetch command the exit line carries.
    expect(warning).toContain(FETCH_COMMAND)
  })
})

describe('the extended exit line — everything else gets the fetch command (D-12, 388 D-08)', () => {
  it('extends the summary line under --detach: no block, no wait, one copy-paste', async () => {
    const h = harness()
    const tail = runPostRunTail(options(h))
    await tail.enqueue()
    await tail.finish({ detached: true })

    expect(tail.report().drain).toBe('detached')
    const lines = h.info.mock.calls.map(([message]) => String(message))
    expect(lines).toEqual([
      'post-processing — analysis: pending · curation: pending · issues: reserved'
      + ` · sentences: ${FETCH_COMMAND}`,
    ])
    expect(h.readRunAnalysis).not.toHaveBeenCalled()
  })

  it('extends the summary line on hand-off — the daemon may drain, the command still fetches',
    async () => {
      const h = harness({ lease: { kind: 'held', holder: { pid: 4242 } } as never })
      const tail = runPostRunTail(options(h))
      await tail.enqueue()
      await tail.drain()
      await tail.finish()

      expect(tail.report().drain).toBe('handed-off')
      const lines = h.info.mock.calls.map(([message]) => String(message))
      expect(lines).toHaveLength(1)
      const line = lines[0] as string
      // The literal op id and the run's id, per the acceptance criterion.
      expect(line).toContain('analysis.get')
      expect(line).toContain(runId)
      expect(line).toContain(`sentences: ${FETCH_COMMAND}`)
      expect(line).not.toContain(CLUSTER_SENTENCE)
      expect(h.readRunAnalysis).not.toHaveBeenCalled()
    })

  it('extends the summary line when the budget went out before analyze-run completed', async () => {
    // The differential twin of the budget-exhausted BLOCK case above: same clock, same
    // dispositions — the one input that differs is WHICH own-chain job the pump claimed.
    const h = harness({
      runNextJob: vi.fn(async () => ({
        ran: true,
        disposition: 'completed',
        job: { id: String(OWN_CHAIN.curateMemory) },
      })),
    })
    let reads = 0
    ;(h.operations as { now: () => number }).now = () => 1_000 + (reads++) * 30_000
    const tail = runPostRunTail(options(h))
    await tail.enqueue()
    await tail.drain()
    expect(tail.report().drain).toBe('budget-exhausted')
    await tail.finish()

    const lines = h.info.mock.calls.map(([message]) => String(message))
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain(`sentences: ${FETCH_COMMAND}`)
    expect(h.readRunAnalysis).not.toHaveBeenCalled()
  })

  it('an analyze-run that FAILED in-process is not a completed one — fetch command, no block',
    async () => {
      const h = harness({
        runNextJob: pump([{
          ran: true,
          disposition: 'failed',
          job: { id: String(OWN_CHAIN.analyzeRun) },
        }]),
      })
      const tail = runPostRunTail(options(h))
      await tail.enqueue()
      await tail.drain()
      await tail.finish()

      const lines = h.info.mock.calls.map(([message]) => String(message))
      expect(lines).toHaveLength(1)
      expect(lines[0]).toContain(`sentences: ${FETCH_COMMAND}`)
      expect(h.readRunAnalysis).not.toHaveBeenCalled()
    })
})

describe('prohibitions: never-wait and print-not-publish (388 D-03 / C13)', () => {
  it('the print path emits NO chip or bus event — chips observe pump outcomes only', async () => {
    const h = harness({ runNextJob: pump([ANALYZE_COMPLETED]), status: doneStatus() })
    const tail = runPostRunTail(options(h))
    await tail.enqueue()
    await tail.drain()
    const observedDuringPump = h.chipObserve.mock.calls.length
    expect(observedDuringPump).toBe(1)
    await tail.finish()

    // `finish` printed the block; the emitter saw nothing new, and no call ever carried a
    // sentence — the tail prints, it does not publish (C13; runFinished consumers untouched).
    expect(h.chipObserve.mock.calls.length).toBe(observedDuringPump)
    for (const call of h.chipObserve.mock.calls) {
      expect(JSON.stringify(call)).not.toContain('sentence')
    }
  })

  it('adds no timer, no poll and no second timing knob to the tail source', async () => {
    const { readFileSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    const source = readFileSync(
      fileURLToPath(new URL('../post-run-tail.ts', import.meta.url)),
      'utf8',
    )
    // Never-wait, stated as a measurement (the acceptance criterion's source assertion).
    expect(source).not.toMatch(/setTimeout|setInterval/u)
    // The one budget still stands imported — no second timing constant beside it.
    expect(source).toContain('DRAIN_BUDGET_MS')
    expect(source).not.toMatch(/60_000|60000/u)
  })
})

describe('the pure renderers (exported for exactly these pins)', () => {
  it('renderAnalysisClusterBlock: count+refs for multi-member clusters, bare sentence for singletons',
    () => {
      expect(renderAnalysisClusterBlock(analysisOutput())).toBe(
        'analysis — 2 distinct problems:\n'
        + `×2: TST-101, TST-102\n${CLUSTER_SENTENCE}\n`
        + SINGLETON_SENTENCE,
      )
      expect(renderAnalysisClusterBlock({ runId, verdicts: [], sentences: [], clusters: [] }))
        .toBe('')
    })

  it('renderAnalysisClusterBlock falls back to #testIndex only for a member with no testId', () => {
    const analysis = analysisOutput()
    const clusters = analysis.clusters.map((cluster, index) => (index === 0
      ? {
          ...cluster,
          members: [{ testIndex: 0, testId: '' }, { testIndex: 1, testId: 'TST-102' }],
        }
      : cluster))
    expect(renderAnalysisClusterBlock({ ...analysis, clusters }))
      .toContain('×2: #0, TST-102')
  })

  it('analysisFetchCommand is the real fn invocation, byte-for-byte', () => {
    expect(analysisFetchCommand(runId)).toBe(FETCH_COMMAND)
    // JSON-quoted, so a runId needing escaping cannot silently produce a broken command.
    expect(analysisFetchCommand('run"x')).toBe(
      'agent-qa fn analysis.get --input \'{"runId":"run\\"x"}\'',
    )
  })
})
