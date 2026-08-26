// The host-neutral run composition (Phase 385 plan 08 — D-13).
//
// This is the dissected majority of what used to be a 1035-line composition helper inside the CLI.
// Nothing here was rewritten: the digest mint, the persistence-port construction, the suite
// lifecycle, the masking seed pipeline, the stamped audit sink, the safety-hook registration and
// the member run-config assembly are the same code, moved. What changed is WHERE it lives and what
// it is allowed to assume, and only one thing was actually taken away — the readline default on the
// confirm seam, which is now a required presentation port (see presentation-ports.ts for the rule
// that decided every symbol's side of the line).
//
// Why it moved: 386's daemon has to build a real RunConfig without importing a CLI. A composition
// that lives inside one surface is a composition every other host has to re-derive, and two hosts
// deriving the same RunConfig differently is the class of bug the dual-host proof exists to
// exclude. So the composition root moves down to where the local host implementations already
// live, and the surface keeps only the parts a terminal is required to run.
//
// Heavy first-party dependencies are legal in this subtree and nowhere else in this package; the
// arch rule named composition-carveout enforces that, so the job store proper stays lean.

import { createHash } from 'node:crypto'
import { dirname, isAbsolute, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import {
  createMaskingContext,
  registerFirstPartySafetyHooks,
  seedMaskingContext,
} from '@vostride/agent-qa-safety'
import type { AuditSink, ConfirmPort, SafetyHookRunner } from '@vostride/agent-qa-safety'
import { detectExecutionContext, JsonlAuditSink } from '@vostride/agent-qa-safety-local'
import { guardToolOutput } from '@vostride/agent-qa-model'
import type { TokenAccounting } from '@vostride/agent-qa-model'
import type {
  MaskingContext,
  ModelCapabilities,
  RecordId,
  ReadTrace,
  ScopeKey,
} from '@vostride/agent-qa-schema'
import {
  FsEventLog,
  FsEvidenceArtifactStore,
  FsHandoffStore,
  FsRunArtifactStore,
  nextBuildOrdinal,
  recordBuildTag,
  RUNS_SUBDIR,
  slugBranch,
  SharpScreenshotCompressor,
} from '@vostride/agent-qa-runner-local'
import type { ScreenshotCompressorLogger } from '@vostride/agent-qa-runner-local'
import {
  coerceRunJSResult,
  createMemoryTools,
  createRecordLedger,
  resolveSecretEnv,
  resolveSecretTemplatesInValue,
} from '@vostride/agent-qa-runner'
import type {
  Action,
  AccessibilityCheckHandler,
  ActionPlanCache,
  AppiumScriptHandler,
  ConfigDigests,
  EventLogPort,
  EvidenceArtifactStorePort,
  FailureScreenshotWriter,
  HandoffStorePort,
  HookDefinition,
  HookExecutorPort,
  LoopLogger,
  MemberEventSink,
  MemberRunConfig,
  MemberStepSpec,
  MemberTest,
  MemberTestExecutor,
  LiveStreamCapability,
  MemberTestRunContext,
  NonActionToolMap,
  PlannerConfig,
  Planner,
  PlatformAdapter,
  KnowledgeHintReader,
  PostVerdictPort,
  RecordLedger,
  RunArtifactStorePort,
  RunJsHandler,
  RunMemberDescriptor,
  SandboxRunnerOptions,
  ScreenshotCompressor,
  SecretRedactorPort,
  SecretStore,
  StorageStatePort,
  TestResult,
  Verifier,
  WorkingMemoryPort,
} from '@vostride/agent-qa-runner'
import {
  computeKnowledgeBudgets,
  memoryToolGate,
  scaledRecordCap,
  type KnowledgeBudgets,
} from './knowledge-budgets.js'
import { constructKnowledgeReader } from './knowledge-reader.js'
import type { RunPresentationPorts } from './presentation-ports.js'

// ---- Local structural types -----------------------------------------------------------------

/** Mirror of schema's ExecutionContext union (safety-local's detectExecutionContext returns it). */
export type RunExecutionContext = 'local-interactive' | 'local-headless' | 'ci' | 'cloud'

/**
 * The provider-substrate model handle, named through the runner's own config rather than through
 * the substrate package. It is the identical type — the runner types both model slots with it —
 * and taking it this way keeps a provider-substrate edge off a package whose declared external
 * dependency set is empty and whose whole point is that it installs nothing (JOBQ-02).
 */
type RunLanguageModel = MemberRunConfig['plannerModel']

/** The message shape the token accountant estimates, taken from the accountant's own signature. */
type AccountedMessage = Parameters<TokenAccounting['estimate']>[0][number]

// ---- (0) run-scoped knowledge serving composition (D-01/D-02/D-09/D-15/D-17/D-23) ----------

type KnowledgeAccounting = Pick<TokenAccounting, 'estimate' | 'getCeilings'>

export interface RunKnowledgeComposition {
  reader: KnowledgeHintReader
  budgets: KnowledgeBudgets
  recordLedger: RecordLedger
  nonActionTools?: NonActionToolMap
  beginMemoryTurn?: (scope?: ScopeKey, exposedIds?: readonly RecordId[]) => void
  drainMemoryReadTraces?: () => ReadTrace[]
}

export interface OpenRunKnowledgeCompositionInput {
  knowledgeRoot: string
  product?: string
  scope: ScopeKey
  /** Known containing scopes for a member (the suite scope on prepared-suite runs). */
  parentScopes?: readonly ScopeKey[]
  asOfBuild: number
  capabilities: ModelCapabilities
  accounting: KnowledgeAccounting
  qaRulesText: string
  workingContextText: string
}

/**
 * Open and bind the complete serving stack once per run/planner scope. The composition root can
 * estimate only prompt material it owns, so `qaRulesText` is the run-start capability/rules appendix
 * and `workingContextText` is the resolved suite/test context plus steps. Both ride the same model
 * accounting estimator as planning calls; static runner rules remain covered by the reserved
 * output and conservative fractional allocation rather than a second character heuristic.
 */
export function openRunKnowledgeComposition(
  input: OpenRunKnowledgeCompositionInput,
): RunKnowledgeComposition {
  const ceilings = input.accounting.getCeilings()
  const qaRulesTokens = input.accounting.estimate([
    { role: 'system', content: input.qaRulesText } as AccountedMessage,
  ])
  const workingContextTokens = input.accounting.estimate([
    { role: 'user', content: input.workingContextText } as AccountedMessage,
  ])
  const computed = computeKnowledgeBudgets({
    contextWindow: ceilings.contextWindow,
    reservedOutput: ceilings.maxOutput,
    qaRulesTokens,
    workingContextTokens,
  })
  const budgets: KnowledgeBudgets = {
    ...computed,
    recordCap: scaledRecordCap(input.capabilities),
  }
  const reader = constructKnowledgeReader({
    knowledgeRoot: input.knowledgeRoot,
    ...(input.product === undefined ? {} : { product: input.product }),
    ...(input.parentScopes === undefined ? {} : { parentScopes: input.parentScopes }),
    asOfBuild: input.asOfBuild,
    recordCap: budgets.recordCap,
  })
  const channel2Enabled = memoryToolGate(input.capabilities)
  const recordLedger = createRecordLedger({
    cap: budgets.recordCap,
    budget: budgets.brief + budgets.caution + (channel2Enabled ? budgets.searchResults : 0),
    seedRecords: [],
  })

  // D-09/T-380-29: the planner's action slice remains whole under the always-send-all law. The
  // optional non-action slice is composed only for capable models, so non-registration itself is
  // the gate and no model-visible flag can elevate a weak profile into Channel 2.
  const memory = channel2Enabled
    ? createMemoryTools({
        reader,
        scope: input.scope,
        asOfBuild: input.asOfBuild,
        searchResultBudget: budgets.searchResults,
        readBodyBudget: budgets.readBody,
        recordLedger,
        estimateTokens: (text) => input.accounting.estimate([
          { role: 'user', content: text } as AccountedMessage,
        ]),
      })
    : undefined

  return {
    reader,
    budgets,
    recordLedger,
    nonActionTools: memory?.tools,
    beginMemoryTurn: memory?.beginTurn,
    drainMemoryReadTraces: memory?.drainReadTraces,
  }
}

// ---- (1) computeRunConfigDigests — the ONE digest mint (D-20) --------------------------------

/** One member's file inputs to the digest mint. `suiteFileContent` is absent on the single-test path. */
export interface RunDigestMemberInput {
  testFileContent: string
  suiteFileContent?: string
}

/**
 * The per-member cache pair AND the run-level handoff pair, both produced by the SINGLE call
 * below (D-20). The cache-key threading consumes `perMember[i]`; the handoff header carries
 * `runLevel`. Because both draw from one mint, run identity and handoff identity cannot fork.
 */
export interface RunConfigDigests {
  runLevel: ConfigDigests
  perMember: ConfigDigests[]
}

/** 16-hex SHA-256 digest of a UTF-8 string (the 356 A5 `sha256hex16` value; node:crypto here). */
function digest16(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex').slice(0, 16)
}

/**
 * Mint the run's config digests ONCE (D-20; RESEARCH A1 pinning).
 *
 * - Per-member cache pair:
 *     suiteConfigDigest = sha256hex16(configContent + '\n' + (suiteFileContent ?? ''))
 *     testConfigDigest  = sha256hex16(testFileContent)
 * - Run-level handoff pair:
 *     suiteConfigDigest = sha256hex16(ordered DISTINCT per-member suite digests joined by '\n')
 *     testConfigDigest  = sha256hex16(ordered per-member test digests joined by '\n')
 *   A single-member run collapses the run-level pair to the member's values.
 *
 * Both consumers (per-member cache, run-level handoff) draw from this one call — identities
 * cannot fork. This is the ONLY digest computation in the composition layer.
 */
export function computeRunConfigDigests(input: {
  configContent: string
  members: readonly RunDigestMemberInput[]
}): RunConfigDigests {
  const perMember: ConfigDigests[] = input.members.map((m) => ({
    suiteConfigDigest: digest16(input.configContent + '\n' + (m.suiteFileContent ?? '')),
    testConfigDigest: digest16(m.testFileContent),
  }))

  if (perMember.length === 1) {
    // Single-member runs collapse the run-level pair to the member values.
    return { runLevel: { ...perMember[0] }, perMember }
  }

  const distinctSuiteDigests: string[] = []
  const seen = new Set<string>()
  for (const pair of perMember) {
    if (!seen.has(pair.suiteConfigDigest)) {
      seen.add(pair.suiteConfigDigest)
      distinctSuiteDigests.push(pair.suiteConfigDigest)
    }
  }

  const runLevel: ConfigDigests = {
    suiteConfigDigest: digest16(distinctSuiteDigests.join('\n')),
    testConfigDigest: digest16(perMember.map((p) => p.testConfigDigest).join('\n')),
  }

  return { runLevel, perMember }
}

// ---- (2) resolveRunExecutionContext — canonical resolver (D-04) ------------------------------

/**
 * Resolve the run's execution context via safety-local's canonical `detectExecutionContext`
 * (RESEARCH Q1.4 recommendation (a) — already tested; an explicit override wins). Carried into
 * `RunConfig.executionContext` and the handoff header.
 */
export function resolveRunExecutionContext(override?: RunExecutionContext): RunExecutionContext {
  return detectExecutionContext(override) as RunExecutionContext
}

// ---- (3) buildRunPorts + buildOrdinal — runner-local persistence tier (D-06/D-17/D-18) -------

/** The durable run ports the shell wires behind `RunConfig.ports` (event log + handoff + artifact). */
export interface RunPersistencePorts {
  eventLog: EventLogPort
  handoffStore: HandoffStorePort
  runArtifactStore: RunArtifactStorePort
  /**
   * CASS-02 run-scoped decision-screenshot store (Plan 13). Constructed once here from the SAME
   * persistence root + runId as the other adapters; the shell hands this exact instance to every
   * member so Plan 12's live-decision producer persists into one durable, run-addressable namespace.
   */
  evidenceArtifacts: EvidenceArtifactStorePort
  /**
   * 403-13 (WR-06, LIVE-03): where a live-frame VIEWER's fault is reported. Declared here as well
   * as on the runner's `RunPorts`, because `assembleCliRun` spreads THIS interface into
   * `RunConfig.ports` — a member declared on only one side is invisible in the type across that
   * hop. Non-durable and off the bus by construction; the run's transcript never records a viewer.
   */
  onSubscriberFault?: (code: string, message: string) => void
  /**
   * 404-01 (D-05/D-10): the host-composed post-verdict step the shell awaits between `verdict` and
   * `runFinished`. Declared here for the SAME reason `onSubscriberFault` is — `assembleCliRun`
   * spreads THIS interface into `RunConfig.ports`, so a member declared on only one side of that
   * hop is invisible in the type and would silently never reach `startRun`.
   *
   * It is NOT built by `buildRunPorts`: this package's runner seam names no queue and no writer
   * lease, and inventing a second spelling of either here is what D-05 exists to prevent. The core
   * threads whatever the HOST handed it (`RunInvocationCoreOptions.postVerdict`) and nothing else.
   */
  postVerdict?: PostVerdictPort
}

/**
 * Construct the runner-local persistence ports rooted at the run's `.agent-qa` runtime dir (the
 * FsActionCache rooting idiom). `FsEventLog`/`FsHandoffStore`/`FsRunArtifactStore`/
 * `FsEvidenceArtifactStore` all write under the SAME `<configDir>/.agent-qa/runs/<slug(runId)>/…`
 * family (D-08 — one self-contained run dir).
 */
export function buildRunPorts(input: { configDir: string; runId: string }): RunPersistencePorts {
  const root = resolve(input.configDir, '.agent-qa')
  return {
    eventLog: new FsEventLog({ root, runId: input.runId }),
    handoffStore: new FsHandoffStore({ root, runId: input.runId }),
    runArtifactStore: new FsRunArtifactStore({ root, runId: input.runId }),
    evidenceArtifacts: new FsEvidenceArtifactStore({ root, runId: input.runId }),
    // A NAMED, observable, non-durable destination: greppable by code, visible to a test through
    // `process.once('warning', …)`, and no `console.` call in a package that makes none.
    onSubscriberFault: (code, message) => {
      process.emitWarning(message, { code })
    },
  }
}

/**
 * Construct the D-08/Q10 screenshot compressor at the composition root (sharp's host-adapter home).
 * The runner-local `SharpScreenshotCompressor` is injected into every member's runner loop via
 * `RunSuiteConfig.compressor` / `RunTestConfig.compressor` — core no longer constructs one.
 */
export function buildScreenshotCompressor(logger?: ScreenshotCompressorLogger): ScreenshotCompressor {
  return new SharpScreenshotCompressor(logger)
}

/** Resolve D-16 build-tag precedence without reading ambient process state. */
export function resolveBuildTagSetting(input: {
  flag?: string
  env?: string
  use?: { buildTag?: string }
}): string | undefined {
  for (const value of [input.flag, input.env, input.use?.buildTag]) {
    const trimmed = value?.trim()
    if (trimmed) return trimmed
  }
  return undefined
}

/**
 * Advance the per-product buildOrdinal counter under the same `.agent-qa` root (D-18), then
 * record D-14/D-16's first-seen tag mapping beside it when supplied. Both files are lock-free,
 * best-effort runtime truth; the resolved ordinal rides `RunConfig.buildOrdinal` into the handoff.
 */
export async function resolveRunBuildOrdinal(input: {
  configDir: string
  product: string
  buildTag?: string
}): Promise<number> {
  const root = resolve(input.configDir, '.agent-qa')
  const ordinal = await nextBuildOrdinal({ root, product: input.product })
  if (input.buildTag !== undefined) {
    await recordBuildTag({
      root,
      product: input.product,
      tag: input.buildTag,
      ordinal,
    })
  }
  return ordinal
}

// ---- (4) createSuiteLifecycle — lazy per-suite setup/teardown --------------------------------

/**
 * The ONE exclusive lane every suite member declares (402-02, D-09). The runner's bounded member
 * pool never runs two members of the same lane concurrently, and the suite path needs that for two
 * independent reasons, either of which alone would be sufficient:
 *
 *  1. Every member of a suite drives the ONE `PlatformAdapter` its suite set up — one browser, one
 *     page. Two members on it at once would interleave navigations and clicks on a shared surface.
 *     D-09 requires each concurrent member its own browser/CDP handle; the suite path does not
 *     supply that today, so it does not get concurrency today.
 *  2. `createSuiteLifecycle` admits ONE ACTIVE SUITE at a time. Two suites live at once is a
 *     lifecycle violation, not a scheduling preference.
 *
 * A single lane string (rather than one lane per suite) is what encodes BOTH: it serializes within
 * a suite and across suites. When a producer starts handing each member its own session AND the
 * lifecycle admits concurrent suites, this becomes a per-suite key — or disappears — and the shell
 * needs no argument re-litigated for that to be safe.
 *
 * STATUS 2026-08-24 (402-02): reason (2) is CLOSED — `createSuiteLifecycle` below is now a
 * once-latch with member reference counting, so two members of one suite merge into one setup and
 * a boundary crossed while members are live is a named error rather than a mid-flight teardown.
 * Reason (1) is OPEN and is what still holds the lane: `suiteConfig.adapter` is per-SUITE, so
 * within-suite concurrency would still put two tests on one browser page. Giving each suite member
 * its own session is a change to what a suite MEANS (suite setup navigates once and members
 * inherit that page state, per-test hooks run against it, auth state is captured from it) and is
 * not this plan's to make. Do not drop this lane until that is decided.
 */
export const SUITE_LIFECYCLE_LANE = 'suite-lifecycle'

/** The setup/teardown pair a suite runs when it first becomes active / when it is torn down. */
export interface SuiteLifecycleHooks {
  /** Suite-level setup: setup hooks + adapter.setup + suite-URL navigation. */
  setup(): Promise<void>
  /** Suite-level teardown: teardown hooks + auth-state capture (when all passed) + adapter.cleanup. */
  teardown(): Promise<void>
}

/**
 * One member's hold on the active suite (402-02). Held from the moment `ensureReady` admits the
 * member until the member settles; the suite cannot be torn down while any hold is outstanding.
 */
export interface SuiteMemberLease {
  /** Drop this member's hold. Idempotent — a double release never double-decrements. */
  release(): void
}

/**
 * Thrown when `ensureReady` is asked for a suite while a DIFFERENT suite still has live members
 * (402-02). This is the one-active-suite invariant made loud. The alternative — tearing the live
 * suite down to make room — closes the browser out from under a test that is still running in it,
 * and does so silently. The shell's exclusive lane (`SUITE_LIFECYCLE_LANE`) means no shipped
 * composition can reach this, so it reads as an assertion rather than a runtime condition; that is
 * exactly the point of naming it instead of assuming it.
 */
export class SuiteBoundaryWhileLiveError extends Error {
  constructor(
    readonly activeSuiteKey: string,
    readonly requestedSuiteKey: string,
    readonly liveMembers: number,
  ) {
    super(
      `Cannot enter suite "${requestedSuiteKey}": suite "${activeSuiteKey}" still has ` +
        `${liveMembers} live member(s). Suite boundaries are serialized.`,
    )
    this.name = 'SuiteBoundaryWhileLiveError'
  }
}

export interface SuiteLifecycle {
  /**
   * Admit a member to `suiteKey` and resolve once the suite is ready. The FIRST member to arrive
   * starts the suite's setup; every other member of that suite awaits the SAME setup promise
   * rather than starting a second one. Crossing a suite boundary tears down the previous suite —
   * but only once its last member has released; a boundary crossed while members are live is a
   * {@link SuiteBoundaryWhileLiveError}, never a silent teardown.
   *
   * The returned {@link SuiteMemberLease} MUST be released when the member settles (pass or fail);
   * `buildSuiteMemberExecutor` does it in a `finally`.
   */
  ensureReady(suiteKey: string, hooks: SuiteLifecycleHooks): Promise<SuiteMemberLease>
  /** Tear down the last active suite (if any). Called once at run end after `session.done`. */
  finalize(): Promise<void>
}

/**
 * A lazy, CONCURRENCY-SAFE suite-lifecycle manager (the Q1.2 "pre/post-run composition" rows,
 * redesigned for the 402-02 member pool). A wholly SKIPPED suite never sets up — the shell only
 * invokes the executor (hence `ensureReady`) for non-skipped members, so a suite whose members are
 * all fail-fast/cancel skips is never touched.
 *
 * WHAT CHANGED AND WHY. The pre-402 version read the active key, awaited `hooks.setup()`, and THEN
 * assigned the key — three steps with awaits between them. Under a `for` loop that is fine because
 * only one member is ever inside it. Under a pool, two members of one suite both observe "no active
 * suite" and both run setup: two browsers for one suite, and the second teardown handle silently
 * overwriting the first, so the first suite's browser is never closed. The fix is not a lock; it is
 * to make the state transition SYNCHRONOUS and let the promise be the shared thing:
 *
 *  - the once-latch: `activeKey`, `activeTeardown` and `activeSetup` are all assigned in the same
 *    synchronous region, BEFORE any await, so there is no window in which a second member can
 *    observe the pre-setup state. Every later member of the suite awaits `activeSetup` itself.
 *  - member reference counting: the count is incremented before awaiting setup, so a concurrent
 *    boundary crossing sees the hold. Teardown fires at a BOUNDARY (or at `finalize`) and only
 *    when the count is zero — never merely because it hit zero, which would tear the suite down
 *    and set it back up between every pair of members.
 *  - a failed setup poisons the suite: the rejected latch is kept and re-thrown to every later
 *    member, so setup is attempted exactly once and no member half-starts against a suite that
 *    never came up. Such a suite is never torn down — nothing came up to take down.
 */
export function createSuiteLifecycle(): SuiteLifecycle {
  let activeKey: string | undefined
  let activeSetup: Promise<void> | undefined
  let activeTeardown: (() => Promise<void>) | undefined
  let liveMembers = 0

  const tearDownActive = async (): Promise<void> => {
    const teardown = activeTeardown
    activeKey = undefined
    activeSetup = undefined
    activeTeardown = undefined
    liveMembers = 0
    if (teardown) await teardown()
  }

  return {
    async ensureReady(suiteKey, hooks) {
      if (activeKey !== undefined && activeKey !== suiteKey) {
        if (liveMembers > 0) {
          throw new SuiteBoundaryWhileLiveError(activeKey, suiteKey, liveMembers)
        }
        await tearDownActive()
      }

      if (activeKey !== suiteKey) {
        // THE ONCE-LATCH. All three assignments are synchronous and happen before the setup body
        // can suspend, so the check above and the state below can never be split by an await.
        activeKey = suiteKey
        activeTeardown = hooks.teardown
        activeSetup = (async () => {
          try {
            await hooks.setup()
          } catch (error) {
            // A suite that never came up has nothing to take down, and the latch stays rejected so
            // every later member of this suite inherits the same failure instead of retrying.
            activeTeardown = undefined
            throw error
          }
        })()
      }

      const setup = activeSetup
      // Counted BEFORE the await: a boundary crossing that races this member must see the hold.
      liveMembers += 1
      let released = false
      const lease: SuiteMemberLease = {
        release() {
          if (released) return
          released = true
          liveMembers -= 1
        },
      }
      try {
        await setup
      } catch (error) {
        lease.release()
        throw error
      }
      return lease
    },
    async finalize() {
      await tearDownActive()
    },
  }
}

// ---- (5) buildSuiteMemberExecutor — the MemberTestExecutor closure (D-01) ---------------------

/**
 * One prepared suite member: its suite key + lifecycle hooks (setup runs on the first member of
 * that suite) and a `run(ctx)` that builds the member's bound `SuiteMemberInput` around core's
 * per-test machinery and returns `executeSuiteMember(...)` with the shell-provided ctx seams
 * (abortSignal, events, per-member configDigests) threaded in.
 */
export interface SuiteMemberBinding {
  suiteKey: string
  hooks: SuiteLifecycleHooks
  /**
   * 403 D-05: the suite's ONE adapter, read only for its live-stream declaration. Present so the
   * executor can register the capability AFTER `ensureReady` has resolved the suite's `setup()`
   * (which is where `adapter.setup()` runs, so `this.page` exists) and BEFORE the first step.
   */
  adapter?: PlatformAdapter
  run(ctx: MemberTestRunContext): Promise<TestResult>
}

/**
 * Declare (or withdraw) a member's live stream on the shell-provided context (403 D-05).
 *
 * Duck-typed exactly like `captureFailureScreenshotFromAdapter` below: an adapter that predates
 * live view has no `liveStream` property, so the member registers `undefined` and its handle reads
 * `{ kind: 'none' }` — an honest absence, never a throw and never a screenshot-polling fallback.
 * The `ctx.registerLiveStream?.()` call is itself optional so a composition that predates the port
 * is a no-op rather than a crash.
 */
export function registerAdapterLiveStream(
  ctx: MemberTestRunContext,
  adapter: PlatformAdapter | undefined,
): void {
  const capability = (adapter as { liveStream?: LiveStreamCapability } | undefined)?.liveStream
  ctx.registerLiveStream?.(capability)
}

/**
 * Build the injected `MemberTestExecutor` (D-01). Per member the closure looks up the prepared
 * binding by the shell-derived `testIndex` (array position — authoritative), calls
 * `lifecycle.ensureReady(...)` to lazily set up / cross-boundary tear down the member's suite,
 * then runs the member behind `executeSuiteMember`. Wrapping ONE audited function instead of
 * replicating the loop body.
 */
export function buildSuiteMemberExecutor(input: {
  lifecycle: SuiteLifecycle
  bindings: readonly SuiteMemberBinding[]
}): MemberTestExecutor {
  return async (member: RunMemberDescriptor, ctx: MemberTestRunContext): Promise<TestResult> => {
    const binding = input.bindings[ctx.testIndex]
    if (!binding) {
      throw new Error(`No suite-member binding for testIndex ${ctx.testIndex} (testId ${member.testId})`)
    }
    const lease = await input.lifecycle.ensureReady(binding.suiteKey, binding.hooks)
    try {
      // 403 D-05: the suite is up (adapter.setup() resolved inside `ensureReady`), so the member's
      // live stream is declarable now and before its first step.
      registerAdapterLiveStream(ctx, binding.adapter)
      return await binding.run(ctx)
    } finally {
      // The hold is dropped on EVERY exit, throw included — a leaked hold would block the next
      // suite's boundary forever with a SuiteBoundaryWhileLiveError.
      lease.release()
    }
  }
}

// ---- (6) masking seed pipeline — sensitiveEnvSlice / extractAuthStateSensitiveStrings / -------
// ---------------------------------- buildRunMaskingContext (D-05/D-06/D-07) --------------------
//
// The real MaskingContext seed pipeline 362-06 wires at both startRun sites (the former D-09
// identity injection point). seedMaskingContext registers EVERY env value it is handed (filtering is
// explicitly the caller's job), so `sensitiveEnvSlice` is the D-05 gate: masking must never degrade
// planning, so selection is name-based ONLY (never value-based) — planner-visible config (BASE_URL,
// NODE_ENV, HOME, PATH) is never seeded while every ambient-credential-shaped name is.
// `extractAuthStateSensitiveStrings` is the D-07 channel (all cookie + all localStorage values, no
// classification heuristics — exact-string masking means benign blobs only mask when the app renders
// that exact string). The ≥4-char `minRegisteredLength` guard rides through unchanged.

/** Uppercase-name suffix families that mark an env var as an ambient credential (D-05). */
const SENSITIVE_ENV_SUFFIXES: readonly string[] = [
  '_KEY',
  '_TOKEN',
  '_SECRET',
  '_PASSWORD',
  '_PASSWD',
  '_CREDENTIAL',
  '_CREDENTIALS',
  '_AUTH',
]

/** Uppercase-name prefix families that mark an env var as an ambient credential (D-05). */
const SENSITIVE_ENV_PREFIXES: readonly string[] = [
  'AWS_SECRET',
  'AWS_SESSION',
  'ANTHROPIC_',
  'OPENAI_',
  'GH_',
  'NPM_TOKEN',
  'GITHUB_TOKEN',
]

/**
 * Select the sensitive slice of `env` by NAME only (D-05). Deterministic: an uppercased name is
 * kept when it ends with a sensitive suffix family OR begins with a sensitive prefix family.
 * Never reads or matches on env VALUES; undefined values are skipped. The kept values feed
 * `seedMaskingContext`'s `env` channel — planner-visible config names never appear here.
 */
export function sensitiveEnvSlice(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) continue
    const upper = name.toUpperCase()
    const sensitive =
      SENSITIVE_ENV_SUFFIXES.some((suffix) => upper.endsWith(suffix)) ||
      SENSITIVE_ENV_PREFIXES.some((prefix) => upper.startsWith(prefix))
    if (sensitive) out[name] = value
  }
  return out
}

