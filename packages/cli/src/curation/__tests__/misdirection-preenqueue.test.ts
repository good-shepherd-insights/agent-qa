// DURABLE BEFORE PUBLISHED (Phase 422 plan 14, D-18 — task 1).
//
// THE CLAIM THIS FILE EXISTS FOR. The circularity arbiter spends provider calls to answer "was
// the served memory the reason this step failed", and the answer has to be part of the bytes the
// FIRST analysis of the run is minted over. So the evidence must reach `handoff.json` BEFORE
// `enqueueAnalyzeRun` loads that document and digests it — not after, and not at curation time,
// which happens only once the analysis it was supposed to back has already run.
//
// THE ORDERING IS PROVEN BY INTERRUPTION, NOT BY READING THE CODE. Two cells kill the process
// between the two halves: one where the evidence cannot be persisted (nothing may be queued), and
// one where the queue itself fails after the evidence landed (the evidence stays, and the retry
// re-publishes it without asking the provider anything a second time). A cell that merely asserted
// "prepare is called before enqueue" would pass on an implementation that lost the evidence on
// every crash, which is the failure this design is for.
//
// THE PROVENANCE BINDING 422-13 HANDED FORWARD IS ASSERTED HERE. 422-13's removal gate proves an
// authorization is internally CONSISTENT and recorded, in its own words, that a caller with total
// control over the object can synthesize a consistent one. The cell `builds every authorization
// from the LOADED handoff` is the other half: the producer takes no authorization from anybody and
// the object the port receives is the loaded document's own member outcome, byte for byte.
//
// NOTHING HERE REACHES A PROVIDER, A SOCKET OR AN EVALUATION ROOT. The arbiter arrives as a PORT
// and every cell substitutes it; the queue arrives through the step's own `composeHost` seam. The
// tracer host reads `handoff.json` off disk at the instant of the enqueue, so "before" is measured
// rather than asserted.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  asRecordId,
  asRef,
  asRunId,
  canonicalJson,
  computeBriefDigest,
  guardCompletedRunHandoff,
  misdirectionSourceDigest,
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

import {
  createPostVerdictStep,
  type PostVerdictStepOperations,
} from '../post-verdict-step.js'
import {
  misdirectionExposures,
  prepareMisdirectionEvidence,
  type MisdirectionArbiterPort,
  type MisdirectionChecked,
  type MisdirectionRootPostureRead,
} from '../misdirection-tail.js'
import {
  readMisdirectionRunState,
  MISDIRECTION_COMPLETIONS_DIR,
  MISDIRECTION_RESERVATIONS_DIR,
} from '../misdirection-run-state.js'

const PRODUCT = 'storefront'
const RUN_ID = 'r_422-14-preenqueue'
const CANDIDATE = asRecordId('rec-candidate-a')
const SECOND = asRecordId('rec-candidate-b')
const CORPUS_DIGEST = 'c'.repeat(64)
const PROFILE_DIGEST = sha256hex('planner|judge')
const EVAL_ROOT: MisdirectionRootPostureRead = {
  kind: 'eval-root',
  corpusDigest: CORPUS_DIGEST,
  profileDigest: PROFILE_DIGEST,
}

const roots: string[] = []
function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'agent-qa-422-14-'))
  roots.push(root)
  return root
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

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

function candidateLine(id: RecordId) {
  return {
    id,
    kind: 'fact',
    summary: `${id} summary`,
    trust: 0.5,
    status: 'candidate',
    servedAsCanary: false,
    tier: 'L1',
  }
}

function activeLine(id: RecordId) {
  return { ...candidateLine(id), status: 'active', trust: 0.9 }
}

function servedBrief(lines: readonly ReturnType<typeof candidateLine>[]): ServedBrief {
  const brief: ServedBrief = {
    scope: { tier: 'product', key: PRODUCT },
    asOfBuild: 7,
    budget: 1_000,
    truncation: 'none',
    channel1: [...lines],
    channel2: [],
    channel3: [],
    briefDigest: '',
  }
  return { ...brief, briefDigest: computeBriefDigest(brief) }
}

