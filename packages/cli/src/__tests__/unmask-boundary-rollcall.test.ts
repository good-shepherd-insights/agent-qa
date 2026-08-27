// SEAM-05 both-sides unmask-boundary ROLL-CALL (Phase 363, Plan 13 — D-12 regression clause).
//
// Decision provenance:
//   D-09 — every projection/sink routes payload strings through the run MaskingContext (placeholders
//          only exist post-seam).
//   D-10 — the masking mechanism is grep-auditable; THIS suite is its behavioral backstop.
//   D-11 — the human terminal is the SOLE unmasking surface (console prose + the ask-tier confirm
//          prompt restore originals); every durable/machine/egress surface stays masked.
//   D-12 — one synthetic fixture drives BOTH directions: human surfaces restore the ORIGINAL secrets,
//          machine/durable surfaces keep only the placeholders.
//   SEAM-05 — this file discharges the requirement's regression-test clause. Permanent; extended,
//          never replaced.
//
// ENROLLMENT RULE (the house roll-call idiom — 345 role-coverage / 356 key-floor / 361 payload
// roll-call): every human OR masked surface is a NAMED registry entry walked exhaustively. A new
// surface that touches run output MUST enrol in exactly one of the two registries AND appear in the
// single `SURFACE_ROLLCALL` union below — the enrollment guard fails on any surface that is walked
// but not enrolled, or enrolled but not walked. New surfaces must enrol to ship.
//
// ONE fixture, both sides (D-12): a single `createMaskingContext()` with five sentinel secrets of
// different shapes is planted — via `ctx.mask(...)` exactly where each sink puts a placeholder — into
// one envelope stream + one handoff + one artifact snapshot + one cache-key input + one provider-egress
// request + one debug-log record + one confirm action. The human registry drives the REAL console
// reporter and the REAL Plan-09 unmasking confirm decorator; the masked registry drives the REAL
// FsEventLog / FsHandoffStore / FsRunArtifactStore ports, the REAL JUnit + wire reporters, the REAL
// masking egress hook, the REAL cache-key floor helpers, and the REAL debug-logging middleware.

import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  createMaskingContext,
  createMaskingProviderRequestHook,
  unmaskForHumanOutput,
} from '@vostride/agent-qa-safety'
import type { ConfirmPort, ProviderRequestParams } from '@vostride/agent-qa-safety'
import { debugLoggingMiddleware } from '@vostride/agent-qa-model'
// 405-10 (D-09): the shipped subscriber, database, detail adapter and BOTH routers. A cell that
// mounted its own would be measuring a door this product does not ship.
import {
  DashboardDatabase,
  createChatRouter,
  createDashboardRunDetailReader,
  createDashboardRunIngest,
  createRouter,
  createRunServiceRoutes,
  recordStreamedEvent,
} from '@vostride/agent-qa-dashboard'
import type { AgentHost, SessionStreamWindow } from '@vostride/agent-qa-dashboard'
// 405-10: the shipped registry and dispatcher — `runs.detail` is where the projection is computed
// and where `RunNotFoundError` is minted, so a fixture that answered it would be a second
// implementation of both. DEV-only edges, on `run-detail-routes.test.ts`'s own reasoning:
// `validate:arch` walks `src` with `__tests__` excluded, so the production firewall stands.
import {
  RUNS_ARTIFACT_FUNCTION_ID,
  RUNS_DETAIL_FUNCTION_ID,
  createFunctionRegistry,
  invokeFunction,
  type FunctionDeps,
  type FunctionRegistry,
} from '@vostride/agent-qa-agent'
import { createEvidenceBlobReader } from '@vostride/agent-qa-agent-local'
import { createServer, request as httpRequest } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { renderClauseResults } from '../commands/result-render.js'
import {
  ARTIFACT_FILE,
  EVENTS_FILE,
  FsEventLog,
  FsEvidenceArtifactStore,
  FsHandoffStore,
  FsRunArtifactStore,
  HANDOFF_FILE,
  RUNS_SUBDIR,
  slugBranch,
} from '@vostride/agent-qa-runner-local'
import {
  computeCacheKey,
  relevantEnvDigest,
  RUN_ARTIFACT_SCHEMA_VERSION,
  RUN_SERVICE_CONTRACT_VERSION,
} from '@vostride/agent-qa-schema'
import type {
  CacheableStepInput,
  ChatSessionEvent,
  ClauseResult,
  CompletedRunHandoff,
  PerTestOutcome,
  RedactedEnvVar,
  RiskActionDescriptor,
  RunArtifactStageInput,
  RunEventEnvelope,
  RunEventType,
  RunFinishedPayload,
  RunId,
  RunStartedPayload,
  ScopeKey,
  ServedBrief,
  StepEvidence,
  StepFinalizedPayload,
  StepStartedPayload,
  TestFinishedPayload,
  TestStartedPayload,
} from '@vostride/agent-qa-schema'

import { createConsoleReporter, createJunitReporter, createWireReporter } from '../reporters/index.js'
import { buildUnmaskingConfirm } from '../run-session-composition.js'

// Any `<SECRET_n>` residue — matches both the raw `<SECRET_0>` and the XML-escaped `&lt;SECRET_0&gt;`.
const PLACEHOLDER = /SECRET_\d+/

// The five sentinel originals, of deliberately different shapes. None contains the substring
// `SECRET_`, so a placeholder-absence assertion can never false-positive on an original.
const SECRETS = {
  step: 'sk-live-URL-000aaa111', // rides a rendered step line
  error: 'sk-live-STEP-222bbb333', // rides a step error / cache input / egress / debug body
  hook: 'hook-pw-444ccc555', // rides a hook variable value + hook stdout
  summary: 'sk-live-SUM-666ddd777', // rides a failureSummary + handoff evidence + artifact snapshot
  confirm: 'sk-live-ASK-888eee999', // rides the ask-tier confirm action name
  // 399.1 (D-04, criterion 3): rides a CHAT clause result — the op-result payload channel
  // `results[]` opened, which is a sink that did not exist when this roll-call was written. An op
  // result is exactly the kind of value a masked configuration read puts a credential into, and
  // this phase made every one of them reach a terminal.
  opResult: 'sk-live-OPR-000fff111',
} as const

const RUN_ID = 'rollcall-run'
const SCOPE: ScopeKey = { tier: 'suite', key: 'auth' }

