// The §A8 evidence module (D-14): the loop's internal recording types ARE the schema
// §A8 DTOs. Evidence is populated by construction as the loop runs — never projected
// after the fact from v1 SubActionTrace shapes. This module mints ZERO new schema
// types; it consumes SubActionEvidence/StepEvidence/RecordedActionResult/ServedBrief/
// toRecordedActionResult/computeBriefDigest from @vostride/agent-qa-schema.
//
// The legacy StepResult.trace is PROJECTED from the evidence at step end
// (projectLegacyTrace, Open Q5 — richer→poorer is legal; the reverse is D-14's
// forbidden direction). Reporters/dashboard/JUnit keep consuming StepResult.trace
// unchanged until 361/363.
import {
  computeBriefDigest,
  toRecordedActionResult,
} from '@vostride/agent-qa-schema'
import type {
  Action,
  ActionAnnotation,
  ActionResult as SchemaActionResult,
  AiJudgmentEvidence,
  AssertValueEvidence,
  BoundingBox,
  BriefBlock,
  CautionLine,
  CycleEvidence,
  Decision,
  DeclaredModelProfile,
  LocalEffectEvidence,
  ModelIdentity,
  ModelCallRecord,
  PlanningFailureEvidence,
  Point,
  RecordedActionResult,
  ReportedValueEvidence,
  ReadTrace,
  ScopeKey,
  ScreenState,
  ServedBrief,
  StagnationEvidence,
  StepEvidence,
  StepPlanSource,
  SubActionEvidence,
  TerminationEvidence,
  ToolExchangeEvidence,
  VerdictSource,
  VerifierVerdict,
  Viewport,
  WorkingMemoryEntry,
} from '@vostride/agent-qa-schema'
import type { Action as PlatformAction, ActionResult as PlatformActionResult } from '../platform.js'
import type { StepAnnotation, SubActionTrace } from '../result.js'

// ---------------------------------------------------------------------------
// makeEmptyServedBrief — the canonical empty brief (Pitfall 4 / D-05 graceful
// degradation). StepEvidence.servedBrief is REQUIRED; when no KnowledgeHintReader is
// bound (no M2 implementation exists) the loop serves this fully-typed empty brief —
// never an unsafe cast (Pitfall 4's warning sign).
// ---------------------------------------------------------------------------

export function makeEmptyServedBrief(scope: ScopeKey, asOfBuild: number): ServedBrief {
  const brief: ServedBrief = {
    scope,
    asOfBuild,
    budget: 0,
    truncation: 'no brief served (no knowledge reader bound)',
    channel1: [],
    channel2: [],
    channel3: [],
    briefDigest: '',
  }
  // computeBriefDigest canonicalizes every field EXCEPT briefDigest, so digesting the
  // brief with an empty digest field yields the stable content digest.
  return { ...brief, briefDigest: computeBriefDigest(brief) }
}

function makeChannel1ServedBrief(input: {
  scope: ScopeKey
  asOfBuild: number
  budget: number
  block: BriefBlock
}): ServedBrief {
  const served: ServedBrief = {
    scope: input.scope,
    asOfBuild: input.asOfBuild,
    budget: input.budget,
    truncation: input.block.truncation,
    channel1: [...input.block.lines],
    // D-03: Channel 2 read traces and Channel 3 cautions are populated by 380-07/380-09.
    channel2: [],
    channel3: [],
    briefDigest: '',
  }
  return { ...served, briefDigest: computeBriefDigest(served) }
}

// ---------------------------------------------------------------------------
// foldCacheStatus — per-step fold of v1's per-sub-action `cached` booleans. Any miss
// ⇒ 'miss', all hit ⇒ 'hit'. 'bypass' is unused until Phase 356's cache redesign
// (documented here for that phase; do not emit it from this fold).
// ---------------------------------------------------------------------------

export function foldCacheStatus(subActionCacheFlags: boolean[]): StepEvidence['cacheStatus'] {
  // Empty step (no sub-actions cached against) has no miss ⇒ 'hit' vacuously.
  return subActionCacheFlags.every(flag => flag) ? 'hit' : 'miss'
}

// ---------------------------------------------------------------------------
// collapseAnnotation — pure re-derivation of the v1 loop.ts StepAnnotation block,
// mapping the adapter's runner-legacy result shape (coordinates / boundingBox /
// startCoordinates / endCoordinates) onto the single schema ActionAnnotation union.
// Feeds result.annotation on evidence; projectLegacyTrace derives the legacy dashboard
// StepAnnotation from it (reporters consume that until 361/363).
// ---------------------------------------------------------------------------

