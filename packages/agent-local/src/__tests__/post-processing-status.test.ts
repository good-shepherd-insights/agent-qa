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

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createMaskingContext, setActiveMaskingContextResolver } from '@vostride/agent-qa-safety'

import { chainJobIdsForRun, invokeFunction, RUNS_POST_PROCESSING_FUNCTION_ID } from '@vostride/agent-qa-agent'
import type { ClockPort, ConfigReaderPort, JobModelCapability } from '@vostride/agent-qa-agent'
import type { PostRunJobCapabilities } from '@vostride/agent-qa-agent'
import { HANDOFF_FILE, RUNS_SUBDIR, slugBranch } from '@vostride/agent-qa-runner-local'
import {
  asRunId,
  canonicalJson,
  CURRENT_HANDOFF_SCHEMA_VERSION,
  FunctionScopeSchema,
  CurationSnapshotSchema,
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
import { AGENT_JOB_STORE_DB_FILE, QUARANTINED_UNREADABLE_KIND_REASON } from '../store/sqlite-job-store.js'
import { canonicalLogicalDump, createLogicalDump } from '../store/logical-dump.js'
import { createPostProcessingReader } from '../store/post-processing-reader.js'
import { createJobCheckpointStore } from '../store/job-checkpoint-store.js'

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
  setActiveMaskingContextResolver(() => undefined)
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
function createHarness(existingRoot?: string, postRun?: {
  curateRun?: PostRunJobCapabilities['curateRun']
  stageAdversarialProposal?: PostRunJobCapabilities['stageAdversarialProposal']
}): Harness {
  const agentQaRoot = existingRoot ?? mkdtempSync(join(tmpdir(), 'agent-qa-pp-status-'))
  if (existingRoot === undefined) roots.push(agentQaRoot)
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
      ...postRun,
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

async function closeWriter(harness: Harness): Promise<void> {
  await harness.host.close()
  hosts.splice(hosts.indexOf(harness.host), 1)
}

function readQueue(root: string) {
  const db = new DatabaseSync(join(root, AGENT_JOB_STORE_DB_FILE), { readOnly: true })
  try {
    return {
      rows: db.prepare('SELECT * FROM jobs ORDER BY created_at, id').all(),
      logical: canonicalLogicalDump(createLogicalDump({
        db,
        schemaVersion: Number(db.prepare('PRAGMA user_version').get()?.user_version),
        checkpointsRoot: join(root, 'agent-jobs'),
      })),
    }
  } finally {
    db.close()
  }
}

const CURATION_SNAPSHOT = CurationSnapshotSchema.parse({
  schemaVersion: 1,
  rows: [{ recordId: 'affected-record', bucket: 'added', changes: [{ bucket: 'added',
    change: { schemaVersion: 1, recordId: 'affected-record', change: 'added', atOrdinal: 9 },
  }] }],
  breakdown: { added: 1, confirmed: 0, superseded: 0, deprecated: 0, proposed: 0 },
})

function readColdChain(root: string, runId = RUN_ID) {
  return createPostProcessingReader({ agentQaRoot: root, idSource: DIGEST_JOB_ID_SOURCE })
    .readChain(chainJobIdsForRun(runId, DIGEST_JOB_ID_SOURCE), runId)
}

async function completedCuration() {
  const writer = createHarness(undefined, {
    curateRun: async () => ({ curated: 7, deprecated: 3, complete: true, snapshot: CURATION_SNAPSHOT }),
  })
  const jobs = await writer.host.jobs()
  const fence = await jobs.store.adoptEpoch(1)
  const ids = chainJobIdsForRun(RUN_ID, DIGEST_JOB_ID_SOURCE)
  await jobs.queue.enqueue('curate-memory', { runId: RUN_ID }, `${ids.analyzeRun}->curate-memory`)
  expect(await jobs.queue.runNextJob({ fence })).toMatchObject({ ran: true, disposition: 'completed' })
  await closeWriter(writer)
  return { writer, ids }
}

describe('423 completed checkpoint snapshot', () => {
  it('CHECKPOINT-BEFORE-NOTIFICATION reads actual curation while the real proposals stage is blocked', async () => {
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const writer = createHarness(undefined, {
      curateRun: async () => ({ curated: 7, deprecated: 3, complete: true, snapshot: CURATION_SNAPSHOT }),
      stageAdversarialProposal: async () => {
        entered.resolve()
        await release.promise
        return { proposed: 0, skipped: 0 }
      },
    })
    const jobs = await writer.host.jobs()
    const handoff = fixtureHandoff(RUN_ID)
    writeHandoff(writer.agentQaRoot, handoff)
    const fence = await jobs.store.adoptEpoch(1)
    await jobs.queue.enqueue('analyze-run', enqueuePayload(handoff), RUN_ID)
    await jobs.queue.runNextJob({ fence })
    await jobs.queue.runNextJob({ fence })
    const running = jobs.queue.runNextJob({ fence })
    try {
      await entered.promise
      const before = readQueue(writer.agentQaRoot)
      const cold = await readColdChain(writer.agentQaRoot)
      expect(cold).toMatchObject({
        analyzeRun: { status: 'done', claimed: false },
        curateMemory: { status: 'done', claimed: false },
        proposeImprovements: { status: 'queued', claimed: true },
        curationSnapshot: CURATION_SNAPSHOT,
      })
      expect(cold).not.toHaveProperty('notification')
      expect(await jobs.store.listNotifications()).toEqual([])
      expect(readQueue(writer.agentQaRoot)).toEqual(before)
    } finally {
      release.resolve()
      await running
    }
  })

  it.each(['historical', 'incomplete'] as const)('CHECKPOINT-MISSING %s never invents a snapshot', async kind => {
    const writer = createHarness(undefined, {
      curateRun: async () => ({ curated: 7, deprecated: 3, complete: kind === 'historical',
        ...(kind === 'incomplete' ? { snapshot: CURATION_SNAPSHOT } : {}),
      }),
    })
    const jobs = await writer.host.jobs()
    const fence = await jobs.store.adoptEpoch(1)
    const ids = chainJobIdsForRun(RUN_ID, DIGEST_JOB_ID_SOURCE)
    await jobs.queue.enqueue('curate-memory', { runId: RUN_ID }, `${ids.analyzeRun}->curate-memory`)
    await jobs.queue.runNextJob({ fence })
    const checkpoint = await jobs.store.readCheckpoint(ids.curateMemory, 'bundle-committed')
    expect(checkpoint.found).toBe(kind === 'historical')
    await closeWriter(writer)
    expect(await readColdChain(writer.agentQaRoot)).not.toHaveProperty('curationSnapshot')
    expect(await readColdChain(writer.agentQaRoot, 'unrelated-run')).not.toHaveProperty('curationSnapshot')
  })

  it.each(['snapshot', 'run', 'job', 'checkpoint', 'attempt', 'digest'] as const)(
    'CHECKPOINT-INVALID %s refuses authoritative corruption without changing bytes', async field => {
      const { writer, ids } = await completedCuration()
      const db = new DatabaseSync(join(writer.agentQaRoot, AGENT_JOB_STORE_DB_FILE))
      try {
        const row = db.prepare('SELECT payload_json FROM job_checkpoints WHERE checkpoint_id = ?')
          .get('bundle-committed')!
        const payload = JSON.parse(String(row.payload_json))
        if (field === 'snapshot') payload.value.curationSnapshot = { ...CURATION_SNAPSHOT, breakdown: {} }
        if (field === 'run') payload.value.runId = 'unrelated-run'
        if (field === 'job') payload.jobId = ids.analyzeRun
        if (field === 'checkpoint') payload.checkpointId = 'candidates-authored'
        if (field === 'attempt') payload.attempt += 1
        const json = canonicalJson(payload)
        db.prepare('UPDATE job_checkpoints SET payload_json = ?, payload_digest = ? WHERE checkpoint_id = ?')
          .run(json, field === 'digest' ? 'invalid-digest' : sha256hex(json), 'bundle-committed')
      } finally { db.close() }
      const before = readQueue(writer.agentQaRoot)
      await expect(readColdChain(writer.agentQaRoot)).rejects.toMatchObject({ name: 'CurationSnapshotReadError' })
      expect(readQueue(writer.agentQaRoot)).toEqual(before)
    },
  )

  it.each(['missing', 'malformed', 'stale', 'misaddressed'] as const)(
    'CHECKPOINT-CACHE %s recovers the validated fenced snapshot', async kind => {
      const { writer, ids } = await completedCuration()
      const checkpoints = createJobCheckpointStore({ root: writer.agentQaRoot })
      const path = checkpoints.checkpointPath(ids.curateMemory, 'bundle-committed')
      const envelope = JSON.parse(readFileSync(path, 'utf8'))
      if (kind === 'missing') rmSync(path)
      else if (kind === 'malformed') writeFileSync(path, '{')
      else {
        if (kind === 'stale') envelope.payload.value.curationSnapshot = { ...CURATION_SNAPSHOT, rows: [] }
        else envelope.jobId = ids.analyzeRun
        writeFileSync(path, JSON.stringify(envelope))
      }
      const before = readQueue(writer.agentQaRoot)
      expect(await readColdChain(writer.agentQaRoot)).toHaveProperty('curationSnapshot', CURATION_SNAPSHOT)
      expect(readQueue(writer.agentQaRoot)).toEqual(before)
    },
  )
})

describe('423 cold stage facts', () => {
  it.each(['queued', 'retried', 'complete', 'failed', 'cancelled'] as const)(
    'THREE-STAGE-COLD %s preserves exact rows and queue contents',
    async lifecycle => {
      const writer = createHarness()
      const jobs = await writer.host.jobs()
      const fence = await jobs.store.adoptEpoch(1)
      const ids = chainJobIdsForRun(RUN_ID, DIGEST_JOB_ID_SOURCE)
      const stages = [
        ['analysis', 'analyze-run', RUN_ID, ids.analyzeRun],
        ['curation', 'curate-memory', `${ids.analyzeRun}->curate-memory`, ids.curateMemory],
        ['proposals', 'propose-improvements', `${ids.curateMemory}->propose-improvements`, ids.proposeImprovements],
      ] as const
      for (const [stage, kind, key, id] of stages) {
        const enqueued = await jobs.queue.enqueue(kind, { runId: RUN_ID }, key)
        expect(enqueued.job.id).toBe(id)
        if (lifecycle === 'cancelled') {
          expect(await jobs.store.requestCancel(id, fence)).toEqual({ outcome: 'cancelled' })
        } else if (lifecycle !== 'queued') {
          const excludeKinds = stages.map(item => item[1]).filter(other => other !== kind)
          const claimed = await jobs.store.claimNext(fence, { excludeKinds })
          expect(claimed).toMatchObject({ claimed: true, job: { id } })
          if (lifecycle === 'complete') await jobs.store.completeAndChain(id, [], fence)
          if (lifecycle === 'failed') {
            await jobs.store.recordFailure(id, { kind: 'permanent', reason: `${stage} failed` }, fence)
          }
          if (lifecycle === 'retried') {
            await jobs.store.recordFailure(id, { kind: 'retry', reason: `${stage} retry` }, fence)
            expect(await jobs.store.claimNext(fence, { excludeKinds }))
              .toMatchObject({ claimed: true, job: { id, attempts: 2 } })
          }
        }
      }
      await closeWriter(writer)
      const before = readQueue(writer.agentQaRoot)
      expect(before.rows).toHaveLength(3)
      const bytes = readFileSync(join(writer.agentQaRoot, AGENT_JOB_STORE_DB_FILE))
      const masking = createMaskingContext()
      setActiveMaskingContextResolver(() => masking)
      const cold = createHarness(writer.agentQaRoot)
      const result = await cold.status()
      const expected = Object.fromEntries(stages.map(([stage, , , id]) => {
        const row = before.rows.find(row => row.id === id)!
        expect(row.status).toBe(lifecycle === 'retried' ? 'queued' : lifecycle === 'complete' ? 'done' : lifecycle)
        expect(Number(row.attempts)).toBe(lifecycle === 'retried' ? 2 : lifecycle === 'complete' || lifecycle === 'failed' ? 1 : 0)
        return [stage, {
          attempts: Number(row.attempts),
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          ...(row.claimed_at === null ? {} : { claimedAt: row.claimed_at }),
          ...(row.last_failure_kind === null ? {} : { lastFailureKind: row.last_failure_kind }),
          ...(row.last_failure_reason === null ? {} : { lastFailureReason: row.last_failure_reason }),
        }]
      }))
      expect(result.stageDetails).toEqual(expected)
      const chip = lifecycle === 'retried' ? 'running' : lifecycle === 'complete' ? 'done'
        : lifecycle === 'queued' ? 'pending' : 'failed'
      expect(result.chips).toEqual({ analysis: chip, curation: chip })
      expect(readQueue(writer.agentQaRoot)).toEqual(before)
      expect(readFileSync(join(writer.agentQaRoot, AGENT_JOB_STORE_DB_FILE))).toEqual(bytes)
    },
  )

  it('MASK-FAILURE-REASON masks persisted prose with the active read context', async () => {
    const writer = createHarness()
    const jobs = await writer.host.jobs()
    const fence = await jobs.store.adoptEpoch(1)
    const { job } = await jobs.queue.enqueue('analyze-run', { runId: RUN_ID }, RUN_ID)
    await jobs.store.claimNext(fence)
    const reason = 'synthetic-cold-secret for operator@example.test'
    await jobs.store.recordFailure(job.id, { kind: 'permanent', reason }, fence)
    await closeWriter(writer)
    const before = readQueue(writer.agentQaRoot)
    expect(before.rows[0]?.last_failure_reason).toBe(reason)
    const masking = createMaskingContext()
    masking.register('synthetic-cold-secret')
    setActiveMaskingContextResolver(() => masking)
    const result = await createHarness(writer.agentQaRoot).status()
    expect(result.stageDetails?.analysis?.lastFailureReason).toBe(masking.mask(reason))
    expect(JSON.stringify(result)).not.toContain('synthetic-cold-secret')
    expect(JSON.stringify(result)).not.toContain('operator@example.test')
    expect(readQueue(writer.agentQaRoot)).toEqual(before)
  })

  it('JOB-MISSING-OMITTED projects only the existing row after cold reopen', async () => {
    const writer = createHarness()
    const jobs = await writer.host.jobs()
    await jobs.queue.enqueue('analyze-run', { runId: RUN_ID }, RUN_ID)
    await closeWriter(writer)
    const before = readQueue(writer.agentQaRoot)
    const row = before.rows[0]!
    const result = await createHarness(writer.agentQaRoot).status()
    expect(result.stageDetails).toEqual({ analysis: {
      attempts: 0, createdAt: row.created_at, updatedAt: row.updated_at,
    } })
    expect(readQueue(writer.agentQaRoot)).toEqual(before)
  })

  it('CONCLUSION-RECORDED reports the writer quarantine conclusion after cold reopen', async () => {
    const writer = createHarness()
    const jobs = await writer.host.jobs()
    await jobs.queue.enqueue('analyze-run', { runId: RUN_ID }, RUN_ID)
    await closeWriter(writer)
    const db = new DatabaseSync(join(writer.agentQaRoot, AGENT_JOB_STORE_DB_FILE))
    try {
      expect(Number(db.prepare('UPDATE jobs SET kind = ?').run('unknown-fixture-kind').changes)).toBe(1)
    } finally { db.close() }
    const quarantine = createHarness(writer.agentQaRoot)
    const reopened = await quarantine.host.jobs()
    const fence = await reopened.store.adoptEpoch(1)
    expect(await reopened.store.claimNext(fence)).toEqual({ claimed: false })
    expect((await reopened.store.dumpState()).jobs[0]?.conclusionKind).toBe('unreadable_kind')
    await closeWriter(quarantine)
    const before = readQueue(writer.agentQaRoot)
    expect(before.rows[0]?.last_failure_reason).toBe(QUARANTINED_UNREADABLE_KIND_REASON)
    const result = await createHarness(writer.agentQaRoot).status()
    expect(result.stageDetails?.analysis?.conclusionKind).toBe('unreadable_kind')
    expect(readQueue(writer.agentQaRoot)).toEqual(before)
  })
})

describe('a status read creates no queue state (T-388-10 / Pitfall 4)', () => {
  it('answers the all-pending projection and leaves NO agent-jobs.db behind', async () => {
    const harness = createHarness()

    const status = await harness.status()

    expect(status).toEqual({
      runId: RUN_ID,
      chips: { analysis: 'pending', curation: 'pending' },
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
    })
    expect('notification' in status).toBe(false)
  })

  it('reads a completed chain as done/done with the notification attached', async () => {
    const harness = createHarness()
    const jobs = await harness.host.jobs()
    const handoff = fixtureHandoff(RUN_ID)
    writeHandoff(harness.agentQaRoot, handoff)

    const fence = await jobs.store.adoptEpoch(1)
    await jobs.queue.enqueue('analyze-run', enqueuePayload(handoff), RUN_ID)
    await pump(jobs, fence)

    const status = await harness.status()

    expect(status.chips).toEqual({ analysis: 'done', curation: 'done' })
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
      },
    })
  })

  it('reads a chain whose curation died as done/failed (D-12)', async () => {
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
    expect(status.chips).toEqual({ analysis: 'done', curation: 'failed' })
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
    })
    expect('notification' in other).toBe(false)
  })
})

