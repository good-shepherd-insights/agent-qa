// The runner-owned step-execution loop — the v2 `executeStep` successor (D-01/D-02).
// CRITICAL: provider-neutral + storage-neutral. No node:* imports, no fs/sharp, no
// core/model/adapter package imports (Pitfall 1). This IS the live loop: observe →
// cached-or-planned plan → safety-gated execute → record §A8 evidence → conditional
// verify, with self-heal = replan-with-failure-context (D-12), bounded ONLY by the
// maxSubActions resource cap, the user timeouts/abort, and the verdict (D-10/D-11).
// There is NO consecutive-failure / attempt counter anywhere in this loop — LOOP-02's
// deletion target (Pitfall 5: do not sneak one back in under any name).
//
// Modality neutrality (352): adapters stay model-free. Vision-gate branching lives
// here — the loop compresses via the injected ScreenshotCompressor port (sharp stays
// core-side, Pitfall 9) and applies stampCaptureMode itself (runner-owned since 352).
//
// §A8 evidence is populated by construction (D-14): the EvidenceRecorder's recording
// types ARE the schema DTOs. stateBefore is always the FULL ScreenState the sub-action
// was planned against; stateAfter is attached only at the three D-15 boundaries by
// reuse of an observation the loop already takes — never an extra capture.

import { toRecordedActionResult } from '@vostride/agent-qa-schema'
import type {
  Action as SchemaAction,
  ActionAnnotation,
  ActionResult as SchemaActionResult,
  Decision,
  ScreenState,
  VerifierVerdict,
  Viewport,
} from '@vostride/agent-qa-schema'
import type { Action, ActionResult } from '../platform.js'
import type { StepAnnotation, StepResult, StepTrace, SubActionTrace, TokenUsage } from '../result.js'
import { stampCaptureMode } from '../screen-builder.js'
import { normalizePointerActionForStep } from '../tools/pointer-action-normalization.js'
import type { LoopPorts, StepKeyInput } from './ports.js'
import type { ActionPlan, PlanResult, StepContext } from './types.js'
import { withAbort, getTimeoutAbortReason } from './abort.js'
import {
  containsRedactedSecretMarker,
  findSecretTemplates,
  redactSecretValue,
  resolveSecretTemplatesInValue,
} from './secrets.js'
import { EvidenceRecorder, collapseAnnotation, projectLegacyTrace } from './evidence.js'

// v1's context-window overflow classification (loop.ts:277-286) — kept byte-equivalent
// (D-04, Pitfall 10): a planning error matching one of these is surfaced with the
// contextWindow/previousStepCount remediation hint rather than the raw error.
const CONTEXT_ERROR_PATTERNS = [
  'context length', 'maximum context', 'token limit',
  'too many tokens', 'exceeds.*max', 'input.*too long',
]

