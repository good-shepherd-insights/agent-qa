// The two kinds 394 mints, in the store that refused them by name (394-18 · WTST-05).
//
// THE DEFECT THIS FILE WAS WRITTEN AGAINST. `ProposalRecordSchema` has carried three kinds since
// 394-06, and this store could hold exactly one of them: `writePendingProposal` took a
// `KnowledgeProposalV1`, and `extractStoredProposal` threw a named `TypeError` at every other kind
// with the sentence "that kind is stored elsewhere" — while nothing anywhere else stored one. So a
// verified draft and a finding were artifacts the loop could produce and no host could keep, which
// is why the funnel's `accepted` stage was structurally 0 on every host (WINDOWS 99 / 102).
//
// EVERY STORED DOCUMENT HERE IS PRODUCED, NEVER WRITTEN (gap_round_contract point 4). Not one file
// in this file's fixtures is hand-assembled JSON: the store's own write verbs mint them and the
// store's own listing reads them back. A corpus assembled as literals can pin a document the
// writers cannot make, and a persistence suite is precisely where that bites.
//
// THE PAYLOADS are parsed through the SHIPPED arm schemas rather than cast, so a cell cannot pin a
// payload shape production is incapable of producing. What they are NOT is a claim that this store
// can invent a draft: the end-to-end mint through `authoring.draft.write` lives in `agent-local`,
// which is the one package that may name both this store and that op.

import {
  FindingProposalV1Schema,
  KnowledgeProposalV1Schema,
  ProposalRecordSchema,
  TestDraftProposalV1Schema,
} from '@vostride/agent-qa-schema'
import type {
  FindingProposalV1,
  KnowledgeProposalV1,
  ProposalRecord,
  TestDraftProposalV1,
} from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'

import { extractStoredProposal } from '../proposals-store.js'

const TEST_DRAFT_ID = 'prop_01j9zzkq7x8q4m6n2r5t3v7w9a'
const FINDING_ID = 'prop_01j9zzkq7x8q4m6n2r5t3v7w9b'
const KNOWLEDGE_ID = 'prop_01j9zzkq7x8q4m6n2r5t3v7w9c'

/** A draft proposal payload, parsed through the SHIPPED arm rather than cast into place. */
function testDraftPayload(overrides: Partial<TestDraftProposalV1> = {}): TestDraftProposalV1 {
  return TestDraftProposalV1Schema.parse({
    schemaVersion: 1,
    draftRef: {
      filePath: 'tests/.agent-qa-drafts/deadbeef.yaml',
      testId: 't_deadbeef',
      testName: 'The coupon banner appears after a code is applied',
      contentDigest: 'deadbeef',
    },
    targetPath: 'tests/the-coupon-banner-appears-after-a-code-is-applied.yaml',
    disposition: 'keep-eligible',
    runsPreviewed: 9,
    runsConsumed: 3,
    repairIterations: 0,
    summaryLine: 'The coupon banner appears after a code is applied — keep-eligible',
    ...overrides,
  })
}

function findingPayload(overrides: Partial<FindingProposalV1> = {}): FindingProposalV1 {
  return FindingProposalV1Schema.parse({
    schemaVersion: 1,
    draftRef: {
      filePath: 'tests/.agent-qa-drafts/cafebabe.yaml',
      testId: 't_cafebabe',
      testName: 'Applying an expired coupon shows an error',
      contentDigest: 'cafebabe',
    },
    signalClass: 'definitive-failure',
    failurePoint: {
      runId: 'run_finding_1',
      stepIndex: 2,
      stepText: 'Verify the error banner is visible',
      reasoning: 'the banner never rendered',
    },
    evidenceRefs: [
      {
        runId: 'run_finding_1',
        filePath: 'tests/.agent-qa-drafts/cafebabe.yaml',
        testName: 'Applying an expired coupon shows an error',
        stepIndex: 2,
        channel: 'step-trace',
      },
    ],
    explanation: 'the application accepted an expired coupon',
    ...overrides,
  })
}