// ------------------------------------------------------------------------------------------
// The STORED-ROW cell (Phase 404, D-01 / D-04; RESEARCH Pitfall 7).
//
// Every cell above writes its notification with THIS build's writer, so together they measure
// this build talking to itself. The row is durable — it is sitting in users' `agent-jobs.db`
// right now, stamped by the build that shipped before the narrowing — and the only thing
// standing between those bytes and a surface is `guardRunNotification`, reached through the op.
// Pinning the migration at the guard alone would leave the WIRING free: a reader that stopped
// calling the guard, or an op that read the column some other way, passes every guard-level
// cell in `schema` and hands a three-stage record straight to a renderer.
// ------------------------------------------------------------------------------------------

describe('a row another build wrote still reads, through the op (D-01, Pitfall 7)', () => {
  it('reads a stored schemaVersion-1 notification as a two-stage schemaVersion-2 record',
    async () => {
      const harness = createHarness()
      const jobs = await harness.host.jobs()
      const handoff = fixtureHandoff(RUN_ID)
      writeHandoff(harness.agentQaRoot, handoff)

      const fence = await jobs.store.adoptEpoch(1)
      await jobs.queue.enqueue('analyze-run', enqueuePayload(handoff), RUN_ID)
      await pump(jobs, fence)
      // The store is closed before the column is rewritten: the point is bytes at rest that this
      // process did not author, and a live handle would leave the row half this build's.
      await harness.host.close()
      hosts.splice(hosts.indexOf(harness.host), 1)

      // The PREVIOUS contract, written by hand because no build in this tree can still produce
      // it — three stages, the third the structural placeholder, stamped schemaVersion: 1.
      const legacyPayload = {
        schemaVersion: 1,
        runId: RUN_ID,
        outcome: 'done',
        verdictSummary: { total: 2, byClass: { timeout: 1, unknown: 1 } },
        stages: {
          analysis: { status: 'done' },
          curation: { status: 'done', curated: 2, deprecated: 1 },
          issues: { status: 'reserved' },
        },
      }
      const dbPath = join(harness.agentQaRoot, AGENT_JOB_STORE_DB_FILE)
      const db = new DatabaseSync(dbPath)
      try {
        // Asserted rather than assumed: an UPDATE that matched no row would leave this build's
        // own v2 record in place and make every claim below vacuous.
        const updated = db
          .prepare('UPDATE notifications SET payload = ? WHERE run_id = ?')
          .run(JSON.stringify(legacyPayload), RUN_ID)
        expect(Number(updated.changes)).toBe(1)
      } finally {
        db.close()
      }

      // A COLD host — nothing of the process that wrote the rows survives into this read.
      const cold = composeLocalAgent({
        mintQuarantineIdentityPath: MINT_IDENTITY,
        agentQaRoot: harness.agentQaRoot,
        config: TEST_CONFIG,
        knowledgeRoot: () => join(harness.agentQaRoot, 'knowledge'),
        model: () => TEST_MODEL,
        clock: createSteppingClock(),
        postRun: {
          curateRun: async () => ({ curated: 2, deprecated: 1, complete: true }),
          candidateProse: 'masker-active',
        },
      })
      hosts.push(cold)
      const status = await invokeFunction(
        cold.registry,
        RUNS_POST_PROCESSING_FUNCTION_ID,
        { runId: RUN_ID },
        CALLER,
      ) as PostProcessingStatus

      const notification = status.notification
      expect(notification).toBeDefined()
      // 2026-09-11 (422 D-13): the walk is two steps long now, and the row this cell stores was
      // written by a build three versions back. The end of the walk moved; the claim did not.
      expect(notification!.schemaVersion).toBe(3)
      // Set-equality on the keys: the placeholder must be GONE from what a surface receives, not
      // merely unrendered by the surfaces that happen to exist today.
      //
      // It is also, since D-13, the pin that the walk did not INVENT the third stage on the way
      // past. A historical row belongs to a chain that had no proposal stage, and `proposals`
      // absent is the only honest thing this build can say about it.
      expect(Object.keys(notification!.stages).sort()).toEqual(['analysis', 'curation'])
      // The counts survived the walk — a migration that rebuilt the stage record instead of
      // narrowing it would drop them and still pass the key-set claim above.
      expect(notification!.stages.curation).toEqual({ status: 'done', curated: 2, deprecated: 1 })
      // And the chips the same read projects are the two, by key set.
      expect(Object.keys(status.chips).sort()).toEqual(['analysis', 'curation'])
    })
})