const CANCELLED_MESSAGE = 'Step cancelled by user'

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
  const deadline = ports.stepTimeout ? startTime + ports.stepTimeout : 0

  // §A8 evidence accumulator (D-14) — the recording array IS SubActionEvidence[].
  const recorder = new EvidenceRecorder()
  context.subActionHistory = []

  let totalPromptTokens = 0
  let totalCompletionTokens = 0
  let lastPlannedAction: Action | undefined
  let lastLegacyAnnotation: StepAnnotation | undefined

  // D-15c self-heal boundary carry: the previous failed sub-action's index +
  // Decision. On the next iteration's observation (which reveals the failure), that
  // observation is attached as the failed sub-action's stateAfter AND is naturally the
  // recovering sub-action's stateBefore (identical-state sharing, one capture).
  let pendingSelfHeal: { index: number; failed: Decision } | undefined

  const stepKey: StepKeyInput = { stepInstruction }

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
    const evidence = recorder.finalize(verdict, 0, stepInstruction)
    const subActions = projectLegacyTrace(evidence)
    if (lastLegacyAnnotation && subActions.length > 0) {
      subActions[subActions.length - 1].annotation = lastLegacyAnnotation
    }
    const trace = buildStepTrace(subActions, status === 'passed' ? 'success' : 'failure', error, tokenUsage())
    const result: StepResult = {
      name: stepInstruction,
      status,
      duration: performance.now() - startTime,
      trace,
      evidence,
    }
    if (lastPlannedAction) result.action = lastPlannedAction
    if (error) result.error = error
    if (lastLegacyAnnotation) result.annotation = lastLegacyAnnotation
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

  for (let actionIndex = 0; actionIndex < maxSubActions; actionIndex++) {
    const abortBeforeObserve = checkAbort()
    if (abortBeforeObserve) return abortBeforeObserve

    if (deadline && performance.now() > deadline) {
      return failure(`Step timed out after ${ports.stepTimeout}ms`)
    }

    // 1. OBSERVE — always re-observe. This observation is the next sub-action's
    // stateBefore by construction (D-15).
    let screenState: ScreenState
    try {
      screenState = await withAbort(ports.adapter.observe({ extractDom: true }), ports.abortSignal)
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

    let screenshot: Buffer | undefined
    if (ports.adapter.screenshot) {
      try { screenshot = await withAbort(ports.adapter.screenshot(), ports.abortSignal) } catch { /* best-effort */ }
    }

    const abortAfterObserve = checkAbort()
    if (abortAfterObserve) return abortAfterObserve

    // Compress the LLM-bound screenshot through the port and re-stamp captureMode to
    // `full` runner-side (Pitfall 9). Text-only gate skips all LLM image work; the
    // artifact screenshot above still ran (SCREEN-03).
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
        screenState = stampCaptureMode(screenState, {
          mode: 'full',
          imageWidth: compressed.imageWidth,
          imageHeight: compressed.imageHeight,
        })
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

    // 2. PLAN — cache-first, then the planning turn (via the injected Planner port).
    let planResult: PlanResult
    let cached = false
    const prefixValid = !ports.cacheState?.invalidated

    if (prefixValid && ports.cache?.getSubAction) {
      const cachedPlan = await ports.cache.getSubAction(stepKey, actionIndex)
      if (cachedPlan) {
        // Cache-poisoning guard (loop.ts:66-76/238-244, byte-equivalent): a cached
        // plan carrying a redacted [secret:*] marker for a runtime-templated step is
        // invalidated and re-planned rather than replayed.
        const secretStepUsesRuntimeTemplate = findSecretTemplates(stepInstruction).length > 0
        if (secretStepUsesRuntimeTemplate && containsRedactedSecretMarker(cachedPlan.action)) {
          await ports.cache.invalidateSubActionsFrom?.(stepKey, actionIndex)
          ports.logger?.createScopedLogger('cache')?.debug(
            'Ignoring cached sub-action with redacted secret marker', { actionIndex },
          )
        } else {
          planResult = { plan: cachedPlan }
          cached = true
        }
      }
    }

    if (!cached) {
      if (ports.cache?.invalidateSubActionsFrom) {
        await ports.cache.invalidateSubActionsFrom(stepKey, actionIndex)
      }
      if (ports.cacheState && !ports.cacheState.invalidated) {
        ports.cacheState.invalidated = true
      }
      // Safety context attachment point (loop.ts:265) — optional-chained (D-05).
      context = ports.safetyHooks?.runContext(context).context ?? context
      try {
        planResult = await withAbort(
          ports.planner.plan(stepInstruction, screenState, context, ports.abortSignal),
          ports.abortSignal,
        )
      } catch (planError: unknown) {
        const abortDuringPlan = checkAbort()
        if (abortDuringPlan) return abortDuringPlan
        const errorMsg = planError instanceof Error ? planError.message : String(planError)
        const isContextError = CONTEXT_ERROR_PATTERNS.some(p => new RegExp(p, 'i').test(errorMsg))
        const displayMsg = isContextError
          ? `Model context window exceeded. ${errorMsg}. Increase contextWindow on your LLM config or reduce previousStepCount in planner config.`
          : `LLM planning failed: ${errorMsg}`
        return failure(displayMsg)
      }
    }

    if (planResult!.tokenUsage) {
      totalPromptTokens += planResult!.tokenUsage.promptTokens
      totalCompletionTokens += planResult!.tokenUsage.completionTokens
    }

    const rawPlan = planResult!.plan
    const normalizedAction = normalizePointerActionForStep(rawPlan.action as Action, stepInstruction)
    // Redact BEFORE recording (Information-disclosure control, T-353-08): every value
    // that reaches evidence/display is pre-redacted; secret templates are resolved only
    // at the execute boundary below.
    let action = redactSecretValue(normalizedAction, ports.secretRedactor)
    const reasoning = redactSecretValue(rawPlan.reasoning, ports.secretRedactor)
    lastPlannedAction = action
    const cachePlan: ActionPlan = { ...rawPlan, action: normalizedAction }

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
      })
      return failure(`Step failed: ${reasoning}`)
    }

    // 3. EXECUTE — resolve templates only here; gate through the tool_call hook.
    let execResult: ActionResult
    let execError: string | undefined
    try {
      let actionForExecution = resolveSecretTemplatesInValue(normalizedAction, ports.secretStore)
      const hookResult = ports.safetyHooks?.runToolCall(actionForExecution)
      if (hookResult?.action === 'deny') {
        execResult = { success: false, error: hookResult.reason }
      } else {
        if (hookResult?.action === 'mutate') {
          actionForExecution = hookResult.mutated
          action = redactSecretValue(actionForExecution, ports.secretRedactor)
          lastPlannedAction = action
        } else if (hookResult?.action === 'allow') {
          actionForExecution = hookResult.call
        }

        if (actionForExecution.type === 'setVariable') {
          // Pitfall 8 — setVariable runs via the callback, NOT the adapter.
          const sv = actionForExecution as Extract<Action, { type: 'setVariable' }>
          ports.onSetVariable?.(sv.name, sv.value)
          execResult = { success: true }
        } else {
          let actionToExecute = actionForExecution
          if (actionForExecution.type === 'fileUpload' && ports.resolveUploadPath) {
            // Pitfall 1 — path resolution is injected core-side; the loop never touches paths.
            const resolveUpload = ports.resolveUploadPath
            actionToExecute = { ...actionForExecution, files: actionForExecution.files.map(f => resolveUpload(f)) }
          }
          execResult = redactSecretValue(
            await withAbort(ports.adapter.execute(actionToExecute), ports.abortSignal),
            ports.secretRedactor,
          )
        }
      }
      execResult = ports.safetyHooks?.runToolResult(execResult).result ?? execResult
      if (!execResult.success) execError = execResult.error ?? 'Action failed'
    } catch (err) {
      execError = redactSecretValue(err instanceof Error ? err.message : String(err), ports.secretRedactor)
      execResult = { success: false, error: execError }
    }

    const abortAfterExecute = checkAbort()
    if (abortAfterExecute) return abortAfterExecute

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
      })
      context.failureContext = undefined
      pendingSelfHeal = undefined
      if (!cached && ports.cache?.setSubAction) await ports.cache.setSubAction(stepKey, actionIndex, cachePlan)
      return success()
    }

    // Non-visual assert + stepComplete: the planner judged the condition without screen
    // evidence — trust it, skip verification (Pitfall 8, loop.ts:428). D-15a: an assert
    // sub-action's stateAfter === stateBefore (reuse).
    if (action.type === 'assert' && (action as Extract<Action, { type: 'assert' }>).visual === false && rawPlan.stepComplete) {
      const idx = recorder.recordSubAction({
        plan: reasoning,
        plannedAction: action as unknown as SchemaAction,
        stateBefore: screenState,
        result: toSchemaResult(execResult),
        cached,
      })
      recorder.attachStateAfter(idx, screenState)
      context.failureContext = undefined
      pendingSelfHeal = undefined
      if (!cached && ports.cache?.setSubAction) await ports.cache.setSubAction(stepKey, actionIndex, cachePlan)
      return success()
    }

    const annotation = buildAnnotation(action, execResult, viewport, !!execError)
    lastLegacyAnnotation = toLegacyAnnotation(action, annotation, !!execError)

    // Best-effort "after" screenshot for artifacts.
    if (ports.adapter.screenshot) {
      try { await withAbort(ports.adapter.screenshot(), ports.abortSignal) } catch { /* best-effort */ }
    }
    const abortAfterPostShot = checkAbort()
    if (abortAfterPostShot) return abortAfterPostShot

    // 4. EXECUTION FAILURE → self-heal = replan-with-failure-context (D-12). No counter
    // (D-10). The failed sub-action's stateAfter lands on the next observation (D-15c).
    if (execError) {
      const failedIdx = recorder.recordSubAction({
        plan: reasoning,
        plannedAction: action as unknown as SchemaAction,
        stateBefore: screenState,
        result: toSchemaResult(execResult, annotation),
        cached,
      })

      context.subActionHistory!.push({
        action: JSON.stringify(action),
        reasoning,
        result: 'failure',
        error: execError,
        data: execResult.data !== undefined ? JSON.stringify(execResult.data).slice(0, 2000) : undefined,
      })

      // A failed cached action invalidates the cache and re-plans.
      if (cached && ports.cache?.invalidateSubActionsFrom) {
        await ports.cache.invalidateSubActionsFrom(stepKey, actionIndex)
      }

      // Failure context injected for the next planning turn (the surviving mitigation).
      context.failureContext = `Sub-action ${actionIndex + 1} failed: ${execError}\n` +
        `Failed action: ${JSON.stringify(action)}\n` +
        `Adapt your approach — try a different element or strategy.`

      pendingSelfHeal = {
        index: failedIdx,
        failed: { plan: reasoning, plannedAction: action as unknown as SchemaAction, result: toRecordedActionResult(toSchemaResult(execResult, annotation)) },
      }
      continue
    }

    // Execution succeeded — clear failure context.
    context.failureContext = undefined

    // 5. VERIFY — only when the planner signals stepComplete (three-outcome strategy).
    let verifierReasoning: string | undefined
    if (rawPlan.stepComplete && ports.verifier) {
      // D-15b: the verifier's own re-observation IS stateAfter. Pitfall 7 / D-15a: for
      // assert actions the planner's observation is passed as afterState (re-observing
      // may lose scrolled content) — so assert stateAfter === stateBefore by reuse.
      let afterState: ScreenState
      try {
        afterState = action.type === 'assert'
          ? screenState
          : await withAbort(ports.adapter.observe(), ports.abortSignal)
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
            ports.abortSignal, gate.promptNote,
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
        const idx = recordSuccess(recorder, reasoning, action, screenState, execResult, annotation, cached)
        recorder.attachStateAfter(idx, afterState)
        maybeRecordSelfHeal(recorder, pendingSelfHeal, reasoning, action, execResult, annotation)
        pendingSelfHeal = undefined
        if (!cached && ports.cache?.setSubAction) await ports.cache.setSubAction(stepKey, actionIndex, cachePlan)
        return finish('passed', { pass: true, reasoning: verifierReasoning ?? 'Step completed' })
      }

      if (verifyResult.verification.isAppError) {
        recorder.recordSubAction({
          plan: reasoning,
          plannedAction: action as unknown as SchemaAction,
          stateBefore: screenState,
          result: toSchemaResult(execResult, annotation),
          cached,
        })
        return failure(`Application error: ${verifyResult.verification.reasoning}`)
      }

      // Verifier says not done — planner was wrong about stepComplete. Treat as a
      // self-heal boundary: replan with the verifier's reasoning as failure context
      // (D-12), and let the next observation land as this sub-action's stateAfter (D-15c).
      const failedIdx = recordSuccess(recorder, reasoning, action, screenState, execResult, annotation, cached)
      recorder.attachStateAfter(failedIdx, afterState)
      context.subActionHistory!.push({
        action: JSON.stringify(action),
        reasoning,
        result: 'success',
        verifierRejection: verifierReasoning,
        data: execResult.data !== undefined ? JSON.stringify(execResult.data).slice(0, 2000) : undefined,
      })
      context.failureContext = `Sub-action ${actionIndex + 1} did not accomplish the goal: ${verifierReasoning}\n` +
        `Adapt your approach — try a different element or strategy.`
      pendingSelfHeal = {
        index: failedIdx,
        failed: { plan: reasoning, plannedAction: action as unknown as SchemaAction, result: toRecordedActionResult(toSchemaResult(execResult, annotation)) },
      }
      if (!cached && ports.cache?.setSubAction) await ports.cache.setSubAction(stepKey, actionIndex, cachePlan)
      continue
    }

    // No verifier but the planner claims completion — trust the planner.
    if (rawPlan.stepComplete && !ports.verifier) {
      const idx = recordSuccess(recorder, reasoning, action, screenState, execResult, annotation, cached)
      maybeRecordSelfHeal(recorder, pendingSelfHeal, reasoning, action, execResult, annotation)
      pendingSelfHeal = undefined
      void idx
      if (!cached && ports.cache?.setSubAction) await ports.cache.setSubAction(stepKey, actionIndex, cachePlan)
      return success()
    }

    // Sub-action succeeded but the goal is not yet met — record and continue (no
    // stateAfter: this is not a D-15 boundary).
    recordSuccess(recorder, reasoning, action, screenState, execResult, annotation, cached)
    maybeRecordSelfHeal(recorder, pendingSelfHeal, reasoning, action, execResult, annotation)
    pendingSelfHeal = undefined
    context.subActionHistory!.push({
      action: JSON.stringify(action),
      reasoning,
      result: 'success',
      verifierRejection: rawPlan.stepComplete ? verifierReasoning : undefined,
      data: execResult.data !== undefined ? JSON.stringify(execResult.data).slice(0, 2000) : undefined,
    })
    if (!cached && ports.cache?.setSubAction) await ports.cache.setSubAction(stepKey, actionIndex, cachePlan)
  }

  // Cap exhausted (maxSubActions) — terminate cleanly with a failed StepResult.
  return failure(`Sub-action limit reached (${maxSubActions} actions). Step did not complete.`)
}