function step(stepIndex: number, brief: ServedBrief, pass: boolean): StepEvidence {
  return {
    stepIndex,
    stepText: `Step ${String(stepIndex)}`,
    cacheStatus: 'miss',
    servedBrief: brief,
    subActions: [subAction()],
    verifierVerdict: { pass, reasoning: pass ? 'verified' : 'the checkout never opened' },
  }
}

interface HandoffOptions {
  readonly runId?: string
  readonly steps?: StepEvidence[]
  readonly gateRun?: true
  readonly excludedFromOutcomes?: true
  readonly members?: readonly { testId: string; testIndex: number; steps: StepEvidence[] }[]
}

function handoffValue(options: HandoffOptions = {}): CompletedRunHandoff {
  const members = options.members ?? [
    {
      testId: 'checkout::misdirection',
      testIndex: 0,
      steps: options.steps ?? [step(0, servedBrief([candidateLine(CANDIDATE)]), false)],
    },
  ]
  return guardCompletedRunHandoff({
    schemaVersion: 7,
    runId: asRunId(options.runId ?? RUN_ID),
    scope: { tier: 'product', key: PRODUCT },
    buildOrdinal: 7,
    executionContext: 'local-headless',
    aggregateVerdict: 'failed',
    configDigests: { suiteConfigDigest: 'suite', testConfigDigest: 'test' },
    startedAt: 1_750_000_000_000,
    endedAt: 1_750_000_001_000,
    ...(options.gateRun === undefined ? {} : { gateRun: options.gateRun }),
    ...(options.excludedFromOutcomes === undefined
      ? {}
      : { excludedFromOutcomes: options.excludedFromOutcomes }),
    tests: members.map((member) => ({
      testId: member.testId,
      testName: member.testId,
      filePath: 'checkout.spec.yaml',
      testIndex: member.testIndex,
      outcome: 'failed',
      steps: member.steps,
    })),
  })
}

/** A project on disk with the run's handoff already written, exactly as the runner leaves it. */
function project(options: HandoffOptions = {}) {
  const root = tempRoot()
  const agentQaRoot = join(root, '.agent-qa')
  const handoff = handoffValue(options)
  const runDir = join(agentQaRoot, 'runs', slugBranch(String(handoff.runId)))
  mkdirSync(runDir, { recursive: true })
  const handoffPath = join(runDir, 'handoff.json')
  writeFileSync(handoffPath, `${JSON.stringify(handoff)}\n`, 'utf8')
  return {
    root,
    agentQaRoot,
    configPath: join(root, 'agent-qa.config.yaml'),
    runId: String(handoff.runId),
    runDir,
    handoffPath,
    handoff,
    onDisk: (): CompletedRunHandoff =>
      guardCompletedRunHandoff(JSON.parse(readFileSync(handoffPath, 'utf8'))),
  }
}

interface ArbiterCalls {
  posture: number
  caps: number
  locate: { testId: string; stepIndex: number }[]
  check: {
    recordId: string
    stepIndex: number
    decisionOrdinal: number
    authorization: { recordId: string; runId: string; perTest: unknown }
  }[]
}

