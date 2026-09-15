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

import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createServer, type Server, type ServerResponse } from 'node:http'
import { createHash } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  ANALYSIS_GET_FUNCTION_ID,
  RUNS_ARTIFACT_FUNCTION_ID,
  RUNS_DETAIL_FUNCTION_ID,
  RUNS_EVIDENCE_FUNCTION_ID,
  RUNS_KNOWLEDGE_FUNCTION_ID,
  RUNS_MARK_FUNCTION_ID,
  RUNS_MARK_PREVIEW_FUNCTION_ID,
  RUNS_MARKS_HISTORY_FUNCTION_ID,
  createFunctionRegistry,
  invokeFunction,
  type FunctionDeps,
  type FunctionRegistry,
} from '@vostride/agent-qa-agent'
// 405-05: the SHIPPED evidence-blob binding and the SHIPPED store that wrote the blob. Both are
// DEV-only edges here, on the `@vostride/agent-qa-agent` reasoning at the top of this file —
// `validate:arch` walks `src` with `__tests__` excluded and reconciles only runtime
// `dependencies`, so the production edges these packages forbid stay forbidden. The point of
// driving them is that a reader written in this file would be a second containment rule.
import { createEvidenceBlobReader } from '@vostride/agent-qa-agent-local'
import { FsEvidenceArtifactStore, slugBranch } from '@vostride/agent-qa-runner-local'
import { AUTH_STATE_REDACTION_MARKER } from '@vostride/agent-qa-core'
import {
  RunsMarkPreviewResultSchema,
  RunsMarksHistoryResultSchema,
  maskedMarker,
  projectSubActionRecorded,
  type FeedbackReadsPort,
  type MarkReceipt,
  type RunsMarkInput,
  type RunsMarkPreviewResult,
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
import { serveRunDetailRead } from '../run-detail-routes.js'
import { createRunServiceRoutes, type RunServicePorts } from '../run-service-routes.js'
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
function depsWith(
  runDetail: FunctionDeps['runDetail'],
  evidenceBlobs?: FunctionDeps['evidenceBlobs'],
  feedbackReads?: FeedbackReadsPort,
): FunctionDeps {
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
    ...(evidenceBlobs === undefined ? {} : { evidenceBlobs }),
    ...(feedbackReads === undefined ? {} : { feedbackReads }),
  } as unknown as FunctionDeps
}