/**
 * Walk a Playwright `storageState` payload defensively and return every `cookies[].value` string
 * plus every `origins[].localStorage[].value` string (D-07). No classification; tolerant of
 * missing/odd sections and non-string values; returns [] for a non-object payload. The shape
 * mirrors what `captureAuthStateForRun` persists.
 */
export function extractAuthStateSensitiveStrings(payload: unknown): string[] {
  if (payload === null || typeof payload !== 'object') return []
  const out: string[] = []

  const cookies = (payload as { cookies?: unknown }).cookies
  if (Array.isArray(cookies)) {
    for (const cookie of cookies) {
      const value = (cookie as { value?: unknown } | null)?.value
      if (typeof value === 'string') out.push(value)
    }
  }

  const origins = (payload as { origins?: unknown }).origins
  if (Array.isArray(origins)) {
    for (const origin of origins) {
      const localStorage = (origin as { localStorage?: unknown } | null)?.localStorage
      if (!Array.isArray(localStorage)) continue
      for (const entry of localStorage) {
        const value = (entry as { value?: unknown } | null)?.value
        if (typeof value === 'string') out.push(value)
      }
    }
  }

  return out
}

/** The full run MaskingContext (register/dispose included) — 362-06 registers mid-run auth (D-06). */
export type RunMaskingContext = ReturnType<typeof createMaskingContext>

