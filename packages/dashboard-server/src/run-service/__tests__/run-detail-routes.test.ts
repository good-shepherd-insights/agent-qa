// THE PHASE 405 TRACER (plan 01, D-01/D-02/D-03/D-14 · DETL-01/DETL-03).
//
// ONE CLAIM, MEASURED END TO END: a decision-screenshot `ArtifactRef` the runner mints reaches a
// browser as a sha, through every layer this phase touches and with no layer faked.
//
//   producer   `projectSubActionRecorded` — the SHIPPED schema fold, called here directly
//   subscriber `createDashboardRunIngest` — the SHIPPED arms, over a real `DashboardDatabase`
//   storage    the v2 `run_sub_actions` row, in a real (in-memory) SQLite file
//   port       `createDashboardRunDetailReader` — the SHIPPED adapter
//   op         `runs.detail` — the SHIPPED spec, reached through the SHIPPED `invokeFunction`
//              on a registry composed by the SHIPPED `createFunctionRegistry`
//   route      `GET /api/runs/:id/detail` on a REAL socket, through `startServer`
//
// WHY THE SOCKET AND NOT THE ADAPTER FUNCTION. Two of the things that can break this path live
// ABOVE the route handler: the arm's POSITION in `routes.ts` — the `/api/runs/:id` catch-all
// below it claims every four-segment GET and answers `Not found`, which is RESEARCH Pitfall 2 —
// and the conditional spread in `server.ts` that threads the host at all. A suite that called
// `serveRunDetailRead` directly would be green with the arm registered in the wrong place, which
// is the "green that never ran" failure WINDOWS names.
//
// WHY A REAL REGISTRY AND NOT A PLANTED HOST. The op is where the token sum is computed, where
// `RunNotFoundError` is minted and where the `runDetail` binding is checked; a fixture that
// answered the route's `invokeFunction` itself would be a second implementation of all three,
// green about a path this product does not ship. `@vostride/agent-qa-agent` is a DEV dependency
// of this package for exactly this reason — `validate:arch` walks `src` with `__tests__` excluded
// and reconciles only runtime `dependencies`, so the production edge it forbids stays forbidden
// (see `run-detail-reader.ts`: the reader declares its own structural port type and imports
// nothing from the agent package).

import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import {
  RUNS_DETAIL_FUNCTION_ID,
  createFunctionRegistry,
  invokeFunction,
  type FunctionDeps,
  type FunctionRegistry,
} from '@vostride/agent-qa-agent'
import {
  projectSubActionRecorded,
  type Action,
  type ArtifactRef,
  type FunctionCaller,
  type RecordedActionResult,
  type RunEventEnvelope,
  type RunEventType,
  type ScreenState,
  type SubActionEvidence,
} from '@vostride/agent-qa-schema'
import { afterEach, describe, expect, it } from 'vitest'

import type { AgentHost, AgentRegistryHandle } from '../../chat/host.js'
import { DashboardDatabase } from '../../db/database.js'
import { createDashboardRunIngest } from '../../reporter/dashboard-subscriber.js'
import { startServer } from '../../server/server.js'
import { createDashboardRunDetailReader } from '../run-detail-reader.js'

/** A 64-hex sha, the shape `FsEvidenceArtifactStore` content-addresses a blob under. */
const DECISION_SHA = 'a'.repeat(63) + '7'
const RUN_ID = 'r_tracer-alpha-bravo-charlie-delta-echo-foxtrot-golf-hotel-india'
const BRIEF_DIGEST = 'brief-digest-405-tracer'

let seq = 0
function ev(type: RunEventType, payload: Record<string, unknown> = {}): RunEventEnvelope {
  seq += 1
  return { seq, ts: seq, runId: 'run-bus-405', type, payload } as RunEventEnvelope
}

function makeScreenState(url: string): ScreenState {
  return {
    platform: 'web',
    tree: 'root',
    elements: [],
    refMap: {},
    url,
    timestamp: 1_700_000_000_000,
    metadata: {
      captureMode: 'textOnly',
      coordSpace: 'viewport',
      viewportWidth: 1280,
      viewportHeight: 720,
      scroll: { offsetX: 0, offsetY: 0, contentWidth: 1280, contentHeight: 2000 },
    },
  }
}

