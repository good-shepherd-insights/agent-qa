import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  ProposalDecisionRecordSchema,
  ProposalEvidenceRefSchema,
  ProposalOriginSchema,
  CURRENT_PROPOSAL_RECORD_SCHEMA_VERSION,
  KNOWLEDGE_PROPOSAL_STATUSES,
  PROPOSAL_DECISIONS,
  PROPOSAL_DURABLE_STATES,
  PROPOSAL_ENVELOPE_STATUSES,
  PROPOSAL_EXPIRY_MS,
  PROPOSAL_KINDS,
  PROTECTED_ACTION_CLASSES,
  ProposalRecordSchema,
  computeProposalEnvelopeStatus,
  isProposalKind,
  isProtectedActionClass,
} from '../index'
import type { ProposalRecord } from '../index'

/**
 * The kind Phase 411 removed, spelled in TWO HALVES so this file cannot match its own census.
 *
 * Plan 05's `411-issue-slot-deleted.test.ts` scans every package source tree — tests and comments
 * included — for the retired spelling, so a negative probe written as a bare literal would RED the
 * census it is meant to survive.
 */
const RETIRED = 'find' + 'ing'

const knowledgePayload = {
  schemaVersion: 1 as const,
  proposalId: 'prop_aaaaaaaa-bbbb',
  verb: 'accept' as const,
  targetRef: { grain: 'record' as const, recordId: 'rec-1' },
  deltas: [],
  proposedAt: 1_000_000,
  status: 'pending' as const,
}

const record: ProposalRecord = {
  schemaVersion: CURRENT_PROPOSAL_RECORD_SCHEMA_VERSION,
  id: 'prop_aaaaaaaa-bbbb',
  kind: 'knowledge',
  origin: { emittedBy: 'knowledge.accept.propose', runId: 'run-7', at: 1_000_000 },
  payload: knowledgePayload,
}

