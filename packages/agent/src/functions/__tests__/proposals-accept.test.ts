// `proposals.accept`: two forms, one surface, and the mint that only the second one reaches
// (Phase 391, PROP-01 / D-01 · D-04 · D-06).
//
// WHAT THIS FILE MEASURES, and what it deliberately leaves to its agent-local sibling. The loop
// over the REAL committed ledger — propose, accept-with-always, a grant event on disk, the next ask
// satisfied by it — is `agent-local`'s `grant-loop.e2e.test.ts`, because `packages/agent` may not
// import `knowledge-local` and a stubbed ledger would prove nothing about a committed artifact.
// What lives HERE is the op's own contract: which deps it consults for each form, what it reports
// when the two halves disagree, and who it refuses.
//
// THE ASK IS REAL, AND REACHING IT WAS A DELIBERATE CHOICE. `proposals.accept` declares
// `mutating-shared`, so the gate's base verdict is `ask` in EVERY context. Its resolution ladder is
// trustMode → credential → standing grant → fail-closed → confirm, and TWO of those five doors are
// permanently shut for this op: `invokeFunction` passes no trust mode, and `fn:proposals.accept` is
// itself a member of the closed PROTECTED set, so no standing approval can ever satisfy it (D-05).
// In a default headless context the fail-closed arm therefore denies BEFORE any prompt — which
// means a suite that never chose a door would have passed while dispatching nothing at all.
//
// The door chosen here is `local-interactive` + a bound ConfirmPort, because it is the production
// path: the CLI host binds a terminal confirmation and the daemon binds none. The confirm is a SPY
// rather than a constant `true`, so every case below also carries evidence that the ask arm ran and
// that it ran for THIS action name. And the last case in the file is the control that keeps the
// door honest: the same call in a headless context denies, applies nothing and mints nothing.

import {
  FunctionScopeSchema,
  MASKED_RESOLVED_CONFIG_SCHEMA_VERSION,
  PROPOSAL_KINDS,
  isProtectedActionClass,
} from '@vostride/agent-qa-schema'
import type {
  ExecutionContext,
  FunctionCaller,
  GrantRecordInput,
  GrantRecordOutcome,
  KnowledgeProposalV1,
  ProposalInboxEntryDto,
  ProposalsAcceptOutput,
  RiskActionDescriptor,
  StandingGrantsPort,
} from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'

import { FunctionDeniedError, FunctionNotBoundError, FunctionOriginError, invokeFunction } from '../invoke.js'
import { KNOWLEDGE_PROPOSAL_APPLY_FUNCTION_ID } from '../ops/knowledge-proposal-apply.js'
import {
  APPLY_ACTION_CLASS_FOR_PROPOSAL_KIND,
  PROPOSALS_ACCEPT_FUNCTION_ID,
} from '../ops/proposals-accept.js'
import { createFunctionRegistry } from '../registry.js'
import type { FunctionRegistry } from '../registry.js'
import type { FunctionDeps, KnowledgeReviewPort } from '../spec.js'
import type { DraftApplyPortLike, TestDraftApplyRequestLike } from '../../authoring/ports.js'

const PROPOSAL_ID = 'prop_aaaaaaaa-bbbb'

/** A person, holding every scope, so a refusal can only ever be the axis under test. */
const HUMAN: FunctionCaller = {
  surface: 'test',
  grantedScopes: [...FunctionScopeSchema.options],
  safeMode: false,
  origin: 'human',
}

/** The same permissions, on behalf of the agent. ONLY `origin` differs. */
const AGENT: FunctionCaller = { ...HUMAN, origin: 'agent' }

function knowledgePayload(): KnowledgeProposalV1 {
  return {
    schemaVersion: 1,
    proposalId: PROPOSAL_ID,
    verb: 'accept',
    targetRef: { grain: 'record', recordId: 'rec-1' },
    deltas: [],
    proposedAt: 1_000_000,
    status: 'pending',
  }
}