function clampPointToViewport(point: Point, viewport: Viewport): Point {
  return {
    x: Math.max(0, Math.min(point.x, viewport.width)),
    y: Math.max(0, Math.min(point.y, viewport.height)),
  }
}

function scrollDirection(action: PlatformAction): 'up' | 'down' | 'left' | 'right' | undefined {
  if (action.type !== 'scroll') return undefined
  // Schema v2 Scroll carries an explicit direction on both modes (direction / untilVisible) —
  // no pixel sign to decode (D-01).
  const a = action as Extract<PlatformAction, { type: 'scroll' }>
  return a.direction
}

export function collapseAnnotation(
  action: PlatformAction,
  execResult: PlatformActionResult,
  viewport: Viewport,
): ActionAnnotation {
  // Schema swipe (D-15 flip): SwipeByDirection carries `direction`; SwipeByPath carries from/to.
  const direction = action.type === 'swipe'
    ? (action.mode === 'direction' ? action.direction : undefined)
    : scrollDirection(action)

  const base = { viewport, ...(direction ? { direction } : {}) }

  // path — swipe/drag map to a start→end segment (execResult coords first, then the
  // action's own path points as the fallback — schema SwipeByPath `from`/`to`).
  if (action.type === 'swipe' || action.type === 'drag') {
    const start = execResult.startCoordinates
      ?? (action.type === 'swipe' && action.mode === 'path' ? action.from : undefined)
    const end = execResult.endCoordinates
      ?? (action.type === 'swipe' && action.mode === 'path' ? action.to : undefined)
    return {
      ...base,
      kind: 'path',
      path: { start: start ?? { x: 0, y: 0 }, end: end ?? { x: 0, y: 0 } },
    }
  }

  // pinch — center + scale (schema: coordinate form carries x/y; ref form has no center).
  if (action.type === 'pinch') {
    const a = action as Extract<PlatformAction, { type: 'pinch' }>
    const center = execResult.coordinates
      ?? ('x' in a && 'y' in a ? { x: a.x, y: a.y } : { x: 0, y: 0 })
    return { ...base, kind: 'pinch', pinch: { center, scale: a.scale } }
  }

  // scroll with a container bounding box → region (clamped into the viewport, v1 rule).
  if (action.type === 'scroll' && execResult.boundingBox) {
    return { ...base, kind: 'region', region: { boundingBox: clampToViewport(execResult.boundingBox, viewport) } }
  }

  // point — the default (click/fill/tap/hover/navigate/…): a single click point plus an
  // optional bounding box carried alongside.
  const rawPoint = execResult.coordinates ?? { x: 0, y: 0 }
  const point = action.type === 'scroll' ? clampPointToViewport(rawPoint, viewport) : rawPoint
  const boundingBox = execResult.boundingBox
  return {
    ...base,
    kind: 'point',
    point: boundingBox ? { ...point, boundingBox } : point,
  }
}

function clampToViewport(box: BoundingBox, viewport: Viewport): BoundingBox {
  let { x, y, width, height } = box
  if (y < 0) { height += y; y = 0 }
  if (x < 0) { width += x; x = 0 }
  if (x + width > viewport.width) width = viewport.width - x
  if (y + height > viewport.height) height = viewport.height - y
  return { x, y, width: Math.max(0, width), height: Math.max(0, height) }
}

// ---------------------------------------------------------------------------
// EvidenceRecorder — the accumulator the loop drives. Its recording types ARE the
// schema §A8 DTOs; there is no intermediate v1 shape.
// ---------------------------------------------------------------------------