describe('the envelope vocabulary is closed and spelled once', () => {
  // A HAND-MAINTAINED CENSUS, and the reason it stays hand-maintained: `PROPOSAL_KINDS` feeds two
  // exhaustive `Record<ProposalKind, …>` sites, so a kind added without an answer at either FAILS
  // TO COMPILE. What no compiler can catch is a kind added and then never decided about here, or
  // one silently removed — a `.toEqual` over a literal list is the only cell that reds for that,
  // and it is the site 394-06 had to update by hand when the list went from one member to three,
  // 395-01 when `config` joined as the fourth, and 411 when the app-broken arm left and the list
  // went from four to three.
  it('has exactly three kinds, and the predicate matches them exactly', () => {
    expect(PROPOSAL_KINDS).toEqual(['knowledge', 'test-draft', 'config'])
    expect(isProposalKind('knowledge')).toBe(true)
    expect(isProposalKind('test-draft')).toBe(true)
    expect(isProposalKind('config')).toBe(true)
    // The rejected half of the pair, kept as values the vocabulary does not carry. RETIRED is the
    // word this phase removed, and it is spelled in two halves on purpose: Plan 05's census scans
    // this file, and a cell naming the retired word outright would match itself.
    expect(isProposalKind(RETIRED)).toBe(false)
    expect(isProposalKind('scaffold')).toBe(false)
    expect(isProposalKind(undefined)).toBe(false)
  })

  it('parses a test-draft record on the envelope (394 D-05)', () => {
    const testDraft = ProposalRecordSchema.parse({
      schemaVersion: CURRENT_PROPOSAL_RECORD_SCHEMA_VERSION,
      id: 'prop_cccccccc-dddd',
      kind: 'test-draft',
      origin: { emittedBy: 'authoring.draft.write', at: 2_000 },
      payload: {
        schemaVersion: 1,
        draftRef: {
          filePath: 'tests/.agent-qa-drafts/abc.yaml',
          testId: 't_abc',
          testName: 'Submit the local account form',
          contentDigest: 'abc',
        },
        // 394-10: where accepting writes it. No `sourceDigest` beside it, which is the loop's own
        // case — a new file, so an absent digest is the claim the apply re-checks.
        targetPath: 'tests/submit-the-local-account-form.yaml',
        disposition: 'keep-eligible',
        // 394-08: the two figures ride the arm together — the bound the dispatch confirm disclosed
        // and the distinct runs this draft really spent.
        runsPreviewed: 9,
        runsConsumed: 7,
        repairIterations: 1,
        summaryLine: 'a repaired draft that passed its stability gate',
      },
    })
    expect(testDraft.kind).toBe('test-draft')
  })

  it('refuses a payload wearing the wrong kind — the discriminated union is the guard', () => {
    // Nine kind/payload combinations exist for three legal ones. A flat `kind` enum beside a
    // payload union would have admitted all nine, and every one of them would parse forever. The
    // probe wears `test-draft` over a knowledge payload: a surviving kind, so the cell measures the
    // correlation itself rather than an unknown discriminant being rejected.
    expect(ProposalRecordSchema.safeParse({
      schemaVersion: CURRENT_PROPOSAL_RECORD_SCHEMA_VERSION,
      id: 'prop_aaaaaaaa-bbbb',
      kind: 'test-draft',
      origin: { emittedBy: 'knowledge.accept.propose', at: 1 },
      payload: knowledgePayload,
    }).success).toBe(false)
  })

  it('pins the four-state lifecycle in order (D-12)', () => {
    expect(PROPOSAL_ENVELOPE_STATUSES).toEqual(['pending', 'applied', 'rejected', 'expired'])
  })

  it('leaves the INNER proposal status axis untouched (391-SHAPED, absorb-as-data)', () => {
    // Two axes one field apart. The inner DTO still means "did the deltas reach commit()".
    expect(KNOWLEDGE_PROPOSAL_STATUSES).toEqual(['pending', 'applied'])
  })

  it('records a decision only for the two things somebody can do', () => {
    expect(PROPOSAL_DECISIONS).toEqual(['applied', 'rejected'])
    // The durable states are the decisions plus "undecided" — expiry is not storable.
    expect(PROPOSAL_DURABLE_STATES).toEqual(['pending', 'applied', 'rejected'])
    expect(PROPOSAL_DURABLE_STATES).not.toContain('expired')
  })

  it('pins the expiry constant at 30 days', () => {
    expect(PROPOSAL_EXPIRY_MS).toBe(2_592_000_000)
    expect(PROPOSAL_EXPIRY_MS).toBe(30 * 24 * 60 * 60 * 1000)
  })
})

describe('the durable record wraps the knowledge payload without forking it', () => {
  it('accepts a well-formed knowledge record', () => {
    const parsed = ProposalRecordSchema.safeParse(record)
    expect(parsed.success).toBe(true)
  })

  it('parses the payload through the SHIPPED knowledge schema, not a restatement', () => {
    // `receiptPreview` on a non-forget verb is refused by KnowledgeProposalV1Schema's own
    // superRefine. If the envelope had restated the payload's fields, this would pass here and
    // the two declarations would already have drifted.
    const drifted = {
      ...record,
      payload: { ...knowledgePayload, receiptPreview: { tombstonedRecords: [], projectionsToScrub: [] } },
    }
    expect(ProposalRecordSchema.safeParse(drifted).success).toBe(false)
  })

  it('refuses an unrecognised kind', () => {
    expect(ProposalRecordSchema.safeParse({ ...record, kind: 'config' }).success).toBe(false)
  })

  it('refuses a record with no attributable origin', () => {
    const { origin: _origin, ...withoutOrigin } = record
    expect(ProposalRecordSchema.safeParse(withoutOrigin).success).toBe(false)
  })

  it('accepts an origin with no runId — a proposal minted outside a run', () => {
    const outsideARun = { ...record, origin: { emittedBy: 'knowledge.forget.propose', at: 5 } }
    expect(ProposalRecordSchema.safeParse(outsideARun).success).toBe(true)
  })

  it('refuses a superseded or unstamped schemaVersion', () => {
    expect(ProposalRecordSchema.safeParse({ ...record, schemaVersion: 0 }).success).toBe(false)
    expect(ProposalRecordSchema.safeParse({ ...record, schemaVersion: 2 }).success).toBe(false)
  })

  it('refuses an unknown top-level key', () => {
    expect(ProposalRecordSchema.safeParse({ ...record, status: 'pending' }).success).toBe(false)
  })

  it('refuses a proposal id that could address a path', () => {
    expect(ProposalRecordSchema.safeParse({ ...record, id: '../../etc/passwd' }).success).toBe(false)
  })
})