function stubArbiter(
  over: {
    posture?: MisdirectionRootPostureRead
    maxChecks?: number
    decisionOrdinal?: number
    locate?: (input: { testId: string; stepIndex: number }) => Promise<unknown>
    check?: (input: { recordId: string }) => Promise<MisdirectionChecked>
  } = {},
): { port: MisdirectionArbiterPort; calls: ArbiterCalls } {
  const calls: ArbiterCalls = { posture: 0, caps: 0, locate: [], check: [] }
  const port: MisdirectionArbiterPort = {
    rootPosture: async () => {
      calls.posture += 1
      return over.posture ?? EVAL_ROOT
    },
    resolveCaps: async () => {
      calls.caps += 1
      return { maxChecks: over.maxChecks ?? 4, source: 'default' }
    },
    locate: async (input) => {
      calls.locate.push({ testId: input.testId, stepIndex: input.stepIndex })
      if (over.locate !== undefined) {
        return (await over.locate(input)) as Awaited<ReturnType<MisdirectionArbiterPort['locate']>>
      }
      return { kind: 'located', decisionOrdinal: over.decisionOrdinal ?? 0 }
    },
    check: async (input) => {
      calls.check.push({
        recordId: input.recordId,
        stepIndex: input.stepIndex,
        decisionOrdinal: input.decisionOrdinal,
        authorization: input.authorization,
      })
      if (over.check !== undefined) return await over.check(input)
      return {
        kind: 'checked',
        crossCheck: 'held',
        seedHonored: true,
        samples: { k: 3, seeds: [11, 12, 13], modelCalls: 5 },
      }
    },
  }
  return { port, calls }
}

/**
 * The enqueue seam, instrumented: it reads `handoff.json` OFF DISK at the instant the row is
 * written, so "the sidecar was already persisted" is a measurement taken from the queue's own
 * position in time rather than a claim about call order.
 */
function tracerHost(handoffPath: string, over: { failJobs?: boolean; deduped?: boolean } = {}) {
  const observed: {
    payloads: Record<string, unknown>[]
    sidecarAtEnqueue: (unknown[] | 'absent')[]
  } = { payloads: [], sidecarAtEnqueue: [] }
  const compose = vi.fn(() => {
    if (over.failJobs === true) {
      return {
        jobs: async () => {
          throw new Error('the durable queue could not be opened')
        },
        close: async () => undefined,
      } as unknown as ReturnType<PostVerdictStepOperations['composeHost']>
    }
    return {
      jobs: async () => ({
        queue: {
          enqueue: async (_kind: string, payload: Record<string, unknown>) => {
            const raw = JSON.parse(readFileSync(handoffPath, 'utf8')) as Record<string, unknown>
            observed.sidecarAtEnqueue.push(
              'misdirectionEvidence' in raw ? (raw.misdirectionEvidence as unknown[]) : 'absent',
            )
            observed.payloads.push(payload)
            return { job: { id: 'job_analyze' }, deduped: over.deduped === true }
          },
        },
      }),
      close: async () => undefined,
    } as unknown as ReturnType<PostVerdictStepOperations['composeHost']>
  })
  return { compose, observed }
}

/** The step, driven over a real run directory with the arbiter substituted at its own port. */
async function runStep(
  fixture: ReturnType<typeof project>,
  arbiter: MisdirectionArbiterPort,
  host: ReturnType<typeof tracerHost>,
  input: { gateRun?: true; excludedFromOutcomes?: true } = {},
) {
  const { port } = createPostVerdictStep({
    runId: fixture.runId,
    agentQaRoot: fixture.agentQaRoot,
    knowledgeRoot: join(fixture.root, 'knowledge'),
    configPath: fixture.configPath,
    misdirection: {
      prepareMisdirectionEvidence: async (prepared) =>
        await prepareMisdirectionEvidence({ ...prepared, arbiter }),
    },
    log: { warn: () => undefined },
    operations: {
      // This legacy queue/lease harness substitutes IO; real ownership is exercised in post-verdict-continuation.test.ts.
      ownContinuation: async ({ initializePolicy, prepare, enqueue }) => { await initializePolicy?.(); await prepare(); return await enqueue() },
      recordCanaryPolicy: async () => undefined,
      readWriterLease: (() => ({ kind: 'absent' })) as unknown as PostVerdictStepOperations['readWriterLease'],
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
      composeHost: host.compose as unknown as PostVerdictStepOperations['composeHost'],
      now: () => 1_750_000_002_000,
    },
  })
  return await port.run({
    ...(input.gateRun === undefined ? {} : { gateRun: input.gateRun }),
    ...(input.excludedFromOutcomes === undefined
      ? {}
      : { excludedFromOutcomes: input.excludedFromOutcomes }),
  } as Parameters<typeof port.run>[0])
}

