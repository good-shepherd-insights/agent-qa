// Whose chain did this tail just watch? (Phase 388 plan 07, ANLZ-05 / D-13.)
//
// The round-1 chip suite pinned a single run into a module-level `RUN_ID` and created exactly one
// run directory, so no assertion in the phase could observe the one discriminator the emitter had
// dropped: the identity of the job the pump claimed. The queue's claim predicate is a GLOBAL FIFO
// (`sqlite-job-store.ts` `selectClaimable` orders by `created_at, id` with no run predicate), so
// an in-process drain routinely runs other runs' work — and every outcome it observed was being
// stamped into THIS run's `events.jsonl`.
//
// Two runs, one store, one `agent-jobs.db`, and both halves of the contract named in their own
// test titles: the push half emits only for the run this tail is draining, and the pull half still
// sees the foreign run's rows advance under this pump. An assertion that something did NOT happen
// is load-bearing only if the input could have made it happen — so run A's jobs are genuinely
// claimed and genuinely run here (`jobsRun === 4`), and it is the drop-guard, not an empty queue,
// that keeps them out of run B's log.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ClockPort, ConfigReaderPort, JobModelCapability } from '@vostride/agent-qa-agent'
import { invokeFunction, RUNS_POST_PROCESSING_FUNCTION_ID } from '@vostride/agent-qa-agent'
import {
  composeLocalAgent,
  DIGEST_JOB_ID_SOURCE,
  type LocalAgentHost,
} from '@vostride/agent-qa-agent-local'
import { HANDOFF_FILE, RUNS_SUBDIR, slugBranch } from '@vostride/agent-qa-runner-local'
import type { AuditSink } from '@vostride/agent-qa-safety'
import {
  asRunId,
  CURRENT_HANDOFF_SCHEMA_VERSION,
  type CompletedRunHandoff,
  type GuardrailPolicy,
  type PostProcessingStatus,
  type RunEventEnvelope,
  type Verdict,
} from '@vostride/agent-qa-schema'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CLI_FUNCTION_CALLER } from '../composition/local-agent-host.js'
import {
  runPostRunTail,
  type PostRunTailOperations,
  type RunPostRunTailOptions,
} from '../curation/post-run-tail.js'

/** Queued first and never drained by its own process — the `--detach` posture. */
const RUN_A = 'run-aaa-detached'
/** Drains in-process, and therefore pumps run A's older jobs before its own. */
const RUN_B = 'run-bbb-inprocess'
const EVENTS_FILE = 'events.jsonl'

const TEST_MODEL: JobModelCapability = {
  modelId: 'test:post-run-cross-run-attribution',
  generate: () => {
    throw new Error('the post-run chain never authors in 388')
  },
}

const TEST_CONFIG: ConfigReaderPort = {
  getMasked: () => Promise.resolve({
    schemaVersion: 1,
    configPath: '/tmp/post-run-cross-run-attribution.config.yaml',
    entries: [],
  }),
}

const PERSISTED_ROOT_CAUSE: Verdict = {
  class: 'timeout',
  producer: 'deterministic-classifier',
  confidence: 1,
  evidence: {
    citedSteps: [0],
    citedAnchors: [],
    citedArtifacts: [],
    rationale: 'member outcome timeout',
  },
  memoryMisdirectionRuledOut: true,
  perTest: 0,
}

function fixtureHandoff(runId: string): CompletedRunHandoff {
  return {
    schemaVersion: CURRENT_HANDOFF_SCHEMA_VERSION,
    runId: asRunId(runId),
    scope: { tier: 'product', key: 'chips-storefront' },
    buildOrdinal: 4,
    executionContext: 'local-headless',
    aggregateVerdict: 'failed',
    configDigests: { suiteConfigDigest: 'suite-digest', testConfigDigest: 'test-digest' },
    startedAt: 1,
    endedAt: 2,
    tests: [
      {
        testId: 't_classified',
        testName: 'member the classifier reached',
        filePath: 'tests/classified.yaml',
        testIndex: 0,
        outcome: 'timeout',
        steps: [],
        rootCause: PERSISTED_ROOT_CAUSE,
      },
    ],
  }
}

