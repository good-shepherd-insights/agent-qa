// runMemberTest — the runner-owned landing zone for every responsibility of core's
// runTest/runTestWithRetry (Phase 363 D-05, RESEARCH Q2 dissolution map). Built +
// tested against fakes here; Plan 11 cuts the CLI over and deletes the core side.
//
// CRITICAL: provider-neutral + storage-neutral. No node:* imports (no node:crypto,
// node:fs, node:path, node:child_process), no display writes to the terminal. Every host/
// adapter/storage concern enters as an injected member of MemberRunConfig:
//   - hook execution  → HookExecutorPort (runner-local DockerHookExecutor)
//   - runJS / appium  → injected `runJs` / `appiumScript` handlers (Q-2: parsing is
//                        pure in inline-steps.ts; execution touches adapter internals)
//   - accessibility   → injected `accessibilityCheck` handler (Q-4)
//   - failure shot    → injected `persistFailureScreenshot` writer
//   - secret resolve  → injected `resolveSecrets` fn for the nav URL (the CLI composes
//                        it from the secret store — the runner never touches the store)
//   - id minting      → a per-invocation crypto-free counter (no node:crypto)
//
// The inline-DSL pipeline order is load-bearing and preserved EXACTLY (Pitfall 5):
//   inline hooks (execute + merge vars + strip) → interpolation → runJS → the
//   unresolved-template check → executeStep. The retry loop wraps attempts inside the
//   member; testRetryScheduled fires between attempts; only the FINAL attempt's
//   TestResult leaves the member carrying retryCount (Pitfall 9 — per-attempt lifecycle
//   events reach the shell, but the shell emits the ONE authoritative testStarted/
//   testFinished pair).

import type { LanguageModel } from 'ai'
import { computeToolSchemaDigest } from '@vostride/agent-qa-schema'
import type { DeclaredModelProfile, MaskingContext } from '@vostride/agent-qa-schema'
import type { SafetyHookRunner } from '@vostride/agent-qa-safety'
import type { Action, ActionResult, PlatformAdapter, RuntimeAuthStateConfig } from '../platform.js'
import type { AccessibilityViolation, StepResult, TestResult } from '../result.js'
import type {
  EvidenceArtifactStorePort,
  LoopLogger,
  LoopPorts,
  ProcedureFlowCarry,
  ScreenshotCompressor,
  SecretRedactorPort,
  SecretResolver,
  WorkingMemoryPort,
} from '../loop/ports.js'
import type { ActionPlanCache } from '../cache/port.js'
import type { StorageStatePort } from '../storage-state/port.js'
import type { KnowledgeHintReader } from '../knowledge-hint-reader.js'
import type { UniqueValueGenerator } from '../compound/dispatch-mint.js'
import type {
  ExtractionMethod,
  Planner,
  PlannerConfig,
  StepContext as RunnerStepContext,
  VariableExtractor,
  Verifier,
} from '../loop/types.js'
import type { ConfigDigests, HookExecutorPort, MemberEventSink, MemberEvidenceContext } from './ports.js'
import type { HookDefinition } from '../hooks/types.js'
import { VariableStore } from '../variables/store.js'
import { interpolateVariables, interpolateVariablesWithProvenance, findUnresolvedTemplates } from '../variables/interpolate.js'
import { createExtractor } from '../variables/extractor.js'
import { executeStep as defaultExecuteStep } from '../loop/index.js'
import { withAbort, createTimeoutAbortReason, getTimeoutAbortReason } from '../loop/abort.js'
import { redactSecretValue } from '../loop/secrets.js'
import { parseHookInline, stripHookInline, parseRunJSInline, parseAppiumInline } from './inline-steps.js'
import { generateFailureSummary } from './failure-summary.js'
import { describeBoundSurface } from '../tools/builder.js'
import { defaultRegistry } from '../tools/index.js'
import { createStepReadFinalizer } from './step-read-finalization.js'

/** A single member-test step — a bare instruction or an object carrying per-step knobs. */
export interface MemberStepSpec {
  step: string
  timeout?: number
  capture?: {
    variable: string
    method?: ExtractionMethod
    pattern?: string
    selector?: string
    description?: string
  }
}

/** The runner-owned member-test shape (a core-independent subset of TestDefinition). */
export interface MemberTest {
  testId: string
  name: string
  filePath: string
  url?: string
  context?: string
  steps: Array<string | MemberStepSpec>
  meta?: { timeout?: number; retries?: number; [key: string]: unknown }
}

/** The injected runJS execution handler (Q-2). The CLI owns page.evaluate + platform checks. */
export type RunJsHandler = (
  code: string,
  ctx: { abortSignal: AbortSignal },
) => Promise<{ value: string; error?: string }>

/** The injected appium execution handler (Q-2). The CLI resolves secrets + calls the adapter. */
export type AppiumScriptHandler = (
  action: Action,
  ctx: { abortSignal: AbortSignal },
) => Promise<ActionResult>