const DECISION_REF: ArtifactRef = {
  id: `decision-screenshot:${DECISION_SHA}`,
  sha: DECISION_SHA,
}

/**
 * The evidence the runner hands the fold — carrying the decision screenshot ref and NOTHING in
 * `artifactRefs`, which is the shipped producer's actual shape (RESEARCH D1: no runner code sets
 * `artifactRefs`, and the decision screenshot was the field that got voided).
 */
function makeSubActionEvidence(): SubActionEvidence {
  return {
    plan: 'Click the Save button',
    plannedAction: { type: 'click', ref: 'e2' } as unknown as Action,
    stateBefore: makeScreenState('https://example.test/before'),
    stateAfter: makeScreenState('https://example.test/after'),
    result: { success: true } as RecordedActionResult,
    decisionScreenshotRef: DECISION_REF,
  }
}

const REGISTRY_CALLER: FunctionCaller = {
  surface: 'dashboard',
  grantedScopes: ['read'],
  safeMode: false,
  origin: 'human',
} as unknown as FunctionCaller

/**
 * The four REQUIRED ports, minimal by construction. None of them is reached by `runs.detail` —
 * they exist because `FunctionDeps` is non-partial on the read ports, which is itself the
 * contract 387 states: a composition that omits one fails to typecheck.
 */
function depsWith(runDetail: FunctionDeps['runDetail']): FunctionDeps {
  return {
    runs: {
      list: () => Promise.resolve([]),
      get: () => Promise.resolve(undefined),
      readEvents: () => Promise.resolve([]),
      readStepEvidence: () => Promise.resolve({ kind: 'run-not-recorded' } as const),
    },
    knowledge: {
      listBundles: () => Promise.resolve([]),
      inspectRecords: () => Promise.resolve([]),
      diffSince: () => Promise.resolve([]),
      showRecord: (input: { recordId: string }) =>
        Promise.resolve({ kind: 'not-found', schemaVersion: 1, recordId: input.recordId } as const),
    },
    entities: {
      resolve: () => Promise.resolve({ kind: 'none' as const, reason: 'no-match' as const }),
      get: () => Promise.resolve(undefined),
    },
    config: {
      getMasked: () => Promise.resolve({
        schemaVersion: 1,
        configPath: 'agent-qa.config.yaml',
        entries: [],
      }),
    },
    ...(runDetail === undefined ? {} : { runDetail }),
  } as unknown as FunctionDeps
}

function composeRegistry(runDetail: FunctionDeps['runDetail']): FunctionRegistry {
  return createFunctionRegistry({
    deps: depsWith(runDetail),
    // Discards every row: this file asserts on the path, never on the audit trail.
    auditSink: { appendExecutionAudit() {}, appendGuardrailAudit() {} },
    resolveExecutionContext: () => 'local-interactive',
  })
}

/**
 * A host whose `invokeFunction` IS the shipped dispatcher over the shipped registry.
 *
 * The op id is supplied as DATA, exactly as the production composition supplies it — this package
 * may not import the agent package outside a test, so a route that spelled the id itself would be
 * a name nothing type-checks against the spec that answers to it.
 */
function hostOver(registry: FunctionRegistry): AgentHost {
  return {
    registry: registry as unknown as AgentRegistryHandle,
    caller: REGISTRY_CALLER,
    agentAskFunctionId: 'test:planted-ask-op',
    runsPostProcessingFunctionId: 'test:planted-post-processing-op',
    runsEventsFunctionId: 'test:planted-events-op',
    runsDetailFunctionId: RUNS_DETAIL_FUNCTION_ID,
    invokeFunction: (
      handle: AgentRegistryHandle,
      functionId: string,
      input: unknown,
      caller: FunctionCaller,
    ): Promise<unknown> =>
      invokeFunction(handle as unknown as FunctionRegistry, functionId, input, caller),
    foldFunctionResult: () => ({ verdict: { status: 'executed', outcome: 'planted' }, foldLines: [] }),
    listDeclarations: () => [],
    onSessionEvent: () => () => undefined,
    unmaskForDisplay: (text: string) => text,
  } as unknown as AgentHost
}

const servers: Server[] = []
const closers: Array<() => void> = []
const databases: DashboardDatabase[] = []

