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
