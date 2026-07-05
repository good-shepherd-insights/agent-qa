// W=5 revisitation window + combined intervention rule (Phase 358 · CYCLE-03 · Pattern 4 ·
// Pitfall 4).
//
// CRITICAL: provider-neutral + storage-neutral. No Node builtin imports, no fs/sharp, no
// core/model/adapter package imports — a pure sliding-window structure, testable without the
// loop, keeping `validate:arch` green.
//
// SPEC-LOCKED (D-10, not re-decided): the revisitation key = the settle hash + the semantic
// component (url/route on web, activity/screen id on mobile). This module keys on
// `state.url ?? ''`.
//
// OPEN-Q1 DEGRADATION: Android-native states carry no url, so the key degrades to hash-only.
// The combined rule keeps that safe — a hash-only key only ever flags when the window ALSO
// shows zero confirmed progress, so hash quantization collisions (Pitfall 4) across
// genuinely-different pages never trip while real work is happening. Phase 359's adapter lane
// enriches the mobile key with the activity/screen id.
//
// COMBINED RULE: NEVER intervene on repetition alone. A cycle is flagged ONLY when a key is
// REVISITED within the window AND no record in the window carries confirmed task progress.
//
// HISTORY SCOPE: a fresh window per step (Claude's-discretion pick). A `RevisitationWindow`
// instance is the per-step bookkeeping; the loop constructs one per step, satisfying the
// binding sanity pair (delete-all-10 completes; open-menu→close-menu forever stops) without
// leaking revisitation state across step boundaries.

import type { ScreenState } from '@vostride/agent-qa-schema'

/**
 * The config-free revisitation window size (§12.16). Internal constant; injectable via the
 * constructor for tests only. Do NOT promote to user-facing config or thread through
 * LoopPorts / any config schema.
 */
export const DEFAULT_REVISITATION_WINDOW = 5

// Separator joining the settle hash and the semantic component. Printable and unlikely to
// occur inside a hash or url.
const KEY_SEP = '::'

/**
 * Build the revisitation key: settle hash + the semantic component (`state.url ?? ''`).
 * Same hash + different urls ⇒ different keys; a urless (Android-native) state degrades to
 * hash-only (Open Q1), still containing the hash.
 */
export function buildRevisitationKey(hash: string, state: ScreenState): string {
  return `${hash}${KEY_SEP}${state.url ?? ''}`
}

export interface RevisitationRecord {
  /** The revisitation key for this iteration (see {@link buildRevisitationKey}). */
  key: string
  /** True ⇒ this iteration confirmed task progress (a local effect or predicate movement). */
  progress: boolean
}

export interface RevisitationResult {
  /** True ⇒ combined rule tripped: key revisited within the window AND zero in-window progress. */
  flagged: boolean
}

export interface RevisitationWindowOptions {
  window?: number
}

export class RevisitationWindow {
  private readonly window: number
  private readonly history: RevisitationRecord[] = []

  constructor(options: RevisitationWindowOptions = {}) {
    this.window = options.window ?? DEFAULT_REVISITATION_WINDOW
  }

  /**
   * Record one iteration and evaluate the combined rule against the trailing W-window.
   * Flags only when the just-recorded key recurs within the window AND no record in the
   * window confirms progress — never on repetition alone.
   */
  record(entry: RevisitationRecord): RevisitationResult {
    this.history.push({ key: entry.key, progress: entry.progress })
    if (this.history.length > this.window) this.history.shift()

    const occurrences = this.history.filter((r) => r.key === entry.key).length
    const revisited = occurrences > 1
    const anyProgress = this.history.some((r) => r.progress)
    return { flagged: revisited && !anyProgress }
  }
}