/**
 * The KNOWLEDGE arm of the envelope, named once (394-06).
 *
 * `ProposalInboxEntryDto['envelope']` became a discriminated union when 394 added its two arms, and
 * `Partial<>` over a union distributes into a shape whose `kind` and `payload` are free to come
 * from different members — which is the very disagreement the discriminated form exists to refuse.
 * Narrowing to the arm this file actually drives keeps the overrides honest.
 */
type KnowledgeEnvelope = Extract<ProposalInboxEntryDto['envelope'], { kind: 'knowledge' }>

function inboxEntry(
  overrides: Partial<KnowledgeEnvelope> & { applyInFlight?: boolean } = {},
): ProposalInboxEntryDto {
  const { applyInFlight = false, ...envelope } = overrides
  return {
    applyInFlight,
    envelope: {
      id: PROPOSAL_ID,
      kind: 'knowledge',
      status: 'pending',
      evidenceRefs: [],
      payload: knowledgePayload(),
      ...envelope,
    },
  }
}

/**
 * The TEST-DRAFT arm (394-10, D-05/D-06), narrowed on the same reasoning as the knowledge one.
 *
 * `targetPath` and no `sourceDigest`, which is the LOOP's own case: a draft the loop authored is a
 * new file (D-02 — creation is not an edit), so an absent digest is the claim the host re-checks.
 */
function testDraftEntry(
  overrides: Partial<Extract<ProposalInboxEntryDto['envelope'], { kind: 'test-draft' }>> = {},
): ProposalInboxEntryDto {
  return {
    applyInFlight: false,
    envelope: {
      id: PROPOSAL_ID,
      kind: 'test-draft',
      status: 'pending',
      evidenceRefs: [],
      payload: {
        schemaVersion: 1,
        draftRef: {
          filePath: 'tests/.agent-qa-drafts/abc123.yaml',
          testId: 't_coupon',
          testName: 'The coupon banner appears',
          contentDigest: 'abc123',
        },
        targetPath: 'tests/the-coupon-banner-appears.yaml',
        disposition: 'keep-eligible',
        runsPreviewed: 9,
        runsConsumed: 3,
        repairIterations: 0,
        summaryLine: 'The coupon banner appears — keep-eligible',
      },
      ...overrides,
    },
  }
}

/**
 * The FINDING arm (D-11), for the acknowledge-only route.
 *
 * Narrowed the same way its two siblings are: the payload is correlated with the kind, so a route
 * that read this envelope as a test-draft's would not typecheck rather than render the wrong line.
 */
function findingEntry(
  overrides: Partial<Extract<ProposalInboxEntryDto['envelope'], { kind: 'finding' }>> = {},
): ProposalInboxEntryDto {
  return {
    applyInFlight: false,
    envelope: {
      id: PROPOSAL_ID,
      kind: 'finding',
      status: 'pending',
      evidenceRefs: [],
      payload: {
        schemaVersion: 1,
        draftRef: {
          filePath: 'tests/.agent-qa-drafts/def456.yaml',
          testId: 't_expired_coupon',
          testName: 'Applying an expired coupon shows an error',
          contentDigest: 'def456',
        },
        signalClass: 'definitive-failure',
        failurePoint: null,
        evidenceRefs: [],
        explanation: 'the application accepted an expired coupon',
      },
      ...overrides,
    },
  }
}

/** Records every one-commit apply, so "the write really happened" is observable. */
function recordingDraftApply(): { port: DraftApplyPortLike; calls: TestDraftApplyRequestLike[] } {
  const calls: TestDraftApplyRequestLike[] = []
  return {
    calls,
    port: {
      apply: (request) => {
        calls.push(request)
        return Promise.resolve({ filePath: request.targetPath, commit: 'c0ffee1' })
      },
    },
  }
}

