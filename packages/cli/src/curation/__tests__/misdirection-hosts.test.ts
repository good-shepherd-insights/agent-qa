// BOTH PRODUCTION RUN HOSTS ARBITRATE, AND THEY ARBITRATE IDENTICALLY (422 plan 14, D-18 — task 3).
//
// A CAPABILITY BOUND ON ONE HOST AND FORGOTTEN ON THE OTHER IS THE FAILURE THIS FILE EXISTS FOR.
// The terminal (`composeCliLocalAgent`) and the daemon (`runDaemonHost`) are two ways of running
// the same product; a run dispatched into a daemon and a run started from a terminal must reach
// the same verdict machinery. A circularity guard that ran on one and no-opped on the other would
// not be a smaller feature — it would be a feature whose behaviour depends on which process
// happened to start the run, which no user can see. 422-08's window named exactly this shape with
// all three production hosts, and 422-09 closed its half of it by giving the proposal stage ONE
// construction site.
//
// SO THE PARITY CLAIM IS ASSERTED BY COMPARING THE TWO REAL HOSTS, never by restating a literal
// once per host: two restatements both go green the moment somebody updates both and neither
// binding.
//
// AND PARITY ALONE IS NOT ENOUGH. Two hosts can agree on an object neither of them can use, so the
// capability each host actually composed is then DRIVEN through a real post-verdict step over a
// real run directory, and the sidecar is read off disk at the instant the queue row is written.
// Both hosts' rows are compared against each other for the same reason the key sets are.
//
// NOTHING HERE REACHES A PROVIDER, A SOCKET OR AN EVALUATION ROOT. `runInProcessCliRun` is
// substituted so no run executes; the eval session composition — the single module behind the root
// posture, the decision location and the replay — is substituted at its own exported seam, which
// is the boundary the surface-firewall ledger says only that file may cross.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  asRecordId,
  asRef,
  asRunId,
  computeBriefDigest,
  guardCompletedRunHandoff,
  sha256hex,
  slugBranch,
} from '@vostride/agent-qa-schema'
import type {
  CompletedRunHandoff,
  ElementInfo,
  RecordId,
  ScreenState,
  ServedBrief,
  StepEvidence,
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
    runId: 'r_422-14-hosts',
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
vi.mock('../../eval-session-composition.js', async (original) => {
  const actual = await original<typeof import('../../eval-session-composition.js')>()
  return {
    ...actual,
    resolveEvalSession: vi.fn(),
    readMisdirectionRootPosture: vi.fn(),
    resolveMisdirectionCaps: vi.fn(),
    locateMisdirectionDecision: vi.fn(),
    runMisdirectionCheck: vi.fn(),
  }
})

import { composeLocalAgent, type ComposeLocalAgentInput } from '@vostride/agent-qa-agent-local'
import {
  locateMisdirectionDecision,
  readMisdirectionRootPosture,
  resolveEvalSession,
  resolveMisdirectionCaps,
  runMisdirectionCheck,
} from '../../eval-session-composition.js'

import type { InProcessCliRunExecutionOptions } from '../../composition/in-process-run-execution.js'
import { createInProcessFixture } from '../../composition/__tests__/in-process-run-fixture.js'
import { composeCliLocalAgent } from '../../composition/local-agent-host.js'
import { runDaemonHost, type DaemonHostOperations } from '../../daemon/host.js'
import { createPostVerdictStep, type PostVerdictStepOperations } from '../post-verdict-step.js'
import type { MisdirectionPreparationCapabilities } from '../misdirection-tail.js'

const PRODUCT = 'storefront'
const CANDIDATE = asRecordId('rec-host-candidate')
const CORPUS_DIGEST = 'd'.repeat(64)
const PROFILE_DIGEST = sha256hex('planner|judge|hosts')
const DAEMON_LEASE = { leaseId: 'lease-daemon', epoch: 41 }

const TEST_MODEL: JobModelCapability = {
  modelId: 'test:422-14-misdirection-hosts',
  generate: async () => {
    throw new Error('the arbiter authors nothing')
  },
}
const TEST_CONFIG: ConfigReaderPort = {
  getMasked: async () => ({ schemaVersion: 1, configPath: '/tmp/422-14h.yaml', entries: [] }),
}

const projects: string[] = []

/** The options the LAST host dispatch handed the run drive. */
function driveOptions(): InProcessCliRunExecutionOptions {
  return drive.runInProcessCliRun.mock.calls.at(-1)![0] as InProcessCliRunExecutionOptions
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(resolveEvalSession).mockResolvedValue({
    evalConfig: {},
    configDir: '/tmp/422-14h',
    configPath: '/tmp/422-14h/agent-qa.config.yaml',
  } as unknown as Awaited<ReturnType<typeof resolveEvalSession>>)
  vi.mocked(readMisdirectionRootPosture).mockResolvedValue({
    kind: 'eval-root',
    corpusDigest: CORPUS_DIGEST,
    profileDigest: PROFILE_DIGEST,
  })
  vi.mocked(resolveMisdirectionCaps).mockReturnValue({ maxChecks: 4, source: 'default' })
  vi.mocked(locateMisdirectionDecision).mockResolvedValue({ kind: 'located', decisionOrdinal: 0 })
  vi.mocked(runMisdirectionCheck).mockResolvedValue({
    kind: 'checked',
    crossCheck: 'flipped',
    seedHonored: true,
    samples: { k: 3, seeds: [11, 12, 13], modelCalls: 5 },
  })
})