// The concrete safety context type (register/dispose/clear) the confirm decorator's
// `RunMaskingContext` param requires — the leaner schema `MaskingContext` interface omits them.
type RollCallMaskingContext = ReturnType<typeof createMaskingContext>

interface RollCallFixture {
  ctx: RollCallMaskingContext
  envelopes: RunEventEnvelope[]
  handoff: CompletedRunHandoff
  artifactStage: RunArtifactStageInput
  cacheInput: CacheableStepInput
  egressParams: ProviderRequestParams
  debugResponseBody: string
  confirmActionName: string
  /** One clause result, with its payload masked as the function layer returns it (399.1 D-05). */
  clauseResults: ClauseResult[]
}

/**
 * Build the ONE fixture (D-12). Register all five secrets in a single MaskingContext, then plant each
 * as a placeholder — through `ctx.mask(...)` — exactly where its sink would emit it: the envelope
 * stream (step text, step error, hook variable + stdout, failureSummary), the completed-run handoff
 * (step evidence reasoning), the run artifact (config snapshot + terminal error), the cache-key input
 * (masked step text), the provider-egress request (RAW secret the egress hook masks), the debug-log
 * response body, and the confirm action name (masked; the decorator unmasks it for the human).
 */
function buildRollCallFixture(): RollCallFixture {
  const ctx = createMaskingContext()
  for (const secret of Object.values(SECRETS)) ctx.register(secret)

  // --- one envelope stream --------------------------------------------------------------------
  let seq = 0
  const env = <P>(type: RunEventType, payload: P): RunEventEnvelope =>
    ({ seq: seq++, ts: 1_000 + seq, runId: RUN_ID, type, payload }) as RunEventEnvelope

  const runStarted: RunStartedPayload = {
    busSchemaVersion: 1,
    scope: { tier: 'suite', key: 'auth-suite' },
    executionContext: 'local-headless',
    buildOrdinal: 1,
    configDigests: { suiteConfigDigest: 'aaaa', testConfigDigest: 'bbbb' },
    memberTestCount: 2,
  }

  const test0Started: TestStartedPayload = {
    testId: 't0',
    testIndex: 0,
    name: 'Login test',
    filePath: 'tests/login.yaml',
    suiteId: 'suite-1',
    suiteName: 'Auth',
    suiteIndex: 0,
    suiteTotal: 1,
    totalSteps: 2,
  }

  const okStep: StepFinalizedPayload = {
    testIndex: 0,
    stepIndex: 0,
    cacheStatus: 'miss',
    verifierVerdict: { pass: true, reasoning: 'ok' },
    selfHealOccurred: false,
    briefDigest: 'digest',
    status: 'passed',
    durationMs: 1_200,
  }

  const failedStep: StepFinalizedPayload = {
    testIndex: 0,
    stepIndex: 1,
    cacheStatus: 'miss',
    verifierVerdict: { pass: false, reasoning: 'timeout' },
    selfHealOccurred: false,
    briefDigest: 'digest',
    status: 'failed',
    durationMs: 800,
    error: ctx.mask(`Timeout waiting for token ${SECRETS.error}`),
  }

  const hookFinished = {
    hookName: 'seed-db',
    phase: 'setup',
    hookExecutionId: 'h1',
    scope: 'test',
    status: 'passed',
    durationMs: 300,
    stdout: ctx.mask(`seeded with ${SECRETS.hook}`),
    stderr: '',
    variables: { TOKEN: ctx.mask(SECRETS.hook), REGION: 'us-east-1' },
    kind: 'hook',
  }

  const test0Finished: TestFinishedPayload = { testId: 't0', testIndex: 0, outcome: 'failed', durationMs: 2_000 }

  const test1Started: TestStartedPayload = {
    testId: 't1',
    testIndex: 1,
    name: 'Checkout test',
    filePath: 'tests/checkout.yaml',
    suiteId: 'suite-1',
    suiteName: 'Auth',
    suiteIndex: 0,
    suiteTotal: 1,
    totalSteps: 1,
  }

  const test1FailedStep: StepFinalizedPayload = {
    testIndex: 1,
    stepIndex: 0,
    cacheStatus: 'miss',
    verifierVerdict: { pass: false, reasoning: 'assertion failed' },
    selfHealOccurred: false,
    briefDigest: 'digest',
    status: 'failed',
    durationMs: 1_200,
    error: ctx.mask('Element not found'),
  }

  const test1Finished: TestFinishedPayload = {
    testId: 't1',
    testIndex: 1,
    outcome: 'failed',
    durationMs: 1_500,
    failureSummary: ctx.mask(`Checkout failed near ${SECRETS.summary}`),
  }

  const runFinished: RunFinishedPayload = { aggregateVerdict: 'failed', disposition: 'detached', finalSeq: 0 }

  const envelopes: RunEventEnvelope[] = [
    env('runStarted', runStarted),
    env('testStarted', test0Started),
    // step 0 carries the sentinel in its VISIBLE step text (console step-line surface)
    env('stepStarted', { testIndex: 0, stepIndex: 0, stepText: ctx.mask(`Navigate to ${SECRETS.step}`) } satisfies StepStartedPayload),
    env('stepFinalized', okStep),
    env('stepStarted', { testIndex: 0, stepIndex: 1, stepText: 'Submit credentials' } satisfies StepStartedPayload),
    env('stepFinalized', failedStep),
    env('hookStarted', { hookName: 'seed-db', phase: 'setup', hookExecutionId: 'h1', scope: 'test' }),
    env('hookFinished', hookFinished),
    env('testFinished', test0Finished),
    env('testStarted', test1Started),
    env('stepStarted', { testIndex: 1, stepIndex: 0, stepText: 'Add to cart' } satisfies StepStartedPayload),
    env('stepFinalized', test1FailedStep),
    env('testFinished', test1Finished),
    env('verdict', { verdict: 'failed' }),
    env('runFinished', { ...runFinished, finalSeq: seq }),
  ]

  // --- one completed-run handoff carrying masked step evidence --------------------------------
  const servedBrief: ServedBrief = {
    scope: SCOPE,
    asOfBuild: 1,
    budget: 4_096,
    truncation: 'none',
    channel1: [],
    channel2: [],
    channel3: [],
    briefDigest: 'brief-digest-deadbeef',
  }
  const maskedStep: StepEvidence = {
    stepIndex: 0,
    stepText: ctx.mask(`Save the record ${SECRETS.summary}`),
    cacheStatus: 'miss',
    servedBrief,
    subActions: [],
    verifierVerdict: { pass: false, reasoning: ctx.mask(`failed near ${SECRETS.summary}`) },
  }
  const outcome: PerTestOutcome = {
    testId: 't1',
    testName: 'Test one',
    filePath: 't1.spec.yaml',
    testIndex: 1,
    outcome: 'failed',
    steps: [maskedStep],
  }
  const handoff: CompletedRunHandoff = {
    schemaVersion: 1,
    runId: RUN_ID as unknown as RunId,
    scope: SCOPE,
    buildOrdinal: 1,
    executionContext: 'local-headless',
    aggregateVerdict: 'failed',
    configDigests: { suiteConfigDigest: 'suite-d', testConfigDigest: 'test-d' },
    startedAt: 1_700_000_000_000,
    endedAt: 1_700_000_010_000,
    tests: [outcome],
  }

  // --- one run artifact snapshot (config + terminal error) ------------------------------------
  const artifactStage: RunArtifactStageInput = {
    schemaVersion: RUN_ARTIFACT_SCHEMA_VERSION,
    config: { rawConfigContent: ctx.mask(`base_url: https://app.test\n# token ${SECRETS.summary}`) },
    errors: [{ code: 'RUN_FAILED', message: ctx.mask(`boom ${SECRETS.error}`), phase: 'run' }],
  }

  // --- one cache-key input (356 floor: masked step text + value-free env digest) --------------
  const envVars: RedactedEnvVar[] = [{ name: 'API_KEY', present: true, kind: 'string', lengthBucket: 4 }]
  const cacheInput: CacheableStepInput = {
    platform: 'web',
    suiteConfigDigest: 'suite-digest',
    testConfigDigest: 'test-digest',
    stepText: ctx.mask(`call API with ${SECRETS.error}`),
    stepIndex: 0,
    testIndex: 0,
    relevantEnvDigest: relevantEnvDigest(envVars, 'salt'),
    screenIdentityHash: 'screen-hash',
  }

  // --- one provider-egress request carrying the RAW secret (the hook masks it) ----------------
  const egressParams = {
    prompt: [{ role: 'user', content: [{ type: 'text', text: `use ${SECRETS.error}` }] }],
    temperature: 0.2,
  } as unknown as ProviderRequestParams

  return {
    ctx,
    envelopes,
    handoff,
    artifactStage,
    cacheInput,
    egressParams,
    debugResponseBody: ctx.mask(`{"detail":"rejected ${SECRETS.error}"}`),
    confirmActionName: ctx.mask(`git push to ${SECRETS.confirm}`),
    // MASKED AT THE SOURCE, which is the contract `results[]` carries (D-05, and the 2026-08-20
    // D-10 adjudication's binding corollary): the payload on the turn contract is the placeholder
    // form, so the session log and every `agent.ask` client hold the placeholder and only a
    // surface's own emit restores it.
    clauseResults: [{
      functionId: 'config.auth.set',
      payload: { outcome: 'proposed', token: ctx.mask(SECRETS.opResult) },
    }],
  }
}

