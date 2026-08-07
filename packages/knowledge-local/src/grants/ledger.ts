// The committed standing-grant ledger: read, pure fold, egress-checkpointed append
// (Phase 391, D-04/D-11).
//
// `grants.jsonl` sits DIRECTLY under the committed knowledge root as its own top-level artifact
// beside memory/ and policies/, the placement `quarantine.jsonl` established. None of the root
// ignore rules — memory/index, memory/queue, the lease and epoch markers, **/artifacts,
// skills/.staging, the init temporary — matches this filename, so it is committed by default. That
// is pinned by a probe in the CLI suite against the .gitignore `agent-qa init` actually emits,
// rather than asserted here against a copy of the rules. It is ALSO a `visible` entry in the init
// verifier's own knowledge probe table, which is a second and different guarantee: unmatched is
// what the default rules do, while the probe refuses an operator's CUSTOM ignore file that hides
// the ledger — the failure that would leave approvals authorizing while showing a reviewer nothing.
//
// READ POSTURE — refusal as data, never healing to absence. This file is COMMITTED TRUTH that
// humans may hand-edit, and healing a malformed line to absent could silently drop a REVOKE, which
// would leave an approval standing that somebody already withdrew. So a line that fails to parse or
// fails the shape guard is REFUSED and surfaced in `refusedLines`, while its neighbours still fold.
// A line declaring a NEWER schemaVersion propagates the typed GrantLedgerVersionError: a build that
// cannot read the authorization truth must not guess at it, and the safe direction of that refusal
// is a gate that grants nothing.
//
// WALL-CLOCK PURITY — the fold takes no clock and this module reads none. `at` is stamped by
// callers at write time. A grant has no expiry in 391 (see the schema module head), so the fold is
// a pure function of the event sequence alone.
//
// WRITE POSTURE — fail-closed and audited, on TWO gates in a fixed order. Every append pre-checks
// each event against BOTH legs the READ's guard ranges — the VERSION IDENTITY and schema's
// `hasGrantEventShape` — and then passes the committed-egress checkpoint on this module's OWN
// channel; only after all of it does a byte reach the file. The two gates answer different
// questions and answer them differently: the pre-check asks whether the line can ever be read back
// and THROWS (authoring an unreadable line into a committed artifact is a caller bug, and the
// damage is permanent and unlistable), while the egress one asks whether the line leaks a secret
// and comes back as DATA (a guardrail refusal is information a surface renders, not an exception a
// caller has to guess at).
//
// SERIALIZATION belongs to NAMED callers and this module is not one of them — it holds no lock. The
// grant-minting and revoking verbs take the writer lease around their whole read-decide-append
// cycle, the same posture the quarantine verbs adopted. A caller added outside those paths would be
// unserialized and would have to take the lease itself. SHAPE AND VERSION, by contrast, are closed
// AT THIS SEAM for every caller present and future, which is why they live here and not there.
//
// WHY THE APPEND IS PUBLISHED ON THE BARREL and the quarantine one is not: quarantine's three
// writers all live inside this package, so withholding it cost nobody anything. A grant is minted
// by the function layer's accept-with-always decision, which is in `agent`, so the write surface
// has to cross the package boundary. It crosses it through this one checked function rather than
// through raw file access.

import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  CommittedEgressBlockedError,
  assertCommittedEgressSafe,
  defaultGuardrailPolicyInput,
  loadGuardrailPolicy,
} from '@vostride/agent-qa-safety'
import { JsonlAuditSink } from '@vostride/agent-qa-safety-local'
import {
  CURRENT_GRANT_LEDGER_SCHEMA_VERSION,
  canonicalJson,
  guardGrantLedgerEvent,
  hasGrantEventShape,
} from '@vostride/agent-qa-schema'
import type {
  ActiveStandingGrant,
  GrantLedgerEvent,
  GuardrailPolicy,
} from '@vostride/agent-qa-schema'

/** The ledger's fixed name directly under the committed knowledge root — never caller-supplied. */
export const GRANT_LEDGER_FILENAME = 'grants.jsonl'

/** One line the read refused, surfaced as data so a caller can print or audit it. */
export interface RefusedGrantLine {
  /** 1-based, so it matches what an editor shows the human who has to fix the file. */
  lineNumber: number
  reason: string
}

export interface GrantLedgerRead {
  events: readonly GrantLedgerEvent[]
  refusedLines: readonly RefusedGrantLine[]
}

/** The ledger's absolute path under one knowledge root. */
export function grantsLedgerPath(knowledgeRoot: string): string {
  return join(knowledgeRoot, GRANT_LEDGER_FILENAME)
}

/**
 * Read every event the committed ledger carries, in file order.
 *
 * A missing ledger is an EMPTY ledger — no standing approval exists and every ask resolves the way
 * it did before any grant was ever recorded. Blank lines are skipped silently; they are whitespace,
 * not damage. Everything else that fails is refused and reported.
 *
 * Throws {@link GrantLedgerVersionError} (typed) when a line declares a schemaVersion this build
 * cannot consume — committed truth hard-fails rather than degrading silently.
 */
