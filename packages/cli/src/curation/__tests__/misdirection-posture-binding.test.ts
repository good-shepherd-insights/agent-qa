// Production posture writer -> both host bindings -> real queue -> analysis verdict (422-27).
// Run execution and daemon lifecycle are substituted; root reads, posture recording and
// analysis validation are real. No provider or live BYOM evidence is claimed.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  asRecordId,
  asRef,
  asRunId,
  computeBriefDigest,
  guardCompletedRunHandoff,
  slugBranch,
} from '@vostride/agent-qa-schema'
import { generateRunId, generateTestId } from '@vostride/agent-qa-ids'
import type {
  CompletedRunHandoff,
  ElementInfo,
  RecordId,
  ScreenState,
  ServedBrief,
  StepEvidence,
  RunAnalysisArtifact,
  SubActionEvidence,
} from '@vostride/agent-qa-schema'
import type { ConfigReaderPort, JobModelCapability } from '@vostride/agent-qa-agent'
import { defaultGuardrailPolicyInput, loadGuardrailPolicy } from '@vostride/agent-qa-safety'

/**
 * THE DRIVE'S MOCK CARRIES NO `original()`, AND THAT IS LOAD-BEARING (measured, not preferred).
 *
 * `in-process-run-execution.ts` statically imports `commands/run.js`, which statically imports
 * `composition/local-agent-host.js` — the very file under test. A factory that awaited the real
 * module evaluated that cycle, and the terminal host's own deferred
 * `await import('./in-process-run-execution.js')` then resolved to the instance that evaluation
 * had already cached: the daemon's dispatch reached the mock and the terminal's did not, so six
 * real runs executed while the parity cells read an empty call list. Both static importers of this
 * module are TYPE-ONLY, so the two members the two hosts destructure are the whole surface a
 * factory owes.
 */
const drive = vi.hoisted(() => ({
  runInProcessCliRun: vi.fn(async (_options: unknown, _request: unknown) => ({
    runId: 'fixture-dispatch',
    exitCode: 0,
  })),
}))
vi.mock('@vostride/agent-qa-agent-local', async (original) => {
  const actual = await original<typeof import('@vostride/agent-qa-agent-local')>()
  return { ...actual, composeLocalAgent: vi.fn(actual.composeLocalAgent) }
})
vi.mock('../../composition/in-process-run-execution.js', () => ({
  runInProcessCliRun: drive.runInProcessCliRun,
  refuseUnhonourableRequestFields: () => undefined,
}))
import { composeLocalAgent, type ComposeLocalAgentInput, type LocalAgentHost } from '@vostride/agent-qa-agent-local'
import { MISDIRECTION_POSTURE_FILE, readMisdirectionRunPosture } from '../misdirection-run-state.js'
import { completedRunDir } from '../curation-tail.js'

import type { InProcessCliRunExecutionOptions } from '../../composition/in-process-run-execution.js'
import { createInProcessFixture } from '../../composition/__tests__/in-process-run-fixture.js'
import { composeCliLocalAgent } from '../../composition/local-agent-host.js'
import { runDaemonHost, type DaemonHostOperations } from '../../daemon/host.js'
import { createPostVerdictStep, type PostVerdictStepOperations } from '../post-verdict-step.js'
import type { MisdirectionPreparationCapabilities } from '../misdirection-tail.js'

const PRODUCT = 'storefront'
const CANDIDATE = asRecordId('rec-host-candidate')
const DAEMON_LEASE = { leaseId: 'lease-daemon', epoch: 41 }

const TEST_MODEL: JobModelCapability = {
  modelId: 'test:422-27-posture',
  generate: async () => ({ text: JSON.stringify({ tests: [{
    testIndex: 0,
    class: 'app_bug',
    confidence: 0.85,
    memoryMisdirectionRuledOut: true,
    citedSteps: [0],
    citedArtifacts: [],
    rationale: 'the checkout never opened',
    groundingQuote: { stepIndex: 0, quote: 'the checkout never opened' },
    discriminator: 'checkout remains closed after a successful click',
    nextAction: 'inspect the checkout handler',
    links: [],
  }] }) }),
}
const TEST_CONFIG: ConfigReaderPort = {
  getMasked: async () => ({ schemaVersion: 1, configPath: '/tmp/422-14h.yaml', entries: [] }),
}