function composeRegistry(
  runDetail: FunctionDeps['runDetail'],
  evidenceBlobs?: FunctionDeps['evidenceBlobs'],
  feedbackReads?: FeedbackReadsPort,
): FunctionRegistry {
  return createFunctionRegistry({
    deps: depsWith(runDetail, evidenceBlobs, feedbackReads),
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
    runsEvidenceFunctionId: RUNS_EVIDENCE_FUNCTION_ID,
    runsArtifactFunctionId: RUNS_ARTIFACT_FUNCTION_ID,
    analysisGetFunctionId: ANALYSIS_GET_FUNCTION_ID,
    // 407-01 (D-05): the sixth dispatched id, widened here so every AgentHost literal in the
    // workspace still satisfies the interface.
    runsKnowledgeFunctionId: RUNS_KNOWLEDGE_FUNCTION_ID,
    runsMarkFunctionId: RUNS_MARK_FUNCTION_ID,
    runsMarksHistoryFunctionId: RUNS_MARKS_HISTORY_FUNCTION_ID,
    runsMarkPreviewFunctionId: RUNS_MARK_PREVIEW_FUNCTION_ID,
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
const roots: string[] = []

afterEach(async () => {
  while (roots.length > 0) rmSync(roots.pop() ?? '', { recursive: true, force: true })
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

/** A real PNG head — the magic bytes plus an IHDR-shaped tail, so the sniff is not a one-byte win. */
const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
])
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46])

async function serveEvidence() {
  const root = mkdtempSync(join(tmpdir(), 'agent-qa-423-http-evidence-'))
  roots.push(root)
  const document = { schemaVersion: 1 as const, kind: 'console' as const,
    records: [{ level: 'error', text: '<SECRET_0>', timestamp: 1 }] }
  const ref = new FsEvidenceArtifactStore({ root, runId: RUN_ID }).persistEvidenceDocument(document)
  const db = new DashboardDatabase({ dbPath: ':memory:' })
  databases.push(db)
  db.insertRun({ id: RUN_ID, name: 'Evidence', status: 'passed', duration: 1,
    startedAt: new Date(0).toISOString(), endedAt: new Date(1).toISOString() })
  db.insertRunStep({ runId: RUN_ID, testIndex: 0, stepIndex: 0, cacheStatus: 'miss',
    verifierVerdict: null, selfHealOccurred: false, briefDigest: '', evidence: {
      console: { kind: 'console', state: 'present', ref: ref as never, counts: { total: 1, errors: 1, warnings: 0 } },
      network: { kind: 'network', state: 'absent', reason: 'empty' },
      a11y: { kind: 'a11y', state: 'absent', reason: 'unsupported' },
      variables: { kind: 'variables', state: 'absent', reason: 'not-captured' },
    } })
  const registry = composeRegistry(createDashboardRunDetailReader(db), createEvidenceBlobReader({ agentQaRoot: root }))
  const seen: string[] = []
  const baseHost = hostOver(registry)
  const host: AgentHost = { ...baseHost,
    invokeFunction: (...args) => { seen.push(args[1]); return baseHost.invokeFunction(...args) },
    unmaskForDisplay: (text) => { seen.push('display'); return text },
  }
  const started = await startServer({ db, port: 0, agentHost: host })
  closers.push(started.close)
  const remote = createServer(createRunServiceRoutes({ agentHost: host,
    verifyBearer: header => header === 'Bearer synthetic-evidence-client'
      ? { kind: 'token', clientId: 'test', trustScope: { project: 'test' } }
      : { kind: 'refused', reason: 'invalid_token' },
  } as RunServicePorts))
  servers.push(remote)
  await new Promise<void>(resolve => remote.listen(0, '127.0.0.1', resolve))
  return { seen, registry, ref, document,
    local: `http://127.0.0.1:${(started.server.address() as AddressInfo).port}/api/runs/${RUN_ID}`,
    remote: `http://127.0.0.1:${(remote.address() as AddressInfo).port}/run/${RUN_ID}`,
    headers: { Authorization: 'Bearer synthetic-evidence-client' },
  }
}

describe('423 typed evidence HTTP doors', () => {
  const query = '?kind=console&testIndex=0&stepIndex=0'
  it('HTTP-EVIDENCE-HUMAN reaches the recorded evidence through the public operation', async () => {
    const f = await serveEvidence()
    const response = await fetch(`${f.local}/evidence${query}`)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ outcome: 'ready', evidence: { ref: f.ref }, document: { kind: 'console' } })
    expect(f.seen).toContain(RUNS_EVIDENCE_FUNCTION_ID)
    expect(f.seen).toContain('display')
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
  })
  it('HTTP-EVIDENCE-MACHINE authenticates before dispatch and never restores', async () => {
    const f = await serveEvidence()
    expect((await fetch(`${f.remote}/evidence${query}`)).status).toBe(401)
    expect(f.seen).toEqual([])
    const response = await fetch(`${f.remote}/evidence${query}`, { headers: f.headers })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ outcome: 'ready', document: { kind: 'console' } })
    expect(f.seen).toEqual([RUNS_EVIDENCE_FUNCTION_ID])
  })
  it('CROSS-SITE-REFUSED refuses before invocation or restoration', async () => {
    const f = await serveEvidence()
    const response = await fetch(`${f.local}/evidence${query}`, { headers: {
      Origin: 'https://foreign.test', 'Sec-Fetch-Site': 'cross-site',
    } })
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'cross_site_refused' })
    expect(f.seen).toEqual([])
  })
  it.each(['testIndex=0&stepIndex=0', 'kind=console&testIndex=&stepIndex=0',
    'kind=console&testIndex=1e0&stepIndex=0', 'kind=console&testIndex=-1&stepIndex=0',
    'kind=console&testIndex=0&stepIndex=0&stepIndex=1',
    'kind=console&testIndex=0&stepIndex=0&extra=synthetic-private',
    'kind=console&testIndex=0&stepIndex=0&subActionIndex=0',
    'kind=aria&testIndex=0&stepIndex=0&subActionIndex=1.5',
  ])('HTTP-EVIDENCE-QUERY refuses ambiguous or invalid address %s', async query => {
    const f = await serveEvidence()
    for (const [origin, headers] of [[f.local, {}], [f.remote, f.headers]] as const) {
      const response = await fetch(`${origin}/evidence?${query}`, { headers })
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ error: 'invalid_evidence_input' })
    }
    expect(f.seen).toEqual([])
  })
  it('RAW-SHA-BYTE-IDENTITY/ETAG/304 preserves the stored JSON on both raw doors and runs.artifact', async () => {
    const f = await serveEvidence()
    const bytes = Buffer.from(JSON.stringify(f.document))
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(f.ref.sha)
    for (const [origin, headers] of [[f.local, {}], [f.remote, f.headers]] as const) {
      const url = `${origin}/artifacts/${f.ref.sha}`
      const response = await fetch(url, { headers })
      expect(response.status).toBe(200)
      expect(Buffer.from(await response.arrayBuffer()).equals(bytes)).toBe(true)
      expect(response.headers.get('etag')).toBe(`"${f.ref.sha}"`)
      expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
      const cached = await fetch(url, { headers: { ...headers, 'If-None-Match': `"${f.ref.sha}"` } })
      expect(cached.status).toBe(304)
      expect(await cached.text()).toBe('')
      expect(cached.headers.get('etag')).toBe(`"${f.ref.sha}"`)
    }
    const result = await invokeFunction(f.registry, RUNS_ARTIFACT_FUNCTION_ID,
      { runId: RUN_ID, sha: f.ref.sha }, REGISTRY_CALLER) as { bytesBase64: string }
    expect(Buffer.from(result.bytesBase64, 'base64').equals(bytes)).toBe(true)
    expect(f.seen).not.toContain('display')
  })
})
// ---- 423-21 (D-18): the two feedback reads on both HTTP doors ---------------------------------
//
// The routes format nothing: the registry's own ops answer through a file-backed read port, so the
// HTTP bodies are compared with a direct invocation of the same registry. The real ledger and
// proposals-store host lives in the CLI, whose 423-feedback-reads suite drives these same routes
// over its real stores.

const FEEDBACK_NOTE_SECRET = 'synthetic-423-21-note-token'
const FEEDBACK_AUTH_TOKEN = 'synthetic-423-21-cookie-token'
const FEEDBACK_AUTH_STATE = JSON.stringify({
  cookies: [{ name: 'session', value: FEEDBACK_AUTH_TOKEN, domain: 'app.test', path: '/' }], origins: [],
})
const FIRST_MARK = 'mark_0123456789ab'
const SECOND_MARK = 'mark_0123456789ac'

function feedbackReceipts(): MarkReceipt[] {
  const base = { schemaVersion: 1 as const, runId: RUN_ID as MarkReceipt['runId'], testIndex: 0, runSlug: slugBranch(RUN_ID),
    origin: 'user' as const, gold: [], evidence: { confirmed: 0, overturned: 0 } }
  return [
    { ...base, markId: FIRST_MARK, kind: 'false-fail', ordinal: 1, markedAt: 1, note: `note ${FEEDBACK_NOTE_SECRET}`,
      disposition: { kind: 'drafted', fix: 'fact', proposalId: 'proposal-423-21', proposalKind: 'knowledge' } },
    { ...base, markId: SECOND_MARK, kind: 'confirmed-bug', ordinal: 2, markedAt: 2, supersedes: FIRST_MARK,
      disposition: { kind: 'confirmed-bug', confirmedRecords: 0 } },
  ]
}

