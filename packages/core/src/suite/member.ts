import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { TestResult, MemberEventSink, ConfigDigests } from '@vostride/agent-qa-runner'
import type { SafetyHookRunner } from '@vostride/agent-qa-safety'
import type { TestDefinition } from '../types/test.js'
import type { SuiteDefinition } from './types.js'
import type { RunSuiteConfig } from './runner.js'
import type { MultiReporter } from '../reporter/types.js'
import { runTest } from '../agent/runner.js'
import { runHooks } from '@vostride/agent-qa-runner'
import { runCurator } from '../memory/curator.js'
import type { HookDefinition } from '@vostride/agent-qa-runner'
import type { MemoryIndexParams } from '../memory/memory-index.js'
import { generateRunId } from '../ids/run-id.js'
import pc from 'picocolors'

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val)
}

function deepMerge(base: unknown, override: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(override)) return override
  const result: Record<string, unknown> = { ...base }
  for (const key of Object.keys(override)) {
    if (key in result && isPlainObject(result[key]) && isPlainObject(override[key])) {
      result[key] = deepMerge(result[key], override[key])
    } else {
      result[key] = override[key]
    }
  }
  return result
}

/**
 * Merge the suite's target/use into a member test and strip its own `url` (the suite owns
 * startup navigation). Moved here from suite/runner.ts as part of the D-01 per-member body
 * extraction — the only caller is {@link executeSuiteMember}.
 */
export function patchTestForSuite(
  test: TestDefinition,
  suite: SuiteDefinition,
  _index: number,
): TestDefinition {
  const patched = structuredClone(test)

  if (suite.target) {
    ;(patched as any).target = suite.target
  }

  if (suite.use && (patched as any).use) {
    ;(patched as any).use = deepMerge(suite.use, (patched as any).use)
  } else {
    ;(patched as any).use = (patched as any).use ?? suite.use
  }

  delete (patched as any).url

  return patched
}

function printMemoryStatus(log: { added: number; confirmed: number; deprecated: number; errors: string[]; curatorDuration: number }): void {
  const parts: string[] = []
  if (log.added > 0) parts.push(pc.green(`${log.added} added`))
  if (log.confirmed > 0) parts.push(`${log.confirmed} confirmed`)
  if (log.deprecated > 0) parts.push(pc.yellow(`${log.deprecated} deprecated`))
  if (parts.length === 0) parts.push('no changes')
  const secs = log.curatorDuration >= 1000 ? `${Math.round(log.curatorDuration / 1000)}s` : `${log.curatorDuration}ms`
  console.log(`  ${pc.dim('Memory:')} ${parts.join(', ')} ${pc.dim(`(${secs})`)}`)
  for (const err of log.errors) {
    console.log(`  ${pc.dim('Memory:')} ${pc.yellow(`warning -- ${err}`)}`)
  }
}

/**
 * Everything one suite member consumes (D-01 extraction). Derived directly from the runSuite
 * loop body — the run-scoped values (`suiteRunId`, `suiteHookVars`, `suiteSandboxOptions`,
 * `suiteArtifact`, `memoryEnabled`, `memoryRoot`, the shared `reporter`) are resolved once by
 * `runSuite` before iteration and threaded in; per-member values (`test`, `filePath`, `index`)
 * change each iteration. Plan 10's CLI executor closure builds this same input around core's
 * per-test machinery, wrapping ONE audited function instead of replicating the loop body.
 */
