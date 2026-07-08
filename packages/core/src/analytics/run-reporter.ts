import type { RunArtifactReporterContext } from '@vostride/agent-qa-schema'
import {
  ATTR_RUNNER,
  ATTR_TRIGGER,
  buildInternalRunAttributes,
  type RunAttributes,
  validateTrustedRunAttributes,
} from '../run-attributes.js'
import type { SuiteDefinition } from '../suite/types.js'
import type { StepResult, TestResult, TokenUsage } from '@vostride/agent-qa-runner'
import type {
  RunEventEnvelope,
  RunFinishedPayload,
  RunStartedPayload,
  StepFinalizedPayload,
  TestFinishedPayload,
  TestStartedPayload,
  VerdictPayload,
} from '@vostride/agent-qa-schema'
import type { TestDefinition } from '../types/test.js'
import { buildAnalyticsEvent, type AnalyticsEventProperties, type AnalyticsSurface } from './events.js'
import {
  createAnalyticsService,
  resolveAnalyticsStandardProperties,
  type AnalyticsService,
  type AnalyticsServiceConfig,
  type AnalyticsServiceOptions,
} from './service.js'
import type { AnalyticsTransport } from './transport.js'

type RecordLike = Record<string, unknown>

interface RunState {
  runId: string
  parentRunId?: string
  testId?: string
  suiteId?: string
  attributes: RunAttributes
  platform?: AnalyticsEventProperties['platform']
  browserName?: string
  mobileTransport?: string
  mobileProvider?: string
  appState?: string
  executionDestination?: string
  provider?: string
  providerMode?: string
  plannerModel?: string
  verifierModel?: string
  memoryEnabled?: boolean
  memoryInjectedObservationCount?: number
  hookCount: number
  failedHookCount: number
}

interface SuiteState {
  runId: string
  suiteId?: string
  attributes: RunAttributes
  executionMode?: AnalyticsEventProperties['suite_execution_mode']
}

