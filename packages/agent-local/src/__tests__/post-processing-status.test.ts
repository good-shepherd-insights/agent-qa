// `runs.postprocessing` against a REAL store (Phase 388, D-14 / ANLZ-05 / Pitfall 4).
//
// The projection's mapping table is pinned in `agent`, over hand-built row values, because a
// mapping is what it is. What CANNOT be measured there is everything this file measures: that
// the ids the op derives address the rows the enqueue actually wrote, that a status query
// answers from bytes on disk rather than from anything a process held, and — the prohibition
// this phase carries — that asking the question creates nothing.
//
// The op is driven through `invokeFunction` on a composed host's registry rather than by
// calling the reader, because the claim is about the SEAM D-14 defines: a surface asks the
// function layer, and the function layer is the only thing that opens a database.

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { chainJobIdsForRun, invokeFunction, RUNS_POST_PROCESSING_FUNCTION_ID } from '@vostride/agent-qa-agent'
import type { ClockPort, ConfigReaderPort, JobModelCapability } from '@vostride/agent-qa-agent'
import { HANDOFF_FILE, RUNS_SUBDIR, slugBranch } from '@vostride/agent-qa-runner-local'
import {
  asRunId,
  canonicalJson,
  CURRENT_HANDOFF_SCHEMA_VERSION,
  FunctionScopeSchema,
  sha256hex,
} from '@vostride/agent-qa-schema'
import type {
  CompletedRunHandoff,
  FunctionCaller,
  PostProcessingStatus,
  Verdict,
} from '@vostride/agent-qa-schema'
import { afterEach, describe, expect, it } from 'vitest'

import { composeLocalAgent, DIGEST_JOB_ID_SOURCE } from '../composition/compose-local-agent.js'
import type { LocalAgentHost, LocalAgentJobs } from '../composition/compose-local-agent.js'
import { AGENT_JOB_STORE_DB_FILE } from '../store/sqlite-job-store.js'

/**
 * The composition's REQUIRED quarantine identity mint (390-12 / D-01). Passthrough here: this
 * fixture already speaks canonical workspace-relative bytes, and the recipe itself stays pinned
 * in core's `workspace-paths.test.ts` — what these hosts exercise is everything BUT quarantine.
 */
const MINT_IDENTITY = (filePath: string): string => filePath

const RUN_ID = 'run-388-status'

const CALLER: FunctionCaller = {
  surface: 'test',
  grantedScopes: [...FunctionScopeSchema.options],
  safeMode: false,
  origin: 'agent',
}

const TEST_MODEL: JobModelCapability = {
  modelId: 'test:post-processing-status',
  generate: async () => {
    throw new Error('the post-run chain never authors in 388')
  },
}

const TEST_CONFIG: ConfigReaderPort = {
  getMasked: () => Promise.resolve({
    schemaVersion: 1,
    configPath: '/tmp/post-processing-status.config.yaml',
    entries: [],
  }),
}

