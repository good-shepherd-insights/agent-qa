import type { RunAttributes } from '@vostride/agent-qa-core'
import type {
  ArtifactRecord,
  RunArtifactConfigSnapshot,
  RunArtifactKind,
  RunArtifactMemorySnapshot,
  RunArtifactStageInput,
  RunArtifactSuiteSourceSnapshot,
  RunArtifactTestSourceSnapshot,
  RunEventEnvelope,
} from '@vostride/agent-qa-schema'
import type { DashboardDatabase } from '../db/database.js'

/**
 * `createDashboardRunIngest` — the dashboard's DB ingestion (RESEARCH Pitfall 1's
 * "unnamed fifth consumer") rewired from the deleted `DashboardReporter` into a bus
 * subscriber (Open Q-1 resolved as option (a): one envelope vocabulary, D-16 precedent).
 *
 * The bus deliberately does not carry the resolved config/source snapshots or the
 * spawn correlation env; those ride construction. Envelopes drive lifecycle/status.
 * The `runs` + `run_artifacts` rows this writes stay shape-compatible with what
 * `GET /api/runs/:id/artifact` and the queue read today — the spawn must survive
 * until M5 (Pitfall 1's hard requirement). This module implements no Reporter
 * interface — pure envelope consumption.
 *
 * NOTE: Plan 06 (363-06) relocated the `RunArtifact*` payload family from core to
 * @vostride/agent-qa-schema (D-08); these imports now point at their canonical home.
 */

type SourceSnapshot =
  | RunArtifactTestSourceSnapshot
  | RunArtifactSuiteSourceSnapshot
  | ArtifactRecord

type ConfigSnapshot = RunArtifactConfigSnapshot | ArtifactRecord

/**
 * The spawn correlation env the runner process is launched with (test-runner.ts
 * `execute()` — the three exclusive modes). Read from `process.env` at the CLI
 * composition root and passed in; the bus never carries these.
 */
export interface DashboardRunIngestCorrelationEnv {
  /** `AGENT_QA_RUN_ID` — plain single run: adopt/update this exact row. */
  runId?: string
  /** `AGENT_QA_PARENT_RUN_ID` — retry mode: each attempt inserts a child under this parent. */
  parentRunId?: string
  /** `AGENT_QA_SUITE_QUEUE_ID` — suite mode: the enqueued parent (suite) run row id. */
  suiteQueueId?: string
  /** `AGENT_QA_MAX_RETRIES` — retry ceiling stamped on child rows. */
  maxRetries?: number
  /** `AGENT_QA_ATTEMPT_NUMBER` — the current attempt ordinal for a retry child. */
  attemptNumber?: number
}

export interface DashboardRunIngestDeps {
  db: DashboardDatabase
  /** Resolved config snapshot (RunArtifactPayload-compatible) — the bus never carries it. */
  configSnapshot?: ConfigSnapshot
  /** Resolved test/suite source snapshot — the bus never carries it. */
  sourceSnapshot?: SourceSnapshot
  /** Trusted run attributes, written to the run row + artifact metadata. */
  attributes?: RunAttributes
  correlationEnv?: DashboardRunIngestCorrelationEnv
  /** Fired once the primary DB row exists (log correlation / live-view wiring). */
  onRunCreated?: (runId: string) => void
  /** Injectable clock for deterministic tests. */
  now?: () => string
}

/**
 * The post-run section the CLI closure supplies to `finalize()` — memory/curator data
 * stays core-owned; the bus never carries it, so it arrives out-of-band at flush.
 */
export interface DashboardRunIngestFinalizeExtra {
  memory?: RunArtifactMemorySnapshot | ArtifactRecord
  runtime?: ArtifactRecord
}

export interface DashboardRunIngest {
  handler(envelope: RunEventEnvelope): void
  finalize(extra?: DashboardRunIngestFinalizeExtra): Promise<void>
}

type IngestMode = 'suite' | 'retry' | 'plain'

interface TestStartedLike {
  testId?: string
  testIndex?: number
  name?: string
  filePath?: string
  suiteId?: string
  suiteName?: string
  suiteIndex?: number
  totalSteps?: number
}

interface TestFinishedLike {
  testId?: string
  testIndex?: number
  outcome?: string
  durationMs?: number
  failureSummary?: string
  retryCount?: number
}

interface StepStartedLike {
  testIndex?: number
  stepIndex?: number
  stepText?: string
}

interface StepFinalizedLike {
  testIndex?: number
  stepIndex?: number
  status?: string
  durationMs?: number
  error?: string
}

interface HookFinishedLike {
  hookName?: string
  phase?: string
  hookExecutionId?: string
  hookId?: string
  testIndex?: number
  status?: string
  durationMs?: number
  stdout?: string
  stderr?: string
  variables?: Record<string, string>
  kind?: string
}