function isRecord(value: unknown): value is RecordLike {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function readNestedRecord(source: unknown, key: string): RecordLike | undefined {
  if (!isRecord(source)) return undefined
  const value = source[key]
  return isRecord(value) ? value : undefined
}

function readAttributes(value: unknown): RunAttributes | undefined {
  try {
    const attributes = validateTrustedRunAttributes(value, 'run artifact attributes')
    return Object.keys(attributes).length > 0 ? attributes : undefined
  } catch {
    return undefined
  }
}

function readAttributesFromEnv(env: Record<string, string | undefined> = process.env): RunAttributes | undefined {
  const raw = env.AGENT_QA_RUN_ATTRIBUTES_JSON
  if (!raw) return undefined
  try {
    return readAttributes(JSON.parse(raw))
  } catch {
    return undefined
  }
}

function fallbackAttributes(): RunAttributes {
  return buildInternalRunAttributes({ trigger: 'cli', runner: 'local' })
}

function normalizeTriggerSource(value: unknown): AnalyticsEventProperties['trigger_source'] {
  if (value === 'cli' || value === 'dashboard' || value === 'api' || value === 'mcp') return value
  return 'unknown'
}

function normalizeRunner(value: unknown): AnalyticsEventProperties['runner'] {
  if (value === 'local' || value === 'browserstack') return value
  return 'unknown'
}

function normalizePlatform(value: unknown): AnalyticsEventProperties['platform'] | undefined {
  if (value === 'web' || value === 'android' || value === 'ios') return value
  return undefined
}

function normalizeStatus(value: unknown): AnalyticsEventProperties['status'] {
  if (value === 'passed' || value === 'failed' || value === 'skipped' || value === 'cancelled') return value
  return 'unknown'
}

function normalizeSuiteExecutionMode(value: unknown): AnalyticsEventProperties['suite_execution_mode'] | undefined {
  if (value === 'parallel' || value === 'sequential' || value === 'unknown') return value
  if (typeof value === 'boolean') return value ? 'parallel' : 'sequential'
  return undefined
}

function readArtifactSource(context?: RunArtifactReporterContext): RecordLike | undefined {
  return isRecord(context?.artifact?.source) ? context?.artifact?.source : undefined
}

function readArtifactConfig(context?: RunArtifactReporterContext): RecordLike | undefined {
  return isRecord(context?.artifact?.config) ? context?.artifact?.config : undefined
}

function readArtifactRuntime(context?: RunArtifactReporterContext): RecordLike {
  const artifactRuntime = isRecord(context?.artifact?.runtime) ? context?.artifact?.runtime : undefined
  const configRuntime = readNestedRecord(readArtifactConfig(context), 'runtime')
  return {
    ...(configRuntime ?? {}),
    ...(artifactRuntime ?? {}),
  }
}

function readTestId(test: TestDefinition, context?: RunArtifactReporterContext): string | undefined {
  const fromTest = readString((test as RecordLike)['test-id'])
  if (fromTest) return fromTest
  return readString(readArtifactSource(context)?.testId)
}

function readSuiteId(suite: SuiteDefinition, context?: RunArtifactReporterContext): string | undefined {
  const fromSuite = readString((suite as RecordLike)['suite-id'])
  if (fromSuite) return fromSuite
  return readString(readArtifactSource(context)?.suiteId)
}

function resolveAttributes(context?: RunArtifactReporterContext, env?: Record<string, string | undefined>): RunAttributes {
  return readAttributes(context?.artifact?.metadata?.attributes)
    ?? readAttributesFromEnv(env)
    ?? fallbackAttributes()
}

function readRunState(input: {
  test: TestDefinition
  context?: RunArtifactReporterContext
  env?: Record<string, string | undefined>
}): RunState {
  const runtime = readArtifactRuntime(input.context)
  const config = readArtifactConfig(input.context)
  const model = readNestedRecord(config, 'model')
  const planner = readNestedRecord(model, 'planner')
  const verifier = readNestedRecord(model, 'verifier')
  const memory = readNestedRecord(config, 'memory')
  const runId = input.context?.runId ?? readString(input.context?.artifact?.runtime?.runId) ?? readTestId(input.test, input.context) ?? 'unknown'

  return {
    runId,
    parentRunId: input.context?.parentRunId ?? readString(input.context?.artifact?.parentRunId),
    testId: readTestId(input.test, input.context),
    suiteId: readString(runtime?.parentSuiteId) ?? readString(readArtifactSource(input.context)?.suiteId),
    attributes: resolveAttributes(input.context, input.env),
    platform: normalizePlatform(runtime.platform),
    browserName: readString(runtime.browserName) ?? readString(runtime.browser),
    mobileTransport: readString(runtime.mobileTransport) ?? readString(runtime.mobile_transport),
    mobileProvider: readString(runtime.mobileProvider) ?? readString(runtime.mobile_provider),
    appState: readString(runtime.appState) ?? readString(runtime.app_state),
    executionDestination: readString(runtime.executionDestination) ?? readString(runtime.execution_destination),
    provider: readString(planner?.provider),
    providerMode: readString(model?.providerMode) ?? readString(model?.provider_mode),
    plannerModel: readString(planner?.model),
    verifierModel: readString(verifier?.model),
    memoryEnabled: readBoolean(memory?.enabled),
    memoryInjectedObservationCount: readNumber(memory?.injectedObservationCount) ?? readNumber(memory?.injected_observation_count),
    hookCount: 0,
    failedHookCount: 0,
  }
}

function addTokenUsage(metrics: {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  plannerCallCount?: number
}, tokenUsage: TokenUsage | undefined): void {
  if (!tokenUsage) return
  metrics.inputTokens = (metrics.inputTokens ?? 0) + tokenUsage.promptTokens
  metrics.outputTokens = (metrics.outputTokens ?? 0) + tokenUsage.completionTokens
  metrics.totalTokens = (metrics.totalTokens ?? 0) + tokenUsage.totalTokens
  metrics.plannerCallCount = (metrics.plannerCallCount ?? 0) + 1
}

function collectExecutionMetrics(result: TestResult, state?: RunState): AnalyticsEventProperties {
  const properties: AnalyticsEventProperties = {
    step_count: result.steps.length,
  }
  let passed = 0
  let failed = 0
  let skipped = 0
  let subactions = 0
  let cachedSubactions = 0
  let failedSubactions = 0
  let verifierCallCount: number | undefined
  const tokenMetrics: {
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
    plannerCallCount?: number
  } = {}

  for (const step of result.steps) {
    if (step.status === 'passed' || step.status === 'healed') passed += 1
    if (step.status === 'failed' || step.status === 'cancelled') failed += 1
    if (step.status === 'skipped') skipped += 1

    addTokenUsage(tokenMetrics, step.trace?.tokenUsage)
    if (step.trace?.verifierReasoning) verifierCallCount = (verifierCallCount ?? 0) + 1

    for (const subAction of step.trace?.subActions ?? []) {
      subactions += 1
      if (subAction.cached) cachedSubactions += 1
      if (subAction.result === 'failure') failedSubactions += 1
      addTokenUsage(tokenMetrics, subAction.tokenUsage)
      if (subAction.verifierReasoning) verifierCallCount = (verifierCallCount ?? 0) + 1
    }
  }

  properties.passed_step_count = passed
  properties.failed_step_count = failed
  properties.skipped_step_count = skipped
  properties.subaction_count = subactions
  properties.cached_subaction_count = cachedSubactions
  properties.failed_subaction_count = failedSubactions
  if (state?.hookCount !== undefined) properties.hook_count = state.hookCount
  if (state?.failedHookCount !== undefined) properties.failed_hook_count = state.failedHookCount
  if (tokenMetrics.inputTokens !== undefined) properties.input_tokens = tokenMetrics.inputTokens
  if (tokenMetrics.outputTokens !== undefined) properties.output_tokens = tokenMetrics.outputTokens
  if (tokenMetrics.totalTokens !== undefined) properties.total_tokens = tokenMetrics.totalTokens
  if (tokenMetrics.plannerCallCount !== undefined) properties.planner_call_count = tokenMetrics.plannerCallCount
  if (verifierCallCount !== undefined) properties.verifier_call_count = verifierCallCount

  return properties
}

function collectMemoryMetrics(result: TestResult, state?: RunState): AnalyticsEventProperties {
  const log = (result as TestResult & { memoryLog?: unknown }).memoryLog
  const properties: AnalyticsEventProperties = {}
  if (state?.memoryEnabled !== undefined) properties.memory_enabled = state.memoryEnabled
  if (state?.memoryInjectedObservationCount !== undefined) {
    properties.memory_injected_observation_count = state.memoryInjectedObservationCount
  }
  if (!isRecord(log)) return properties

  properties.memory_enabled = properties.memory_enabled ?? true
  properties.memory_added_count = readNumber(log.added)
  properties.memory_confirmed_count = readNumber(log.confirmed)
  properties.memory_deprecated_count = readNumber(log.deprecated)
  properties.memory_deleted_count = readNumber(log.deleted)
  properties.memory_error_count = Array.isArray(log.errors) ? log.errors.length : undefined

  const tokenUsage = isRecord(log.tokenUsage) ? log.tokenUsage : undefined
  properties.memory_curator_input_tokens = readNumber(tokenUsage?.promptTokens)
  properties.memory_curator_output_tokens = readNumber(tokenUsage?.completionTokens)
  properties.memory_curator_total_tokens = readNumber(tokenUsage?.totalTokens)
  return properties
}

function classifyFailureCategory(result: TestResult): AnalyticsEventProperties['failure_category'] | undefined {
  if (result.status === 'passed' || result.status === 'skipped') return undefined
  if (result.status === 'cancelled') return 'cancelled'

  const metadataPhase = readString(result.metadata?.phase)
  if (metadataPhase?.includes('hook')) return 'hook'
  if (metadataPhase?.includes('setup')) return 'setup'

  const text = `${result.failureSummary ?? ''} ${readString(result.metadata?.error) ?? ''}`.toLowerCase()
  if (text.includes('timeout') || text.includes('timed out')) return 'timeout'
  if (text.includes('cancel')) return 'cancelled'
  if (text.includes('hook')) return 'hook'
  if (text.includes('appium')) return 'appium'
  if (text.includes('browser') && text.includes('install')) return 'browser_install'
  if (text.includes('context length') || text.includes('token limit')) return 'llm_context'
  if (text.includes('openai') || text.includes('anthropic') || text.includes('provider') || text.includes('llm')) return 'llm_provider'
  if (text.includes('memory')) return 'memory'
  if (text.includes('setup')) return 'setup'
  if (text.includes('assert') || text.includes('expect')) return 'assertion'
  return 'unknown'
}

function definedProperties(properties: AnalyticsEventProperties): Record<string, unknown> {
  const output: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(properties)) {
    if (value !== undefined) {
      output[key] = value
    }
  }
  return output
}


