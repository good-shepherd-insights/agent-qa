// The committed quarantine ledger: read, pure state fold, egress-checkpointed append
// (Phase 390, D-01/D-03/D-04/D-11).
//
// `quarantine.jsonl` sits DIRECTLY under the committed knowledge root as its OWN top-level
// artifact beside memory/ and policies/. It is the FIRST committed top-level operational artifact
// — there is no sibling precedent to copy (the build-tag ordinal map lives under the gitignored
// runtime root), so its placement is reconciled against the knowledge-store layout deliberately:
// none of the root ignore rules (memory/index, memory/queue, the lease and epoch markers,
// **/artifacts, skills/.staging) match this filename, which is pinned by a test.
//
// READ POSTURE — refusal as data, never healing to absence. The derived run-outcome projection
// heals malformed bytes to an empty window because it is a rebuildable derivation. This file is
// COMMITTED TRUTH that humans may hand-edit (D-12), and healing a quarantine entry to absent
// silently UN-quarantines a test — the exact silent flip this phase exists to prevent. So a line
// that fails to parse or fails the shape guard is REFUSED and surfaced in `refusedLines`, while
// its neighbours still fold. A line declaring a NEWER schemaVersion propagates the typed
// QuarantineLedgerVersionError: a build that cannot read the truth must not guess at it.
//
// WALL-CLOCK PURITY — the fold takes `now` as an argument and this module reads no clock. `at` and
// `expiresAt` are stamped by callers at write time (D-11). That is what lets expiry boundaries be
// pinned one second either side with no flake.
//
// WRITE POSTURE — fail-closed and audited. Every append passes the committed-egress checkpoint on
// this module's OWN channel before a byte reaches the file, and a detector refusal comes back as
// DATA (never a bare catch, never a throw the caller has to guess at). Quarantine events are
// CODE-authored — threshold crossings, auto-exits, the gated verbs — never model output, which is
// why CTX-FUT-01's propose-only posture deliberately does not bind these writes (D-04; the dated
// posture note lands in REQUIREMENTS.md).
//
// SERIALIZATION is POSITIONAL, and that nuance matters: this module holds no lock of its own. Its
// callers — the post-run fold and the gated quarantine verbs — already execute inside the MRSW
// writer-lease scope with epoch fencing, so appends serialize because of WHERE they are called
// from, not because anything here enforces it. A future caller outside that scope would need to
// take the lease itself; the guarantee is the call site's.
//
// IDENTITY — entries are keyed by `(product, filePath, testName)`, never `testId`.

import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  CommittedEgressBlockedError,
  assertCommittedEgressSafe,
  defaultGuardrailPolicyInput,
  loadGuardrailPolicy,
} from '@vostride/agent-qa-safety'
import { JsonlAuditSink } from '@vostride/agent-qa-safety-local'
import { canonicalJson, guardQuarantineLedgerEvent } from '@vostride/agent-qa-schema'
import type { GuardrailPolicy } from '@vostride/agent-qa-schema'
import type {
  QuarantineEntryState,
  QuarantineEntryStateName,
  QuarantineLedgerEvent,
  QuarantineOwner,
} from '@vostride/agent-qa-schema'

/** The ledger's fixed name directly under the committed knowledge root — never caller-supplied. */
export const QUARANTINE_LEDGER_FILENAME = 'quarantine.jsonl'

/** One line the read refused, surfaced as data so a caller can print or audit it. */
export interface RefusedQuarantineLine {
  /** 1-based, so it matches what an editor shows the human who has to fix the file. */
  lineNumber: number
  reason: string
}

export interface QuarantineLedgerRead {
  events: readonly QuarantineLedgerEvent[]
  refusedLines: readonly RefusedQuarantineLine[]
}

/** The ledger's absolute path under one knowledge root. */
export function quarantineLedgerPath(knowledgeRoot: string): string {
  return join(knowledgeRoot, QUARANTINE_LEDGER_FILENAME)
}