describe('the arbiter enumerates exactly the exposures a failing path owes (D-18)', () => {
  it('names every low-trust record on the failing step, in member/step/record order', () => {
    const handoff = handoffValue({
      steps: [step(0, servedBrief([candidateLine(SECOND), candidateLine(CANDIDATE)]), false)],
    })
    expect(misdirectionExposures(handoff).map((row) => row.recordId)).toEqual([CANDIDATE, SECOND])
  })

  it('owes nothing for a member whose steps all verified — a passing path is not a failing one', () => {
    const handoff = handoffValue({
      steps: [step(0, servedBrief([candidateLine(CANDIDATE)]), true)],
    })
    expect(misdirectionExposures(handoff)).toEqual([])
  })

  it('owes nothing for an ACTIVE record: the guard is about memory whose trust was not established', () => {
    const handoff = handoffValue({
      steps: [step(0, servedBrief([activeLine(asRecordId('rec-active'))]), false)],
    })
    expect(misdirectionExposures(handoff)).toEqual([])
  })

  it('keeps one record served on TWO failing members as two separate exposures', () => {
    const handoff = handoffValue({
      members: [
        {
          testId: 'a::one',
          testIndex: 0,
          steps: [step(0, servedBrief([candidateLine(CANDIDATE)]), false)],
        },
        {
          testId: 'b::two',
          testIndex: 1,
          steps: [step(3, servedBrief([candidateLine(CANDIDATE)]), false)],
        },
      ],
    })
    expect(misdirectionExposures(handoff).map((row) => [row.perTest, row.stepIndex])).toEqual([
      [0, 0],
      [1, 3],
    ])
  })
})

describe('evidence is durable BEFORE the queue row exists (D-18)', () => {
  it('has already persisted the sidecar when the enqueue writes its row', async () => {
    const fixture = project()
    const { port } = stubArbiter()
    const host = tracerHost(fixture.handoffPath)
    const outcome = await runStep(fixture, port, host)

    expect(outcome.disposition).toBe('drained')
    expect(host.observed.sidecarAtEnqueue).toHaveLength(1)
    const atEnqueue = host.observed.sidecarAtEnqueue[0]!
    expect(atEnqueue).not.toBe('absent')
    expect(atEnqueue as unknown[]).toHaveLength(1)
    expect((atEnqueue as { recordId: string }[])[0]!.recordId).toBe(CANDIDATE)
  })

  it('mints the payload digest over the FINAL handoff bytes, evidence included', async () => {
    const fixture = project()
    const before = misdirectionSourceDigest(fixture.handoff)
    const { port } = stubArbiter()
    const host = tracerHost(fixture.handoffPath)
    await runStep(fixture, port, host)

    const payload = host.observed.payloads[0] as { handoffDigest: string }
    const final = fixture.onDisk()
    expect(final.misdirectionEvidence).toHaveLength(1)
    expect(payload.handoffDigest).toBe(sha256hex(canonicalJson(final)))
    // The digest MOVED because the evidence moved: a payload minted over the pre-arbitration
    // bytes would not cover the rows the analysis is supposed to read.
    expect(payload.handoffDigest).not.toBe(sha256hex(canonicalJson(fixture.handoff)))
    // And the row's own identity is the run's PRE-execution identity, never the final digest —
    // the self-hash cycle 422-11's source digest exists to avoid.
    expect(final.misdirectionEvidence![0]!.handoffBaseDigest).toBe(before)
    expect(final.misdirectionEvidence![0]!.handoffBaseDigest).not.toBe(payload.handoffDigest)
  })

  it('carries the completed per-record rows onto the enqueue payload itself', async () => {
    const fixture = project()
    const { port } = stubArbiter()
    const host = tracerHost(fixture.handoffPath)
    await runStep(fixture, port, host)

    const payload = host.observed.payloads[0] as { misdirectionEvidence?: unknown[] }
    expect(payload.misdirectionEvidence).toEqual(fixture.onDisk().misdirectionEvidence)
    const row = (payload.misdirectionEvidence as { crossCheck: string; samples: unknown }[])[0]!
    expect(row.crossCheck).toBe('held')
    expect(row.samples).toEqual({ k: 3, seeds: [11, 12, 13], modelCalls: 5 })
  })

  it('records the completion durably, under the run directory, before the row is queued', async () => {
    const fixture = project()
    const { port } = stubArbiter()
    const host = tracerHost(fixture.handoffPath)
    await runStep(fixture, port, host)

    const state = readMisdirectionRunState(fixture.runDir, fixture.runId)
    expect(state.completions).toHaveLength(1)
    expect(state.reservations).toHaveLength(1)
    expect(state.interrupted).toEqual([])
    expect(state.policy).toEqual({
      schemaVersion: 1,
      runId: fixture.runId,
      maxChecks: 4,
      source: 'default',
    })
  })
})

