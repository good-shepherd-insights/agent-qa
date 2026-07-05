// Per-verb intended-effect oracle (Phase 358 · CYCLE-01 · D-05/D-06 · Pattern 1).
//
// CRITICAL: provider-neutral + storage-neutral. No Node builtin imports, no fs/sharp, no
// core/model/adapter package imports — pure differential-observation logic only, so it
// tests without the loop and `validate:arch` stays green.
//
// `evaluateLocalEffect` is a PURE diff function over (action N's stateBefore, the fresh
// settled observation after N). It takes NO action-history input: byte-identical repeats
// are each judged only on their own before->after diff, so CYCLE-01's "never flag on
// repetition alone" is structural, not a heuristic.
//
// Signal-presence degradation (D-06): each verb-class row consumes only the signals present
// on its inputs (scroll offsets / visible-content delta, checkable-target subtree state, url
// change, the fill re-read annotation). A row whose per-verb signal is absent degrades to
// the hash-fallback oracle — no ordering dependency on Phase 359, and the oracle enriches
// automatically once 359's Fill re-read / scroll compound lands. The result's `oracle` field
// honestly names which row actually fired.
//
// Element identity is ALWAYS role + nameNormalized (+ same-screen ordinal) — never `ref`
// (execution detail, ElementInfo doc rule).

import type { ScreenState, ElementInfo, LocalEffectEvidence } from '@vostride/agent-qa-schema'
import type { ActionResult } from '../../platform.js'

const UNIT = ''
const REC = ''

/**
 * The element anchor identity (357 vocabulary) — role + nameNormalized + a same-screen
 * ordinal. Never `ref`/description.
 */
export interface EffectAnchor {
  role: string
  nameNormalized: string
  ordinal: number
}

/**
 * The runner-facing oracle-row vocabulary: which verb-class row produced the verdict.
 * This is the verb-class name (richer than the persisted DTO); it maps deterministically
 * to the schema `LocalEffectEvidence['oracle']` mechanism vocabulary via
 * {@link toLocalEffectEvidence} for recording.
 */
export type LocalEffectOracle = 'scroll' | 'tap' | 'navigate' | 'fill' | 'hash-fallback'

/**
 * The pure oracle outcome for one sub-action. `verbClass` is the class the row keyed on,
 * `oracle` names the row that actually fired (degrading to `hash-fallback` when the
 * per-verb signal was absent), `achieved` is the progress verdict. Shares `verbClass` and
 * `achieved` with the schema `LocalEffectEvidence`; the persisted form is produced by
 * {@link toLocalEffectEvidence}.
 */
export interface LocalEffectResult {
  verbClass: string
  oracle: LocalEffectOracle
  achieved: boolean
}

export interface EvaluateLocalEffectInput {
  /** The executed action; only `type` (+ optional url) is consumed to pick the row. */
  action: { type: string; [key: string]: unknown }
  /** The target anchor for checkable-tap resolution; absent ⇒ that row can't resolve. */
  anchor?: EffectAnchor
  stateBefore: ScreenState
  stateAfter: ScreenState
  /** screenIdentityHash(stateBefore) — the hash-fallback progress signal. */
  prevHash: string
  /** screenIdentityHash(stateAfter). */
  currentHash: string
  /** The action's execution result; the fill row probes `metadata.fillReread`. */
  actionResult?: ActionResult
}

/** Maps an action verb to its oracle row class. */
function verbClassFor(actionType: string): LocalEffectOracle | 'fallback' {
  switch (actionType) {
    case 'scroll':
      return 'scroll'
    case 'tap':
    case 'click':
    case 'longpress':
      return 'tap'
    case 'navigate':
      return 'navigate'
    case 'fill':
    case 'type':
      return 'fill'
    default:
      return 'fallback'
  }
}

// Scroll §12.12 signal: a changed visible tree is progress even with unchanged offsets
// (virtualized lists recycle rows in place). Keys on the RAW accessible name, not
// nameNormalized — normalizeAccessibleName strips trailing counters ('Row 1'->'row'), which
// is exactly the recycled content the scroll oracle must see change.
function visibleContentSet(state: ScreenState): Set<string> {
  const set = new Set<string>()
  for (const el of state.elements) set.add(el.role + UNIT + el.name)
  return set
}

function contentSetsDiffer(before: ScreenState, after: ScreenState): boolean {
  const a = visibleContentSet(before)
  const b = visibleContentSet(after)
  if (a.size !== b.size) return true
  for (const key of a) if (!b.has(key)) return true
  return false
}

// Value-inclusive change signal for the fill hash-fallback: screenIdentityHash omits
// element `value`, so a field going ''->'a@b.co' is invisible to prevHash/currentHash.
// When no re-read annotation is present, the fill row falls back to a value-aware diff so a
// landed keystroke still reads as progress.
function fieldValuesDiffer(before: ScreenState, after: ScreenState): boolean {
  const sig = (s: ScreenState): string =>
    s.elements
      .map((e) => e.role + UNIT + e.nameNormalized + UNIT + (e.value ?? ''))
      .sort()
      .join(REC)
  return sig(before) !== sig(after)
}