/** Records what the mint was asked for, and answers whatever the case needs it to answer. */
function recordingGrants(
  answer: (input: GrantRecordInput) => GrantRecordOutcome = (input) => ({
    kind: 'recorded',
    grant: {
      grantId: 'grant_fixture',
      actionClass: input.actionClass,
      scope: input.scope,
      grantedAt: '2026-08-07T10:00:00.000Z',
      ...(input.proposalId === undefined ? {} : { proposalId: input.proposalId }),
    },
  }),
): { port: StandingGrantsPort; calls: GrantRecordInput[] } {
  const calls: GrantRecordInput[] = []
  return {
    calls,
    port: {
      list: () => Promise.resolve({ grants: [], refusedLines: [] }),
      revoke: ({ grantId }) => Promise.resolve({ outcome: 'no-grant', grantId }),
      record: (input) => {
        calls.push(input)
        return Promise.resolve(answer(input))
      },
    },
  }
}

/** Records every apply, so "the commit really happened" is observable beside the mint's answer. */
function recordingReview(): { port: KnowledgeReviewPort; applied: string[] } {
  const applied: string[] = []
  return {
    applied,
    port: {
      propose: () => Promise.reject(new Error('this file never proposes')),
      apply: (proposalId: string) => {
        applied.push(proposalId)
        return Promise.resolve({
          outcome: 'applied' as const,
          proposal: { ...knowledgePayload(), status: 'applied' as const },
        })
      },
    },
  }
}

interface Host {
  registry: FunctionRegistry
  grants: ReturnType<typeof recordingGrants>
  review: ReturnType<typeof recordingReview>
  draftApply: ReturnType<typeof recordingDraftApply>
  confirmed: RiskActionDescriptor[]
  /** The proposal ids the accept asked the inbox to CLOSE (394-18). */
  recordedApplied: string[]
}

function host(options: {
  context?: ExecutionContext
  entry?: ProposalInboxEntryDto | 'not-found'
  grantAnswer?: (input: GrantRecordInput) => GrantRecordOutcome
  /** Leave the one-commit apply UNBOUND, which is the host that cannot commit anything. */
  unboundDraftApply?: true
} = {}): Host {
  const grants = options.grantAnswer === undefined
    ? recordingGrants()
    : recordingGrants(options.grantAnswer)
  const review = recordingReview()
  const draftApply = recordingDraftApply()
  const confirmed: RiskActionDescriptor[] = []
  const recordedApplied: string[] = []
  const entry = options.entry ?? inboxEntry()

  const deps: FunctionDeps = {
    runs: {
      list: () => Promise.resolve([]),
      get: () => Promise.resolve(undefined),
      readEvents: () => Promise.resolve([]),
      readStepEvidence: () => Promise.resolve({ kind: 'run-not-recorded' } as const),
    },
    knowledge: {
      listBundles: () => Promise.resolve([]),
      inspectRecords: () => Promise.resolve([]),
      diffSince: () => Promise.resolve([]),
      showRecord: ({ recordId }) =>
        Promise.resolve({ kind: 'not-found', schemaVersion: 1, recordId } as const),
    },
    entities: {
      resolve: () => Promise.resolve({ kind: 'none' as const, reason: 'no-match' as const }),
      get: () => Promise.resolve(undefined),
    },
    config: {
      getMasked: () => Promise.resolve({
        schemaVersion: MASKED_RESOLVED_CONFIG_SCHEMA_VERSION,
        configPath: 'agent-qa.config.yaml',
        entries: [],
      }),
    },
    proposalsInbox: {
      list: () => Promise.resolve([]),
      reject: ({ proposalId }) => Promise.resolve({ outcome: 'not-found', proposalId }),
      show: ({ proposalId }) => Promise.resolve(
        entry === 'not-found'
          ? { kind: 'not-found' as const, proposalId }
          : { kind: 'found' as const, entry },
      ),
      // 394-18: the decision half, recorded so a later cell can assert the two authoring routes
      // close the proposal's lifecycle and the knowledge route does not.
      recordApplied: ({ proposalId }) => {
        recordedApplied.push(proposalId)
        return Promise.resolve({ outcome: 'recorded' as const })
      },
    },
    knowledgeReview: review.port,
    standingGrants: grants.port,
    ...(options.unboundDraftApply === true ? {} : { draftApply: draftApply.port }),
  }

  return {
    grants,
    review,
    draftApply,
    confirmed,
    recordedApplied,
    registry: createFunctionRegistry({
      deps,
      auditSink: { appendExecutionAudit() {}, appendGuardrailAudit() {} },
      resolveExecutionContext: () => options.context ?? 'local-interactive',
      // THE DOOR, bound explicitly. A spy rather than `() => true` so every case that dispatches
      // also proves the ask arm was consulted, and consulted about the right action.
      confirm: {
        surface: 'tty-prompt',
        ask: (action: RiskActionDescriptor) => {
          confirmed.push(action)
          return true
        },
      },
    }),
  }
}