/** The injected accessibility-check handler (Q-4). The CLI owns page acquisition + the web module. */
export type AccessibilityCheckHandler = (
  opts: { standard?: 'wcag2a' | 'wcag2aa' | 'wcag2aaa'; disableRules?: string[]; exclude?: string[] },
  ctx: { abortSignal: AbortSignal },
) => Promise<AccessibilityViolation[]>

/** The injected failure-screenshot writer. The CLI owns the adapter screenshot capture. */
export type FailureScreenshotWriter = (
  ctx: { abortSignal: AbortSignal },
) => Promise<Buffer | undefined>

/**
 * Everything runMemberTest needs, all injected at the CLI composition root. The sink,
 * abortSignal, and testIndex are the per-member context the shell binds (so runMemberTest
 * slots cleanly behind {@link MemberTestExecutor}); the rest are the run-scoped host impls
 * the CLI already builds for the loop.
 */
export interface MemberRunConfig {
  // --- loop host impls (assembled into LoopPorts) ---
  adapter: PlatformAdapter
  planner: Planner
  verifier?: Verifier
  cache?: ActionPlanCache
  masking?: MaskingContext
  modelProfiles?: {
    planner: DeclaredModelProfile
    verifier?: DeclaredModelProfile
  }
  onEvidenceContext?: (context: MemberEvidenceContext) => void
  workingMemory?: WorkingMemoryPort
  storageState?: StorageStatePort
  compressor?: ScreenshotCompressor
  safetyHooks?: SafetyHookRunner
  knowledgeReader?: KnowledgeHintReader
  knowledgeBudgets?: {
    brief: number
    searchResults: number
    caution: number
    readBody: number
    recordCap: number
  }
  knowledgeAsOfBuild?: number
  /**
   * 407 D-13 — the host's retrieval rung, resolved once at the composition root and threaded
   * verbatim onto every step's LoopPorts. Typed off LoopPorts so there is ONE spelling of the
   * contract between the run shell and the loop.
   */
  knowledgeRetrievalRung?: LoopPorts['knowledgeRetrievalRung']
  recordLedger?: LoopPorts['recordLedger']
  beginMemoryTurn?: LoopPorts['beginMemoryTurn']
  drainMemoryReadTraces?: LoopPorts['drainMemoryReadTraces']
  uniqueValueGenerator?: UniqueValueGenerator
  guardBlob?: (value: unknown) => string | undefined
  configDigests?: ConfigDigests
  evidenceArtifacts?: EvidenceArtifactStorePort

  // --- models ---
  plannerModel: LanguageModel
  verifierModel: LanguageModel

  // --- variable seeds (seeding order preserved: env → inline → suite → cli → hook) ---
  envFileVars?: Record<string, string>
  inlineVars?: Record<string, string>
  suiteVars?: Record<string, string>
  cliVars?: Record<string, string>
  hookSetupVars?: Record<string, string>

  // --- inline hooks ---
  hookExecutor?: HookExecutorPort
  inlineHookDefs?: Map<string, HookDefinition>
  hookEnvVars?: Record<string, string>
  hookSecretEnv?: Record<string, string>
  hookAuthState?: RuntimeAuthStateConfig

  // --- injected handlers (Q-2 / Q-4) ---
  runJs?: RunJsHandler
  appiumScript?: AppiumScriptHandler
  accessibilityCheck?: AccessibilityCheckHandler
  persistFailureScreenshot?: FailureScreenshotWriter

  // --- secrets (runner stays store-neutral: a fn + structural ports only) ---
  resolveSecrets?: (text: string) => string
  secretStore?: SecretResolver
  secretRedactor?: SecretRedactorPort

  // --- per-member context bound by the run shell ---
  sink: MemberEventSink
  testIndex: number
  abortSignal: AbortSignal

  // --- run config ---
  captureScreenshots?: boolean
  accessibility?: {
    enabled: boolean
    standard?: 'wcag2a' | 'wcag2aa' | 'wcag2aaa'
    runAfter?: 'every-step' | 'navigation' | 'test-end'
    failOnViolation?: boolean
    disableRules?: string[]
    exclude?: string[]
  }
  timeouts?: { step?: number; test?: number; navigation?: number }
  plannerConfig?: PlannerConfig
  logger?: LoopLogger
  logCapture?: { console?: boolean; network?: boolean }
  vision?: { screenshotSize?: number; effectiveResolution?: number }
  visionGate?: { attachImage: boolean; captureMode: 'full' | 'textOnly'; promptNote: string }
  contextWindow?: number
  suiteContext?: string
  resolveUploadPath?: (rawPath: string) => string

  // --- warn seam (the CLI routes this to the bus runWarning leg) ---
  onWarn?: (message: string) => void

  // --- testability seams (default to the runner-owned impls) ---
  executeStep?: typeof defaultExecuteStep
  extractorFactory?: (model: LanguageModel | undefined, method: string) => VariableExtractor
}