function feedbackPreview(runId: string): RunsMarkPreviewResult {
  return RunsMarkPreviewResultSchema.parse({
    kind: 'consequences', runId, prospective: true, markKind: 'false-fail', member: { testIndex: 0 },
    resolvedStep: { stepIndex: 0, reason: 'failing-step' }, latest: { kind: 'supersedes', markId: SECOND_MARK, ordinal: 2 },
    basis: { ledgerOrdinal: 2, priorMarkOrdinal: 2 }, markedDecisionCount: 1,
    groundTruth: [{ testIndex: 0, stepIndex: 0, verdict: 'pass',
      recordedVerdict: { pass: false, reasoning: `timed out near ${FEEDBACK_NOTE_SECRET}` }, correctedAction: false }],
    labels: [{ testIndex: 0, stepIndex: 0, decisionOrdinal: 0, sourceCassetteId: 'cassette-423-21', channel: 'user-mark',
      correction: { verdict: 'pass' } }],
    knowledge: { servedRecordIds: [], appendsEvidence: false, records: [], evidence: { confirmed: 0, overturned: 0 } },
    draft: { kind: 'no-draftable-fix', checked: { servedRecords: 0, procedureReads: 0, assertionDrift: false } },
  })
}

/** A read port over files under `root`: it opens, parses and returns; it never creates or writes. */
function fileFeedbackReads(root: string, calls: string[], options: { withPreview?: boolean } = {}): FeedbackReadsPort {
  const runDir = (runId: string) => join(root, 'runs', slugBranch(runId))
  return {
    history: async (runId) => {
      calls.push('history')
      if (!existsSync(runDir(runId))) return { kind: 'run-not-found' }
      const receipts = JSON.parse(readFileSync(join(runDir(runId), 'marks.json'), 'utf8')) as MarkReceipt[]
      return { kind: 'history', entries: receipts.map(receipt => receipt.disposition.kind === 'drafted'
        ? { receipt, proposal: { state: 'pending' as const, applyInFlight: false } } : { receipt }) }
    },
    ...(options.withPreview === false ? {} : {
      preview: async (input: RunsMarkInput) => {
        calls.push('preview')
        if (!existsSync(runDir(input.runId))) return { kind: 'run-not-found', runId: input.runId }
        return JSON.parse(readFileSync(join(runDir(input.runId), 'preview.json'), 'utf8')) as RunsMarkPreviewResult
      },
    }),
  }
}

function pathMap(root: string): [string, string][] {
  const walk = (path: string): [string, string][] => lstatSync(path).isDirectory()
    ? [[path, 'dir'], ...readdirSync(path).sort().flatMap(name => walk(join(path, name)))]
    : [[path, createHash('sha256').update(readFileSync(path)).digest('hex')]]
  return walk(root)
}

async function serveFeedbackReads(options: { withPreview?: boolean; unbound?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'agent-qa-423-21-feedback-http-'))
  roots.push(root)
  mkdirSync(join(root, 'runs', slugBranch(RUN_ID)), { recursive: true })
  writeFileSync(join(root, 'runs', slugBranch(RUN_ID), 'marks.json'), JSON.stringify(feedbackReceipts()))
  writeFileSync(join(root, 'runs', slugBranch(RUN_ID), 'preview.json'), JSON.stringify(feedbackPreview(RUN_ID)))
  const db = new DashboardDatabase({ dbPath: ':memory:' })
  databases.push(db)
  const portCalls: string[] = []
  const registry = composeRegistry(createDashboardRunDetailReader(db), undefined,
    options.unbound === true ? undefined : fileFeedbackReads(root, portCalls, options))
  const seen: string[] = []
  const baseHost = hostOver(registry)
  const host: AgentHost = { ...baseHost,
    invokeFunction: (...args) => { seen.push(args[1]); return baseHost.invokeFunction(...args) },
    unmaskForDisplay: (text) => { seen.push('display'); return text },
  }
  const started = await startServer({ db, port: 0, agentHost: host })
  closers.push(started.close)
  const remote = createServer(createRunServiceRoutes({ agentHost: host,
    verifyBearer: header => header === 'Bearer synthetic-feedback-client'
      ? { kind: 'token', clientId: 'test', trustScope: { project: 'test' } }
      : { kind: 'refused', reason: 'invalid_token' },
  } as RunServicePorts))
  servers.push(remote)
  await new Promise<void>(resolve => remote.listen(0, '127.0.0.1', resolve))
  return { root, db, registry, seen, portCalls,
    local: `http://127.0.0.1:${(started.server.address() as AddressInfo).port}/api/runs`,
    remote: `http://127.0.0.1:${(remote.address() as AddressInfo).port}/run`,
    headers: { Authorization: 'Bearer synthetic-feedback-client' },
  }
}

/** The same routes on a real socket, with a host that answers a planted masked body and restores it. */
async function serveRestoringFeedbackHost(body: unknown) {
  const db = new DashboardDatabase({ dbPath: ':memory:' })
  databases.push(db)
  const restored: Array<string | undefined> = []
  const host = { ...hostOver(composeRegistry(undefined)),
    invokeFunction: () => Promise.resolve(body),
    unmaskForDisplay: (text: string, scope?: { runId: string }) => {
      restored.push(scope?.runId)
      return text.split('<SECRET_0>').join('restored-note-value').split('<SECRET_1>').join(FEEDBACK_AUTH_STATE)
    },
  } as AgentHost
  const started = await startServer({ db, port: 0, agentHost: host })
  closers.push(started.close)
  const remote = createServer(createRunServiceRoutes({ agentHost: host,
    verifyBearer: () => ({ kind: 'token', clientId: 'test', trustScope: { project: 'test' } }),
  } as unknown as RunServicePorts))
  servers.push(remote)
  await new Promise<void>(resolve => remote.listen(0, '127.0.0.1', resolve))
  return { restored,
    local: `http://127.0.0.1:${(started.server.address() as AddressInfo).port}/api/runs/${RUN_ID}`,
    remote: `http://127.0.0.1:${(remote.address() as AddressInfo).port}/run/${RUN_ID}`,
    headers: { Authorization: 'Bearer any' },
  }
}

