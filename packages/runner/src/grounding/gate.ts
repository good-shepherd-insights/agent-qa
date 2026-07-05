// The pre-execution grounding gate (Phase 357, GROUND-03 · D-04/D-08).
// CRITICAL: provider-neutral + storage-neutral. No node:* imports, no fs/sharp, no
// core/model/adapter package imports — imports only sibling grounding modules, the
// runner's tool errors + cache descriptor projection, and schema types.
//
// The single chokepoint (D-08) that converts an emission-shape planned action (carrying
// EITHER a committed `ref` OR a `target` descriptor) into a fully-grounded, execution-shape
// action (a `ref`, never a descriptor). Adapters never see descriptors or unvalidated
// refs/coords — grounding is NEVER duplicated into platform adapters. Every failure class
// mints a structured §7.1 GroundingError; no path ever silently best-guesses a click:
//   - exactly-one-of ref|target on a required-element field  ⇒ descriptor_invalid (D-04,
//     gate-side, never a zod refine). Optional container fields (scroll/swipe/pinch/multiTap)
//     may carry neither.
//   - a target descriptor: name-less ⇒ descriptor_invalid; near-bearing ⇒ descriptor_invalid;
//     unresolved ⇒ descriptor_unresolved (§12.17 self-correcting form); >1 match ⇒
//     descriptor_ambiguous. The tree-search (+ optional capability-gated visual) ladder runs;
//     the committed-ref rung is NOT part of the descriptor lane (its attempt trail is
//     descriptor-only, D-02's visual:skipped denominator preserved).
//   - a committed ref absent from the fresh refMap ⇒ ref_not_in_snapshot (first live raise
//     site of the dormant GROUND-03 factory).
//   - an out-of-bounds coordinate call ⇒ coords_out_of_bounds (first live raise site),
//     bounds-checked coordSpace-aware: 'viewport' against metadata.viewportWidth/Height,
//     'content' against metadata.scroll.contentWidth/Height, 'screen' UNCHECKED (no captured
//     bound — screen space is device-physical and unbounded by the observation, Pitfall 10).
//
// The visual rung is a capability-negotiation seam (GROUND-02, Q3): a supplied visual rung
// runs ONLY under `vision: true`; otherwise the ladder exhausts and records visual:skipped.

import { matchDescriptor } from './matcher.js'
import type { DescriptorInput, MatchResult } from './matcher.js'
import { assembleLadder, runLadder } from './rungs.js'
import type { GroundingRung, RungRequest } from './rungs.js'
import { toGroundedLocator } from '../cache/value.js'
import type { GroundedLocator } from '../cache/value.js'
import type { Action } from '../platform.js'
import { GroundingError, groundingError } from '../tools/errors.js'
import type { ElementInfo, GroundingAttempt, Ref, ScreenState } from '@vostride/agent-qa-schema'

/**
 * A visual grounding rung supplied by the caller (GROUND-02, Q3 seam). It exposes a pure
 * `match()` over the fresh observation; the gate wraps it into a ladder rung and runs it
 * only under vision capability. No visual rung ships in M1 (D-01) — this is the negotiation
 * seam, injected in tests to prove capability gating.
 */
export interface GateVisualRung {
  stage: 'visual'
  match(req: RungRequest): MatchResult
}

/** Capability + context options for the gate (the Q3 negotiation seam). */
export interface GateOptions {
  /** Vision capability present — required for the supplied visual rung to run. */
  vision?: boolean
  /** A caller-supplied visual rung; appended to the descriptor ladder only under vision. */
  visualRung?: GateVisualRung
  /** Additional caller rungs (only stage 'visual' entries are appended, and only under vision). */
  extraRungs?: GroundingRung[]
  /** The previously-grounded element for D-10 hierarchy disambiguation. */
  prior?: ElementInfo
  /** The observation the prior element belongs to (its parent chain is walked). */
  priorElements?: readonly ElementInfo[]
}

/** The gate's input: the tool name, the emission-shape action, the fresh screen, options. */
export interface GroundActionPlanInput {
  toolName: string
  action: Record<string, unknown>
  screenState: ScreenState
  options?: GateOptions
}

