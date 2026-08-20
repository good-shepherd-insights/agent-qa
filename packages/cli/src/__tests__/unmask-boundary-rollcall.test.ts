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
import { renderClauseResults } from '../commands/result-render.js'
import {
  ARTIFACT_FILE,
  EVENTS_FILE,
  FsEventLog,
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
} from '@vostride/agent-qa-schema'
import type {
  CacheableStepInput,
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
      const base: ConfirmPort = (action: RiskActionDescriptor) => {
        seen.push(action.name)
        return false
      }
      const confirm = buildUnmaskingConfirm({ base, maskingContext: FIXTURE.ctx })
      await confirm({ name: FIXTURE.confirmActionName, recognized: true })
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