interface RerunContext {
  attempt: number
  previousFailureSummary?: string
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message)
  }
  return String(error)
}

function createAbortedStepResult(
  name: string,
  duration: number,
  signal: AbortSignal,
  action?: Action,
  observation = '',
  reasoning?: string,
): StepResult | undefined {
  if (!signal.aborted) return undefined
  const plannedAction = action ?? ({ type: 'waitFor', on: 'text', text: '', timeoutMs: 0 } as unknown as Action)
  const timeoutReason = getTimeoutAbortReason(signal)
  const error = timeoutReason?.message ?? 'Step cancelled by user'
  return {
    name,
    status: timeoutReason ? 'failed' : 'cancelled',
    duration,
    action: plannedAction,
    error,
    trace: {
      observation,
      reasoning: reasoning ?? error,
      plannedAction,
      result: 'failure',
      error,
      screenStateBefore: '',
    },
  }
}

/**
 * Run ONE member test (one attempt of the retry loop). Mirrors core's runTest per-test
 * flow verbatim, with every host concern injected. Emits stepStarted + the loop's
 * stepFinalized/subActionRecorded through the sink; NEVER emits testStarted/testFinished
 * (the shell owns those).
 */
async function runMemberAttempt(
  member: MemberTest,
  config: MemberRunConfig,
  toolSchemaDigest: string,
  rerunContext?: RerunContext,
): Promise<TestResult> {
  const startTime = performance.now()
  const steps: StepResult[] = []
  const previousSteps: {
    instruction: string
    outcome: string
    reasoning?: string
    plannedAction?: string
    verifierResponse?: string
  }[] = []

  const runnerLog = config.logger?.createScopedLogger('runner')
  // Pitfall 10 (display neutrality): the capture-over-non-capture warning routes through
  // the injected warn seam / scoped logger — the runner makes ZERO console calls.
  const variableStore = new VariableStore({
    onWarn: (message: string) => {
      config.onWarn?.(message)
      runnerLog?.warn(message)
    },
  })
  // Seeding order preserved: env → inline → suite → cli → hook (last write wins).
  if (config.envFileVars) variableStore.setAll(config.envFileVars, 'env')
  if (config.inlineVars) variableStore.setAll(config.inlineVars, 'inline')
  if (config.suiteVars) variableStore.setAll(config.suiteVars, 'suite')
  if (config.cliVars) variableStore.setAll(config.cliVars, 'cli')
  if (config.hookSetupVars) variableStore.setAll(config.hookSetupVars, 'hook')

  const executeStep = config.executeStep ?? defaultExecuteStep
  const makeExtractor = config.extractorFactory ?? createExtractor
  const resolveSecrets = config.resolveSecrets ?? ((text: string) => text)

  // Crypto-free per-invocation id minting (no node:crypto). Deterministic within a member.
  let idCounter = 0
  const makeId = (kind: string): string => `${kind}-t${config.testIndex}-${idCounter++}`

  let testFailed = false
  const testTimeout = (member.meta?.timeout as number | undefined) ?? config.timeouts?.test
  const testDeadline = testTimeout ? startTime + testTimeout : 0
  const testAbortController = new AbortController()
  const testDeadlineTimer = testTimeout
    ? setTimeout(() => {
        if (!testAbortController.signal.aborted) {
          testAbortController.abort(createTimeoutAbortReason('test', testTimeout))
        }
      }, testTimeout)
    : undefined

  // D-03: the run shell owns SIGINT (no per-test process.on here — the runner never
  // registers process-level handlers). The external abort chains into this test's abort.
  let cancelled = false
  let activeStepController: AbortController | undefined
  const cancelWith = (reason: Error) => {
    cancelled = true
    if (!testAbortController.signal.aborted) testAbortController.abort(reason)
    if (activeStepController && !activeStepController.signal.aborted) {
      activeStepController.abort(testAbortController.signal.reason ?? reason)
    }
  }
  const onExternalAbort = () =>
    cancelWith((config.abortSignal.reason as Error | undefined) ?? new Error('Test cancelled by run'))
  if (config.abortSignal.aborted) {
    onExternalAbort()
  } else {
    config.abortSignal.addEventListener('abort', onExternalAbort, { once: true })
  }

  // Navigate to the test URL (secret resolution via the injected fn — store-neutral).
  let shouldRunSteps = true
  if (member.url && !testAbortController.signal.aborted) {
    const interpolatedUrl = interpolateVariables(member.url, variableStore)
    const navigateAction = {
      type: 'navigate',
      to: 'url',
      url: resolveSecrets(interpolatedUrl),
    } as unknown as Action
    try {
      await withAbort(config.adapter.execute(navigateAction), testAbortController.signal)
    } catch (err) {
      const aborted = createAbortedStepResult(
        'Navigate to test URL',
        performance.now() - startTime,
        testAbortController.signal,
        navigateAction,
        '',
        'Navigate to test URL',
      )
      if (!aborted) throw err
      testFailed = aborted.status !== 'cancelled'
      shouldRunSteps = false
    }
  }

  // F-381-51-1 · D-09: the member-scoped procedure-flow carry cell. ONE shared mutable
  // object threaded by reference into every per-step ports literal (the recordLedger
  // precedent): a replay-recommended flow consumed at one test step re-arms the cell so the
  // NEXT step resumes the committed body at the carried cursor — one body step per test
  // step. Loop-side state only: never serialized, never in evidence or the handoff; its
  // lifetime is this test member.
  const procedureFlow: { carry?: ProcedureFlowCarry } = {}

  for (let stepIndex = 0; shouldRunSteps && stepIndex < member.steps.length; stepIndex++) {
    if (cancelled) break
    if (testDeadline && performance.now() >= testDeadline) {
      testFailed = true
      break
    }

    const stepDef = member.steps[stepIndex]
    const rawInstruction = typeof stepDef === 'string' ? stepDef : stepDef.step
    const perStepTimeout = typeof stepDef !== 'string' ? stepDef.timeout : undefined
    const stepTimeout = perStepTimeout ?? config.timeouts?.step
    const stepAbortController = new AbortController()
    activeStepController = stepAbortController
    const deadlineTimers: ReturnType<typeof setTimeout>[] = []
    const abortStepWithTestReason = () => {
      if (!stepAbortController.signal.aborted) {
        stepAbortController.abort(testAbortController.signal.reason ?? new Error('Test cancelled by user'))
      }
    }
    const abortForTimeout = (scope: 'test' | 'step', timeoutMs: number) => {
      if (!stepAbortController.signal.aborted) {
        stepAbortController.abort(createTimeoutAbortReason(scope, timeoutMs))
      }
    }
    const clearStepScope = () => {
      for (const timer of deadlineTimers) clearTimeout(timer)
      testAbortController.signal.removeEventListener('abort', abortStepWithTestReason)
      if (activeStepController === stepAbortController) activeStepController = undefined
    }
    if (testAbortController.signal.aborted) {
      abortStepWithTestReason()
    } else {
      testAbortController.signal.addEventListener('abort', abortStepWithTestReason, { once: true })
    }
    if (testDeadline && testTimeout) {
      const remainingTestTime = testDeadline - performance.now()
      if (remainingTestTime <= 0) abortForTimeout('test', testTimeout)
      else deadlineTimers.push(setTimeout(() => abortForTimeout('test', testTimeout), remainingTestTime))
    }
    if (stepTimeout) {
      deadlineTimers.push(setTimeout(() => abortForTimeout('step', stepTimeout), stepTimeout))
    }

    const stepId = makeId('step')
    const finalizer = createStepReadFinalizer(config, stepIndex, member.name, toolSchemaDigest)
    // Inline hooks and runJS are already work for this step. Announce it before either can
    // finish, fail, or abort; no step scope exists for a pre-start cancellation/deadline.
    config.sink.stepStarted({ stepIndex, stepText: rawInstruction })
    const recordResult = (result: StepResult) => {
      result.id = stepId
      result.variableSnapshot ??= variableStore.snapshot()
      finalizer.finish(result)
      steps.push(result)
    }

    // 1. INLINE HOOKS — execute BEFORE interpolation (D-04/D-07), merge vars, then strip.
    let inlineHookFailed = false
    let inlineHookAbortResult: StepResult | undefined
    if (config.hookExecutor && config.inlineHookDefs) {
      const executor = config.hookExecutor
      const inlineHookCalls = parseHookInline(rawInstruction)
      for (const call of inlineHookCalls) {
        const hookDef = config.inlineHookDefs.get(call.hookId)
        if (!hookDef) continue
        const hookExecId = makeId('hook')
        const allVars = Object.fromEntries(variableStore.getAll())
        config.sink.hookStarted({
          hookName: hookDef.name,
          phase: 'inline',
          hookExecutionId: hookExecId,
          hookId: hookDef.id,
          testIndex: config.testIndex,
          stepIndex,
        })
        try {
          const result = await withAbort(
            executor.execute(hookDef, {
              env: { ...config.hookEnvVars, ...allVars },
              secretEnv: config.hookSecretEnv ?? {},
              secretRedactor: config.secretRedactor,
              authState: config.hookAuthState,
            }),
            stepAbortController.signal,
          )
          config.sink.hookFinished({
            hookName: hookDef.name,
            phase: 'inline',
            hookExecutionId: hookExecId,
            hookId: hookDef.id,
            testIndex: config.testIndex,
            stepIndex,
            status: result.success ? 'passed' : 'failed',
            durationMs: result.duration,
            stdout: result.stdout,
            stderr: result.stderr,
            variables: result.variables,
            ...(result.error !== undefined ? { error: result.error } : {}),
            kind: 'hook',
          })
          if (result.success) {
            variableStore.setAll(result.variables, 'hook')
          } else {
            inlineHookFailed = true
            break
          }
        } catch (err) {
          const error = getErrorMessage(err)
          inlineHookAbortResult = createAbortedStepResult(
            rawInstruction,
            performance.now() - startTime,
            stepAbortController.signal,
          )
          config.sink.hookFinished({
            hookName: hookDef.name,
            phase: 'inline',
            hookExecutionId: hookExecId,
            hookId: hookDef.id,
            testIndex: config.testIndex,
            stepIndex,
            status: 'failed',
            durationMs: 0,
            stdout: '',
            stderr: '',
            variables: {},
            error,
            kind: 'hook',
          })
          inlineHookFailed = true
          break
        }
      }
    }

    if (inlineHookFailed) {
      recordResult(inlineHookAbortResult ?? {
        name: rawInstruction,
        status: 'failed',
        duration: 0,
        error: 'Inline hook execution failed',
        trace: {
          observation: '',
          reasoning: 'Inline hook execution failed before step could run',
          plannedAction: { type: 'waitFor', on: 'text', text: '', timeoutMs: 0 } as unknown as Action,
          result: 'failure',
          error: 'Inline hook execution failed',
          screenStateBefore: '',
        },
      })
      testFailed = inlineHookAbortResult?.status !== 'cancelled'
      clearStepScope()
      break
    }

    const instructionAfterHooks = config.hookExecutor && config.inlineHookDefs
      ? stripHookInline(rawInstruction)
      : rawInstruction

    // 2. INTERPOLATION — {{env:VAR}} resolves against the store (hooks already merged).
    const originalStepName = instructionAfterHooks
    // 381 D-03/D-08 (G-381-3): the provenance variant returns the SAME text plus the
    // binding names that produced it, so the name survives this pre-planning seam into
    // StepEvidence. Text semantics — and therefore hasTemplateVars — are unchanged.
    const interpolated = interpolateVariablesWithProvenance(instructionAfterHooks, variableStore)
    let instruction = interpolated.text
    const interpolatedVariables = interpolated.substitutions
    let hasTemplateVars = originalStepName !== instruction

    // 3. runJS — resolve on the interpolated text via the injected handler (Q-2).
    const runJSMatches = parseRunJSInline(instruction)
    let runJSAbortResult: StepResult | undefined
    if (runJSMatches.length > 0) {
      for (const match of runJSMatches) {
        if (!config.runJs) {
          instruction = instruction.replace(match.fullMatch, '[runJS error: no runJS handler available]')
          continue
        }
        const runJSStart = performance.now()
        let jsValue: string
        let jsError: string | undefined
        try {
          const out = await withAbort(
            config.runJs(match.code, { abortSignal: stepAbortController.signal }),
            stepAbortController.signal,
          )
          jsValue = out.value
          jsError = out.error
        } catch (err) {
          jsError = getErrorMessage(err)
          jsValue = `[runJS error: ${jsError}]`
        }
        instruction = instruction.replace(match.fullMatch, jsValue)
        config.sink.hookFinished({
          hookName: match.code.slice(0, 200),
          phase: 'inline',
          hookExecutionId: makeId('runjs'),
          testIndex: config.testIndex,
          stepIndex,
          status: jsError ? 'failed' : 'passed',
          durationMs: performance.now() - runJSStart,
          stdout: jsError ? '' : jsValue,
          stderr: jsError ?? '',
          variables: {},
          ...(jsError !== undefined ? { error: jsError } : {}),
          kind: 'runjs',
        })
        if (stepAbortController.signal.aborted) {
          runJSAbortResult = createAbortedStepResult(instruction, performance.now() - runJSStart, stepAbortController.signal)
          break
        }
      }
      hasTemplateVars = true
    }

    if (runJSAbortResult) {
      recordResult(runJSAbortResult)
      testFailed = runJSAbortResult.status !== 'cancelled'
      clearStepScope()
      break
    }

    // Parse the inline appium directive now (Q-2 execution rides the injected handler
    // below). An appium directive is a resolved runtime instruction — exempt it from the
    // unresolved-template check just as {{secret:...}} is (findUnresolvedTemplates flags any
    // {{...}}). Without this exemption the generic check would gate every appium step before
    // the handler runs (the latent core ordering that left inline appium unreachable).
    const appiumAction = parseAppiumInline(instruction)

    // 4. UNRESOLVED-TEMPLATE CHECK — fires AFTER runJS (Pitfall 5 ordering); skipped for
    // appium directives (resolved by the injected handler).
    const unresolvedTemplates = appiumAction ? [] : findUnresolvedTemplates(instruction)
    if (unresolvedTemplates.length > 0) {
      const errorLines = unresolvedTemplates.map(t => `  - ${t.pattern}: ${t.message}`)
      const errorMsg = `Unresolved template variable(s):\n${errorLines.join('\n')}`
      recordResult({
        name: instruction,
        status: 'failed',
        duration: 0,
        error: errorMsg,
        trace: {
          observation: '',
          reasoning: errorMsg,
          plannedAction: { type: 'waitFor', on: 'text', text: '', timeoutMs: 0 } as unknown as Action,
          result: 'failure',
          error: errorMsg,
          screenStateBefore: '',
        },
      })
      testFailed = true
      clearStepScope()
      break
    }

    runnerLog?.info('Step started', { stepIndex, totalSteps: member.steps.length, testName: member.name })

    const context: RunnerStepContext = {
      stepInstruction: instruction,
      testName: member.name,
      testContext: member.context,
      suiteContext: config.suiteContext,
      previousSteps: previousSteps.slice(-(config.plannerConfig?.previousStepCount ?? 5)),
      plannerModel: config.plannerModel,
      verifierModel: config.verifierModel,
      modelId:
        typeof config.plannerModel === 'object' && config.plannerModel && 'modelId' in config.plannerModel
          ? (config.plannerModel as { modelId: string }).modelId
          : undefined,
      variables: redactSecretValue(Object.fromEntries(variableStore.getAll()), config.secretRedactor),
      // Verbatim, deliberately unredacted — the emit fold matches these values by exact
      // string equality against the (also unmasked) plannedAction. Empty ⇒ nothing stamped.
      ...(interpolatedVariables.length > 0 ? { interpolatedVariables } : {}),
      isRerun: rerunContext !== undefined,
      rerunAttempt: rerunContext?.attempt,
      previousFailureSummary: rerunContext?.previousFailureSummary,
      plannerConfig: config.plannerConfig,
      contextWindow: config.contextWindow,
    }

    // Assemble the LoopPorts bundle (onPhase retired — the loop never called it).
    const ports: LoopPorts = {
      adapter: config.adapter,
      planner: config.planner,
      verifier: config.verifier,
      cache: config.cache,
      masking: config.masking,
      modelProfiles: config.modelProfiles,
      toolSchemaDigest,
      workingMemory: config.workingMemory,
      storageState: config.storageState,
      compressor: config.compressor,
      safetyHooks: config.safetyHooks,
      knowledgeReader: config.knowledgeReader,
      procedureFlow,
      knowledgeBudgets: config.knowledgeBudgets,
      knowledgeAsOfBuild: config.knowledgeAsOfBuild,
      knowledgeRetrievalRung: config.knowledgeRetrievalRung,
      recordLedger: config.recordLedger,
      beginMemoryTurn: config.beginMemoryTurn,
      drainMemoryReadTraces: config.drainMemoryReadTraces,
      uniqueValueGenerator: config.uniqueValueGenerator,
      guardBlob: config.guardBlob,
      plannerConfig: config.plannerConfig,
      stepTimeout,
      logger: config.logger,
      logCapture: config.logCapture,
      vision: config.vision,
      visionGate: config.visionGate,
      onSetVariable: (name: string, value: string) => variableStore.set(name, value, 'step'),
      resolveUploadPath: config.resolveUploadPath,
      abortSignal: stepAbortController.signal,
      secretStore: config.secretStore,
      secretRedactor: config.secretRedactor,
      events: finalizer.events,
      configDigests: config.configDigests,
      evidenceArtifacts: config.evidenceArtifacts,
    }

    let result: StepResult
    try {
      // 5. EXECUTE — appium rides the injected handler (Q-2); otherwise the loop.
      if (appiumAction && config.appiumScript) {
        const stepStart = performance.now()
        try {
          const actionResult = await withAbort(
            config.appiumScript(appiumAction, { abortSignal: stepAbortController.signal }),
            stepAbortController.signal,
          )
          result = {
            name: instruction,
            status: actionResult.success ? 'passed' : 'failed',
            duration: performance.now() - stepStart,
            action: redactSecretValue(appiumAction, config.secretRedactor),
            error: redactSecretValue(actionResult.error, config.secretRedactor),
            trace: {
              observation: 'Inline appium command (LLM bypassed)',
              reasoning: 'Direct execution of {{appium: ...}} syntax',
              plannedAction: redactSecretValue(appiumAction, config.secretRedactor),
              result: actionResult.success ? 'success' : 'failure',
              error: redactSecretValue(actionResult.error, config.secretRedactor),
              screenStateBefore: '',
            },
          }
          if (actionResult.data !== undefined) {
            result.observation = `Script returned: ${JSON.stringify(actionResult.data)}`
          }
        } catch (err) {
          result = createAbortedStepResult(
            instruction,
            performance.now() - stepStart,
            stepAbortController.signal,
            appiumAction,
            'Inline appium command (LLM bypassed)',
            'Direct execution of {{appium: ...}} syntax',
          ) ?? {
            name: instruction,
            status: 'failed',
            duration: performance.now() - stepStart,
            action: appiumAction,
            error: getErrorMessage(err),
            trace: {
              observation: 'Inline appium command (LLM bypassed)',
              reasoning: 'Direct execution of {{appium: ...}} syntax',
              plannedAction: appiumAction,
              result: 'failure',
              error: getErrorMessage(err),
              screenStateBefore: '',
            },
          }
        }
      } else {
        // The real loop owns its abort funnel and must finish recording before publication.
        // An injected executor may not cooperate, so only that seam needs an outer race.
        const execution = executeStep(instruction, ports, context)
        result = config.executeStep
          ? await withAbort(execution, stepAbortController.signal)
          : await execution
      }

      result.originalStepName = hasTemplateVars ? originalStepName : undefined
      const abortResultForCurrentStep = () =>
        createAbortedStepResult(
          result.name,
          result.duration,
          stepAbortController.signal,
          result.action,
          result.trace?.observation,
          result.trace?.reasoning,
        )

      const abortedAfterExecution = abortResultForCurrentStep()
      if (abortedAfterExecution) result = abortedAfterExecution

      // Failure/after screenshot via the injected writer.
      if (config.captureScreenshots === true && stepAbortController.signal.aborted) {
        const aborted = abortResultForCurrentStep()
        if (aborted) result = aborted
      } else if (config.captureScreenshots === true && config.persistFailureScreenshot) {
        try {
          const screenshot = await withAbort(
            config.persistFailureScreenshot({ abortSignal: stepAbortController.signal }),
            stepAbortController.signal,
          )
          if (screenshot) result.screenshot = screenshot
        } catch (err) {
          const aborted = abortResultForCurrentStep()
          if (aborted) result = aborted
          else throw err
        }
      }

      // Accessibility check via the injected handler (web only, when enabled).
      if (
        !stepAbortController.signal.aborted
        && config.accessibility?.enabled
        && config.adapter.platform === 'web'
        && config.accessibilityCheck
      ) {
        const runAfter = config.accessibility.runAfter ?? 'every-step'
        const shouldRun =
          runAfter === 'every-step' || (runAfter === 'test-end' && stepIndex === member.steps.length - 1)
        if (shouldRun) {
          try {
            const violations = await withAbort(
              config.accessibilityCheck(
                {
                  standard: config.accessibility.standard,
                  disableRules: config.accessibility.disableRules,
                  exclude: config.accessibility.exclude,
                },
                { abortSignal: stepAbortController.signal },
              ),
              stepAbortController.signal,
            )
            result.accessibilityViolations = violations
            if (config.accessibility.failOnViolation && violations.length > 0) {
              const critical = violations.filter(v => v.impact === 'critical').length
              const serious = violations.filter(v => v.impact === 'serious').length
              if (critical + serious > 0) {
                result.status = 'failed'
                result.error = `Accessibility violations found: ${critical} critical, ${serious} serious`
              }
            }
          } catch {
            const aborted = abortResultForCurrentStep()
            if (aborted) result = aborted
            // else: never fail the step on an accessibility-check error.
          }
        }
      }

      // Capture — via the injected verifier model (createExtractor threads it, Q-2 idiom).
      if (result.status !== 'failed' && typeof stepDef !== 'string' && stepDef.capture) {
        const method = stepDef.capture.method ?? 'ai'
        const extractor = makeExtractor(config.verifierModel, method)
        try {
          const screenState = await withAbort(config.adapter.observe(), stepAbortController.signal)
          const captureResult = await withAbort(
            extractor.extract(
              {
                method,
                variableName: stepDef.capture.variable,
                pattern: stepDef.capture.pattern,
                selector: stepDef.capture.selector,
                description: stepDef.capture.description,
              },
              screenState,
            ),
            stepAbortController.signal,
          )
          if (captureResult.success && captureResult.value) {
            variableStore.set(captureResult.variableName, captureResult.value)
            result.capturedVariables = { [captureResult.variableName]: captureResult.value }
          }
        } catch (err) {
          const aborted = abortResultForCurrentStep()
          if (aborted) result = aborted
          else throw err
        }
      }

      result.variableSnapshot = variableStore.snapshot()
      result = redactSecretValue(result, config.secretRedactor)

      if (result.status === 'failed') {
        runnerLog?.warn('Step failed', { stepIndex, status: result.status, duration: result.duration, error: result.error })
      } else {
        runnerLog?.info('Step completed', { stepIndex, status: result.status, duration: result.duration })
      }

      // Per-step device-log drain BEFORE persistence.
      const adapterWithPoll = config.adapter as { pollDeviceLogs?: () => Promise<void> }
      if (!stepAbortController.signal.aborted && typeof adapterWithPoll.pollDeviceLogs === 'function') {
        try {
          await withAbort(adapterWithPoll.pollDeviceLogs(), stepAbortController.signal)
        } catch (err) {
          const aborted = abortResultForCurrentStep()
          if (aborted) result = aborted
          finalizer.consoleFailed()
        }
      }
      finalizer.captureConsole(result, stepAbortController.signal)
      await finalizer.captureNetwork(result, stepAbortController.signal)
      const abortedAfterCapture = abortResultForCurrentStep()
      if (abortedAfterCapture) result = { ...result, ...abortedAfterCapture }

      result.id = stepId
    } catch (error) {
      result = createAbortedStepResult(instruction, 0, stepAbortController.signal) ?? {
        name: instruction, status: 'failed', duration: 0, error: getErrorMessage(error),
      }
    } finally {
      clearStepScope()
    }

    recordResult(result)

    if (result.status === 'failed') {
      testFailed = true
      break
    }

    const outcomeParts: string[] = [result.status]
    if (result.capturedVariables) {
      outcomeParts.push(
        `(captured: ${Object.entries(result.capturedVariables).map(([k, v]) => `${k}=${v}`).join(', ')})`,
      )
    }
    previousSteps.push({
      instruction,
      outcome: outcomeParts.join(' '),
      reasoning: result.trace?.reasoning || undefined,
      plannedAction: result.trace?.plannedAction ? String(result.trace.plannedAction.type) : undefined,
      verifierResponse: result.trace?.verifierReasoning,
    })
  }

  const adapterFlags = config.adapter as { isBrowserDisconnected?: boolean; getVideoPath?: () => Promise<string | undefined> }
  const isDisconnected = adapterFlags.isBrowserDisconnected === true

  let videoPath: string | undefined
  if (typeof adapterFlags.getVideoPath === 'function') {
    try {
      videoPath = (await adapterFlags.getVideoPath()) ?? undefined
    } catch {
      // ignore video-path capture failure
    }
  }

  const failureSummary = isDisconnected
    ? 'Browser closed by user'
    : testFailed
      ? generateFailureSummary(steps)
      : cancelled
        ? `Test cancelled after ${steps.length} step(s)`
        : undefined

  config.abortSignal.removeEventListener('abort', onExternalAbort)
  if (testDeadlineTimer) clearTimeout(testDeadlineTimer)

  return {
    runId: undefined,
    name: member.name,
    filePath: member.filePath,
    status: cancelled ? 'cancelled' : isDisconnected ? 'cancelled' : testFailed ? 'failed' : 'passed',
    steps,
    duration: performance.now() - startTime,
    metadata: member.meta as Record<string, unknown> | undefined,
    videoPath,
    failureSummary: failureSummary || undefined,
  }
}