afterEach(async () => {
  while (closers.length > 0) closers.pop()?.()
  while (servers.length > 0) {
    const server = servers.pop()
    await new Promise<void>((closed) => server?.close(() => closed()))
  }
  while (databases.length > 0) databases.pop()?.close()
  seq = 0
})

interface Answer {
  readonly status: number
  readonly body: unknown
  readonly raw: string
}

async function get(port: number, path: string): Promise<Answer> {
  const response = await fetch(`http://127.0.0.1:${String(port)}${path}`)
  const raw = await response.text()
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    body = undefined
  }
  return { status: response.status, body, raw }
}

/**
 * Drive a whole run through the SHIPPED subscriber into a real v2 database, then serve it.
 *
 * `withHost: false` composes the server with no `agentHost` at all — the 503 leg.
 */
async function serveOneRun(options: { withHost?: boolean } = {}): Promise<number> {
  const db = new DashboardDatabase({ dbPath: ':memory:' })
  databases.push(db)

  const ingest = createDashboardRunIngest({
    db,
    sourceSnapshot: { kind: 'test', testId: 't_tracer', name: 'Tracer Test', filePath: 'tests/tracer.yaml', loadStatus: 'loaded' },
    correlationEnv: { runId: RUN_ID },
    now: () => '2026-08-27T00:00:00.000Z',
  })

  // THE SHIPPED FOLD, called with an identity mask exactly as the pre-masking CLI calls it. The
  // payload below is the one the bus would carry — this cell never hand-builds it.
  const subActionPayload = projectSubActionRecorded(
    makeSubActionEvidence(),
    { testIndex: 0, stepIndex: 0, subActionIndex: 0 },
    (text) => text,
  )

  ingest.handler(ev('runStarted', { memberTestCount: 1 }))
  ingest.handler(ev('testStarted', { testId: 't_tracer', testIndex: 0, name: 'Tracer Test', filePath: 'tests/tracer.yaml', totalSteps: 1 }))
  ingest.handler(ev('stepStarted', { testIndex: 0, stepIndex: 0, stepText: 'Save the record' }))
  ingest.handler(ev('subActionRecorded', subActionPayload as unknown as Record<string, unknown>))
  ingest.handler(ev('stepFinalized', {
    testIndex: 0,
    stepIndex: 0,
    cacheStatus: 'miss',
    verifierVerdict: { pass: true, reasoning: 'record saved' },
    selfHealOccurred: false,
    briefDigest: BRIEF_DIGEST,
    status: 'passed',
    durationMs: 120,
  }))
  ingest.handler(ev('testFinished', { testId: 't_tracer', testIndex: 0, outcome: 'passed', durationMs: 400 }))
  ingest.handler(ev('verdict', { verdict: 'passed' }))
  ingest.handler(ev('runFinished', { aggregateVerdict: 'passed', disposition: 'drained', finalSeq: seq }))
  await ingest.finalize()

  const registry = composeRegistry(createDashboardRunDetailReader(db))
  const started = await startServer({
    db,
    port: 0,
    ...(options.withHost === false ? {} : { agentHost: hostOver(registry) }),
  })
  closers.push(started.close)
  return (started.server.address() as AddressInfo).port
}