export interface RecordSubActionInput {
  /** The planner's reasoning/plan string for this sub-action. */
  plan: string
  plannedAction: Action
  /**
   * The FULL observed ScreenState the sub-action was planned against (D-15). Pitfall 3:
   * v1 stored only the tree string — the forbidden shape. elements + refMap ride along.
   */
  stateBefore: ScreenState
  stateAfter?: ScreenState
  /**
   * The execution result as the schema ActionResult (screenshot may be present here as
   * bytes; it is structurally excluded by toRecordedActionResult before storage — the
   * type-level screenshot-never guarantee, T-353-06). annotation is produced via
   * collapseAnnotation.
   */
  result: SchemaActionResult
  /** v1 per-sub-action cache flag; folded per step by foldCacheStatus at finalize. */
  cached?: boolean
  /**
   * The §A8 grounding evidence for this sub-action (GROUND-02): the resolved descriptor
   * plus the per-rung attempt trail (turn gate on the live path, replay resolution on the
   * cache path, re-ground heal entries on the D-10 path). Present only when the action
   * carried an element field; the loop redacts the descriptor BEFORE passing it here so a
   * pre-redaction descriptor never reaches evidence (T-357-02a, the redact-before-record
   * ordering). Typed via the schema DTO — no runner-local mirror (353 evidence-by-construction).
   */
  grounding?: SubActionEvidence['grounding']
  /**
   * The §A8 decision-screenshot ArtifactRef (CASS-02): the identity of the exact final image
   * bytes the planner saw for this live decision, minted by the run-scoped artifact store.
   * Absent on cache-served, text-only, unbound-store, or failed-store paths — never fabricated.
   */
  decisionScreenshotRef?: SubActionEvidence['decisionScreenshotRef']
  /**
   * Auxiliary §A8 ArtifactRefs already reserved by the schema DTO. Copied verbatim (order and
   * identity preserved) so the recorder never drops artifact references present on the input.
   */
  artifactRefs?: SubActionEvidence['artifactRefs']
  /**
   * Ordered exchanges from this live planning decision (D-01). The loop masks every
   * string leaf BEFORE passing them here (T-360-01); the recorder never sees raw values.
   * Present, possibly empty, for live turns and absent for cache replay.
   */
  exchanges?: ToolExchangeEvidence[]
  /**
   * Final-response enrichment for this live decision (D-05/D-08). The loop passes it
   * conditionally; structural absence means no live call record was available.
   */
  callRecord?: ModelCallRecord
  /**
   * The §A8 differential-observation oracle outcome (CYCLE-01, D-07). Recorded by
   * construction for every oracle-checked sub-action — usually attached one iteration late
   * (the oracle evaluates action N at the settled top of iteration N+1) via
   * {@link EvidenceRecorder.attachLocalEffect}, but accepted here for the step-final path
   * where the oracle runs against the verifier's observation in the same iteration (D-05).
   */
  localEffect?: LocalEffectEvidence
}

export class EvidenceRecorder {
  private readonly subActions: SubActionEvidence[] = []
  private readonly cacheFlags: boolean[] = []
  private servedBrief: ServedBrief
  private selfHeal?: StepEvidence['selfHeal']
  private stagnation?: StagnationEvidence
  private cycle?: CycleEvidence
  private workingMemory?: WorkingMemoryEntry[]
  private planningFailure?: PlanningFailureEvidence
  private reportedValue?: ReportedValueEvidence
  private termination?: TerminationEvidence
  private aiJudgment?: AiJudgmentEvidence
  private assertOutcome?: AssertValueEvidence
  private verdictSource?: VerdictSource
  private planSource?: StepPlanSource
  /** D-06 run-declared planner context, copied onto every finalized step when bound. */
  private readonly modelProfile?: DeclaredModelProfile
  /** D-07 verifier identity copied beside every finalized verdict when bound. */
  private readonly verifierIdentity?: ModelIdentity
  /** D-16 once-per-member bound-surface digest copied onto every finalized step. */
  private readonly toolSchemaDigest?: string
  /**
   * D-02 single sub-action chokepoint (Plan 361-08). When bound, invoked at the END of
   * every {@link recordSubAction} append with the recorded evidence and its index — so all
   * five loop call sites emit `subActionRecorded` through ONE seam, never per-call-site.
   * Optional-chained: unbound ⇒ the recorder is byte-identical to today (never throws, D-05).
   */
  private readonly onSubActionRecorded?: (evidence: SubActionEvidence, index: number) => void

  constructor(options?: {
    servedBrief?: ServedBrief
    scope?: ScopeKey
    asOfBuild?: number
    onSubActionRecorded?: (evidence: SubActionEvidence, index: number) => void
    modelProfile?: DeclaredModelProfile
    verifierIdentity?: ModelIdentity
    toolSchemaDigest?: string
  }) {
    this.servedBrief = options?.servedBrief
      ?? makeEmptyServedBrief(options?.scope ?? { tier: 'test', key: '' }, options?.asOfBuild ?? 0)
    this.onSubActionRecorded = options?.onSubActionRecorded
    this.modelProfile = options?.modelProfile
    this.verifierIdentity = options?.verifierIdentity
    this.toolSchemaDigest = options?.toolSchemaDigest
  }