/**
 * The gate result. `ok: true` carries a fully-grounded, execution-shape action (every
 * element field a ref, no target field surviving) plus the §A8 attempts trail and an
 * optional descriptor-only locator derived for the evidence block; `ok: false` carries the
 * structured GroundingError and the attempts recorded before the failure.
 */
export type GateResult =
  | { ok: true; action: Record<string, unknown>; attempts: GroundingAttempt[]; descriptor?: GroundedLocator }
  | { ok: false; error: GroundingError; attempts: GroundingAttempt[] }

/** A ref/target lane on the action: a paired ref field + descriptor field. */
interface FieldGroup {
  refKey: string
  targetKey: string
  /** A required-element field errors on neither; an optional container field may carry neither. */
  required: boolean
}

// Actions whose element target is mandatory (a single ref/target lane).
const REQUIRED_ELEMENT_TYPES = new Set<string>([
  'click',
  'fill',
  'select',
  'nativeSelect',
  'hover',
  'paste',
  'doubleClick',
  'rightClick',
  'fileUpload',
  'copy',
  'tap',
  'longpress',
  'clearText',
  'doubleTap',
])

// Actions whose element target is an OPTIONAL container (may ground an element or not).
const OPTIONAL_ELEMENT_TYPES = new Set<string>(['scroll', 'swipe', 'pinch', 'multiTap'])

function has(action: Record<string, unknown>, key: string): boolean {
  const value = action[key]
  return value !== undefined && value !== null
}

/** The ref/target lanes to ground for an action (drag ⇒ from+to pair; single lane otherwise). */
function elementGroups(action: Record<string, unknown>): FieldGroup[] {
  const type = typeof action.type === 'string' ? action.type : ''
  const dragShaped =
    type === 'drag' ||
    'fromRef' in action ||
    'fromTarget' in action ||
    'toRef' in action ||
    'toTarget' in action
  if (dragShaped) {
    return [
      { refKey: 'fromRef', targetKey: 'fromTarget', required: true },
      { refKey: 'toRef', targetKey: 'toTarget', required: true },
    ]
  }

  const required = REQUIRED_ELEMENT_TYPES.has(type)
  const optional = OPTIONAL_ELEMENT_TYPES.has(type)
  if (required || optional || 'ref' in action || 'target' in action) {
    return [{ refKey: 'ref', targetKey: 'target', required }]
  }
  return []
}

/**
 * The descriptor lane's ladder: tree-search plus, under vision capability, the supplied
 * visual rung. The committed-ref rung is deliberately excluded — the descriptor lane's
 * attempt trail is descriptor-only. Reuses assembleLadder for the capability gating, then
 * strips the ref rung.
 */
function descriptorLadder(options: GateOptions): GroundingRung[] {
  const extraRungs: GroundingRung[] = []
  if (options.visualRung) {
    const rung = options.visualRung
    extraRungs.push({ stage: 'visual', run: (req) => rung.match(req) })
  }
  if (options.extraRungs) extraRungs.push(...options.extraRungs)

  const full = assembleLadder({ vision: options.vision, extraRungs })
  return full.filter((rung) => rung.stage !== 'ref')
}

/** A compact, injection-inert role/name rendering of a descriptor for error messages. */
function renderDescriptor(descriptor: DescriptorInput): string {
  const role = typeof descriptor.role === 'string' && descriptor.role.length > 0 ? descriptor.role : 'element'
  const name =
    typeof descriptor.name === 'string' && descriptor.name.length > 0
      ? descriptor.name
      : typeof descriptor.nameNormalized === 'string'
        ? descriptor.nameNormalized
        : ''
  const ordinal = typeof descriptor.ordinal === 'number' ? ` #${descriptor.ordinal}` : ''
  return name.length > 0 ? `${role} "${name}"${ordinal}` : `${role}${ordinal}`
}