// --- Bus subscriber (D-16 / RUNX-03) ----------------------------------------
//
// `createAnalyticsRunSubscriber` feeds the analytics pipeline from the run-session bus. The v1
// `AnalyticsRunReporter` (a v1 Reporter implementation) was deleted in Phase 363-11 with the rest
// of the Reporter shape; this bus subscriber is the sole analytics attachment at the CLI root.
// Analytics STAYS core-owned (D-16 — relocation rejected as scope creep).
//
// The bus carries a strict projection of the run (spec §2.2), so the subscriber preserves the
// derivable slice of the v1 metric set — run/member counts, outcomes, durations, step tallies,
// retry/flaky — accumulated from the envelope stream and submitted once the run finishes. Rich
// per-subaction/token/memory measures that only ever lived on the runner `TestResult` are not on
// the wire and are intentionally out of scope for the bus feed.
//
// RUNX-03 posture carried over verbatim: a privacy opt-out or a keyless service ⇒ silent no-op,
// zero startup cost; every handler/flush body swallows its own errors so an analytics fault can
// never touch a run (the 361 D-08 detach-on-error backstop is the second line of defence).

export interface AnalyticsRunSubscriberOptions extends Omit<AnalyticsServiceOptions, 'transport'> {
  surface?: AnalyticsSurface
  service?: AnalyticsService
  transport?: AnalyticsTransport
  /** Trusted run attributes (trigger/runner). Falls back to `AGENT_QA_RUN_ATTRIBUTES_JSON`. */
  attributes?: RunAttributes
}

