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

import type { ClipboardEvidence, DownloadEvidence } from '@vostride/agent-qa-schema'
import type { ActionResult } from '../platform.js'

/** EXEC-01 fill re-read verdict block. Byte-pinned to the 358 oracle/classifier readers. */
export interface FillRereadMeta {
  expected: string
  actual: string
}

/** What ended a scroll: the target appeared, the swipe budget ran out, or a boundary signal. */
export type ScrollEndedBy = 'target-visible' | 'max-swipes' | 'boundary'

/** Outcomes new runs write (436-02, D-24). */
export const SCROLL_OUTCOMES_WRITTEN = ['found', 'not-found', 'unresolved'] as const
/** Outcomes only pre-436 runs wrote; still read so persisted metadata stays parseable (D-17). */
export const SCROLL_OUTCOMES_READ_ONLY = ['no-change', 'cap'] as const

const SCROLL_ENDED_BY: readonly ScrollEndedBy[] = ['target-visible', 'max-swipes', 'boundary']

/** EXEC-02 scroll outcome block. `endedBy` is absent on pre-436 metadata. */
export interface ScrollUntilVisibleMeta {
  swipes: number
  reversedOnce: boolean
  outcome:
    | (typeof SCROLL_OUTCOMES_WRITTEN)[number]
    | (typeof SCROLL_OUTCOMES_READ_ONLY)[number]
  endedBy?: ScrollEndedBy
}

/** EXEC-03 openApp resolution block. */
export interface OpenAppMeta {
  resolvedId: string
  matchKind: 'exact' | 'fuzzy' | 'explicit'
}

// EXEC-04 idempotent no-op block: one definition, in schema, so the dashboard reads it too (437 D-05).
export type { IdempotentNoopMeta } from '@vostride/agent-qa-schema'
export { readIdempotentNoopMeta } from '@vostride/agent-qa-schema'

export function readFillRereadMeta(actionResult?: ActionResult): FillRereadMeta | undefined {
  const raw = actionResult?.metadata?.['fillReread']
  if (raw && typeof raw === 'object' && 'expected' in raw && 'actual' in raw) {
    const { expected, actual } = raw as Record<string, unknown>
    if (typeof expected === 'string' && typeof actual === 'string') return { expected, actual }
  }
  return undefined
}