/**
 * Construct and seed the run's real MaskingContext (D-05/D-06/D-07). One `createMaskingContext()`
 * (default ≥4-char guard) seeded by a single `seedMaskingContext` call drawing from all three
 * sources: the run's `SecretStore` (all values), the D-05 name-based sensitive env slice, and the
 * concatenated D-07 auth-state values. The FULL context is returned so 362-06 can register mid-run
 * auth values at lazy suite load/capture (D-06) and dispose at run end.
 */
export function buildRunMaskingContext(input: {
  secretStore?: { forEachSecret(cb: (name: string, value: string) => void): void }
  env?: NodeJS.ProcessEnv
  authStatePayloads?: readonly unknown[]
}): RunMaskingContext {
  const ctx = createMaskingContext()
  const knownSensitiveStrings = (input.authStatePayloads ?? []).flatMap((payload) =>
    extractAuthStateSensitiveStrings(payload),
  )
  seedMaskingContext(ctx, {
    secretStore: input.secretStore,
    env: sensitiveEnvSlice(input.env ?? {}),
    authState: { knownSensitiveStrings },
  })
  return ctx
}

// ---- (7) per-run stamped audit sink — stampAuditSink / buildRunAuditSink (D-12/D-13) ---------
//
// D-13: `evaluate()` stays the single execution-audit author (untouched); the run stamps
// correlation at ONE composition-root site — a thin wrapper that injects runId + the resolved
// executionContext into every row before append so rows are self-describing (SEAM-02 is literal
// in the row, no joins). The stamp WINS over any pre-existing row field (RESEARCH Open Q3): spread
// the row FIRST, stamp AFTER. D-12: the sink is a JsonlAuditSink rooted at the SAME
// .agent-qa/runs/<slug(runId)>/ directory FsEventLog uses (slugBranch reuse — path forking is the
// failure mode), so a completed run is one self-contained directory.