/**
 * Read every event the committed ledger carries, in file order.
 *
 * A missing ledger is an EMPTY ledger — no test is quarantined and run behavior is byte-identical
 * to pre-390 (the FLAK-03 empty-input edge). Blank lines are skipped silently; they are whitespace,
 * not damage. Everything else that fails is refused and reported.
 *
 * Throws {@link QuarantineLedgerVersionError} (typed) when a line declares a schemaVersion this
 * build cannot consume — committed truth hard-fails rather than degrading silently.
 */
export function readQuarantineLedger(knowledgeRoot: string): QuarantineLedgerRead {
  let text: string
  try {
    text = readFileSync(quarantineLedgerPath(knowledgeRoot), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { events: [], refusedLines: [] }
    }
    throw error
  }

  const events: QuarantineLedgerEvent[] = []
  const refusedLines: RefusedQuarantineLine[] = []

  const lines = text.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (line.trim().length === 0) continue

    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch (error) {
      refusedLines.push({
        lineNumber: index + 1,
        reason: `unparseable line: ${error instanceof Error ? error.message : String(error)}`,
      })
      continue
    }

    // The version guard's own reject-newer arm must propagate; only its structural rejection
    // folds to a refusal. Distinguishing them keeps a build-level "cannot read this truth at all"
    // apart from a line-level "this one record is damaged".
    let event: QuarantineLedgerEvent
    try {
      event = guardQuarantineLedgerEvent(parsed)
    } catch (error) {
      if (error instanceof TypeError) {
        refusedLines.push({ lineNumber: index + 1, reason: error.message })
        continue
      }
      throw error
    }
    events.push(event)
  }

  return { events, refusedLines }
}

interface MutableEntry {
  product: string
  filePath: string
  testName: string
  fingerprint: string
  verdictClass: QuarantineEntryState['verdictClass']
  owner: QuarantineOwner
  enteredAt: string
  expiresAt: string
  /** The state the EVENTS put the entry in; expiry is applied against `now` afterwards. */
  eventState: 'quarantined' | 'released'
}

function entryKey(event: {
  product: string
  filePath: string
  testName: string
}): string {
  return JSON.stringify([event.product, event.filePath, event.testName])
}

/**
 * Fold the event log into current per-entry state. PURE — identical `(events, now)` inputs answer
 * identically, and no clock is read.
 *
 * Per key, in event order: `entered` opens (or re-opens — D-10's re-entry needs no special rule,
 * the sliding window self-heals) a window carrying owner/expiry/fingerprint/class; `renewed`
 * extends the expiry and claims the owner when one is supplied; either released kind closes it.
 *
 * `'expired'` is then COMPUTED, never read from an event: an open window whose `expiresAt` is at or
 * before `now` answers `'expired'`. Its suppression has stopped — the test fails builds again — but
 * the entry stays LISTED, renewable and releasable. That is the forcing function that makes
 * quarantine a lifecycle rather than a graveyard (D-11).
 *
 * `now` is an ISO-8601 instant, compared on the same scale the events are stamped on.
 */