export function readGrantLedger(knowledgeRoot: string): GrantLedgerRead {
  let text: string
  try {
    text = readFileSync(grantsLedgerPath(knowledgeRoot), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { events: [], refusedLines: [] }
    }
    throw error
  }

  const events: GrantLedgerEvent[] = []
  const refusedLines: RefusedGrantLine[] = []

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

    // The version guard's own reject-newer arm must propagate; only its structural rejection folds
    // to a refusal. Distinguishing them keeps a build-level "cannot read this truth at all" apart
    // from a line-level "this one record is damaged".
    let event: GrantLedgerEvent
    try {
      event = guardGrantLedgerEvent(parsed)
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

/**
 * Fold the event log into the standing approvals currently in force. PURE — identical inputs answer
 * identically, and no clock is read.
 *
 * Per grant id, IN FILE ORDER: a `grant` records the approval, and a later `revoke` removes it. The
 * order is the whole semantics — a revoke line following a grant line yields no active grant, and a
 * grant line following a revoke line for the same id yields an active one again (re-granting is
 * recording a new approval, not resurrecting an old one; the id is the caller's to choose).
 *
 * A revoke with no grant to revoke is a NO-OP arm rather than an invented entry, the same idiom the
 * sibling ledger applies to a renewal with no window: refusing to synthesize state keeps the fold
 * honest about what the log actually says, and a hand-edited file is exactly where such a line comes
 * from.
 *
 * The answer preserves first-recorded order, so a `grants.list` verb renders the ledger in the order
 * a reviewer reading the committed file would meet the approvals.
 */
export function foldActiveGrants(
  events: readonly GrantLedgerEvent[],
): ActiveStandingGrant[] {
  const active = new Map<string, ActiveStandingGrant>()

  for (const event of events) {
    switch (event.kind) {
      case 'grant': {
        active.set(event.grantId, {
          grantId: event.grantId,
          actionClass: event.actionClass,
          scope: event.scope,
          grantedAt: event.at,
          ...(event.proposalId === undefined ? {} : { proposalId: event.proposalId }),
        })
        break
      }
      case 'revoke': {
        // Absent id: nothing to withdraw, and nothing is invented in its place.
        active.delete(event.grantId)
        break
      }
    }
  }

  return [...active.values()]
}

/**
 * The ledger's own committed-egress channel (D-11). Distinct from the bundle and quarantine
 * channels so an audit row says which committed surface a refusal came from without anyone having
 * to infer it.
 */
export const GRANT_LEDGER_EGRESS_CHANNEL = 'grant-ledger'

export interface GrantAppendOptions {
  policy?: GuardrailPolicy
  /** Explicit audit location; nothing silently resolves into a working directory. */
  auditBaseDir: string
}

/**
 * What an append answers. `'egress-blocked'` is a VALUE, not an exception: a guardrail refusal is
 * information the caller surfaces to the human who tried to grant something, and a throw would make
 * that indistinguishable from a crash.
 */
export type GrantAppendOutcome =
  | { kind: 'appended'; lines: number }
  | { kind: 'egress-blocked'; detections: readonly { label: string; detector: string }[] }

/**
 * Append grant lifecycle events to the committed ledger, as ONE fail-closed unit (D-11).
 *
 * Order is the whole point: version-check and shape-check EVERY event, serialize, checkpoint EVERY
 * line together, only then write. Because both gates cover the unit, a single refused event
 * withholds its clean siblings too and the existing file is left byte-unchanged — a half-written
 * approval record is the failure mode that would leave a reviewer unable to tell what was actually
 * authorized.
 *
 * Throws a `TypeError` naming the offending index — and which leg refused — when an event would not
 * survive {@link readGrantLedger}'s own guard. This is deliberately a THROW rather than an outcome
 * arm: every arm of {@link GrantAppendOutcome} describes a write that did not happen for a reason
 * the caller can act on, whereas authoring an unreadable line is a CALLER BUG committing permanent
 * damage to a shared artifact.
 *
 * `===` on the version, not `<=`: an older-side stamp is just as unreadable as a newer one while
 * the migration registry is empty, and a non-finite number fails every ordering comparison in
 * silence. The rule widens only if a migration is ever registered, at which point it becomes CURRENT
 * plus every version carrying one — the read guard's own rule.
 *
 * Callers stamp `at` themselves: this module reads no clock, which is what keeps both the write path
 * and the fold deterministic.
 */
export function appendGrantLedgerEvents(
  knowledgeRoot: string,
  events: readonly GrantLedgerEvent[],
  opts: GrantAppendOptions,
): GrantAppendOutcome {
  if (events.length === 0) return { kind: 'appended', lines: 0 }

  // The write refuses what the read refuses, on BOTH of the read's legs. One predicate is not
  // enough on its own: `hasGrantEventShape` asserts only that `schemaVersion` is a number, while
  // the read additionally requires it to BE the current version, so every other number would slip
  // past a shape-only pre-check and land a line the reader then rejects. Both legs run before the
  // egress checkpoint and before any filesystem call, so a refused unit leaves no byte and no audit
  // row.
  for (let index = 0; index < events.length; index += 1) {
    const version = events[index]?.schemaVersion
    if (version !== CURRENT_GRANT_LEDGER_SCHEMA_VERSION) {
      throw new TypeError(
        `grant event at index ${String(index)} would be refused by the ledger read: ` +
          `schemaVersion ${String(version)} is not the current version ` +
          `${String(CURRENT_GRANT_LEDGER_SCHEMA_VERSION)} — the committed ledger must never ` +
          'carry a line no checkout can consume',
      )
    }
    if (hasGrantEventShape(events[index])) continue
    throw new TypeError(
      `grant event at index ${String(index)} would be refused by the ledger read: ` +
        'the committed ledger must never carry a line no checkout can consume',
    )
  }

  const lines = events.map((event) => canonicalJson(event))
  const parts = lines.map((text, index) => ({
    label: `${GRANT_LEDGER_FILENAME}#${String(index + 1)}`,
    text,
  }))

  const checkpointOpts = {
    policy: opts.policy ?? loadGuardrailPolicy(defaultGuardrailPolicyInput),
    channel: GRANT_LEDGER_EGRESS_CHANNEL,
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
  appendFileSync(grantsLedgerPath(knowledgeRoot), `${lines.join('\n')}\n`, 'utf8')
  return { kind: 'appended', lines: lines.length }
}
