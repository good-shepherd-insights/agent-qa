import { randomUUID } from 'node:crypto'
import type { PlatformAdapter, PlatformConfig, RuntimeAuthStateConfig } from '@vostride/agent-qa-runner'
import type { TestResult } from '@vostride/agent-qa-runner'
import type { TestDefinition } from '../types/test.js'
import type { SuiteDefinition, SuiteResult } from './types.js'
import type { Reporter, RunSummary, SuiteSummary } from '../reporter/types.js'
import { MultiReporter } from '../reporter/types.js'
import type { RunTestConfig } from '../agent/runner.js'
import { executeSuiteMember } from './member.js'
import type { ActionPlanCache, Planner, Verifier } from '@vostride/agent-qa-runner'
import type { MaskingContext } from '@vostride/agent-qa-schema'
import type { LanguageModel } from 'ai'
import type { LogManager } from '../logging/log-manager.js'
import { runHooks, type HookDefinition, type SandboxRunnerOptions } from '@vostride/agent-qa-runner'
import type { MemoryProvider } from '../memory/provider.js'
import type { MemoryLog } from '../memory/curator.js'
import { DEFAULT_MEMORY_DIR } from '../memory/config.js'
import { VariableStore, findUnresolvedTemplates, interpolateVariables } from '../agent/variables.js'
import { resolveSecretTemplatesInValue, type SecretRedactor, type SecretStore } from '@vostride/agent-qa-runner'
import { withAbort } from '@vostride/agent-qa-runner'
import { generateRunId } from '../ids/run-id.js'

export interface RunSuiteConfig {
  runId?: string
  adapter: PlatformAdapter
  platformConfig: PlatformConfig
  planner: Planner
  verifier?: Verifier
  cache?: ActionPlanCache
  /** D-05 masking seam threaded through to each test's runner loop (identity pre-362). */
  masking?: MaskingContext
  /**
   * WM-01 run-scoped working-memory store (Phase 358). ONE store spans all suite member tests
   * (run-scoped, not test-scoped) and is threaded into each test's runner loop; the CLI flushes
   * it once at suite end.
   */
  workingMemory?: RunTestConfig['workingMemory']
  /**
   * D-14 storage-state store (Phase 360). ONE run-scoped store spans all suite member tests and is
   * threaded into each test's runner loop; the CLI constructs it at the composition root.
   */
  storageState?: RunTestConfig['storageState']
  plannerModel: LanguageModel
  verifierModel: LanguageModel
  reporters?: Reporter[]
  captureScreenshots?: boolean
  screenshotMode?: 'failure' | 'every-step'
  timeouts?: { step?: number; test?: number; navigation?: number }
  logger?: LogManager
  configContent?: string
  suiteFileContent?: string
  envFileVars?: Record<string, string>
  inlineVars?: Record<string, string>
  cliVars?: Record<string, string>
  resolvedHooks?: Map<string, HookDefinition>
  sandboxOptions?: SandboxRunnerOptions
  logCapture?: { console?: boolean; network?: boolean }
  accessibility?: RunTestConfig['accessibility']
  accessibilityCheck?: RunTestConfig['accessibilityCheck']
  vision?: { screenshotSize?: number; effectiveResolution?: number }
  /** Vision gate resolved once per run at the composition root (D-11); passed through to each test. */
  visionGate?: { attachImage: boolean; captureMode: 'full' | 'textOnly'; promptNote: string }
  memoryProvider?: MemoryProvider
  memoryRoot?: string
  memoryConfig?: {
    enabled?: boolean
    curatorEnabled?: boolean
    trustConfirmDelta?: number
    trustContradictDelta?: number
  }
  product?: string
  createAdapter?: () => Promise<PlatformAdapter>
  resolveUrl?: (targetName: string) => string | undefined
  onCuratorComplete?: (testName: string, memoryLog: MemoryLog) => void
  artifactContext?: Record<string, unknown>
  authStateCapture?: {
    capture: () => Promise<RuntimeAuthStateConfig>
    failureSummary: string
  }
  secretStore?: SecretStore
  secretRedactor?: SecretRedactor
}