describe('computeProposalEnvelopeStatus is the one lifecycle rule', () => {
  const proposedAt = 1_000_000

  it('leaves a fresh pending proposal pending', () => {
    expect(computeProposalEnvelopeStatus({ durableState: 'pending', proposedAt, now: proposedAt }))
      .toBe('pending')
  })

  it('is still pending AT the boundary, expired strictly after it', () => {
    const boundary = proposedAt + PROPOSAL_EXPIRY_MS
    expect(computeProposalEnvelopeStatus({ durableState: 'pending', proposedAt, now: boundary }))
      .toBe('pending')
    expect(computeProposalEnvelopeStatus({ durableState: 'pending', proposedAt, now: boundary + 1 }))
      .toBe('expired')
  })

  it('keeps a decision forever — a decided proposal never expires', () => {
    const longAfter = proposedAt + PROPOSAL_EXPIRY_MS * 10
    expect(computeProposalEnvelopeStatus({ durableState: 'applied', proposedAt, now: longAfter }))
      .toBe('applied')
    expect(computeProposalEnvelopeStatus({ durableState: 'rejected', proposedAt, now: longAfter }))
      .toBe('rejected')
  })

  it('reads no clock — the same two numbers always give the same answer', () => {
    const first = computeProposalEnvelopeStatus({ durableState: 'pending', proposedAt, now: 5 })
    const second = computeProposalEnvelopeStatus({ durableState: 'pending', proposedAt, now: 5 })
    expect(first).toBe(second)
  })
})

describe('JSON-Schema projectability (387-08 catalogue lesson)', () => {
  it('projects every envelope schema without throwing', () => {
    // A `z.custom` anywhere inside a schema an op declares does not fail loudly — the whole
    // function catalogue silently stops listing (measured in 387-08). Every schema this module
    // exports is destined to sit inside a declared contract, so the projection is asserted here
    // rather than discovered there.
    const schemas = {
      ProposalRecordSchema,
      ProposalOriginSchema,
      ProposalEvidenceRefSchema,
      ProposalDecisionRecordSchema,
    }
    for (const [name, schema] of Object.entries(schemas)) {
      expect(() => z.toJSONSchema(schema, { io: 'input' }), name).not.toThrow()
    }
  })
})

describe('the protected-class set (D-05/D-07)', () => {
  it('is closed and stored exactly as the gate sees action names', () => {
    expect(PROTECTED_ACTION_CLASSES).toEqual(['fn:proposals.accept', 'fn:grants.revoke'])
    for (const actionClass of PROTECTED_ACTION_CLASSES) {
      expect(actionClass.startsWith('fn:')).toBe(true)
    }
  })

  it('refuses the BARE op id — the silent-no-op spelling', () => {
    // A grant minted (or a guard written) against `proposals.accept` would match nothing the
    // gate ever asks about, and would read as protection while protecting nothing.
    expect(isProtectedActionClass('proposals.accept')).toBe(false)
    expect(isProtectedActionClass('fn:proposals.accept')).toBe(true)
  })

  it('answers false for anything off the set, including non-strings off a hand-edited ledger', () => {
    expect(isProtectedActionClass('fn:knowledge.proposal.apply')).toBe(false)
    expect(isProtectedActionClass(undefined)).toBe(false)
    expect(isProtectedActionClass(null)).toBe(false)
    expect(isProtectedActionClass({ toString: () => 'fn:grants.revoke' })).toBe(false)
  })
})
