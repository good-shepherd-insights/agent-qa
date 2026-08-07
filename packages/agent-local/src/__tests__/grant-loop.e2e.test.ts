// THE grant loop, end to end over one composition and one committed ledger (Phase 391, PROP-01).
//
// 391-01's tracer proved the READ half — a grant appended by hand through the real append API is
// consumed by the shipped gate, and a revoke takes it back. This file closes the loop by removing
// the hand: every event in `grants.jsonl` below is authored by a person accepting a proposal, and
// the ask it later satisfies is the shipped `knowledge.proposal.apply`.
//
//   leg 1  a real KREV proposal, minted through the propose verb, listed in the inbox
//   leg 2  PLAIN accept -> the proposal applies and the ledger file does not even exist
//   leg 3  a second proposal, accept WITH ALWAYS -> it applies AND exactly one grant event lands,
//          carrying the class read off the apply op's own declaration and the proposal's id
//   leg 4  a third proposal, applied in a HEADLESS context -> ALLOWED, and the audit row names
//          `standing-approval` as what satisfied the ask. This is the loop: a decision a person
//          made through the function layer is what lets a later headless run commit unasked.
//   leg 5  `grants.revoke` -> the same headless apply is refused again, and BOTH events survive
//
// THE DOOR IS NAMED, because `proposals.accept` and `grants.revoke` are both `mutating-shared` AND
// both members of the closed PROTECTED set — so no standing approval can ever satisfy their own
// asks (D-05), and in a fail-closed context they simply deny. The door used here is
// `local-interactive` + a bound ConfirmPort, which is exactly the CLI host's production path. The
// confirm is a SPY, so each decision below also carries evidence that the ask arm ran for that
// action; and leg 4's apply runs in a HEADLESS context precisely so the grant is the only thing
// that could have satisfied it — a prompt there would have made the whole file prove nothing.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  FunctionDeniedError,
  FunctionOriginError,
  createFunctionRegistry,
  invokeFunction,
} from '@vostride/agent-qa-agent'
import type { FunctionRegistry } from '@vostride/agent-qa-agent'
import {
  createGrantOperations,
  createProposalsInbox,
  createStandingApprovalReader,
  grantsLedgerPath,
  publishBundleForTest,
} from '@vostride/agent-qa-knowledge-local'
import type { BundleStoreConfig } from '@vostride/agent-qa-knowledge-local'
import {
  FunctionScopeSchema,
  MASKED_RESOLVED_CONFIG_SCHEMA_VERSION,
  STANDING_APPROVAL_SCOPE,
} from '@vostride/agent-qa-schema'
import type {
  Anchor,
  ExecutionContext,
  FunctionCaller,
  GrantLedgerEvent,
  GrantsListOutput,
  GrantsRevokeOutput,
  KnowledgeApplyOutcomeDto,
  KnowledgeProposeOutcomeDto,
  MaskedResolvedConfig,
  ProposalsAcceptOutput,
  ProposalsListOutput,
  RiskActionDescriptor,
} from '@vostride/agent-qa-schema'
import type { AuditSink, ExecutionAuditRow, GuardrailAuditRow } from '@vostride/agent-qa-safety'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  createKnowledgeReader,
  createKnowledgeReview,
  createRunsReader,
} from '../composition/compose-local-agent.js'

const APPLY_ID = 'knowledge.proposal.apply'
const PROPOSE_ID = 'knowledge.forget.propose'
const ACCEPT_ID = 'proposals.accept'
const GRANTS_LIST_ID = 'grants.list'
const GRANTS_REVOKE_ID = 'grants.revoke'
const PROPOSALS_LIST_ID = 'proposals.list'

const NOW_ISO = '2026-08-07T12:00:00.000Z'

const ANCHOR: Anchor = { t: 'el', role: 'Button', name: 'Checkout' }

const MASKED_CONFIG: MaskedResolvedConfig = {
  schemaVersion: MASKED_RESOLVED_CONFIG_SCHEMA_VERSION,
  configPath: '/fixture/agent-qa.config.yaml',
  entries: [],
}