function resolveSuiteStartUrl(
  rawUrl: string,
  config: RunSuiteConfig,
  suiteHookVars: Record<string, string>,
): { url?: string; error?: string } {
  const variableStore = new VariableStore()
  if (config.envFileVars) variableStore.setAll(config.envFileVars, 'env')
  if (config.inlineVars) variableStore.setAll(config.inlineVars, 'inline')
  if (config.cliVars) variableStore.setAll(config.cliVars, 'cli')
  if (Object.keys(suiteHookVars).length > 0) variableStore.setAll(suiteHookVars, 'hook')

  const interpolatedUrl = interpolateVariables(rawUrl, variableStore)
  const unresolved = findUnresolvedTemplates(interpolatedUrl)
  if (unresolved.length > 0) {
    const details = unresolved.map(item => `- ${item.pattern}: ${item.message}`).join('\n')
    return { error: `Suite target URL has unresolved variable(s):\n${details}` }
  }

  try {
    return { url: resolveSecretTemplatesInValue(interpolatedUrl, config.secretStore) }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

export async function runSuite(
  suite: SuiteDefinition,
  testEntries: [TestDefinition, string][],
  config: RunSuiteConfig,
): Promise<SuiteResult> {
  const startTime = performance.now()
  const results: TestResult[] = []
  const reporter = config.reporters?.length ? new MultiReporter(config.reporters) : undefined
  const suiteRunId = config.runId ?? process.env.AGENT_QA_SUITE_QUEUE_ID ?? generateRunId()
  let suiteSandboxOptions = config.sandboxOptions && config.platformConfig.authState
    ? { ...config.sandboxOptions, authState: config.platformConfig.authState }
    : config.sandboxOptions

  const suiteArtifact = (config.artifactContext as { artifact?: Record<string, unknown> } | undefined)?.artifact
    ?? config.artifactContext

  await reporter?.onSuiteStart(suite, {
    runId: suiteRunId,
    artifact: suiteArtifact ? { kind: 'suite-parent', ...suiteArtifact } : { kind: 'suite-parent' },
  } as any)

  const allTests = testEntries.map(([t]) => t)
  await reporter?.onRunStart(allTests)

  const finishEarly = async (message: string, phase: string): Promise<SuiteResult> => {
    const duration = performance.now() - startTime
    const failedResult: TestResult = {
      runId: suiteRunId,
      name: suite.name,
      filePath: '',
      status: 'failed',
      steps: [],
      duration,
      failureSummary: message,
      metadata: { phase },
    }
    const earlyResults = [failedResult]
    const runSummary: RunSummary = { results: earlyResults, duration, passed: 0, failed: 1, skipped: 0 }
    await reporter?.onRunEnd(runSummary)
    await reporter?.onSuiteEnd({
      runId: suiteRunId,
      name: suite.name,
      status: 'failed',
      tests: earlyResults,
      duration,
      passed: 0,
      failed: 1,
      skipped: 0,
    })
    return { runId: suiteRunId, name: suite.name, status: 'failed', tests: earlyResults, duration, failedAt: 0 }
  }

  // Suite-level setup hooks (before adapter.setup, before all tests)
  let suiteHookVars: Record<string, string> = {}
  if ((suite as any).setup?.length && config.resolvedHooks && suiteSandboxOptions) {
    const hookDefs: HookDefinition[] = []
    let hookMissing = false
    for (const hookId of (suite as any).setup) {
      const hook = config.resolvedHooks.get(hookId)
      if (!hook) { hookMissing = true; break }
      hookDefs.push(hook)
    }

    if (hookMissing) {
      return finishEarly('Suite setup hook not found', 'suite-setup')
    }

    const envVars: Record<string, string> = {}
    if (config.envFileVars) Object.assign(envVars, config.envFileVars)
    if (config.inlineVars) Object.assign(envVars, config.inlineVars)
    if (config.cliVars) Object.assign(envVars, config.cliVars)

    const result = await runHooks(hookDefs, {
      ...suiteSandboxOptions,
      secretStore: config.secretStore,
      secretRedactor: config.secretRedactor,
      envVars: { ...suiteSandboxOptions.envVars, ...envVars },
    })

    for (const [name, hr] of result.results) {
      const hookDef = hookDefs.find((hook) => hook.name === name)
      const hookExecId = randomUUID()
      await reporter?.onHookStart?.({ hookId: hookDef?.id, hookName: name, phase: 'setup', hookExecutionId: hookExecId, runId: suiteRunId })
      await reporter?.onHookEnd?.({
        hookId: hookDef?.id, hookName: name, phase: 'setup', hookExecutionId: hookExecId,
        runId: suiteRunId,
        status: hr.success ? 'passed' : 'failed',
        duration: hr.duration, stdout: hr.stdout, stderr: hr.stderr,
        variables: hr.variables, error: hr.error,
      })
    }

    if (!result.allPassed) {
      return finishEarly('Suite setup hook failed', 'suite-setup')
    }
    suiteHookVars = result.variables
  }

  const memoryEnabled = config.memoryConfig?.enabled !== false && !!config.memoryProvider
  const memoryRoot = config.memoryRoot ?? DEFAULT_MEMORY_DIR
  let suiteBootstrapFailure: string | undefined

  try {
    await config.adapter.setup(config.platformConfig)

    const initialTargetName = suite.target ?? testEntries[0]?.[0].target
    if (config.resolveUrl && initialTargetName) {
      const rawSuiteUrl = config.resolveUrl(initialTargetName)
      if (rawSuiteUrl) {
        const resolvedSuiteUrl = resolveSuiteStartUrl(rawSuiteUrl, config, suiteHookVars)
        if (resolvedSuiteUrl.error) {
          suiteBootstrapFailure = resolvedSuiteUrl.error
        } else {
          const navigationTimeout = config.timeouts?.navigation ?? config.timeouts?.test
          const navigationAbortController = navigationTimeout && navigationTimeout > 0
            ? new AbortController()
            : undefined
          const navigationTimeoutId = navigationAbortController
            ? setTimeout(() => {
                navigationAbortController.abort(new Error(`Suite navigation timed out after ${navigationTimeout}ms`))
              }, navigationTimeout)
            : undefined

          try {
            const navigateResult = await withAbort(
              config.adapter.execute({ type: 'navigate', to: 'url', url: resolvedSuiteUrl.url! }),
              navigationAbortController?.signal,
            )
            if (!navigateResult.success) {
              suiteBootstrapFailure = navigateResult.error ?? `Failed to navigate to suite target URL "${resolvedSuiteUrl.url}"`
            }
          } catch (err) {
            suiteBootstrapFailure = err instanceof Error
              ? err.message
              : `Failed to navigate to suite target URL "${resolvedSuiteUrl.url}"`
          } finally {
            if (navigationTimeoutId) clearTimeout(navigationTimeoutId)
          }
        }
      }
    }

    if (suiteBootstrapFailure) {
      results.push({
        runId: suiteRunId,
        name: suite.name,
        filePath: '',
        status: 'failed',
        steps: [],
        duration: performance.now() - startTime,
        failureSummary: suiteBootstrapFailure,
        metadata: { phase: 'suite-bootstrap' },
      })
    } else {
      for (let i = 0; i < testEntries.length; i++) {
        const [test, filePath] = testEntries[i]

        // D-01: the per-member body (patch, child runId + onTestStart, setup/teardown hooks,
        // runTest, curator) lives in the single audited executeSuiteMember; runSuite (the shell)
        // owns ONLY iteration, fail-fast, skip synthesis, and aggregation. Plan 10's CLI executor
        // closure wraps this same function instead of replicating the body.
        const result = await executeSuiteMember({
          suite,
          test,
          filePath,
          index: i,
          totalTests: testEntries.length,
          config,
          reporter,
          suiteRunId,
          suiteHookVars,
          suiteSandboxOptions,
          suiteArtifact,
          memoryEnabled,
          memoryRoot,
        })

        results.push(result)

        // Per-test setup-hook failure breaks WITHOUT synthesizing skips (executeSuiteMember tags
        // it); preserves today's control flow where a setup failure is not a fail-fast skip event.
        if ((result.metadata as { phase?: string } | undefined)?.phase === 'per-test-setup') {
          break
        }

        if (result.status === 'cancelled') {
          break
        }

        if (result.status === 'failed') {
          for (let j = i + 1; j < testEntries.length; j++) {
            const [skippedTest, skippedPath] = testEntries[j]
            results.push({
              runId: generateRunId(),
              name: skippedTest.name,
              filePath: skippedPath,
              status: 'skipped',
              steps: [],
              duration: 0,
              metadata: {
                ...((skippedTest as any).meta ?? {}),
                skipReason: `Skipped: previous test "${test.name}" failed (fail-fast)`,
              },
            })
          }
          break
        }
      }
    }
    if (
      config.authStateCapture
      && results.length > 0
      && results.every((result) => result.status === 'passed')
    ) {
      try {
        const capturedAuthState = await config.authStateCapture.capture()
        suiteSandboxOptions = config.sandboxOptions
          ? { ...config.sandboxOptions, authState: capturedAuthState }
          : config.sandboxOptions
      } catch {
        const captureFailureResult: TestResult = {
          runId: suiteRunId,
          name: 'Auth state capture',
          filePath: '',
          status: 'failed',
          steps: [],
          duration: 0,
          failureSummary: config.authStateCapture.failureSummary,
          metadata: { phase: 'auth-state-capture' },
        }
        results.push(captureFailureResult)
        await reporter?.onTestEnd(captureFailureResult)
      }
    }
  } finally {
    // Suite-level teardown hooks with accumulated variables (D-14)
    if ((suite as any).teardown?.length && config.resolvedHooks && suiteSandboxOptions) {
      const teardownVars: Record<string, string> = {}
      if (config.envFileVars) Object.assign(teardownVars, config.envFileVars)
      if (config.inlineVars) Object.assign(teardownVars, config.inlineVars)
      if (config.cliVars) Object.assign(teardownVars, config.cliVars)
      Object.assign(teardownVars, suiteHookVars)

      for (const hookId of (suite as any).teardown) {
        const hook = config.resolvedHooks.get(hookId)
        if (!hook) continue
        const hookExecId = randomUUID()
        try {
          await reporter?.onHookStart?.({ hookId: hook.id, hookName: hook.name, phase: 'teardown', hookExecutionId: hookExecId, runId: suiteRunId })
          const hookResult = await runHooks([hook], {
            ...suiteSandboxOptions,
            secretStore: config.secretStore,
            secretRedactor: config.secretRedactor,
            envVars: { ...suiteSandboxOptions.envVars, ...teardownVars },
          })
          const hr = hookResult.results.get(hook.name)
          await reporter?.onHookEnd?.({
            hookId: hook.id, hookName: hook.name, phase: 'teardown', hookExecutionId: hookExecId,
            runId: suiteRunId,
            status: hr?.success ? 'passed' : 'failed',
            duration: hr?.duration ?? 0, stdout: hr?.stdout ?? '', stderr: hr?.stderr ?? '',
            variables: hr?.variables ?? {}, error: hr?.error,
          })
        } catch {}
      }
    }

    await config.adapter.cleanup()
    if (config.memoryProvider) {
      try { config.memoryProvider.destroy() } catch {}
    }
  }

  const passed = results.filter(r => r.status === 'passed').length
  const failed = results.filter(r => r.status === 'failed').length
  const cancelled = results.filter(r => r.status === 'cancelled').length
  const skipped = results.filter(r => r.status === 'skipped').length
  const duration = results.reduce((sum, r) => sum + r.duration, 0)
  const suiteStatus: SuiteResult['status'] = failed > 0 ? 'failed' : cancelled > 0 ? 'cancelled' : 'passed'

  const runSummary: RunSummary = { results, duration, passed, failed, skipped }
  await reporter?.onRunEnd(runSummary)

  const suiteSummary: SuiteSummary = {
    runId: suiteRunId,
    name: suite.name,
    status: suiteStatus,
    tests: results,
    duration,
    passed,
    failed,
    skipped,
  }
  await reporter?.onSuiteEnd(suiteSummary)

  const failedIndex = results.findIndex(r => r.status === 'failed')

  return {
    runId: suiteRunId,
    name: suite.name,
    status: suiteStatus,
    tests: results,
    duration,
    failedAt: failedIndex >= 0 ? failedIndex : undefined,
  }
}