const FIXTURE = buildRollCallFixture()
const ALL_ORIGINALS = Object.values(SECRETS)

/** Replay the full envelope stream through the REAL console reporter (the sole unmasking surface). */
function renderConsole(): string {
  const chunks: string[] = []
  const reporter = createConsoleReporter(FIXTURE.ctx, {
    write: (chunk) => void chunks.push(chunk),
    plain: true,
    isTTY: false,
    colorize: false,
    verbose: true,
  })
  for (const envelope of FIXTURE.envelopes) reporter.handler(envelope)
  return chunks.join('')
}

/** Grab only the console lines matching a needle, so each entry pins a distinct surface region. */
function consoleLines(needle: string): string {
  return renderConsole()
    .split('\n')
    .filter((line) => line.includes(needle))
    .join('\n')
}

/**
 * Drive the SHIPPED dashboard chat door over a real socket and return the bytes it answered with.
 *
 * THE FOURTH DOOR'S EMIT IS A NEW HUMAN SURFACE (400-06) and this file's enrollment rule says a
 * surface that touches output must enrol to ship. It is a human surface for a reason that took
 * deciding: the browser cannot be the unmasking boundary, because the masking context lives in the
 * server process and shipping one to a page would mint a cleartext sink in a document, a bfcache
 * entry and a devtools log. So the boundary is this door's response bytes — the same position
 * `emitHuman` occupies for the CLI — and this entry is what holds it there.
 *
 * THE ROUTER IS THE SHIPPED ONE AND THE SOCKET IS REAL. What is supplied rather than composed is
 * the HOST, which is an input to the router and not the thing under test: a full
 * `composeDashboardDoor` here would drag a workspace, a config file and the whole port set into a
 * roll-call cell whose question is one line of transport. The `unmaskForDisplay` it binds is the
 * production binding's SHAPE — one `unmaskForHumanOutput` call per emit — over this file's one
 * fixture context, which is what lets the cell see a restoration at all.
 */
function dashboardRollCallHost(
  onSessionEvent: (listener: (sessionId: string, event: ChatSessionEvent) => void) => void = () => {},
): AgentHost {
  return {
    registry: {},
    caller: { origin: 'human', surface: 'dashboard', scopes: ['read'] } as never,
    agentAskFunctionId: 'agent.ask',
    // 404-05: the seam carries three op ids now. This roll-call fixture dispatches only the ask,
    // so the other two are named and never reached — the shape is what has to be complete.
    runsPostProcessingFunctionId: 'runs.postprocessing',
    runsEventsFunctionId: 'runs.events',
    // 405-01: the seam carries a fourth op id. This fixture dispatches only the ask, so this one
    // is named and never reached — the SHAPE is what has to be complete.
    runsDetailFunctionId: 'runs.detail',
    // 405-05: a fifth. Same posture — the SHAPE has to be complete; this fixture reaches only the
    // ask, and artifact BYTES are masked on every door anyway (D-09: the seam never unmasks a blob).
    runsArtifactFunctionId: 'runs.artifact',
    invokeFunction: () => Promise.resolve({
      sessionId: 'chat-20260821-000000-r0ll',
      turnId: 'turn-1',
      status: 'completed',
      receipts: [],
      results: FIXTURE.clauseResults,
      denials: [],
    }),
    foldFunctionResult: () => ({ verdict: { status: 'executed', outcome: '' }, foldLines: [] }),
    listDeclarations: () => [],
    onSessionEvent: (listener) => { onSessionEvent(listener); return () => {} },
    unmaskForDisplay: (text: string) => unmaskForHumanOutput(FIXTURE.ctx, text),
  }
}