export interface SuiteMemberInput {
  suite: SuiteDefinition
  test: TestDefinition
  filePath: string
  index: number
  totalTests: number
  config: RunSuiteConfig
  reporter: MultiReporter | undefined
  suiteRunId: string
  suiteHookVars: Record<string, string>
  suiteSandboxOptions: RunSuiteConfig['sandboxOptions']
  suiteArtifact: Record<string, unknown> | undefined
  memoryEnabled: boolean
  memoryRoot: string
  /**
   * Run-shell ctx seams (D-02/D-03/D-20), supplied by the Plan 10 CLI executor closure and
   * threaded straight through into `runTest`. All optional — absent ⇒ byte-identical to the
   * runSuite path (the runSuite caller supplies none). `events`/`abortSignal` come from the
   * shell's per-member `MemberTestRunContext`; `configDigests` is the member's cache pair from
   * the composition root's ONE digest mint so the cache keys on real digests end-to-end.
   */
  events?: MemberEventSink
  abortSignal?: AbortSignal
  configDigests?: ConfigDigests
  /**
   * The per-run v48 SafetyHookRunner (D-04, RESEARCH Open Q1). Captured lexically at the CLI
   * composition root and threaded straight into `runTest`'s already-wired `config.safetyHooks`
   * slot (which carries it into `LoopPorts`). This additive `SuiteMemberInput` field is the
   * whole threading path — runner's `RunConfig`/`MemberTestRunContext` deliberately gain NO
   * safety channel (zero runner-surface change). Absent ⇒ byte-identical to the runSuite path.
   */
  safetyHooks?: SafetyHookRunner
}

/**
 * The per-member body of `runSuite`, extracted verbatim so it has a single home (D-01): patch
 * the test for the suite, mint the child runId + fire `onTestStart` with the suite-child
 * artifact, run per-member setup hooks, call `runTest` with the threaded port set (incl. the
 * Plan-09 events/abortSignal/configDigests seams the CLI closure can supply), run per-member
 * teardown hooks, and run the memory curator on the result.
 *
 * Returns the member's {@link TestResult}. Iteration, fail-fast, skip synthesis, and aggregation
 * stay in `runSuite` (the shell's job under D-01). A per-test SETUP-hook failure returns a failed
 * result tagged `metadata.phase: 'per-test-setup'` so `runSuite` breaks without synthesizing
 * skips — preserving today's setup-failure control flow (the phase tag adopts runSuite's existing
 * synthetic-failure idiom; `runTest` is never called in that branch, so this fires `onTestEnd`).
 */
