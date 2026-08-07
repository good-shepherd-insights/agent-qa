// The standing-approval reader's fail-closed posture over a DAMAGED committed ledger
// (Phase 391 plan 08, closing 391-VERIFICATION gap 2).
//
// `grants.jsonl` is committed on purpose, which means it travels through merges and through hands.
// The read already refuses a line it cannot consume and reports it as data; what this suite pins is
// that the refusal reaches the ONE consumer that authorizes. An authorization file the build cannot
// fully read is not a licence — the module head already argues exactly that direction for a version
// line, and a damaged line is the same fact arriving one grain smaller.
//
// PRECONDITION-GUARDED RULE CORPUS (the repo's own measured law). The new guard has a precondition
// — that a line was refused — so the corpus carries a case the guard REJECTS, in the SAME fixture:
//
//   case 1  intact ledger, active grant     -> grantsFor RETURNS it
//   case 2  intact ledger, grant + revoke   -> grantsFor returns [] because the REVOKE folded
//   case 3  the same two events, with the revoke line damaged in place -> grantsFor returns []
//
// Without cases 1 and 2 the third proves nothing: an empty answer would be just as well explained
// by a fixture that never recorded a grant, or by a reader that returns nothing over any file.
//
// THE DAMAGE IS APPLIED TO THE REVOKE, and that is the whole point rather than a convenience. The
// grant's own line stays byte-perfect and still folds, so what the reader refuses is the FILE and
// not the line: healing the unreadable revoke to absent is what silently resurrects a withdrawn
// approval. Case 3 asserts that fixture validity FIRST, so its fail-closed claim is attributable to
// the damage.
//
// Every event goes through the real append API. The only hand-written bytes are the corruption
// itself, which is the hand-edit the whole read posture exists for and which no producer can emit.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  CURRENT_GRANT_LEDGER_SCHEMA_VERSION,
  STANDING_APPROVAL_SCOPE,
} from '@vostride/agent-qa-schema'
import type { GrantLedgerEvent, RiskActionDescriptor } from '@vostride/agent-qa-schema'

import {
  appendGrantLedgerEvents,
  foldActiveGrants,
  grantsLedgerPath,
  readGrantLedger,
} from '../ledger.js'
import { createStandingApprovalReader } from '../reader.js'

/** A real op's class, and deliberately not a protected one — the D-05 filter must not be why. */
const ACTION_CLASS = 'fn:knowledge.proposal.apply'
const GRANT_ID = 'grant_apply_damage_case'
const GRANTED_AT = '2026-08-08T10:00:00.000Z'
const REVOKED_AT = '2026-08-08T11:00:00.000Z'

/** What a merge leaves behind when two branches both appended: a marker fused onto a real line. */
const CONFLICT_MARKER = '<<<<<<< HEAD'

function action(name: string): RiskActionDescriptor {
  return { name, recognized: true }
}

const GRANT_EVENT: GrantLedgerEvent = {
  schemaVersion: CURRENT_GRANT_LEDGER_SCHEMA_VERSION,
  kind: 'grant',
  at: GRANTED_AT,
  grantId: GRANT_ID,
  actionClass: ACTION_CLASS,
  scope: STANDING_APPROVAL_SCOPE,
}

const REVOKE_EVENT: GrantLedgerEvent = {
  schemaVersion: CURRENT_GRANT_LEDGER_SCHEMA_VERSION,
  kind: 'revoke',
  at: REVOKED_AT,
  grantId: GRANT_ID,
}