async function renderDashboardChatEmit(): Promise<string> {
  const server = createServer(createChatRouter(dashboardRollCallHost()))
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  try {
    const response = await fetch(`http://127.0.0.1:${String(port)}/api/chat/turn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'what did that op return' }),
    })
    return await response.text()
  } finally {
    await new Promise<void>((done) => server.close(() => { done() }))
  }
}

/**
 * The SAME door's OTHER emit: one frame off the turn-events stream (400-06).
 *
 * A SEPARATE ENTRY BECAUSE IT IS A SEPARATE WRITE. The response body and the SSE frame are two
 * `res.write` sites in `chat-routes.ts` and a boundary applied to one is not applied to the other —
 * measured: deleting the frame's unmask left every other cell in this repository green. The stream
 * is also the channel a person actually watches a turn on, so a placeholder here is the version a
 * user would see first.
 */
async function renderDashboardChatFrame(): Promise<string> {
  let publish: ((sessionId: string, event: ChatSessionEvent) => void) | undefined
  const host = dashboardRollCallHost((listener) => { publish = listener })
  const server = createServer(createChatRouter(host))
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  const sessionId = 'chat-20260821-000000-r0ll'
  // MINT THE SESSION BEFORE CONNECTING (400-13). The events route now serves only sessions this
  // process appended an event for, and this host is synthetic — nothing has driven a turn on it. So
  // the mint is synthetic too: one event of a DIFFERENT kind, before the request, which the replay
  // then carries ahead of the frame this entry is actually about. A `user_message` rather than a
  // second `clause_result`, so the predicate below cannot be satisfied by the primer.
  publish?.(sessionId, {
    kind: 'user_message',
    turnId: 'turn-0',
    at: '2026-08-21T00:00:00.000Z',
    text: 'mint',
  })
  try {
    return await new Promise<string>((settle, fail) => {
      const request = httpRequest({
        host: '127.0.0.1',
        port,
        path: `/api/chat/sessions/${sessionId}/events`,
        method: 'GET',
      }, (response) => {
        let seen = ''
        response.setEncoding('utf8')
        response.on('data', (chunk: string) => {
          seen += chunk
          if (seen.includes('event: clause_result')) {
            request.destroy()
            settle(seen)
          }
        })
        response.on('error', () => { settle(seen) })
        // The subscription is registered synchronously inside the handler, so the first byte of the
        // stream (`:ok`) is the signal that this connection is one the fan-out can reach.
        publish?.(sessionId, {
          kind: 'clause_result',
          turnId: 'turn-1',
          at: '2026-08-21T00:00:00.000Z',
          functionId: 'config.get',
          payload: FIXTURE.clauseResults[0]!.payload,
        })
      })
      request.on('error', fail)
      request.end()
    })
  } finally {
    await new Promise<void>((done) => server.close(() => { done() }))
  }
}


// ---- 405-10 (D-09 · DETL-02): THE DASHBOARD'S RUN READS, BOTH SIDES --------------------------
//
// WHAT THIS BLOCK ADDS AND WHY IT IS NINE ENTRIES RATHER THAN ONE. 400-06 enrolled the fourth
// door's CHAT emits. The run-detail rebuild opened five more human reads on the same door — the
// detail page, the run list, one run's row, its execution logs and its artifact drawer — and every
// one of them serves text a run masked. D-09's claim is that ONE seam is applied at each of them,
// and the enrollment rule below is what stops the sixth from forgetting: a new dashboard read
// route that does not enrol reds the guard.
//
// THE MASKED HALF IS THE OTHER HALF OF THE SAME CLAIM. A seam applied on the way OUT is only safe
// if nothing durable or machine-facing gained cleartext on the way in, so the four masked entries
// scan exactly the sinks a restoration could have leaked into: the SQLite rows the page reads
// from, the run-stream SSE frames a client persists, the authed REMOTE door's detail body (which
// stays masked BY CONSTRUCTION — `serveRunDetailRead`'s `boundary` defaults to machine, 405-05),
// and the artifact bytes, which are never text to begin with.
//
// NOTHING BELOW THE ROUTE IS FAKED. `createDashboardRunIngest` is the shipped subscriber writing a
// real `:memory:` v2 database; `createDashboardRunDetailReader` is the shipped adapter;
// `createFunctionRegistry` + `invokeFunction` are the shipped registry and dispatcher;
// `createRouter` / `createRunServiceRoutes` are the shipped routers, mounted on real sockets. What
// is SUPPLIED is the host's `unmaskForDisplay`, which is `unmaskForHumanOutput(FIXTURE.ctx, text)`
// — the production binding's SHAPE (one call per emitted string) over this file's one fixture, so
// the cell can see a restoration at all without dragging a workspace and a digest sidecar in. The
// seam's own matching mechanism is measured where it lives, in
// `packages/cli/src/composition/__tests__/display-unmask.test.ts`.

/** The bearer this file's remote-door fixture accepts. Never a real credential. */
const ROLLCALL_SERVICE_TOKEN = 'rollcall-service-token'

/** The four REQUIRED read ports, minimal by construction — `runs.detail` reaches none of them. */
function rollCallFunctionDeps(
  runDetail: unknown,
  evidenceBlobs: unknown,
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
    runDetail,
    evidenceBlobs,
  } as unknown as FunctionDeps
}

/**
 * The roll-call host for the RUN reads: the chat host above, with a real registry behind it.
 *
 * `dashboardRollCallHost` answers every dispatch with a planted chat turn, which is right for the
 * chat entries and useless for these — `runs.detail` is where the projection is computed, where
 * the token sum is folded and where `RunNotFoundError` is minted, so a fixture that answered it
 * would be a second implementation of all three. This one DISPATCHES, through the shipped
 * `invokeFunction`, and keeps the same one-call-per-emit `unmaskForDisplay`.
 */
function dashboardRunRollCallHost(registry: FunctionRegistry): AgentHost {
  return {
    ...dashboardRollCallHost(),
    registry: registry as unknown as AgentHost['registry'],
    caller: {
      surface: 'dashboard',
      grantedScopes: ['read'],
      safeMode: false,
      origin: 'human',
    } as unknown as AgentHost['caller'],
    runsDetailFunctionId: RUNS_DETAIL_FUNCTION_ID,
    runsArtifactFunctionId: RUNS_ARTIFACT_FUNCTION_ID,
    invokeFunction: (
      handle: unknown,
      functionId: string,
      input: unknown,
      caller: unknown,
    ): Promise<unknown> =>
      invokeFunction(handle as FunctionRegistry, functionId, input, caller as never),
  } as unknown as AgentHost
}

interface DashboardRunRollCall {
  readonly db: DashboardDatabase
  readonly host: AgentHost
  /** The content address the shipped store minted for the masked blob below. */
  readonly artifactSha: string
  /** The bytes that store holds, as it holds them. */
  readonly artifactBytes: Buffer
}

let dashboardRunRollCallOnce: Promise<DashboardRunRollCall> | undefined

/**
 * Drive THIS FILE'S ONE ENVELOPE STREAM through the shipped subscriber into a real v2 database,
 * write one masked artifact blob through the shipped evidence store, and compose the host both
 * doors dispatch through. Built once and shared by all nine entries — D-12's one-fixture rule.
 */
function dashboardRunRollCall(): Promise<DashboardRunRollCall> {
  dashboardRunRollCallOnce ??= (async (): Promise<DashboardRunRollCall> => {
    const db = new DashboardDatabase({ dbPath: ':memory:' })
    const ingest = createDashboardRunIngest({
      db,
      sourceSnapshot: {
        kind: 'test',
        testId: 't0',
        name: 'Login test',
        filePath: 'tests/login.yaml',
        loadStatus: 'loaded',
      },
      correlationEnv: { runId: RUN_ID },
      now: () => '2026-08-28T00:00:00.000Z',
    })
    for (const envelope of FIXTURE.envelopes) ingest.handler(envelope)
    await ingest.finalize()

    // ONE BLOB, WHOSE BYTES ARE A PNG HEADER FOLLOWED BY MASKED TEXT. A real screenshot has no text
    // to restore, which would make "the bytes were not rewritten" unfalsifiable — so this blob
    // CARRIES a placeholder. The masked-side assertion then has something to see, and the sha
    // comparison inside `render` is the byte-identity claim on top of it.
    const artifactBytes = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from(FIXTURE.ctx.mask(`config token ${SECRETS.summary}`), 'utf8'),
    ])
    const ref = new FsEvidenceArtifactStore({ root: TMP_ROOT, runId: RUN_ID })
      .persistDecisionScreenshot(new Uint8Array(artifactBytes))

    const registry = createFunctionRegistry({
      deps: rollCallFunctionDeps(
        createDashboardRunDetailReader(db),
        createEvidenceBlobReader({ agentQaRoot: TMP_ROOT }),
      ),
      // Discards every row: this file asserts on emitted bytes, never on the audit trail.
      auditSink: { appendExecutionAudit() {}, appendGuardrailAudit() {} },
      resolveExecutionContext: () => 'local-interactive',
    })

    return { db, host: dashboardRunRollCallHost(registry), artifactSha: ref.sha, artifactBytes }
  })()
  return dashboardRunRollCallOnce
}

/** Mount a handler on a real socket, drive one request, return the body, close the socket. */
async function overOneSocket(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
  path: string,
  init: RequestInit = {},
): Promise<string> {
  const server = createServer(handler)
  await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready))
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  try {
    const response = await fetch(`http://127.0.0.1:${String(port)}${path}`, init)
    return await response.text()
  } finally {
    await new Promise<void>((closed) => server.close(() => { closed() }))
  }
}

/**
 * The same, answering BYTES.
 *
 * A binary body cannot travel through `response.text()` and come back whole — a PNG's own header
 * is not valid UTF-8, so the decode substitutes replacement characters and the sha of what comes
 * out is a sha of the decoding rather than of the transfer. The artifact entry's whole claim is
 * byte identity, so it reads the buffer.
 */
async function bytesOverOneSocket(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
  path: string,
): Promise<Buffer> {
  const server = createServer(handler)
  await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready))
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  try {
    const response = await fetch(`http://127.0.0.1:${String(port)}${path}`)
    return Buffer.from(await response.arrayBuffer())
  } finally {
    await new Promise<void>((closed) => server.close(() => { closed() }))
  }
}

