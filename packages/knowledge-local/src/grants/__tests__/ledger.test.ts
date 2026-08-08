// The committed grant ledger's read, fold and append halves (Phase 391, D-04/D-11).
//
// This suite is a differential against the quarantine ledger's, because 391 D-11 chose that
// precedent verbatim: whatever posture the sibling ledger holds, this one must hold too, and the
// place to find out is a suite shaped like its suite. Four postures are load-bearing:
//
//  1. Refusal-as-data on malformed lines — a mangled line surfaces in `refusedLines` while its
//     neighbours still fold. Healing to absence is worse here than it is next door: a dropped
//     `revoke` line leaves an approval standing that a human already withdrew.
//  2. A NEWER schemaVersion is a typed hard failure, not a skipped line. Committed truth.
//  3. The fold is FILE ORDER and nothing else. No clock is read, at all.
//  4. The append refuses on BOTH read legs before the egress checkpoint, and the checkpoint's
//     refusal is DATA rather than a throw.
//
// Every fixture goes through the real API. Where a line has to be malformed on purpose it is
// written as raw bytes — that is the hand-edit the read posture exists for, and it is the one thing
// no producer can emit.

import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  CURRENT_GRANT_LEDGER_SCHEMA_VERSION,
  GrantLedgerVersionError,
  STANDING_APPROVAL_SCOPE,
  TRUST_SCOPE_KEYS,
  canonicalJson,
} from '@vostride/agent-qa-schema'
import type { GrantLedgerEvent } from '@vostride/agent-qa-schema'

import {
  GRANT_LEDGER_EGRESS_CHANNEL,
  GRANT_LEDGER_FILENAME,
  appendGrantLedgerEvents,
  foldActiveGrants,
  grantsLedgerPath,
  readGrantLedger,
} from '../ledger.js'

/**
 * A scope key OUTSIDE `TRUST_SCOPE_KEYS`, COMPUTED against the published constant rather than
 * typed. A hard-coded key becomes LEGAL the day the constant grows, and this case then reports
 * green while measuring nothing — 391-11 measured exactly that, reding this case under a mutation
 * that legalised the `'tenant'` it used to spell.
 *
 * `AGENT_QA_TEST_UNKNOWN_SCOPE_KEY` is set by a falsifiability revert (391-13 revert B). It wins
 * outright and is deliberately NOT legality-checked: pinning a key that HAS just become legal is
 * the entire point of that branch, and a helper free to re-compute would quietly pick the next
 * illegal candidate, refuse the line exactly as before, and report green while appearing to have
 * been falsified.
 */
const UNKNOWN_SCOPE_KEY_CANDIDATES = ['tenant', 'workspace', 'region', 'cell'] as const

function anUnknownScopeKey(): string {
  const pinned = process.env.AGENT_QA_TEST_UNKNOWN_SCOPE_KEY
  if (typeof pinned === 'string' && pinned.length > 0) return pinned

  const declared = TRUST_SCOPE_KEYS as readonly string[]
  const found = UNKNOWN_SCOPE_KEY_CANDIDATES.find((candidate) => !declared.includes(candidate))
  if (found === undefined) {
    throw new Error(
      `every candidate scope key (${UNKNOWN_SCOPE_KEY_CANDIDATES.join(', ')}) is now legal in ` +
        `TRUST_SCOPE_KEYS (${declared.join(', ')}); this case can no longer measure a refusal — ` +
        'add a candidate rather than letting it pass',
    )
  }
  return found
}

const UNKNOWN_SCOPE_KEY = anUnknownScopeKey()

const ACTION_CLASS = 'fn:knowledge.proposal.apply'
const GRANT_ID = 'grant_apply_alpha'
const OTHER_GRANT_ID = 'grant_apply_beta'
const GRANTED_AT = '2026-08-07T10:00:00.000Z'
const REVOKED_AT = '2026-08-07T11:00:00.000Z'

function grant(overrides: Partial<Record<string, unknown>> = {}): GrantLedgerEvent {
  return {
    schemaVersion: CURRENT_GRANT_LEDGER_SCHEMA_VERSION,
    kind: 'grant',
    at: GRANTED_AT,
    grantId: GRANT_ID,
    actionClass: ACTION_CLASS,
    scope: STANDING_APPROVAL_SCOPE,
    ...overrides,
  } as GrantLedgerEvent
}

function revoke(overrides: Partial<Record<string, unknown>> = {}): GrantLedgerEvent {
  return {
    schemaVersion: CURRENT_GRANT_LEDGER_SCHEMA_VERSION,
    kind: 'revoke',
    at: REVOKED_AT,
    grantId: GRANT_ID,
    ...overrides,
  } as GrantLedgerEvent
}

