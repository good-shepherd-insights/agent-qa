// SC1: the REAL post-run tail, run twice, produces ONE analyze-run job (Phase 388 plan 02).
//
// The claim is about the TAIL, not about `enqueue` — calling `queue.enqueue` twice would only
// re-prove the store's shipped unique index (385 D-08), which is the mechanism here and not the
// subject. So this drives `runPostRunTail` end to end against a real sqlite store, a real
// handoff on disk, the real composition root and the real handler bodies, twice, and compares
// the store's LOGICAL DUMP — the 385 D-03 ratified comparator — across the two runs.
//
// Only three operations are injected, and none of them is the thing under test: `composeHost`
// (to bind a fast `curateRun` stub and a config/model pair with no provider behind them),
// `resolveKnowledgeRoot` (there is no project config file in a tmpdir) and `runCurationTail`
// (the prior-run janitor has its own suite; running it here would fold nothing and cost a
// knowledge root).

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ConfigReaderPort, JobModelCapability } from '@vostride/agent-qa-agent'
import { chainJobIdsForRun } from '@vostride/agent-qa-agent'
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
  type Verdict,
} from '@vostride/agent-qa-schema'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { runVerdictFirstCurationTail } from '../curation/curation-tail.js'
import {
  runPostRunTail,
  type PostRunTailOperations,
  type RunPostRunTailOptions,
} from '../curation/post-run-tail.js'

const RUN_ID = 'run-388-02-idempotency'

const TEST_MODEL: JobModelCapability = {
  modelId: 'test:post-run-enqueue-idempotency',
  generate: () => {
    throw new Error('the post-run chain never authors in 388')
  },
}

const TEST_CONFIG: ConfigReaderPort = {
  getMasked: () => Promise.resolve({
    schemaVersion: 1,
    configPath: '/tmp/post-run-enqueue-idempotency.config.yaml',
    entries: [],
  }),
}

/** The verdict the runner already persisted (373-07); one member has it, one deliberately does not. */
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
    scope: { tier: 'product', key: 'idempotency-storefront' },
    buildOrdinal: 3,
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
      {
        testId: 't_unclassified',
        testName: 'member the classifier declined',
        filePath: 'tests/unclassified.yaml',
        testIndex: 1,
        outcome: 'failed',
        steps: [],
      },
    ],
  }
}

const roots: string[] = []
const hosts: LocalAgentHost[] = []