/**
 * Wrap an AuditSink so every appended row carries `runId` + `executionContext` (D-13). Stamp-wins:
 * the row is spread first and the stamp applied after, so a stale row field never survives.
 * Guardrail rows carry `runId` only (their schema has no executionContext). The void-or-promise
 * return of the inner sink is preserved.
 */
export function stampAuditSink(
  inner: AuditSink,
  runId: string,
  executionContext: RunExecutionContext,
): AuditSink {
  return {
    appendExecutionAudit(row) {
      return inner.appendExecutionAudit({ ...row, runId, executionContext })
    },
    appendGuardrailAudit(row) {
      return inner.appendGuardrailAudit({ ...row, runId })
    },
  }
}

/**
 * Build the per-run stamped audit sink (D-12/D-13). A `JsonlAuditSink` rooted at the EXACT run dir
 * `FsEventLog`/`FsHandoffStore` write to — `<configDir>/.agent-qa/runs/<slugBranch(runId)>/` — so
 * execution_audit.jsonl / guardrail_audit.jsonl land beside events.jsonl + handoff.json. The
 * slug is `slugBranch` from runner-local (the exact slug the event log uses); path forking would
 * scatter a run's evidence. The sink is wrapped by `stampAuditSink` so every row is correlated.
 */
export function buildRunAuditSink(input: {
  configDir: string
  runId: string
  executionContext: RunExecutionContext
}): AuditSink {
  return stampAuditSink(new JsonlAuditSink(runDirFor(input)), input.runId, input.executionContext)
}