describe('grant ledger read and fold', () => {
  let knowledgeRoot: string

  beforeEach(async () => {
    knowledgeRoot = await mkdtemp(join(tmpdir(), 'grant-ledger-'))
  })

  afterEach(async () => {
    await rm(knowledgeRoot, { recursive: true, force: true })
  })

  async function writeLedger(lines: readonly string[]): Promise<void> {
    await writeFile(grantsLedgerPath(knowledgeRoot), `${lines.join('\n')}\n`, 'utf8')
  }

  it('names the ledger as its own top-level artifact under the committed knowledge root', () => {
    expect(GRANT_LEDGER_FILENAME).toBe('grants.jsonl')
    // Root-relative and nothing else: the path is a join of the caller's root and this one name,
    // so the same committed bytes are readable from any checkout that carries them.
    expect(grantsLedgerPath(knowledgeRoot)).toBe(join(knowledgeRoot, GRANT_LEDGER_FILENAME))
  })

  it('reads a MISSING ledger as empty rather than throwing — the ENOENT edge', () => {
    expect(existsSync(grantsLedgerPath(knowledgeRoot))).toBe(false)
    expect(readGrantLedger(knowledgeRoot)).toEqual({ events: [], refusedLines: [] })
    // …and the gate's question over that read answers no approvals, which is the fail-closed
    // direction: an ask with no ledger is an ask nothing satisfies.
    expect(foldActiveGrants(readGrantLedger(knowledgeRoot).events)).toEqual([])
  })

  it('reads an EMPTY file, and a whitespace-only file, as empty', async () => {
    await writeFile(grantsLedgerPath(knowledgeRoot), '', 'utf8')
    expect(readGrantLedger(knowledgeRoot)).toEqual({ events: [], refusedLines: [] })

    await writeFile(grantsLedgerPath(knowledgeRoot), '\n\n   \n', 'utf8')
    // Blank lines are whitespace, not damage: they are skipped silently rather than refused.
    expect(readGrantLedger(knowledgeRoot)).toEqual({ events: [], refusedLines: [] })
  })

  it('refuses an UNPARSEABLE line as data while its neighbours still fold', async () => {
    await writeLedger([canonicalJson(grant()), '{not json', canonicalJson(revoke({ grantId: OTHER_GRANT_ID }))])

    const read = readGrantLedger(knowledgeRoot)
    expect(read.events.map((event) => event.kind)).toEqual(['grant', 'revoke'])
    expect(read.refusedLines).toHaveLength(1)
    // 1-based, matching what an editor shows the human who has to fix the file.
    expect(read.refusedLines[0]?.lineNumber).toBe(2)
    expect(read.refusedLines[0]?.reason).toMatch(/unparseable line/)
  })

  it('refuses a STRUCTURALLY broken line as data — never healed to absence', async () => {
    await writeLedger([
      // A grant with no action class covers nothing and can never match; refusing it is what keeps
      // the committed file free of approvals that only look like approvals.
      canonicalJson({ ...grant(), actionClass: '' }),
      // A grant whose scope has no populated key is the same failure in the other field: the gate
      // refuses an empty scope on either side, so this line would list as authorization and satisfy
      // nothing, forever.
      canonicalJson({ ...grant(), grantId: OTHER_GRANT_ID, scope: {} }),
      canonicalJson(grant()),
    ])

    const read = readGrantLedger(knowledgeRoot)
    expect(read.refusedLines.map((line) => line.lineNumber)).toEqual([1, 2])
    expect(read.events).toEqual([grant()])
    // The surviving neighbour still folds — a damaged line is line-level damage, not file-level.
    expect(foldActiveGrants(read.events).map((active) => active.grantId)).toEqual([GRANT_ID])
  })

  it('refuses a grant whose scope carries an UNKNOWN key, by line number', async () => {
    // The structural guard refuses exactly what the strict wire contract refuses: a key that is NOT
    // a member of TRUST_SCOPE_KEYS. The key is computed from that constant, so this case states the
    // RELATION rather than naming a spelling that a later key addition could legalise. Authored as
    // raw bytes BECAUSE the fixed mint refuses to produce it — the same sanctioned hand-written-line
    // exception the forged-protected-line case relies on.
    await writeLedger([
      canonicalJson(grant()),
      canonicalJson({
        ...grant(),
        grantId: OTHER_GRANT_ID,
        scope: { ...STANDING_APPROVAL_SCOPE, [UNKNOWN_SCOPE_KEY]: 'smuggled' },
      }),
    ])

    const read = readGrantLedger(knowledgeRoot)
    expect(read.refusedLines.map((line) => line.lineNumber)).toEqual([2])
    expect(read.events).toEqual([grant()])
    expect(foldActiveGrants(read.events).map((active) => active.grantId)).toEqual([GRANT_ID])
  })

  it('ADMITS every legal scope key combination — org-only, project-only and both', async () => {
    // The admit side of the guard above. Without it, "refuses an unknown key" would be
    // indistinguishable from "refuses anything that is not the one canonical scope literal".
    await writeLedger([
      canonicalJson({ ...grant(), grantId: 'grant_scope_org', scope: { org: 'acme' } }),
      canonicalJson({
        ...grant(),
        grantId: 'grant_scope_project',
        scope: { project: 'local-workspace' },
      }),
      canonicalJson({
        ...grant(),
        grantId: 'grant_scope_both',
        scope: { org: 'acme', project: 'local-workspace' },
      }),
    ])

    const read = readGrantLedger(knowledgeRoot)
    expect(read.refusedLines).toEqual([])
    expect(foldActiveGrants(read.events).map((active) => active.grantId)).toEqual([
      'grant_scope_org',
      'grant_scope_project',
      'grant_scope_both',
    ])
  })

  it('PROPAGATES a newer-version line as a typed error — committed truth hard-fails', async () => {
    await writeLedger([
      canonicalJson(grant()),
      canonicalJson({ ...grant(), schemaVersion: CURRENT_GRANT_LEDGER_SCHEMA_VERSION + 1 }),
    ])

    // The two-arm split: a structural problem is one refused LINE, a version this build cannot
    // consume takes the whole file down. Skipping it would be the dangerous direction — a skipped
    // revoke leaves a withdrawn approval standing.
    expect(() => readGrantLedger(knowledgeRoot)).toThrow(GrantLedgerVersionError)
  })

  it('folds in FILE ORDER: a revoke after a grant leaves no active grant', () => {
    expect(foldActiveGrants([grant(), revoke()])).toEqual([])
  })

  it('folds in FILE ORDER: the same two lines REVERSED leave the grant active', () => {
    // The control for the case above. Without it, "revoke wins" would be indistinguishable from
    // "revoke wins wherever it appears", which is a different and wrong rule.
    const active = foldActiveGrants([revoke(), grant()])
    expect(active).toEqual([
      {
        grantId: GRANT_ID,
        actionClass: ACTION_CLASS,
        scope: STANDING_APPROVAL_SCOPE,
        grantedAt: GRANTED_AT,
      },
    ])
  })

  it('a revoke with NO matching grant is a no-op arm — nothing is invented', () => {
    expect(foldActiveGrants([revoke({ grantId: 'grant_never_recorded' })])).toEqual([])
    // …and it does not disturb an unrelated grant that IS recorded.
    expect(
      foldActiveGrants([grant(), revoke({ grantId: 'grant_never_recorded' })])
        .map((active) => active.grantId),
    ).toEqual([GRANT_ID])
  })

  it('revokes by ID ONLY — a revoke for another id leaves this grant standing', () => {
    expect(
      foldActiveGrants([grant(), revoke({ grantId: OTHER_GRANT_ID })]).map((a) => a.grantId),
    ).toEqual([GRANT_ID])
  })

  it('carries provenance through the fold when the grant recorded one', () => {
    const [active] = foldActiveGrants([grant({ proposalId: 'prop_0123456789ab' })])
    expect(active?.proposalId).toBe('prop_0123456789ab')
    // Absent provenance is an ABSENT field, not a present undefined one.
    expect(Object.hasOwn(foldActiveGrants([grant()])[0] ?? {}, 'proposalId')).toBe(false)
  })

  it('is PURE — the same events fold identically however many times they are folded', () => {
    const events = [grant(), grant({ grantId: OTHER_GRANT_ID }), revoke()]
    expect(foldActiveGrants(events)).toEqual(foldActiveGrants(events))
    expect(foldActiveGrants(events).map((active) => active.grantId)).toEqual([OTHER_GRANT_ID])
  })
})