const projects: string[] = []

/** The options the LAST host dispatch handed the run drive. */
function driveOptions(): InProcessCliRunExecutionOptions {
  return drive.runInProcessCliRun.mock.calls.at(-1)![0] as InProcessCliRunExecutionOptions
}

const hosts: LocalAgentHost[] = []
beforeEach(() => { vi.clearAllMocks() })
afterEach(async () => {
  for (const host of hosts.splice(0)) await host.close()
  for (const project of projects.splice(0)) rmSync(project, { recursive: true, force: true })
  vi.restoreAllMocks()
})

function fixture() {
  const created = createInProcessFixture({ origin: 'http://127.0.0.1:1', environment: 'local' })
  projects.push(created.project)
  return created
}

// ---- the run's own durable record, written exactly as the runner leaves it --------------------

function element(): ElementInfo {
  return {
    ref: asRef('checkout'),
    role: 'button',
    name: 'Checkout',
    nameNormalized: 'checkout',
    bounds: { x: 10, y: 20, width: 100, height: 40 },
    center: { x: 60, y: 40 },
    state: { enabled: true, focused: false, visible: true, clickable: true },
    labels: { ariaLabel: 'Checkout' },
    attributes: { 'data-testid': 'checkout' },
  }
}

function screen(): ScreenState {
  const checkout = element()
  return {
    platform: 'web',
    tree: 'button Checkout',
    elements: [checkout],
    refMap: { [checkout.ref]: { bounds: checkout.bounds!, center: checkout.center! } },
    url: '/cart',
    timestamp: 1_750_000_000_000,
    metadata: {
      captureMode: 'textOnly',
      coordSpace: 'viewport',
      viewportWidth: 1_280,
      viewportHeight: 720,
      scroll: { offsetX: 0, offsetY: 0, contentWidth: 1_280, contentHeight: 1_440 },
    },
  }
}

function subAction(): SubActionEvidence {
  const state = screen()
  return {
    plan: 'Click Checkout',
    plannedAction: { type: 'click', ref: asRef('checkout') },
    stateBefore: state,
    stateAfter: state,
    result: { success: true },
  }
}

function servedBrief(id: RecordId): ServedBrief {
  const brief: ServedBrief = {
    scope: { tier: 'product', key: PRODUCT },
    asOfBuild: 7,
    budget: 1_000,
    truncation: 'none',
    channel1: [
      {
        id,
        kind: 'fact',
        summary: 'Use the Checkout button to continue from the cart.',
        trust: 0.5,
        status: 'candidate',
        servedAsCanary: false,
        tier: 'L1',
      },
    ],
    channel2: [],
    channel3: [],
    briefDigest: '',
  }
  return { ...brief, briefDigest: computeBriefDigest(brief) }
}

function failingStep(): StepEvidence {
  return {
    stepIndex: 0,
    stepText: 'Click Checkout',
    cacheStatus: 'miss',
    servedBrief: servedBrief(CANDIDATE),
    subActions: [subAction()],
    verifierVerdict: { pass: false, reasoning: 'the checkout never opened' },
  }
}

function writeHandoff(agentQaRoot: string, runId: string): {
  runDir: string
  handoffPath: string
} {
  const handoff: CompletedRunHandoff = guardCompletedRunHandoff({
    schemaVersion: 7,
    runId: asRunId(runId),
    scope: { tier: 'product', key: PRODUCT },
    buildOrdinal: 7,
    executionContext: 'local-headless',
    aggregateVerdict: 'failed',
    configDigests: { suiteConfigDigest: 'suite', testConfigDigest: 'test' },
    startedAt: 1_750_000_000_000,
    endedAt: 1_750_000_001_000,
    tests: [
      {
        testId: generateTestId(),
        testName: 'Checkout hosts',
        filePath: 'checkout.spec.yaml',
        testIndex: 0,
        outcome: 'failed',
        steps: [failingStep()],
      },
    ],
  })
  const runDir = join(agentQaRoot, 'runs', slugBranch(runId))
  mkdirSync(runDir, { recursive: true })
  const handoffPath = join(runDir, 'handoff.json')
  writeFileSync(handoffPath, `${JSON.stringify(handoff)}\n`, 'utf8')
  return { runDir, handoffPath }
}