const previewInput = (runId: string = RUN_ID): RunsMarkInput =>
  ({ runId: runId as RunsMarkInput['runId'], kind: 'false-fail', note: `preview ${FEEDBACK_NOTE_SECRET}` })

const postJson = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body) })

describe('423-21 feedback reads on both HTTP doors (D-18)', () => {
  it('HTTP-MARKS-HISTORY: both doors answer runs.marks.history exactly as the registry does, guarded and masked', async () => {
    const f = await serveFeedbackReads()
    const expected = await invokeFunction(f.registry, RUNS_MARKS_HISTORY_FUNCTION_ID, { runId: RUN_ID }, REGISTRY_CALLER)
    // A cold registry holds no masking authority for this read, so free text is fully redacted.
    expect(RunsMarksHistoryResultSchema.parse(expected)).toMatchObject({ kind: 'history', entries: [
      { markId: FIRST_MARK, note: maskedMarker('secret'), active: false, supersededBy: SECOND_MARK,
        proposal: { state: 'pending', applyInFlight: false } },
      { markId: SECOND_MARK, active: true, supersedes: FIRST_MARK },
    ] })
    f.seen.length = 0

    const local = await fetch(`${f.local}/${RUN_ID}/marks`)
    expect(local.status).toBe(200)
    expect(local.headers.get('access-control-allow-origin')).toBeNull()
    expect(await local.json()).toEqual(expected)
    expect(f.seen).toEqual([RUNS_MARKS_HISTORY_FUNCTION_ID, ...f.seen.slice(1).map(() => 'display')])

    f.seen.length = 0
    expect((await fetch(`${f.remote}/${RUN_ID}/marks`)).status).toBe(401)
    expect(f.seen).toEqual([])
    const remote = await fetch(`${f.remote}/${RUN_ID}/marks`, { headers: f.headers })
    expect(remote.status).toBe(200)
    expect(await remote.json()).toEqual(expected)
    expect(f.seen, 'the bearer door never restores').toEqual([RUNS_MARKS_HISTORY_FUNCTION_ID])

    // Typed outcomes are results, not transport errors, on both doors.
    const unknownRun = 'r_no-such-run-was-ever-marked-here-at-all'
    const missing = await invokeFunction(f.registry, RUNS_MARKS_HISTORY_FUNCTION_ID, { runId: unknownRun }, REGISTRY_CALLER)
    for (const [origin, headers] of [[f.local, {}], [f.remote, f.headers]] as const) {
      const answer = await fetch(`${origin}/${unknownRun}/marks`, { headers })
      expect(answer.status).toBe(200)
      expect(await answer.json()).toEqual(missing)
    }

    f.seen.length = 0
    const crossSite = await fetch(`${f.local}/${RUN_ID}/marks`, { headers: { Origin: 'https://foreign.test', 'Sec-Fetch-Site': 'cross-site' } })
    expect(crossSite.status).toBe(403)
    expect(await crossSite.json()).toEqual({ error: 'cross_site_refused' })
    for (const [origin, headers] of [[f.local, {}], [f.remote, f.headers]] as const) {
      const extra = await fetch(`${origin}/${RUN_ID}/marks?runId=${RUN_ID}`, { headers })
      expect(extra.status).toBe(400)
      expect(await extra.json()).toEqual({ error: 'invalid_marks_input' })
      const invalid = await fetch(`${origin}/..%2Fescape/marks`, { headers })
      expect(invalid.status).toBe(400)
      expect(await invalid.json()).toEqual({ error: 'invalid_run_id' })
    }
    expect(f.seen, 'refusals precede dispatch').toEqual([])

    const unbound = await serveFeedbackReads({ unbound: true })
    for (const [origin, headers] of [[unbound.local, {}], [unbound.remote, unbound.headers]] as const) {
      const answer = await fetch(`${origin}/${RUN_ID}/marks`, { headers })
      expect(answer.status).toBe(503)
      expect((await answer.json() as { error: string }).error).toBe('agent_host_unavailable')
    }

    // The local human door restores, then sanitizes restored auth state; the bearer door stays masked.
    const history = RunsMarksHistoryResultSchema.parse(expected)
    if (history.kind !== 'history') throw new Error('expected a history result')
    const withNote = (note: string) => ({ ...history, entries: history.entries.map((entry, index) => index === 0 ? { ...entry, note } : entry) })
    const masked = withNote('<SECRET_1>')
    const restoring = await serveRestoringFeedbackHost(masked)
    const human = await fetch(`${restoring.local}/marks`)
    expect(human.status).toBe(200)
    const humanRaw = await human.text()
    expect(JSON.parse(humanRaw)).toEqual(withNote(AUTH_STATE_REDACTION_MARKER))
    expect(humanRaw).not.toContain(FEEDBACK_AUTH_TOKEN)
    expect(restoring.restored.length).toBeGreaterThan(0)
    expect(new Set(restoring.restored)).toEqual(new Set([RUN_ID]))
    restoring.restored.length = 0
    const machine = await fetch(`${restoring.remote}/marks`, { headers: restoring.headers })
    expect(await machine.json()).toEqual(masked)
    expect(restoring.restored).toEqual([])
    const plainNote = await serveRestoringFeedbackHost(withNote('note <SECRET_0>'))
    expect(await (await fetch(`${plainNote.local}/marks`)).json()).toEqual(withNote('note restored-note-value'))
  })

  it('HTTP-MARK-PREVIEW: both doors POST the exact runs.mark input to runs.mark.preview and answer as the registry does', async () => {
    const f = await serveFeedbackReads()
    const expected = await invokeFunction(f.registry, RUNS_MARK_PREVIEW_FUNCTION_ID, previewInput(), REGISTRY_CALLER)
    expect(RunsMarkPreviewResultSchema.parse(expected)).toMatchObject({ kind: 'consequences', prospective: true,
      groundTruth: [{ recordedVerdict: { reasoning: maskedMarker('secret') } }] })
    f.seen.length = 0
    f.portCalls.length = 0

    const local = await postJson(`${f.local}/${RUN_ID}/mark-preview`, previewInput())
    expect(local.status).toBe(200)
    expect(local.headers.get('access-control-allow-origin')).toBeNull()
    expect(await local.json()).toEqual(expected)
    expect(f.seen[0]).toBe(RUNS_MARK_PREVIEW_FUNCTION_ID)
    expect(f.seen).not.toContain(RUNS_MARK_FUNCTION_ID)

    f.seen.length = 0
    expect((await postJson(`${f.remote}/${RUN_ID}/mark-preview`, previewInput())).status).toBe(401)
    expect(f.seen).toEqual([])
    const remote = await postJson(`${f.remote}/${RUN_ID}/mark-preview`, previewInput(), f.headers)
    expect(remote.status).toBe(200)
    expect(await remote.json()).toEqual(expected)
    expect(f.seen).toEqual([RUNS_MARK_PREVIEW_FUNCTION_ID])
    expect(f.portCalls).toEqual(['preview', 'preview'])

    f.seen.length = 0
    const crossSite = await postJson(`${f.local}/${RUN_ID}/mark-preview`, previewInput(),
      { Origin: 'https://foreign.test', 'Sec-Fetch-Site': 'cross-site' })
    expect(crossSite.status).toBe(403)
    expect(await crossSite.json()).toEqual({ error: 'cross_site_refused' })
    const otherRun = 'r_another-run-the-url-does-not-name-at-all-here'
    const { runId: _omitted, ...withoutRunId } = previewInput()
    const refusals: Array<[unknown, string]> = [
      [previewInput(otherRun), 'run_id_mismatch'],
      [withoutRunId, 'invalid_mark_preview_input'],
      [{ ...previewInput(), confirmScope: 'scope-1' }, 'invalid_mark_preview_input'],
      [{ ...previewInput(), basis: { ledgerOrdinal: 2 } }, 'invalid_mark_preview_input'],
      [{ ...previewInput(), kind: 'not-a-mark' }, 'invalid_mark_preview_input'],
      [[previewInput()], 'invalid_mark_preview_input'],
      ['{"runId":', 'invalid_mark_preview_input'],
    ]
    for (const [origin, headers] of [[f.local, {}], [f.remote, f.headers]] as const) {
      for (const [body, error] of refusals) {
        const answer = await postJson(`${origin}/${RUN_ID}/mark-preview`, body, headers)
        expect(answer.status, JSON.stringify(body)).toBe(400)
        expect(await answer.json()).toEqual({ error })
      }
      expect((await fetch(`${origin}/${RUN_ID}/mark-preview`, { headers })).status, 'preview is POST only').not.toBe(200)
    }
    expect(f.seen, 'refusals precede dispatch').toEqual([])

    // Typed refusals are the op's own outcomes and travel as results.
    const unknownRun = 'r_no-such-run-was-ever-marked-here-at-all'
    const missing = await invokeFunction(f.registry, RUNS_MARK_PREVIEW_FUNCTION_ID, previewInput(unknownRun), REGISTRY_CALLER)
    for (const [origin, headers] of [[f.local, {}], [f.remote, f.headers]] as const) {
      const answer = await postJson(`${origin}/${unknownRun}/mark-preview`, previewInput(unknownRun), headers)
      expect(answer.status).toBe(200)
      expect(await answer.json()).toEqual(missing)
    }

    const historyOnly = await serveFeedbackReads({ withPreview: false })
    for (const [origin, headers] of [[historyOnly.local, {}], [historyOnly.remote, historyOnly.headers]] as const) {
      const answer = await postJson(`${origin}/${RUN_ID}/mark-preview`, previewInput(), headers)
      expect(answer.status).toBe(503)
      expect(await answer.json()).toMatchObject({ error: 'agent_host_unavailable' })
    }

    const masked = feedbackPreview(RUN_ID) as Extract<RunsMarkPreviewResult, { kind: 'consequences' }>
    const placeholderBody = { ...masked, groundTruth: [{ ...masked.groundTruth[0]!,
      recordedVerdict: { pass: false, reasoning: 'near <SECRET_0>' }, correctedExpectation: '<SECRET_1>' }] }
    const restoring = await serveRestoringFeedbackHost(placeholderBody)
    const human = await postJson(`${restoring.local}/mark-preview`, previewInput())
    expect(human.status).toBe(200)
    const humanRaw = await human.text()
    expect(JSON.parse(humanRaw)).toMatchObject({ groundTruth: [{ recordedVerdict: { reasoning: 'near restored-note-value' },
      correctedExpectation: AUTH_STATE_REDACTION_MARKER }] })
    expect(humanRaw).not.toContain(FEEDBACK_AUTH_TOKEN)
    restoring.restored.length = 0
    const machine = await postJson(`${restoring.remote}/mark-preview`, previewInput(), restoring.headers)
    expect(await machine.json()).toEqual(placeholderBody)
    expect(restoring.restored).toEqual([])
  })

  it('FEEDBACK-HTTP-WRITES-NOTHING: every feedback HTTP leg leaves the read store and the dashboard rows unchanged', async () => {
    const f = await serveFeedbackReads()
    const before = pathMap(f.root)
    const rowsBefore = JSON.stringify(f.db.readRunDetailRows(RUN_ID))
    for (const [origin, headers] of [[f.local, {}], [f.remote, f.headers]] as const) {
      expect((await fetch(`${origin}/${RUN_ID}/marks`, { headers })).status).toBe(200)
      expect((await postJson(`${origin}/${RUN_ID}/mark-preview`, previewInput(), headers)).status).toBe(200)
      expect((await postJson(`${origin}/${RUN_ID}/mark-preview`, previewInput('r_another-run-the-url-does-not-name-at-all-here'), headers)).status).toBe(400)
      expect((await fetch(`${origin}/r_no-such-run-was-ever-marked-here-at-all/marks`, { headers })).status).toBe(200)
      expect((await postJson(`${origin}/r_no-such-run-was-ever-marked-here-at-all/mark-preview`,
        previewInput('r_no-such-run-was-ever-marked-here-at-all'), headers)).status).toBe(200)
    }
    expect(pathMap(f.root)).toEqual(before)
    expect(existsSync(join(f.root, 'runs', slugBranch('r_no-such-run-was-ever-marked-here-at-all')))).toBe(false)
    expect(JSON.stringify(f.db.readRunDetailRows(RUN_ID))).toBe(rowsBefore)
    expect(f.seen.filter(id => id !== 'display').sort()).toEqual([
      RUNS_MARK_PREVIEW_FUNCTION_ID, RUNS_MARK_PREVIEW_FUNCTION_ID, RUNS_MARK_PREVIEW_FUNCTION_ID, RUNS_MARK_PREVIEW_FUNCTION_ID,
      RUNS_MARKS_HISTORY_FUNCTION_ID, RUNS_MARKS_HISTORY_FUNCTION_ID, RUNS_MARKS_HISTORY_FUNCTION_ID, RUNS_MARKS_HISTORY_FUNCTION_ID,
    ])
    expect(f.seen).not.toContain(RUNS_MARK_FUNCTION_ID)
    expect(f.portCalls.sort()).toEqual(['history', 'history', 'history', 'history', 'preview', 'preview', 'preview', 'preview'])
  })
})