/**
 * The one composition of a run's own directory (401-20, CR-04).
 *
 * EXTRACTED RATHER THAN COPIED, and that is the whole point of it existing. The core's collision
 * refusal has to ask "does this id already name a run", and the only honest way to ask is against
 * the SAME path the run's artifacts are written to. A second spelling of
 * `runs/<slugBranch(runId)>/` would be free to drift from this one, and a refusal that looked in
 * the wrong place would be green while a colliding id walked past it — path forking is the failure
 * mode this function's own caller already warns about.
 */
export function runDirFor(input: { configDir: string; runId: string }): string {
  return resolve(input.configDir, '.agent-qa', RUNS_SUBDIR, slugBranch(input.runId))
}

// ---- (8) per-run safety-hooks registrar (D-01/D-15/D-10/D-11) --------------------------------
//
// D-01: the loop's SafetyHookRunner is a SECOND, per-run registerFirstPartySafetyHooks() invocation
// at the composition root with DIRECT deps (the model registry's deps-less call stays untouched).
// It carries the stamped per-run sink, a pause-timing ConfirmPort decorator, the resolved execution
// context, and the D-15 trust flag. D-10: the decorator measures each awaited confirm and accumulates
// the elapsed ms into a closure counter exposed as `confirmPausedMs` — the run-budget supplier 362-06
// wires into RunPorts.confirmPausedMs so human decision time never counts against the app under test.
// D-11: NO reader is passed — the no-standing-approvals default is reached by omission (the standing-
// approval WRITE side is M4's).
//
// The ONE substantive change the dissection made anywhere: the confirm port is now REQUIRED. It used
// to default to a readline prompt, and a default that reaches for a terminal is the single thing a
// composition a daemon shares cannot carry — an unattended drainer would block on a question nobody
// can see. The CLI supplies its readline confirm, decorated for human output, at its own call site.