describe('createStandingApprovalReader over a damaged committed ledger', () => {
  let knowledgeRoot: string

  beforeEach(() => {
    knowledgeRoot = mkdtempSync(join(tmpdir(), 'grant-reader-damage-'))
  })

  afterEach(() => {
    rmSync(knowledgeRoot, { recursive: true, force: true })
  })

  function append(events: readonly GrantLedgerEvent[]): void {
    const outcome = appendGrantLedgerEvents(knowledgeRoot, events, {
      auditBaseDir: join(knowledgeRoot, '.audit'),
    })
    if (outcome.kind !== 'appended') throw new Error(`fixture append failed: ${outcome.kind}`)
  }

  /**
   * Fuse a conflict marker onto the LAST committed line, in place.
   *
   * Rewritten rather than appended: a whole extra garbage line would leave the revoke perfectly
   * readable, and then the refusal under test would be about a line nothing depends on.
   */
  function damageLastLine(): void {
    const path = grantsLedgerPath(knowledgeRoot)
    const lines = readFileSync(path, 'utf8').split('\n')
    let last = lines.length - 1
    while (last >= 0 && (lines[last] ?? '').trim().length === 0) last -= 1
    if (last < 0) throw new Error('the fixture ledger has no line to damage')
    lines[last] = `${CONFLICT_MARKER}${lines[last] ?? ''}`
    writeFileSync(path, lines.join('\n'), 'utf8')
  }

  it('CASE 1 — intact ledger, active grant: the approval comes back', () => {
    append([GRANT_EVENT])

    expect(readGrantLedger(knowledgeRoot).refusedLines).toEqual([])
    const reader = createStandingApprovalReader({ knowledgeRoot })
    expect(reader.grantsFor(action(ACTION_CLASS), STANDING_APPROVAL_SCOPE)).toEqual([
      { actionClass: ACTION_CLASS, scope: STANDING_APPROVAL_SCOPE },
    ])
  })

  it('CASE 2 — intact ledger, the revoke folded: nothing comes back', () => {
    append([GRANT_EVENT])
    append([REVOKE_EVENT])

    // The undamaged control for case 3: over a file the build reads completely, the withdrawal is
    // honoured by the FOLD. That is what makes case 3 a statement about the damage.
    expect(readGrantLedger(knowledgeRoot).refusedLines).toEqual([])
    const reader = createStandingApprovalReader({ knowledgeRoot })
    expect(reader.grantsFor(action(ACTION_CLASS), STANDING_APPROVAL_SCOPE)).toEqual([])
  })

  describe('CASE 3 — the revoke line damaged in place', () => {
    beforeEach(() => {
      append([GRANT_EVENT])
      append([REVOKE_EVENT])
      damageLastLine()
    })

    it('is a valid fixture: line 2 is refused while the grant on line 1 still folds ACTIVE', () => {
      const read = readGrantLedger(knowledgeRoot)

      expect(read.refusedLines.map((line) => line.lineNumber)).toEqual([2])
      expect(read.refusedLines[0]?.reason).toMatch(/unparseable line/)
      // The grant survives the read and the fold, so the reader's refusal below cannot be
      // explained by the approval having gone missing along with its withdrawal.
      expect(read.events.map((event) => event.kind)).toEqual(['grant'])
      expect(foldActiveGrants(read.events).map((grant) => grant.grantId)).toEqual([GRANT_ID])
    })

    it('grants NOTHING: an authorization file the build cannot fully read is not a licence', () => {
      const reader = createStandingApprovalReader({ knowledgeRoot })

      expect(reader.grantsFor(action(ACTION_CLASS), STANDING_APPROVAL_SCOPE)).toEqual([])
    })

    it('refuses a class whose own line is untouched — the refusal is the FILE\'s', () => {
      // A second, unrelated approval whose line is byte-perfect. Per-line trust in a damaged
      // authorization file is exactly the posture being closed: the build cannot tell what else
      // the damaged region was meant to withdraw.
      const otherClass = 'fn:knowledge.forget'
      append([{
        schemaVersion: CURRENT_GRANT_LEDGER_SCHEMA_VERSION,
        kind: 'grant',
        at: GRANTED_AT,
        grantId: 'grant_other_class',
        actionClass: otherClass,
        scope: STANDING_APPROVAL_SCOPE,
      }])

      const reader = createStandingApprovalReader({ knowledgeRoot })
      expect(reader.grantsFor(action(otherClass), STANDING_APPROVAL_SCOPE)).toEqual([])
    })
  })
})