/** Bytes that WANT to be a document. The sniffer has no arm that can grant it (T-405-15). */
const SVG_BYTES = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
)

interface ServedArtifact {
  readonly port: number
  readonly sha: string
  readonly root: string
}

/**
 * Write ONE blob through the shipped store, bind the shipped reader over the same root, serve it.
 *
 * THE STORE MINTS THE SHA, THIS FILE NEVER DOES. `persistDecisionScreenshot` content-addresses the
 * bytes and returns the ref; using its sha is what makes the round trip a claim about the content
 * address rather than about two hex strings that happen to match.
 */
async function serveOneArtifact(
  options: { readonly bytes: Uint8Array; readonly withHost?: boolean },
): Promise<ServedArtifact> {
  const root = mkdtempSync(join(tmpdir(), 'agent-qa-405-05-'))
  roots.push(root)
  const ref = new FsEvidenceArtifactStore({ root, runId: RUN_ID })
    .persistDecisionScreenshot(options.bytes)

  const db = new DashboardDatabase({ dbPath: ':memory:' })
  databases.push(db)
  const registry = composeRegistry(
    createDashboardRunDetailReader(db),
    createEvidenceBlobReader({ agentQaRoot: root }),
  )
  const started = await startServer({
    db,
    port: 0,
    ...(options.withHost === false ? {} : { agentHost: hostOver(registry) }),
  })
  closers.push(started.close)
  return { port: (started.server.address() as AddressInfo).port, sha: ref.sha, root }
}