/** One LOCAL-door read, over the SHIPPED router with the roll-call host bound. */
async function localDashboardRead(path: string): Promise<string> {
  const fixture = await dashboardRunRollCall()
  return overOneSocket(
    createRouter({ db: fixture.db, agentHost: fixture.host } as never),
    path,
  )
}

/** A planted session that replays THIS FILE'S envelope stream — the run-stream door's input. */
function rollCallRunSession(): unknown {
  return {
    id: RUN_ID,
    status: 'failed',
    executionContext: 'local-headless',
    subscribe(fromSeq: number, handler: (envelope: RunEventEnvelope) => void) {
      for (const envelope of FIXTURE.envelopes) {
        if (envelope.seq >= fromSeq) handler(envelope)
      }
      return () => undefined
    },
    subscribeFrames() { return undefined },
    streamCapabilityOf() { return { kind: 'none' as const } },
    cancel() { /* nothing to cancel on a planted session */ },
    done: Promise.resolve({ verdict: 'failed' }),
  }
}

/** The authed REMOTE door's ports — enough to reach the two READ rows and nothing more. */
async function rollCallServicePorts(): Promise<unknown> {
  const fixture = await dashboardRunRollCall()
  return {
    verifyBearer: (header: string | null | undefined) =>
      header === `Bearer ${ROLLCALL_SERVICE_TOKEN}`
        ? { kind: 'token', clientId: 'rollcall', trustScope: { project: 'rollcall' } }
        : { kind: 'refused', reason: header === undefined ? 'missing_authorization' : 'invalid_token' },
    invokeRunStart: () => Promise.reject(new Error('this fixture starts no runs')),
    attach: (runId: string) => (runId === RUN_ID ? rollCallRunSession() : undefined),
    readiness: () => ({
      service: 'up',
      hostComposed: true,
      authConfigured: true,
      contractVersion: RUN_SERVICE_CONTRACT_VERSION,
    }),
    mintLiveUrl: () => Promise.reject(
      Object.assign(new Error('no live-view port is bound on this fixture'), {
        name: 'LiveViewUnavailableError',
      }),
    ),
    agentHost: fixture.host,
  }
}

