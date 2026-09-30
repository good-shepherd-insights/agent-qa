// THE grant loop, end to end over one composition and one committed ledger (Phase 391, PROP-01).
//
// 2026-09-30 (432-13, D-14/D-15): THE LOOP HAS NO CONSUMER. `invokeFunction` reads no standing
// approval, asks no confirm port and writes no decision row, so a headless apply commits whatever
// the ledger says. What survives here is the MINT side (the always form writes one grant event, the
// plain form writes none, revoke appends rather than rewrites, both events survive) and the origin
// refusal; the cells that measured the gate consuming a grant are re-spelled as the ledger being
// unread at dispatch. 432-18 deletes the grant ops and the ledger with this file's remaining claims.
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
// AND THE ADJACENCY NEGATIVES (391 plan 05, D-04). A second case appends three committed lines that
// are each ONE character-class away from the one leg 3 mints — the bare op id, the same scope value
// under a different key, and a superset scope — and proves that none of them satisfies the ask
// while the exactly-equal line does. Exact-match semantics are the whole of the narrowing in 391
// (scope is not yet a narrowing dimension), so "close enough" has to be pinned as "not at all".
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
  FunctionOriginError,
  createFunctionRegistry,
  invokeFunction,
} from '@vostride/agent-qa-agent'
import type { FunctionRegistry } from '@vostride/agent-qa-agent'
import {
  appendGrantLedgerEvents,
  createGrantOperations,
  createProposalsInbox,
  grantsLedgerPath,
  publishBundleForTest,
} from '@vostride/agent-qa-knowledge-local'
import type { BundleStoreConfig } from '@vostride/agent-qa-knowledge-local'
import {
  CURRENT_GRANT_LEDGER_SCHEMA_VERSION,
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
  MaskedResolvedConfig,
  ProposalsAcceptOutput,
  ProposalsListOutput,
  ProposalsShowOutput,
} from '@vostride/agent-qa-schema'
import type { AuditSink, ExecutionAuditRow, GuardrailAuditRow } from '@vostride/agent-qa-safety'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  createKnowledgeReader,
  createKnowledgeReview,
  createRunsReader,
} from '../composition/compose-local-agent.js'
import { filePre432KnowledgeProposal } from './pre-432-knowledge-proposal.js'