// ---- 405-05 (D-12/D-13/D-15 · DETL-03): the ref RESOLVES — a sha becomes immutable bytes -------
//
// THE SECOND HALF OF THE TRACER'S CLAIM. The cells above prove a minted `ArtifactRef` reaches a
// browser as a sha; these prove that sha resolves to the exact bytes the runner wrote, with the
// headers a content address earns. Nothing here is faked below the route: the blob is written by
// the SHIPPED `FsEvidenceArtifactStore` under a real temp root, read back by the SHIPPED
// `createEvidenceBlobReader`, served by the SHIPPED op through the SHIPPED registry, over a real
// socket — so the arm's POSITION in `routes.ts` (above the `/api/runs/:id` catch-all, which claims
// every four-segment GET) is inside the claim rather than assumed.
//
// AND THE REFUSALS ARE THE POINT AS MUCH AS THE BYTES. `getBlob` answers `undefined` for a
// malformed sha and for an absent file alike; a door that could not tell those apart would render
// one grey error for a bad link, a GC'd screenshot and a traversal attempt.

describe('GET /api/runs/:runId/artifacts/:sha — the ref resolves (405-05, D-12/D-13/D-15)', () => {
  it('serves the exact bytes under a content address, immutably and with nosniff', async () => {
    const served = await serveOneArtifact({ bytes: PNG_BYTES })
    const response = await fetch(
      `http://127.0.0.1:${String(served.port)}/api/runs/${RUN_ID}/artifacts/${served.sha}`,
    )

    expect(response.status).toBe(200)
    // THE BYTES, WHOLE. Not a length, not a hash of what came back — the array itself.
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG_BYTES)

    // D-12's header set, each one load-bearing and each one asserted rather than sampled.
    expect(response.headers.get('etag'), 'the content address IS the validator').toBe(`"${served.sha}"`)
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(response.headers.get('x-content-type-options'), 'T-405-15').toBe('nosniff')
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(response.headers.get('content-length')).toBe(String(PNG_BYTES.length))
  })

  it('answers 304 for a matching If-None-Match, with no body at all', async () => {
    const served = await serveOneArtifact({ bytes: PNG_BYTES })
    const response = await fetch(
      `http://127.0.0.1:${String(served.port)}/api/runs/${RUN_ID}/artifacts/${served.sha}`,
      { headers: { 'If-None-Match': `"${served.sha}"` } },
    )
    expect(response.status).toBe(304)
    expect(await response.text()).toBe('')
    // The validator still travels, so a cache that revalidates keeps the same entry.
    expect(response.headers.get('etag')).toBe(`"${served.sha}"`)
  })

  it('refuses a malformed sha with a fixed body that never echoes the request (T-405-14/T-405-18)', async () => {
    const served = await serveOneArtifact({ bytes: PNG_BYTES })
    const base = `http://127.0.0.1:${String(served.port)}/api/runs/${RUN_ID}/artifacts`

    // 64 characters and not hex: long enough to look like a sha, refused by the CONTRACT.
    const notHex = 'z'.repeat(64)
    const nonHexAnswer = await fetch(`${base}/${notHex}`)
    expect(nonHexAnswer.status).toBe(400)
    const nonHexBody = await nonHexAnswer.text()
    expect(JSON.parse(nonHexBody)).toEqual({ error: 'malformed_sha' })
    expect(nonHexBody, 'the refusal never quotes the caller\'s own bytes').not.toContain(notHex)

    // A traversal-shaped sha is refused by the SAME regex, before any path could be assembled.
    const traversal = await fetch(`${base}/${encodeURIComponent('../../etc/passwd')}`)
    expect(traversal.status).toBe(400)
    expect(await traversal.json()).toEqual({ error: 'malformed_sha' })

    // An UPPERCASE 64-hex sha names a file the store cannot have written, and is refused as
    // malformed rather than reported as an honest miss.
    const upper = await fetch(`${base}/${served.sha.toUpperCase()}`)
    expect(upper.status).toBe(400)
    expect(await upper.json()).toEqual({ error: 'malformed_sha' })
  })

  it('tells an unknown RUN from an absent BLOB — two 404s, two words (D-15)', async () => {
    const served = await serveOneArtifact({ bytes: PNG_BYTES })
    const origin = `http://127.0.0.1:${String(served.port)}`

    // A well-formed sha under a run this root has no directory for.
    const unknownRun = await fetch(
      `${origin}/api/runs/r_no-such-run-was-ever-started-here-at-all/artifacts/${served.sha}`,
    )
    expect(unknownRun.status).toBe(404)
    expect(await unknownRun.json()).toEqual({ error: 'unknown_run' })

    // A well-formed sha under a run that DOES exist and holds no such blob.
    const absentSha = 'b'.repeat(64)
    const blobAbsent = await fetch(`${origin}/api/runs/${RUN_ID}/artifacts/${absentSha}`)
    expect(blobAbsent.status).toBe(404)
    const absentBody = await blobAbsent.text()
    expect(JSON.parse(absentBody)).toEqual({ error: 'blob_absent' })
    expect(absentBody, 'no refusal on this door echoes the requested sha').not.toContain(absentSha)
  })

  it('answers 503 with no agent host — an unbound door says so, it opens no store', async () => {
    const served = await serveOneArtifact({ bytes: PNG_BYTES, withHost: false })
    const response = await fetch(
      `http://127.0.0.1:${String(served.port)}/api/runs/${RUN_ID}/artifacts/${served.sha}`,
    )
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'agent_host_unavailable' })
  })

  it('refuses a run id the op\'s own input schema rejects, touching no filesystem (T-405-14)', async () => {
    const served = await serveOneArtifact({ bytes: PNG_BYTES })
    const response = await fetch(
      `http://127.0.0.1:${String(served.port)}/api/runs/%2e%2e%2fescape/artifacts/${served.sha}`,
    )
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'invalid_run_id' })

    // AND THE ROOT IS UNTOUCHED. The refusal happens at the contract, so nothing under the runs
    // root was created, read or walked on the way to it — which is the claim a status code alone
    // cannot make.
    expect(readdirSync(join(served.root, 'runs')).sort()).toEqual([slugBranch(RUN_ID)])
  })

  it('serves a JPEG as image/jpeg and an unrecognised blob as an opaque download', async () => {
    const jpeg = await serveOneArtifact({ bytes: JPEG_BYTES })
    const jpegAnswer = await fetch(
      `http://127.0.0.1:${String(jpeg.port)}/api/runs/${RUN_ID}/artifacts/${jpeg.sha}`,
    )
    expect(jpegAnswer.headers.get('content-type')).toBe('image/jpeg')

    // An SVG document is bytes like any other, and it must NEVER be typed as one a browser
    // renders — `nosniff` plus `application/octet-stream` is a download, not a script.
    const svg = await serveOneArtifact({ bytes: SVG_BYTES })
    const svgAnswer = await fetch(
      `http://127.0.0.1:${String(svg.port)}/api/runs/${RUN_ID}/artifacts/${svg.sha}`,
    )
    expect(svgAnswer.headers.get('content-type')).toBe('application/octet-stream')
    expect(svgAnswer.headers.get('x-content-type-options')).toBe('nosniff')
    expect(new Uint8Array(await svgAnswer.arrayBuffer())).toEqual(SVG_BYTES)
  })
})