// ---- HUMAN registry: surfaces that MUST restore the original secrets (D-11) ------------------

interface HumanSurface {
  name: string
  originals: string[]
  render: () => string | Promise<string>
}

const HUMAN_SURFACES: HumanSurface[] = [
  {
    name: 'console:step-line',
    originals: [SECRETS.step],
    render: () => consoleLines('Navigate to'),
  },
  {
    name: 'console:error-prose',
    originals: [SECRETS.error],
    render: () => consoleLines('Error:'),
  },
  {
    name: 'console:hook-variable',
    originals: [SECRETS.hook],
    render: () => consoleLines('TOKEN='),
  },
  {
    name: 'console:run-summary',
    originals: [SECRETS.summary],
    render: () => consoleLines('Checkout failed near'),
  },
  {
    name: 'confirm:ask-prompt',
    originals: [SECRETS.confirm],
    // Drive the REAL Plan-09 unmasking confirm decorator: the base port receives the UNMASKED name.
    render: async () => {
      const seen: string[] = []
      const base: ConfirmPort = {
        surface: 'tty-prompt',
        ask: (action: RiskActionDescriptor) => {
          seen.push(action.name)
          return false
        },
      }
      const confirm = buildUnmaskingConfirm({ base, maskingContext: FIXTURE.ctx })
      await confirm.ask({ name: FIXTURE.confirmActionName, recognized: true })
      return seen.join('\n')
    },
  },
  {
    // 399.1 (criterion 3): the op-result payload block, on its way to a terminal. Both chat
    // surfaces compose it with `renderClauseResults` and emit it through `unmaskForHumanOutput`,
    // and that composition is what is driven here — a person reading a turn sees the value the op
    // actually returned, restored, exactly as they see a step line restored.
    name: 'chat:clause-results',
    originals: [SECRETS.opResult],
    render: () => unmaskForHumanOutput(
      FIXTURE.ctx,
      renderClauseResults(FIXTURE.clauseResults, FIXTURE.clauseResults.length).join('\n'),
    ),
  },
  {
    // 400-06: the same payload channel, on the fourth door, in the medium a browser reads. The
    // masked value goes in through `invokeFunction` and the restored one has to come out of the
    // socket, or the door is answering a person with a placeholder where a value belongs.
    name: 'dashboard:chat-turn-response',
    originals: [SECRETS.opResult],
    render: renderDashboardChatEmit,
  },
  {
    name: 'dashboard:chat-sse-frame',
    originals: [SECRETS.opResult],
    render: renderDashboardChatFrame,
  },
  {
    // 405-10 (D-09): THE REBUILT PAGE'S ONE DURABLE READ. Members carry the failure summary, steps
    // carry the step text and the step error — three different channels of one projection, so a
    // seam applied to only part of the tree reds here rather than in review.
    name: 'dashboard:run-detail',
    originals: [SECRETS.step, SECRETS.error, SECRETS.summary],
    render: () => localDashboardRead(`/api/runs/${RUN_ID}/detail`),
  },
  {
    // The run LIST. Its rows are a person's first sight of a failure, and the summary on each is
    // exactly where a masked value lands. The seam is applied PER ROW under that row's own id.
    name: 'dashboard:run-list',
    originals: [SECRETS.summary],
    render: () => localDashboardRead('/api/runs'),
  },
  {
    // One run's ROW, on the arm the page reads before the projection arrives.
    name: 'dashboard:run-row',
    originals: [SECRETS.summary],
    render: () => localDashboardRead(`/api/runs/${RUN_ID}`),
  },
  {
    // EXECUTION LOGS — hook stdout, which is the surface a person opens when a run failed in setup.
    // The hook's `variables.TOKEN` is NOT among this entry's originals on purpose: the auth-state
    // redactor removes it after the seam restores it, which is Pitfall 7's order proving itself.
    name: 'dashboard:execution-logs',
    originals: [SECRETS.hook],
    render: () => localDashboardRead(`/api/runs/${RUN_ID}/execution-logs`),
  },
  {
    // THE ARTIFACT DRAWER's JSON — the run row plus the artifact snapshot. The artifact BYTES are a
    // different surface entirely and are enrolled on the masked side, where they belong (D-09).
    name: 'dashboard:artifact-drawer',
    originals: [SECRETS.summary],
    render: () => localDashboardRead(`/api/runs/${RUN_ID}/artifact`),
  },
]

describe('SEAM-05 unmask boundary roll-call — HUMAN side restores originals (D-11/D-12)', () => {
  it.each(HUMAN_SURFACES.map((surface) => [surface.name, surface] as const))(
    'human surface %s restores every original and shows no placeholder',
    async (_name, surface) => {
      const output = await surface.render()
      for (const original of surface.originals) {
        expect(output).toContain(original)
      }
      expect(output).not.toMatch(PLACEHOLDER)
    },
  )

  it('the console reporter is the sole unmasking surface — the whole stream carries zero placeholders', () => {
    const output = renderConsole()
    expect(output).not.toMatch(PLACEHOLDER)
    // `confirm` rides the ask-tier action name and `opResult` rides a chat clause result; neither
    // is in the run envelope stream this reporter replays, so neither could appear here whatever
    // the reporter did. Each is asserted by its OWN roll-call entry above.
    for (const original of ALL_ORIGINALS.filter(
      (secret) => secret !== SECRETS.confirm && secret !== SECRETS.opResult,
    )) {
      expect(output).toContain(original)
    }
  })
})

// ---- MASKED registry: surfaces that MUST keep only placeholders (D-11) -----------------------
//
// Each entry produces the surface's bytes from the SAME fixture and asserts placeholders present
// AND every original absent. Filesystem ports write under one tmp runtime root; the reporters use
// their injected write targets; the egress/cache/debug surfaces call the real helpers directly.