const APPLY_ID = 'knowledge.proposal.apply'
const ACCEPT_ID = 'proposals.accept'
const GRANTS_LIST_ID = 'grants.list'
const GRANTS_REVOKE_ID = 'grants.revoke'
const PROPOSALS_LIST_ID = 'proposals.list'
const PROPOSALS_SHOW_ID = 'proposals.show'

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

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'grant-loop-'))
    knowledgeRoot = join(root, 'agent-qa-knowledge')
    agentQaRoot = join(root, '.agent-qa')
    mkdirSync(agentQaRoot, { recursive: true })
    sink = capturingSink()
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
      // 432-13: no standing-approval reader and no confirm port — `invokeFunction` asks nobody.
      resolveExecutionContext: () => context,
    })
  }

  function committedEvents(): GrantLedgerEvent[] {
    if (!existsSync(grantsLedgerPath(knowledgeRoot))) return []
    return readFileSync(grantsLedgerPath(knowledgeRoot), 'utf8')
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as GrantLedgerEvent)
  }

  /**
   * The class the gate compares against, read off the apply op's OWN declaration.
   *
   * Never spelled as a literal anywhere in this file: every fixture below is DERIVED from this, so
   * a rename of the op moves the fixtures with it instead of silently turning the whole file into
   * a set of misses that still passes its negative cases.
   */
  function applyClass(registry: FunctionRegistry): string {
    const name = registry.list(HUMAN).find((entry) => entry.id === APPLY_ID)?.risk.name
    if (name === undefined) throw new Error(`${APPLY_ID} is not registered`)
    return name
  }

  /** 432-12: a pre-432 forget proposal on disk; the change ops apply in the call and file none. */
  async function propose(_registry: FunctionRegistry, recordId: string): Promise<string> {
    return await filePre432KnowledgeProposal({
      agentQaRoot, knowledgeRoot, verb: 'forget', target: { grain: 'record', recordId },
    })
  }

  // RE-SPELLED 2026-09-30 (432-13) from 'mints on the always form only, and the mint is what lets a
  // headless apply commit'. The mint half survives; a headless apply now commits with or without
  // the grant, and no decision row names what satisfied it because nothing is asked.
  it('mints on the always form only, and a headless apply commits whatever the ledger holds', async () => {
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
    const applyClassName = applyClass(interactive)
    expect(escalated.grant.grant.actionClass).toBe(applyClassName)
    expect(escalated.grant.grant.scope).toEqual(STANDING_APPROVAL_SCOPE)
    expect(escalated.grant.grant.proposalId).toBe(secondProposal)

    const afterMint = committedEvents()
    expect(afterMint).toHaveLength(1)
    expect(afterMint[0]).toMatchObject({ kind: 'grant', actionClass: applyClassName })

    // It is enumerable — a grant nobody can list is PROP-03's hole reversed.
    const grants = (await invokeFunction(
      interactive,
      GRANTS_LIST_ID,
      {},
      HUMAN,
    )) as GrantsListOutput
    expect(grants.grants.map((grant) => grant.grantId)).toEqual([escalated.grant.grant.grantId])

    // And the DECISION is readable afterwards under the same id a person listed it by. The store's
    // own suite pins the applied status against the bytes; what is asserted here is that the ACCEPT
    // VERB, dispatched through the composed host, is what left that trail — so `proposals.show` is
    // a receipt for a decision that was made and not only a preview of one that has not been.
    const shownAfter = (await invokeFunction(
      interactive,
      PROPOSALS_SHOW_ID,
      { proposalId: secondProposal },
      HUMAN,
    )) as ProposalsShowOutput
    expect(shownAfter.kind).toBe('found')
    if (shownAfter.kind !== 'found') throw new Error('the accepted proposal is no longer readable')
    expect(shownAfter.entry.envelope.id).toBe(secondProposal)
    expect(shownAfter.entry.envelope.status).toBe('applied')

    // ── LEG 4: a THIRD proposal, applied HEADLESS. It commits in the call; nothing asked and no
    // decision row was written, so the grant above was not what let it through (432-13).
    const thirdProposal = await propose(headless, publish('three'))
    const headlessApply = (await invokeFunction(
      headless,
      APPLY_ID,
      { proposalId: thirdProposal },
      HUMAN,
    )) as KnowledgeApplyOutcomeDto
    expect(headlessApply.outcome).toBe('applied')
    expect(sink.rows).toEqual([])

    // ── LEG 5: revoke, and the same headless apply STILL commits — the ledger is not read.
    const revoked = (await invokeFunction(
      interactive,
      GRANTS_REVOKE_ID,
      { grantId: escalated.grant.grant.grantId },
      HUMAN,
    )) as GrantsRevokeOutput
    expect(revoked.outcome).toBe('revoked')

    const fourthProposal = await propose(headless, publish('four'))
    const afterRevoke = (await invokeFunction(
      headless,
      APPLY_ID,
      { proposalId: fourthProposal },
      HUMAN,
    )) as KnowledgeApplyOutcomeDto
    expect(afterRevoke.outcome).toBe('applied')
    expect(sink.rows).toEqual([])

    // BOTH events survive, in order. A revoke that rewrote or removed the grant line would leave a
    // reviewer unable to see that an approval was ever given.
    expect(committedEvents().map((event) => event.kind)).toEqual(['grant', 'revoke'])
  }, 120_000)

  // RE-SPELLED 2026-09-30 (432-13) from 'admits the exactly-equal grant line and no adjacent one'.
  // The lines still append and list; no line is READ at dispatch, so the adjacent lines and the
  // exact one leave the headless apply equally unaffected — it commits either way.
  it('reads no grant line at dispatch: adjacent and exact lines alike leave the apply committing', async () => {
    const interactive = host('local-interactive')
    const headless = host('local-headless')

    const exactClass = applyClass(interactive)
    // Derived, never re-spelled: `STANDING_APPROVAL_SCOPE` is the ONE constant the mint and the
    // invoke call-site both read, and the near-misses below are built by moving its value to
    // another key or by adding a second one — so they follow the constant if it is ever retuned.
    const scopeValue = STANDING_APPROVAL_SCOPE.project
    if (scopeValue === undefined) {
      throw new Error('the pinned standing-approval scope no longer populates `project`')
    }

    // WHY THESE ARE ASSEMBLED HERE and not minted through `record`: the mint reads the class off
    // the apply op's own descriptor and stamps the pinned scope, so it structurally CANNOT produce
    // any of the three. They are still authored through the real committed-append API, so each one
    // passes both of the read's guards and the egress checkpoint, and what lands is an ordinary
    // well-formed line that folds, lists, and reads to a human exactly like an approval. That is
    // the entire point: the only thing wrong with them is that they are not EQUAL.
    const adjacent: GrantLedgerEvent[] = [
      {
        schemaVersion: CURRENT_GRANT_LEDGER_SCHEMA_VERSION,
        kind: 'grant',
        at: NOW_ISO,
        grantId: 'grant_bare_op_id',
        // The bare op id, with the `fn:` prefix the gate compares against stripped off. This is the
        // silent failure the ledger's own module head names: it authorizes nothing, forever.
        actionClass: exactClass.replace(/^fn:/, ''),
        scope: STANDING_APPROVAL_SCOPE,
      },
      {
        schemaVersion: CURRENT_GRANT_LEDGER_SCHEMA_VERSION,
        kind: 'grant',
        at: NOW_ISO,
        grantId: 'grant_scope_other_key',
        actionClass: exactClass,
        // The same VALUE under a different KEY. `scopeMatches` compares populated key sets, so an
        // org-scoped approval does not cover a project-scoped action even at the same string.
        scope: { org: scopeValue },
      },
      {
        schemaVersion: CURRENT_GRANT_LEDGER_SCHEMA_VERSION,
        kind: 'grant',
        at: NOW_ISO,
        grantId: 'grant_scope_superset',
        actionClass: exactClass,
        // A WIDER grant, which is the counter-intuitive one and the reason it is here: exact
        // matching means a grant carrying an extra populated key covers LESS, not more.
        scope: { ...STANDING_APPROVAL_SCOPE, org: scopeValue },
      },
    ]

    expect(
      appendGrantLedgerEvents(knowledgeRoot, adjacent, { auditBaseDir: agentQaRoot }),
    ).toEqual({ kind: 'appended', lines: 3 })

    // All three are ACTIVE as far as the committed file is concerned, and a reviewer can see them.
    // That is what makes the denial below the MATCH's answer rather than the ledger's: nothing was
    // filtered out on the way in, and `grants.list` is the report that says so.
    const listed = (await invokeFunction(interactive, GRANTS_LIST_ID, {}, HUMAN)) as GrantsListOutput
    expect([...listed.grants].map((grant) => grant.grantId).sort()).toEqual([
      'grant_bare_op_id',
      'grant_scope_other_key',
      'grant_scope_superset',
    ])

    const adjacentProposal = await propose(headless, publish('adjacent'))
    const adjacentApply = (await invokeFunction(
      headless,
      APPLY_ID,
      { proposalId: adjacentProposal },
      HUMAN,
    )) as KnowledgeApplyOutcomeDto
    expect(adjacentApply.outcome).toBe('applied')
    expect(sink.rows).toEqual([])

    // ── THE EXACT LINE, appended after them: the same outcome, and still no decision row.
    expect(
      appendGrantLedgerEvents(
        knowledgeRoot,
        [
          {
            schemaVersion: CURRENT_GRANT_LEDGER_SCHEMA_VERSION,
            kind: 'grant',
            at: NOW_ISO,
            grantId: 'grant_exact',
            actionClass: exactClass,
            scope: STANDING_APPROVAL_SCOPE,
          },
        ],
        { auditBaseDir: agentQaRoot },
      ),
    ).toEqual({ kind: 'appended', lines: 1 })

    const admittedProposal = await propose(headless, publish('exact'))
    const applied = (await invokeFunction(
      headless,
      APPLY_ID,
      { proposalId: admittedProposal },
      HUMAN,
    )) as KnowledgeApplyOutcomeDto
    expect(applied.outcome).toBe('applied')
    expect(sink.rows).toEqual([])
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

    // Pre-dispatch: nothing applied and nothing minted.
    expect(existsSync(grantsLedgerPath(knowledgeRoot))).toBe(false)

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

  // RE-SPELLED 2026-09-30 (432-13) from 'denies both decision verbs in a fail-closed context,
  // whatever is in the ledger'. With no op gate a headless accept applies in the call and a headless
  // revoke answers by the ledger's own content; no decision row is written for either.
  it('C432-INVOKE-DIRECT: both decision verbs run in a headless context with no confirmation', async () => {
    const interactive = host('local-interactive')
    const headless = host('local-headless')
    const proposalId = await propose(interactive, publish('closed'))

    const accepted = (await invokeFunction(
      headless,
      ACCEPT_ID,
      { proposalId },
      HUMAN,
    )) as ProposalsAcceptOutput
    expect(accepted.apply.outcome).toBe('applied')
    const revoked = (await invokeFunction(
      headless,
      GRANTS_REVOKE_ID,
      { grantId: 'grant_anything' },
      HUMAN,
    )) as GrantsRevokeOutput
    expect(revoked.outcome).not.toBe('revoked')
    expect(existsSync(grantsLedgerPath(knowledgeRoot))).toBe(false)
    expect(sink.rows).toEqual([])

    const grants = (await invokeFunction(headless, GRANTS_LIST_ID, {}, HUMAN)) as GrantsListOutput
    expect(grants.grants).toEqual([])
  }, 120_000)
})