// ---- the two hosts, driven to the point where each hands its options to the drive --------------

/** The TERMINAL host's `runs.start`, up to the options it hands `runInProcessCliRun`. */
async function terminalRunOptions() {
  const created = fixture()
  const host = composeCliLocalAgent({
    configPath: created.configPath,
    agentQaRoot: created.agentQaRoot,
    confirm: undefined,
    config: TEST_CONFIG,
    model: () => TEST_MODEL,
    postRun: {
      candidateProse: 'masker-active',
      curateRun: async () => ({ curated: 0, deprecated: 0, complete: true, candidateIds: [] }),
    },
  })
  const composed = vi.mocked(composeLocalAgent).mock.calls.at(-1)![0]
  await composed.runExecution!.execute({ patterns: [created.testPattern] } as never)
  hosts.push(host)
  return {
    created,
    host,
    postRun: composed.postRun!,
    options: driveOptions(),
  }
}

/** The DAEMON host's dispatch, up to the same point, over its own injected operations table. */
async function daemonRunOptions() {
  const created = fixture()
  const signals = new Map<NodeJS.Signals, () => void>()
  let composed: ComposeLocalAgentInput | undefined
  let started = false
  const operations = {
    acquireWriterLease: () => ({ kind: 'acquired', ...DAEMON_LEASE }),
    releaseLease: () => ({ kind: 'released' }),
    heartbeatLease: () => ({ kind: 'alive', holder: { ...DAEMON_LEASE, pid: process.pid } }),
    readWriterLease: () => ({ kind: 'free' }),
    composeJobRecovery: () => ({
      store: { adoptEpoch: async () => ({ epoch: DAEMON_LEASE.epoch }) },
      recoverAbandonedClaims: async () => ({ recovered: 0 }),
      close: vi.fn(),
    }),
    composeLocalAgent: (input: ComposeLocalAgentInput) => {
      composed = input
      return {
        registry: {},
        jobs: async () => ({
          queue: { runNextJob: async () => ({ ran: false, reason: 'no-job' }) },
        }),
        close: vi.fn(),
      }
    },
    reconcileRunOutcomesProjection: () => ({ kind: 'skipped' as const }),
    inspectDrainableCurationWork: () => ({
      queuedCandidateIds: [],
      recoverableClaimedCandidateIds: [],
    }),
    countRemainingCurationWork: () => ({ queued: 0, claimedNonterminal: 0, quarantined: 0 }),
    listQueuedCandidates: () => [],
    drainQueue: async () => ({ kind: 'drained', jobsProcessed: 0, committed: 0, failures: 0 }),
    runMaintenanceTail: async () => undefined,
    appendDrainSessionReceipt: () => undefined,
    setInterval: () => 1,
    clearInterval: () => undefined,
    setTimeout: () => 1,
    clearTimeout: () => undefined,
    onSignal: (signal: NodeJS.Signals, listener: () => void) => signals.set(signal, listener),
    offSignal: (signal: NodeJS.Signals) => signals.delete(signal),
    startHeartbeatSupervisor: async () => ({
      exited: new Promise<void>(() => {}),
      stop: async () => undefined,
    }),
    startInvokeServer: async (input: { socketPath: string }) => {
      started = true
      return { socketPath: input.socketPath, close: async () => undefined }
    },
  } as unknown as Partial<DaemonHostOperations>
  const running = runDaemonHost({
    agentQaRoot: created.agentQaRoot,
    knowledgeRoot: join(created.project, 'knowledge'),
    configPath: created.configPath,
    config: TEST_CONFIG,
    model: () => TEST_MODEL,
    author: () => async () => ({ kind: 'fallback-required' as const, reason: 'no-model' as const }),
    policy: loadGuardrailPolicy(defaultGuardrailPolicyInput),
    operations,
    logger: { info: () => undefined, error: () => undefined },
  } as unknown as Parameters<typeof runDaemonHost>[0])
  await vi.waitFor(() => expect(started).toBe(true))
  await composed!.runExecution!.execute({ patterns: [created.testPattern] } as never)
  const options = driveOptions()
  signals.get('SIGTERM')!()
  await running
  return { created, options, postRun: composed!.postRun! }
}