export async function executeSuiteMember(input: SuiteMemberInput): Promise<TestResult> {
  const {
    suite,
    test,
    filePath,
    index: i,
    totalTests,
    config,
    reporter,
    suiteRunId,
    suiteHookVars,
    suiteSandboxOptions,
    suiteArtifact,
    memoryEnabled,
    memoryRoot,
    events,
    abortSignal,
    configDigests,
    safetyHooks,
  } = input

  const patched = patchTestForSuite(test, suite, i)

  // Fire onTestStart BEFORE per-test setup hooks so DashboardReporter creates
  // the DB row and runId is available for hook recording (Phase 107 fix)
  const suiteMembers = (suiteArtifact?.source as { members?: unknown[] } | undefined)?.members
  const memberArtifact = Array.isArray(suiteMembers) ? suiteMembers[i] : undefined
  const childRunId = generateRunId()
  await reporter?.onTestStart?.(patched, filePath, {
    runId: childRunId,
    parentRunId: suiteRunId,
    artifact: {
      kind: 'suite-child',
      suiteIndex: i,
      source: {
        kind: 'test',
        ...(memberArtifact && typeof memberArtifact === 'object' ? memberArtifact as Record<string, unknown> : {}),
        resolvedDefinition: patched,
        loadStatus: 'loaded',
      },
      config: suiteArtifact?.config,
      runtime: {
        platform: config.platformConfig.platform,
        suiteIndex: i,
        suiteTotal: totalTests,
        parentSuiteId: (suite as any)['suite-id'] ?? suite.name,
      },
    },
  } as any)

  // Per-test setup hooks (before each test, D-01/D-03)
  let perTestHookVars: Record<string, string> = {}
  let perTestSetupFailed = false
  if ((patched as any).setup?.length && config.resolvedHooks && suiteSandboxOptions) {
    const hookDefs: HookDefinition[] = []
    let hookMissing = false
    for (const hookId of (patched as any).setup) {
      const hook = config.resolvedHooks.get(hookId)
      if (!hook) { hookMissing = true; break }
      hookDefs.push(hook)
    }

    if (!hookMissing && hookDefs.length > 0) {
      const allVars: Record<string, string> = {}
      if (config.envFileVars) Object.assign(allVars, config.envFileVars)
      if (config.inlineVars) Object.assign(allVars, config.inlineVars)
      if (config.cliVars) Object.assign(allVars, config.cliVars)
      Object.assign(allVars, suiteHookVars)

      for (const hookDef of hookDefs) {
        const hookExecId = randomUUID()
        await reporter?.onHookStart?.({ hookId: hookDef.id, hookName: hookDef.name, phase: 'setup', hookExecutionId: hookExecId, runId: childRunId })
        const hookResult = await runHooks([hookDef], {
          ...suiteSandboxOptions,
          secretStore: config.secretStore,
          secretRedactor: config.secretRedactor,
          envVars: { ...suiteSandboxOptions.envVars, ...allVars, ...perTestHookVars },
          emit: events,
          identity: { phase: 'setup', scope: 'test', testIndex: i },
        })
        const hr = hookResult.results.get(hookDef.name)
        await reporter?.onHookEnd?.({
          hookId: hookDef.id, hookName: hookDef.name, phase: 'setup', hookExecutionId: hookExecId,
          runId: childRunId,
          status: hr?.success ? 'passed' : 'failed',
          duration: hr?.duration ?? 0, stdout: hr?.stdout ?? '', stderr: hr?.stderr ?? '',
          variables: hr?.variables ?? {}, error: hr?.error,
        })
        if (!hr?.success) { hookMissing = true; break }
        Object.assign(perTestHookVars, hr.variables)
        Object.assign(allVars, hr.variables)
      }
    }

    if (hookMissing) perTestSetupFailed = true
  }

  if (perTestSetupFailed) {
    const setupFailureResult: TestResult = {
      runId: childRunId,
      name: test.name, filePath, status: 'failed', steps: [],
      duration: 0, failureSummary: 'Setup hook failed',
      metadata: { phase: 'per-test-setup' },
    }
    await reporter?.onTestEnd(setupFailureResult)
    return setupFailureResult
  }

  let testFileContent = ''
  try { testFileContent = await readFile(filePath, 'utf-8') } catch { /* best-effort */ }

  const memoryInitParams: MemoryIndexParams | undefined = memoryEnabled ? {
    product: config.product!,
    testId: (test as any)['test-id'] ?? test.name,
    memoryRoot,
    suiteId: (suite as any)['suite-id'] ?? suite.name,
    currentSuiteTests: suite.tests as Array<{ test: string; id: string }>,
    currentPosition: i,
  } : undefined

  const result = await runTest(patched, {
    adapter: config.adapter,
    planner: config.planner,
    verifier: config.verifier,
    cache: config.cache,
    masking: config.masking,
    workingMemory: config.workingMemory,
    storageState: config.storageState,
    compressor: config.compressor,
    plannerModel: config.plannerModel,
    verifierModel: config.verifierModel,
    reporters: config.reporters,
    captureScreenshots: config.captureScreenshots,
    screenshotMode: config.screenshotMode,
    timeouts: config.timeouts,
    logger: config.logger,
    configContent: config.configContent,
    testFileContent,
    suiteFileContent: config.suiteFileContent,
    suiteTestIndex: i,
    suiteContext: (suite as any).context,
    envFileVars: config.envFileVars,
    inlineVars: config.inlineVars,
    suiteVars: suiteHookVars,
    cliVars: config.cliVars,
    hookSetupVars: perTestHookVars,
    inlineHookDefs: config.resolvedHooks,
    inlineHookSandboxOptions: suiteSandboxOptions,
    secretStore: config.secretStore,
    secretRedactor: config.secretRedactor,
    accessibility: config.accessibility,
    accessibilityCheck: config.accessibilityCheck,
    logCapture: config.logCapture,
    vision: config.vision,
    visionGate: config.visionGate,
    memoryProvider: memoryEnabled ? config.memoryProvider : undefined,
    memoryInitParams,
    skipReporterOnTestStart: true,
    runId: childRunId,
    parentRunId: suiteRunId,
    // D-02/D-03/D-20 run-shell seams (absent ⇒ byte-identical to the runSuite path).
    events,
    abortSignal,
    configDigests,
    // D-04/Open-Q1: the per-run SafetyHookRunner reaches core's already-wired
    // config.safetyHooks → LoopPorts line here (runner surface unchanged).
    safetyHooks,
  }, filePath)
  if (!result.runId) result.runId = childRunId

  // Per-test teardown hooks (after each test, D-01/D-03)
  if ((patched as any).teardown?.length && config.resolvedHooks && suiteSandboxOptions) {
    for (const hookId of (patched as any).teardown) {
      const hook = config.resolvedHooks.get(hookId)
      if (!hook) continue
      const hookExecId = randomUUID()
      try {
        await reporter?.onHookStart?.({ hookId: hook.id, hookName: hook.name, phase: 'teardown', hookExecutionId: hookExecId, runId: childRunId })
        const teardownVars: Record<string, string> = {}
        if (config.envFileVars) Object.assign(teardownVars, config.envFileVars)
        if (config.cliVars) Object.assign(teardownVars, config.cliVars)
        Object.assign(teardownVars, suiteHookVars, perTestHookVars)
        const hookResult = await runHooks([hook], {
          ...suiteSandboxOptions,
          secretStore: config.secretStore,
          secretRedactor: config.secretRedactor,
          envVars: { ...suiteSandboxOptions.envVars, ...teardownVars },
          emit: events,
          identity: { phase: 'teardown', scope: 'test', testIndex: i },
        })
        const hr = hookResult.results.get(hook.name)
        await reporter?.onHookEnd?.({
          hookId: hook.id, hookName: hook.name, phase: 'teardown', hookExecutionId: hookExecId,
          runId: childRunId,
          status: hr?.success ? 'passed' : 'failed',
          duration: hr?.duration ?? 0, stdout: hr?.stdout ?? '', stderr: hr?.stderr ?? '',
          variables: hr?.variables ?? {}, error: hr?.error,
        })
      } catch {}
    }
  }

  if (memoryEnabled && config.memoryProvider) {
    // D-10: the memory-ablation re-run and the circuit breaker are deleted — no
    // ablation second-attempt, no runaway-mitigation counters. The suite path stays
    // single-attempt (Assumption A3); the curator runs unconditionally on the result.
    if (config.memoryConfig?.curatorEnabled !== false) {
      try {
        const injectedObservationIds = new Map<number, string[]>()
        for (let si = 0; si < result.steps.length; si++) {
          const ids = config.memoryProvider.getInjectedObservations(si)
          if (ids.length > 0) injectedObservationIds.set(si, ids)
        }
        const suiteId = (suite as any)['suite-id'] ?? suite.name
        const testId = (test as any)['test-id'] ?? test.name
        const memoryLog = await runCurator({
          testResult: result,
          provider: config.memoryProvider,
          model: config.plannerModel,
          memoryRoot,
          product: config.product!,
          testId,
          suiteId,
          suiteContext: {
            tests: suite.tests as Array<{ test: string; id: string }>,
            position: i,
          },
          injectedObservationIds,
          trustConfirmDelta: config.memoryConfig?.trustConfirmDelta,
          trustContradictDelta: config.memoryConfig?.trustContradictDelta,
        })
        ;(result as any).memoryLog = memoryLog
        printMemoryStatus(memoryLog)
        config.onCuratorComplete?.(test.name, memoryLog)
      } catch (err) {
        console.warn(`  ${pc.dim('Memory:')} curator error -- ${(err as Error).message}`)
      }
    }
  }

  return result
}