const TMP_ROOT = mkdtempSync(join(tmpdir(), 'unmask-rollcall-'))
const runDir = join(TMP_ROOT, RUNS_SUBDIR, slugBranch(RUN_ID))

interface MaskedSurface {
  name: string
  render: () => string | Promise<string>
}

const MASKED_SURFACES: MaskedSurface[] = [
  {
    // events.jsonl — the durable event log, through the REAL FsEventLog under a tmpdir.
    name: 'durable:events.jsonl',
    render: () => {
      const log = new FsEventLog({ root: TMP_ROOT, runId: RUN_ID })
      for (const envelope of FIXTURE.envelopes) log.append(envelope)
      return readFileSync(join(runDir, EVENTS_FILE), 'utf-8')
    },
  },
  {
    // handoff.json — the completed-run handoff, through the REAL FsHandoffStore.
    name: 'durable:handoff.json',
    render: () => {
      new FsHandoffStore({ root: TMP_ROOT, runId: RUN_ID }).save(FIXTURE.handoff)
      return readFileSync(join(runDir, HANDOFF_FILE), 'utf-8')
    },
  },
  {
    // artifact.json — the run-dir artifact snapshot, through the REAL FsRunArtifactStore.
    name: 'durable:artifact.json',
    render: () => {
      new FsRunArtifactStore({ root: TMP_ROOT, runId: RUN_ID }).stage(FIXTURE.artifactStage)
      return readFileSync(join(runDir, ARTIFACT_FILE), 'utf-8')
    },
  },
  {
    // JUnit XML — the CI-archived masked artifact, through the REAL junit reporter's flush.
    name: 'durable:junit-xml',
    render: async () => {
      let xml = ''
      const junit = createJunitReporter({
        outputPath: '/unused/report.xml',
        write: async (_path, content) => {
          xml = content
        },
      })
      for (const envelope of FIXTURE.envelopes) junit.handler(envelope)
      await junit.flush()
      return xml
    },
  },
  {
    // stdout wire — the spawn/CI-captured verbatim envelope stream, through the REAL wire reporter.
    name: 'machine:stdout-wire',
    render: () => {
      const previous = process.env.AGENT_QA_LIVE_EVENTS
      process.env.AGENT_QA_LIVE_EVENTS = 'true'
      try {
        const chunks: string[] = []
        const wire = createWireReporter({ write: (chunk) => void chunks.push(chunk) })
        for (const envelope of FIXTURE.envelopes) wire.handler(envelope)
        return chunks.join('')
      } finally {
        if (previous === undefined) delete process.env.AGENT_QA_LIVE_EVENTS
        else process.env.AGENT_QA_LIVE_EVENTS = previous
      }
    },
  },
  {
    // debug log — the RUNX-04 middleware error surface, driven through the REAL middleware.
    name: 'machine:debug-log',
    render: async () => {
      const lines: string[] = []
      const middleware = debugLoggingMiddleware({ enabled: true, sink: (line) => void lines.push(line) })
      const wrapGenerate = middleware.wrapGenerate
      if (!wrapGenerate) throw new Error('debug middleware must expose wrapGenerate when enabled')
      const params = {
        prompt: [{ role: 'user', content: [{ type: 'text', text: FIXTURE.egressParams.prompt[0] ? 'shape-only' : 'x' }] }],
      }
      try {
        await wrapGenerate({
          doGenerate: async () => {
            throw { statusCode: 400, url: 'https://provider.test', responseBody: FIXTURE.debugResponseBody }
          },
          params,
          model: { modelId: 'test-model' },
        } as never)
      } catch {
        // the middleware re-throws after logging — expected
      }
      return lines.join('\n')
    },
  },
  {
    // cache key material — the 356 masked-input floor, through the REAL computeCacheKey helpers.
    name: 'machine:cache-key-material',
    render: () => {
      // The key hash must be stable from the masked input and must not embed the raw secret.
      const key = computeCacheKey(FIXTURE.cacheInput)
      expect(key).not.toContain(SECRETS.error)
      return JSON.stringify(FIXTURE.cacheInput)
    },
  },
  {
    // provider egress — the 362-07 proof idiom, through the REAL masking egress hook.
    name: 'machine:provider-egress',
    render: () => {
      const hook = createMaskingProviderRequestHook(() => FIXTURE.ctx)
      return JSON.stringify(hook(FIXTURE.egressParams))
    },
  },
  {
    // 399.1 (criterion 3): THE SAME RENDER, WITHOUT THE SURFACE'S EMIT — and this pairing is the
    // whole point. The human entry above proves the payload reaches a person restored; this one
    // proves the render module is not what restored it. `renderClauseResults` is where a shortcut
    // would be tempting and invisible: a module that unmasked for itself would satisfy every
    // rendering assertion in this repository while handing its caller a cleartext string that the
    // session log, the `agent.ask` clients and the persistence seam would then carry.
    name: 'machine:chat-clause-results',
    render: () => renderClauseResults(FIXTURE.clauseResults, FIXTURE.clauseResults.length).join('\n'),
  },
  {
    // 400-06: THE DOOR'S IN-MEMORY REPLAY WINDOW, which is the pairing the human entry above needs.
    // The turn response restores, so the tempting shortcut is to unmask on the way IN — at the
    // point events are recorded — which would satisfy every rendering assertion while turning the
    // server's reconnect buffer into a cleartext store that outlives the request. `recordStreamedEvent`
    // is the shipped recorder and what it holds is what a reconnect replays.
    name: 'machine:dashboard-chat-replay-window',
    render: () => {
      const windows = new Map<string, SessionStreamWindow>()
      recordStreamedEvent(windows, 'chat-20260821-000000-r0ll', {
        kind: 'clause_result',
        turnId: 'turn-1',
        at: '2026-08-21T00:00:00.000Z',
        functionId: 'config.get',
        payload: FIXTURE.clauseResults[0]!.payload,
      })
      return JSON.stringify([...windows.values()])
    },
  },
  {
    // 405-10 (D-09): THE ROWS THE PAGE READS FROM. This is the pairing every human dashboard entry
    // above needs: those five restore, so the tempting shortcut is to unmask on the way IN — at
    // ingest — which would satisfy every response assertion in this file while turning the
    // dashboard database into a cleartext store that outlives the request, survives a backup and
    // is read by every other query in the product. The four run-shaped tables are dumped whole.
    name: 'durable:dashboard-sqlite-rows',
    render: async () => {
      const fixture = await dashboardRunRollCall()
      // The raw handle, deliberately: the claim is about what is IN the columns, and every typed
      // reader is a projection that could hide a column the claim ranges over.
      const raw = (fixture.db as unknown as {
        db: { prepare(query: string): { all(): unknown[] } }
      }).db
      return JSON.stringify(
        ['runs', 'run_members', 'run_steps', 'run_sub_actions', 'execution_logs']
          .map((table) => raw.prepare(`SELECT * FROM ${table}`).all()),
      )
    },
  },
  {
    // THE RUN-STREAM SSE. A machine wire whose consumer is its own display boundary, and the
    // channel a client persists — a frame that carried a restored value would put a credential in
    // whatever buffered it. The SHIPPED local router serves it over a real socket.
    name: 'machine:run-stream-sse',
    render: async () => {
      const fixture = await dashboardRunRollCall()
      return overOneSocket(
        createRouter({
          db: fixture.db,
          agentHost: fixture.host,
          runServiceAttach: (runId: string) =>
            (runId === RUN_ID ? rollCallRunSession() : undefined),
        } as never),
        `/api/run-stream/${RUN_ID}`,
      )
    },
  },
  {
    // THE AUTHED REMOTE DOOR'S DETAIL BODY, which stays masked BY CONSTRUCTION (405-05's recorded
    // decision): the remote dispatch calls `serveRunDetailRead` with no `boundary`, and the option
    // defaults to `'machine'`. A bearer token authenticates a CLIENT, not a person's browser
    // session, so restoring there would hand declared secrets to every token holder and every
    // intermediary. THIS ENTRY IS WHERE THAT DECISION IS HELD: adding `boundary: 'human'` to that
    // dispatch reds it, which is exactly the review the reversal deserves.
    name: 'machine:remote-run-detail',
    render: async () => {
      const ports = await rollCallServicePorts()
      return overOneSocket(
        createRunServiceRoutes(ports as never),
        `/run/${RUN_ID}/detail`,
        { headers: { Authorization: `Bearer ${ROLLCALL_SERVICE_TOKEN}` } },
      )
    },
  },
  {
    // ARTIFACT BYTES — served exactly as stored, on every door (D-09: the seam never unmasks a
    // blob). The blob this fixture wrote carries a placeholder so the masked assertion has
    // something to see; the sha comparison INSIDE this render is the byte-identity claim, and it
    // is made against the address the SHIPPED store minted rather than against two hex strings
    // this file chose.
    name: 'machine:artifact-bytes',
    render: async () => {
      const fixture = await dashboardRunRollCall()
      const servedBytes = await bytesOverOneSocket(
        createRouter({ db: fixture.db, agentHost: fixture.host } as never),
        `/api/runs/${RUN_ID}/artifacts/${fixture.artifactSha}`,
      )
      expect(createHash('sha256').update(servedBytes).digest('hex'), 'bytes served === bytes stored')
        .toBe(fixture.artifactSha)
      expect(servedBytes.equals(fixture.artifactBytes)).toBe(true)
      // `latin1` is a byte-for-byte decoding, so the placeholder-present / original-absent scan the
      // masked registry runs over this string is a scan of the BYTES rather than of a re-encoding.
      return servedBytes.toString('latin1')
    },
  },
]

