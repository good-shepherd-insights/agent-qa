// Typed metadata contracts for the four EXEC compound behaviors (Phase 359 · D-04).
//
// CRITICAL: provider-neutral + storage-neutral. No browser/mobile driver imports, no node:*
// imports, no core/model/adapter package imports. This is the single vocabulary Plans 05-08
// mint onto ActionResult.metadata and the 358 oracle/classifier consume via signal-presence
// degradation. Each block rides the existing ActionResult.metalabelled by its own key — no
// ActionResult break (schema-DTO promotion is deferred to Phase 361).
//
// The readers mirror oracle.ts's private readFillReread defensive guard byte-for-byte:
// presence + typeof checks, undefined otherwise. FillRereadMeta fields are pinned to the
// 358 seam — `{ expected, actual }`, both string — and MUST NOT be renamed or nested.

import type { ActionResult } from '../platform.js'

/** EXEC-01 fill re-read verdict block. Byte-pinned to the 358 oracle/classifier readers. */
export interface FillRereadMeta {
  expected: string
  actual: string
}

/** EXEC-02 scroll-until-visible outcome block. */
export interface ScrollUntilVisibleMeta {
  swipes: number
  reversedOnce: boolean
  outcome: 'found' | 'no-change' | 'cap'
}

/** EXEC-03 openApp resolution block. */
export interface OpenAppMeta {
  resolvedId: string
  matchKind: 'exact' | 'fuzzy' | 'explicit'
}

/** EXEC-04 idempotent no-op block. */
export interface IdempotentNoopMeta {
  currentState: string
}

export function readFillRereadMeta(actionResult?: ActionResult): FillRereadMeta | undefined {
  const raw = actionResult?.metadata?.['fillReread']
  if (raw && typeof raw === 'object' && 'expected' in raw && 'actual' in raw) {
    const { expected, actual } = raw as Record<string, unknown>
    if (typeof expected === 'string' && typeof actual === 'string') return { expected, actual }
  }
  return undefined
}

export function readScrollUntilVisibleMeta(
  actionResult?: ActionResult,
): ScrollUntilVisibleMeta | undefined {
  const raw = actionResult?.metadata?.['scrollUntilVisible']
  if (raw && typeof raw === 'object' && 'swipes' in raw && 'reversedOnce' in raw && 'outcome' in raw) {
    const { swipes, reversedOnce, outcome } = raw as Record<string, unknown>
    if (
      typeof swipes === 'number' &&
      typeof reversedOnce === 'boolean' &&
      (outcome === 'found' || outcome === 'no-change' || outcome === 'cap')
    ) {
      return { swipes, reversedOnce, outcome }
    }
  }
  return undefined
}

export function readOpenAppMeta(actionResult?: ActionResult): OpenAppMeta | undefined {
  const raw = actionResult?.metadata?.['openApp']
  if (raw && typeof raw === 'object' && 'resolvedId' in raw && 'matchKind' in raw) {
    const { resolvedId, matchKind } = raw as Record<string, unknown>
    if (
      typeof resolvedId === 'string' &&
      (matchKind === 'exact' || matchKind === 'fuzzy' || matchKind === 'explicit')
    ) {
      return { resolvedId, matchKind }
    }
  }
  return undefined
}

export function readIdempotentNoopMeta(
  actionResult?: ActionResult,
): IdempotentNoopMeta | undefined {
  const raw = actionResult?.metadata?.['idempotentNoop']
  if (raw && typeof raw === 'object' && 'currentState' in raw) {
    const { currentState } = raw as Record<string, unknown>
    if (typeof currentState === 'string') return { currentState }
  }
  return undefined
}

// ---------------------------------------------------------------------------
// Phase 360 termination-verb & AI-assertion metadata blocks (EXEC-05/EXEC-07 ·
// D-01/D-03/D-04/D-05/D-10/D-16). Same law as the 359 blocks above: each mint rides
// ActionResult.metadata under its own verb-named key; the reader narrows structurally and
// returns undefined on any shape miss. Plan 08 defines the vocabulary; the dispatch seam
// (Plan 10) mints onto it and the 358 oracle / short-circuit read it defensively.
// ---------------------------------------------------------------------------

/** EXEC-05 reportValue answer block (D-01/D-03). Keyed `reportedValue`. */
export interface ReportedValueMeta {
  value: string
}

/** EXEC-06 uniqueValue mint block (D-16). Keyed `uniqueValue`. */
export interface UniqueValueMeta {
  value: string
  prefix: string
}

/** EXEC-07 AI-judgment block (D-05/D-06/D-07/D-09). Keyed `aiJudgment`. */
export interface AiJudgmentMeta {
  verb: 'assertAI' | 'extractAI'
  verdict?: boolean
}

/** EXEC-07 assertValue outcome block (D-10/D-11). Keyed `assertValueOutcome`. */
export interface AssertValueOutcomeMeta {
  source: string
  op: string
  passed: boolean
  expected?: string
  actual?: string | null
}

/**
 * The minimal structural input the 360 metadata readers narrow: any ActionResult-like carrier of a
 * metadata bag. Broader than `ActionResult` so the seam's loosely-typed sub-action result surfaces
 * (which only guarantee an optional `metadata`) narrow cleanly — the defensive idiom returns
 * undefined on any shape miss regardless.
 */
type MetadataCarrier = { metadata?: Record<string, unknown> }

export function readReportedValueMeta(actionResult?: MetadataCarrier): ReportedValueMeta | undefined {
  const raw = actionResult?.metadata?.['reportedValue']
  if (raw && typeof raw === 'object' && 'value' in raw) {
    const { value } = raw as Record<string, unknown>
    if (typeof value === 'string') return { value }
  }
  return undefined
}

export function readUniqueValueMeta(actionResult?: MetadataCarrier): UniqueValueMeta | undefined {
  const raw = actionResult?.metadata?.['uniqueValue']
  if (raw && typeof raw === 'object' && 'value' in raw && 'prefix' in raw) {
    const { value, prefix } = raw as Record<string, unknown>
    if (typeof value === 'string' && typeof prefix === 'string') return { value, prefix }
  }
  return undefined
}

export function readAiJudgmentMeta(actionResult?: MetadataCarrier): AiJudgmentMeta | undefined {
  const raw = actionResult?.metadata?.['aiJudgment']
  if (raw && typeof raw === 'object' && 'verb' in raw) {
    const { verb, verdict } = raw as Record<string, unknown>
    if (verb === 'assertAI' || verb === 'extractAI') {
      return typeof verdict === 'boolean' ? { verb, verdict } : { verb }
    }
  }
  return undefined
}

export function readAssertValueOutcomeMeta(
  actionResult?: MetadataCarrier,
): AssertValueOutcomeMeta | undefined {
  const raw = actionResult?.metadata?.['assertValueOutcome']
  if (raw && typeof raw === 'object' && 'source' in raw && 'op' in raw && 'passed' in raw) {
    const { source, op, passed, expected, actual } = raw as Record<string, unknown>
    if (typeof source === 'string' && typeof op === 'string' && typeof passed === 'boolean') {
      const meta: AssertValueOutcomeMeta = { source, op, passed }
      if (typeof expected === 'string') meta.expected = expected
      if (typeof actual === 'string' || actual === null) meta.actual = actual
      return meta
    }
  }
  return undefined
}