async function accept(built: Host, input: unknown, caller = HUMAN): Promise<ProposalsAcceptOutput> {
  return await invokeFunction(
    built.registry,
    PROPOSALS_ACCEPT_FUNCTION_ID,
    input,
    caller,
  ) as ProposalsAcceptOutput
}

describe('proposals.accept — plain applies, always escalates (D-01)', () => {
  it('applies THIS proposal and mints nothing, never touching the grants port', async () => {
    const built = host()

    const answer = await accept(built, { proposalId: PROPOSAL_ID })

    expect(answer.apply.outcome).toBe('applied')
    expect(built.review.applied).toEqual([PROPOSAL_ID])
    expect(answer.grant).toEqual({ kind: 'not-requested' })
    // NOT "the mint declined" — the mint was never asked. That is the difference between a rule
    // enforced in the mint and a rule enforced at the decision, and D-01 is the second one.
    expect(built.grants.calls).toEqual([])
    // The evidence that the gate's ask arm actually ran, rather than the tier having been lowered
    // or the verdict having come from somewhere else.
    expect(built.confirmed.map((action) => action.name)).toEqual([`fn:${PROPOSALS_ACCEPT_FUNCTION_ID}`])
  })

  it('records exactly one grant on the always form, for the class the apply actually used', async () => {
    const built = host()

    const answer = await accept(built, { proposalId: PROPOSAL_ID, always: true })

    expect(answer.apply.outcome).toBe('applied')
    expect(built.review.applied).toEqual([PROPOSAL_ID])
    // EXACTLY ONE. A second call here would be a second approval for one decision, and the
    // ledger's own already-granted arm would then be papering over a bug in this op.
    expect(built.grants.calls).toHaveLength(1)
    expect(built.grants.calls[0]).toEqual({
      // PRODUCED, not typed: the class is the registered apply op's own `risk.name`. The
      // registry-derived pin below is what makes that a measurement rather than a coincidence.
      actionClass: `fn:${KNOWLEDGE_PROPOSAL_APPLY_FUNCTION_ID}`,
      scope: { project: 'local-workspace' },
      // The provenance link back to the decision that widened autonomy — the ONLY copy of that
      // relation, because the envelope deliberately carries no grant reference.
      proposalId: PROPOSAL_ID,
    })
    expect(answer.grant).toMatchObject({ kind: 'recorded' })
  })

  it('reads the covered class off the REGISTERED apply op, for every proposal kind', () => {
    const built = host()
    const declarations = built.registry.list(HUMAN)

    // The produced-not-literal rule, machine-checked. If the apply op renamed itself, this table
    // follows it; a literal in the op would have gone on covering a name nothing carries.
    expect(APPLY_ACTION_CLASS_FOR_PROPOSAL_KIND.knowledge).toBe(
      declarations.find((entry) => entry.id === KNOWLEDGE_PROPOSAL_APPLY_FUNCTION_ID)?.risk.name,
    )
    // TOTAL over the kind vocabulary rather than over the one kind this file drives, so 393-396's
    // arms cannot arrive without an answer here.
    expect(Object.keys(APPLY_ACTION_CLASS_FOR_PROPOSAL_KIND).sort()).toEqual([...PROPOSAL_KINDS].sort())
    // The table's other two claims — that EVERY entry is a class the live registry carries, and
    // which entries are protected — are ranged in `apply-action-classes.test.ts` (394-16). They
    // live in one place so a second copy cannot answer differently.
  })

  it('reports a mint refusal BESIDE a successful apply, never instead of it', async () => {
    const built = host({
      grantAnswer: (input) => ({ kind: 'protected-class', actionClass: input.actionClass }),
    })

    const answer = await accept(built, { proposalId: PROPOSAL_ID, always: true })

    // Both halves, truthfully. Folding these into one outcome would force a choice between losing
    // the receipt for a commit that really happened and swallowing a sovereignty refusal.
    expect(answer.apply.outcome).toBe('applied')
    expect(built.review.applied).toEqual([PROPOSAL_ID])
    expect(answer.grant).toEqual({
      kind: 'protected-class',
      actionClass: `fn:${KNOWLEDGE_PROPOSAL_APPLY_FUNCTION_ID}`,
    })
  })

  it('mints nothing when the apply did not happen, and says which of the two it was', async () => {
    const built = host({ entry: 'not-found' })

    const answer = await accept(built, { proposalId: PROPOSAL_ID, always: true })

    expect(answer.apply).toEqual({ outcome: 'not-found', proposalId: PROPOSAL_ID })
    expect(built.review.applied).toEqual([])
    // `not-applied` rather than `not-requested`: the escalation WAS asked for, and a surface has
    // to be able to tell "you did not ask" from "you asked and nothing was granted".
    expect(answer.grant).toEqual({ kind: 'not-applied' })
    expect(built.grants.calls).toEqual([])
  })

  it('refuses an already-rejected, an expired and an in-flight proposal without applying', async () => {
    for (const [entry, expected] of [
      [inboxEntry({ status: 'rejected' }), 'already-rejected'],
      [inboxEntry({ status: 'expired' }), 'expired'],
      [inboxEntry({ applyInFlight: true }), 'apply-in-flight'],
    ] as const) {
      const built = host({ entry })
      const answer = await accept(built, { proposalId: PROPOSAL_ID, always: true })

      expect(answer.apply.outcome, expected).toBe(expected)
      expect(built.review.applied, expected).toEqual([])
      expect(built.grants.calls, expected).toEqual([])
    }
  })
})