/** A person holding every scope, so a refusal below can only ever be policy's or origin's. */
const HUMAN: FunctionCaller = {
  surface: 'test',
  grantedScopes: [...FunctionScopeSchema.options],
  safeMode: false,
  origin: 'human',
}

/** The same permissions, on behalf of the agent. ONLY `origin` differs. */
const AGENT: FunctionCaller = { ...HUMAN, origin: 'agent' }

function capturingSink(): AuditSink & { rows: ExecutionAuditRow[] } {
  const rows: ExecutionAuditRow[] = []
  return {
    rows,
    appendExecutionAudit(row: ExecutionAuditRow) {
      rows.push(row)
    },
    appendGuardrailAudit(_row: GuardrailAuditRow) {},
  }
}

describe('the grant loop: a person accepts with always, and a later headless apply commits', () => {
  let root: string
  let knowledgeRoot: string
  let agentQaRoot: string
  let sink: ReturnType<typeof capturingSink>
  let confirmed: RiskActionDescriptor[]

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'grant-loop-'))
    knowledgeRoot = join(root, 'agent-qa-knowledge')
    agentQaRoot = join(root, '.agent-qa')
    mkdirSync(agentQaRoot, { recursive: true })
    sink = capturingSink()
    confirmed = []
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function storeConfig(): BundleStoreConfig {
    return {
      knowledgeRoot,
      productKey: 'Grant Loop Product',
      auditBaseDir: agentQaRoot,
      commitArtifacts: 'none',
    }
  }

  /** A real published record, so each proposal below has something real to be about. */
  function publish(seed: string): string {
    const outcome = publishBundleForTest(storeConfig(), {
      draft: {
        kind: 'fact',
        subtype: 'selector',
        anchors: [ANCHOR],
        scope: { tier: 'product', key: `grant-loop-${seed}` },
        summary: `checkout button ${seed}`,
        body: `Selecting Checkout advances to the payment page (${seed}).`,
        distilledEvidenceRef: { id: `grant-loop-${seed}`, sha: 'a'.repeat(64) },
        originStage: 'run-curation',
      },
      discriminant: {
        kind: 'fact',
        subtype: 'selector',
        elementRef: { role: 'Button', name: `Checkout ${seed}` },
      },
      originClass: 'agent-verified',
      createdAtOrdinal: 9,
      screenStates: [],
      initialEvents: [],
      relations: [],
      provenance: { mode: 'run-linked', runId: 'grant-loop', testId: 't', stepIndex: 0 },
      artifacts: [],
    })
    if (outcome.kind !== 'published') throw new Error(`fixture publish failed: ${outcome.kind}`)
    return outcome.id
  }

  /**
   * The composition under test: REAL inbox, REAL grant verbs, REAL committed ledger, REAL reader.
   *
   * Nothing about the policy answer is stubbed — every leg below changes the gate's behaviour by
   * changing a file, through a verb a person invoked.
   */
  function host(context: ExecutionContext): FunctionRegistry {
    return createFunctionRegistry({
      deps: {
        runs: createRunsReader(agentQaRoot),
        knowledge: createKnowledgeReader(() => knowledgeRoot),
        config: { getMasked: () => Promise.resolve(MASKED_CONFIG) },
        entities: {
          resolve: () => Promise.resolve({ kind: 'none' as const, reason: 'no-match' as const }),
          get: () => Promise.resolve(undefined),
        },
        knowledgeReview: createKnowledgeReview({
          agentQaRoot,
          resolveKnowledgeRoot: () => knowledgeRoot,
        }),
        proposalsInbox: createProposalsInbox({
          resolveAgentQaRoot: () => agentQaRoot,
          now: () => Date.parse(NOW_ISO),
        }),
        standingGrants: createGrantOperations({
          resolveKnowledgeRoot: () => knowledgeRoot,
          auditBaseDir: agentQaRoot,
          now: () => NOW_ISO,
        }),
      },
      auditSink: sink,
      standingApprovalReader: () => createStandingApprovalReader({ knowledgeRoot }),
      resolveExecutionContext: () => context,
      confirm: (action) => {
        confirmed.push(action)
        return true
      },
    })
  }

  function committedEvents(): GrantLedgerEvent[] {
    if (!existsSync(grantsLedgerPath(knowledgeRoot))) return []
    return readFileSync(grantsLedgerPath(knowledgeRoot), 'utf8')
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as GrantLedgerEvent)
  }

  async function propose(registry: FunctionRegistry, recordId: string): Promise<string> {
    const proposed = (await invokeFunction(
      registry,
      PROPOSE_ID,
      { target: { grain: 'record', recordId } },
      HUMAN,
    )) as KnowledgeProposeOutcomeDto
    if (proposed.kind !== 'proposed') throw new Error(`expected a proposal, got ${proposed.kind}`)
    return proposed.proposal.proposalId
  }

  it('mints on the always form only, and the mint is what lets a headless apply commit', async () => {
    const interactive = host('local-interactive')
    const headless = host('local-headless')

    // ── LEG 1: a real proposal, reachable through the inbox a person reads.
    const firstProposal = await propose(interactive, publish('one'))
    const listed = (await invokeFunction(
      interactive,
      PROPOSALS_LIST_ID,
      { status: 'pending' },
      HUMAN,
    )) as ProposalsListOutput
    expect(listed.entries.map((entry) => entry.envelope.id)).toEqual([firstProposal])

    // ── LEG 2: PLAIN accept. It applies, and no ledger comes into existence at all.
    const plain = (await invokeFunction(
      interactive,
      ACCEPT_ID,
      { proposalId: firstProposal },
      HUMAN,
    )) as ProposalsAcceptOutput
    expect(plain.apply.outcome).toBe('applied')
    expect(plain.grant).toEqual({ kind: 'not-requested' })
    // The strongest form of "mints nothing": not an empty ledger — no ledger. And it is only
    // meaningful because leg 3 below shows the SAME verb on the SAME host does write one.
    expect(existsSync(grantsLedgerPath(knowledgeRoot))).toBe(false)
    // The ask arm really ran for this decision, rather than the tier having been lowered.
    expect(confirmed.map((action) => action.name)).toContain(`fn:${ACCEPT_ID}`)

    // ── LEG 3: accept WITH ALWAYS. One grant event, produced class, provenance carried.
    const secondProposal = await propose(interactive, publish('two'))
    const escalated = (await invokeFunction(
      interactive,
      ACCEPT_ID,
      { proposalId: secondProposal, always: true },
      HUMAN,
    )) as ProposalsAcceptOutput
    expect(escalated.apply.outcome).toBe('applied')
    expect(escalated.grant.kind).toBe('recorded')
    if (escalated.grant.kind !== 'recorded') throw new Error('expected a recorded grant')

    // The class the gate will compare against, taken from the op's OWN declaration rather than
    // spelled here: if the apply renamed itself, this assertion follows it.
    const applyClass = interactive
      .list(HUMAN)
      .find((entry) => entry.id === APPLY_ID)?.risk.name
    expect(escalated.grant.grant.actionClass).toBe(applyClass)
    expect(escalated.grant.grant.scope).toEqual(STANDING_APPROVAL_SCOPE)
    expect(escalated.grant.grant.proposalId).toBe(secondProposal)

    const afterMint = committedEvents()
    expect(afterMint).toHaveLength(1)
    expect(afterMint[0]).toMatchObject({ kind: 'grant', actionClass: applyClass })

    // It is enumerable — a grant nobody can list is PROP-03's hole reversed.
    const grants = (await invokeFunction(
      interactive,
      GRANTS_LIST_ID,
      {},
      HUMAN,
    )) as GrantsListOutput
    expect(grants.grants.map((grant) => grant.grantId)).toEqual([escalated.grant.grant.grantId])

    // ── LEG 4: the loop closing. A THIRD proposal, applied HEADLESS — where no prompt exists and
    // fail-closed would otherwise deny. The only thing that can satisfy this ask is the ledger.
    const thirdProposal = await propose(headless, publish('three'))
    const headlessApply = (await invokeFunction(
      headless,
      APPLY_ID,
      { proposalId: thirdProposal },
      HUMAN,
    )) as KnowledgeApplyOutcomeDto
    expect(headlessApply.outcome).toBe('applied')

    const allowed = sink.rows.at(-1)
    expect(allowed?.action).toBe(applyClass)
    expect(allowed?.verdict).toBe('allow')
    // The whole point of the phase in one field: what satisfied the ask was a decision a person
    // made through `proposals.accept`, not trust mode, not a credential, and not a prompt.
    expect(allowed?.trustSource).toBe('standing-approval')

    // ── LEG 5: revoke, and the same headless apply is refused again.
    const revoked = (await invokeFunction(
      interactive,
      GRANTS_REVOKE_ID,
      { grantId: escalated.grant.grant.grantId },
      HUMAN,
    )) as GrantsRevokeOutput
    expect(revoked.outcome).toBe('revoked')

    const fourthProposal = await propose(headless, publish('four'))
    await expect(
      invokeFunction(headless, APPLY_ID, { proposalId: fourthProposal }, HUMAN),
    ).rejects.toBeInstanceOf(FunctionDeniedError)
    expect(sink.rows.at(-1)?.outcome).toBe('fail-closed-denied')
    expect(sink.rows.at(-1)?.trustSource).toBeUndefined()

    // BOTH events survive, in order. A revoke that rewrote or removed the grant line would leave a
    // reviewer unable to see that an approval was ever given.
    expect(committedEvents().map((event) => event.kind)).toEqual(['grant', 'revoke'])
  }, 120_000)

  it('refuses an agent-origin accept and revoke, leaving the committed ledger untouched', async () => {
    const interactive = host('local-interactive')
    const proposalId = await propose(interactive, publish('agent'))

    await expect(
      invokeFunction(interactive, ACCEPT_ID, { proposalId, always: true }, AGENT),
    ).rejects.toBeInstanceOf(FunctionOriginError)
    await expect(
      invokeFunction(interactive, GRANTS_REVOKE_ID, { grantId: 'grant_anything' }, AGENT),
    ).rejects.toBeInstanceOf(FunctionOriginError)

    // Pre-dispatch: nothing applied, nothing minted, and the gate was never consulted.
    expect(existsSync(grantsLedgerPath(knowledgeRoot))).toBe(false)
    expect(confirmed).toEqual([])

    // The proposal is still pending, so the refusal consumed nothing — and the SAME caller reaches
    // the read verbs on the same host, which is what makes the refusal specific to the decision
    // verbs rather than a property of this fixture's agent caller.
    const listed = (await invokeFunction(
      interactive,
      PROPOSALS_LIST_ID,
      { status: 'pending' },
      AGENT,
    )) as ProposalsListOutput
    expect(listed.entries.map((entry) => entry.envelope.id)).toEqual([proposalId])

    // And the control: the same permissions, human origin, dispatches.
    const accepted = (await invokeFunction(
      interactive,
      ACCEPT_ID,
      { proposalId, always: true },
      HUMAN,
    )) as ProposalsAcceptOutput
    expect(accepted.apply.outcome).toBe('applied')
    expect(accepted.grant.kind).toBe('recorded')
  }, 120_000)

  it('denies both decision verbs in a fail-closed context, whatever is in the ledger', async () => {
    // The control that keeps the door honest. `fn:proposals.accept` and `fn:grants.revoke` are
    // members of the closed protected set, so no grant can ever satisfy their own asks — and with
    // no prompt available there is nothing left. This is the shipped posture for CI and the daemon.
    const interactive = host('local-interactive')
    const headless = host('local-headless')
    const proposalId = await propose(interactive, publish('closed'))

    await expect(
      invokeFunction(headless, ACCEPT_ID, { proposalId, always: true }, HUMAN),
    ).rejects.toBeInstanceOf(FunctionDeniedError)
    await expect(
      invokeFunction(headless, GRANTS_REVOKE_ID, { grantId: 'grant_anything' }, HUMAN),
    ).rejects.toBeInstanceOf(FunctionDeniedError)
    expect(existsSync(grantsLedgerPath(knowledgeRoot))).toBe(false)

    // Reading is unaffected — the refusals above are about the two verbs that DECIDE.
    const grants = (await invokeFunction(headless, GRANTS_LIST_ID, {}, HUMAN)) as GrantsListOutput
    expect(grants.grants).toEqual([])
  }, 120_000)
})