describe('GET /api/runs/:id/detail — the 405 tracer (D-01/D-03/D-14)', () => {
  it('serves the decision-screenshot artifactRefs sha the producer minted, whole', async () => {
    const port = await serveOneRun()
    const answer = await get(port, `/api/runs/${RUN_ID}/detail`)

    expect(answer.status, answer.raw).toBe(200)
    const body = answer.body as {
      runId: string
      members: Array<{ testIndex: number; attempts: number; outcome?: string; name?: string }>
      steps: Array<{ briefDigest: string; cacheStatus: string; status?: string; stepText?: string; tokenUsage?: unknown }>
      subActions: Array<{ artifactRefs?: Array<{ id: string; sha: string }>; screenStateHash: string; screenStateHashAfter?: string; plan: string }>
      tokens: { measuredSteps: number; unmeasuredSteps: number; totalTokens?: number }
    }

    // THE TRACER'S ONE CLAIM. The sha the fixture minted, read off the wire, unchanged.
    expect(body.subActions).toHaveLength(1)
    expect(body.subActions[0].artifactRefs?.[0].sha, 'the minted sha round-trips whole')
      .toBe(DECISION_SHA)
    expect(body.subActions[0].artifactRefs?.[0].id).toBe(`decision-screenshot:${DECISION_SHA}`)
    expect(body.subActions[0].artifactRefs?.[0].sha).toMatch(/^[0-9a-f]{64}$/)

    // The rest of the payload came through the same rows, unre-interpreted.
    expect(body.runId).toBe(RUN_ID)
    expect(body.steps).toHaveLength(1)
    expect(body.steps[0].briefDigest, 'the served brief digest travels, never the brief').toBe(BRIEF_DIGEST)
    expect(body.steps[0].cacheStatus).toBe('miss')
    expect(body.steps[0].status, "the payload's own word, never toRunStatus").toBe('passed')
    expect(body.steps[0].stepText).toBe('Save the record')
    expect(body.subActions[0].plan).toBe('Click the Save button')
    // D-02/RESEARCH D2: screen CONTEXT on this bus is the hash pair and nothing else.
    expect(body.subActions[0].screenStateHash).toMatch(/^[0-9a-f]{64}$/)
    expect(body.subActions[0].screenStateHashAfter).toMatch(/^[0-9a-f]{64}$/)
    expect(body.subActions[0].screenStateHashAfter).not.toBe(body.subActions[0].screenStateHash)

    // D-01/D-18: the member row exists, keyed by the handle, with its identity and its outcome.
    expect(body.members).toHaveLength(1)
    expect(body.members[0].testIndex).toBe(0)
    expect(body.members[0].name).toBe('Tracer Test')
    expect(body.members[0].outcome).toBe('passed')
    expect(body.members[0].attempts).toBe(1)

    // D-06 — ABSENT IS NOT ZERO. Nothing on this bus carries `tokenUsage` yet (405-04 lands the
    // producer), so the honest answer names how many steps went unmeasured and offers NO total.
    expect(body.tokens.measuredSteps).toBe(0)
    expect(body.tokens.unmeasuredSteps).toBe(1)
    expect(Object.keys(body.tokens), 'no totalTokens key at all — a zero would be a lie')
      .toEqual(['measuredSteps', 'unmeasuredSteps'])
    expect(body.steps[0].tokenUsage).toBeUndefined()
  })

  it('answers 404 unknown_run for a run nothing recorded — the op mints the refusal', async () => {
    const port = await serveOneRun()
    const answer = await get(port, '/api/runs/r_absent-run-nobody-ever-started/detail')
    expect(answer.status, answer.raw).toBe(404)
    expect(answer.body).toEqual({ error: 'unknown_run' })
  })

  it('answers 503 with no agent host — an unbound door says so, it does not read SQLite', async () => {
    const port = await serveOneRun({ withHost: false })
    const answer = await get(port, `/api/runs/${RUN_ID}/detail`)
    expect(answer.status, answer.raw).toBe(503)
    expect(answer.body).toEqual({ error: 'agent_host_unavailable' })
  })

  it('answers 503 agent_host_unavailable when the composition binds no runDetail port', async () => {
    const db = new DashboardDatabase({ dbPath: ':memory:' })
    databases.push(db)
    const started = await startServer({
      db,
      port: 0,
      agentHost: hostOver(composeRegistry(undefined)),
    })
    closers.push(started.close)
    const port = (started.server.address() as AddressInfo).port

    const answer = await get(port, `/api/runs/${RUN_ID}/detail`)
    // The op refuses BY NAME through `FunctionNotBoundError`; the door maps it to 503 and forwards
    // the operator-actionable message rather than answering an empty run.
    expect(answer.status, answer.raw).toBe(503)
    expect((answer.body as { error: string }).error).toBe('agent_host_unavailable')
  })

  it('refuses a run id the op\'s own input schema rejects, before any dispatch (T-405-01)', async () => {
    const port = await serveOneRun()
    // `..` is exactly the segment `slugBranch` would REWRITE, which `runIdSchema` refuses instead.
    const answer = await get(port, '/api/runs/..%2Fescape/detail')
    expect(answer.status, answer.raw).toBe(400)
    expect(answer.body).toEqual({ error: 'invalid_run_id' })
  })
})