export interface AnalyticsRunSubscriber {
  handler(envelope: RunEventEnvelope): void
  flush(): Promise<void>
}

interface MemberStepTally {
  step_count: number
  passed_step_count: number
  failed_step_count: number
  skipped_step_count: number
}

interface MemberRecord {
  testId?: string
  outcome: string
  durationMs?: number
  retryCount?: number
  steps: MemberStepTally
}

function emptyStepTally(): MemberStepTally {
  return { step_count: 0, passed_step_count: 0, failed_step_count: 0, skipped_step_count: 0 }
}

/**
 * Map a member/aggregate {@link MemberTestOutcome} to the analytics status vocabulary.
 * `healed` runs are `passed` (the heal marker lives on the step); `timeout` collapses to `failed`.
 */
function outcomeToAnalyticsStatus(outcome: unknown): AnalyticsEventProperties['status'] {
  switch (outcome) {
    case 'passed':
    case 'healed':
      return 'passed'
    case 'failed':
    case 'timeout':
      return 'failed'
    case 'skipped':
      return 'skipped'
    case 'cancelled':
      return 'cancelled'
    default:
      return 'unknown'
  }
}

export function createAnalyticsRunSubscriber(options: AnalyticsRunSubscriberOptions = {}): AnalyticsRunSubscriber {
  const surface = options.surface ?? 'core'
  const identityPath = options.identityPath
  const env = options.env
  const disabled = options.config?.analytics?.privacy === true
  const service = options.service ?? createAnalyticsService({ ...options, surface, transport: options.transport })
  const attributes = options.attributes ?? readAttributesFromEnv(env) ?? fallbackAttributes()

  // Accumulated run state, filled from the envelope stream and read once at flush.
  let runId: string | undefined
  let finished = false
  let aggregateVerdict: string | undefined
  let sawSuite = false
  const members = new Map<number, MemberRecord>()
  // Live step tallies keyed by testIndex; testRetryScheduled resets a member's tally so a
  // re-run's repeated stepFinalized sequence never double-counts (schema §2.2 retry note).
  const liveSteps = new Map<number, MemberStepTally>()

  function stepTallyFor(testIndex: number): MemberStepTally {
    let tally = liveSteps.get(testIndex)
    if (!tally) {
      tally = emptyStepTally()
      liveSteps.set(testIndex, tally)
    }
    return tally
  }

  function handleTestStarted(payload: TestStartedPayload): void {
    if (typeof payload.suiteId === 'string' && payload.suiteId.length > 0) sawSuite = true
    liveSteps.set(payload.testIndex, emptyStepTally())
  }

  function handleStepFinalized(payload: StepFinalizedPayload): void {
    const tally = stepTallyFor(payload.testIndex)
    tally.step_count += 1
    switch (payload.status) {
      case 'passed':
      case 'healed':
        tally.passed_step_count += 1
        break
      case 'failed':
      case 'cancelled':
        tally.failed_step_count += 1
        break
      case 'skipped':
        tally.skipped_step_count += 1
        break
      default:
        break
    }
  }

  function handleTestFinished(payload: TestFinishedPayload): void {
    const steps = liveSteps.get(payload.testIndex) ?? emptyStepTally()
    // Only the final attempt emits testFinished — overwrite any prior record for this index.
    members.set(payload.testIndex, {
      testId: readString(payload.testId),
      outcome: readString(payload.outcome) ?? 'unknown',
      durationMs: readNumber(payload.durationMs),
      retryCount: readNumber(payload.retryCount),
      steps,
    })
    liveSteps.delete(payload.testIndex)
  }

  return {
    handler(envelope: RunEventEnvelope): void {
      if (disabled) return
      try {
        runId = envelope.runId
        switch (envelope.type) {
          case 'runStarted':
            // memberTestCount is available for parity but the tally is derived from members.
            void (envelope.payload as RunStartedPayload).memberTestCount
            break
          case 'testStarted':
            handleTestStarted(envelope.payload as TestStartedPayload)
            break
          case 'stepFinalized':
            handleStepFinalized(envelope.payload as StepFinalizedPayload)
            break
          case 'testRetryScheduled':
            liveSteps.delete((envelope.payload as { testIndex: number }).testIndex)
            break
          case 'testFinished':
            handleTestFinished(envelope.payload as TestFinishedPayload)
            break
          case 'verdict':
            aggregateVerdict = readString((envelope.payload as VerdictPayload).verdict) ?? aggregateVerdict
            break
          case 'runFinished':
            aggregateVerdict =
              readString((envelope.payload as RunFinishedPayload).aggregateVerdict) ?? aggregateVerdict
            finished = true
            break
          default:
            break
        }
      } catch {
        // A malformed envelope must never break a run — analytics is best-effort (RUNX-03).
      }
    },

    async flush(): Promise<void> {
      if (disabled || !finished || !runId) {
        // Still drain the transport so a keyless/best-effort service settles cleanly.
        try {
          await service.flush()
        } catch {
          // Analytics is intentionally best-effort.
        }
        return
      }

      try {
        const standard = await resolveAnalyticsStandardProperties({ surface, identityPath, env })
        const triggerSource = normalizeTriggerSource(attributes[ATTR_TRIGGER])
        const runner = normalizeRunner(attributes[ATTR_RUNNER])

        const memberRecords = [...members.values()]
        for (const record of memberRecords) {
          const status = outcomeToAnalyticsStatus(record.outcome)
          await service.capture(buildAnalyticsEvent({
            name: 'agent-qa.test_run.completed',
            properties: definedProperties({
              ...standard,
              run_id: runId,
              test_id: record.testId,
              trigger_source: triggerSource,
              runner,
              status,
              duration_ms: record.durationMs,
              retry_count: record.retryCount,
              is_flaky: record.retryCount !== undefined
                ? status === 'passed' && record.retryCount > 0
                : undefined,
              cancelled: status === 'cancelled' ? true : undefined,
              ...record.steps,
            }),
          }))
        }

        if (sawSuite) {
          const passed = memberRecords.filter(r => outcomeToAnalyticsStatus(r.outcome) === 'passed').length
          const failed = memberRecords.filter(r => outcomeToAnalyticsStatus(r.outcome) === 'failed').length
          const skipped = memberRecords.filter(r => outcomeToAnalyticsStatus(r.outcome) === 'skipped').length
          const totalDuration = memberRecords.reduce((sum, r) => sum + (r.durationMs ?? 0), 0)
          await service.capture(buildAnalyticsEvent({
            name: 'agent-qa.suite_run.completed',
            properties: definedProperties({
              ...standard,
              run_id: runId,
              trigger_source: triggerSource,
              runner,
              status: outcomeToAnalyticsStatus(aggregateVerdict),
              duration_ms: totalDuration,
              suite_child_count: memberRecords.length,
              suite_passed_count: passed,
              suite_failed_count: failed,
              suite_skipped_count: skipped,
            }),
          }))
        }

        await service.flush()
      } catch {
        // Analytics is intentionally best-effort — never surface a fault to the run.
      }
    },
  }
}