describe('the artifact arm reads no store of its own (D-13, the fourth-door law)', () => {
  it('routes.ts names the evidence store nowhere — the bytes cross the function layer', async () => {
    const source = await readFile(new URL('../../server/routes.ts', import.meta.url), 'utf8')
    // A SOURCE ASSERTION, because the claim is about where a capability LIVES rather than about
    // what a response contains: a route that constructed the store would serve byte-identical
    // bytes and be invisible to every response-shape cell in this file — while being a private
    // store read no roster row covers and no audit sink sees.
    expect(source).not.toContain('FsEvidenceArtifactStore')
    expect(source).toContain('serveRunArtifact')
  })
})

// ---- 405-10 (D-09): the `boundary` option, and what each of its two values promises -----------
//
// THE DEFAULT IS THE POINT. `serveRunDetailRead` serves BOTH doors — the local one a person's
// browser reads and the authed remote one a bearer token reads — and only the first is a display
// boundary. So restoration is opt-in: a dispatch that says nothing gets the masked projection it
// got before this plan, byte for byte, and the seam is never even consulted. These two cells drive
// the adapter directly rather than through a socket, because the claim is about which VALUE the
// option carries and a socket would add nothing but a port.

/** A `ServerResponse` stand-in that records the one write the adapter makes. */
function recordingResponse(): {
  res: ServerResponse
  status: () => number
  raw: () => string
  done: Promise<void>
} {
  let status = 0
  let raw = ''
  let settle: () => void = () => undefined
  const done = new Promise<void>((resolve) => { settle = resolve })
  const res = {
    headersSent: false,
    writableEnded: false,
    writeHead(code: number): void { status = code },
    end(body?: string): void {
      raw = body ?? ''
      ;(res as { writableEnded: boolean }).writableEnded = true
      settle()
    },
    destroy(): void { settle() },
  } as unknown as ServerResponse
  return { res, status: () => status, raw: () => raw, done }
}