afterEach(async () => {
  for (const host of hosts.splice(0)) await host.close()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

interface Fixture {
  agentQaRoot: string
  knowledgeRoot: string
  curateCalls: string[]
  warn: ReturnType<typeof vi.fn>
  runCurationTail: ReturnType<typeof vi.fn>
  options(overrides?: Partial<PostRunTailOperations>): RunPostRunTailOptions
}

function fixture(): Fixture {
  const agentQaRoot = mkdtempSync(join(tmpdir(), 'agent-qa-388-02-'))
  roots.push(agentQaRoot)
  const knowledgeRoot = join(agentQaRoot, 'knowledge')
  mkdirSync(knowledgeRoot, { recursive: true })

  const handoff = fixtureHandoff(RUN_ID)
  const runDir = join(agentQaRoot, RUNS_SUBDIR, slugBranch(RUN_ID))
  mkdirSync(runDir, { recursive: true })
  writeFileSync(join(runDir, HANDOFF_FILE), `${JSON.stringify(handoff)}\n`, 'utf8')

  const curateCalls: string[] = []
  const warn = vi.fn<(message: string) => void>()
  const runCurationTail = vi.fn(async () => undefined)

  return {
    agentQaRoot,
    knowledgeRoot,
    curateCalls,
    warn,
    runCurationTail,
    options(overrides: Partial<PostRunTailOperations> = {}): RunPostRunTailOptions {
      return {
        runId: RUN_ID,
        agentQaRoot,
        configPath: join(agentQaRoot, 'agent-qa.config.yaml'),
        knowledgeConfig: { dir: 'knowledge' },
        configDir: agentQaRoot,
        auditSink: {} as AuditSink,
        policy: {} as GuardrailPolicy,
        log: { warn: (message: string) => warn(message) },
        operations: {
          resolveKnowledgeRoot: () => knowledgeRoot,
          runCurationTail,
          composeHost: () => {
            const host = composeLocalAgent({
              agentQaRoot,
              config: TEST_CONFIG,
              knowledgeRoot: () => knowledgeRoot,
              model: () => TEST_MODEL,
              idSource: DIGEST_JOB_ID_SOURCE,
              postRun: {
                curateRun: async (input) => {
                  curateCalls.push(input.runId)
                  return { curated: 1, deprecated: 0, complete: true }
                },
              },
            })
            hosts.push(host)
            return host
          },
          ...overrides,
        },
      }
    },
  }
}

/**
 * The logical dump with the authority ratchet split out.
 *
 * `job_store_fence` MUST differ between two tail runs: each run acquires its own writer lease,
 * which mints a new epoch, and `adoptEpoch` records it. That row moving is the evidence the
 * second run really took authority and really pumped — so it is asserted SEPARATELY rather
 * than allowed to weaken the byte-identity claim about everything the chain wrote.
 */
function splitDump(logicalDump: string): { chain: string; fenceEpoch: number } {
  const parsed = JSON.parse(logicalDump) as {
    tables: { table: string; rows: { epoch?: number }[] }[]
  }
  const fence = parsed.tables.find((table) => table.table === 'job_store_fence')
  return {
    chain: JSON.stringify({
      ...parsed,
      tables: parsed.tables.filter((table) => table.table !== 'job_store_fence'),
    }),
    fenceEpoch: fence?.rows[0]?.epoch ?? -1,
  }
}

/** Read durable state through a SECOND composition — an in-memory memo could not survive this. */
async function readDurableState(agentQaRoot: string): Promise<{
  logicalDump: string
  rows: { id: string; kind: string; status: string; claimedAt: unknown }[]
}> {
  const host = composeLocalAgent({
    agentQaRoot,
    config: TEST_CONFIG,
    knowledgeRoot: () => join(agentQaRoot, 'knowledge'),
    model: () => TEST_MODEL,
    idSource: DIGEST_JOB_ID_SOURCE,
  })
  try {
    const jobs = await host.jobs()
    const logicalDump = await jobs.store.dumpLogicalState()
    const dump = await jobs.store.dumpState()
    return {
      logicalDump,
      rows: dump.jobs.map((row) => ({
        id: String(row.id),
        kind: String(row.kind),
        status: String(row.status),
        claimedAt: (row as { claimedAt?: unknown }).claimedAt,
      })),
    }
  } finally {
    await host.close()
  }
}

describe('SC1 — the real post-run tail run twice (ANLZ-01, D-03/D-07)', () => {
  it('produces exactly one analyze-run job, and the second run dedupes rather than errors', async () => {
    const f = fixture()
    const ids = chainJobIdsForRun(RUN_ID, DIGEST_JOB_ID_SOURCE)

    const first = runPostRunTail(f.options())
    await first.enqueue()
    await first.drain()
    const afterFirst = await readDurableState(f.agentQaRoot)

    const second = runPostRunTail(f.options())
    await second.enqueue()
    await second.drain()
    const afterSecond = await readDurableState(f.agentQaRoot)

    expect(first.report().enqueue).toBe('enqueued')
    // A deduped second hand-off is a SUCCESS. If the tail ever reported it as a failure this
    // would be 'failed' and the D-07 warning would have fired for a healthy run.
    expect(second.report().enqueue).toBe('deduped')
    expect(f.warn).not.toHaveBeenCalled()

    const analyzeRows = afterSecond.rows.filter((row) => row.kind === 'analyze-run')
    expect(analyzeRows).toHaveLength(1)
    expect(analyzeRows[0]!.id).toBe(String(ids.analyzeRun))
    // D-04: the triage slot is declared and never enqueued, so its derived id addresses nothing.
    expect(afterSecond.rows.some((row) => row.id === String(ids.triageIssues))).toBe(false)
    expect(f.curateCalls).toEqual([RUN_ID])

    // The 385 D-03 comparator, and the strongest form of the claim: the second complete tail
    // run left every byte the CHAIN wrote — jobs, checkpoints, the notification — untouched.
    // A row-count assertion alone would pass just as well against a tail that re-claimed and
    // rewrote everything it found.
    const first1 = splitDump(afterFirst.logicalDump)
    const second2 = splitDump(afterSecond.logicalDump)
    expect(second2.chain).toBe(first1.chain)
    // …and the fence DID advance, which is what makes the identity above non-vacuous: the
    // second tail took its own authority and pumped a queue it found already drained.
    expect(first1.fenceEpoch).toBe(1)
    expect(second2.fenceEpoch).toBe(2)
    expect(first1.chain.match(/"kind":"analyze-run"/g) ?? []).toHaveLength(1)
  })

  it('still enqueues under --detach, and drains nothing (D-03, Pitfall 3)', async () => {
    const f = fixture()
    const ids = chainJobIdsForRun(RUN_ID, DIGEST_JOB_ID_SOURCE)
    const tail = runPostRunTail(f.options())

    const exitCode = await runVerdictFirstCurationTail({
      exitCode: 1,
      detach: true,
      enqueue: () => tail.enqueue(),
      runTail: () => tail.drain(),
    })

    expect(exitCode).toBe(1)
    const state = await readDurableState(f.agentQaRoot)
    // The record exists…
    expect(state.rows).toEqual([
      expect.objectContaining({
        id: String(ids.analyzeRun),
        kind: 'analyze-run',
        status: 'queued',
      }),
    ])
    // …and nothing claimed or finished it: no chain successor, no curation, no sweep.
    expect(state.rows[0]!.claimedAt ?? null).toBeNull()
    expect(f.curateCalls).toEqual([])
    expect(f.runCurationTail).not.toHaveBeenCalled()
    expect(tail.report().drain).toBe('not-attempted')
  })

  it('returns the frozen exit code when the enqueue rejects, warning exactly once (JOBQ-06)', async () => {
    const f = fixture()
    const tail = runPostRunTail(f.options({
      loadCompletedRunHandoff: () => {
        throw new Error('the handoff store is unreachable')
      },
    }))

    const exitCode = await runVerdictFirstCurationTail({
      exitCode: 7,
      detach: false,
      enqueue: () => tail.enqueue(),
      runTail: () => tail.drain(),
    })

    expect(exitCode).toBe(7)
    expect(tail.report().enqueue).toBe('failed')
    expect(f.warn).toHaveBeenCalledTimes(1)
    expect(String(f.warn.mock.calls[0]![0])).toContain('verdict and exit code are unaffected')
  })
})