export interface BuildRunSessionSafetyHooksInput {
  auditSink: AuditSink
  executionContext: RunExecutionContext
  trustMode: boolean
  /** The host's presentation ports; `confirm` is mandatory, human decoration optional. */
  presentation: RunPresentationPorts
}

/**
 * Perform the D-01 per-run `registerFirstPartySafetyHooks` invocation and return the loop's
 * `SafetyHookRunner` plus the D-10 confirm-pause supplier. The host's confirm is wrapped in a
 * timing decorator whose accumulated awaited-ms is exposed via `confirmPausedMs()`. `trustMode`
 * flows through as `GateTrust.trustMode` (D-15). No `reader` is supplied so the
 * no-standing-approvals default holds by omission (D-11).
 */
export function buildRunSessionSafetyHooks(
  input: BuildRunSessionSafetyHooksInput,
): { safetyHooks: SafetyHookRunner; confirmPausedMs: () => number } {
  let pausedMs = 0
  const baseConfirm = input.presentation.confirm
  const timedConfirm: ConfirmPort = {
    // THE WRAPPED PORT'S SURFACE, FORWARDED (G-401-17). A decorator names no surface of its own:
    // it does not ask anybody anything, it measures how long the port underneath took to be
    // answered. Substituting a literal here — or letting the field be optional and defaulted —
    // would turn an honest browser row back into a terminal row with no compile error to catch it,
    // because a wrapper that lies about its surface still satisfies the type.
    surface: baseConfirm.surface,
    ask: async (action) => {
      const start = performance.now()
      try {
        return await baseConfirm.ask(action)
      } finally {
        pausedMs += performance.now() - start
      }
    },
  }

  // The host decoration composes OVER the timing decorator, preserving the nesting this pipeline
  // has always had: whatever a host does to render the question, the measured interval is still the
  // one that ends when the person answers.
  const confirm = input.presentation.decorateConfirmForHuman?.(timedConfirm) ?? timedConfirm

  const { registry } = registerFirstPartySafetyHooks({
    auditSink: input.auditSink,
    confirm,
    resolveExecutionContext: () => input.executionContext,
    trust: { trustMode: input.trustMode },
  })

  return { safetyHooks: registry, confirmPausedMs: () => pausedMs }
}