  /** Append a §A8 SubActionEvidence. Returns its index (for attachStateAfter). */
  recordSubAction(input: RecordSubActionInput): number {
    const result: RecordedActionResult = toRecordedActionResult(input.result)
    const evidence: SubActionEvidence = {
      plan: input.plan,
      plannedAction: input.plannedAction,
      stateBefore: input.stateBefore,
      result,
    }
    if (input.stateAfter) evidence.stateAfter = input.stateAfter
    if (input.exchanges !== undefined) evidence.exchanges = input.exchanges
    if (input.callRecord !== undefined) evidence.callRecord = input.callRecord
    if (input.grounding) evidence.grounding = input.grounding
    if (input.localEffect) evidence.localEffect = input.localEffect
    if (input.decisionScreenshotRef) evidence.decisionScreenshotRef = input.decisionScreenshotRef
    if (input.artifactRefs) evidence.artifactRefs = [...input.artifactRefs]
    this.subActions.push(evidence)
    this.cacheFlags.push(input.cached ?? false)
    const index = this.subActions.length - 1
    // D-02 live emission (Plan 361-08): fire the one chokepoint AFTER the append so the
    // recorded evidence + its index leave the loop at the moment they occur. Fire-and-forget,
    // optional-chained — never throws when unbound.
    this.onSubActionRecorded?.(evidence, index)
    return index
  }

  /**
   * Attach the CYCLE-01 differential-observation oracle outcome to an already-recorded
   * sub-action (D-05/D-07). The oracle evaluates action N's local intended effect at the
   * settled top of iteration N+1 — one iteration after the sub-action was recorded — so the
   * loop reuses the recorded index to land the block on the right sub-action by construction.
   */
  attachLocalEffect(index: number, localEffect: LocalEffectEvidence): void {
    const evidence = this.subActions[index]
    if (evidence) evidence.localEffect = localEffect
  }

  /**
   * Record the CYCLE-02 stagnation-tree state at a terminal `stepFailed` (D-07). Event-scoped
   * — recorded ONCE at the anchor's bounded-ladder exhaustion, never per iteration.
   */
  recordStagnation(stagnation: StagnationEvidence): void {
    this.stagnation = stagnation
  }

  /**
   * Record the CYCLE-03 cycle-flag terminal block (D-07/D-08). Event-scoped — recorded ONCE
   * at the terminal cycle fail (state revisitation AND no task progress across the window).
   */
  recordCycle(cycle: CycleEvidence): void {
    this.cycle = cycle
  }

  /**
   * Snapshot the run-scoped working-memory set served to this step's planning turns
   * (WM-01, §12.15). The loop passes the values ALREADY masked (`ports.masking.mask`, Pitfall
   * 7 boundary 3) — recorded BESIDE the brief, never inside `servedBrief`.
   */
  recordWorkingMemory(entries: WorkingMemoryEntry[]): void {
    this.workingMemory = entries
  }

  /**
   * Record the real deterministic Channel-1 brief served to this step. The recording type is the
   * schema-owned ServedBrief; the digest is always recomputed over the populated channels.
   * makeEmptyServedBrief remains exclusively the no-reader constructor fallback.
   */
  recordServedBrief(input: {
    scope: ScopeKey
    asOfBuild: number
    budget: number
    block: BriefBlock
  }): void {
    const channel1 = makeChannel1ServedBrief(input)
    const served: ServedBrief = {
      ...channel1,
      // A step may replan more than once. Re-reading the frozen Channel-1 block must not erase
      // direct-read or failure-caution evidence already served by an earlier turn in this step.
      channel2: [...this.servedBrief.channel2],
      channel3: [...this.servedBrief.channel3],
      briefDigest: '',
    }
    this.servedBrief = { ...served, briefDigest: computeBriefDigest(served) }
  }

  /**
   * Append the exact Channel-3 CautionLines injected into a live replan turn. Refused records
   * never enter this method; the reserved reader overflow line does because its summary was
   * actually rendered. Digest recomputation keeps ServedBrief content-addressed after mutation.
   */
  recordServedCautions(cautions: readonly CautionLine[]): void {
    if (cautions.length === 0) return
    const served: ServedBrief = {
      ...this.servedBrief,
      channel3: [...this.servedBrief.channel3, ...cautions],
      briefDigest: '',
    }
    this.servedBrief = { ...served, briefDigest: computeBriefDigest(served) }
  }