function knowledgePayload(proposalId = KNOWLEDGE_ID, proposedAt = 1_000): KnowledgeProposalV1 {
  return KnowledgeProposalV1Schema.parse({
    schemaVersion: 1,
    proposalId,
    verb: 'accept',
    targetRef: { grain: 'record', recordId: 'rec_1' },
    deltas: [],
    proposedAt,
    status: 'pending',
  })
}

/** A record, assembled through the SHIPPED envelope schema — never a cast. */
function testDraftRecord(id = TEST_DRAFT_ID, at = 2_000): ProposalRecord {
  return ProposalRecordSchema.parse({
    schemaVersion: 1,
    id,
    kind: 'test-draft',
    origin: { emittedBy: 'authoring.draft.write', runId: 'run_gate_3', at },
    payload: testDraftPayload(),
  })
}

function findingRecord(id = FINDING_ID, at = 3_000): ProposalRecord {
  return ProposalRecordSchema.parse({
    schemaVersion: 1,
    id,
    kind: 'finding',
    origin: { emittedBy: 'authoring.draft.write', at },
    payload: findingPayload(),
  })
}

describe('the store extracts every kind the envelope discriminates (394-18)', () => {
  it('reads a test-draft record back as a test-draft, rather than refusing it by name', () => {
    // THE RED. Before this plan the line below threw
    //   TypeError: the knowledge proposals store was handed a test-draft proposal (prop_…);
    //   that kind is stored elsewhere and is not readable here
    // — a promise of an elsewhere nothing implemented.
    const stored = extractStoredProposal(testDraftRecord())

    expect(stored.kind).toBe('test-draft')
    expect(stored.id).toBe(TEST_DRAFT_ID)
    expect(stored.payload).toEqual(testDraftPayload())
    expect(stored.origin).toEqual({
      emittedBy: 'authoring.draft.write',
      runId: 'run_gate_3',
      at: 2_000,
    })
  })

  it('reads a finding record back as a finding', () => {
    const stored = extractStoredProposal(findingRecord())

    expect(stored.kind).toBe('finding')
    expect(stored.id).toBe(FINDING_ID)
    expect(stored.payload).toEqual(findingPayload())
  })

  it('still reads a wrapped KNOWLEDGE record, and a bare 387-era document, through one extractor', () => {
    const payload = knowledgePayload()
    const wrapped = ProposalRecordSchema.parse({
      schemaVersion: 1,
      id: payload.proposalId,
      kind: 'knowledge',
      origin: { emittedBy: 'knowledge.forget.propose', at: payload.proposedAt },
      payload,
    })

    expect(extractStoredProposal(wrapped)).toEqual({
      id: payload.proposalId,
      kind: 'knowledge',
      payload,
      origin: { emittedBy: 'knowledge.forget.propose', at: payload.proposedAt },
    })
    // The BARE 387-era document, through the SAME extractor — which is what "no migration" means.
    expect(extractStoredProposal(payload)).toEqual({
      id: payload.proposalId,
      kind: 'knowledge',
      payload,
    })
  })

  it('refuses an UNKNOWN kind by name — the only refusal the widening leaves standing', () => {
    let caught: unknown
    try {
      extractStoredProposal({ schemaVersion: 1, id: TEST_DRAFT_ID, kind: 'config', payload: {} })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(TypeError)
    expect((caught as Error).message).toContain('config')
  })

  it('refuses a MALFORMED record of a KNOWN kind at its own arm, rather than casting it through', () => {
    // A test-draft missing `summaryLine`: the discriminant is fine, the arm is not. The refusal
    // has to come from the arm's own parse, because a cast would compile and then fail at
    // whichever field a surface read first.
    const { summaryLine: _dropped, ...incomplete } = testDraftPayload()
    expect(() => extractStoredProposal({
      schemaVersion: 1,
      id: TEST_DRAFT_ID,
      kind: 'test-draft',
      origin: { emittedBy: 'authoring.draft.write', at: 2_000 },
      payload: incomplete,
    })).toThrow()
  })
})