describe('SEAM-05 unmask boundary roll-call — MASKED side keeps placeholders (D-11/D-12)', () => {
  it.each(MASKED_SURFACES.map((surface) => [surface.name, surface] as const))(
    'masked surface %s keeps placeholders and leaks no original',
    async (_name, surface) => {
      const output = await surface.render()
      expect(output).toMatch(PLACEHOLDER)
      for (const original of ALL_ORIGINALS) {
        expect(output).not.toContain(original)
      }
    },
  )
})

// ---- Enrollment guard: the roll-call union (T-363-31) ---------------------------------------
//
// The single source of truth for what is walked. A surface added to either registry without being
// listed here (or listed here without a walking entry) fails this test — new surfaces MUST enrol.
const SURFACE_ROLLCALL = [
  'console:step-line',
  'console:error-prose',
  'console:hook-variable',
  'console:run-summary',
  'confirm:ask-prompt',
  'durable:events.jsonl',
  'durable:handoff.json',
  'durable:artifact.json',
  'durable:junit-xml',
  'machine:stdout-wire',
  'machine:debug-log',
  'machine:cache-key-material',
  'machine:provider-egress',
  'chat:clause-results',
  'machine:chat-clause-results',
  'dashboard:chat-turn-response',
  'dashboard:chat-sse-frame',
  'machine:dashboard-chat-replay-window',
  // 405-10 (D-09): the dashboard's five human RUN reads and the four surfaces that must stay masked.
  'dashboard:run-detail',
  'dashboard:run-list',
  'dashboard:run-row',
  'dashboard:execution-logs',
  'dashboard:artifact-drawer',
  'durable:dashboard-sqlite-rows',
  'machine:run-stream-sse',
  'machine:remote-run-detail',
  'machine:artifact-bytes',
] as const

describe('SEAM-05 unmask boundary roll-call — enrollment guard (T-363-31)', () => {
  it('every walked surface is enrolled in the SURFACE_ROLLCALL union exactly once', () => {
    const walked = [...HUMAN_SURFACES.map((s) => s.name), ...MASKED_SURFACES.map((s) => s.name)]
    // No name collides across the two registries.
    expect(new Set(walked).size).toBe(walked.length)
    // The walked union is exactly the declared roll-call — a new unenrolled surface fails here.
    expect([...walked].sort()).toEqual([...SURFACE_ROLLCALL].sort())
  })

  it('both sides derive from ONE fixture (single MaskingContext, single envelope stream)', () => {
    // Every masked-side envelope surface and every human-side surface reads the same FIXTURE.ctx /
    // FIXTURE.envelopes references — no per-surface fixture forks.
    expect(FIXTURE.envelopes.length).toBeGreaterThan(0)
    expect(HUMAN_SURFACES.length + MASKED_SURFACES.length).toBe(SURFACE_ROLLCALL.length)
  })
})