describe('the ordering survives interruption between the two halves (D-18)', () => {
  it('queues NOTHING when the evidence could not be persisted', async () => {
    const fixture = project()
    // A FILE where the completions directory has to be: the store cannot publish, and the step
    // must not go on to publish an analysis row over evidence that never reached disk.
    writeFileSync(join(fixture.runDir, MISDIRECTION_COMPLETIONS_DIR), 'not a directory', 'utf8')
    const { port } = stubArbiter()
    const host = tracerHost(fixture.handoffPath)
    const outcome = await runStep(fixture, port, host)

    expect(host.observed.payloads).toEqual([])
    expect(outcome.disposition).toBe('detached')
    expect(outcome.warning?.code).toBe('post-run-enqueue-failed')
  })

  it('keeps the evidence when the QUEUE dies after it, and re-publishes it without re-spending', async () => {
    const fixture = project()
    const { port, calls } = stubArbiter()
    const crashed = tracerHost(fixture.handoffPath, { failJobs: true })
    const first = await runStep(fixture, port, crashed)

    expect(first.disposition).toBe('detached')
    expect(crashed.observed.payloads).toEqual([])
    // The evidence is on disk even though nothing was queued — which is the whole point of
    // writing it first.
    const persisted = fixture.onDisk().misdirectionEvidence
    expect(persisted).toHaveLength(1)
    expect(calls.check).toHaveLength(1)

    // The restart. A fresh step over the same run directory: the arbiter is asked nothing it has
    // already answered, and the row it publishes is the one the first attempt paid for.
    const retried = tracerHost(fixture.handoffPath)
    const second = await runStep(fixture, port, retried)
    expect(second.disposition).toBe('drained')
    expect(calls.check).toHaveLength(1)
    const payload = retried.observed.payloads[0] as { misdirectionEvidence?: unknown[] }
    expect(payload.misdirectionEvidence).toEqual(persisted)
  })
})