describe('proposals.accept — who may decide (D-06)', () => {
  it('refuses an agent-origin caller for both forms, before anything is applied or minted', async () => {
    for (const input of [{ proposalId: PROPOSAL_ID }, { proposalId: PROPOSAL_ID, always: true }]) {
      const built = host()

      await expect(accept(built, input, AGENT)).rejects.toBeInstanceOf(FunctionOriginError)
      // The refusal is PRE-DISPATCH: nothing applied, nothing minted, and the gate was never even
      // consulted (the origin check sits in the pre-gate band, after scopes).
      expect(built.review.applied).toEqual([])
      expect(built.grants.calls).toEqual([])
      expect(built.confirmed).toEqual([])
    }
  })

  it('lets the SAME permissions through when the origin is human — the control', async () => {
    const built = host()
    await expect(accept(built, { proposalId: PROPOSAL_ID }, HUMAN)).resolves.toMatchObject({
      apply: { outcome: 'applied' },
    })
  })

  it('declares the requirement on the declaration a listing renders (D-16)', () => {
    const declaration = host().registry
      .list(HUMAN)
      .find((entry) => entry.id === PROPOSALS_ACCEPT_FUNCTION_ID)

    expect(declaration?.requiresHumanOrigin).toBe(true)
    expect(declaration?.risk.declaredTier).toBe('mutating-shared')
    expect([...(declaration?.requiredScopes ?? [])].sort()).toEqual([
      'approval-write',
      'knowledge-write',
    ])
  })
})

