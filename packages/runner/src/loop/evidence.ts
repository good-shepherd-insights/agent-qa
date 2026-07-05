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
  BoundingBox,
  Decision,
  Point,
  RecordedActionResult,
  ScopeKey,
  ScreenState,
  ServedBrief,
  StepEvidence,
  SubActionEvidence,
  VerifierVerdict,
  Viewport,
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
  const a = action as Extract<PlatformAction, { type: 'scroll' }>
  if (a.scrollType === 'vertical') return a.value > 0 ? 'down' : 'up'
  return a.value > 0 ? 'right' : 'left'
}

export function collapseAnnotation(
  action: PlatformAction,
  execResult: PlatformActionResult,
  viewport: Viewport,
): ActionAnnotation {
  const direction = action.type === 'swipe'
    ? (action as Extract<PlatformAction, { type: 'swipe' }>).direction
    : scrollDirection(action)

  const base = { viewport, ...(direction ? { direction } : {}) }

  // path — swipe/drag map to a start→end segment (execResult coords first, then the
  // action's own coordinates as the v1 fallback).
  if (action.type === 'swipe' || action.type === 'drag') {
    const start = execResult.startCoordinates
      ?? (action.type === 'swipe' && action.startX !== undefined && action.startY !== undefined
        ? { x: action.startX, y: action.startY }
        : undefined)
    const end = execResult.endCoordinates
      ?? (action.type === 'swipe' && action.endX !== undefined && action.endY !== undefined
        ? { x: action.endX, y: action.endY }
        : undefined)
    return {
      ...base,
      kind: 'path',
      path: { start: start ?? { x: 0, y: 0 }, end: end ?? { x: 0, y: 0 } },
    }
  }

  // pinch — center + scale.
  if (action.type === 'pinch') {
    const a = action as Extract<PlatformAction, { type: 'pinch' }>
    const center = execResult.coordinates
      ?? (a.x !== undefined && a.y !== undefined ? { x: a.x, y: a.y } : { x: 0, y: 0 })
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
}

export class EvidenceRecorder {
  private readonly subActions: SubActionEvidence[] = []
  private readonly cacheFlags: boolean[] = []
  private servedBrief: ServedBrief
  private selfHeal?: StepEvidence['selfHeal']

  constructor(options?: { servedBrief?: ServedBrief; scope?: ScopeKey; asOfBuild?: number }) {
    this.servedBrief = options?.servedBrief
      ?? makeEmptyServedBrief(options?.scope ?? { tier: 'test', key: '' }, options?.asOfBuild ?? 0)
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
    this.subActions.push(evidence)
    this.cacheFlags.push(input.cached ?? false)
    return this.subActions.length - 1
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