/**
 * Run a member test with the retry loop (D-13). The trigger stays `meta.retries`
 * (user-config surface unchanged). Attempts run INSIDE the member; `testRetryScheduled`
 * fires between attempts (a per-test accumulation reset for subscribers); only the FINAL
 * attempt's TestResult leaves the member carrying `retryCount` (Pitfall 9 — the shell
 * emits the single authoritative testStarted/testFinished pair per member).
 */
export async function runMemberTest(
  member: MemberTest,
  config: MemberRunConfig,
): Promise<TestResult> {
  const startTime = performance.now()
  const toolSchemaDigest = computeToolSchemaDigest(describeBoundSurface(defaultRegistry, {
    platform: config.adapter.platform,
  }))
  const verifierProfile = config.modelProfiles?.verifier
  config.onEvidenceContext?.({
    ...(config.modelProfiles?.planner !== undefined
      ? { modelProfile: config.modelProfiles.planner }
      : {}),
    ...(verifierProfile !== undefined
      ? { verifierIdentity: { provider: verifierProfile.provider, modelId: verifierProfile.modelId } }
      : {}),
    toolSchemaDigest,
  })
  const maxRetries = (member.meta?.retries as number | undefined) ?? 0
  let lastResult: TestResult | undefined
  let firstFailedAttempt: TestResult['firstFailedAttempt']
  let previousFailureSummary: string | undefined

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      config.sink.testRetryScheduled({
        testId: member.testId,
        testIndex: config.testIndex,
        attempt,
        maxAttempts: maxRetries + 1,
        ...(previousFailureSummary !== undefined ? { reason: previousFailureSummary } : {}),
      })
    }
    const rerunContext: RerunContext | undefined = attempt > 0 ? { attempt, previousFailureSummary } : undefined
    const result = await runMemberAttempt(member, config, toolSchemaDigest, rerunContext)

    if (result.status === 'passed') {
      return {
        ...result, duration: performance.now() - startTime, retryCount: attempt,
        ...(firstFailedAttempt !== undefined ? { firstFailedAttempt } : {}),
      }
    }

    if (firstFailedAttempt === undefined && result.status === 'failed' && attempt < maxRetries) {
      // Detach before another attempt can mutate adapter/step evidence. Only one attempt is
      // retained; the snapshot cannot contain another retry snapshot (420 D-06).
      const { firstFailedAttempt: _nested, ...original } = result
      firstFailedAttempt = { attempt, result: structuredClone(original) }
    }
    lastResult = result
    previousFailureSummary = result.failureSummary || undefined
  }

  return {
    ...lastResult!, duration: performance.now() - startTime, retryCount: maxRetries,
    ...(firstFailedAttempt !== undefined ? { firstFailedAttempt } : {}),
  }
}