// ---- (9) member-run-config builder — the D-05 cutover onto runMemberTest (363-11) ------------
//
// Both startRun sites (suite + single-test) execute each member through the runner-owned
// `runMemberTest` (Plan 10). The executor closure at each site composes core-owned memory
// init/curator/destroy AROUND this member run and returns the member `TestResult` to the shell.
// `buildMemberRunConfig` is the ONE place (Pitfall 8 — no per-site drift) that maps the resolved
// host impls into a `MemberRunConfig`, constructing the adapter-backed injected handlers the runner
// stays neutral about: runJS (web `page.evaluate` + `coerceRunJSResult`), appium (adapter execute
// with secret resolution), the accessibility check (dynamic web-package load), the failure
// screenshot writer, and the store-neutral secret resolver. Adapter internals are legal HERE — this
// is the composition root (D-05). Core's `runTest`/`runTestWithRetry` per-test wrapper is gone;
// its responsibilities live in `runMemberTest` (runner) and in the memory/curator composition here.

/** Capture a best-effort failure screenshot from the adapter (re-homed from the deleted core
 * reporter/screenshot.ts). Returns undefined when the adapter exposes no screenshot capability or
 * capture throws — never fails the step. */
async function captureFailureScreenshotFromAdapter(adapter: PlatformAdapter): Promise<Buffer | undefined> {
  try {
    const shot = (adapter as { screenshot?: () => Promise<Buffer> }).screenshot
    if (typeof shot !== 'function') return undefined
    return await shot.call(adapter)
  } catch {
    return undefined
  }
}

/** Build the injected runJS handler (Q-2). Web-only, mirroring the deleted core runjs-inline
 * execution half: resolve the page from the adapter, `page.evaluate`, coerce the result. Non-web /
 * page-less returns a `[runJS error: …]` value the runner splices in (the same self-describing text
 * core produced). */
function buildRunJsHandler(adapter: PlatformAdapter): RunJsHandler {
  return async (code, ctx) => {
    if (adapter.platform !== 'web') {
      return { value: '[runJS error: runJS is only supported on web platform]', error: 'runJS is only supported on web platform' }
    }
    const page = 'getPage' in adapter
      ? (adapter as { getPage: () => { evaluate: (c: string) => Promise<unknown> } | undefined }).getPage()
      : undefined
    if (!page) {
      return { value: '[runJS error: no browser page available]', error: 'no browser page available' }
    }
    void ctx
    const raw = await page.evaluate(code)
    return { value: coerceRunJSResult(raw) }
  }
}

/** Build the injected appium handler (Q-2). Resolves secret templates in the action, then executes
 * it on the adapter (the core appium-inline execution half). */
function buildAppiumScriptHandler(adapter: PlatformAdapter, secretStore?: SecretStore): AppiumScriptHandler {
  return async (action) => adapter.execute(resolveSecretTemplatesInValue(action as Action, secretStore) as Action)
}

/** Build the injected accessibility-check handler (Q-4). Web-only; resolves the page and runs the
 * dynamically-loaded `@vostride/agent-qa-web` `runAccessibilityCheck` (the composition root is the
 * dynamic-load host — resolves Open Q-4 as move-now). Returns [] when no page is available. */
function buildAccessibilityCheckHandler(adapter: PlatformAdapter): AccessibilityCheckHandler {
  return async (opts) => {
    const page = 'getPage' in adapter ? (adapter as { getPage: () => unknown }).getPage() : undefined
    if (!page) return []
    const web = await import('@vostride/agent-qa-web')
    return web.runAccessibilityCheck(page as any, opts)
  }
}

/** Build the injected failure-screenshot writer. Captures from the adapter into the member's
 * `result.screenshot` (in-run buffer, the same artifact the reporter subscribers persist beside the
 * run dir). */
function buildFailureScreenshotWriter(adapter: PlatformAdapter): FailureScreenshotWriter {
  return async () => captureFailureScreenshotFromAdapter(adapter)
}

/** The runner-owned `MemberTest` shape derived from a resolved (already suite-patched) TestDefinition.
 * `filePath` is the member's own file. A suite-patched test carries no `url` (the suite owns nav), so
 * `runMemberTest` skips the per-test navigate for suite members. */
