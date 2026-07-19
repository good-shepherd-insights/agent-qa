// The runner-owned step-execution loop — the v2 `executeStep` successor (D-01/D-02).
// CRITICAL: provider-neutral + storage-neutral. No node:* imports, no fs/sharp, no
// core/model/adapter package imports (Pitfall 1). This IS the live loop: observe →
// cached-or-planned plan → safety-gated execute → record §A8 evidence → conditional
// verify, with self-heal = replan-with-failure-context (D-12), bounded ONLY by the
// maxSubActions resource cap, the user timeouts/abort, and the verdict (D-10/D-11).
// There is NO consecutive-failure / attempt counter anywhere in this loop — LOOP-02's
// deletion target (Pitfall 5: do not sneak one back in under any name).
//
// Phase 358 (CYCLE-01..03): the maxSubActions cap becomes a D-10 remaining-budget that
// RESETS TO FULL on every confirmed unit of local progress, so a legitimate bulk "do X to
// all" loop is never starved; the wall-clock deadline stays the sole absolute ceiling. The
// stagnation tree's bounded per-(anchor,class) counters are the SANCTIONED LOOP-02-compatible
// replacement for the deleted blanket attempt cap: they are IDENTITY-KEYED (per element
// anchor role+nameNormalized+ordinal), RESET-ON-PROGRESS, and spec-derived — never a
// per-step counter under any name. Cycle detection (revisited state AND no task progress) and
// the per-element tree are the only new terminate-early paths; both record their D-07 evidence
// by construction at the terminal event, never per iteration.
//
// Modality neutrality (352): adapters stay model-free. Vision-gate branching lives
// here — the loop compresses via the injected ScreenshotCompressor port (sharp stays
// core-side, Pitfall 9) and applies stampCaptureMode itself (runner-owned since 352).
//
// §A8 evidence is populated by construction (D-14): the EvidenceRecorder's recording
// types ARE the schema DTOs. stateBefore is always the FULL ScreenState the sub-action
// was planned against; stateAfter is attached only at the three D-15 boundaries by
// reuse of an observation the loop already takes — never an extra capture.

import {
  computeCacheKey,
  elementOrdinal,
  isReplayableActionShape,
  normalizeAnchor,
  parseProcedureBody,
  servingRecordMetadata,
  toRecordedActionResult,
} from '@vostride/agent-qa-schema'
import type {
  Action as SchemaAction,
  ActionAnnotation,
  ActionResult as SchemaActionResult,
  Anchor,
  AssertValueOp,
  CacheKey,
  CautionBlock,
  CautionLine,
  Decision,
  ElementInfo,
  GroundingAttempt,
  GroundingEvidence,
  ProcedureBodyPayload,
  ProcedureBindingAvailability,
  ProcedureMatch,
  ProcedureParamType,
  ProcedureStepSpec,
  RecordId,
  Ref,
  RiskTier,
  ScreenState,
  StagnationEvidence,
  StepPlanSource,
  TargetDescriptor,
  VerdictSource,
  VerifierVerdict,
  Viewport,
  WorkingMemoryEntry,
} from '@vostride/agent-qa-schema'
import { wrapAppObservedData } from '@vostride/agent-qa-safety'
import type { Action, ActionResult } from '../platform.js'
import type { StepResult, StepTrace, SubActionTrace, TokenUsage } from '../result.js'
import { stampCaptureMode } from '../screen-builder.js'
import { normalizePointerActionForStep } from '../tools/pointer-action-normalization.js'
import { projectRiskAction } from '../tools/project-risk-action.js'
import { defaultRegistry } from '../tools/registry.js'
import { classifyStep } from '../cache/classify.js'
import { buildCacheableStepInput } from '../cache/key.js'
import { buildCachedPlanValue, toGroundedLocator } from '../cache/value.js'
import { deterministicDescriptorMatcher } from '../cache/reground.js'
import { matchDescriptor } from '../grounding/matcher.js'
import { groundActionPlan } from '../grounding/gate.js'
import type { CachedPlanValue, GroundedLocator } from '../cache/port.js'
import type { LoopPorts, SecretRedactorPort } from './ports.js'
import { guardActionData } from './blob-guard.js'
import type { ActionPlan, PlanResult, StepContext } from './types.js'
import { PlanningTurnError } from './planner.js'
import { withAbort, getTimeoutAbortReason } from './abort.js'
import {
  redactSecretValue,
  resolveSecretTemplatesInValue,
} from './secrets.js'
import { estimateTokens } from './prompts.js'
import { EvidenceRecorder, collapseAnnotation, projectLegacyTrace } from './evidence.js'
import type { RecordSubActionInput } from './evidence.js'
import { maskToolExchanges } from './mask-exchanges.js'
import { settle } from './settle.js'
import { desiredStateSatisfied } from '../compound/idempotency.js'
import {
  readIdempotentNoopMeta,
  readReportedValueMeta,
  readUniqueValueMeta,
  readAiJudgmentMeta,
  readAssertValueOutcomeMeta,
} from '../compound/metadata.js'
import { mintReportedValue, mintUniqueValue, defaultUniqueValueGenerator } from '../compound/dispatch-mint.js'
import { compareAssertValue } from '../compound/assert-value.js'
import {
  evaluateLocalEffect,
  toLocalEffectEvidence,
  classifyStagnation,
  StagnationTree,
  buildAnchorKey,
  RevisitationWindow,
  buildRevisitationKey,
  DEFAULT_REVISITATION_WINDOW,
  type EffectAnchor,
} from './progress/index.js'
import { createRecordLedger } from './record-ledger.js'

// v1's context-window overflow classification (loop.ts:277-286) — kept byte-equivalent
// (D-04, Pitfall 10): a planning error matching one of these is surfaced with the
// contextWindow/previousStepCount remediation hint rather than the raw error.
const CONTEXT_ERROR_PATTERNS = [
  'context length', 'maximum context', 'token limit',
  'too many tokens', 'exceeds.*max', 'input.*too long',
]

