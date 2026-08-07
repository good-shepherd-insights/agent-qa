// The three grant verbs over the committed ledger, and D-05's TWO refusals (Phase 391, D-03/D-05).
//
// This suite is shaped like `quarantine/__tests__/operations.test.ts` because 391 D-11 chose that
// precedent verbatim: the serialization posture, the egress posture and the refusal-as-typed-throw
// posture are the sibling's, and the place to find out whether they really transferred is a suite
// shaped like the sibling's suite.
//
// THE TWO-SIDED CONTRACT IS DRIVEN AS TWO SIDES (D-05, and the repo's own measured law). The mint
// half and the match half are pinned in separate cases, each arranged so that it would still go RED
// if only the OTHER side's guard existed:
//
//  - the MINT case calls `record` with a protected class. With no mint guard the call appends and
//    answers `recorded`, whatever the reader does afterwards.
//  - the MATCH case forges a protected grant line straight into `grants.jsonl` — bypassing the mint
//    entirely, which is the point — and asks the reader. With no read filter the grant comes back,
//    and no mint guard can help, because the line never met one.
//
// THE ONE HAND-WRITTEN LINE IN THIS PLAN lives in the match case, and it is written by hand for a
// reason rather than for convenience: it models a human (or an attacker) editing a COMMITTED file
// that travels in pull requests. A producer-built fixture cannot express it, because the producer
// is exactly the thing that refuses. Every other fixture here goes through the real API.
//
// EVERY GUARDED RULE GETS BOTH SIDES OF ITS CORPUS. A protected class AND an unprotected one; a
// grant present AND absent; the lease held AND free; an authority that is current AND one that is
// not. A corpus drawn only from inside a guard's assumption measures the assumption.

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  CURRENT_GRANT_LEDGER_SCHEMA_VERSION,
  PROTECTED_ACTION_CLASSES,
  STANDING_APPROVAL_SCOPE,
  canonicalJson,
  isProtectedActionClass,
} from '@vostride/agent-qa-schema'
import type { GrantLedgerEvent, RiskActionDescriptor } from '@vostride/agent-qa-schema'

import { acquireWriterLease, releaseLease, WriterAuthorityLostError } from '../../lease/writer-lease.js'
import { foldActiveGrants, grantsLedgerPath, readGrantLedger } from '../ledger.js'
import {
  GrantLeaseHeldError,
  GrantWriteBlockedError,
  createGrantOperations,
} from '../operations.js'
import { createStandingApprovalReader } from '../reader.js'

/** A real op's class, and deliberately NOT a protected one — the guard's ADMIT side. */
const OPEN_CLASS = 'fn:knowledge.proposal.apply'
/** A real member of the closed set, read off the constant so this cannot drift from it. */
const PROTECTED_CLASS = PROTECTED_ACTION_CLASSES[0]
const SECOND_OPEN_CLASS = 'fn:knowledge.forget.propose'

const AT = '2026-08-07T10:00:00.000Z'
const LATER = '2026-08-07T11:00:00.000Z'

/** AKIA + 16 uppercase alphanumerics — the detector-shaped key the committed-root proofs use. */
const AWS_KEY = 'AKIAIOSFODNN7EXAMPLE'

function action(name: string): RiskActionDescriptor {
  return { name, recognized: true, readOnly: false }
}