describe('proposals.accept — the door, and what happens without it', () => {
  it('denies in a fail-closed context, applying nothing and minting nothing', async () => {
    // THE CONTROL that keeps every case above meaningful. If the ask were not real — if the tier
    // were lower, or the gate were being skipped — this call would succeed exactly like the others.
    // It also states the shipped posture plainly: under the daemon and in CI an accept with no
    // credential DENIES, and the ways through are a terminal confirmation or session trust.
    const built = host({ context: 'local-headless' })

    await expect(accept(built, { proposalId: PROPOSAL_ID, always: true }))
      .rejects.toBeInstanceOf(FunctionDeniedError)
    expect(built.review.applied).toEqual([])
    expect(built.grants.calls).toEqual([])
    // The prompt was never reached: fail-closed fires ahead of it, which is the arm every
    // non-interactive host lands on.
    expect(built.confirmed).toEqual([])
  })
})

describe('the decision is RECORDED where the apply is not itself a commit (394-18)', () => {
  it('closes a test-draft proposal in the store after the commit succeeds', async () => {
    const built = host({ entry: testDraftEntry() })

    const answer = await accept(built, { proposalId: PROPOSAL_ID })

    expect(answer.apply.outcome).toBe('applied')
    // WITHOUT THIS the envelope stays `pending` forever, the inbox keeps asking for a decision a
    // person already made, and `projectAuthoringFunnel` reads no `decision` — which is exactly why
    // `accepted` was structurally 0 on every host (WINDOWS 102).
    expect(built.recordedApplied).toEqual([PROPOSAL_ID])
  })

  it('closes a FINDING proposal too — the acknowledgement is the whole of what accepting does', async () => {
    const built = host({ entry: findingEntry() })

    const answer = await accept(built, { proposalId: PROPOSAL_ID })

    expect(answer.apply).toMatchObject({
      applied: { kind: 'finding', outcome: { acknowledged: true } },
    })
    expect(built.recordedApplied).toEqual([PROPOSAL_ID])
    // No file and no commit: D-11's record-and-surface, with the record being the whole effect.
    expect(built.draftApply.calls).toEqual([])
  })

  it('does NOT record for a KNOWLEDGE accept — that apply publishes its own decision', async () => {
    // THE TWO-SIDED CONTROL, and the one that makes the two cells above mean something. A recorder
    // called on every route would write a second, differently-timed answer to when a knowledge
    // proposal was decided, one rename away from the record `publishAppliedProposal` already wrote.
    const built = host()

    const answer = await accept(built, { proposalId: PROPOSAL_ID })

    expect(answer.apply.outcome).toBe('applied')
    expect(built.review.applied).toEqual([PROPOSAL_ID])
    expect(built.recordedApplied).toEqual([])
  })

  it('files nothing to record when the apply itself refused', async () => {
    const built = host({ entry: testDraftEntry({ status: 'expired' }) })

    const answer = await accept(built, { proposalId: PROPOSAL_ID })

    expect(answer.apply.outcome).toBe('expired')
    expect(built.recordedApplied).toEqual([])
  })
})