export function foldQuarantineLedgerState(
  events: readonly QuarantineLedgerEvent[],
  now: string,
): QuarantineEntryState[] {
  const entries = new Map<string, MutableEntry>()

  for (const event of events) {
    const key = entryKey(event)
    switch (event.kind) {
      case 'entered':
        entries.set(key, {
          product: event.product,
          filePath: event.filePath,
          testName: event.testName,
          fingerprint: event.fingerprint,
          verdictClass: event.verdictClass,
          owner: event.owner,
          enteredAt: event.at,
          expiresAt: event.expiresAt,
          eventState: 'quarantined',
        })
        break
      case 'renewed': {
        const existing = entries.get(key)
        // A renewal with no window to renew is meaningless — refusing to synthesize one keeps the
        // fold honest about what the log actually says (no invented entries reach any surface).
        if (existing === undefined) break
        existing.expiresAt = event.expiresAt
        if (event.owner !== undefined) existing.owner = event.owner
        existing.eventState = 'quarantined'
        break
      }
      case 'released-manual':
      case 'released-auto': {
        const existing = entries.get(key)
        if (existing === undefined) break
        existing.eventState = 'released'
        break
      }
    }
  }

  const nowMs = Date.parse(now)
  return [...entries.values()].map((entry) => {
    let state: QuarantineEntryStateName = entry.eventState
    if (state === 'quarantined') {
      const expiresMs = Date.parse(entry.expiresAt)
      // An unparseable deadline is treated as lapsed: the failing test fails builds again, which is
      // the safe direction. Silently suppressing forever on a mangled date is the one outcome D-11
      // exists to make impossible.
      if (Number.isNaN(expiresMs) || expiresMs <= nowMs) state = 'expired'
    }
    return {
      product: entry.product,
      filePath: entry.filePath,
      testName: entry.testName,
      fingerprint: entry.fingerprint,
      verdictClass: entry.verdictClass,
      owner: entry.owner,
      enteredAt: entry.enteredAt,
      expiresAt: entry.expiresAt,
      state,
    }
  })
}

/**
 * The ledger's own committed-egress channel (D-04). Distinct from the bundle channel so an audit
 * row says which committed surface a refusal came from without anyone having to infer it.
 */
export const QUARANTINE_LEDGER_EGRESS_CHANNEL = 'quarantine-ledger'

export interface QuarantineAppendOptions {
  policy?: GuardrailPolicy
  /** Explicit audit location; nothing silently resolves into a working directory. */
  auditBaseDir: string
}

/**
 * What an append answers. `'egress-blocked'` is a VALUE, not an exception: a guardrail refusal is
 * information the caller surfaces (the drain tail logs it), and the alternative — a throw inside a
 * fold whose failures are already swallowed — is how an `entered` event goes missing in silence.
 */
export type QuarantineAppendOutcome =
  | { kind: 'appended'; lines: number }
  | { kind: 'egress-blocked'; detections: readonly { label: string; detector: string }[] }

/**
 * Append lifecycle events to the committed ledger, as ONE fail-closed unit (D-04).
 *
 * Order is the whole point: serialize → checkpoint EVERY line together → only then write. Because
 * the checkpoint covers the unit, a single refused event withholds its clean siblings too, and the
 * existing file is left byte-unchanged. Partial writes are the failure mode that would leave the
 * committed truth half-updated and a reviewer unable to tell.
 *
 * Callers stamp `at` and `expiresAt` themselves (D-11): this module reads no clock, which is what
 * keeps both the write path and the fold deterministic.
 */
export function appendQuarantineEvents(
  knowledgeRoot: string,
  events: readonly QuarantineLedgerEvent[],
  opts: QuarantineAppendOptions,
): QuarantineAppendOutcome {
  if (events.length === 0) return { kind: 'appended', lines: 0 }

  const lines = events.map((event) => canonicalJson(event))
  const parts = lines.map((text, index) => ({
    label: `${QUARANTINE_LEDGER_FILENAME}#${String(index + 1)}`,
    text,
  }))

  const checkpointOpts = {
    policy: opts.policy ?? loadGuardrailPolicy(defaultGuardrailPolicyInput),
    channel: QUARANTINE_LEDGER_EGRESS_CHANNEL,
    auditSink: new JsonlAuditSink(opts.auditBaseDir),
  }

  try {
    assertCommittedEgressSafe(parts, checkpointOpts)
  } catch (error) {
    if (error instanceof CommittedEgressBlockedError) {
      return {
        kind: 'egress-blocked',
        detections: error.blocked.map(({ label, detector }) => ({ label, detector })),
      }
    }
    throw error
  }

  mkdirSync(knowledgeRoot, { recursive: true })
  appendFileSync(quarantineLedgerPath(knowledgeRoot), `${lines.join('\n')}\n`, 'utf8')
  return { kind: 'appended', lines: lines.length }
}
