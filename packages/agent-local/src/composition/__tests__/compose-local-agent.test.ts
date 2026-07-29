// The one local composition root, proven by USE (Phase 385 plan 09, D-15).
//
// The criterion this file exists to strengthen is "composeLocalAgent() returns the composed host".
// An object of nulls satisfies that sentence, and so does a host whose members are real types over
// dead wiring. So every member below is exercised against the real thing it claims to be: the
// registry answers a function op through the gate and leaves an audit row on disk, the queue opens
// a real sqlite database and runs a job to a real checkpoint file, and the bound model is proven to
// be the one the engine hands the author callback rather than merely a field that was set.

import { existsSync, mkdirSync, readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createJobKindRegistry, invokeFunction } from '@vostride/agent-qa-agent'
import type { JobKindRegistry, JobModelCapability } from '@vostride/agent-qa-agent'
import {
  CURRENT_HANDOFF_SCHEMA_VERSION,
  MASKED_RESOLVED_CONFIG_SCHEMA_VERSION,
} from '@vostride/agent-qa-schema'
import { FsEventLog, FsHandoffStore } from '@vostride/agent-qa-runner-local'
import type {
  CompletedRunHandoff,
  FunctionCaller,
  MaskedResolvedConfig,
  RunEventEnvelope,
} from '@vostride/agent-qa-schema'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { AGENT_JOB_STORE_DB_FILE } from '../../store/sqlite-job-store.js'
import { composeLocalAgent, DIGEST_JOB_ID_SOURCE, SYSTEM_CLOCK } from '../compose-local-agent.js'
import type { LocalAgentHost, RunExecutionPort } from '../compose-local-agent.js'

const CALLER: FunctionCaller = {
  surface: 'cli',
  grantedScopes: ['read', 'run', 'config-write'],
  safeMode: false,
}

const AUTHORSHIP_KIND = 'analyze-run' as const
const AUTHORSHIP_CHECKPOINT = 'analysis'

const MASKED_CONFIG: MaskedResolvedConfig = {
  schemaVersion: MASKED_RESOLVED_CONFIG_SCHEMA_VERSION,
  configPath: '/fixture/agent-qa.config.yaml',
  entries: [{ key: 'use.llm', value: 'default', source: 'config-file', masked: false }],
}

/**
 * A model that RECORDS what it was asked and answers with its own id.
 *
 * The id travelling out in the answer is what makes "the queue authored with the capability the
 * composition bound" assertable: a second capability substituted anywhere on the path would put a
 * different string in the checkpoint.
 */
function recordingModel(modelId: string): JobModelCapability & {
  invocations: () => number
  prompts: () => readonly string[]
} {
  const prompts: string[] = []
  return {
    modelId,
    generate: (request) => {
      prompts.push(request.prompt)
      return Promise.resolve({ text: `answered by ${modelId}` })
    },
    invocations: () => prompts.length,
    prompts: () => prompts,
  }
}

/** One checkpointed kind whose handler authors through the engine's authorship primitive. */
function authoringKinds(): JobKindRegistry {
  return createJobKindRegistry([
    {
      kind: AUTHORSHIP_KIND,
      checkpointed: true,
      checkpointSchedule: [AUTHORSHIP_CHECKPOINT],
      allowedSuccessors: [],
      maxAttempts: 3,
      backoff: { kind: 'none' },
      onPermanentFailure: 'halt-chain',
      async handler(context) {
        await context.recordLlmAuthorship(
          AUTHORSHIP_CHECKPOINT,
          (model) => model.generate({ prompt: `summarise ${context.job.summary}` }),
        )
        return { status: 'complete', next: [] }
      },
    },
  ])
}