// D-10/LOOP-04 · Pitfall 7 — the DELIBERATELY CONSERVATIVE ref-resolution classifier.
// A matched adapter error string is a stale-ref/wrong-element failure the re-ground heal
// can rescue by re-observing + re-grounding (NOT a replan). Exactly two classes:
//   (a) the shared resolver prefix — 'Unknown ref "…"' (both the web and mobile
//       element-resolvers throw this verbatim), and
//   (b) the Playwright strict-mode violation — '…resolved to N elements'.
// Bare timeouts and every other failure are INTENTIONALLY excluded — they stay on the
// replan path (Phase 358's stagnation-tree domain, the D-10 boundary). Do not broaden it.
const REF_RESOLUTION_FAILURE_PATTERNS: RegExp[] = [
  /^\s*Unknown ref\s+["']/i,
  /resolved to \d+ element/i,
]

function isRefResolutionFailure(errorMsg: string): boolean {
  return REF_RESOLUTION_FAILURE_PATTERNS.some((pattern) => pattern.test(errorMsg))
}

const CANCELLED_MESSAGE = 'Step cancelled by user'

// Provisional fallbacks used only until the composition root supplies model-derived numbers
// (380 D-02/D-15/D-17). They are deliberately not config keys; the loop consumes plain budgets.
const PROVISIONAL_BRIEF_TOKEN_BUDGET = 512
const PROVISIONAL_CAUTION_TOKEN_BUDGET = 64
const PROVISIONAL_DISTINCT_RECORD_CAP = 8
const CAUTION_TRUNCATION_ID = 'caution:truncated'

// D-09/D-16 settle-gate bounds. The poll is deliberately small (Pitfall 4/5): the first
// observation doubles as stateBefore (no extra capture), so only the extra poll iterations
// before two consecutive matching screenIdentityHash values cost anything. The inter-poll
// wait defaults to 0 (deterministic, back-to-back) — the composition root injects a real
// animation-settling interval; the step deadline is the hard proceed-on-latest backstop.
const DEFAULT_SETTLE_MAX_POLLS = 3
const DEFAULT_SETTLE_INTERVAL_MS = 0

type LiveDecisionEvidence = Pick<RecordSubActionInput, 'exchanges' | 'callRecord' | 'decisionScreenshotRef'>

// The 8 surviving return paths (v1 had 9; the exec-fail-limit path is deleted, D-10):
//   1. planner stepFailed          → failed  (no execution)
//   2. setVariable + stepComplete  → passed  (short-circuit, no verify)
//   3. non-visual assert + complete→ passed  (short-circuit, no verify)
//   4. verify success              → passed  (stateAfter = verifier re-observation, D-15b)
//   5. verify app-error            → failed  (no further replan)
//   6. no-verifier + stepComplete  → passed  (trust the planner)
//   7. cap exhausted (maxSubActions)→ failed (clean terminate, the resource backstop)
//   8. abort / timeout             → cancelled | failed  (all three getTimeoutAbortReason variants)
// Execution failure and verifier "not done" are NOT return paths — they inject failure
// context and continue the loop (self-heal = replan-with-failure-context, D-12).
export async function executeStep(
  stepInstruction: string,
  ports: LoopPorts,
  context: StepContext,
): Promise<StepResult> {
  const startTime = performance.now()
  // D-11: modality resolved once at composition; absent gate = full-capture (the
  // pre-gate default for non-CLI callers and tests). The loop owns the branching.
  const gate = ports.visionGate ?? { attachImage: true, captureMode: 'full' as const, promptNote: '' }
  // D-11: the ONLY surviving resource backstop. Not a healing-attempts counter.
  const maxSubActions = ports.plannerConfig?.maxSubActions ?? 50
  // D-10: MUTABLE (was const) so the measured async-gate/confirm await extends it in-flight — the
  // three usage sites (loop-top check, settle gate) re-read this closure variable each iteration,
  // so a slow human confirm can never fake a step timeout (RESEARCH Pitfall 5).
  let deadline = ports.stepTimeout ? startTime + ports.stepTimeout : 0

  // §A8 evidence accumulator (D-14) — the recording array IS SubActionEvidence[].
  // D-02 (Plan 361-08): bind the one sub-action emission chokepoint to ports.events when
  // present, so every recordSubAction append emits `subActionRecorded` live — the five call
  // sites stay untouched. Unbound ⇒ no callback (byte-identical to today, D-05).
  const recorder = new EvidenceRecorder({
    onSubActionRecorded: ports.events
      ? (evidence, index) => ports.events?.subActionRecorded(evidence, index)
      : undefined,
    modelProfile: ports.modelProfiles?.planner,
    verifierIdentity: ports.modelProfiles?.verifier
      ? {
          provider: ports.modelProfiles.verifier.provider,
          modelId: ports.modelProfiles.verifier.modelId,
        }
      : undefined,
    toolSchemaDigest: ports.toolSchemaDigest,
  })
  const maskValue = ports.masking?.mask ?? ((value: string) => value)
  context.subActionHistory = []
  // D-17: one ledger object lives where turns live. A bound object is shared with Channel-2 tool
  // closures; otherwise this step-local instance still accounts for the frozen Channel-1 brief.
  const recordLedger = ports.recordLedger ?? createRecordLedger({
    cap: ports.knowledgeBudgets?.recordCap ?? PROVISIONAL_DISTINCT_RECORD_CAP,
    budget: (ports.knowledgeBudgets?.brief ?? PROVISIONAL_BRIEF_TOKEN_BUDGET)
      + (ports.knowledgeBudgets?.caution ?? PROVISIONAL_CAUTION_TOKEN_BUDGET)
      + (ports.beginMemoryTurn === undefined
        ? 0
        : (ports.knowledgeBudgets?.searchResults ?? PROVISIONAL_BRIEF_TOKEN_BUDGET)),
    seedRecords: [],
  })

  // Phase 358 progress subsystem (CYCLE-01..03). Fresh per-step instances (the Plan 04
  // documented scope): the revisitation window is per-step bookkeeping, the stagnation tree
  // keys per-element within this step. The prev-iteration carry feeds the effect oracle at the
  // next settled top (D-05, Pitfall 1). cycleBreakServed is a one-shot boolean (never a
  // counter — LOOP-02); activePredicate persists the declared D-09 bulk predicate for the run.
  const revisitation = new RevisitationWindow()
  const stagnationTree = new StagnationTree()
  let progressCarry: {
    action: Action
    anchor?: EffectAnchor
    anchorKey?: string
    stateBefore: ScreenState
    prevHash: string
    actionResult?: ActionResult
    evidenceIndex: number
  } | undefined
  let cycleBreakServed = false
  let cycleBreakAt = 0
  let activePredicate: string | undefined

  // D-10 remaining-budget: initialized to the resource cap, decremented per iteration, RESET
  // TO FULL on each confirmed unit of progress. The deadline is the sole absolute ceiling.
  let remaining = maxSubActions

  let totalPromptTokens = 0
  let totalCompletionTokens = 0
  let lastPlannedAction: Action | undefined
  // D-13: a failure retrieves once at the failure moment, then the returned block is consumed
  // by the immediately-following live planning turn. Clearing happens before that turn renders,
  // so a successful follow-up cannot make the caution sticky; a recurring failure stages anew.
  let pendingCautions: CautionBlock | undefined

  const stageFailureCautions = (
    failedAction: Action,
    failureState: ScreenState,
  ): void => {
    const anchors = deriveFailureCautionAnchors(failedAction, failureState, context.testName)
    const block = ports.knowledgeReader?.getCautions(
      anchors,
      ports.knowledgeBudgets?.caution ?? PROVISIONAL_CAUTION_TOKEN_BUDGET,
    )
    pendingCautions = block && block.cautions.length > 0 ? block : undefined
  }

  // D-09 policy-denied terminal marker (the 353/D-08 discriminated no-throw idiom, precedent:
  // PlanningTurnFailureReason). Set by executeResolvedAction when the async gate denies at ANY of
  // the five dispatch paths; the post-dispatch terminal check reads it and returns a terminal
  // policy_denied failure — no replan turn, no verifier call, no further planner call. Loop-local
  // by design (RESEARCH Open Q2: the existing failure/error shape suffices; no schema field minted).
  let policyDenial: { reason: string; riskTier?: RiskTier } | undefined

  // D-08 (Phase 360): a completing plan that dispatched an assertAI/extractAI step never
  // writes the cache (the runtime half of the CacheablePlannedAction type exclusion). This
  // one-shot latch threads the bypass stamp into finalize so cacheStatus emits 'bypass' —
  // orthogonal to the classifyStep NonCacheableStepInput signal above.
  let cacheBypass = false

  // PROC-02 (381 D-09..D-12) per-step procedure state. `procedureConsulted` makes the
  // getProcedure consult a strict once-per-step event (D-09); `procedureReplay` holds the
  // decoded body plus the guard-fold bookkeeping while replay drives actions — `aborted`
  // is the D-11 one-shot guard/execution-failure latch (no replay re-entry within the step;
  // max successfully replayed actions = the sequence length by `nextIndex` construction).
  // `procedureHintStaged`
  // carries the rendered hint block (matched-hint mode, unparseable-body demotion, or the
  // post-miss demotion with its divergence note) for ledger-metered exposure on every
  // subsequent live planning turn; `procedureHintExposed` keeps the planSource
  // procedure-hint write once-per-step.
  let procedureConsulted = false
  let procedureReplay: {
    match: ProcedureMatch
    payload: ProcedureBodyPayload
    nextIndex: number
    checksPassed: number
    aborted: boolean
    miss?: { procedureStepIndex: number; reason: ProcedureGuardMissReason }
    executionFailure?: { procedureStepIndex: number }
  } | undefined
  let procedureHintStaged: { procedureId: RecordId; anchors: Anchor[]; block: string } | undefined
  let procedureHintExposed = false

  // Loop-side procedure parameter binding (D-08/T-381-21): values bind by NAME from the
  // same source-tagged availability contract the matcher admitted (WR-03). Secret parameters
  // hard-wall to the secret store; strings preserve variables -> memory -> secret-template
  // precedence; numbers and booleans accept only type-valid variable/memory values. A miss here
  // is genuine availability/type drift and is reported as parameter-unbound below.
  const bindProcedureParam = (
    name: string,
    type: ProcedureParamType,
  ): string | number | boolean | undefined => {
    const asSecretTemplate = ports.secretStore?.has(name) ? `{{secret:${name}}}` : undefined
    if (type === 'secret') return asSecretTemplate

    const testVariable: unknown = context.variables?.[name]
    const memoryEntry = ports.workingMemory?.entries().find((entry) => entry.key === name)
    const raw: unknown = testVariable ?? memoryEntry?.value

    if (type === 'string') {
      if (raw !== undefined) return String(raw)
      return asSecretTemplate
    }
    if (type === 'number') {
      if (raw === undefined) return undefined
      const number = Number(raw)
      return Number.isFinite(number) ? number : undefined
    }
    if (raw === true || raw === false) return raw
    if (raw === 'true') return true
    if (raw === 'false') return false
    return undefined
  }

  // D-08 binding-NAME assembly (RESEARCH Open Q2): preserve the three source identities so
  // procedureParameterFillability and this binder apply one contract. These arrays carry names
  // only — no test-variable, working-memory, or secret value ever crosses the reader port.
  const assembleProcedureBindingAvailability = (): ProcedureBindingAvailability => {
    const variables = Object.keys(context.variables ?? {})
    const memory = [...new Set(
      (ports.workingMemory?.entries() ?? []).map((entry) => entry.key),
    )]
    const secrets = new Set<string>()
    ports.secretStore?.forEachSecret?.((name) => secrets.add(name))
    return { variables, memory, secrets: [...secrets] }
  }

  const recordProcedureReplaySource = (): void => {
    if (!procedureReplay) return
    recorder.recordPlanSource({
      kind: 'procedure-replay',
      procedureId: procedureReplay.match.id,
      guard: {
        checksPassed: procedureReplay.checksPassed,
        total: procedureReplay.payload.steps.length,
        ...(procedureReplay.aborted && procedureReplay.miss !== undefined
          ? { miss: procedureReplay.miss }
          : {}),
        ...(procedureReplay.executionFailure !== undefined
          ? { executionFailure: procedureReplay.executionFailure }
          : {}),
      },
    })
  }

  // D-15c self-heal boundary carry: the previous failed sub-action's index +
  // Decision. On the next iteration's observation (which reveals the failure), that
  // observation is attached as the failed sub-action's stateAfter AND is naturally the
  // recovering sub-action's stateBefore (identical-state sharing, one capture).
  let pendingSelfHeal: { index: number; failed: Decision } | undefined

  // CACHE-02 (D-07/D-08): classify the step by resolution provenance ONCE. A step that
  // reads a live secret ({{secret:X}} / [secret:*] marker) or sets an env/secret variable
  // is NonCacheableStepInput — the loop bypasses the cache entirely (no get, no set) and
  // finalize emits cacheStatus='bypass' (Pitfall 7). The read path reuses the shipped
  // findSecretTemplates/marker provenance; the set path reuses the setVariable verb
  // vocabulary until the live resolver-reported provenance is wired (Phase 362).
  const classification = classifyStep({
    stepText: stepInstruction,
    envSets: deriveEnvSetNames(stepInstruction),
  })
  const nonCacheable = classification.cacheable === false
  const cacheEnvVars = classification.cacheable === true ? classification.envVars : []

  // ---- terminal result builders ------------------------------------------------
  const tokenUsage = (): TokenUsage | undefined =>
    (totalPromptTokens > 0 || totalCompletionTokens > 0)
      ? { promptTokens: totalPromptTokens, completionTokens: totalCompletionTokens, totalTokens: totalPromptTokens + totalCompletionTokens }
      : undefined

  const finish = (
    status: StepResult['status'],
    verdict: VerifierVerdict,
    error?: string,
  ): StepResult => {
    // WM-01 masked snapshot (Pitfall 7 boundary 3): the whole served set snapshots into
    // StepEvidence.workingMemory with values masked (ports.masking.mask — identity pre-362),
    // BESIDE the brief. Unbound port ⇒ no snapshot (optional-port idiom).
    if (ports.workingMemory) {
      recorder.recordWorkingMemory(
        ports.workingMemory.entries().map((entry) => ({ ...entry, value: maskValue(entry.value) })),
      )
    }
    const evidence = recorder.finalize(verdict, 0, stepInstruction, { nonCacheable: nonCacheable || cacheBypass })
    // D-02 live emission (Plan 361-08): finish() is the single terminal funnel (success/
    // failure/cancelled + the direct finish() call sites all route here), so emitting once
    // here covers EVERY terminal path exactly once. Fire-and-forget SYNC, optional-chained —
    // the loop never awaits telemetry; unbound port ⇒ no emit, byte-identical (D-02/D-07/D-05).
    //
    // 363 D-01: this is the ONE place the StepResult-derived status/durationMs/error exist AND the
    // stepFinalized event is emitted, so the parity enrichment rides here (not a second core-side
    // emission, which would double-publish). `error` is masked at the sink chokepoint (T-363-05).
    const durationMs = performance.now() - startTime
    ports.events?.stepFinalized(evidence, { status, durationMs, error })
    // The legacy trace is projected FROM evidence (Open Q5) — this array is exactly
    // projectLegacyTrace(result.evidence); the loop never mutates it after projection.
    const subActions = projectLegacyTrace(evidence)
    const trace = buildStepTrace(subActions, status === 'passed' ? 'success' : 'failure', error, tokenUsage())
    const result: StepResult = {
      name: stepInstruction,
      status,
      duration: durationMs,
      trace,
      evidence,
    }
    if (lastPlannedAction) result.action = lastPlannedAction
    if (error) result.error = error
    const lastSub = subActions.length > 0 ? subActions[subActions.length - 1] : undefined
    if (lastSub?.annotation) result.annotation = lastSub.annotation
    return result
  }

  const success = (): StepResult => finish('passed', { pass: true, reasoning: 'Step completed' })
  const failure = (error: string): StepResult => finish('failed', { pass: false, reasoning: error }, error)
  const cancelled = (): StepResult => finish('cancelled', { pass: false, reasoning: CANCELLED_MESSAGE }, CANCELLED_MESSAGE)

  // Abort/timeout check — the three v1 timeout/cancel variants (getTimeoutAbortReason).
  const checkAbort = (): StepResult | undefined => {
    if (!ports.abortSignal?.aborted) return undefined
    const timeout = getTimeoutAbortReason(ports.abortSignal)
    return timeout ? failure(timeout.message) : cancelled()
  }

  const initialAbort = checkAbort()
  if (initialAbort) return initialAbort

  // Best-effort step-level "before" screenshot (artifacts; SCREEN-03).
  let screenshotBefore: Buffer | undefined
  if (ports.adapter.screenshot) {
    try { screenshotBefore = await withAbort(ports.adapter.screenshot(), ports.abortSignal) } catch { /* best-effort */ }
  }

  // The single execute step: resolve secret templates, project + AWAIT the async policy gate
  // (SEAM-03/D-08), dispatch to the adapter (or the setVariable callback), then the tool_result
  // hook. Shared by the primary dispatch AND the D-10 heal's patched re-execute so the security
  // ordering (redact-before-record, gate mediation) is single-sourced and cannot drift between
  // them, and so ALL five dispatch paths (primary, assertValue read, storageState save/restore,
  // heal re-execute) are gated. D-08: EVERY action projects into a RiskActionDescriptor and awaits
  // runToolCallAsync before any execution branch; read-only actions classify to an instant allow,
  // undeclared verbs hit the restricted floor. The vestigial sync runToolCall telemetry call is
  // superseded here (the v1 onPhase-only posture ends per SEAM-03); runToolResult is unchanged.
  const executeResolvedAction = async (
    toExecute: Action,
  ): Promise<{ result: ActionResult; error?: string }> => {
    let result: ActionResult
    try {
      // Template resolution stays INSIDE the try (T-353-08): a MissingSecretError is caught
      // and surfaced as a redacted execError — the action never reaches the adapter.
      const actionForExecution = resolveSecretTemplatesInValue(toExecute, ports.secretStore)
      if (ports.safetyHooks) {
        // Gate on the DESCRIPTOR; on allow execute the ORIGINAL resolved Action — never the hook
        // result's `call` payload, which is the descriptor (RESEARCH Pitfall 4). A mutate result on
        // the descriptor is advisory-only and never swaps the executed action.
        const descriptor = projectRiskAction(actionForExecution)
        const gateStart = performance.now()
        const gate = await ports.safetyHooks.runToolCallAsync(descriptor)
        // D-10: the measured gate/confirm await extends the step deadline — human decision time is
        // never attributed to the app under test (only when a deadline is armed).
        if (deadline) deadline += performance.now() - gateStart
        if (gate.action === 'deny') {
          // D-09: record the terminal marker (with the gate's audited D-16 reason + optional tier)
          // and short-circuit; the post-dispatch terminal check ends the step. The action never
          // reaches the adapter/callback.
          policyDenial = { reason: gate.reason, ...(gate.policy ? { riskTier: gate.policy.riskTier } : {}) }
          result = { success: false, error: gate.reason }
          result = ports.safetyHooks.runToolResult(result).result ?? result
          return { result, error: gate.reason }
        }
      }

      if (actionForExecution.type === 'setVariable') {
        // Pitfall 8 — setVariable runs via the callback, NOT the adapter (still gated above, D-08).
        const sv = actionForExecution as Extract<Action, { type: 'setVariable' }>
        ports.onSetVariable?.(sv.name, sv.value)
        result = { success: true }
      } else {
        let actionToExecute = actionForExecution
        if (actionForExecution.type === 'fileUpload' && ports.resolveUploadPath) {
          // Pitfall 1 — path resolution is injected core-side; the loop never touches paths.
          const resolveUpload = ports.resolveUploadPath
          actionToExecute = { ...actionForExecution, files: actionForExecution.files.map(f => resolveUpload(f)) }
        }
        result = redactSecretValue(
          await withAbort(ports.adapter.execute(actionToExecute), ports.abortSignal),
          ports.secretRedactor,
        )
      }
      result = ports.safetyHooks?.runToolResult(result).result ?? result
    } catch (err) {
      const error = redactSecretValue(err instanceof Error ? err.message : String(err), ports.secretRedactor)
      return { result: { success: false, error }, error }
    }
    const error = !result.success ? (result.error ?? 'Action failed') : undefined
    return { result, error }
  }

  for (let actionIndex = 0; ; actionIndex++) {
    const abortBeforeObserve = checkAbort()
    if (abortBeforeObserve) return abortBeforeObserve

    if (deadline && performance.now() > deadline) {
      return failure(`Step timed out after ${ports.stepTimeout}ms`)
    }

    // D-10 remaining-budget cap (the LOOP-02-compatible resource backstop — NOT an attempt
    // counter; it refreshes to full on confirmed progress below). Exhausted only when
    // maxSubActions consecutive iterations ran without a confirmed unit of progress.
    if (remaining <= 0) {
      return failure(`Sub-action limit reached (${maxSubActions} actions). Step did not complete.`)
    }
    remaining--

    // 1. SETTLE + OBSERVE — the bounded settle gate polls screenIdentityHash and proceeds
    // only on two consecutive matching hashes (or the maxPolls/deadline bound, D-16). The
    // settled observation IS the next sub-action's stateBefore by construction (D-15, no
    // extra capture — Pitfall 5). The settled hash triples as settle-stability, the 8th
    // cache-key component (Task 2), and the Phase-358 progress signal (one hash, D-09).
    let screenState: ScreenState
    let settledHash: string
    let settledStable: boolean
    try {
      const settled = await settle(
        () => withAbort(ports.adapter.observe({ extractDom: true }), ports.abortSignal),
        {
          maxPolls: DEFAULT_SETTLE_MAX_POLLS,
          intervalMs: DEFAULT_SETTLE_INTERVAL_MS,
          deadline,
          signal: ports.abortSignal,
        },
      )
      screenState = settled.state
      settledHash = settled.hash
      settledStable = settled.settled
    } catch (err) {
      const abortResult = checkAbort()
      if (abortResult) return abortResult
      throw err
    }

    // D-15c: the observation that reveals a prior failure is the failed sub-action's
    // stateAfter (and this iteration's planning stateBefore — the same object).
    if (pendingSelfHeal) {
      recorder.attachStateAfter(pendingSelfHeal.index, screenState)
    }

    // 1b. DIFFERENTIAL EFFECT CHECK (CYCLE-01/02/03, D-05, Pitfall 1). Evaluate the PREVIOUS
    // iteration's executed action against THIS fresh settled observation — action N's
    // post-state by construction, zero extra observes. The carry is the post-heal action set
    // at the bottom of iteration N (a D-10-healed patched action is what gets checked).
    // Execution-failed actions never set a carry (they route to the replan/failure-context
    // flow instead — no oracle, no double-count). Per-turn volatile blocks are cleared here
    // and repopulated only for this iteration's planning turn.
    context.stagnation = undefined
    context.cycleBreak = undefined
    if (progressCarry) {
      const carry = progressCarry
      progressCarry = undefined
      const localEffect = evaluateLocalEffect({
        action: carry.action as { type: string; [key: string]: unknown },
        anchor: carry.anchor,
        stateBefore: carry.stateBefore,
        stateAfter: screenState,
        prevHash: carry.prevHash,
        currentHash: settledHash,
        actionResult: carry.actionResult,
      })
      // Evidence-by-construction (D-07): the localEffect block lands on action N's already-
      // recorded sub-action by its carried index (one iteration late — D-05).
      recorder.attachLocalEffect(carry.evidenceIndex, toLocalEffectEvidence(localEffect))

      const revisitKey = buildRevisitationKey(settledHash, screenState)
      const flagged = revisitation.record({ key: revisitKey, progress: localEffect.achieved }).flagged

      if (localEffect.achieved) {
        // Confirmed progress ⇒ reset the anchor's ladder (reset-on-progress) + refresh the
        // budget to full (D-10). Never flagged — even a byte-identical repeat that IS the task.
        if (carry.anchorKey) stagnationTree.reset(carry.anchorKey)
        remaining = maxSubActions
      } else if (flagged) {
        // CYCLE-03 owns a revisited-with-no-progress state (D-08); the per-element tree defers.
        if (!cycleBreakServed) {
          // First confirmed cycle flag ⇒ ONE cycle-break turn (one-shot boolean, LOOP-02).
          cycleBreakServed = true
          cycleBreakAt = actionIndex
          context.cycleBreak = {
            revisitedKey: revisitKey,
            windowSummary: `The state ${revisitKey} was revisited with no confirmed task progress across the last ${DEFAULT_REVISITATION_WINDOW} steps. Change approach or declare stepFailed.`,
          }
        } else if (actionIndex - cycleBreakAt >= DEFAULT_REVISITATION_WINDOW) {
          // The following window again showed zero task progress ⇒ terminal cycle fail (D-08),
          // recording the event-scoped CycleEvidence block (D-07).
          recorder.recordCycle({
            revisitedKey: revisitKey,
            windowSummary: [revisitKey],
            reason: `State revisited with no confirmed task progress across the ${DEFAULT_REVISITATION_WINDOW}-step window after a cycle-break turn.`,
          })
          return failure(`Cycle detected: ${revisitKey} revisited with no task progress after a cycle-break turn.`)
        }
      } else if (carry.anchor && carry.anchorKey) {
        // No local effect, no cycle ⇒ the per-element bounded stagnation ladder (D-01/D-02).
        // No-anchor actions (navigate/waitFor/coordinates) skip the tree entirely (Open Q5);
        // their no-effect outcomes fed only the revisitation window above.
        const stagnationClass = classifyStagnation({
          stateBefore: carry.stateBefore,
          stateAfter: screenState,
          anchor: carry.anchor,
          settleResult: { settled: settledStable },
          actionResult: carry.actionResult,
        })
        if (stagnationClass === 'transient-load') {
          // D-01 mechanical rung: absorb wait into a bounded settle re-arm (once per iteration
          // — this whole block runs once per iteration — deadline-bounded, no budget charge,
          // Open Q4). A permanently-busy screen still terminates via the loop-top deadline.
          try {
            const rearmed = await settle(
              () => withAbort(ports.adapter.observe({ extractDom: true }), ports.abortSignal),
              { maxPolls: DEFAULT_SETTLE_MAX_POLLS, intervalMs: DEFAULT_SETTLE_INTERVAL_MS, deadline, signal: ports.abortSignal },
            )
            screenState = rearmed.state
            settledHash = rearmed.hash
            settledStable = rearmed.settled
          } catch (err) {
            const abortResult = checkAbort()
            if (abortResult) return abortResult
            throw err
          }
        } else {
          const rec = stagnationTree.recordNoEffect(carry.anchorKey, stagnationClass)
          // Judgment rungs route to the planner (D-01); unresponsive gets raw facts, no
          // recommended remedy (D-02). All app text is rendered injection-inert downstream.
          const stagnationBlock: NonNullable<StepContext['stagnation']> = {
            classification: stagnationClass,
            anchor: carry.anchor,
            diff: `No local intended effect after "${carry.action.type}" on the anchored control ${carry.anchorKey}.`,
          }
          // Populate the longpress-for-tap ban for a stagnating tap-class anchor (D-04) —
          // Plan 06's groundability closure enforces it deterministically pre-gate.
          if (TAP_CLASS_VERBS.has(carry.action.type)) {
            stagnationBlock.bannedSubstitutions = [{ anchorKey: carry.anchorKey, banned: 'longpress', required: 'tap' }]
          }
          context.stagnation = stagnationBlock
          if (rec.terminal) {
            // Terminal anchor bound (D-03) ⇒ structured stepFailed carrying the StagnationEvidence
            // trail (runner-enforced, D-01), recorded event-scoped at the terminal (D-07).
            recorder.recordStagnation(toStagnationEvidence(carry.anchorKey, stagnationTree))
            return failure(`Stagnation: no local effect on ${carry.anchorKey} after the bounded remediation ladder (${rec.totalCount} attempts).`)
          }
        }
      }
    }

    let screenshot: Buffer | undefined
    if (ports.adapter.screenshot) {
      try { screenshot = await withAbort(ports.adapter.screenshot(), ports.abortSignal) } catch { /* best-effort */ }
    }

    const abortAfterObserve = checkAbort()
    if (abortAfterObserve) return abortAfterObserve

    // Derive the ONE finalized planner attachment and its capture stamp from a single source
    // (T-367-17). The configured compression branch owns compressed bytes + returned dims; when
    // an image is attached but no vision sizing is configured, the RAW bytes are the attachment
    // and dims come from the dimension port (host-neutral viewport fallback when unbound). The
    // captureMode is then stamped ONCE from the actual attachment, so `full`/`textOnly` describes
    // the real planner call on both the compressed and raw/no-sizing paths (Pitfall 9).
    let captureDims: { imageWidth: number; imageHeight: number } | undefined
    if (gate.attachImage && screenshot && ports.compressor && (ports.vision?.screenshotSize || ports.vision?.effectiveResolution)) {
      if (!ports.vision?.effectiveResolution) {
        throw new Error('effectiveResolution is required in LLM config when screenshot compression is enabled')
      }
      try {
        const actionSpaceWidth = (screenState.metadata.viewportWidth as number | undefined)
          ?? (await withAbort(ports.compressor.dimensions(screenshot), ports.abortSignal)).width
          ?? 0
        const compressed = await withAbort(
          ports.compressor.compress(screenshot, {
            effectiveResolution: ports.vision.effectiveResolution,
            maxBytes: ports.vision.screenshotSize,
            actionSpaceWidth,
          }),
          ports.abortSignal,
        )
        screenshot = compressed.buffer
        captureDims = { imageWidth: compressed.imageWidth, imageHeight: compressed.imageHeight }
      } catch (err) {
        const abortResult = checkAbort()
        if (abortResult) return abortResult
        throw err
      }
    } else if (gate.attachImage && screenshot) {
      // Raw / no-sizing attachment: the exact raw bytes reach the planner unmodified. Dimensions
      // come from the compressor port when bound, else the recorded viewport is the explicit
      // host-neutral fallback (no host image decode inside the runner).
      try {
        if (ports.compressor) {
          const dims = await withAbort(ports.compressor.dimensions(screenshot), ports.abortSignal)
          captureDims = { imageWidth: dims.width, imageHeight: dims.height }
        } else {
          captureDims = {
            imageWidth: (screenState.metadata.viewportWidth as number | undefined) ?? 0,
            imageHeight: (screenState.metadata.viewportHeight as number | undefined) ?? 0,
          }
        }
      } catch (err) {
        const abortResult = checkAbort()
        if (abortResult) return abortResult
        throw err
      }
    }

    // Inject the gated image + prompt note for the planner (D-11): text-only omits the
    // image block and leans on the tree/DOM via the prompt note.
    context.screenshot = gate.attachImage && screenshot ? screenshot : undefined
    context.promptNote = gate.promptNote

    // One authoritative modality stamp over the finalized attachment: `full` (with the selected
    // dims) when an image is attached, otherwise `textOnly`. This is the single source of the
    // recorded stateBefore.metadata.captureMode for every planner call.
    screenState = context.screenshot && captureDims
      ? stampCaptureMode(screenState, { mode: 'full', imageWidth: captureDims.imageWidth, imageHeight: captureDims.imageHeight })
      : stampCaptureMode(screenState, { mode: 'textOnly' })

    // 2. PLAN — procedure-first at step start (PROC-02/D-09), then the replay → re-ground →
    // replan hit ladder (D-13), then the planning turn.
    //
    // 2a. STEP-START PROCEDURE CONSULT (D-09): exactly once per step, before the first
    // planning turn AND before the per-decision cache consult (the researcher-recommended
    // procedure-first precedence). Optional-chained getRunBrief idiom: an unbound reader
    // costs nothing (binding names are not even assembled) and never throws. Intent is the
    // NL step text; source-tagged binding NAMES are assembled loop-side — values never cross.
    if (!procedureConsulted) {
      procedureConsulted = true
      if (ports.knowledgeReader) {
        const match = ports.knowledgeReader.getProcedure(
          stepInstruction,
          screenState,
          assembleProcedureBindingAvailability(),
        )
        if (match !== undefined) {
          if (match.replayRecommendation === 'replay') {
            // Fetch + decode the committed body. parseProcedureBody is fail-closed
            // (T-381-01): an unreadable or unparseable body demotes the match to hint —
            // never a throw, never a blind replay.
            const body = ports.knowledgeReader.read(match.id)
            const payload = body === undefined ? undefined : parseProcedureBody(body.body)
            if (payload !== undefined && payload.steps.length > 0) {
              procedureReplay = { match, payload, nextIndex: 0, checksPassed: 0, aborted: false }
            } else {
              procedureHintStaged = {
                procedureId: match.id,
                anchors: [match.flowAnchor],
                block: renderProcedureHintBlock(match, payload, undefined, maskValue),
              }
            }
          } else {
            // Hint recommendation: no replay. The body read is best-effort enrichment for
            // the outline — a missing/unparseable body is NOT a failure (Test 5b).
            const body = ports.knowledgeReader.read(match.id)
            const payload = body === undefined ? undefined : parseProcedureBody(body.body)
            procedureHintStaged = {
              procedureId: match.id,
              anchors: [match.flowAnchor],
              block: renderProcedureHintBlock(match, payload, undefined, maskValue),
            }
          }
        }
      }
    }

    let planResult: PlanResult
    let cached = false
    let procedureReplayed = false
    // A passed guard authorizes exactly one dispatch attempt; its cursor/fold commit is
    // deferred until that action has actually executed successfully (381 CR-02).
    let pendingProcedureReplay: {
      procedureStepIndex: number
      instruction: string
    } | undefined
    // The per-decision-point cache key: masked stepText + value-free env digest + the
    // settled screenIdentityHash as the 8th component (D-05/D-09). Branch never enters key
    // material. Undefined for non-cacheable (bypassed) steps or when no cache is bound.
    let cacheKey: CacheKey | undefined
    const cacheActive = !nonCacheable && !!ports.cache

    // 2b. GUARDED PROCEDURE REPLAY (D-10/D-11): while a replay recommendation is live and
    // the sequence is not exhausted, each decision comes from the next committed action —
    // under the FULL guard (unique fresh-screen re-ground + page-anchor equality +
    // grounding gate, the one guard idiom shared with cache replay, T-356-04a). A guard
    // miss aborts replay for the WHOLE step: the miss is folded into planSource, the
    // procedure demotes to hint context with the divergence noted, and ordinary planning
    // takes over — no replay re-entry within this step (one-shot, D-11). Replayed actions
    // keep `cached: false`, skip the cache consult below, and are never written back into
    // the action cache.
    if (procedureReplay && !procedureReplay.aborted
      && procedureReplay.nextIndex < procedureReplay.payload.steps.length) {
      const replayState = procedureReplay
      const procedureStep = replayState.payload.steps[replayState.nextIndex]
      // Landmarks are a SOFT diagnostic only (D-10): a missing landmark logs, never misses.
      for (const landmark of procedureStep.guard.landmarks ?? []) {
        if (!screenState.tree.includes(landmark)) {
          ports.logger?.createScopedLogger('procedure')?.debug(
            'Stored landmark not observed on the fresh screen (soft diagnostic only)',
            { landmark, procedureStepIndex: replayState.nextIndex },
          )
        }
      }
      const paramTypes = new Map(replayState.payload.parameters.map((p) => [p.name, p.type]))
      const attempt = attemptProcedureReplayAction({
        step: procedureStep,
        isFinal: replayState.nextIndex === replayState.payload.steps.length - 1,
        screenState,
        bind: (name) => bindProcedureParam(name, paramTypes.get(name) ?? 'string'),
      })
      if (attempt.ok) {
        planResult = { plan: attempt.plan }
        procedureReplayed = true
        pendingProcedureReplay = {
          procedureStepIndex: replayState.nextIndex,
          instruction: procedureStep.instruction,
        }
        // Record that this step is procedure-driven immediately. The accumulator is
        // last-write-wins; success or execution failure below replaces this pending fold.
        recordProcedureReplaySource()
      } else {
        replayState.aborted = true
        replayState.miss = {
          procedureStepIndex: replayState.nextIndex,
          reason: attempt.reason,
        }
        recordProcedureReplaySource()
        // D-11 demotion: the procedure re-enters as hint context with the divergence noted
        // (which action, which guard, what differed) for every remaining planning turn.
        procedureHintStaged = {
          procedureId: replayState.match.id,
          anchors: [replayState.match.flowAnchor],
          block: renderProcedureHintBlock(
            replayState.match,
            replayState.payload,
            `Guarded replay diverged at procedure step ${replayState.nextIndex + 1} `
              + `("${procedureStep.instruction}"): ${attempt.detail}`,
            maskValue,
          ),
        }
      }
    }

    if (!procedureReplayed && cacheActive) {
      cacheKey = computeCacheKey(buildCacheableStepInput({
        masking: ports.masking,
        platform: screenState.platform,
        // D-20 (Plan 361-08): key the cache on the real digests the CLI mints when present, so
        // cache identity and the future handoff identity share ONE mint (Pitfall 1 — they cannot
        // fork). Absent port ⇒ empty strings, preserving today's key material exactly (D-05). The
        // one-time invalidation when real digests first arrive is accepted (no-back-compat law).
        suiteConfigDigest: ports.configDigests?.suiteConfigDigest ?? '',
        testConfigDigest: ports.configDigests?.testConfigDigest ?? '',
        stepText: stepInstruction,
        stepIndex: actionIndex,
        testIndex: 0,
        envVars: cacheEnvVars,
        screenIdentityHash: settledHash,
      }))
      const hit = await ports.cache!.get(cacheKey)
      if (hit) {
        // Exact-key hit: re-ground each stored descriptor against the FRESH observation
        // (a stored descriptor never drives a blind click, T-356-04a). All resolve ⇒
        // replay with NO LLM call. Any unmatched ⇒ invalidate and fall through to replan.
        const replay = replayFromCache(hit, screenState.elements)
        if (replay) {
          planResult = { plan: replay }
          cached = true
        } else {
          await ports.cache!.invalidate(cacheKey)
          ports.logger?.createScopedLogger('cache')?.debug(
            'Cached descriptor no longer resolves — re-planning', { actionIndex },
          )
        }
      }
    }

    if (!procedureReplayed && !cached) {
      // Safety context attachment point (loop.ts:265) — optional-chained (D-05).
      context = ports.safetyHooks?.runContext(context).context ?? context
      // Knowledge-brief sourcing seam (D-12): source the full three-tier brief through the
      // optional KnowledgeHintReader port, mirroring the safetyHooks optional-chain idiom
      // above. In M1 `ports.knowledgeReader` is unbound, so this yields undefined and the
      // slots stay empty and NEVER throw. D-05 routes only sovereign/authored L0 into the
      // cached-prefix context tier; learned L1/L2 remain volatile and are always framed as
      // hypotheses, never instructions. Channel 1 is deterministic, Channel 2 has planner
      // agency, and Channel 3 has no agency; all three share the distinct-id ledger below.
      const briefScope = { tier: 'test', key: context.testName } as const
      const briefBudget = ports.knowledgeBudgets?.brief ?? PROVISIONAL_BRIEF_TOKEN_BUDGET
      const brief = ports.knowledgeReader?.getRunBrief(
        briefScope,
        briefBudget,
      )
      if (brief !== undefined) {
        context.knowledgePolicyL0 = brief.tiers.L0.trim().length > 0 ? brief.tiers.L0 : undefined
        context.knowledgeBriefL1 = brief.tiers.L1.trim().length > 0 ? brief.tiers.L1 : undefined
        context.knowledgeBriefL2 = brief.tiers.L2.trim().length > 0 ? brief.tiers.L2 : undefined
        context.knowledgeBriefTruncation = brief.truncation.trim().length > 0
          ? brief.truncation
          : undefined
        // Reader-backed runs use the structured fields above; clear the compatibility string so
        // an empty real block cannot accidentally resurrect caller-supplied learned material.
        context.knowledgeBrief = undefined
        recorder.recordServedBrief({
          scope: briefScope,
          asOfBuild: ports.knowledgeAsOfBuild ?? 0,
          budget: briefBudget,
          block: brief,
        })
      }
      // The brief rides every planning turn, so its distinct ids are already spent before any
      // agentic search/read or automatic failure caution can admit a record (Pitfall 9).
      recordLedger.resetTurn(brief?.admissions ?? [])
      // D-11: reset the independent cumulative read-body counter only after the shared distinct-id
      // ledger has been reseeded for this turn. An unregistered Channel-2 surface leaves this absent.
      ports.beginMemoryTurn?.(briefScope, brief?.lines.map((line) => line.id) ?? [])
      // D-13/D-16/D-17 Channel 3 has no agency: surface the staged records as failure-adjacent
      // observations inside the existing hypotheses frame, then clear them. Re-emphasizing an
      // id already present in Channel 1 is intentionally free — the planner should not have to
      // remember the caution after demonstrating the exact failure it warns about. New ids still
      // consume the shared distinct-record cap, and every refusal is visible rather than clipped.
      const cautionsForTurn = pendingCautions
      pendingCautions = undefined
      if (cautionsForTurn && cautionsForTurn.cautions.length > 0) {
        const injected: CautionLine[] = []
        let refused = 0
        let recordCount = 0
        const admissionById = new Map(
          cautionsForTurn.admissions.map((metadata) => [String(metadata.id), metadata]),
        )
        for (const caution of cautionsForTurn.cautions) {
          if (caution.id === CAUTION_TRUNCATION_ID) {
            // 380-10's reserved terminal line is a reader-owned overflow signal, not a durable
            // record. Render it, but never spend or mint a ledger admission for it.
            injected.push(caution)
            continue
          }
          recordCount++
          const metadata = admissionById.get(String(caution.id))
          if (metadata !== undefined && recordLedger.admit(metadata).admitted) {
            injected.push(caution)
          } else {
            // Missing cost/source/cluster metadata is a fail-closed omission, never an unmetered
            // fallback. Production reader blocks always carry it by contract.
            refused++
          }
        }

        const observations = injected.map((caution) => caution.summary)
        if (refused > 0) observations.push(`truncated ${refused} of ${recordCount}`)
        if (observations.length > 0) {
          recorder.recordServedCautions(injected)
          const frame = `Failure-adjacent caution observations:\n${observations.join('\n')}`
          context.knowledgeBriefL1 = context.knowledgeBriefL1?.trim()
            ? `${context.knowledgeBriefL1}\n\n${frame}`
            : frame
        }
      }
      // PROC-02 hint exposure (D-11 / T-381-20): a matched-hint or post-miss-demoted
      // procedure renders as one compact DATA-wrapped block appended into the L2 slot —
      // the volatile hypotheses-not-instructions frame's procedures tier (the Channel-3
      // caution append idiom above; BRIF-01 lineage: hypotheses, never instructions or
      // commands, on every prompt surface). Admission rides the shared record ledger with
      // real ServingRecordMetadata (id + flow-anchor cluster + renderedCost); a refusal
      // drops the block fail-closed for this turn — never the turn itself, never an
      // unmetered fallback. Empty-slot omission is preserved: no staged hint ⇒ no section.
      if (procedureHintStaged) {
        const hint = procedureHintStaged
        const admitted = recordLedger.admit(servingRecordMetadata({
          id: hint.procedureId,
          anchors: hint.anchors,
          renderedCost: estimateTokens(hint.block),
        })).admitted
        if (admitted) {
          context.knowledgeBriefL2 = context.knowledgeBriefL2?.trim()
            ? `${context.knowledgeBriefL2}\n\n${hint.block}`
            : hint.block
          // RESEARCH Open Q3 (D-12): a hint actually rendered into a planning turn records
          // planSource procedure-hint — unless a replay attempt already owns the planSource
          // slot (post-miss demotion keeps the procedure-replay fold with its miss).
          if (!procedureHintExposed && procedureReplay === undefined) {
            recorder.recordPlanSource({ kind: 'procedure-hint', procedureId: hint.procedureId })
          }
          procedureHintExposed = true
        }
      }
      // WM-01 serve (D-11): the whole run-scoped set is served verbatim to every planning turn
      // via the optional workingMemory port (the knowledgeReader idiom). Unbound ⇒ left as-is,
      // the loop runs memory-less. The served set is what finalize snapshots masked.
      if (ports.workingMemory) context.workingMemory = ports.workingMemory.entries()
      // D-09 active bulk-completion predicate — re-stated as volatile turn content each turn
      // (persisted once declared); the planner re-evaluates + cites, the verifier backstops.
      context.bulkCompletionPredicate = activePredicate
      try {
        planResult = await withAbort(
          ports.planner.plan(stepInstruction, screenState, context, ports.abortSignal),
          ports.abortSignal,
        )
      } catch (planError: unknown) {
        recorder.recordServedReadTraces(ports.drainMemoryReadTraces?.() ?? [])
        const abortDuringPlan = checkAbort()
        if (abortDuringPlan) return abortDuringPlan
        if (planError instanceof PlanningTurnError) {
          recorder.recordPlanningFailure({
            reason: planError.reason,
            message: maskValue(planError.message),
            exchanges: maskToolExchanges(planError.exchanges, maskValue),
            ...(planError.callRecord !== undefined ? { callRecord: planError.callRecord } : {}),
          })
        }
        const errorMsg = planError instanceof Error ? planError.message : String(planError)
        const isContextError = CONTEXT_ERROR_PATTERNS.some(p => new RegExp(p, 'i').test(errorMsg))
        const displayMsg = isContextError
          ? `Model context window exceeded. ${errorMsg}. Increase contextWindow on your LLM config or reduce previousStepCount in planner config.`
          : `LLM planning failed: ${errorMsg}`
        return failure(displayMsg)
      }
      recorder.recordServedReadTraces(ports.drainMemoryReadTraces?.() ?? [])
    }

    if (planResult!.tokenUsage) {
      totalPromptTokens += planResult!.tokenUsage.promptTokens
      totalCompletionTokens += planResult!.tokenUsage.completionTokens
    }

    // A procedure-replayed decision has no live planning turn (the cache-replay parity):
    // no exchanges, no call record, no decision screenshot.
    const liveDecisionEvidence: LiveDecisionEvidence | undefined = (cached || procedureReplayed)
      ? undefined
      : {
          exchanges: maskToolExchanges(planResult!.exchanges ?? [], maskValue),
          ...(planResult!.callRecord !== undefined ? { callRecord: planResult!.callRecord } : {}),
        }

    // §A8 decision-screenshot persistence (CASS-02, T-367-17). For a LIVE model decision that
    // attached an image, persist the EXACT bytes the planner received (context.screenshot — never
    // the step-level artifact shot, raw pre-compression bytes, or a later shot) exactly once and
    // record the returned ref ON liveDecisionEvidence, so every terminal evidence branch this
    // iteration carries it through the one existing spread (recordSubAction / recordSuccess).
    // Cache replays (liveDecisionEvidence absent) and text-only turns (no context.screenshot) mint
    // no ref. A host-store failure is caught and warned bytes-free (T-367-17-I/D): the ref stays
    // absent so downstream completeness can classify the missing evidence — the run never fails.
    if (liveDecisionEvidence && context.screenshot && ports.evidenceArtifacts) {
      try {
        liveDecisionEvidence.decisionScreenshotRef = ports.evidenceArtifacts.persistDecisionScreenshot(context.screenshot)
      } catch {
        ports.logger?.createScopedLogger('evidence')?.warn('Failed to persist decision screenshot')
      }
    }

    const rawPlan = planResult!.plan

    // WM-01 CAPTURE-BEFORE-NAVIGATE (Pattern 6): the planner authored remember[] against the
    // pre-action observation this turn — write it to the run-scoped store BEFORE the action
    // dispatches, so the entries record atomically with the navigating action. The store
    // redacts registered secrets at capture (Pitfall 7 boundary 1); values stay verbatim.
    if (rawPlan.remember && rawPlan.remember.length > 0) {
      ports.workingMemory?.capture(rawPlan.remember, { step: actionIndex })
    }
    // D-09 persist the declared bulk-completion predicate for the rest of the run.
    if (rawPlan.bulkCompletionPredicate) activePredicate = rawPlan.bulkCompletionPredicate

    const normalizedAction = normalizePointerActionForStep(rawPlan.action as Action, stepInstruction)
    // Redact BEFORE recording (Information-disclosure control, T-353-08): every value
    // that reaches evidence/display is pre-redacted; secret templates are resolved only
    // at the execute boundary below.
    let action = redactSecretValue(normalizedAction, ports.secretRedactor)
    const reasoning = redactSecretValue(rawPlan.reasoning, ports.secretRedactor)
    lastPlannedAction = action

    // The grounding gate is the ONE chokepoint between plan and adapter.execute (D-08).
    // Live turn-produced plans arrive gate-resolved from the Plan-06 turn — their §A8 trail
    // rides on rawPlan.groundingAttempts, and re-running the gate here would double-ground
    // against the same observation. Only the cache-replay path (and any residual out-of-turn
    // plan) is (re-)validated here: replayFromCache already resolved every stored descriptor
    // to a fresh ref, so the gate confirms the ref is in the fresh snapshot and yields the
    // §A8 attempt trail for the replay's evidence. A gate failure maps: ref_not_in_snapshot ⇒
    // the D-10 heal; any other failure ⇒ the failure-context flow.
    let gateAttempts: GroundingAttempt[] | undefined = rawPlan.groundingAttempts
    let gateForcedError: string | undefined
    let gateForcedRefMiss = false
    if (cached) {
      const gateResult = groundActionPlan({
        toolName: normalizedAction.type,
        action: normalizedAction as unknown as Record<string, unknown>,
        screenState,
      })
      if (gateResult.ok) {
        gateAttempts = gateResult.attempts
      } else {
        gateForcedError = gateResult.error.message
        gateForcedRefMiss = gateResult.error.code === 'ref_not_in_snapshot'
      }
    }

    // The §A8 grounding block for this sub-action's evidence (GROUND-02), redacted before
    // record (T-357-02a). Recomputed to the heal trail below if the D-10 heal fires.
    let grounding = buildGroundingEvidence(action, screenState.elements, gateAttempts, ports.secretRedactor)

    // Persist the completing decision's plan into the per-key cache as a descriptor-only
    // value (D-12 overfit guard: buildCachedPlanValue strips ref/coords/data and derives
    // role+nameNormalized+ordinal locators). setVariable actions are never cached (env
    // provenance). No-op for bypassed steps, cache hits, or when no cache is bound.
    const cacheCompletingPlan = async (): Promise<void> => {
      // Pitfall 4 cache-vs-procedure precedence: a procedure-replayed completing plan is
      // NEVER persisted into the action cache. The procedure store owns replaying whole
      // flows; double-storing a replayed action under a decision cache key would let the
      // cached flag claim what planSource already attributes — evidence separation (D-12)
      // requires exactly one provenance per decision. (Structurally `cacheKey` is already
      // undefined here because replayed decisions skip the cache consult; this guard makes
      // the precedence decision explicit.)
      if (procedureReplayed) return
      if (!cacheActive || cached || !cacheKey || !ports.cache) return
      if (normalizedAction.type === 'setVariable') return
      // D-08 write guard (Phase 360): an AI-assertion plan is never persisted. Narrowing the
      // action away from the assertAI/extractAI members IS the CacheablePlannedAction typecheck
      // proof (Plan 09's Exclude type) — buildCachedPlanValue below receives only cacheable
      // members without a cast, and the bypass stamp threads through finalize.
      if (normalizedAction.type === 'assertAI' || normalizedAction.type === 'extractAI') return
      await ports.cache.set(cacheKey, buildCachedPlanValue({
        plannedActions: [normalizedAction],
        elements: screenState.elements,
        verificationOutcome: 'passed',
      }))
    }

    const abortAfterPlan = checkAbort()
    if (abortAfterPlan) return abortAfterPlan

    // stepFailed — the planner declares the step impossible; no execution (loop.ts:262).
    if (rawPlan.stepFailed) {
      recorder.recordSubAction({
        plan: reasoning,
        plannedAction: action as unknown as SchemaAction,
        stateBefore: screenState,
        result: toSchemaResult({ success: false, error: `Planner signaled step failure: ${reasoning}` }),
        cached: false,
        grounding,
        ...(liveDecisionEvidence ?? {}),
      })
      // D-04 fork (Phase 360): a `failureKind:'infeasible'` turn is a machine-distinguishable
      // terminal outcome — record the typed StepEvidence.termination block ({kind,reason}) and
      // return a distinct failure verdict. A plain stepFailed (no failureKind) stays byte-unchanged.
      if (rawPlan.failureKind === 'infeasible') {
        const reason = redactSecretValue(rawPlan.failureReason ?? '', ports.secretRedactor)
        recorder.recordTermination({ kind: 'infeasible', reason })
        return failure(`Step declared infeasible: ${reason}`)
      }
      return failure(`Step failed: ${reasoning}`)
    }

    // 3. EXECUTE — resolve templates only here; gate through the tool_call hook. The
    // replay gate may have already rejected the action (D-08), in which case it never
    // reaches the adapter and the failure routes into the heal / failure-context flow.
    let execResult: ActionResult
    let execError: string | undefined
    // D-14: judged pre-dispatch on the settled `screenState` only (never a live probe, Pitfall 10).
    const idempotentNoop = gateForcedError === undefined
      ? desiredStateSatisfied(normalizedAction, screenState)
      : undefined
    // Phase 360 dispatch verbs siblinged at the ONE chokepoint (357 D-08 law): the runner-mint
    // termination verbs (reportValue/uniqueValue), the AI judge lane (assertAI/extractAI), the
    // structured assertValue read→compare lane, and the storage-state strip/inject seam all
    // decide here — no second pre-adapter decision site. Helper logic lives in the Plan 08/09
    // compound + verifier modules; only the branch decisions live here.
    const dispatchVerb = normalizedAction.type
    // MASK-FUT-01 boundary (identity pre-362): value-bearing evidence is masked BEFORE record,
    // the recordWorkingMemory idiom. `action` is already secret-redacted at this point, so this
    // is the additional masking layer, not the secret guard.
    if (gateForcedError !== undefined) {
      execResult = { success: false, error: gateForcedError }
      execError = gateForcedError
    } else if (dispatchVerb === 'reportValue') {
      // D-01/D-02/D-03: a platform-less answer verb mints a success ActionResult here — never
      // adapter.execute. The answer surfaces on metadata.reportedValue and lands masked-before-
      // record in StepEvidence.reportedValue. reportValue is NON-terminal (D-02): the plan-field
      // envelope (stepComplete/stepFailed) stays the sole termination mechanism.
      const reportedValue = maskValue(String((action as { value?: unknown }).value ?? ''))
      execResult = mintReportedValue({ value: reportedValue })
      execError = undefined
      recorder.recordReportedValue({ value: reportedValue })
    } else if (dispatchVerb === 'uniqueValue') {
      // D-16: mint prefix + injectable-generator suffix here (zero adapter.execute), then auto-write
      // the minted value into run-scoped working memory keyed by the prefix (kind extracted-value /
      // provenance toolResult). Cache replay re-enters this branch and re-mints fresh (uniqueness
      // is the semantic) — no special-casing.
      const prefix = String((action as { prefix?: unknown }).prefix ?? '')
      const minted = mintUniqueValue({ prefix }, ports.uniqueValueGenerator ?? defaultUniqueValueGenerator)
      execResult = minted
      execError = undefined
      const uv = readUniqueValueMeta(minted)
      if (uv) {
        ports.workingMemory?.capture(
          [{ key: prefix, value: maskValue(uv.value), kind: 'extracted-value', provenance: 'toolResult', stepIndex: actionIndex }],
          { step: actionIndex },
        )
      }
    } else if (dispatchVerb === 'assertAI' && ports.verifier?.judgeClaim) {
      // D-05/D-06/D-09: route the claim through the verifier's injected model lane exactly once —
      // never adapter.execute, never a second judgment. A true verdict is a success result carrying
      // metadata.aiJudgment; a false verdict is an honest §7.1 self-correcting error the planner
      // mediates (no internal retry). Requested-but-deferred M3/M4 knobs ride the judgment evidence.
      cacheBypass = true
      const av = action as { claim?: unknown; consensus?: unknown; video?: unknown; effort?: unknown }
      const claim = String(av.claim ?? '')
      const judgment = await withAbort(
        ports.verifier.judgeClaim(claim, screenState, { abortSignal: ports.abortSignal, screenshot: context.screenshot }),
        ports.abortSignal,
      )
      const rationale = redactSecretValue(judgment.rationale, ports.secretRedactor)
      const requested: { consensus?: number; video?: boolean; effort?: 'low' | 'medium' | 'high' } = {}
      if (typeof av.consensus === 'number') requested.consensus = av.consensus
      if (typeof av.video === 'boolean') requested.video = av.video
      if (av.effort === 'low' || av.effort === 'medium' || av.effort === 'high') requested.effort = av.effort
      recorder.recordAiJudgment({ verb: 'assertAI', verdict: judgment.verdict, rationale: maskValue(rationale), requested })
      if (judgment.verdict) {
        execResult = { success: true, metadata: { aiJudgment: { verb: 'assertAI', verdict: true } } }
        execError = undefined
      } else {
        const selfCorrecting = `Claim "${claim}" judged false: ${rationale} — re-observe the screen or declare the step failed via stepFailed.`
        execResult = { success: false, error: selfCorrecting, metadata: { aiJudgment: { verb: 'assertAI', verdict: false } } }
        execError = selfCorrecting
      }
    } else if (dispatchVerb === 'extractAI' && ports.verifier?.extractData) {
      // D-07: extract through the same judge lane; write extracted fields into run-scoped working
      // memory. scope 'global' degrades to the SAME run-scoped write with a degradedScope marker
      // (durable memory is M2's curator, no write port exists in M1) — never an error.
      cacheBypass = true
      const av = action as { query?: unknown; scope?: unknown }
      const query = String(av.query ?? '')
      const schema = (normalizedAction as { schema?: unknown }).schema
      const extracted = await withAbort(
        ports.verifier.extractData(query, screenState, { schema, abortSignal: ports.abortSignal, screenshot: context.screenshot }),
        ports.abortSignal,
      )
      const entries: WorkingMemoryEntry[] = Object.entries(extracted).map(([key, value]) => ({
        key,
        value: maskValue(redactSecretValue(String(value), ports.secretRedactor)),
        kind: 'extracted-value',
        provenance: 'toolResult',
        stepIndex: actionIndex,
      }))
      if (entries.length > 0) ports.workingMemory?.capture(entries, { step: actionIndex })
      const degradedScope = av.scope === 'global'
      recorder.recordAiJudgment({ verb: 'extractAI', ...(degradedScope ? { degradedScope: true } : {}) })
      execResult = { success: true, metadata: { aiJudgment: { verb: 'extractAI' }, extracted } }
      execError = undefined
    } else if (dispatchVerb === 'assertValue') {
      // D-10 "adapter reads, runner judges": dispatch the source read to the adapter ONCE (it
      // returns the raw source value in data, or a §7.1 source-unavailable error), then apply the
      // pure comparator and mint the outcome. A failing comparison is an honest §7.1 failure the
      // planner mediates — a passing outcome feeds the D-11 verifier short-circuit below.
      const read = await executeResolvedAction(normalizedAction)
      if (!read.result.success) {
        execResult = read.result
        execError = read.error
      } else {
        const av = action as { source?: unknown; expr?: unknown; op?: unknown; expected?: unknown }
        const source = typeof av.source === 'string' ? av.source : (av.expr !== undefined ? 'expr-result' : 'unknown')
        const rawActual = read.result.data
        // Object reads (storage map, network log array) stringify as JSON so `contains`
        // has something honest to match — String() would collapse them to [object Object].
        const actual = rawActual === null || rawActual === undefined
          ? (rawActual as null | undefined)
          : typeof rawActual === 'object' ? JSON.stringify(rawActual) : String(rawActual)
        const expected = typeof av.expected === 'string' ? av.expected : undefined
        const outcome = compareAssertValue({ source, op: av.op as AssertValueOp, expected, actual })
        recorder.recordAssertOutcome({
          source: outcome.source,
          op: outcome.op,
          passed: outcome.passed,
          ...(outcome.expected !== undefined ? { expected: outcome.expected } : {}),
          ...(outcome.actual !== undefined ? { actual: outcome.actual } : {}),
        })
        if (outcome.passed) {
          execResult = { success: true, metadata: { assertValueOutcome: outcome } }
          execError = undefined
        } else {
          const failMsg = `assertValue on source "${source}" (${outcome.op}) did not hold — re-observe or declare the step failed via stepFailed.`
          execResult = { success: false, error: failMsg, metadata: { assertValueOutcome: outcome } }
          execError = failMsg
        }
      }
    } else if (dispatchVerb === 'storageState') {
      // D-14 secret-template idiom (Pitfall 2): the RECORDED and EXECUTED objects DIFFER. save →
      // the adapter returns the raw blob; strip it from the recorded result and hand it to the
      // storageState port, recording only { name, fingerprint }. restore → load the blob from the
      // port and inject it into the EXECUTED action only; the recorded action carries just the name.
      const ss = action as { op?: unknown; name?: unknown }
      const op = ss.op
      const name = String(ss.name ?? '')
      if (op === 'save') {
        const read = await executeResolvedAction(normalizedAction)
        if (!read.result.success) {
          execResult = read.result
          execError = read.error
        } else if (!ports.storageState) {
          const unavailable = `storageState persistence unavailable: no storage-state store is bound to this run.`
          execResult = { success: false, error: unavailable }
          execError = unavailable
        } else {
          // Strip-before-record: the raw blob in read.result.data NEVER reaches evidence.
          const ref = await ports.storageState.save(name, read.result.data)
          execResult = { success: true, metadata: { storageState: { name: ref.name, fingerprint: ref.fingerprint } } }
          execError = undefined
        }
      } else {
        // restore
        if (!ports.storageState) {
          const unavailable = `storageState persistence unavailable: no storage-state store is bound to this run.`
          execResult = { success: false, error: unavailable }
          execError = unavailable
        } else {
          const blob = await ports.storageState.load(name)
          if (blob === undefined) {
            const missing = `storageState "${name}" not found under the run's .agent-qa/storage-states directory.`
            execResult = { success: false, error: missing }
            execError = missing
          } else {
            // Inject the blob into the EXECUTED action only; the recorded action carries just the name.
            const executed = { ...(normalizedAction as unknown as Record<string, unknown>), state: blob } as unknown as Action
            const read = await executeResolvedAction(executed)
            execResult = read.result.success
              ? { success: true, metadata: { storageState: { name } } }
              : { success: false, ...(read.result.error !== undefined ? { error: read.result.error } : {}) }
            execError = read.error
          }
        }
      }
    } else if (idempotentNoop !== undefined) {
      // D-14 pre-dispatch idempotency short-circuit at the ONE chokepoint before adapter.execute.
      // Judged ONLY on `screenState` — the SAME settled observation the gate grounded against
      // (Pitfall 10; no live probe). When the resolved control is already in the planner-declared
      // desiredState (or a picker already sits on the requested value, D-15), mint a success no-op
      // carrying metadata.idempotentNoop { currentState } (D-16) and SKIP adapter.execute entirely.
      // Positive-evidence only: an undefined/missing persisted state never suppresses (D-15). One
      // implementation serves web/android/ios — the field rides the action; adapters ignore it.
      execResult = { success: true, metadata: { idempotentNoop } }
    } else {
      const outcome = await executeResolvedAction(normalizedAction)
      execResult = outcome.result
      execError = outcome.error
    }

    const abortAfterExecute = checkAbort()
    if (abortAfterExecute) return abortAfterExecute

    // 3b. D-10 RE-GROUND-FIRST HEAL (LOOP-04, Pitfall 7). On a CONSERVATIVELY-classified
    // ref-resolution failure (or the replay gate's ref_not_in_snapshot), re-observe and
    // re-ground the failed action's descriptor on nameNormalized + hierarchy (the prior
    // ElementInfo as disambiguator), then re-execute the patched ref — NO planning turn.
    // Exactly ONE heal per planned action (a per-iteration one-shot boolean, never a counter
    // — LOOP-02), bounded by the loop's existing maxSubActions/stepTimeout. The heal trail is
    // recorded in the sub-action's grounding block only; StepEvidence.selfHeal stays reserved
    // for replan-based heals (D-11). On no-match/ambiguous it falls through to the replan path.
    if (execError !== undefined && (gateForcedRefMiss || isRefResolutionFailure(execError))) {
      let freshElements: readonly ElementInfo[] | undefined
      try {
        freshElements = (await withAbort(ports.adapter.observe({ extractDom: true }), ports.abortSignal)).elements
      } catch (err) {
        const abortDuringHeal = checkAbort()
        if (abortDuringHeal) return abortDuringHeal
        throw err
      }
      const heal = regroundFailedRef(action, screenState.elements, freshElements, ports.secretRedactor)
      if (heal !== null) {
        grounding = heal.grounding
        const patched = patchRef(normalizedAction, heal.field, heal.ref)
        const outcome = await executeResolvedAction(patched)
        execResult = outcome.result
        execError = outcome.error
        action = redactSecretValue(patched, ports.secretRedactor)
        lastPlannedAction = action
        const abortAfterHeal = checkAbort()
        if (abortAfterHeal) return abortAfterHeal
      }
    }

    // D-09 policy-denied terminal failure. A gate deny at ANY of the five dispatch paths ends the
    // step immediately, carrying the gate's audited D-16 reason (classification + remediation come
    // from the safety package; the loop adds no wording) into §A8 evidence — no replan turn, no
    // verifier call, no further planner call (policy is deterministic; retrying burns LLM calls to
    // reach the same deny). The redactSecretValue wrapper is applied where the loop already applies
    // it to errors; the deny reason is data-value-free by V7 discipline upstream.
    if (policyDenial) {
      recorder.recordSubAction({
        plan: reasoning,
        plannedAction: action as unknown as SchemaAction,
        stateBefore: screenState,
        result: toSchemaResult(execResult),
        cached,
        grounding,
        ...(liveDecisionEvidence ?? {}),
      })
      return failure(redactSecretValue(policyDenial.reason, ports.secretRedactor))
    }

    // CR-02: the replay cursor and successful-check fold advance only after dispatch (and any
    // conservative re-ground heal) has succeeded. A verifier rejection does not undo a real
    // adapter success; it merely hands the exhausted/in-progress sequence to the next loop turn.
    if (execError === undefined && pendingProcedureReplay !== undefined && procedureReplay) {
      procedureReplay.checksPassed++
      procedureReplay.nextIndex++
      recordProcedureReplaySource()
      pendingProcedureReplay = undefined
    }

    const viewport: Viewport = {
      width: (screenState.metadata.viewportWidth as number | undefined) ?? 0,
      height: (screenState.metadata.viewportHeight as number | undefined) ?? 0,
    }

    // setVariable + stepComplete short-circuits verification (Pitfall 8, loop.ts:399).
    if (action.type === 'setVariable' && rawPlan.stepComplete) {
      recorder.recordSubAction({
        plan: reasoning,
        plannedAction: action as unknown as SchemaAction,
        stateBefore: screenState,
        result: toSchemaResult(execResult),
        cached,
        grounding,
        ...(liveDecisionEvidence ?? {}),
      })
      context.failureContext = undefined
      pendingSelfHeal = undefined
      // setVariable is inherently non-cacheable — no cache write here (Pitfall 6).
      return success()
    }

    // D-19 (Phase 360): the legacy non-visual-`assert` short-circuit was deleted here. The
    // retired `assert` verb is gone; its deterministic-verdict replacement is D-11's
    // assertValue/assertAI outcome short-circuit (Plan 10), already pinned by the Wave-0 suites.

    const annotation = buildAnnotation(action, execResult, viewport, !!execError)

    // Best-effort "after" screenshot for artifacts.
    if (ports.adapter.screenshot) {
      try { await withAbort(ports.adapter.screenshot(), ports.abortSignal) } catch { /* best-effort */ }
    }
    const abortAfterPostShot = checkAbort()
    if (abortAfterPostShot) return abortAfterPostShot

    // 4. EXECUTION FAILURE → self-heal = replan-with-failure-context (D-12). No counter
    // (D-10). The failed sub-action's stateAfter lands on the next observation (D-15c).
    if (execError) {
      if (pendingProcedureReplay !== undefined && procedureReplay) {
        procedureReplay.aborted = true
        procedureReplay.executionFailure = {
          procedureStepIndex: pendingProcedureReplay.procedureStepIndex,
        }
        recordProcedureReplaySource()
        procedureHintStaged = {
          procedureId: procedureReplay.match.id,
          anchors: [procedureReplay.match.flowAnchor],
          block: renderProcedureHintBlock(
            procedureReplay.match,
            procedureReplay.payload,
            `Guarded replay execution failed at procedure step `
              + `${pendingProcedureReplay.procedureStepIndex + 1} `
              + `("${pendingProcedureReplay.instruction}"): ${execError}`,
            maskValue,
          ),
        }
      }
      const failedIdx = recorder.recordSubAction({
        plan: reasoning,
        plannedAction: action as unknown as SchemaAction,
        stateBefore: screenState,
        result: toSchemaResult(execResult, annotation),
        cached,
        grounding,
        ...(liveDecisionEvidence ?? {}),
      })

      context.subActionHistory!.push({
        action: JSON.stringify(action),
        reasoning,
        result: 'failure',
        error: execError,
        data: guardActionData(execResult.data, ports.guardBlob),
      })

      // A failed replay of a cached plan invalidates that key and re-plans (D-13).
      if (cached && cacheKey && ports.cache) {
        await ports.cache.invalidate(cacheKey)
      }

      // Failure context injected for the next planning turn (the surviving mitigation).
      context.failureContext = `Sub-action ${actionIndex + 1} failed: ${execError}\n` +
        `Failed action: ${JSON.stringify(action)}\n` +
        `Adapt your approach — try a different element or strategy.`

      pendingSelfHeal = {
        index: failedIdx,
        failed: { plan: reasoning, plannedAction: action as unknown as SchemaAction, result: toRecordedActionResult(toSchemaResult(execResult, annotation)) },
      }
      // D-13: a grounding miss is a failed action in substance. It reaches this same branch after
      // the conservative re-ground-first heal has exhausted, so all execution-failure shapes stage
      // exactly one caution lookup for the next replan turn.
      stageFailureCautions(action, screenState)
      continue
    }

    // Execution succeeded — clear failure context.
    context.failureContext = undefined

    // 5. VERIFY — only when the planner signals stepComplete (three-outcome strategy).
    let verifierReasoning: string | undefined
    if (rawPlan.stepComplete && ports.verifier) {
      // D-11 deterministic short-circuit BEFORE any verifier model call. A step concluded by an
      // assertValue outcome takes a deterministic verdict from the comparator (zero model call,
      // verdictSource 'assert-value'); a step concluded by an assertAI judgment adopts the judge
      // verdict (no second judgment, verdictSource 'assert-ai'). Every other step falls through to
      // the verifier's own model call (verdictSource 'verifier-model'). The source is recorded so
      // adopted verdicts are auditable (T-360-09). A FAILING assertValue never reaches here — it
      // set execError above and routed into the execution-failure branch.
      const assertOutcome = readAssertValueOutcomeMeta(execResult)
      const aiJudgment = readAiJudgmentMeta(execResult)
      if (assertOutcome || aiJudgment) {
        const verdictSource: VerdictSource = assertOutcome ? 'assert-value' : 'assert-ai'
        const pass = assertOutcome ? assertOutcome.passed : (aiJudgment?.verdict ?? true)
        recorder.recordVerdictSource(verdictSource)
        const idx = recordSuccess(
          recorder,
          reasoning,
          action,
          screenState,
          execResult,
          annotation,
          cached,
          grounding,
          liveDecisionEvidence,
        )
        void idx
        maybeRecordSelfHeal(recorder, pendingSelfHeal, reasoning, action, execResult, annotation)
        pendingSelfHeal = undefined
        await cacheCompletingPlan()
        return pass
          ? finish('passed', { pass: true, reasoning: 'Step verified deterministically from the assertion outcome' })
          : finish('failed', { pass: false, reasoning: 'The assertion outcome did not hold' }, 'Assertion did not hold')
      }
      // No assertion outcome — the verifier's own model call produces the verdict.
      recorder.recordVerdictSource('verifier-model')
      // D-15b: the verifier's own re-observation IS stateAfter. (The retired-`assert`
      // afterState reuse special-case was deleted with the verb — D-19, Phase 360.)
      let afterState: ScreenState
      try {
        afterState = await withAbort(ports.adapter.observe(), ports.abortSignal)
      } catch (err) {
        const abortResult = checkAbort()
        if (abortResult) return abortResult
        throw err
      }
      let verifyScreenshot: Buffer | undefined
      if (ports.adapter.screenshot) {
        try { verifyScreenshot = await withAbort(ports.adapter.screenshot(), ports.abortSignal) } catch { /* best-effort */ }
      }

      const abortBeforeVerify = checkAbort()
      if (abortBeforeVerify) return abortBeforeVerify

      let verifyResult
      try {
        verifyResult = await withAbort(
          ports.verifier.verify(
            stepInstruction, screenState, afterState, action,
            gate.attachImage ? verifyScreenshot : undefined,
            ports.abortSignal, gate.promptNote, activePredicate,
          ),
          ports.abortSignal,
        )
      } catch (verifyError: unknown) {
        const abortDuringVerify = checkAbort()
        if (abortDuringVerify) return abortDuringVerify
        throw verifyError
      }
      if (verifyResult.tokenUsage) {
        totalPromptTokens += verifyResult.tokenUsage.promptTokens
        totalCompletionTokens += verifyResult.tokenUsage.completionTokens
      }
      verifierReasoning = verifyResult.verification.reasoning

      const abortAfterVerify = checkAbort()
      if (abortAfterVerify) return abortAfterVerify

      if (verifyResult.verification.success) {
        const idx = recordSuccess(
          recorder,
          reasoning,
          action,
          screenState,
          execResult,
          annotation,
          cached,
          grounding,
          liveDecisionEvidence,
        )
        recorder.attachStateAfter(idx, afterState)
        maybeRecordSelfHeal(recorder, pendingSelfHeal, reasoning, action, execResult, annotation)
        pendingSelfHeal = undefined
        await cacheCompletingPlan()
        return finish('passed', { pass: true, reasoning: verifierReasoning ?? 'Step completed' })
      }

      if (verifyResult.verification.isAppError) {
        recorder.recordSubAction({
          plan: reasoning,
          plannedAction: action as unknown as SchemaAction,
          stateBefore: screenState,
          result: toSchemaResult(execResult, annotation),
          cached,
          grounding,
          ...(liveDecisionEvidence ?? {}),
        })
        return failure(`Application error: ${verifyResult.verification.reasoning}`)
      }

      // Verifier says not done — planner was wrong about stepComplete. Treat as a
      // self-heal boundary: replan with the verifier's reasoning as failure context
      // (D-12), and let the next observation land as this sub-action's stateAfter (D-15c).
      const failedIdx = recordSuccess(
        recorder,
        reasoning,
        action,
        screenState,
        execResult,
        annotation,
        cached,
        grounding,
        liveDecisionEvidence,
      )
      recorder.attachStateAfter(failedIdx, afterState)
      context.subActionHistory!.push({
        action: JSON.stringify(action),
        reasoning,
        result: 'success',
        verifierRejection: verifierReasoning,
        data: guardActionData(execResult.data, ports.guardBlob),
      })
      context.failureContext = `Sub-action ${actionIndex + 1} did not accomplish the goal: ${verifierReasoning}\n` +
        `Adapt your approach — try a different element or strategy.`
      pendingSelfHeal = {
        index: failedIdx,
        failed: { plan: reasoning, plannedAction: action as unknown as SchemaAction, result: toRecordedActionResult(toSchemaResult(execResult, annotation)) },
      }
      stageFailureCautions(action, afterState)
      // Non-completing decision — not cached (only the step-completing plan is persisted).
      continue
    }

    // No verifier but the planner claims completion — trust the planner.
    if (rawPlan.stepComplete && !ports.verifier) {
      const idx = recordSuccess(
        recorder,
        reasoning,
        action,
        screenState,
        execResult,
        annotation,
        cached,
        grounding,
        liveDecisionEvidence,
      )
      maybeRecordSelfHeal(recorder, pendingSelfHeal, reasoning, action, execResult, annotation)
      pendingSelfHeal = undefined
      void idx
      await cacheCompletingPlan()
      return success()
    }

    // Sub-action succeeded but the goal is not yet met — record and continue (no
    // stateAfter: this is not a D-15 boundary).
    const continuingIdx = recordSuccess(
      recorder,
      reasoning,
      action,
      screenState,
      execResult,
      annotation,
      cached,
      grounding,
      liveDecisionEvidence,
    )
    maybeRecordSelfHeal(recorder, pendingSelfHeal, reasoning, action, execResult, annotation)
    pendingSelfHeal = undefined
    context.subActionHistory!.push({
      action: JSON.stringify(action),
      reasoning,
      result: 'success',
      verifierRejection: rawPlan.stepComplete ? verifierReasoning : undefined,
      data: guardActionData(execResult.data, ports.guardBlob),
    })
    // CYCLE-01 prev-iteration carry (Pitfall 1): the successfully-executed action (post-heal)
    // plus its stateBefore/hash/anchor is checked by the effect oracle at the NEXT settled top
    // (D-05). Its already-recorded sub-action index lets the localEffect block land by
    // construction. Execution failures never reach here — they route to the failure-context
    // flow above and set no carry (no oracle, no double-count).
    // Pitfall 5: a screen-neutral mint/assertion already got its eager effect-achieved verdict in
    // recordSuccess; it must NOT set a progressCarry (the oracle would overwrite that verdict with
    // a false hash-fallback no-progress next iteration, feeding the stagnation ladder/revisitation
    // window). Gesturing verbs carry as before.
    if (!carriesMintOrAssertionMeta(execResult)) {
      const carryAnchor = deriveEffectAnchor(action, screenState.elements)
      progressCarry = {
        action,
        anchor: carryAnchor,
        anchorKey: carryAnchor ? buildAnchorKey(carryAnchor) : undefined,
        stateBefore: screenState,
        prevHash: settledHash,
        actionResult: execResult,
        evidenceIndex: continuingIdx,
      }
    }
    // Non-completing decision — not cached (only the step-completing plan is persisted).
  }
}

// ---- helpers -----------------------------------------------------------------

// Env-set provenance (D-07, set path). Pre-plan, the live resolver isn't available (its
// onSetVariable callback fires only at execute time), so an explicit set/store/save verb
// paired with an env-shaped token (UPPER_SNAKE identifier) is the provenance signal. The
// read path (secret templates / [secret:*] marker) is classified inside classifyStep.
// Phase 362 replaces this with the live resolver-reported provenance.
const ENV_SET_VERB = /\b(set|store|save|remember)\b/i
const ENV_NAME_TOKEN = /\b[A-Z][A-Z0-9_]+\b/g

function deriveEnvSetNames(stepText: string): string[] {
  if (!ENV_SET_VERB.test(stepText)) return []
  return stepText.match(ENV_NAME_TOKEN) ?? []
}

// Replayability is judged by the ONE schema-shared list (`isReplayableActionShape` —
// NON_REPLAYABLE_ACTION_TYPES + COORDINATE_ACTION_KEYS). The former loop-local
// COORDINATE_KEYS/COORDINATE_ACTION_TYPES copies were retired for the shared import
// (381 Pitfall 6: cache write guard, extraction disposition, and procedure replay must
// never fork the list). Behavior-compatible on the cache path: the extra non-replayable
// types (setVariable/assertAI/extractAI) are never persisted by cacheCompletingPlan.

// The ordered ref-field lanes replay must re-resolve for an action (Pitfall 5a): a drag
// maps its two per-field locators onto fromRef/toRef; every other element action maps its
// single locator onto ref. A locator-less action (navigate/waitFor/…) has no lane.
function replayLanes(action: Record<string, unknown>, locatorCount: number): string[] {
  if (action.type === 'drag') return ['fromRef', 'toRef']
  return locatorCount >= 1 ? ['ref'] : []
}

// Replay rung of the hit ladder (D-13): reconstruct an ActionPlan from a descriptor-only
// cached value by re-grounding EVERY stored per-field locator against the FRESH
// observation (Pitfall 5 — multi-ref drags re-resolve both fromRef and toRef). Returns
// null — the invalidate-and-replan signal — when the action is non-replayable (carries raw
// coordinates or lacks a locator for a ref lane) or any descriptor no longer resolves
// uniquely (a stale/ambiguous descriptor never drives a blind action, T-356-04a / T-357-03a).
function replayFromCache(value: CachedPlanValue, elements: readonly ElementInfo[]): ActionPlan | null {
  const action = value.plannedActions[0]
  if (!action) return null
  const replayAction: Record<string, unknown> = { ...action }

  // Non-replayable action shapes (coordinate-bearing / excluded types, the schema-shared
  // list) ⇒ invalidate ⇒ replan (Pitfall 5b).
  if (!isReplayableActionShape(String(replayAction.type ?? ''), Object.keys(replayAction))) return null

  const lanes = replayLanes(replayAction, value.groundedLocator.length)
  // A ref lane with no stored locator is an unreplayable value ⇒ invalidate ⇒ replan.
  if (value.groundedLocator.length < lanes.length) return null

  for (let lane = 0; lane < lanes.length; lane++) {
    const freshRef = deterministicDescriptorMatcher.reground(value.groundedLocator[lane], elements)
    if (freshRef === null) return null
    replayAction[lanes[lane]] = freshRef
  }

  return {
    reasoning: 'Replayed from cache',
    action: replayAction as ActionPlan['action'],
    confidence: 1,
    stepComplete: value.verificationOutcome === 'passed',
  }
}

// ---- PROC-02 guarded procedure replay helpers (381 D-09..D-12) -----------------

/** The closed guard-miss reason vocabulary — the schema StepPlanSource miss union. */
type ProcedureGuardMissReason = NonNullable<
  Extract<StepPlanSource, { kind: 'procedure-replay' }>['guard']['miss']
>['reason']

type ProcedureReplayAttempt =
  | { ok: true; plan: ActionPlan }
  | { ok: false; reason: ProcedureGuardMissReason; detail: string }

/**
 * The D-10 full guard for ONE committed procedure action, in order: (0) defense-in-depth
 * replayability shape check against the schema-shared list (Pitfall 6); (1) unique
 * fresh-screen re-ground of EVERY stored target descriptor through the deterministic
 * matcher ladder — ambiguous and no-match are distinct miss reasons, never a pick
 * (T-357-03a); (2) live-vs-stored page anchor equality through `normalizeAnchor` (D-10);
 * (3) loop-side value binding by NAME (values never crossed the reader port, T-381-21);
 * (4) the grounding gate exactly as the cached branch runs it, yielding the §A8 attempt
 * trail on the returned plan (`groundingAttempts`). A stored descriptor never drives a
 * blind action: every leg must pass before the action may execute.
 */
function attemptProcedureReplayAction(input: {
  step: ProcedureStepSpec
  isFinal: boolean
  screenState: ScreenState
  bind: (name: string) => string | number | boolean | undefined
}): ProcedureReplayAttempt {
  const spec = input.step.action
  const shapeKeys = [...Object.keys(spec.targets), ...Object.keys(spec.values)]
  if (!isReplayableActionShape(spec.type, shapeKeys)) {
    return {
      ok: false,
      reason: 'non-replayable-action',
      detail: `stored action type "${spec.type}" (or a raw-coordinate key) is not replayable`,
    }
  }

  const action: Record<string, unknown> = { type: spec.type }
  for (const [lane, target] of Object.entries(spec.targets)) {
    const match = matchDescriptor({
      descriptor: {
        role: target.role,
        nameNormalized: target.nameNormalized,
        ordinal: target.ordinal,
      },
      elements: input.screenState.elements,
    })
    if (match.kind === 'ambiguous') {
      return {
        ok: false,
        reason: 'descriptor-ambiguous',
        detail: `the stored "${lane}" descriptor (${target.role} "${target.nameNormalized}") `
          + `resolved ambiguously on the fresh screen (${match.candidates.length} candidates)`,
      }
    }
    if (match.kind !== 'resolved') {
      return {
        ok: false,
        reason: 'descriptor-missing',
        detail: `the stored "${lane}" descriptor (${target.role} "${target.nameNormalized}") `
          + 'did not resolve on the fresh screen',
      }
    }
    action[lane] = match.ref
  }

  const stored = normalizeAnchor(input.step.guard.pageAnchor) as Extract<Anchor, { t: 'page' }>
  const live = normalizeAnchor({ t: 'page', route: input.screenState.url ?? '' }) as Extract<
    Anchor,
    { t: 'page' }
  >
  if (stored.route !== live.route) {
    return {
      ok: false,
      reason: 'page-anchor-mismatch',
      detail: `the live page anchor "${live.route}" does not equal the stored "${stored.route}"`,
    }
  }

  for (const [field, slot] of Object.entries(spec.values)) {
    if (typeof slot === 'string' || typeof slot === 'number' || typeof slot === 'boolean') {
      action[field] = slot
      continue
    }
    if ('json' in slot) {
      // Persisted bodies are untrusted input. Preserve the structured literal exactly without
      // aliasing record-owned arrays/objects into the action that the adapter may mutate.
      action[field] = structuredClone(slot.json)
      continue
    }
    const bound = input.bind(slot.param)
    if (bound === undefined) {
      return {
        ok: false,
        reason: 'parameter-unbound',
        detail: `parameter "${slot.param}" has no loop-side binding source`,
      }
    }
    action[field] = bound
  }

  // Stored bodies are untrusted persisted input. Reconstruct the canonical tool action exactly
  // as toolCallToActionPlan does: remove the type discriminator, safeParse through the registered
  // strict schema, and use parsed data (including canonical defaults) for the grounding gate.
  // Procedure bodies persist the action verb (`fill`), while the model registry is keyed by
  // surface-qualified tool id (`web_fill`). Accept an exact id for forward compatibility, then
  // resolve the one definition exposed for the live platform by its canonical action type.
  const definition = defaultRegistry.get(spec.type)
    ?? defaultRegistry.getForPlatform(input.screenState.platform)
      .find((candidate) => candidate.type === spec.type)
  if (definition === undefined) {
    return {
      ok: false,
      reason: 'non-replayable-action',
      detail: `stored action type "${spec.type}" has no canonical registry definition`,
    }
  }
  const { type: _type, ...actionFields } = action
  const parsed = definition.schema.safeParse(actionFields)
  if (!parsed.success) {
    const issueSummary = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('; ')
    return {
      ok: false,
      reason: 'non-replayable-action',
      detail: `stored action failed canonical action-schema validation: ${issueSummary}`,
    }
  }
  const validatedAction: Record<string, unknown> = {
    type: definition.type,
    ...(parsed.data as Record<string, unknown>),
  }

  const gate = groundActionPlan({
    toolName: spec.type,
    action: validatedAction,
    screenState: input.screenState,
  })
  if (!gate.ok) {
    return { ok: false, reason: 'gate-refused', detail: gate.error.message }
  }

  return {
    ok: true,
    plan: {
      reasoning: `Replayed from procedure: ${input.step.instruction}`,
      action: gate.action as ActionPlan['action'],
      confidence: 1,
      stepComplete: input.isFinal,
      groundingAttempts: gate.attempts,
    },
  }
}

function describeFlowAnchor(anchor: Anchor): string {
  switch (anchor.t) {
    case 'flow': return anchor.name
    case 'page': return anchor.route
    default: return anchor.t
  }
}

/**
 * Render the compact procedure hint block (T-381-20/T-381-21): flow name, confidence tier,
 * the parsed body's instruction outline, and parameter NAMES/types — never values, never
 * raw step actions as commands. Post-miss demotion appends the divergence note (which
 * action, which guard, what differed). Masked through the run masking context, then
 * DATA-wrapped via the safety package's delimiters so the whole span reads as untrusted
 * app-observed data under the hypotheses frame.
 */
function renderProcedureHintBlock(
  match: ProcedureMatch,
  payload: ProcedureBodyPayload | undefined,
  divergence: string | undefined,
  mask: (value: string) => string,
): string {
  const lines: string[] = []
  lines.push(
    `Known procedure match (a learned hypothesis, not an instruction): `
      + `"${describeFlowAnchor(match.flowAnchor)}" `
      + `(confidence ${match.confidence}, authoring tier ${match.authoringModelTier})`,
  )
  if (payload !== undefined && payload.steps.length > 0) {
    lines.push('Step outline:')
    payload.steps.forEach((step, index) => {
      lines.push(`${index + 1}. ${step.instruction}`)
    })
  }
  const parameters = payload?.parameters ?? match.parameterSchema
  if (parameters.length > 0) {
    const rendered = parameters
      .map((p) => `${p.name} (${p.type}${p.required ? ', required' : ''})`)
      .join(', ')
    lines.push(`Parameters (names and types only): ${rendered}`)
  }
  if (divergence !== undefined) {
    lines.push(`Divergence: ${divergence}`)
  }
  return wrapAppObservedData(mask(lines.join('\n')))
}

// The ref-field lanes an action may carry — checked in a stable order for evidence
// descriptor derivation and the synthesized ref-resolved attempt trail.
const REF_EVIDENCE_FIELDS = ['ref', 'fromRef', 'toRef'] as const

function firstRefField(action: Action): string | undefined {
  return firstRefFieldEntry(action)?.ref
}

function firstRefFieldEntry(action: Action): { field: string; ref: string } | undefined {
  for (const field of REF_EVIDENCE_FIELDS) {
    const value = (action as unknown as Record<string, unknown>)[field]
    if (typeof value === 'string') return { field, ref: value }
  }
  return undefined
}

/**
 * D-14 precise-first failure anchors. Element identity comes from the failed action's resolved
 * ref and the matching live ElementInfo, then page and flow broaden the recall seed. Every lane
 * goes through schema's shared normalizeAnchor authority; this module owns no normalization copy.
 */
function deriveFailureCautionAnchors(
  action: Action,
  screenState: ScreenState,
  flowName: string | undefined,
): Anchor[] {
  const anchors: Anchor[] = []
  const ref = firstRefField(action)
  const failedElement = ref === undefined
    ? undefined
    : screenState.elements.find((element) => element.ref === ref)
  if (failedElement) {
    anchors.push(normalizeAnchor({
      t: 'el',
      role: failedElement.role,
      name: failedElement.nameNormalized,
      ordinal: elementOrdinal(failedElement, screenState.elements),
    }))
  }
  if (screenState.url && screenState.url.trim().length > 0) {
    anchors.push(normalizeAnchor({ t: 'page', route: screenState.url }))
  }
  if (flowName && flowName.trim().length > 0) {
    anchors.push(normalizeAnchor({ t: 'flow', name: flowName }))
  }
  return anchors
}

function patchRef(action: Action, field: string, ref: Ref): Action {
  return { ...(action as unknown as Record<string, unknown>), [field]: ref } as unknown as Action
}

// A ref-resolved §A8 attempt trail synthesized when the planner/turn supplied none — one
// 'ref' entry per committed ref field (drag ⇒ fromRef + toRef). The committed refs were
// validated against the fresh snapshot (gate/replay), so 'resolved' is the honest outcome.
function synthesizeRefAttempts(action: Action): GroundingAttempt[] {
  const trail: GroundingAttempt[] = []
  for (const field of REF_EVIDENCE_FIELDS) {
    const value = (action as unknown as Record<string, unknown>)[field]
    if (typeof value === 'string') trail.push({ stage: 'ref', outcome: 'resolved', resolvedRef: value as Ref })
  }
  return trail
}

// Build the §A8 grounding block for a grounded sub-action (GROUND-02, Pitfall 9). Present
// ONLY when the action carries an element field; the descriptor is redacted BEFORE it lands
// in evidence (T-357-02a redact-before-record). Attempts come from the turn gate / heal when
// supplied, else a synthesized ref-resolved trail for the committed ref(s).
function buildGroundingEvidence(
  action: Action,
  elements: readonly ElementInfo[],
  attempts: GroundingAttempt[] | undefined,
  redactor: SecretRedactorPort | undefined,
): GroundingEvidence | undefined {
  const ref = firstRefField(action)
  if (ref === undefined) return undefined
  const locator = toGroundedLocator({ ...(action as unknown as Record<string, unknown>), ref } as unknown as Action, elements)
  if (locator === null) return undefined
  const descriptor: TargetDescriptor = {}
  if (locator.role) descriptor.role = locator.role
  descriptor.name = redactSecretValue(locator.nameNormalized, redactor)
  if (locator.ordinal !== undefined) descriptor.ordinal = locator.ordinal
  const trail = attempts !== undefined && attempts.length > 0 ? attempts : synthesizeRefAttempts(action)
  return { descriptor, attempts: trail }
}

// The tap-class verbs whose stagnating anchor arms the D-04 longpress-for-tap ban.
const TAP_CLASS_VERBS: ReadonlySet<string> = new Set(['tap', 'click', 'longpress'])

// Derive the CYCLE-01/02 element anchor (357 vocabulary: role + nameNormalized + ordinal,
// never ref) for the effect oracle + stagnation tree. Reuses the grounded-locator derivation
// the evidence path already uses. A locator-less action (navigate/waitFor/coordinates) yields
// undefined — it skips the tree entirely and feeds only the revisitation window (Open Q5).
function deriveEffectAnchor(action: Action, elements: readonly ElementInfo[]): EffectAnchor | undefined {
  const ref = firstRefField(action)
  if (ref === undefined) return undefined
  const locator = toGroundedLocator({ ...(action as unknown as Record<string, unknown>), ref } as unknown as Action, elements)
  if (locator === null) return undefined
  return { role: locator.role, nameNormalized: locator.nameNormalized, ordinal: locator.ordinal ?? 0 }
}

// Project the terminal anchor's bounded-tree state into the §A8 StagnationEvidence DTO
// (D-07, event-scoped at the terminal fail). The snapshot's per-class map becomes the DTO's
// counts array; the recording type IS the schema DTO (353 D-14).
function toStagnationEvidence(anchorKey: string, tree: StagnationTree): StagnationEvidence {
  const entry = tree.snapshot().find((e) => e.anchorKey === anchorKey)
  const counts: StagnationEvidence['counts'] = entry
    ? Object.entries(entry.perClass).map(([cls, count]) => ({ class: cls as StagnationEvidence['counts'][number]['class'], count }))
    : []
  return { anchorKey, counts, total: entry?.total ?? 0 }
}

// D-10 re-ground heal (LOOP-04). Re-derive the failed action's descriptor from the PRIOR
// observation's ElementInfo, then re-match it against the FRESH observation (with the prior
// element as a hierarchy disambiguator). On a unique resolve, returns the fresh ref plus the
// §A8 attempt trail (ref no-match → tree-search resolved); on no-match/ambiguous returns null
// so the caller falls through to the replan-with-failure-context path. Never replans.
function regroundFailedRef(
  action: Action,
  priorElements: readonly ElementInfo[],
  freshElements: readonly ElementInfo[],
  redactor: SecretRedactorPort | undefined,
): { field: string; ref: Ref; grounding: GroundingEvidence } | null {
  const entry = firstRefFieldEntry(action)
  if (entry === undefined) return null
  const priorTarget = priorElements.find((element) => element.ref === entry.ref)
  if (priorTarget === undefined) return null
  const locator: GroundedLocator | null = toGroundedLocator(
    { ...(action as unknown as Record<string, unknown>), ref: entry.ref } as unknown as Action,
    priorElements,
  )
  if (locator === null) return null

  const match = matchDescriptor({
    descriptor: { role: locator.role, nameNormalized: locator.nameNormalized, ordinal: locator.ordinal },
    elements: freshElements,
    prior: { target: priorTarget, elements: priorElements },
  })
  if (match.kind !== 'resolved') return null

  const descriptor: TargetDescriptor = { role: locator.role, name: redactSecretValue(locator.nameNormalized, redactor) }
  if (locator.ordinal !== undefined) descriptor.ordinal = locator.ordinal
  const grounding: GroundingEvidence = {
    descriptor,
    attempts: [
      { stage: 'ref', outcome: 'no-match' },
      { stage: 'tree-search', outcome: 'resolved', resolvedRef: match.ref },
    ],
  }
  return { field: entry.field, ref: match.ref, grounding }
}

function toSchemaResult(execResult: ActionResult, annotation?: ActionAnnotation): SchemaActionResult {
  const result: SchemaActionResult = { success: execResult.success }
  if (execResult.error !== undefined) result.error = execResult.error
  if (execResult.data !== undefined) result.data = execResult.data
  if (execResult.metadata !== undefined) result.metadata = execResult.metadata
  if (annotation) result.annotation = annotation
  return result
}

const ANNOTATABLE = new Set([
  'click', 'fill', 'tap', 'hover', 'scroll', 'swipe', 'pinch', 'navigate', 'drag',
])

function buildAnnotation(action: Action, execResult: ActionResult, viewport: Viewport, failed: boolean): ActionAnnotation | undefined {
  if (!ANNOTATABLE.has(action.type)) return undefined
  const annotation = collapseAnnotation(action, execResult, viewport)
  if (failed && execResult.boundingBox) {
    return { ...annotation, failureHighlight: execResult.boundingBox }
  }
  return annotation
}

function recordSuccess(
  recorder: EvidenceRecorder,
  reasoning: string,
  action: Action,
  stateBefore: ScreenState,
  execResult: ActionResult,
  annotation: ActionAnnotation | undefined,
  cached: boolean,
  grounding: GroundingEvidence | undefined,
  liveDecisionEvidence: LiveDecisionEvidence | undefined,
): number {
  const index = recorder.recordSubAction({
    plan: reasoning,
    plannedAction: action as unknown as SchemaAction,
    stateBefore,
    result: toSchemaResult(execResult, annotation),
    cached,
    grounding,
    ...(liveDecisionEvidence ?? {}),
  })
  // D-16: a pre-dispatch idempotent no-op (D-14) never reaches the deferred effect oracle when it
  // is the step's completing sub-action — the step returns here. Its effect-achieved verdict is
  // therefore attached eagerly: nothing was gestured (stateAfter === stateBefore), and the tap
  // oracle row reads metadata.idempotentNoop as authoritative effect-achieved, so the no-op costs
  // zero stagnation and burns no planner turn. Absent the flag this is a no-op (unflagged actions
  // still land their verdict one iteration late via the normal progressCarry path).
  if (readIdempotentNoopMeta(execResult)) {
    const localEffect = evaluateLocalEffect({
      action: action as { type: string; [key: string]: unknown },
      anchor: deriveEffectAnchor(action, stateBefore.elements),
      stateBefore,
      stateAfter: stateBefore,
      prevHash: '',
      currentHash: '',
      actionResult: execResult,
    })
    recorder.attachLocalEffect(index, toLocalEffectEvidence(localEffect))
  } else if (carriesMintOrAssertionMeta(execResult)) {
    // Pitfall 5: a screen-neutral mint/assertion (reportValue/uniqueValue/assertAI/extractAI/
    // assertValue) gestures nothing on the screen, so the differential oracle's hash-fallback
    // row would read it as no-progress and feed the 358 stagnation ladder as a false stall. It
    // is effect-achieved BY CONSTRUCTION — attach the verdict eagerly (the idempotentNoop
    // precedent) so it never accrues stagnation, and skip the progressCarry entirely below.
    recorder.attachLocalEffect(index, toLocalEffectEvidence({ verbClass: action.type, oracle: 'hash-fallback', achieved: true }))
  }
  return index
}

// A screen-neutral mint/assertion result carries one of the Phase-360 dispatch metadata blocks
// (Pitfall 5). Such an action never gestured the screen, so it must NOT feed the 358 progress
// oracle / revisitation window — its effect is achieved by construction.
function carriesMintOrAssertionMeta(execResult: ActionResult): boolean {
  return (
    readReportedValueMeta(execResult) !== undefined ||
    readUniqueValueMeta(execResult) !== undefined ||
    readAiJudgmentMeta(execResult) !== undefined ||
    readAssertValueOutcomeMeta(execResult) !== undefined
  )
}

function maybeRecordSelfHeal(
  recorder: EvidenceRecorder,
  pending: { index: number; failed: Decision } | undefined,
  reasoning: string,
  action: Action,
  execResult: ActionResult,
  annotation: ActionAnnotation | undefined,
): void {
  if (!pending) return
  const recovering: Decision = {
    plan: reasoning,
    plannedAction: action as unknown as SchemaAction,
    result: toRecordedActionResult(toSchemaResult(execResult, annotation)),
  }
  recorder.recordSelfHeal(pending.failed, recovering)
}

function buildStepTrace(
  subActions: SubActionTrace[],
  result: 'success' | 'failure',
  error: string | undefined,
  usage: TokenUsage | undefined,
): StepTrace {
  const last = subActions.length > 0 ? subActions[subActions.length - 1] : undefined
  const first = subActions.length > 0 ? subActions[0] : undefined
  const trace: StepTrace = {
    observation: last?.observation ?? '',
    reasoning: last?.reasoning ?? error ?? '',
    plannedAction: last?.plannedAction ?? { type: 'waitFor', on: 'text', text: '', timeoutMs: 0 },
    result,
    screenStateBefore: first?.screenStateBefore ?? '',
    subActions,
  }
  if (error) trace.error = error
  if (last?.screenStateAfter !== undefined) trace.screenStateAfter = last.screenStateAfter
  if (last?.confidence !== undefined) trace.confidence = last.confidence
  if (usage) trace.tokenUsage = usage
  return trace
}