interface TestRetryScheduledLike {
  testIndex?: number
}

interface VerdictLike {
  verdict?: string
}

interface RunFinishedLike {
  aggregateVerdict?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

/**
 * Map a member/aggregate outcome to a value the `runs.status` CHECK constraint accepts
 * (`passed|failed|skipped|running|cancelled|pending|flaky`). `healed` runs are `passed`
 * at the run level (the healed marker lives on the step row); `timeout` collapses to
 * `failed`. The `steps.status` CHECK is a superset that keeps `healed`, so step rows
 * carry the projection value verbatim.
 */
function toRunStatus(outcome: string | undefined): string {
  switch (outcome) {
    case 'passed':
      return 'passed'
    case 'healed':
      return 'passed'
    case 'failed':
    case 'timeout':
      return 'failed'
    case 'cancelled':
      return 'cancelled'
    case 'skipped':
      return 'skipped'
    default:
      return 'failed'
  }
}

export function createDashboardRunIngest(deps: DashboardRunIngestDeps): DashboardRunIngest {
  const { db, onRunCreated } = deps
  const configSnapshot = deps.configSnapshot
  const sourceSnapshot = deps.sourceSnapshot
  const attributes = deps.attributes
  const env = deps.correlationEnv ?? {}
  const now = deps.now ?? (() => new Date().toISOString())

  const mode: IngestMode = env.suiteQueueId ? 'suite' : env.parentRunId ? 'retry' : 'plain'

  const sourceRecord = isRecord(sourceSnapshot) ? sourceSnapshot : undefined
  const configRecord = isRecord(configSnapshot) ? configSnapshot : undefined
  const configRuntime = isRecord(configRecord?.runtime) ? (configRecord!.runtime as ArtifactRecord) : undefined

  const sourceName = readString(sourceRecord?.name)
  const sourceFilePath = readString(sourceRecord?.filePath)
  const sourceTestId = readString(sourceRecord?.testId)
  const sourceSuiteId = readString(sourceRecord?.suiteId)
  const platform = readString(configRuntime?.platform) ?? 'web'

  /** The primary DB row id lifecycle status/finalize writes target. */
  let runId: string | undefined
  /** Child rows created per test in suite mode, keyed by envelope `testIndex`. */
  const childRunIds = new Map<number, string>()
  /** `stepStarted.stepText` cached per `testIndex:stepIndex` for the step-row name. */
  const stepNames = new Map<string, string>()
  let startedAtMs = 0
  let finalized = false

  function baseArtifactPayload(): RunArtifactStageInput {
    return {
      ...(sourceSnapshot ? { source: sourceSnapshot as RunArtifactStageInput['source'] } : {}),
      ...(configSnapshot ? { config: configSnapshot as RunArtifactStageInput['config'] } : {}),
      ...(attributes ? { metadata: { attributes } } : {}),
    }
  }

  function insertArtifact(id: string, kind: RunArtifactKind): void {
    db.insertRunArtifact({ runId: id, kind, payload: baseArtifactPayload() })
  }

  function adoptOrInsertPrimary(kind: RunArtifactKind): string {
    const startedAt = now()
    startedAtMs = Date.parse(startedAt) || Date.now()
    const explicitId = mode === 'suite' ? env.suiteQueueId : env.runId

    if (explicitId) {
      if (db.getRun(explicitId)) {
        db.updateRun(explicitId, {
          status: 'running',
          startedAt,
          endedAt: startedAt,
          ...(sourceName ? { name: sourceName } : {}),
          ...(attributes ? { attributes } : {}),
          platform,
          ...(sourceSuiteId ? { suiteId: sourceSuiteId } : {}),
          ...(sourceTestId ? { testId: sourceTestId } : {}),
        })
      } else {
        db.insertRun({
          id: explicitId,
          name: sourceName ?? 'run',
          filePath: sourceFilePath,
          status: 'running',
          duration: 0,
          attributes,
          startedAt,
          endedAt: startedAt,
          platform,
          testId: sourceTestId,
          suiteId: sourceSuiteId,
        })
      }
      return explicitId
    }

    return db.insertRun({
      name: sourceName ?? 'run',
      filePath: sourceFilePath,
      status: 'running',
      duration: 0,
      attributes,
      startedAt,
      endedAt: startedAt,
      platform,
      testId: sourceTestId,
      suiteId: sourceSuiteId,
    })
  }

  function insertRetryChild(payload: TestStartedLike): string {
    const startedAt = now()
    startedAtMs = Date.parse(startedAt) || Date.now()
    return db.insertRun({
      id: env.runId,
      name: readString(payload.name) ?? sourceName ?? 'run',
      filePath: readString(payload.filePath) ?? sourceFilePath,
      status: 'running',
      duration: 0,
      attributes,
      startedAt,
      endedAt: startedAt,
      parentRunId: env.parentRunId,
      attemptNumber: env.attemptNumber ?? 1,
      maxRetries: env.maxRetries ?? 0,
      platform,
      testId: readString(payload.testId) ?? sourceTestId,
    })
  }

  function insertSuiteChild(payload: TestStartedLike): string {
    const startedAt = now()
    return db.insertRun({
      name: readString(payload.name) ?? 'test',
      filePath: readString(payload.filePath) ?? sourceFilePath,
      status: 'running',
      duration: 0,
      attributes,
      startedAt,
      endedAt: startedAt,
      parentRunId: env.suiteQueueId,
      platform,
      testId: readString(payload.testId),
      suiteId: readString(payload.suiteId) ?? sourceSuiteId,
    })
  }

  function stageRuntime(id: string, runtime: ArtifactRecord): void {
    const artifact = db.getRunArtifact(id)
    if (artifact && !artifact.finalizedAt) {
      db.stageRunArtifact(id, { runtime: runtime as RunArtifactStageInput['runtime'] })
    }
  }

  function handleRunStarted(): void {
    if (mode === 'retry') return // rows are per-attempt; created on testStarted
    const kind: RunArtifactKind = mode === 'suite' ? 'suite-parent' : 'test'
    const id = adoptOrInsertPrimary(kind)
    runId = id
    insertArtifact(id, kind)
    onRunCreated?.(id)
  }

  function handleTestStarted(payload: TestStartedLike): void {
    if (mode === 'retry') {
      const id = insertRetryChild(payload)
      runId = id
      insertArtifact(id, 'test')
      onRunCreated?.(id)
      return
    }
    if (mode === 'suite') {
      const testIndex = typeof payload.testIndex === 'number' ? payload.testIndex : childRunIds.size
      if (!childRunIds.has(testIndex)) {
        const id = insertSuiteChild(payload)
        childRunIds.set(testIndex, id)
        insertArtifact(id, 'suite-child')
        onRunCreated?.(id)
      }
      return
    }
    // plain: refresh the adopted row with the resolved test identity
    if (runId) {
      const name = readString(payload.name)
      db.updateRun(runId, {
        ...(name ? { name } : {}),
        ...(readString(payload.testId) ? { testId: readString(payload.testId) } : {}),
      })
    }
  }

  function targetForTest(payload: { testIndex?: number }): string | undefined {
    if (mode === 'suite') {
      const testIndex = typeof payload.testIndex === 'number' ? payload.testIndex : undefined
      return testIndex !== undefined ? childRunIds.get(testIndex) : undefined
    }
    return runId
  }

  function handleTestFinished(payload: TestFinishedLike): void {
    const id = targetForTest(payload)
    if (!id) return
    const status = toRunStatus(payload.outcome)
    const duration = typeof payload.durationMs === 'number' ? payload.durationMs : Date.now() - startedAtMs
    const endedAt = now()
    db.updateRun(id, {
      status,
      duration,
      endedAt,
      ...(readString(payload.failureSummary) ? { failureSummary: payload.failureSummary } : {}),
    })
    stageRuntime(id, {
      status,
      duration,
      endedAt,
      failureSummary: payload.failureSummary ?? null,
    })
  }

  function stepNameKey(testIndex: number | undefined, stepIndex: number): string {
    return `${testIndex ?? 0}:${stepIndex}`
  }

  function handleStepStarted(payload: StepStartedLike): void {
    const stepText = readString(payload.stepText)
    if (stepText === undefined) return
    const stepIndex = typeof payload.stepIndex === 'number' ? payload.stepIndex : 0
    stepNames.set(stepNameKey(payload.testIndex, stepIndex), stepText)
  }

  function handleStepFinalized(payload: StepFinalizedLike): void {
    const id = targetForTest(payload)
    if (!id) return
    const stepIndex = typeof payload.stepIndex === 'number' ? payload.stepIndex : 0
    try {
      db.insertStep({
        runId: id,
        name: stepNames.get(stepNameKey(payload.testIndex, stepIndex)) ?? `Step ${stepIndex + 1}`,
        status: payload.status ?? 'passed',
        duration: typeof payload.durationMs === 'number' ? payload.durationMs : 0,
        error: readString(payload.error),
        stepOrder: stepIndex,
      })
    } catch {
      // Step rows are progress detail — a projection status the CHECK rejects must not
      // darken the run row (Pitfall 1 protects runs/run_artifacts, not steps).
    }
  }

  function handleHookFinished(payload: HookFinishedLike): void {
    // `skipped` hooks carry no output and the execution_logs CHECK only admits
    // passed|failed — the deleted DashboardReporter had the same contract.
    if (payload.status !== 'passed' && payload.status !== 'failed') return
    const id = targetForTest(payload) ?? runId
    if (!id) return
    const kind = payload.kind
    try {
      db.insertExecutionLog({
        id: readString(payload.hookExecutionId) ?? `${id}-hook-${now()}`,
        runId: id,
        type: kind === 'appium-script' || kind === 'runjs' ? kind : 'hook',
        name: readString(payload.hookName) ?? 'hook',
        hookId: readString(payload.hookId) ?? null,
        phase: payload.phase === 'setup' || payload.phase === 'teardown' ? payload.phase : 'inline',
        status: payload.status,
        duration: typeof payload.durationMs === 'number' ? payload.durationMs : 0,
        stdout: readString(payload.stdout) ?? null,
        stderr: readString(payload.stderr) ?? null,
        variables: payload.variables ?? null,
      })
    } catch {
      // Hook rows are progress detail — same non-darkening rule as step rows.
    }
  }

  function handleTestRetryScheduled(payload: TestRetryScheduledLike): void {
    // Only the final attempt emits the authoritative testFinished; step rows from the
    // abandoned attempt would otherwise duplicate the re-run stepIndexes (§2.2).
    const id = targetForTest(payload)
    if (!id) return
    try {
      db.deleteStepsForRun(id)
    } catch {
      // Same non-darkening rule.
    }
    const prefix = `${payload.testIndex ?? 0}:`
    for (const key of stepNames.keys()) {
      if (key.startsWith(prefix)) stepNames.delete(key)
    }
  }

  function finalizeChildArtifact(id: string): void {
    const artifact = db.getRunArtifact(id)
    if (artifact && !artifact.finalizedAt) db.finalizeRunArtifact(id)
  }

  function handleRunFinished(aggregateVerdict?: string): void {
    // The aggregate verdict is authoritative at the run level. The PRIMARY run_artifact
    // is deliberately left open here — finalize() lands the out-of-band memory/curator
    // section (the bus never carries it) and finalizes last (Pitfall 6 flush idiom).
    const endedAt = now()
    if (runId) db.updateRun(runId, { status: toRunStatus(aggregateVerdict), endedAt })
    if (mode === 'suite') {
      for (const id of childRunIds.values()) finalizeChildArtifact(id)
    }
  }

  return {
    handler(envelope: RunEventEnvelope): void {
      switch (envelope.type) {
        case 'runStarted':
          handleRunStarted()
          break
        case 'testStarted':
          handleTestStarted(envelope.payload as TestStartedLike)
          break
        case 'testFinished':
          handleTestFinished(envelope.payload as TestFinishedLike)
          break
        case 'stepStarted':
          handleStepStarted(envelope.payload as StepStartedLike)
          break
        case 'stepFinalized':
          handleStepFinalized(envelope.payload as StepFinalizedLike)
          break
        case 'hookFinished':
          handleHookFinished(envelope.payload as HookFinishedLike)
          break
        case 'testRetryScheduled':
          handleTestRetryScheduled(envelope.payload as TestRetryScheduledLike)
          break
        case 'verdict':
          // Terminal aggregate; runFinished performs the finalize sweep.
          if (runId && mode !== 'suite') {
            db.updateRun(runId, { status: toRunStatus((envelope.payload as VerdictLike).verdict) })
          }
          break
        case 'runFinished':
          handleRunFinished((envelope.payload as RunFinishedLike).aggregateVerdict)
          break
        default:
          // Unknown/unhandled envelope types (hookStarted, heartbeats, chips) are ignored.
          break
      }
    },

    async finalize(extra?: DashboardRunIngestFinalizeExtra): Promise<void> {
      if (finalized) return
      finalized = true
      if (!runId) return

      const memory = extra?.memory
      if (memory && isRecord(memory)) {
        const log = (memory as { log?: unknown }).log
        const artifact = db.getRunArtifact(runId)
        if (log !== undefined) {
          db.updateRun(runId, { memoryLog: JSON.stringify(log) })
        }
        if (artifact && !artifact.finalizedAt) {
          db.stageRunArtifact(runId, { memory: memory as RunArtifactStageInput['memory'] })
        }
      }
      if (extra?.runtime) {
        stageRuntime(runId, extra.runtime)
      }

      const artifact = db.getRunArtifact(runId)
      if (artifact && !artifact.finalizedAt) {
        db.finalizeRunArtifact(runId)
      }
    },
  }
}