// ---- helpers -----------------------------------------------------------------

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

const LEGACY_ANNOTATION_TYPES = new Set<StepAnnotation['type']>([
  'click', 'fill', 'tap', 'hover', 'scroll', 'swipe', 'pinch', 'navigate',
])

function toLegacyAnnotation(action: Action, annotation: ActionAnnotation | undefined, failed: boolean): StepAnnotation | undefined {
  if (!annotation) return undefined
  const type = LEGACY_ANNOTATION_TYPES.has(action.type as StepAnnotation['type'])
    ? (action.type as StepAnnotation['type'])
    : 'other'
  const legacy: StepAnnotation = { type, viewport: annotation.viewport }
  if (annotation.direction) legacy.direction = annotation.direction
  switch (annotation.kind) {
    case 'point':
      legacy.clickPoint = { x: annotation.point.x, y: annotation.point.y }
      if (annotation.point.boundingBox) legacy.boundingBox = annotation.point.boundingBox
      break
    case 'path':
      legacy.startPoint = annotation.path.start
      legacy.endPoint = annotation.path.end
      break
    case 'pinch':
      legacy.startPoint = annotation.pinch.center
      legacy.pinchScale = annotation.pinch.scale > 1 ? 'out' : 'in'
      break
    case 'region':
      legacy.boundingBox = annotation.region.boundingBox
      break
  }
  if (failed) legacy.failureHighlight = legacy.boundingBox
  return legacy
}

function recordSuccess(
  recorder: EvidenceRecorder,
  reasoning: string,
  action: Action,
  stateBefore: ScreenState,
  execResult: ActionResult,
  annotation: ActionAnnotation | undefined,
  cached: boolean,
): number {
  return recorder.recordSubAction({
    plan: reasoning,
    plannedAction: action as unknown as SchemaAction,
    stateBefore,
    result: toSchemaResult(execResult, annotation),
    cached,
  })
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
    plannedAction: last?.plannedAction ?? { type: 'waitFor', condition: 'none', timeout: 0 },
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