describe('composeLocalAgent (D-15)', () => {
  let root: string
  let agentQaRoot: string
  let model: ReturnType<typeof recordingModel>
  let modelFactoryCalls: number
  let knowledgeRootCalls: number
  let configReads: number
  let host: LocalAgentHost

  function compose(
    overrides: { jobKinds?: JobKindRegistry; runExecution?: RunExecutionPort } = {},
  ): LocalAgentHost {
    return composeLocalAgent({
      agentQaRoot,
      config: {
        getMasked: () => {
          configReads += 1
          return Promise.resolve(MASKED_CONFIG)
        },
      },
      knowledgeRoot: () => {
        knowledgeRootCalls += 1
        return join(root, 'knowledge')
      },
      model: () => {
        modelFactoryCalls += 1
        return model
      },
      ...overrides,
    })
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'agent-qa-compose-local-'))
    agentQaRoot = join(root, '.agent-qa')
    mkdirSync(agentQaRoot, { recursive: true })
    model = recordingModel('fixture:composed-model')
    modelFactoryCalls = 0
    knowledgeRootCalls = 0
    configReads = 0
    host = compose()
  })

  afterEach(() => {
    host.close()
    rmSync(root, { recursive: true, force: true })
  })

  // ---- the registry half ----------------------------------------------------------------

  it('binds the seed capabilities: a run op answers from the runs directory it was handed', async () => {
    const runDir = join(agentQaRoot, 'runs', 'main-abc')
    mkdirSync(runDir, { recursive: true })
    writeFileSync(
      join(runDir, 'handoff.json'),
      JSON.stringify({
        schemaVersion: CURRENT_HANDOFF_SCHEMA_VERSION,
        runId: 'run_composed_fixture' as CompletedRunHandoff['runId'],
        scope: { tier: 'product', key: 'shop' },
        buildOrdinal: 1,
        executionContext: 'local-headless',
        aggregateVerdict: 'passed',
        configDigests: { suiteConfigDigest: 'suite-digest', testConfigDigest: 'test-digest' },
        startedAt: 1_000,
        endedAt: 2_000,
        tests: [],
      } satisfies CompletedRunHandoff),
      'utf8',
    )

    const rows = await invokeFunction(host.registry, 'runs.list', {}, CALLER) as readonly {
      runId: string
    }[]

    // The port really enumerated the fixture. An unbound registry answers `[]` here, which is
    // exactly why the fixture is planted rather than the empty case being asserted.
    expect(rows.map((row) => row.runId)).toEqual(['run_composed_fixture'])
  })

  it('consults the INJECTED config port rather than resolving configuration of its own', async () => {
    const masked = await invokeFunction(host.registry, 'config.get', {}, CALLER)

    expect(masked).toEqual(MASKED_CONFIG)
    expect(configReads).toBe(1)
  })

  it('leaves a real audit row at the project root for every invocation', async () => {
    await invokeFunction(host.registry, 'config.get', {}, CALLER)

    const auditPath = join(agentQaRoot, 'execution_audit.jsonl')
    expect(existsSync(auditPath)).toBe(true)
    expect(readFileSync(auditPath, 'utf8')).toContain('config.get')
  })

  // ---- the durable half -----------------------------------------------------------------

  it('does NOT open the job database until a host asks for it', () => {
    // The lazy-wrong implementation of "the handle carries the queue" is an eager one, and it is
    // invisible to every other test in this file: `agent-qa fn --list` would silently create a
    // queue database in a project that has never enqueued anything.
    expect(existsSync(join(agentQaRoot, AGENT_JOB_STORE_DB_FILE))).toBe(false)
    expect(modelFactoryCalls).toBe(0)
    expect(knowledgeRootCalls).toBe(0)
  })

  it('opens a real sqlite store and runs a job to a real checkpoint file', async () => {
    host = compose({ jobKinds: authoringKinds() })
    const jobs = await host.jobs()

    expect(existsSync(join(agentQaRoot, AGENT_JOB_STORE_DB_FILE))).toBe(true)

    const fence = await jobs.store.adoptEpoch(1)
    const enqueued = await jobs.queue.enqueue(AUTHORSHIP_KIND, { runRef: 'run_1' }, 'key-a')
    const outcome = await jobs.queue.runNextJob({ fence })

    expect(outcome).toMatchObject({ ran: true, checkpointsPublished: [AUTHORSHIP_CHECKPOINT] })

    const checkpointPath = join(
      agentQaRoot,
      'agent-jobs',
      'checkpoints',
      String(enqueued.job.id),
      `${AUTHORSHIP_CHECKPOINT}.json`,
    )
    expect(existsSync(checkpointPath)).toBe(true)

    const dump = await jobs.store.dumpState()
    expect(dump.jobs).toHaveLength(1)
    expect(dump.jobs[0]).toMatchObject({ status: 'done', attempts: 1 })
  })

  // ---- the model binding ----------------------------------------------------------------

  it('authors with the capability the composition bound, proven by the id in the recorded bytes', async () => {
    host = compose({ jobKinds: authoringKinds() })
    const jobs = await host.jobs()

    const fence = await jobs.store.adoptEpoch(1)
    const enqueued = await jobs.queue.enqueue(AUTHORSHIP_KIND, { runRef: 'run_1' }, 'key-a')
    await jobs.queue.runNextJob({ fence })

    expect(model.invocations()).toBe(1)
    expect(jobs.model.modelId).toBe('fixture:composed-model')

    const recorded = JSON.parse(readFileSync(
      join(
        agentQaRoot,
        'agent-jobs',
        'checkpoints',
        String(enqueued.job.id),
        `${AUTHORSHIP_CHECKPOINT}.json`,
      ),
      'utf8',
    )) as { value: { value: { text: string } } }

    // Asserting the ANSWER rather than the call count: a capability that was constructed and then
    // discarded in favour of another still shows one invocation somewhere, but the id it stamped
    // into the durable bytes can only be the id of the capability the engine actually called.
    expect(JSON.stringify(recorded)).toContain('answered by fixture:composed-model')
  })

  it('resolves the model exactly once, however many times the queue is asked for', async () => {
    const first = await host.jobs()
    const second = await host.jobs()

    expect(second).toBe(first)
    expect(modelFactoryCalls).toBe(1)
  })

  it('opens the database once under concurrent callers', async () => {
    const [first, second] = await Promise.all([host.jobs(), host.jobs()])

    // Memoizing the resolved VALUE instead of the promise leaves a window in which two callers
    // each run the factory and each open the database. Awaiting both together is the only shape
    // that can see it.
    expect(second).toBe(first)
    expect(modelFactoryCalls).toBe(1)
  })

  it('closes what it opened, and closing a host that opened nothing is a no-op', async () => {
    const untouched = compose()
    expect(() => untouched.close()).not.toThrow()

    const jobs = await host.jobs()
    host.close()
    await expect(jobs.store.dumpState()).rejects.toThrow()
  })

  // ---- the defaults, named ---------------------------------------------------------------

  it('derives job ids from (kind, key) so two hosts address the same row', () => {
    expect(String(DIGEST_JOB_ID_SOURCE.jobIdFor('analyze-run', 'key-a')))
      .toBe(String(DIGEST_JOB_ID_SOURCE.jobIdFor('analyze-run', 'key-a')))
    expect(String(DIGEST_JOB_ID_SOURCE.jobIdFor('analyze-run', 'key-a')))
      .not.toBe(String(DIGEST_JOB_ID_SOURCE.jobIdFor('analyze-run', 'key-b')))
  })

  it('defaults the clock to wall time in the format every store column is written in', () => {
    expect(host.clock).toBe(SYSTEM_CLOCK)
    expect(SYSTEM_CLOCK.now()).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u)
  })

  // ---- runs.start: what this host can and cannot do (D-16) ------------------------------

  it('lists runs.start as UNBOUND when this composition has no run executor', async () => {
    // D-09's visible state, still carried by the very capability that named it — and now
    // carried because it is TRUE of this composition rather than because a spec said so.
    // A host without an executor is a real thing (a listing, a read-only surface, 386's
    // daemon before it wires one), and the catalog says so instead of hiding the capability.
    const declaration = host.registry.list(CALLER).find((entry) => entry.id === 'runs.start')

    expect(declaration).toMatchObject({ requiredScopes: ['run'], bindingStatus: 'unbound' })
    await expect(invokeFunction(host.registry, 'runs.start', {}, CALLER))
      .rejects.toMatchObject({ name: 'FunctionNotBoundError' })
  })

  it('binds runs.start as soon as a host supplies one — the same composition, one argument apart', async () => {
    const started: string[] = []
    const bound = compose({
      runExecution: {
        execute: () => {
          const runId = 'run_composed_start'
          started.push(runId)
          new FsEventLog({ root: agentQaRoot, runId }).append({
            seq: 1,
            ts: 1_700_000_000_001,
            runId,
            type: 'runStarted',
            payload: {},
          } as RunEventEnvelope)
          new FsHandoffStore({ root: agentQaRoot, runId }).save({
            schemaVersion: CURRENT_HANDOFF_SCHEMA_VERSION,
            runId: runId as CompletedRunHandoff['runId'],
            scope: { tier: 'product', key: 'shop' },
            buildOrdinal: 3,
            executionContext: 'local-headless',
            aggregateVerdict: 'passed',
            configDigests: { suiteConfigDigest: 'suite', testConfigDigest: 'test' },
            startedAt: 1_700_000_000_001,
            endedAt: 1_700_000_000_009,
            tests: [],
          })
          return Promise.resolve({ runId: runId as CompletedRunHandoff['runId'] })
        },
      },
    })

    try {
      expect(bound.registry.list(CALLER).find((entry) => entry.id === 'runs.start'))
        .toMatchObject({ bindingStatus: 'bound' })
      expect(await invokeFunction(bound.registry, 'runs.start', {}, CALLER)).toMatchObject({
        runId: 'run_composed_start',
        buildOrdinal: 3,
        scope: { tier: 'product', key: 'shop' },
      })
      expect(started).toEqual(['run_composed_start'])
    } finally {
      bound.close()
    }
  })

  it('refuses a run executor that reported a run it never ran', async () => {
    // The composition's own evidence check, against the run's real event log on disk. This is
    // the laziest wrong binding — a port that returns a well-formed id — and it is the one a
    // suite asserting only "runs.start is bound" would have accepted.
    const fabricating = compose({
      runExecution: {
        execute: () => Promise.resolve({ runId: 'run_never_happened' as CompletedRunHandoff['runId'] }),
      },
    })
    try {
      await expect(invokeFunction(fabricating.registry, 'runs.start', {}, CALLER))
        .rejects.toMatchObject({ name: 'RunProducedNoEventsError' })
    } finally {
      fabricating.close()
    }
  })

  // Named here rather than left to the cross-package suite that caught it, because the failure is
  // silent from inside this package: vitest resolves `../store/...` by source, so every test above
  // passes while the PUBLISHED bundle is unloadable. esbuild rewrites `node:sqlite` to a bare
  // `sqlite`, and unlike `node:fs` that specifier resolves to nothing at all.
  it('keeps the node: protocol in the published bundle, or the store cannot be imported', () => {
    const config = readFileSync(
      new URL('../../../tsup.config.ts', import.meta.url),
      'utf8',
    )
    expect(config).toContain('removeNodeProtocol: false')
  })
})