/** The run's own log as its runner left it: `runFinished` last, `finalSeq` its own seq. */
function fixtureEventLines(runId: string): RunEventEnvelope[] {
  return [
    { seq: 1, ts: 10, runId, type: 'runStarted', payload: { busSchemaVersion: 1 } },
    { seq: 2, ts: 20, runId, type: 'verdict', payload: { verdict: 'failed' } },
    {
      seq: 3,
      ts: 30,
      runId,
      type: 'runFinished',
      payload: { aggregateVerdict: 'failed', disposition: 'detached', finalSeq: 3 },
    },
  ] as unknown as RunEventEnvelope[]
}

function fixtureBytes(runId: string): string {
  return `${fixtureEventLines(runId).map((line) => JSON.stringify(line)).join('\n')}\n`
}

const roots: string[] = []
const hosts: LocalAgentHost[] = []

afterEach(async () => {
  for (const host of hosts.splice(0)) await host.close()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/**
 * A clock whose readings ORDER the two runs' rows.
 *
 * `selectClaimable` is `ORDER BY created_at ASC, id ASC`, and the ids are content digests — so
 * without a clock the relative age of A's and B's rows would be decided by a hash. Handing run A
 * an earlier base makes "B's pump reaches A's work first" the scenario under test rather than a
 * coin flip that happens to land right on this machine.
 */
function orderedClock(baseMs: number): ClockPort {
  let tick = 0
  return { now: () => new Date(baseMs + tick++).toISOString() }
}

interface Fixture {
  agentQaRoot: string
  eventsPath(runId: string): string
  warn: ReturnType<typeof vi.fn>
  info: ReturnType<typeof vi.fn>
  clock: { value: number }
  options(runId: string, input?: {
    baseMs?: number
    overrides?: Partial<PostRunTailOperations>
  }): RunPostRunTailOptions
}

function fixture(behaviour: {
  curateRun?: (input: { runId: string }) => Promise<{ curated: number; deprecated: number }>
} = {}): Fixture {
  const agentQaRoot = mkdtempSync(join(tmpdir(), 'agent-qa-388-07-'))
  roots.push(agentQaRoot)
  const knowledgeRoot = join(agentQaRoot, 'knowledge')
  mkdirSync(knowledgeRoot, { recursive: true })

  const eventsPath = (runId: string): string =>
    join(agentQaRoot, RUNS_SUBDIR, slugBranch(runId), EVENTS_FILE)

  for (const runId of [RUN_A, RUN_B]) {
    const runDir = join(agentQaRoot, RUNS_SUBDIR, slugBranch(runId))
    mkdirSync(runDir, { recursive: true })
    writeFileSync(join(runDir, HANDOFF_FILE), `${JSON.stringify(fixtureHandoff(runId))}\n`, 'utf8')
    writeFileSync(eventsPath(runId), fixtureBytes(runId), 'utf8')
  }

  const warn = vi.fn<(message: string) => void>()
  const info = vi.fn<(message: string) => void>()
  const clock = { value: 1_000_000 }

  return {
    agentQaRoot,
    eventsPath,
    warn,
    info,
    clock,
    options(runId, input = {}): RunPostRunTailOptions {
      return {
        runId,
        agentQaRoot,
        configPath: join(agentQaRoot, 'agent-qa.config.yaml'),
        knowledgeConfig: { dir: 'knowledge' },
        configDir: agentQaRoot,
        auditSink: {} as AuditSink,
        policy: {} as GuardrailPolicy,
        log: {
          warn: (message: string) => warn(message),
          info: (message: string) => info(message),
        },
        operations: {
          resolveKnowledgeRoot: () => knowledgeRoot,
          runCurationTail: async () => undefined,
          now: () => clock.value,
          composeHost: () => {
            const host = composeLocalAgent({
              agentQaRoot,
              config: TEST_CONFIG,
              knowledgeRoot: () => knowledgeRoot,
              model: () => TEST_MODEL,
              idSource: DIGEST_JOB_ID_SOURCE,
              clock: orderedClock(input.baseMs ?? Date.parse('2026-01-01T00:00:00.000Z')),
              postRun: {
                curateRun: behaviour.curateRun
                  ?? (async () => ({ curated: 2, deprecated: 1 })),
              },
            })
            hosts.push(host)
            return host
          },
          ...input.overrides,
        },
      }
    },
  }
}

function readEvents(eventsPath: string): RunEventEnvelope[] {
  return readFileSync(eventsPath, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as RunEventEnvelope)
}

/**
 * Read the SAME op the tail renders from, through a COLD second composition.
 *
 * The push half is what this file suspects, so the pull half has to be answered by something that
 * shares no memory with the tail under test — a registry opened over the same database after the
 * drain returned.
 */
async function readStatusThroughTheOp(
  agentQaRoot: string,
  runId: string,
): Promise<PostProcessingStatus> {
  const host = composeLocalAgent({
    agentQaRoot,
    config: TEST_CONFIG,
    knowledgeRoot: () => join(agentQaRoot, 'knowledge'),
    model: () => TEST_MODEL,
    idSource: DIGEST_JOB_ID_SOURCE,
  })
  try {
    return await invokeFunction(
      host.registry,
      RUNS_POST_PROCESSING_FUNCTION_ID,
      { runId },
      CLI_FUNCTION_CALLER,
    ) as PostProcessingStatus
  } finally {
    await host.close()
  }
}

/** Run A enqueues and detaches; run B enqueues and drains the shared queue in-process. */
async function driveTwoRuns(f: Fixture): Promise<{ jobsRun: number; drain: string }> {
  const tailA = runPostRunTail(f.options(RUN_A, {
    baseMs: Date.parse('2026-01-01T00:00:00.000Z'),
  }))
  await tailA.enqueue()
  // The real `--detach` close-out: `drain()` is never called and the host is closed by `finish`.
  await tailA.finish({ detached: true })
  expect(tailA.report().drain).toBe('detached')

  const tailB = runPostRunTail(f.options(RUN_B, {
    baseMs: Date.parse('2026-01-01T01:00:00.000Z'),
  }))
  await tailB.enqueue()
  await tailB.drain()
  return { jobsRun: tailB.report().jobsRun, drain: tailB.report().drain }
}

describe('the chip trail is scoped to the run whose tail is draining (ANLZ-05, D-13)', () => {
  it('emits only for the run this tail is draining, never for a foreign claimed job', async () => {
    const f = fixture()
    const report = await driveTwoRuns(f)

    // The guard is only load-bearing if the foreign work genuinely reached `observe()`: four jobs
    // ran under B's pump — A's analyze-run and curate-memory as well as B's own two.
    expect(report.drain).toBe('drained')
    expect(report.jobsRun).toBe(4)

    // Run A's log is byte-identical to the bytes its own runner left. Full-file equality, not a
    // prefix check: an appended envelope at the end is exactly the defect being excluded.
    expect(readFileSync(f.eventsPath(RUN_A), 'utf8')).toBe(fixtureBytes(RUN_A))

    const appended = readEvents(f.eventsPath(RUN_B)).slice(fixtureEventLines(RUN_B).length)
    expect(appended.map((event) => event.type)).toEqual([
      'analysisStarted',
      'analysisCompleted',
      'curationStarted',
      'curationCompleted',
    ])
    // Gapless continuation from B's OWN `runFinished.finalSeq`, and four envelopes — not eight.
    expect(appended.map((event) => event.seq)).toEqual([4, 5, 6, 7])
    for (const event of appended) {
      expect(event.runId).toBe(RUN_B)
      expect(event.payload).toEqual({ runId: RUN_B })
    }
    // Nothing in B's file names the other run, in any field.
    expect(readFileSync(f.eventsPath(RUN_B), 'utf8')).not.toContain(RUN_A)
  })

  it('still advances the foreign run\'s durable rows under this tail\'s pump', async () => {
    const f = fixture()
    const report = await driveTwoRuns(f)
    expect(report.jobsRun).toBe(4)

    // The push half dropped A's outcomes; the pull half must still say A's chain finished, or the
    // guard would have been a refusal to do the work rather than a refusal to CLAIM it.
    const statusA = await readStatusThroughTheOp(f.agentQaRoot, RUN_A)
    const statusB = await readStatusThroughTheOp(f.agentQaRoot, RUN_B)
    expect(statusA.chips.analysis).toBe('done')
    expect(statusA.chips.curation).toBe('done')
    expect(statusB.chips.analysis).toBe('done')
    expect(statusB.chips.curation).toBe('done')
    // …and each answers about the run it was ASKED about, with its own notification row.
    expect(statusA.notification?.runId).toBe(RUN_A)
    expect(statusB.notification?.runId).toBe(RUN_B)
  })
})