afterEach(() => {
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
        testId: 'checkout::hosts',
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
  })
  const composed = vi.mocked(composeLocalAgent).mock.calls.at(-1)![0]
  await composed.runExecution!.execute({ patterns: [created.testPattern] } as never)
  await host.close().catch(() => undefined)
  return {
    created,
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
  return { created, options }
}

/**
 * Drive a real post-verdict step over a real run directory with the HOST's own capability, and
 * read `handoff.json` off disk at the instant the queue row is written.
 */
async function driveStep(
  created: ReturnType<typeof fixture>,
  misdirection: MisdirectionPreparationCapabilities,
  runId: string,
) {
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

describe('both production run hosts bind the same preparation seam (D-18)', () => {
  it('composes the same post-processing capability set, compared host against host', async () => {
    const terminal = await terminalRunOptions()
    const daemon = await daemonRunOptions()

    expect(terminal.options.postProcessing).toBeDefined()
    expect(daemon.options.postProcessing).toBeDefined()
    // Against the OTHER HOST, never against a literal: two restatements would both have to be
    // updated to go green, and the regression this guards is somebody updating one place.
    expect(Object.keys(terminal.options.postProcessing!).sort()).toEqual(
      Object.keys(daemon.options.postProcessing!)
        .filter((member) => member !== 'writerAuthority')
        .sort(),
    )
    expect(Object.keys(terminal.options.postProcessing!).sort()).toEqual(['misdirection'])
  })

  it('hands each host a capability with the same member set, from the one builder', async () => {
    const terminal = await terminalRunOptions()
    const daemon = await daemonRunOptions()
    const left = terminal.options.postProcessing!.misdirection!
    const right = daemon.options.postProcessing!.misdirection!
    expect(Object.keys(left).sort()).toEqual(Object.keys(right).sort())
    expect(Object.keys(left).sort()).toEqual(['prepareMisdirectionEvidence'])
  })

  it('keeps the daemon lending its own lease beside the arbiter, not instead of it', async () => {
    const daemon = await daemonRunOptions()
    expect(daemon.options.postProcessing!.writerAuthority).toEqual(DAEMON_LEASE)
    expect(daemon.options.postProcessing!.misdirection).toBeDefined()
  })
})

describe('each host arbitrates before it publishes, and to the same effect (D-18)', () => {
  it('persists the sidecar before the queue row on the TERMINAL host', async () => {
    const terminal = await terminalRunOptions()
    expect(terminal.options.postProcessing?.misdirection).toBeDefined()
    const driven = await driveStep(
      terminal.created,
      terminal.options.postProcessing!.misdirection!,
      'r_422-14-terminal',
    )
    expect(driven.outcome.disposition).toBe('drained')
    expect(driven.observed.sidecarAtEnqueue[0]).not.toBe('absent')
    expect(driven.observed.sidecarAtEnqueue[0] as unknown[]).toHaveLength(1)
  })

  it('persists the sidecar before the queue row on the DAEMON host', async () => {
    const daemon = await daemonRunOptions()
    // Asserted BEFORE the drive: the step falls back to the same builder when no host bound one,
    // so a cell that only drove the capability would go green on a daemon that bound nothing.
    expect(daemon.options.postProcessing?.misdirection).toBeDefined()
    const driven = await driveStep(
      daemon.created,
      daemon.options.postProcessing!.misdirection!,
      'r_422-14-daemon',
    )
    expect(driven.observed.sidecarAtEnqueue[0]).not.toBe('absent')
    expect(driven.observed.sidecarAtEnqueue[0] as unknown[]).toHaveLength(1)
  })

  it('produces identical bound evidence semantics on the two hosts', async () => {
    const terminal = await terminalRunOptions()
    const fromTerminal = await driveStep(
      terminal.created,
      terminal.options.postProcessing!.misdirection!,
      'r_422-14-parity',
    )
    const daemon = await daemonRunOptions()
    const fromDaemon = await driveStep(
      daemon.created,
      daemon.options.postProcessing!.misdirection!,
      'r_422-14-parity',
    )
    // The run identity is the same, the handoff bytes are the same, so every field of the row a
    // host produces must be the same too — including the corpus, profile and brief identities it
    // bound and the cross-check it recorded.
    expect(fromTerminal.handoff().misdirectionEvidence).toEqual(
      fromDaemon.handoff().misdirectionEvidence,
    )
    expect(fromTerminal.handoff().misdirectionEvidence![0]).toMatchObject({
      recordId: CANDIDATE,
      crossCheck: 'flipped',
      corpusDigest: CORPUS_DIGEST,
      profileDigest: PROFILE_DIGEST,
    })
  })

  it('reaches the provider only through the replay seam the eval composition owns', async () => {
    const terminal = await terminalRunOptions()
    await driveStep(
      terminal.created,
      terminal.options.postProcessing!.misdirection!,
      'r_422-14-seam',
    )
    // The ONLY model-bearing call the arbiter makes is `runMisdirectionCheck`, which reaches a
    // provider through `runCassetteReplay`'s own safety scope inside eval-local. No new
    // `createModel` site exists on this path, and the posture and location legs spend nothing.
    expect(vi.mocked(runMisdirectionCheck)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(runMisdirectionCheck).mock.calls[0]![1]).toMatchObject({
      recordId: CANDIDATE,
      stepIndex: 0,
      decisionOrdinal: 0,
    })
  })

  it('produces ONE analysis job and no duplicate spend when the step runs twice', async () => {
    const terminal = await terminalRunOptions()
    const capability = terminal.options.postProcessing!.misdirection!
    const first = await driveStep(terminal.created, capability, 'r_422-14-repeat')
    expect(first.jobs).toBe(1)
    expect(vi.mocked(runMisdirectionCheck)).toHaveBeenCalledTimes(1)

    const second = await driveStep(terminal.created, capability, 'r_422-14-repeat')
    // The same idempotency key, so the store absorbs the second row; and the recorded evidence is
    // re-published rather than re-earned.
    expect(second.observed.payloads[0]!.handoffDigest).toBe(
      first.observed.payloads[0]!.handoffDigest,
    )
    expect(vi.mocked(runMisdirectionCheck)).toHaveBeenCalledTimes(1)
  })
})