/**
 * Drive a real post-verdict step over a real run directory with the HOST's own capability, and
 * read `handoff.json` off disk at the instant the queue row is written.
 */
async function driveStep(
  created: ReturnType<typeof fixture>,
  misdirection: MisdirectionPreparationCapabilities,
  runId: string,
  host?: LocalAgentHost,
) {
  const jobs = await host?.jobs()
  const { handoffPath } = writeHandoff(created.agentQaRoot, runId)
  const observed: { sidecarAtEnqueue: unknown[]; payloads: Record<string, unknown>[] } = {
    sidecarAtEnqueue: [],
    payloads: [],
  }
  const queued = new Set<string>()
  const { port } = createPostVerdictStep({
    runId,
    agentQaRoot: created.agentQaRoot,
    knowledgeRoot: join(created.project, 'knowledge'),
    configPath: created.configPath,
    misdirection,
    log: { warn: () => undefined },
    operations: {
      recordCanaryPolicy: async () => undefined,
      readWriterLease: (() => ({
        kind: 'absent',
      })) as unknown as PostVerdictStepOperations['readWriterLease'],
      acquireWriterLease: (() => ({
        kind: 'acquired',
        leaseId: 'lease-1',
        epoch: 1,
      })) as unknown as PostVerdictStepOperations['acquireWriterLease'],
      nudgeDaemon: (async () => undefined) as unknown as PostVerdictStepOperations['nudgeDaemon'],
      loadCompletedRunHandoff: ((path: string) =>
        guardCompletedRunHandoff(
          JSON.parse(readFileSync(path, 'utf8')),
        )) as unknown as PostVerdictStepOperations['loadCompletedRunHandoff'],
      composeHost: (() => ({
        jobs: async () => ({
          queue: {
            enqueue: async (
              kind: string,
              payload: Record<string, unknown>,
              idempotencyKey: string,
            ) => {
              const raw = JSON.parse(readFileSync(handoffPath, 'utf8')) as Record<string, unknown>
              observed.sidecarAtEnqueue.push(
                'misdirectionEvidence' in raw ? raw.misdirectionEvidence : 'absent',
              )
              observed.payloads.push(payload)
              const key = `${kind}${idempotencyKey}`
              const deduped = queued.has(key)
              queued.add(key)
              if (jobs !== undefined) return await jobs.queue.enqueue(kind as never, payload, idempotencyKey)
              return { job: { id: `job_${key}` }, deduped }
            },
          },
        }),
        close: async () => undefined,
      })) as unknown as PostVerdictStepOperations['composeHost'],
      now: () => 1_750_000_002_000,
    },
  })
  const outcome = await port.run({} as Parameters<typeof port.run>[0])
  return {
    outcome,
    observed,
    jobs: queued.size,
    handoff: (): CompletedRunHandoff =>
      guardCompletedRunHandoff(JSON.parse(readFileSync(handoffPath, 'utf8'))),
  }
}