export function toMemberTest(test: any, filePath: string): MemberTest {
  return {
    testId: (test['test-id'] as string | undefined) ?? test.name,
    name: test.name,
    filePath,
    url: test.url as string | undefined,
    context: test.context as string | undefined,
    steps: test.steps as Array<string | MemberStepSpec>,
    meta: test.meta as MemberTest['meta'],
  }
}

/** Everything both executor closures resolve at the composition root and hand to
 * {@link buildMemberRunConfig}. The adapter-backed injected handlers are constructed here from
 * `adapter` + `secretStore` so the two sites never drift (Pitfall 8). */
export interface BuildMemberRunConfigInput {
  // loop host impls
  adapter: PlatformAdapter
  planner: Planner
  verifier?: Verifier
  cache?: ActionPlanCache
  masking?: MaskingContext
  workingMemory?: WorkingMemoryPort
  storageState?: StorageStatePort
  compressor?: ScreenshotCompressor
  safetyHooks?: SafetyHookRunner
  knowledgeReader?: KnowledgeHintReader
  knowledgeBudgets?: KnowledgeBudgets
  knowledgeAsOfBuild?: number
  recordLedger?: RecordLedger
  beginMemoryTurn?: (scope?: ScopeKey, exposedIds?: readonly RecordId[]) => void
  drainMemoryReadTraces?: () => ReadTrace[]
  configDigests?: ConfigDigests
  // models
  plannerModel: RunLanguageModel
  verifierModel: RunLanguageModel
  // variable seeds
  envFileVars?: Record<string, string>
  inlineVars?: Record<string, string>
  suiteVars?: Record<string, string>
  cliVars?: Record<string, string>
  hookSetupVars?: Record<string, string>
  // inline hooks
  inlineHookDefs?: Map<string, HookDefinition>
  sandboxOptions?: SandboxRunnerOptions
  // secrets — the concrete SecretStore (superset of SecretResolver); resolveSecretEnv needs forEachSecret.
  secretStore?: SecretStore
  secretRedactor?: SecretRedactorPort
  // per-member ctx (bound by the run shell)
  sink: MemberEventSink
  testIndex: number
  abortSignal: AbortSignal
  /** CASS-02 run-scoped evidence store the shell threads onto the member ctx (Plan 13). */
  evidenceArtifacts?: EvidenceArtifactStorePort
  // run config
  captureScreenshots?: boolean
  accessibility?: MemberRunConfig['accessibility']
  timeouts?: MemberRunConfig['timeouts']
  plannerConfig?: PlannerConfig
  logger?: LoopLogger
  logCapture?: { console?: boolean; network?: boolean }
  vision?: { screenshotSize?: number; effectiveResolution?: number }
  visionGate?: { attachImage: boolean; captureMode: 'full' | 'textOnly'; promptNote: string }
  contextWindow?: number
  suiteContext?: string
  /** The member's own file, for the core-parity fileUpload path resolver. */
  filePath: string
}

/**
 * Assemble the {@link MemberRunConfig} `runMemberTest` slots behind, wiring the adapter-backed
 * injected handlers (runJS/appium/a11y/failure-shot), the store-neutral secret resolver, and the
 * fileUpload path resolver — reproducing core's `runTest` per-test behavior on runner soil (D-05).
 */
export function buildMemberRunConfig(input: BuildMemberRunConfigInput): MemberRunConfig {
  const sandbox = input.sandboxOptions
  return {
    adapter: input.adapter,
    planner: input.planner,
    verifier: input.verifier,
    cache: input.cache,
    masking: input.masking,
    workingMemory: input.workingMemory,
    storageState: input.storageState,
    // CTXB-06: model's canonical compaction (compactLogs for log bursts, guardBlob
    // otherwise) replaces the runner-local ceiling fallback on every tool-output value.
    guardBlob: guardToolOutput,
    compressor: input.compressor,
    safetyHooks: input.safetyHooks,
    knowledgeReader: input.knowledgeReader,
    knowledgeBudgets: input.knowledgeBudgets,
    knowledgeAsOfBuild: input.knowledgeAsOfBuild,
    recordLedger: input.recordLedger,
    beginMemoryTurn: input.beginMemoryTurn,
    drainMemoryReadTraces: input.drainMemoryReadTraces,
    configDigests: input.configDigests,

    plannerModel: input.plannerModel,
    verifierModel: input.verifierModel,

    envFileVars: input.envFileVars,
    inlineVars: input.inlineVars,
    suiteVars: input.suiteVars,
    cliVars: input.cliVars,
    hookSetupVars: input.hookSetupVars,

    // Inline hooks: the runner-local DockerHookExecutor + sandbox env/authState come off the resolved
    // sandbox options; the per-run secret env is resolved store-side (never crosses into the runner).
    hookExecutor: sandbox?.executor as HookExecutorPort | undefined,
    inlineHookDefs: input.inlineHookDefs,
    hookEnvVars: sandbox?.envVars,
    hookSecretEnv: resolveSecretEnv(input.secretStore),
    hookAuthState: sandbox?.authState,

    runJs: buildRunJsHandler(input.adapter),
    appiumScript: buildAppiumScriptHandler(input.adapter, input.secretStore),
    accessibilityCheck: buildAccessibilityCheckHandler(input.adapter),
    persistFailureScreenshot: buildFailureScreenshotWriter(input.adapter),

    resolveSecrets: (text: string) => resolveSecretTemplatesInValue(text, input.secretStore),
    secretStore: input.secretStore,
    secretRedactor: input.secretRedactor,

    sink: input.sink,
    testIndex: input.testIndex,
    abortSignal: input.abortSignal,
    evidenceArtifacts: input.evidenceArtifacts,

    captureScreenshots: input.captureScreenshots,
    accessibility: input.accessibility,
    timeouts: input.timeouts,
    plannerConfig: input.plannerConfig,
    logger: input.logger,
    logCapture: input.logCapture,
    vision: input.vision,
    visionGate: input.visionGate,
    contextWindow: input.contextWindow,
    suiteContext: input.suiteContext,
    resolveUploadPath: (rawPath: string) =>
      isAbsolute(rawPath) ? rawPath : resolve(dirname(input.filePath), rawPath),
  }
}