/** A host whose `runs.detail` answers one planted projection, recording every seam call. */
function seamRecordingHost(projection: unknown): {
  host: AgentHost
  calls: Array<{ text: string; runId: string | undefined }>
} {
  const calls: Array<{ text: string; runId: string | undefined }> = []
  return {
    calls,
    host: {
      registry: {} as unknown as AgentRegistryHandle,
      caller: REGISTRY_CALLER,
      agentAskFunctionId: 'test:planted-ask-op',
      runsPostProcessingFunctionId: 'test:planted-post-processing-op',
      runsEventsFunctionId: 'test:planted-events-op',
      runsDetailFunctionId: RUNS_DETAIL_FUNCTION_ID,
      runsArtifactFunctionId: RUNS_ARTIFACT_FUNCTION_ID,
      analysisGetFunctionId: ANALYSIS_GET_FUNCTION_ID,
      // 407-01 (D-05): the sixth dispatched id, widened here so every AgentHost literal in the
      // workspace still satisfies the interface.
      runsKnowledgeFunctionId: RUNS_KNOWLEDGE_FUNCTION_ID,
      invokeFunction: () => Promise.resolve(projection),
      foldFunctionResult: () => ({ verdict: { status: 'executed', outcome: 'planted' }, foldLines: [] }),
      listDeclarations: () => [],
      onSessionEvent: () => () => undefined,
      unmaskForDisplay: (text: string, scope?: { runId: string }): string => {
        calls.push({ text, runId: scope?.runId })
        return text.split('<SECRET_0>').join('sk-restored-value')
      },
    } as unknown as AgentHost,
  }
}

/** A projection shaped like the real one, with a placeholder in every string channel the page reads. */
function maskedProjection(): Record<string, unknown> {
  return {
    runId: RUN_ID,
    members: [{ testIndex: 0, attempts: 1, failureSummary: 'failed near <SECRET_0>' }],
    steps: [{ stepIndex: 0, stepText: 'Navigate to <SECRET_0>', error: 'timeout on <SECRET_0>' }],
    subActions: [{ subActionIndex: 0, plan: 'Type <SECRET_0>', plannedAction: '{"value":"<SECRET_0>"}' }],
    tokens: { measuredSteps: 0, unmeasuredSteps: 1 },
  }
}

describe("serveRunDetailRead's boundary option (405-10, D-09)", () => {
  it("restores every string channel under this run's scope when boundary is 'human'", async () => {
    const { host, calls } = seamRecordingHost(maskedProjection())
    const recorder = recordingResponse()

    // A LOOPBACK HOST, because the human arm now carries the same-site guard (405 CR-01, second
    // pass) and a request that states no Host models no real HTTP/1.1 client.
    serveRunDetailRead(
      { headers: { host: '127.0.0.1:3470' } } as never,
      recorder.res,
      { runId: RUN_ID, host, boundary: 'human' },
    )
    await recorder.done

    expect(recorder.status()).toBe(200)
    expect(recorder.raw()).not.toContain('<SECRET_')
    const body = JSON.parse(recorder.raw()) as ReturnType<typeof maskedProjection>
    expect((body.members as Array<{ failureSummary: string }>)[0].failureSummary)
      .toBe('failed near sk-restored-value')
    const step = (body.steps as Array<{ stepText: string; error: string }>)[0]
    expect(step.stepText).toBe('Navigate to sk-restored-value')
    expect(step.error).toBe('timeout on sk-restored-value')
    const sub = (body.subActions as Array<{ plan: string; plannedAction: string }>)[0]
    expect(sub.plan).toBe('Type sk-restored-value')
    // A JSON-NESTED STRING IS STILL A STRING to the walk, and the restored value lands inside it
    // without the outer body ceasing to parse — which is the Pitfall 3 claim.
    expect(sub.plannedAction).toBe('{"value":"sk-restored-value"}')

    // Every call carried THIS run's scope; none was scope-less.
    expect(calls.length).toBeGreaterThan(0)
    for (const call of calls) expect(call.runId).toBe(RUN_ID)
    // Scalars never crossed the seam.
    expect(calls.map((call) => call.text)).not.toContain('0')
  })

  it('leaves the projection masked and never consults the seam without a boundary (the remote door)', async () => {
    const { host, calls } = seamRecordingHost(maskedProjection())
    const recorder = recordingResponse()

    // NO `boundary` — exactly what `run-service-routes.ts`'s `'detail'` dispatch passes (405-05).
    //
    // AND A DELIBERATELY NON-LOOPBACK HOST. The human arm's same-site guard would refuse this
    // request outright; the remote door is reached at a real hostname and must not inherit a
    // loopback check written for a person's local browser session. A 200 here is the assertion
    // that the guard is gated on `boundary` and not on the function (405 CR-01, second pass).
    serveRunDetailRead(
      { headers: { host: 'runs.example.com' } } as never,
      recorder.res,
      { runId: RUN_ID, host },
    )
    await recorder.done

    expect(recorder.status()).toBe(200)
    expect(recorder.raw()).toContain('<SECRET_0>')
    expect(recorder.raw()).not.toContain('sk-restored-value')
    // Not merely "did not restore" — the host's seam was never called at all.
    expect(calls).toEqual([])
  })
})