  /** Append successful Channel-2 direct reads and re-address the complete served brief. */
  recordServedReadTraces(traces: readonly ReadTrace[]): void {
    if (traces.length === 0) return
    const served: ServedBrief = {
      ...this.servedBrief,
      channel2: [...this.servedBrief.channel2, ...traces],
      briefDigest: '',
    }
    this.servedBrief = { ...served, briefDigest: computeBriefDigest(served) }
  }

  /**
   * Record the structurally failed planning turn (D-03). Exchanges and message arrive
   * ALREADY masked by the loop; the recorder remains mask-agnostic.
   */
  recordPlanningFailure(evidence: PlanningFailureEvidence): void {
    this.planningFailure = evidence
  }

  // -------------------------------------------------------------------------
  // Phase 360 termination-verb & AI-assertion evidence blocks (EXEC-05/EXEC-07 ·
  // D-03/D-04/D-05/D-10/D-11). Sibling record* methods on the recorder; recording types ARE
  // the schema §A8 DTOs (353 D-14 law — no runner-local mirror). MASKED-BEFORE-RECORD: as with
  // recordWorkingMemory, the caller (the Plan 10 dispatch seam) masks every value-bearing field
  // via `ports.masking.mask` BEFORE handing the DTO here — the recorder never sees a raw secret
  // and never store-raw-then-masks (T-360-01).
  // -------------------------------------------------------------------------

  /**
   * Record the D-03 `common_reportValue` answer block. `value` arrives already masked. Surfaced
   * on StepEvidence.reportedValue so the verdict layer (and Phase 361's handoff) carries the
   * retrieved answer first-class. reportValue is non-terminal (D-02) — this only records.
   */
  recordReportedValue(evidence: ReportedValueEvidence): void {
    this.reportedValue = evidence
  }

  /**
   * Record the D-04 infeasible termination block — present only when a turn declared the step
   * infeasible via the `failureKind`/`failureReason` envelope (machine-distinguishable from a
   * plain `stepFailed`). Sorted keys `["kind","reason"]` are fixed by the DTO.
   */
  recordTermination(evidence: TerminationEvidence): void {
    this.termination = evidence
  }

  /**
   * Record the D-05/D-06/D-07/D-09 AI judge block (`assertAI`/`extractAI`): verdict, rationale
   * (masked), the requested-but-deferred M3/M4 knobs, and the extractAI global-scope degradation
   * marker. One judgment per attempt (single-model law).
   */
  recordAiJudgment(evidence: AiJudgmentEvidence): void {
    this.aiJudgment = evidence
  }

  /**
   * Record the D-10/D-11 structured `common_assertValue` outcome block: the comparator's
   * deterministic result with `expected`/`actual` already masked. A passing outcome drives the
   * verifier short-circuit (Plan 10 seam), recorded via {@link recordVerdictSource}.
   */
  recordAssertOutcome(evidence: AssertValueEvidence): void {
    this.assertOutcome = evidence
  }

  /**
   * Record which path produced this step's verification verdict (D-11): the deterministic
   * assertValue comparator (`'assert-value'`), the assertAI judge (`'assert-ai'`), or the
   * verifier's own model call (`'verifier-model'`). Set by the Plan 10 seam at the verdict fork.
   */
  recordVerdictSource(source: VerdictSource): void {
    this.verdictSource = source
  }

  /**
   * Record the typed step plan source (PROC-02 · 381 D-12). `procedure-replay` carries the
   * guard fold (checksPassed/total + the first miss when the fold broke off); `procedure-hint`
   * marks a served-without-replay exposure. Recorded BESIDE `cacheStatus` — structurally
   * distinct from the cached flag so eval/cassette consumers reading cached semantics are
   * never polluted (Pitfall 4). Last write wins: the loop updates the fold as guard checks
   * accumulate, and the final state is what finalize emits.
   */
  recordPlanSource(source: StepPlanSource): void {
    this.planSource = source
  }

  /**
   * Attach the D-15 stateAfter at the spec-locked boundaries (assert sub-actions, the
   * verifier boundary, the self-heal boundary) by reuse of an observation the loop
   * already takes — no extra capture.
   */
  attachStateAfter(index: number, state: ScreenState): void {
    const evidence = this.subActions[index]
    if (evidence) evidence.stateAfter = state
  }