describe('the grant verbs: record, revoke, list — under the lease, protected at both sides', () => {
  let root: string
  let knowledgeRoot: string
  let auditBaseDir: string
  let now: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'grant-ops-'))
    knowledgeRoot = join(root, 'agent-qa-knowledge')
    auditBaseDir = join(root, '.agent-qa')
    mkdirSync(knowledgeRoot, { recursive: true })
    mkdirSync(auditBaseDir, { recursive: true })
    now = AT
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function ops(overrides: { resolveWriterAuthority?: () => { leaseId: string; epoch: number } | undefined } = {}) {
    return createGrantOperations({
      resolveKnowledgeRoot: () => knowledgeRoot,
      auditBaseDir,
      now: () => now,
      ...overrides,
    })
  }

  function ledgerLines(): GrantLedgerEvent[] {
    if (!existsSync(grantsLedgerPath(knowledgeRoot))) return []
    return readFileSync(grantsLedgerPath(knowledgeRoot), 'utf8')
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as GrantLedgerEvent)
  }

  // ---- D-05, the MINT half -------------------------------------------------------------------

  describe('the mint refuses a covering grant for a protected class (D-05, mint half)', () => {
    it('answers the protected-class arm and appends NOTHING', async () => {
      const outcome = await ops().record({
        actionClass: PROTECTED_CLASS,
        scope: STANDING_APPROVAL_SCOPE,
      })

      expect(outcome).toEqual({ kind: 'protected-class', actionClass: PROTECTED_CLASS })
      // Not "an empty ledger" — no ledger. The refusal happens before any filesystem call, so a
      // refused mint costs the committed tree nothing at all.
      expect(existsSync(grantsLedgerPath(knowledgeRoot))).toBe(false)
    })

    it('records an UNPROTECTED class through the same call — the guard\'s admit side', async () => {
      expect(isProtectedActionClass(OPEN_CLASS)).toBe(false)

      const outcome = await ops().record({
        actionClass: OPEN_CLASS,
        scope: STANDING_APPROVAL_SCOPE,
        proposalId: 'prop_alpha',
      })

      expect(outcome.kind).toBe('recorded')
      if (outcome.kind !== 'recorded') throw new Error('expected a recorded grant')
      expect(outcome.grant.actionClass).toBe(OPEN_CLASS)
      expect(outcome.grant.scope).toEqual(STANDING_APPROVAL_SCOPE)
      expect(outcome.grant.proposalId).toBe('prop_alpha')
      // The instant is the INJECTED clock's, not a wall-clock read inside the verb.
      expect(outcome.grant.grantedAt).toBe(AT)
      expect(ledgerLines()).toHaveLength(1)
    })

    it('refuses the protected class BEFORE taking the lease — the refusal costs the next writer nothing', async () => {
      const holder = acquireWriterLease(knowledgeRoot)
      if (holder.kind !== 'acquired') throw new Error('fixture could not take the lease')
      try {
        // An unprotected mint under the same held lease refuses with the LEASE error, which is what
        // makes the protected answer below evidence about ORDER rather than about the lease.
        await expect(
          ops().record({ actionClass: OPEN_CLASS, scope: STANDING_APPROVAL_SCOPE }),
        ).rejects.toBeInstanceOf(GrantLeaseHeldError)

        const outcome = await ops().record({
          actionClass: PROTECTED_CLASS,
          scope: STANDING_APPROVAL_SCOPE,
        })
        expect(outcome).toEqual({ kind: 'protected-class', actionClass: PROTECTED_CLASS })
      } finally {
        releaseLease({ knowledgeRoot, leaseId: holder.leaseId })
      }
    })
  })

  // ---- D-05, the MATCH half ------------------------------------------------------------------

  describe('the reader refuses to match a protected grant a hand-edit put in the file (D-05, match half)', () => {
    /**
     * The ONE hand-written line this plan authors, and the only place it is legitimate: the mint
     * above refuses to produce it, so no producer can. What it models is a person editing a
     * committed file — which is exactly the threat the read half exists for.
     */
    function forgeProtectedGrantLine(): void {
      const forged: GrantLedgerEvent = {
        schemaVersion: CURRENT_GRANT_LEDGER_SCHEMA_VERSION,
        kind: 'grant',
        at: AT,
        grantId: 'grant_forged_by_hand',
        actionClass: PROTECTED_CLASS,
        scope: STANDING_APPROVAL_SCOPE,
      }
      mkdirSync(knowledgeRoot, { recursive: true })
      writeFileSync(grantsLedgerPath(knowledgeRoot), `${canonicalJson(forged)}\n`, 'utf8')
    }

    it('folds the forged line — so the refusal below is the FILTER\'s and not the guard\'s', () => {
      forgeProtectedGrantLine()

      const { events, refusedLines } = readGrantLedger(knowledgeRoot)
      // The line is well-formed committed truth: it parses, it passes the shape gate, and it folds
      // to an active grant. Without this the next case could pass because the line was malformed.
      expect(refusedLines).toEqual([])
      expect(foldActiveGrants(events).map((grant) => grant.actionClass)).toEqual([PROTECTED_CLASS])
    })

    it('never returns it from grantsFor, so no ask can be satisfied by it', () => {
      forgeProtectedGrantLine()

      const reader = createStandingApprovalReader({ knowledgeRoot })
      expect(reader.grantsFor(action(PROTECTED_CLASS), STANDING_APPROVAL_SCOPE)).toEqual([])
    })

    it('DOES return an unprotected grant recorded through the real mint — the filter\'s admit side', async () => {
      await ops().record({ actionClass: OPEN_CLASS, scope: STANDING_APPROVAL_SCOPE })

      const reader = createStandingApprovalReader({ knowledgeRoot })
      expect(reader.grantsFor(action(OPEN_CLASS), STANDING_APPROVAL_SCOPE)).toEqual([
        { actionClass: OPEN_CLASS, scope: STANDING_APPROVAL_SCOPE },
      ])
    })

    it('still LISTS the forged grant, because a human has to be able to see and revoke it', async () => {
      forgeProtectedGrantLine()

      // `list` is a report about the file; `grantsFor` is an authorization answer. Filtering the
      // listing too would hide the one line a reviewer most needs to find — and would leave the
      // revoke verb unable to name it.
      const listed = await ops().list()
      expect(listed.grants.map((grant) => grant.actionClass)).toEqual([PROTECTED_CLASS])
    })
  })

  // ---- the damage report (391-08, closing 391-VERIFICATION gap 2) -----------------------------

  describe('list reports the file\'s damage beside what folds', () => {
    /** The same corruption the reader's suite refuses on: a merge marker fused onto a real line. */
    function damageLastLine(): void {
      const path = grantsLedgerPath(knowledgeRoot)
      const lines = readFileSync(path, 'utf8').split('\n')
      let last = lines.length - 1
      while (last >= 0 && (lines[last] ?? '').trim().length === 0) last -= 1
      if (last < 0) throw new Error('the fixture ledger has no line to damage')
      lines[last] = `<<<<<<< HEAD${lines[last] ?? ''}`
      writeFileSync(path, lines.join('\n'), 'utf8')
    }

    it('answers an EMPTY damage report over an intact ledger — the guard\'s admit side', async () => {
      const verbs = ops()
      await verbs.record({ actionClass: OPEN_CLASS, scope: STANDING_APPROVAL_SCOPE })

      const listed = await verbs.list()
      expect(listed.grants.map((grant) => grant.actionClass)).toEqual([OPEN_CLASS])
      expect(listed.refusedLines).toEqual([])
    })

    it('names the refused line while the grants that fold still list', async () => {
      const verbs = ops()
      const recorded = await verbs.record({
        actionClass: OPEN_CLASS,
        scope: STANDING_APPROVAL_SCOPE,
      })
      if (recorded.kind !== 'recorded') throw new Error('expected a recorded grant')
      now = LATER
      const revoked = await verbs.revoke({ grantId: recorded.grant.grantId })
      expect(revoked.outcome).toBe('revoked')
      damageLastLine()

      const listed = await verbs.list()
      // The REPORT stays fail-open on purpose — a reviewer has to be able to see what folds, and
      // the grant that folds here is precisely the one the damaged revoke was meant to withdraw.
      expect(listed.grants.map((grant) => grant.grantId)).toEqual([recorded.grant.grantId])
      // 1-based, matching what an editor shows the human who has to fix the file.
      expect(listed.refusedLines.map((line) => line.lineNumber)).toEqual([2])
      expect(listed.refusedLines[0]?.reason).toMatch(/unparseable line/)
    })
  })

  // ---- the lifecycle: record -> list -> revoke -> list ----------------------------------------

  describe('record, list, revoke — one committed event each (D-03)', () => {
    it('lists what was recorded, and stops listing it after the revoke', async () => {
      const verbs = ops()
      const recorded = await verbs.record({
        actionClass: OPEN_CLASS,
        scope: STANDING_APPROVAL_SCOPE,
        proposalId: 'prop_alpha',
      })
      if (recorded.kind !== 'recorded') throw new Error('expected a recorded grant')

      expect(await verbs.list()).toEqual({ grants: [recorded.grant], refusedLines: [] })

      now = LATER
      const revoked = await verbs.revoke({ grantId: recorded.grant.grantId })
      expect(revoked.outcome).toBe('revoked')
      if (revoked.outcome !== 'revoked') throw new Error('expected a revoked grant')
      expect(revoked.grant).toEqual(recorded.grant)

      expect(await verbs.list()).toEqual({ grants: [], refusedLines: [] })
      // BOTH events survive, in order. A revoke that rewrote or removed the grant line would leave
      // a reviewer unable to see that an approval was ever given.
      expect(ledgerLines().map((event) => event.kind)).toEqual(['grant', 'revoke'])
      expect(ledgerLines().map((event) => event.at)).toEqual([AT, LATER])
    })

    it('answers already-granted rather than accreting a second line for the same class', async () => {
      const verbs = ops()
      const first = await verbs.record({ actionClass: OPEN_CLASS, scope: STANDING_APPROVAL_SCOPE })
      if (first.kind !== 'recorded') throw new Error('expected a recorded grant')

      now = LATER
      const second = await verbs.record({ actionClass: OPEN_CLASS, scope: STANDING_APPROVAL_SCOPE })

      // Grants never accrete (D-01's spirit at the ledger): a second accept-with-always on the same
      // class is already covered, and two lines would need two revokes to undo one approval.
      expect(second).toEqual({ kind: 'already-granted', grant: first.grant })
      expect(ledgerLines()).toHaveLength(1)
    })

    it('answers no-grant for an id nothing recorded, and appends nothing', async () => {
      const verbs = ops()
      await verbs.record({ actionClass: OPEN_CLASS, scope: STANDING_APPROVAL_SCOPE })
      const before = readFileSync(grantsLedgerPath(knowledgeRoot), 'utf8')

      expect(await verbs.revoke({ grantId: 'grant_nothing_here' })).toEqual({
        outcome: 'no-grant',
        grantId: 'grant_nothing_here',
      })
      expect(readFileSync(grantsLedgerPath(knowledgeRoot), 'utf8')).toBe(before)
    })

    it('mints the grant id itself, distinctly per class — a caller never names one', async () => {
      const verbs = ops()
      const alpha = await verbs.record({ actionClass: OPEN_CLASS, scope: STANDING_APPROVAL_SCOPE })
      const beta = await verbs.record({
        actionClass: SECOND_OPEN_CLASS,
        scope: STANDING_APPROVAL_SCOPE,
      })
      if (alpha.kind !== 'recorded' || beta.kind !== 'recorded') {
        throw new Error('expected two recorded grants')
      }

      expect(alpha.grant.grantId).not.toBe(beta.grant.grantId)
      // Derived rather than random: the same class at the same instant addresses the same grant, so
      // a retrying surface cannot mint two approvals for one decision.
      expect(alpha.grant.grantId).toMatch(/^grant_[0-9a-f]{16}$/)
    })
  })

  // ---- serialization and the egress checkpoint ------------------------------------------------

  describe('every append rides the writer lease and the committed-egress checkpoint', () => {
    it('refuses typed when another writer holds the lease, leaving the ledger byte-unchanged', async () => {
      const verbs = ops()
      await verbs.record({ actionClass: OPEN_CLASS, scope: STANDING_APPROVAL_SCOPE })
      const before = readFileSync(grantsLedgerPath(knowledgeRoot), 'utf8')

      const holder = acquireWriterLease(knowledgeRoot)
      if (holder.kind !== 'acquired') throw new Error('fixture could not take the lease')
      try {
        await expect(
          verbs.record({ actionClass: SECOND_OPEN_CLASS, scope: STANDING_APPROVAL_SCOPE }),
        ).rejects.toBeInstanceOf(GrantLeaseHeldError)
        await expect(verbs.revoke({ grantId: 'grant_anything' })).rejects.toBeInstanceOf(
          GrantLeaseHeldError,
        )
      } finally {
        releaseLease({ knowledgeRoot, leaseId: holder.leaseId })
      }

      expect(readFileSync(grantsLedgerPath(knowledgeRoot), 'utf8')).toBe(before)
    })

    it('lets LIST through while the lease is held — a reader never queues behind a drain', async () => {
      const verbs = ops()
      await verbs.record({ actionClass: OPEN_CLASS, scope: STANDING_APPROVAL_SCOPE })

      const holder = acquireWriterLease(knowledgeRoot)
      if (holder.kind !== 'acquired') throw new Error('fixture could not take the lease')
      try {
        expect((await verbs.list()).grants.map((grant) => grant.actionClass)).toEqual([OPEN_CLASS])
      } finally {
        releaseLease({ knowledgeRoot, leaseId: holder.leaseId })
      }
    })

    it('rides a handed-in authority instead of acquiring, and refuses one it no longer holds', async () => {
      const holder = acquireWriterLease(knowledgeRoot)
      if (holder.kind !== 'acquired') throw new Error('fixture could not take the lease')
      try {
        // The daemon's arm: the process already holds the lease, so the verb rides it rather than
        // being told `held` by itself.
        const riding = ops({
          resolveWriterAuthority: () => ({ leaseId: holder.leaseId, epoch: holder.epoch }),
        })
        expect(
          (await riding.record({ actionClass: OPEN_CLASS, scope: STANDING_APPROVAL_SCOPE })).kind,
        ).toBe('recorded')

        // An authority this process does not hold is CHECKED, not believed.
        const stale = ops({
          resolveWriterAuthority: () => ({ leaseId: 'lease_somebody_else', epoch: holder.epoch }),
        })
        await expect(
          stale.record({ actionClass: SECOND_OPEN_CLASS, scope: STANDING_APPROVAL_SCOPE }),
        ).rejects.toBeInstanceOf(WriterAuthorityLostError)
        expect(ledgerLines()).toHaveLength(1)
      } finally {
        releaseLease({ knowledgeRoot, leaseId: holder.leaseId })
      }
    })

    it('surfaces a committed-egress refusal as a typed throw, with no byte written', async () => {
      // The port's outcome union has no blocked arm by design (the quarantine precedent): answering
      // `recorded` while the ledger recorded nothing would tell a person a standing approval exists.
      await expect(
        ops().record({
          actionClass: OPEN_CLASS,
          scope: STANDING_APPROVAL_SCOPE,
          // The provenance leg is CALLER data, which is what makes it the honest place to drive
          // this: the checkpoint's job is to refuse secret-shaped bytes wherever they appear in a
          // line bound for a committed, PR-visible file.
          proposalId: `prop.${AWS_KEY}`,
        }),
      ).rejects.toBeInstanceOf(GrantWriteBlockedError)

      expect(existsSync(grantsLedgerPath(knowledgeRoot))).toBe(false)
    })
  })
})