function coordBoundsError(
  toolName: string,
  action: Record<string, unknown>,
  screenState: ScreenState,
): GroundingError | undefined {
  const { x, y } = action
  if (typeof x !== 'number' || typeof y !== 'number') return undefined

  const coordSpace =
    typeof action.coordSpace === 'string' ? action.coordSpace : screenState.metadata.coordSpace

  // 'screen' space is device-physical and unbounded by the observation — never checked.
  if (coordSpace === 'screen') return undefined

  const { metadata } = screenState
  const width = coordSpace === 'content' ? metadata.scroll.contentWidth : metadata.viewportWidth
  const height = coordSpace === 'content' ? metadata.scroll.contentHeight : metadata.viewportHeight

  if (x < 0 || y < 0 || x > width || y > height) {
    return groundingError.coordsOutOfBounds(toolName, x, y, width, height)
  }
  return undefined
}

function fail(error: GroundingError, attempts: GroundingAttempt[]): GateResult {
  return { ok: false, error, attempts }
}

/**
 * Ground a single emission-shape planned action against the current ScreenState. See the
 * module header for the full contract. Synchronous and pure over its inputs (the caller
 * supplies the fresh observation and any redaction of descriptor text).
 */
export function groundActionPlan(input: GroundActionPlanInput): GateResult {
  const { toolName, screenState } = input
  const options = input.options ?? {}
  const draft: Record<string, unknown> = { ...input.action }
  const attempts: GroundingAttempt[] = []

  for (const group of elementGroups(draft)) {
    const hasRef = has(draft, group.refKey)
    const hasTarget = has(draft, group.targetKey)

    // (1) exactly-one-of (D-04): both populated, or neither on a required field.
    if (hasRef && hasTarget) {
      return fail(groundingError.descriptorInvalid(toolName, 'exactly-one'), attempts)
    }
    if (!hasRef && !hasTarget) {
      if (group.required) {
        return fail(groundingError.descriptorInvalid(toolName, 'exactly-one'), attempts)
      }
      continue
    }

    // (3) committed-ref lane: validate against the fresh refMap (first live raise site).
    if (hasRef) {
      const ref = String(draft[group.refKey])
      if (!(ref in screenState.refMap)) {
        return fail(groundingError.refNotInSnapshot(toolName, ref), attempts)
      }
      attempts.push({ stage: 'ref', outcome: 'resolved', resolvedRef: ref as Ref })
      delete draft[group.targetKey]
      continue
    }

    // (2) descriptor lane: name/near pre-validation, then the tree-search(+visual) ladder.
    const descriptor = draft[group.targetKey] as DescriptorInput
    const preflight = matchDescriptor({ descriptor, elements: screenState.elements })
    if (preflight.kind === 'rejected') {
      const problem = preflight.reason === 'name-missing' ? 'name-missing' : 'near-unsupported'
      return fail(groundingError.descriptorInvalid(toolName, problem), attempts)
    }

    const prior =
      options.prior !== undefined && options.priorElements !== undefined
        ? { target: options.prior, elements: options.priorElements }
        : undefined
    const request: RungRequest = {
      descriptor,
      elements: screenState.elements,
      refMap: screenState.refMap as Record<Ref, unknown>,
      prior,
    }
    const outcome = runLadder(descriptorLadder(options), request)
    attempts.push(...outcome.attempts)

    if (outcome.ambiguous !== undefined) {
      return fail(
        groundingError.descriptorAmbiguous(toolName, renderDescriptor(descriptor), outcome.ambiguous.length),
        attempts,
      )
    }
    if (outcome.resolvedRef === undefined) {
      return fail(
        groundingError.descriptorUnresolved(toolName, renderDescriptor(descriptor)),
        attempts,
      )
    }

    draft[group.refKey] = outcome.resolvedRef
    delete draft[group.targetKey]
  }

  // (4) coordinate lane: coordSpace-aware bounds check (first live raise site).
  const coordError = coordBoundsError(toolName, draft, screenState)
  if (coordError !== undefined) return fail(coordError, attempts)

  const descriptor = toGroundedLocator(draft as unknown as Action, screenState.elements) ?? undefined
  return { ok: true, action: draft, attempts, descriptor }
}