describe('proposals.accept — the test-draft route (394-10, D-05/D-06)', () => {
  it('reaches the bound one-commit apply, carrying the arm the envelope actually holds', async () => {
    const built = host({ entry: testDraftEntry() })

    const answer = await accept(built, { proposalId: PROPOSAL_ID })

    expect(answer.apply.outcome).toBe('applied')
    // THE PAYLOAD TRAVELS, and the assertion is on the values rather than on "it was called": a
    // route that reached the port with a target it recomputed for itself would pass a call count
    // and would write to a path the proposal's own `sourceDigest` was never taken over.
    expect(built.draftApply.calls).toEqual([{
      proposalId: PROPOSAL_ID,
      draftPath: 'tests/.agent-qa-drafts/abc123.yaml',
      targetPath: 'tests/the-coupon-banner-appears.yaml',
      summaryLine: 'The coupon banner appears — keep-eligible',
    }])
    expect(answer.apply).toMatchObject({
      applied: { kind: 'test-draft', outcome: { filePath: 'tests/the-coupon-banner-appears.yaml', commit: 'c0ffee1' } },
    })
    // The KNOWLEDGE port was never touched — the route is per kind, not a fallback.
    expect(built.review.applied).toEqual([])
  })

  it('carries a sourceDigest through when the proposal has one, and omits it when it does not', async () => {
    // The edit op's case: a proposal against an EXISTING committed test carries that file's digest.
    const withDigest = testDraftEntry({
      payload: {
        ...testDraftEntry().envelope.payload as Extract<ProposalInboxEntryDto['envelope'], { kind: 'test-draft' }>['payload'],
        targetPath: 'tests/checkout.yaml',
        sourceDigest: 'd1d1d1',
      },
    })
    const built = host({ entry: withDigest })

    await accept(built, { proposalId: PROPOSAL_ID })

    expect(built.draftApply.calls[0]?.sourceDigest).toBe('d1d1d1')
    // And the absent direction, so "it forwards the field" is not satisfied by always sending one.
    const plain = host({ entry: testDraftEntry() })
    await accept(plain, { proposalId: PROPOSAL_ID })
    expect(Object.keys(plain.draftApply.calls[0] ?? {})).not.toContain('sourceDigest')
  })

  it('refuses BY NAME when the one-commit apply is unbound, and writes nothing', async () => {
    // A wrong answer wearing a correct one's clothes is the failure this refusal exists to prevent:
    // an accept that reported `applied` would leave the inbox showing a decision the repository
    // never received, and send a person looking for a commit that is not there.
    const built = host({ entry: testDraftEntry(), unboundDraftApply: true })

    await expect(accept(built, { proposalId: PROPOSAL_ID }))
      .rejects.toBeInstanceOf(FunctionNotBoundError)
    expect(built.draftApply.calls).toEqual([])
    expect(built.grants.calls).toEqual([])
  })

  it('asks the mint for THIS verb’s own class on the always form — 394-16, CR-04', async () => {
    const built = host({ entry: testDraftEntry() })

    const answer = await accept(built, { proposalId: PROPOSAL_ID, always: true })

    expect(answer.apply.outcome).toBe('applied')
    expect(built.grants.calls.map((call) => call.actionClass))
      .toEqual([APPLY_ACTION_CLASS_FOR_PROPOSAL_KIND['test-draft']])
    // The write rides the `draftApply` PORT, which carries no class of its own for a gate to
    // evaluate, so the class asked for is the accept's — and it is protected. The refusal that
    // follows from that is driven end to end in `apply-action-classes.test.ts`; the fake mint here
    // does not carry the protection rule, so this cell asserts only what it can see.
    expect(built.grants.calls[0]?.actionClass).toBe(`fn:${PROPOSALS_ACCEPT_FUNCTION_ID}`)
    expect(isProtectedActionClass(built.grants.calls[0]?.actionClass)).toBe(true)
  })

  it('rejects rather than applies when the envelope is already rejected — nothing is written', async () => {
    const rejected = testDraftEntry({ status: 'rejected' })
    const built = host({ entry: rejected })

    const answer = await accept(built, { proposalId: PROPOSAL_ID })

    expect(answer.apply.outcome).toBe('already-rejected')
    expect(built.draftApply.calls).toEqual([])
  })
})