  /** Record the §A8 contrastive self-heal pair (D-12): the failed decision and the
   * recovering decision at the replan-with-failure-context boundary. */
  recordSelfHeal(failedDecision: Decision, recoveringDecision: Decision): void {
    this.selfHeal = { failedDecision, recoveringDecision }
  }

  /** Finalize the accumulated evidence into a §A8 StepEvidence. cacheStatus is the
   * per-step fold; servedBrief is always present (empty when no reader bound).
   *
   * `options.nonCacheable` threads the D-08 bypass signal (Pitfall 7): when a step was
   * classified NonCacheableStepInput the loop never touched the cache, so cacheStatus is
   * `'bypass'` DIRECTLY — orthogonal to the boolean hit/miss fold (a cached sub-action's
   * flag must not fold to `'hit'` for a bypassed step). */
  finalize(
    verdict: VerifierVerdict,
    stepIndex: number,
    stepText: string,
    options?: { nonCacheable?: boolean },
  ): StepEvidence {
    const evidence: StepEvidence = {
      stepIndex,
      stepText,
      cacheStatus: options?.nonCacheable ? 'bypass' : foldCacheStatus(this.cacheFlags),
      servedBrief: this.servedBrief,
      subActions: this.subActions,
      verifierVerdict: verdict,
    }
    if (this.selfHeal) evidence.selfHeal = this.selfHeal
    if (this.stagnation) evidence.stagnation = this.stagnation
    if (this.cycle) evidence.cycle = this.cycle
    if (this.workingMemory) evidence.workingMemory = this.workingMemory
    if (this.planningFailure) evidence.planningFailure = this.planningFailure
    if (this.reportedValue) evidence.reportedValue = this.reportedValue
    if (this.termination) evidence.termination = this.termination
    if (this.aiJudgment) evidence.aiJudgment = this.aiJudgment
    if (this.assertOutcome) evidence.assertOutcome = this.assertOutcome
    if (this.verdictSource) evidence.verdictSource = this.verdictSource
    if (this.planSource) evidence.planSource = this.planSource
    if (this.modelProfile !== undefined) evidence.modelProfile = this.modelProfile
    if (this.verifierIdentity !== undefined) evidence.verifierIdentity = this.verifierIdentity
    if (this.toolSchemaDigest !== undefined) evidence.toolSchemaDigest = this.toolSchemaDigest
    return evidence
  }
}

// ---------------------------------------------------------------------------
// projectLegacyTrace — projects the legacy SubActionTrace[] (string screen states)
// FROM the evidence at step end. Richer→poorer only (Open Q5); reporters/dashboard/
// JUnit keep consuming StepResult.trace unchanged until 361/363.
// ---------------------------------------------------------------------------

const LEGACY_ANNOTATION_TYPES: ReadonlySet<StepAnnotation['type']> = new Set([
  'click', 'fill', 'tap', 'hover', 'scroll', 'swipe', 'pinch', 'navigate',
])

function legacyAnnotationType(actionType: string): StepAnnotation['type'] {
  return LEGACY_ANNOTATION_TYPES.has(actionType as StepAnnotation['type'])
    ? (actionType as StepAnnotation['type'])
    : 'other'
}

function toLegacyStepAnnotation(annotation: ActionAnnotation, actionType: string): StepAnnotation {
  const legacy: StepAnnotation = {
    type: legacyAnnotationType(actionType),
    viewport: annotation.viewport,
  }
  if (annotation.direction) legacy.direction = annotation.direction
  if (annotation.failureHighlight) legacy.failureHighlight = annotation.failureHighlight
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
  return legacy
}

export function projectLegacyTrace(evidence: StepEvidence): SubActionTrace[] {
  return evidence.subActions.map((sub, index) => {
    const trace: SubActionTrace = {
      index,
      observation: sub.stateBefore.tree,
      reasoning: sub.plan,
      plannedAction: sub.plannedAction as PlatformAction,
      result: sub.result.success ? 'success' : 'failure',
      screenStateBefore: sub.stateBefore.tree,
      cached: false,
    }
    if (sub.result.error !== undefined) trace.error = sub.result.error
    if (sub.stateAfter) trace.screenStateAfter = sub.stateAfter.tree
    if (sub.result.annotation) {
      trace.annotation = toLegacyStepAnnotation(sub.result.annotation, sub.plannedAction.type)
    }
    if (sub.result.data !== undefined) trace.data = sub.result.data
    return trace
  })
}