/** Resolve the anchor's ordinal-th role+nameNormalized match, or undefined. */
function resolveAnchor(state: ScreenState, anchor: EffectAnchor): ElementInfo | undefined {
  let seen = 0
  for (const el of state.elements) {
    if (el.role === anchor.role && el.nameNormalized === anchor.nameNormalized) {
      if (seen === anchor.ordinal) return el
      seen += 1
    }
  }
  return undefined
}

function isCheckable(el: ElementInfo): boolean {
  return el.state.checked !== undefined || el.state.selected !== undefined
}

function checkableStateChanged(before: ElementInfo, after: ElementInfo): boolean {
  return before.state.checked !== after.state.checked || before.state.selected !== after.state.selected
}

/** The row every verb degrades to when its per-verb signal is absent (D-06). */
function hashFallback(verbClass: string, prevHash: string, currentHash: string): LocalEffectResult {
  return { verbClass, oracle: 'hash-fallback', achieved: prevHash !== currentHash }
}

interface FillReread {
  expected: string
  actual: string
}

function readFillReread(actionResult?: ActionResult): FillReread | undefined {
  const raw = actionResult?.metadata?.['fillReread']
  if (raw && typeof raw === 'object' && 'expected' in raw && 'actual' in raw) {
    const { expected, actual } = raw as Record<string, unknown>
    if (typeof expected === 'string' && typeof actual === 'string') return { expected, actual }
  }
  return undefined
}

/**
 * Evaluate the executed action's local intended effect over its before->after diff,
 * returning which oracle row fired and whether the effect was achieved. Pure; no
 * action-history, no host APIs, no side effects.
 */
export function evaluateLocalEffect(input: EvaluateLocalEffectInput): LocalEffectResult {
  const { action, anchor, stateBefore, stateAfter, prevHash, currentHash, actionResult } = input
  const cls = verbClassFor(action.type)

  switch (cls) {
    case 'scroll': {
      const b = stateBefore.metadata.scroll
      const a = stateAfter.metadata.scroll
      const offsetMoved = b.offsetX !== a.offsetX || b.offsetY !== a.offsetY
      if (offsetMoved || contentSetsDiffer(stateBefore, stateAfter)) {
        return { verbClass: 'scroll', oracle: 'scroll', achieved: true }
      }
      return hashFallback('scroll', prevHash, currentHash)
    }

    case 'tap': {
      if (anchor) {
        const before = resolveAnchor(stateBefore, anchor)
        const after = resolveAnchor(stateAfter, anchor)
        // Anchored target dismissed (no longer resolvable) ⇒ the tap took effect.
        if (before && !after) return { verbClass: 'tap', oracle: 'tap', achieved: true }
        // Checkable target: the toggle state IS the signal — present ⇒ honest tap verdict.
        if (before && isCheckable(before)) {
          const changed = after ? checkableStateChanged(before, after) : true
          return { verbClass: 'tap', oracle: 'tap', achieved: changed }
        }
      }
      return hashFallback('tap', prevHash, currentHash)
    }

    case 'navigate': {
      const beforeUrl = stateBefore.url
      const afterUrl = stateAfter.url
      // No url signal on either side (Android native, Open Q1) ⇒ degrade.
      if (beforeUrl === undefined && afterUrl === undefined) {
        return hashFallback('navigate', prevHash, currentHash)
      }
      return { verbClass: 'navigate', oracle: 'navigate', achieved: beforeUrl !== afterUrl }
    }

    case 'fill': {
      const reread = readFillReread(actionResult)
      // Re-read annotation present ⇒ authoritative fill verdict (Phase 359 populates).
      if (reread) {
        return { verbClass: 'fill', oracle: 'fill', achieved: reread.expected === reread.actual }
      }
      // Degrade: value-aware fallback (identity hash omits field value).
      const achieved = prevHash !== currentHash || fieldValuesDiffer(stateBefore, stateAfter)
      return { verbClass: 'fill', oracle: 'hash-fallback', achieved }
    }

    default:
      return hashFallback(action.type, prevHash, currentHash)
  }
}

/** Row-name → schema DTO mechanism-name mapping (recording bridge, 353 D-14). */
const ORACLE_TO_EVIDENCE: Record<LocalEffectOracle, LocalEffectEvidence['oracle']> = {
  scroll: 'scroll',
  tap: 'checkable-state',
  navigate: 'navigation',
  fill: 'fill-reread',
  'hash-fallback': 'hash-fallback',
}

/**
 * Project the runner oracle result into the persisted schema `LocalEffectEvidence` DTO
 * (the §A8 recording shape). Keeps the runner row-name vocabulary honest while recording
 * the schema's mechanism vocabulary — the recording types ARE the schema DTOs (353 D-14).
 */
export function toLocalEffectEvidence(result: LocalEffectResult): LocalEffectEvidence {
  return {
    verbClass: result.verbClass,
    oracle: ORACLE_TO_EVIDENCE[result.oracle],
    achieved: result.achieved,
  }
}
