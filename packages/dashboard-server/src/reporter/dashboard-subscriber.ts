import type { RunAttributes } from '@vostride/agent-qa-core'
import type {
  ArtifactRecord,
  HookFinishedPayload,
  RunArtifactConfigSnapshot,
  RunArtifactKind,
  RunArtifactStageInput,
  RunArtifactSuiteSourceSnapshot,
  RunArtifactTestSourceSnapshot,
  RunEventEnvelope,
  StepFinalizedPayload,
  StepStartedPayload,
  SubActionRecordedPayload,
  TestFinishedPayload,
  TestRetryScheduledPayload,
  TestStartedPayload,
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
 *
 * 2026-08-27 (Phase 405 plan 01, D-01/D-17/D-18): THE PROJECTION IS REBUILT ON THE BUS'S OWN
 * SHAPE. Until this date every step landed in the v1 wide `steps` row through `insertStep`, which
 * kept five of `StepFinalizedPayload`'s fields and dropped the rest — because the local `*Like`
 * interfaces this module declared only named five. There was no `subActionRecorded` arm at all, so
 * the sub-action timeline, the screenshots and the screen-state hashes reached no reader.
 *
 * What replaced them: the real schema payload types (so a field added to a payload is a compile
 * error here rather than a silent drop), `run_members` per handle from `testStarted`/`testFinished`
 * (D-18: a thin member whose stream begins with a terminal event still gets a row), `run_steps`
 * carrying the WHOLE `stepFinalized` payload with `status` stored as the payload's own word, and
 * `run_sub_actions` carrying the whole `subActionRecorded` payload with its nested objects
 * stringified verbatim. `toRunStatus` survives for exactly one job — the `runs.status` CHECK
 * constraint — and is applied nowhere else (D-01: no field is re-interpreted on the way in).
 *
 * `testRetryScheduled` now drops only THAT HANDLE's rows (D-17). It used to call the v1
 * whole-run step delete, which wiped every step of the RUN — so in a suite, one member's
 * abandoned attempt deleted the completed history of every member before it.
 *
 * THE NON-DARKENING `try {} catch {}` AROUND EVERY PROJECTION INSERT IS UNCHANGED and is
 * load-bearing: a projection row that fails to write must never darken the `runs` row. A dropped
 * step is visible as an absent step; a darkened run is a wrong verdict.
 *
 * 2026-08-28 (Phase 405 plan 13, D-21): every table, column, route and field phase 405 removed from
 * around this module — and every one it deliberately kept, with the measurement that decided each —
 * is registered in `DELETION-INVENTORY.md` at the repository root, under the dated 2026-08-28
 * section. Read it before restoring anything that looks missing here.
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
  /** `AGENT_QA_RUN_ID` — adopt/update this exact row. */
  runId?: string
  /**
   * `AGENT_QA_SUITE_QUEUE_ID` — the enqueued run row id for a suite run.
   *
   * 2026-08-24 (402-09, D-11): this is now a SECOND SPELLING OF `runId`, not a parent handle. A
   * suite is ONE run row with member handles (402-04); the id is adopted exactly as a single test's
   * is. `parentRunId` / `maxRetries` / `attemptNumber` used to sit beside it and are gone with the
   * retry mode they served — 401-07 (D-12) had already retired the machinery that set
   * `AGENT_QA_PARENT_RUN_ID`, so that mode was producer-less before this plan touched it.
   */
  suiteQueueId?: string
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
 * The post-run section the CLI closure supplies to `finalize()` — data the bus never carries,
 * so it arrives out-of-band at flush.
 *
 * The v1 `memory` member is DELETED (407-05 · D-02). It was the last writer feeding the dead
 * artifact-drawer memory tab, no producer in `packages/cli` or `packages/runner-local` has passed
 * it since v1, and a field only a test could supply is a contract claiming a producer that does
 * not exist. `runs.memory_log` has NO remaining production writer either (407-16 corrects 407-05's
 * claim of a second writer): its insights reader is historical-only, reporting zeroes on every
 * install created since, and its retirement belongs to the insights v1 sweep.
 */
export interface DashboardRunIngestFinalizeExtra {
  runtime?: ArtifactRecord
}

export interface DashboardRunIngest {
  handler(envelope: RunEventEnvelope): void
  finalize(extra?: DashboardRunIngestFinalizeExtra): Promise<void>
}

// 405-01 (D-01): the six `*Like` interfaces that stood here are GONE. They were the mechanism of
// the drop this plan closes — `StepFinalizedLike` named five of the payload's eleven fields, so the
// other six could not be written even in principle, and nothing could tell you that by reading the
// arm. The arms below take the SCHEMA'S OWN payload types, so a payload that grows a field is a
// compile error here rather than a silent hole in the page.
//
// The two below survive because they are genuinely narrow reads of one word each off a terminal
// envelope, and neither feeds a projection row.

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

  function adoptOrInsertPrimary(): string {
    const startedAt = now()
    startedAtMs = Date.parse(startedAt) || Date.now()
    const explicitId = env.runId ?? env.suiteQueueId

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

  // 2026-08-24 (Phase 402 plan 09, D-11): `insertRetryChild` AND `insertSuiteChild` ARE DELETED.
  //
  // ~40 lines stood here minting run rows carrying the parent-link column — one per retry attempt,
  // one per suite member. This module was the LIVE producer of new parent/child run records; the queue's
  // fan-out and the routes' parent-kind mints were only its accessories. D-11: a parallel suite is
  // ONE run row with member handles (402-04's per-member handle addressing), no child runs, no
  // parent kind.
  //
  // The retry half was already unreachable: 401-07 (D-12) retired the queue re-spawn that set
  // `AGENT_QA_PARENT_RUN_ID`, so nothing could put the process in retry mode. The suite half was
  // live and is the deliberate cost recorded in DELETION-INVENTORY.md — a dashboard suite run's
  // per-member rows are replaced by handle addressing when 405 rebuilds the run detail.

  function stageRuntime(id: string, runtime: ArtifactRecord): void {
    const artifact = db.getRunArtifact(id)
    if (artifact && !artifact.finalizedAt) {
      db.stageRunArtifact(id, { runtime: runtime as RunArtifactStageInput['runtime'] })
    }
  }

  function handleRunStarted(): void {
    const id = adoptOrInsertPrimary()
    runId = id
    insertArtifact(id, 'test')
    onRunCreated?.(id)
  }

  function handleTestStarted(payload: TestStartedPayload): void {
    // Every member refreshes the ONE adopted row with the resolved test identity. Under the
    // one-run model there is nothing else to write it to.
    if (runId) {
      const name = readString(payload.name)
      db.updateRun(runId, {
        ...(name ? { name } : {}),
        ...(readString(payload.testId) ? { testId: readString(payload.testId) } : {}),
      })
    }
    // 405 D-01: AND the member row, keyed by the handle. This is the per-member split 402-09
    // deleted with the child run rows, restored from 402-04's handles rather than from a second
    // `runs` row — the identity half; `testFinished` supplies the outcome half.
    const id = targetForTest(payload)
    if (!id) return
    try {
      db.upsertRunMember({
        runId: id,
        testIndex: payload.testIndex,
        ...(payload.testId === undefined ? {} : { testId: payload.testId }),
        ...(payload.name === undefined ? {} : { name: payload.name }),
        ...(payload.filePath === undefined ? {} : { filePath: payload.filePath }),
        ...(payload.suiteId === undefined ? {} : { suiteId: payload.suiteId }),
        ...(payload.suiteName === undefined ? {} : { suiteName: payload.suiteName }),
        ...(payload.suiteIndex === undefined ? {} : { suiteIndex: payload.suiteIndex }),
        ...(payload.totalSteps === undefined ? {} : { totalSteps: payload.totalSteps }),
      })
    } catch {
      // Projection rows are progress detail — the non-darkening rule.
    }
  }

  // 402-09 (D-11): every member's step/hook/status rows land on the ONE run row. The per-member
  // split they used to get came from the child rows this plan deleted; 405 restores it from
  // 402-04's handles rather than from a second run row.
  function targetForTest(_payload: { testIndex?: number }): string | undefined {
    return runId
  }

  function handleTestFinished(payload: TestFinishedPayload): void {
    const id = targetForTest(payload)
    if (!id) return
    // 405 D-18: THE MEMBER ROW IS WRITTEN FROM `testFinished` ALONE if that is all there was. A
    // member whose stream begins with a terminal event — skipped by fail-fast, budget exhausted —
    // still has an outcome and a reason, and the page must show it with an explicit "did not run"
    // state rather than omitting it. The upsert coalesces, so this cannot blank the identity
    // fields `testStarted` wrote when both arrived.
    try {
      db.upsertRunMember({
        runId: id,
        testIndex: payload.testIndex,
        ...(payload.testId === undefined ? {} : { testId: payload.testId }),
        outcome: payload.outcome,
        ...(payload.durationMs === undefined ? {} : { durationMs: payload.durationMs }),
        ...(payload.failureSummary === undefined ? {} : { failureSummary: payload.failureSummary }),
        ...(payload.retryCount === undefined ? {} : { retryCount: payload.retryCount }),
        ...(payload.recording === undefined ? {} : { recording: payload.recording }),
      })
    } catch {
      // Non-darkening: a member row that will not write must not change the run row below.
    }
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

  function stepNameKey(testIndex: number, stepIndex: number): string {
    return `${String(testIndex)}:${String(stepIndex)}`
  }

  function handleStepStarted(payload: StepStartedPayload): void {
    const stepText = readString(payload.stepText)
    if (stepText === undefined) return
    stepNames.set(stepNameKey(payload.testIndex, payload.stepIndex), stepText)
  }

  /**
   * 405 D-01: the WHOLE `StepFinalizedPayload`, passed through verbatim.
   *
   * `status` IS THE PAYLOAD'S OWN WORD and never `toRunStatus(...)`. A step that healed is
   * `healed` on its row; collapsing it to `passed` here is precisely the re-interpretation D-01
   * forbids, and the reason the v1 row could not tell a reader that a step self-healed.
   *
   * `stepText` comes from the `stepStarted` cache and is genuinely ABSENT when no `stepStarted`
   * was seen — the v1 arm substituted `Step N`, which is a label nobody wrote pretending to be an
   * instruction somebody did.
   */
  function handleStepFinalized(payload: StepFinalizedPayload): void {
    const id = targetForTest(payload)
    if (!id) return
    const stepText = stepNames.get(stepNameKey(payload.testIndex, payload.stepIndex))
    try {
      db.insertRunStep({
        runId: id,
        testIndex: payload.testIndex,
        stepIndex: payload.stepIndex,
        ...(stepText === undefined ? {} : { stepText }),
        cacheStatus: payload.cacheStatus,
        verifierVerdict: payload.verifierVerdict,
        selfHealOccurred: payload.selfHealOccurred,
        briefDigest: payload.briefDigest,
        ...(payload.status === undefined ? {} : { status: payload.status }),
        ...(payload.durationMs === undefined ? {} : { durationMs: payload.durationMs }),
        ...(payload.error === undefined ? {} : { error: payload.error }),
        // 2026-08-27 (405 plan 04, D-05/D-06): the producer landed this plan, so the three token
        // columns 405-01 declared stop being always-NULL. Spread-when-defined, like every other
        // optional above it — the DB layer writes NULL for all three when the key is absent, and
        // a NULL row is what makes `runs.detail` able to say "M of K steps unmeasured" instead of
        // reporting a zero nobody measured.
        ...(payload.tokenUsage === undefined ? {} : { tokenUsage: payload.tokenUsage }),
        ...(payload.modelUsage === undefined ? {} : { modelUsage: payload.modelUsage }),
        ...(payload.evidence === undefined ? {} : { evidence: payload.evidence }),
        ...(payload.variableSnapshot === undefined ? {} : { variableSnapshot: payload.variableSnapshot }),
      })
    } catch {
      // Step rows are progress detail — a projection row that will not write must not
      // darken the run row (Pitfall 1 protects runs/run_artifacts, not steps).
    }
  }

  /**
   * 405 D-01 / D-14: THE ARM THAT DID NOT EXIST. Every `subActionRecorded` envelope becomes a row
   * keyed by `(run_id, test_index, step_index, sub_action_index)`, carrying the payload's nested
   * objects as JSON verbatim — including the `artifactRefs` the bus fold now populates from the
   * decision screenshot the runner already minted. This is the whole of "screenshots and the
   * sub-action timeline render populated": before it, nothing persisted them at all.
   */
  function handleSubActionRecorded(payload: SubActionRecordedPayload): void {
    const id = targetForTest(payload)
    if (!id) return
    try {
      db.insertRunSubAction({
        runId: id,
        testIndex: payload.testIndex,
        stepIndex: payload.stepIndex,
        subActionIndex: payload.subActionIndex,
        plan: payload.plan,
        plannedAction: payload.plannedAction,
        ...(payload.grounding === undefined ? {} : { grounding: payload.grounding }),
        result: payload.result,
        screenStateHash: payload.screenStateHash,
        ...(payload.screenStateHashAfter === undefined
          ? {}
          : { screenStateHashAfter: payload.screenStateHashAfter }),
        ...(payload.artifactRefs === undefined ? {} : { artifactRefs: payload.artifactRefs }),
        ...(payload.ariaEvidence === undefined ? {} : { ariaEvidence: payload.ariaEvidence }),
        ...(payload.recordingOffsetMs === undefined ? {} : { recordingOffsetMs: payload.recordingOffsetMs }),
      })
    } catch {
      // Same non-darkening rule as step rows.
    }
  }

  function handleHookFinished(payload: HookFinishedPayload): void {
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
        // 405 D-01: where in the run tree this hook ran. Absent stays NULL — a run-scoped hook
        // is a real state, and inventing handle 0 for it would put a setup hook inside a test.
        ...(payload.testIndex === undefined ? {} : { testIndex: payload.testIndex }),
        ...(payload.stepIndex === undefined ? {} : { stepIndex: payload.stepIndex }),
      })
    } catch {
      // Hook rows are progress detail — same non-darkening rule as step rows.
    }
  }

  /**
   * 405 D-17: drop only THIS HANDLE's abandoned-attempt rows, and raise its attempt ordinal.
   *
   * The v1 arm called the store's whole-run step delete, which removed every step of the RUN.
   * Under the one-run-row model that is every member's history: a suite where test 3 retried lost the
   * completed step trees of tests 0-2, and the page rendered them as members that ran nothing.
   * Only the final attempt emits the authoritative `testFinished`, so the abandoned attempt's
   * rows must go — but only the abandoned attempt's.
   */
  function handleTestRetryScheduled(payload: TestRetryScheduledPayload): void {
    const id = targetForTest(payload)
    if (!id) return
    try {
      db.deleteMemberProjection(id, payload.testIndex)
      db.incrementRunMemberAttempts(id, payload.testIndex)
    } catch {
      // Same non-darkening rule.
    }
    const prefix = `${String(payload.testIndex)}:`
    for (const key of stepNames.keys()) {
      if (key.startsWith(prefix)) stepNames.delete(key)
    }
  }

  function handleRunFinished(aggregateVerdict?: string): void {
    // The aggregate verdict is authoritative at the run level. The PRIMARY run_artifact
    // is deliberately left open here — finalize() lands the out-of-band runtime section
    // (the bus never carries it) and finalizes last (Pitfall 6 flush idiom).
    const endedAt = now()
    if (runId) db.updateRun(runId, { status: toRunStatus(aggregateVerdict), endedAt })
  }

  return {
    handler(envelope: RunEventEnvelope): void {
      switch (envelope.type) {
        case 'runStarted':
          handleRunStarted()
          break
        case 'testStarted':
          handleTestStarted(envelope.payload as TestStartedPayload)
          break
        case 'testFinished':
          handleTestFinished(envelope.payload as TestFinishedPayload)
          break
        case 'stepStarted':
          handleStepStarted(envelope.payload as StepStartedPayload)
          break
        case 'stepFinalized':
          handleStepFinalized(envelope.payload as StepFinalizedPayload)
          break
        case 'subActionRecorded':
          handleSubActionRecorded(envelope.payload as SubActionRecordedPayload)
          break
        case 'hookFinished':
          handleHookFinished(envelope.payload as HookFinishedPayload)
          break
        case 'testRetryScheduled':
          handleTestRetryScheduled(envelope.payload as TestRetryScheduledPayload)
          break
        case 'verdict':
          // Terminal aggregate; runFinished performs the finalize sweep.
          // 402-09: the suite carve-out went with the suite mode. There is one run row, and the
          // aggregate verdict is its status; `runFinished` re-states it and performs the sweep.
          if (runId) {
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