describe('a skipped run reaches no store, no root and no provider (D-08)', () => {
  it('creates no evidence and makes zero arbiter calls for a gate run', async () => {
    const fixture = project({ gateRun: true })
    const { port, calls } = stubArbiter()
    const host = tracerHost(fixture.handoffPath)
    const outcome = await runStep(fixture, port, host, { gateRun: true })

    expect(outcome.disposition).toBe('detached')
    expect(outcome.warning).toBeUndefined()
    expect(calls).toEqual({ posture: 0, caps: 0, locate: [], check: [] })
    expect('misdirectionEvidence' in (JSON.parse(readFileSync(fixture.handoffPath, 'utf8')) as object)).toBe(false)
    expect(existsSync(join(fixture.runDir, MISDIRECTION_RESERVATIONS_DIR))).toBe(false)
  })

  it('creates no evidence and makes zero arbiter calls for an outcome-excluded run', async () => {
    const fixture = project({ excludedFromOutcomes: true })
    const { port, calls } = stubArbiter()
    const host = tracerHost(fixture.handoffPath)
    await runStep(fixture, port, host, { excludedFromOutcomes: true })

    expect(calls).toEqual({ posture: 0, caps: 0, locate: [], check: [] })
    expect('misdirectionEvidence' in (JSON.parse(readFileSync(fixture.handoffPath, 'utf8')) as object)).toBe(false)
  })

  it('refuses the producer directly too, so the skip is not merely its caller being careful', async () => {
    const fixture = project({ gateRun: true })
    const { port, calls } = stubArbiter()
    const result = await prepareMisdirectionEvidence({
      agentQaRoot: fixture.agentQaRoot,
      runDir: fixture.runDir,
      handoffPath: fixture.handoffPath,
      handoff: fixture.handoff,
      arbiter: port,
    })
    expect(result).toEqual({ posture: 'not-consulted', rows: [], persisted: false, notices: [] })
    expect(calls).toEqual({ posture: 0, caps: 0, locate: [], check: [] })
  })

  it('leaves the sidecar ABSENT — never empty — for a run with nothing to check', async () => {
    const fixture = project({ steps: [step(0, servedBrief([activeLine(asRecordId('rec-x'))]), false)] })
    const { port, calls } = stubArbiter()
    const host = tracerHost(fixture.handoffPath)
    await runStep(fixture, port, host)

    const raw = JSON.parse(readFileSync(fixture.handoffPath, 'utf8')) as object
    expect('misdirectionEvidence' in raw).toBe(false)
    expect(calls.posture).toBe(0)
    const payload = host.observed.payloads[0] as { misdirectionEvidence?: unknown[] }
    expect('misdirectionEvidence' in payload).toBe(false)
  })
})

describe('the authorization is bound to the loaded handoff, never supplied (422-13 residual)', () => {
  it('builds every authorization from the LOADED handoff member outcome, verbatim', async () => {
    const fixture = project()
    const { port, calls } = stubArbiter()
    const host = tracerHost(fixture.handoffPath)
    await runStep(fixture, port, host)

    expect(calls.check).toHaveLength(1)
    const authorization = calls.check[0]!.authorization
    expect(authorization.runId).toBe(fixture.runId)
    expect(authorization.recordId).toBe(CANDIDATE)
    // The run's own recorded member outcome, as the strict loader produced it — not a
    // reconstruction, and not anything a caller of this producer could have chosen.
    expect(authorization.perTest).toEqual(fixture.onDisk().tests[0])
  })

  it('hands the port the very object the loaded handoff carries, not a reconstruction', async () => {
    const fixture = project()
    const loaded = fixture.onDisk()
    const { port, calls } = stubArbiter()
    await prepareMisdirectionEvidence({
      agentQaRoot: fixture.agentQaRoot,
      runDir: fixture.runDir,
      handoffPath: fixture.handoffPath,
      handoff: loaded,
      arbiter: port,
    })
    // REFERENCE identity, deliberately: a producer that rebuilt the member outcome could rebuild
    // it differently, and 422-13's brief-binding digest refuses any re-serialization that
    // perturbs the served brief. The only safe answer is to pass the loaded object through.
    expect(calls.check[0]!.authorization.perTest).toBe(loaded.tests[0])
  })

  it('cannot be handed an authorization: the producer derives one per exposure it enumerated', async () => {
    const fixture = project({
      steps: [step(0, servedBrief([candidateLine(CANDIDATE), candidateLine(SECOND)]), false)],
    })
    const { port, calls } = stubArbiter()
    await prepareMisdirectionEvidence({
      agentQaRoot: fixture.agentQaRoot,
      runDir: fixture.runDir,
      handoffPath: fixture.handoffPath,
      handoff: fixture.onDisk(),
      arbiter: port,
    })
    // Two exposures, two authorizations, each naming its OWN record and the same loaded member.
    expect(calls.check.map((row) => row.authorization.recordId)).toEqual([CANDIDATE, SECOND])
    expect(calls.check.map((row) => row.recordId)).toEqual([CANDIDATE, SECOND])
    expect(new Set(calls.check.map((row) => row.authorization.perTest)).size).toBe(1)
  })
})