function createSteppingClock(): ClockPort {
  let tick = 0
  return {
    now() {
      const stamp = `2026-03-03T00:00:${String(tick % 60).padStart(2, '0')}.000Z`
      tick += 1
      return stamp
    },
  }
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
    scope: { tier: 'product', key: 'post-processing-storefront' },
    buildOrdinal: 9,
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

function writeHandoff(agentQaRoot: string, handoff: CompletedRunHandoff): void {
  const runDir = join(agentQaRoot, RUNS_SUBDIR, slugBranch(String(handoff.runId)))
  mkdirSync(runDir, { recursive: true })
  writeFileSync(join(runDir, HANDOFF_FILE), `${JSON.stringify(handoff)}\n`, 'utf8')
}

function enqueuePayload(handoff: CompletedRunHandoff): Record<string, unknown> {
  return {
    runId: String(handoff.runId),
    handoffDigest: sha256hex(canonicalJson(handoff)),
    handoffSchemaVersion: handoff.schemaVersion,
    executionContext: handoff.executionContext,
  }
}

const roots: string[] = []
const hosts: LocalAgentHost[] = []

afterEach(async () => {
  for (const host of hosts.splice(0)) await host.close()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

interface Harness {
  readonly agentQaRoot: string
  readonly host: LocalAgentHost
  readonly status: () => Promise<PostProcessingStatus>
}

/**
 * A host with no job store OPENED — `jobs()` is deliberately not called here.
 *
 * That is the point of the fixture rather than an omission: the no-creation case needs a host
 * that has done nothing durable, and the cases that do need rows open the store themselves.
 */
function createHarness(): Harness {
  const agentQaRoot = mkdtempSync(join(tmpdir(), 'agent-qa-pp-status-'))
  roots.push(agentQaRoot)
  const host = composeLocalAgent({
    mintQuarantineIdentityPath: MINT_IDENTITY,
    agentQaRoot,
    config: TEST_CONFIG,
    knowledgeRoot: () => join(agentQaRoot, 'knowledge'),
    model: () => TEST_MODEL,
    clock: createSteppingClock(),
    postRun: {
      curateRun: async () => ({ curated: 2, deprecated: 1, complete: true }),
      // True of this substitute: it returns counts without ever reaching candidate emission.
      candidateProse: 'masker-active',
    },
  })
  hosts.push(host)
  return {
    agentQaRoot,
    host,
    status: async () => await invokeFunction(
      host.registry,
      RUNS_POST_PROCESSING_FUNCTION_ID,
      { runId: RUN_ID },
      CALLER,
    ) as PostProcessingStatus,
  }
}

async function pump(jobs: LocalAgentJobs, fence: { epoch: number }): Promise<void> {
  for (let pumped = 0; pumped < 24; pumped += 1) {
    const outcome = await jobs.queue.runNextJob({ fence })
    if (!outcome.ran) return
  }
  throw new Error('the post-run chain did not drain within the pump bound')
}

describe('a status read creates no queue state (T-388-10 / Pitfall 4)', () => {
  it('answers the all-pending projection and leaves NO agent-jobs.db behind', async () => {
    const harness = createHarness()

    const status = await harness.status()

    expect(status).toEqual({
      runId: RUN_ID,
      chips: { analysis: 'pending', curation: 'pending', issues: 'reserved' },
    })
    // The assertion that matters is this one, and it is on the FILESYSTEM rather than on the
    // answer: a read routed through `host.jobs()` returns exactly the same projection while
    // bringing a queue database into existence in a project that has never enqueued anything.
    // Only the disk can tell those two implementations apart.
    expect(existsSync(join(harness.agentQaRoot, AGENT_JOB_STORE_DB_FILE))).toBe(false)
    expect(existsSync(join(harness.agentQaRoot, 'agent-jobs'))).toBe(false)
  })

  it('still creates nothing when asked repeatedly', async () => {
    const harness = createHarness()

    await harness.status()
    await harness.status()
    await harness.status()

    expect(existsSync(join(harness.agentQaRoot, AGENT_JOB_STORE_DB_FILE))).toBe(false)
  })
})

describe('chip truth is read from durable rows (ANLZ-05, D-14)', () => {
  it('reads a chain that was enqueued and never drained as pending, from the real row', async () => {
    const harness = createHarness()
    const jobs = await harness.host.jobs()
    const handoff = fixtureHandoff(RUN_ID)
    writeHandoff(harness.agentQaRoot, handoff)

    await jobs.store.adoptEpoch(1)
    const enqueued = await jobs.queue.enqueue('analyze-run', enqueuePayload(handoff), RUN_ID)
    // The id the op will address, asserted against the id the enqueue produced: this is what
    // makes the `pending` below a fact about THAT row rather than about an absent one, which
    // the previous describe block already showed also reads `pending`.
    expect(String(enqueued.job.id))
      .toBe(String(chainJobIdsForRun(RUN_ID, DIGEST_JOB_ID_SOURCE).analyzeRun))

    const status = await harness.status()

    expect(existsSync(join(harness.agentQaRoot, AGENT_JOB_STORE_DB_FILE))).toBe(true)
    expect(status.chips).toEqual({
      analysis: 'pending',
      curation: 'pending',
      issues: 'reserved',
    })
    expect('notification' in status).toBe(false)
  })

  it('reads a completed chain as done/done/reserved with the notification attached', async () => {
    const harness = createHarness()
    const jobs = await harness.host.jobs()
    const handoff = fixtureHandoff(RUN_ID)
    writeHandoff(harness.agentQaRoot, handoff)

    const fence = await jobs.store.adoptEpoch(1)
    await jobs.queue.enqueue('analyze-run', enqueuePayload(handoff), RUN_ID)
    await pump(jobs, fence)

    const status = await harness.status()

    expect(status.chips).toEqual({ analysis: 'done', curation: 'done', issues: 'reserved' })
    // The SAME record the terminal transaction wrote, not a rebuild of it: read back through
    // the store's own reader and compared whole, so a projection that assembled a plausible
    // notification of its own would fail here rather than look right.
    const [written] = await jobs.store.listNotifications()
    expect(status.notification).toEqual(written?.payload)
    expect(status.notification).toMatchObject({
      runId: RUN_ID,
      outcome: 'done',
      stages: {
        analysis: { status: 'done' },
        curation: { status: 'done', curated: 2, deprecated: 1 },
        issues: { status: 'reserved' },
      },
    })
  })

  it('reads a chain whose curation died as done/failed/reserved (D-12)', async () => {
    const agentQaRoot = mkdtempSync(join(tmpdir(), 'agent-qa-pp-status-'))
    roots.push(agentQaRoot)
    const host = composeLocalAgent({
      mintQuarantineIdentityPath: MINT_IDENTITY,
      agentQaRoot,
      config: TEST_CONFIG,
      knowledgeRoot: () => join(agentQaRoot, 'knowledge'),
      model: () => TEST_MODEL,
      clock: createSteppingClock(),
      postRun: {
        curateRun: () => Promise.reject(new Error('the knowledge root is unreachable')),
        // True of this substitute: it rejects before any candidate emission could be reached.
        candidateProse: 'masker-active',
      },
    })
    hosts.push(host)
    const jobs = await host.jobs()
    const handoff = fixtureHandoff(RUN_ID)
    writeHandoff(agentQaRoot, handoff)

    const fence = await jobs.store.adoptEpoch(1)
    await jobs.queue.enqueue('analyze-run', enqueuePayload(handoff), RUN_ID)
    await pump(jobs, fence)

    const status = await invokeFunction(
      host.registry,
      RUNS_POST_PROCESSING_FUNCTION_ID,
      { runId: RUN_ID },
      CALLER,
    ) as PostProcessingStatus

    // The failure is reported per STAGE: a chip set that collapsed to one outcome would say
    // the analysis failed too, and the analysis is exactly the artifact that survived.
    expect(status.chips).toEqual({ analysis: 'done', curation: 'failed', issues: 'reserved' })
    expect(status.notification).toMatchObject({ outcome: 'failed' })
  })

  it('answers about the run it was ASKED about, not about whichever chain the store holds', async () => {
    const harness = createHarness()
    const jobs = await harness.host.jobs()
    const handoff = fixtureHandoff(RUN_ID)
    writeHandoff(harness.agentQaRoot, handoff)

    const fence = await jobs.store.adoptEpoch(1)
    await jobs.queue.enqueue('analyze-run', enqueuePayload(handoff), RUN_ID)
    await pump(jobs, fence)

    // A neighbour run in the SAME database, finished, with rows under other ids. A projection
    // that read "the chain" rather than "this run's chain" would report it as this one's.
    const other = await invokeFunction(
      harness.host.registry,
      RUNS_POST_PROCESSING_FUNCTION_ID,
      { runId: 'run-388-someone-else' },
      CALLER,
    ) as PostProcessingStatus

    expect(other.chips).toEqual({
      analysis: 'pending',
      curation: 'pending',
      issues: 'reserved',
    })
    expect('notification' in other).toBe(false)
  })
})