export function readScrollUntilVisibleMeta(
  actionResult?: MetadataCarrier,
): ScrollUntilVisibleMeta | undefined {
  const raw = actionResult?.metadata?.['scrollUntilVisible']
  if (raw && typeof raw === 'object' && 'swipes' in raw && 'reversedOnce' in raw && 'outcome' in raw) {
    const { swipes, reversedOnce, outcome, endedBy } = raw as Record<string, unknown>
    const outcomes: readonly unknown[] = [...SCROLL_OUTCOMES_WRITTEN, ...SCROLL_OUTCOMES_READ_ONLY]
    if (
      typeof swipes === 'number' &&
      typeof reversedOnce === 'boolean' &&
      outcomes.includes(outcome)
    ) {
      const meta: ScrollUntilVisibleMeta = {
        swipes,
        reversedOnce,
        outcome: outcome as ScrollUntilVisibleMeta['outcome'],
      }
      if (endedBy === undefined) return meta
      if ((SCROLL_ENDED_BY as readonly unknown[]).includes(endedBy)) {
        return { ...meta, endedBy: endedBy as ScrollEndedBy }
      }
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

// ---------------------------------------------------------------------------
// AUTO-18 text-input blocks. Same law: one block per key, defensive readers that narrow by
// presence, typeof and closed-set membership. Neither block ever carries typed text or a
// field value.
// ---------------------------------------------------------------------------

/** Typed refusal of a fill/clearText before any text was typed. Keyed `fillRefusal`. */
export interface FillRefusalMeta {
  verb: 'fill' | 'clearText'
  cause: 'not-editable' | 'target-not-found'
  evidence: 'no-editable-signal' | 'no-keyboard-focus' | 'focus-elsewhere' | 'stale-target'
}

/** Whether a requested submit key was sent after a fill. Keyed `fillSubmit`. */
export interface FillSubmitMeta {
  sent: boolean
  reason?: 'multi-line-field'
}

const FILL_REFUSAL_VERBS = new Set<FillRefusalMeta['verb']>(['fill', 'clearText'])
const FILL_REFUSAL_CAUSES = new Set<FillRefusalMeta['cause']>(['not-editable', 'target-not-found'])
const FILL_REFUSAL_EVIDENCE = new Set<FillRefusalMeta['evidence']>([
  'no-editable-signal',
  'no-keyboard-focus',
  'focus-elsewhere',
  'stale-target',
])

function isMember<T extends string>(set: ReadonlySet<T>, value: unknown): value is T {
  return typeof value === 'string' && set.has(value as T)
}

export function readFillRefusalMeta(actionResult?: MetadataCarrier): FillRefusalMeta | undefined {
  const raw = actionResult?.metadata?.['fillRefusal']
  if (raw && typeof raw === 'object' && 'verb' in raw && 'cause' in raw && 'evidence' in raw) {
    const { verb, cause, evidence } = raw as Record<string, unknown>
    if (
      isMember(FILL_REFUSAL_VERBS, verb) &&
      isMember(FILL_REFUSAL_CAUSES, cause) &&
      isMember(FILL_REFUSAL_EVIDENCE, evidence)
    ) {
      return { verb, cause, evidence }
    }
  }
  return undefined
}

export function readFillSubmitMeta(actionResult?: MetadataCarrier): FillSubmitMeta | undefined {
  const raw = actionResult?.metadata?.['fillSubmit']
  if (raw && typeof raw === 'object' && 'sent' in raw) {
    const { sent, reason } = raw as Record<string, unknown>
    if (typeof sent !== 'boolean') return undefined
    if (reason === undefined) return { sent }
    if (reason === 'multi-line-field') return { sent, reason }
  }
  return undefined
}

// ---------------------------------------------------------------------------
// 436 D-19/D-22: the download capture a platform adapter attached to the action that started it.
// Keyed `download`: an ordered array, one entry per download in start order. An entry that does
// not narrow is dropped; the whole block reads undefined when nothing narrows.
// ---------------------------------------------------------------------------

const DOWNLOAD_STATES = new Set<DownloadEvidence['state']>(['completed', 'failed', 'canceled', 'unfinished'])

function readDownloadEntry(raw: unknown): DownloadEvidence | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const { suggestedFilename, extension, size, sha256, state, failure, late } = raw as Record<string, unknown>
  if (typeof suggestedFilename !== 'string' || typeof extension !== 'string') return undefined
  if (!isMember(DOWNLOAD_STATES, state)) return undefined
  const entry: DownloadEvidence = { suggestedFilename, extension, state }
  if (state === 'completed') {
    if (typeof size !== 'number' || typeof sha256 !== 'string') return undefined
    entry.size = size
    entry.sha256 = sha256
  }
  if (typeof failure === 'string') entry.failure = failure
  if (late === true) entry.late = true
  return entry
}

export function readDownloadMeta(actionResult?: MetadataCarrier): DownloadEvidence[] | undefined {
  const raw = actionResult?.metadata?.['download']
  if (!Array.isArray(raw)) return undefined
  const entries = raw.map(readDownloadEntry).filter((entry): entry is DownloadEvidence => entry !== undefined)
  return entries.length > 0 ? entries : undefined
}

// ---------------------------------------------------------------------------
// 436 D-21/D-22: the clipboard text the app wrote during the action, keyed `clipboard`, one entry
// per write in order. The adapter has no masker, so the text is raw here: the loop masks it and
// bounds it to CLIPBOARD_TEXT_LIMIT before anything records, emits or renders it.
// ---------------------------------------------------------------------------

/** The most masked clipboard text one write keeps; longer text is cut and marked. */
export const CLIPBOARD_TEXT_LIMIT = 2000
export const CLIPBOARD_TRUNCATION_MARKER = '…[truncated]'

export type ClipboardWriteMeta = Pick<ClipboardEvidence, 'source' | 'text' | 'readBack'>

const CLIPBOARD_SOURCES = new Set<ClipboardEvidence['source']>(['writeText', 'write', 'copy-event'])
const CLIPBOARD_READ_BACKS = new Set<ClipboardEvidence['readBack']>(['matched', 'mismatched', 'unavailable'])

function readClipboardEntry(raw: unknown): ClipboardWriteMeta | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const { source, text, readBack } = raw as Record<string, unknown>
  if (typeof text !== 'string') return undefined
  if (!isMember(CLIPBOARD_SOURCES, source) || !isMember(CLIPBOARD_READ_BACKS, readBack)) return undefined
  return { source, text, readBack }
}

export function readClipboardMeta(actionResult?: MetadataCarrier): ClipboardWriteMeta[] | undefined {
  const raw = actionResult?.metadata?.['clipboard']
  if (!Array.isArray(raw)) return undefined
  const entries = raw.map(readClipboardEntry).filter((entry): entry is ClipboardWriteMeta => entry !== undefined)
  return entries.length > 0 ? entries : undefined
}