describe('422-27 recorded posture reaches both production analysis hosts', () => {
  it('terminal reader returns the production-written absent-root posture', async () => {
    const terminal = await terminalRunOptions()
    const runId = generateRunId()
    await driveStep(terminal.created, terminal.options.postProcessing!.misdirection!, runId)
    expect(readMisdirectionRunPosture(completedRunDir(terminal.created.agentQaRoot, runId), runId)?.kind)
      .toBe('no-eval-root')
    expect(terminal.postRun.readMisdirectionRootPosture?.(runId)).toBe('no-eval-root')
  })

  it('daemon reader returns the production-written absent-root posture', async () => {
    const daemon = await daemonRunOptions()
    const runId = generateRunId()
    await driveStep(daemon.created, daemon.options.postProcessing!.misdirection!, runId)
    expect(readMisdirectionRunPosture(completedRunDir(daemon.created.agentQaRoot, runId), runId)?.kind)
      .toBe('no-eval-root')
    expect(daemon.postRun.readMisdirectionRootPosture?.(runId)).toBe('no-eval-root')
  })

  it('both hosts expose the identical postRun member set including the reader', async () => {
    const terminal = await terminalRunOptions()
    const daemon = await daemonRunOptions()
    expect(Object.keys(terminal.postRun).sort()).toEqual(Object.keys(daemon.postRun).sort())
    expect(Object.keys(terminal.postRun)).toContain('readMisdirectionRootPosture')
  })

  it('an absent posture remains unanswered', async () => {
    const terminal = await terminalRunOptions()
    expect(terminal.postRun.readMisdirectionRootPosture).toBeTypeOf('function')
    expect(terminal.postRun.readMisdirectionRootPosture!(generateRunId())).toBeUndefined()
  })

  it.each([
    ['foreign identity', { schemaVersion: 1, runId: 'foreign-run', kind: 'no-eval-root' }, 'identity mismatch'],
    ['strict schema', { schemaVersion: 1, kind: 'no-eval-root', extra: true }, 'invalid'],
  ])('rejects a planted %s record', async (_name, record, reason) => {
    const terminal = await terminalRunOptions()
    const runId = generateRunId()
    const runDir = completedRunDir(terminal.created.agentQaRoot, runId)
    mkdirSync(runDir, { recursive: true })
    writeFileSync(join(runDir, MISDIRECTION_POSTURE_FILE), JSON.stringify({ runId, ...record }))
    expect(terminal.postRun.readMisdirectionRootPosture).toBeTypeOf('function')
    expect(() => terminal.postRun.readMisdirectionRootPosture!(runId)).toThrow(reason)
  })

  it('resolves path segments only through the completed-run slug law', async () => {
    const terminal = await terminalRunOptions()
    const runId = '../../outside'
    // A tempting record ABOVE runs must never be read.
    const outside = join(terminal.created.project, 'outside')
    mkdirSync(outside)
    writeFileSync(join(outside, MISDIRECTION_POSTURE_FILE), JSON.stringify({
      schemaVersion: 1, runId, kind: 'broken-eval-root',
    }))
    expect(terminal.postRun.readMisdirectionRootPosture).toBeTypeOf('function')
    expect(terminal.postRun.readMisdirectionRootPosture!(runId)).toBeUndefined()
    const runDir = completedRunDir(terminal.created.agentQaRoot, runId)
    expect(runDir.startsWith(join(terminal.created.agentQaRoot, 'runs') + '/')).toBe(true)
    mkdirSync(runDir, { recursive: true })
    writeFileSync(join(runDir, MISDIRECTION_POSTURE_FILE), JSON.stringify({
      schemaVersion: 1, runId, kind: 'no-eval-root',
    }))
    expect(terminal.postRun.readMisdirectionRootPosture!(runId)).toBe('no-eval-root')
  })

  it.each(['no-eval-root', 'broken-eval-root', 'unrecorded'] as const)(
    'drains the real analysis queue under %s with honest backing',
    async (posture) => {
      const terminal = await terminalRunOptions()
      if (posture === 'broken-eval-root') {
        writeFileSync(join(terminal.created.project, 'agent-qa-eval'), 'not a directory')
      }
      const runId = generateRunId()
      await driveStep(
        terminal.created, terminal.options.postProcessing!.misdirection!, runId, terminal.host,
      )
      const runDir = completedRunDir(terminal.created.agentQaRoot, runId)
      expect(readMisdirectionRunPosture(runDir, runId)?.kind).toBe(
        posture === 'unrecorded' ? 'no-eval-root' : posture,
      )
      if (posture === 'unrecorded') rmSync(join(runDir, MISDIRECTION_POSTURE_FILE))
      const jobs = await terminal.host.jobs()
      const fence = await jobs.store.adoptEpoch(1)
      const outcome = await jobs.queue.runNextJob({ fence })
      expect(outcome).toMatchObject({ ran: true })
      const artifact = JSON.parse(readFileSync(join(runDir, 'analysis.json'), 'utf8')) as RunAnalysisArtifact
      const verdict = artifact.verdicts[0]!
      expect(verdict.memoryOnPath).toEqual([{ recordId: CANDIDATE, trust: 'candidate' }])
      expect(verdict.class).toBe(posture === 'no-eval-root' ? 'app_bug' : 'unknown')
      expect(verdict.misdirectionRuledOut?.backing).toBe(
        posture === 'no-eval-root' ? 'declared-only' : undefined,
      )
    },
  )
})