// ---- appendGrantLedgerEvents: egress-checkpointed committed writes (D-11) ----

// AKIA + 16 uppercase alphanumerics is the exact detector-shaped key the committed-root proofs use.
// An arbitrary random string would not exercise the refusal path at all.
const AWS_KEY = 'AKIAIOSFODNN7EXAMPLE'

describe('appendGrantLedgerEvents (D-11)', () => {
  let knowledgeRoot: string
  let auditBaseDir: string

  beforeEach(async () => {
    knowledgeRoot = await mkdtemp(join(tmpdir(), 'grant-append-'))
    auditBaseDir = await mkdtemp(join(tmpdir(), 'grant-audit-'))
  })

  afterEach(async () => {
    await rm(knowledgeRoot, { recursive: true, force: true })
    await rm(auditBaseDir, { recursive: true, force: true })
  })

  function ledgerText(): string {
    return readFileSync(grantsLedgerPath(knowledgeRoot), 'utf8')
  }

  it('names its own committed-egress channel', () => {
    // Distinct from the bundle and quarantine channels, so an audit row says which committed
    // surface refused without anyone having to infer it.
    expect(GRANT_LEDGER_EGRESS_CHANNEL).toBe('grant-ledger')
  })

  it('round-trips: append then read then fold reproduces the events identically', () => {
    const events = [grant(), revoke()]
    expect(appendGrantLedgerEvents(knowledgeRoot, events, { auditBaseDir })).toEqual({
      kind: 'appended',
      lines: 2,
    })

    const read = readGrantLedger(knowledgeRoot)
    expect(read.refusedLines).toEqual([])
    expect(read.events).toEqual(events)
    expect(foldActiveGrants(read.events)).toEqual(foldActiveGrants(events))
  })

  it('writes canonical JSON, one event per line, newline-terminated', () => {
    appendGrantLedgerEvents(knowledgeRoot, [grant()], { auditBaseDir })
    expect(ledgerText()).toBe(`${canonicalJson(grant())}\n`)
  })

  it('APPENDS — an existing ledger keeps every prior line', () => {
    appendGrantLedgerEvents(knowledgeRoot, [grant()], { auditBaseDir })
    appendGrantLedgerEvents(knowledgeRoot, [revoke()], { auditBaseDir })
    expect(readGrantLedger(knowledgeRoot).events).toEqual([grant(), revoke()])
    expect(ledgerText().trimEnd().split('\n')).toHaveLength(2)
  })

  it('creates the knowledge root when the first append lands', () => {
    const freshRoot = join(knowledgeRoot, 'nested', 'root')
    expect(existsSync(freshRoot)).toBe(false)
    expect(appendGrantLedgerEvents(freshRoot, [grant()], { auditBaseDir })).toEqual({
      kind: 'appended',
      lines: 1,
    })
    expect(readGrantLedger(freshRoot).events).toEqual([grant()])
  })

  it('an empty event list is a no-op that writes no file', () => {
    expect(appendGrantLedgerEvents(knowledgeRoot, [], { auditBaseDir })).toEqual({
      kind: 'appended',
      lines: 0,
    })
    expect(existsSync(grantsLedgerPath(knowledgeRoot))).toBe(false)
  })

  it('rejects a STALE hand-stamped version with an index-naming TypeError, writing nothing', () => {
    // The version leg exists separately from the shape leg because the shape predicate asks only
    // that `schemaVersion` be a NUMBER. Every other number would slip past a shape-only pre-check
    // and land a line the reader then rejects.
    expect(() =>
      appendGrantLedgerEvents(
        knowledgeRoot,
        [grant({ schemaVersion: CURRENT_GRANT_LEDGER_SCHEMA_VERSION - 1 })],
        { auditBaseDir },
      ),
    ).toThrow(TypeError)
    expect(() =>
      appendGrantLedgerEvents(
        knowledgeRoot,
        [grant({ schemaVersion: CURRENT_GRANT_LEDGER_SCHEMA_VERSION - 1 })],
        { auditBaseDir },
      ),
    ).toThrow(/index 0.*is not the current version/s)

    expect(existsSync(grantsLedgerPath(knowledgeRoot))).toBe(false)
  })

  it('rejects a NEWER hand-stamped version on the same leg', () => {
    // `===`, not `<=`: both sides of the current version are equally unreadable while the migration
    // registry is empty, and an ordering comparison would have admitted one of them.
    expect(() =>
      appendGrantLedgerEvents(
        knowledgeRoot,
        [grant({ schemaVersion: CURRENT_GRANT_LEDGER_SCHEMA_VERSION + 1 })],
        { auditBaseDir },
      ),
    ).toThrow(/is not the current version/)
    expect(existsSync(grantsLedgerPath(knowledgeRoot))).toBe(false)
  })

  it('rejects a MISSHAPEN event on the shape leg — throws, writes nothing', () => {
    expect(() =>
      appendGrantLedgerEvents(knowledgeRoot, [grant({ actionClass: '' })], { auditBaseDir }),
    ).toThrow(TypeError)
    // Named by INDEX, so a caller appending a batch knows which event it authored badly.
    expect(() =>
      appendGrantLedgerEvents(
        knowledgeRoot,
        [revoke(), grant({ scope: {} })],
        { auditBaseDir },
      ),
    ).toThrow(/index 1/)

    expect(existsSync(grantsLedgerPath(knowledgeRoot))).toBe(false)
  })

  it('refuses a secret-bearing append as DATA, writing no byte and throwing nothing', () => {
    const outcome = appendGrantLedgerEvents(
      knowledgeRoot,
      [grant({ actionClass: `fn:knowledge.${AWS_KEY}` })],
      { auditBaseDir },
    )

    expect(outcome.kind).toBe('egress-blocked')
    if (outcome.kind !== 'egress-blocked') throw new Error('expected an egress refusal')
    expect(outcome.detections.map((detection) => detection.detector)).toContain('awsKey')

    // Fail-closed: the checkpoint runs BEFORE any byte reaches the committed file. This is the
    // whole reason a grant ledger goes through it — the file is PR-visible by design.
    expect(existsSync(grantsLedgerPath(knowledgeRoot))).toBe(false)

    // And the refusal is audited under the caller-owned audit dir, on this channel.
    const auditPath = join(auditBaseDir, 'guardrail_audit.jsonl')
    expect(existsSync(auditPath)).toBe(true)
    expect(readFileSync(auditPath, 'utf8')).toContain(GRANT_LEDGER_EGRESS_CHANNEL)
  })

  it('a blocked unit leaves an existing ledger byte-unchanged — all-or-nothing', () => {
    appendGrantLedgerEvents(knowledgeRoot, [grant()], { auditBaseDir })
    const before = ledgerText()

    const outcome = appendGrantLedgerEvents(
      knowledgeRoot,
      [revoke(), grant({ grantId: OTHER_GRANT_ID, actionClass: `fn:knowledge.${AWS_KEY}` })],
      { auditBaseDir },
    )

    expect(outcome.kind).toBe('egress-blocked')
    // The CLEAN sibling in the same unit is withheld too: the checkpoint is one unit. A half-written
    // approval record is what would leave a reviewer unable to tell what was actually authorized.
    expect(ledgerText()).toBe(before)
  })

  it('the two pre-checks run BEFORE the egress checkpoint', () => {
    // The secret is planted on `proposalId`, which rides in the serialized line exactly as the
    // action class does. THE CONTROL RUNS FIRST, because "no audit row was written" says nothing
    // unless the same bytes would otherwise have produced one: with a well-formed class, this event
    // is refused by the checkpoint and audited.
    const control = appendGrantLedgerEvents(
      knowledgeRoot,
      [grant({ proposalId: `prop.${AWS_KEY}` })],
      { auditBaseDir },
    )
    expect(control.kind).toBe('egress-blocked')
    expect(existsSync(join(auditBaseDir, 'guardrail_audit.jsonl'))).toBe(true)

    // Now the same secret on an event that ALSO fails the shape leg, into a fresh audit dir. The
    // structural refusal answers and the checkpoint never runs — which is only observable because
    // the control above proved the checkpoint would have refused these bytes.
    const secondAuditDir = join(auditBaseDir, 'second')
    expect(() =>
      appendGrantLedgerEvents(
        knowledgeRoot,
        [grant({ actionClass: '', proposalId: `prop.${AWS_KEY}` })],
        { auditBaseDir: secondAuditDir },
      ),
    ).toThrow(TypeError)

    expect(existsSync(join(secondAuditDir, 'guardrail_audit.jsonl'))).toBe(false)
    expect(existsSync(grantsLedgerPath(knowledgeRoot))).toBe(false)
  })

  it('what the append writes is exactly what the read admits — the two halves range one guard', () => {
    // The symmetry claim stated as a measurement rather than a comment: every event this function
    // accepts round-trips through the reader with zero refused lines, and every event it refuses is
    // one the reader would have refused too.
    const accepted = [grant(), revoke(), grant({ grantId: OTHER_GRANT_ID, proposalId: 'prop_0123456789ab' })]
    expect(appendGrantLedgerEvents(knowledgeRoot, accepted, { auditBaseDir }).kind).toBe('appended')
    expect(readGrantLedger(knowledgeRoot)).toEqual({ events: accepted, refusedLines: [] })
  })
})
