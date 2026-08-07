// PROP-03's user journey — enumerate, understand, decide — over the REAL composition (Phase 391).
//
// The store's own corpus (`knowledge-local/src/review/__tests__/proposals-inbox.test.ts`) proves
// the lifecycle against the module that owns the bytes. This file proves something the store
// cannot: that a person sitting at a composed host can actually reach it. Every hop below goes
// through `composeLocalAgent()` and `invokeFunction` — the one composition root and the one
// dispatch pipeline — so what is measured is the whole spine: the op is registered, the dep is
// bound at the root, the gate lets a read through, the origin check refuses an agent, and the
// answer comes back parsed against the declared output contract.
//
// D-15's FIRST CLIENT, driven as such. Every proposal in this file is minted by invoking
// `knowledge.forget.propose` — the shipped KREV verb — never by writing a file. The point of
// absorbing the KREV verbs into the envelope is that their proposals show up in the inbox, and a
// fixture that hand-placed JSON would prove the inbox can read JSON somebody typed rather than
// that the two halves of the phase meet.
//
// THE CLOCK IS THE EXPIRY SEAM, and it is the composition's clock rather than a backdated file.
// `ClockPort` is what the whole host reads time through, so composing a second host whose clock
// sits a month later drives the real expiry rule down the real path — and it also measures the
// binding's own conversion, which a backdated `proposedAt` would have skipped entirely.

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { FunctionOriginError, invokeFunction } from '@vostride/agent-qa-agent'
import type { JobModelCapability } from '@vostride/agent-qa-agent'
import { publishBundleForTest } from '@vostride/agent-qa-knowledge-local'
import type { BundleStoreConfig } from '@vostride/agent-qa-knowledge-local'
import {
  FunctionScopeSchema,
  MASKED_RESOLVED_CONFIG_SCHEMA_VERSION,
  PROPOSAL_EXPIRY_MS,
} from '@vostride/agent-qa-schema'
import type {
  Anchor,
  FunctionCaller,
  KnowledgeProposeOutcomeDto,
  MaskedResolvedConfig,
  ProposalsListOutput,
  ProposalsRejectOutput,
  ProposalsShowOutput,
} from '@vostride/agent-qa-schema'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { composeLocalAgent } from '../composition/compose-local-agent.js'
import type { LocalAgentHost } from '../composition/compose-local-agent.js'

const LIST_ID = 'proposals.list'
const SHOW_ID = 'proposals.show'
const REJECT_ID = 'proposals.reject'
const PROPOSE_ID = 'knowledge.forget.propose'

const ANCHOR: Anchor = { t: 'el', role: 'Button', name: 'Checkout' }

const MASKED_CONFIG: MaskedResolvedConfig = {
  schemaVersion: MASKED_RESOLVED_CONFIG_SCHEMA_VERSION,
  configPath: '/fixture/agent-qa.config.yaml',
  entries: [],
}

/**
 * A person, holding every scope.
 *
 * Every scope so that a refusal below can only ever be the ORIGIN check — the axis this file
 * measures — and never a scope refusal wearing its clothes. `invokeFunction` checks scopes first,
 * so a caller short one member would turn the origin assertion into a test of the scope check.
 */
const HUMAN: FunctionCaller = {
  surface: 'test',
  grantedScopes: [...FunctionScopeSchema.options],
  safeMode: false,
  origin: 'human',
}

/** The same person's permissions, on behalf of the agent. ONLY `origin` differs. */
const AGENT: FunctionCaller = { ...HUMAN, origin: 'agent' }

const MINT_IDENTITY = (filePath: string): string => filePath

const MODEL: JobModelCapability = {
  modelId: 'fixture:inbox-model',
  generate: () => Promise.resolve({ text: 'unused' }),
}

describe('the proposals inbox, end to end over the composed host (PROP-03)', () => {
  let root: string
  let agentQaRoot: string
  let knowledgeRoot: string
  let host: LocalAgentHost
  const hosts: LocalAgentHost[] = []

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'proposals-inbox-e2e-'))
    agentQaRoot = join(root, '.agent-qa')
    knowledgeRoot = join(root, 'agent-qa-knowledge')
    mkdirSync(agentQaRoot, { recursive: true })
    host = compose()
  })

  afterEach(() => {
    for (const composed of hosts.splice(0)) composed.close()
    rmSync(root, { recursive: true, force: true })
  })

  function compose(nowIso?: () => string): LocalAgentHost {
    const composed = composeLocalAgent({
      mintQuarantineIdentityPath: MINT_IDENTITY,
      agentQaRoot,
      config: { getMasked: () => Promise.resolve(MASKED_CONFIG) },
      knowledgeRoot: () => knowledgeRoot,
      model: () => MODEL,
      ...(nowIso === undefined ? {} : { clock: { now: nowIso } }),
    })
    hosts.push(composed)
    return composed
  }

  function storeConfig(): BundleStoreConfig {
    return {
      knowledgeRoot,
      productKey: 'Inbox E2E Product',
      auditBaseDir: agentQaRoot,
      commitArtifacts: 'none',
    }
  }

  /** A real published record, so a proposal below has something real to be about. */
  function publish(summary: string, ordinal: number): string {
    const outcome = publishBundleForTest(storeConfig(), {
      draft: {
        kind: 'fact',
        subtype: 'selector',
        anchors: [ANCHOR],
        scope: { tier: 'product', key: 'inbox-e2e' },
        summary,
        body: `Selecting ${summary} advances to the payment page.`,
        distilledEvidenceRef: { id: `inbox-${summary}`, sha: 'a'.repeat(64) },
        originStage: 'run-curation',
      },
      discriminant: {
        kind: 'fact',
        subtype: 'selector',
        elementRef: { role: 'Button', name: summary },
      },
      originClass: 'agent-verified',
      createdAtOrdinal: ordinal,
      screenStates: [],
      initialEvents: [],
      relations: [],
      provenance: { mode: 'run-linked', runId: 'inbox-e2e', testId: 't', stepIndex: 0 },
      artifacts: [],
    })
    if (outcome.kind !== 'published') throw new Error(`fixture publish failed: ${outcome.kind}`)
    return outcome.id
  }

  /** Mint one REAL proposal through the shipped KREV verb (D-15's first client). */
  async function propose(summary: string, ordinal: number): Promise<string> {
    const recordId = publish(summary, ordinal)
    const proposed = (await invokeFunction(
      host.registry,
      PROPOSE_ID,
      { target: { grain: 'record', recordId } },
      HUMAN,
    )) as KnowledgeProposeOutcomeDto
    if (proposed.kind !== 'proposed') throw new Error(`expected a proposal, got ${proposed.kind}`)
    return proposed.proposal.proposalId
  }

  async function list(
    on: LocalAgentHost = host,
    input: Record<string, unknown> = {},
    caller: FunctionCaller = HUMAN,
  ): Promise<ProposalsListOutput> {
    return (await invokeFunction(on.registry, LIST_ID, input, caller)) as ProposalsListOutput
  }

  it('lists proposals minted through the KREV verb as pending, in deterministic order', async () => {
    const first = await propose('checkout button', 11)
    const second = await propose('payment button', 12)

    const listed = await list()

    expect(listed.entries.map((entry) => entry.envelope.id).sort())
      .toEqual([first, second].sort())
    expect(listed.entries.every((entry) => entry.envelope.status === 'pending')).toBe(true)
    expect(listed.entries.every((entry) => entry.applyInFlight === false)).toBe(true)
    // The ORDER is stable across calls, which is what a surface rendering a table depends on.
    expect((await list()).entries.map((entry) => entry.envelope.id))
      .toEqual(listed.entries.map((entry) => entry.envelope.id))
    // …and it is the store's law, not the readdir order: minted-at ascending.
    const instants = listed.entries.map((entry) => entry.envelope.payload.proposedAt)
    expect([...instants].sort((left, right) => left - right)).toEqual(instants)
  })

  it('renders the receipts and the attribution BEFORE any decision is made', async () => {
    const proposalId = await propose('checkout button', 11)

    const shown = (await invokeFunction(
      host.registry,
      SHOW_ID,
      { proposalId },
      HUMAN,
    )) as ProposalsShowOutput

    expect(shown.kind).toBe('found')
    if (shown.kind !== 'found') throw new Error('unreachable')
    const { envelope } = shown.entry
    expect(envelope.status).toBe('pending')
    // NO DECISION HAS BEEN MADE and the trail says so, which is what makes the rest of this
    // assertion a claim about reading BEFORE deciding rather than after.
    expect(envelope.decision).toBeUndefined()
    // The forget receipt PREVIEW — "show me what would be removed" — answerable while pending.
    expect(envelope.payload.verb).toBe('forget')
    expect(envelope.payload.receiptPreview?.tombstonedRecords.length).toBeGreaterThan(0)
    expect(envelope.payload.receiptPreview?.projectionsToScrub.length).toBeGreaterThan(0)
    // Where to go and look, and who proposed it — the op id the KREV verb carried in itself.
    expect(envelope.evidenceRefs.some((ref) => ref.grain === 'record')).toBe(true)
    expect(envelope.origin?.emittedBy).toBe(PROPOSE_ID)
  })

  it('answers a named absence for an id nothing was ever minted under', async () => {
    await propose('checkout button', 11)

    const shown = (await invokeFunction(
      host.registry,
      SHOW_ID,
      { proposalId: 'prop_00000000-0000-4000-8000-000000000000' },
      HUMAN,
    )) as ProposalsShowOutput

    expect(shown.kind).toBe('not-found')
  })

  it('records a rejection as a permanent decision, and reports the SECOND one as already decided',
    async () => {
      const proposalId = await propose('checkout button', 11)

      const rejected = (await invokeFunction(
        host.registry,
        REJECT_ID,
        { proposalId, reason: 'the evidence is a month old' },
        HUMAN,
      )) as ProposalsRejectOutput

      expect(rejected.outcome).toBe('rejected')
      if (rejected.outcome !== 'rejected') throw new Error('unreachable')
      expect(rejected.entry.envelope.status).toBe('rejected')
      expect(rejected.entry.envelope.decision?.decision).toBe('rejected')
      expect(rejected.entry.envelope.decision?.reason).toBe('the evidence is a month old')
      // RETAINED, not deleted: the proposal is still readable under the same id.
      expect(rejected.entry.envelope.payload.proposalId).toBe(proposalId)

      const second = (await invokeFunction(
        host.registry,
        REJECT_ID,
        { proposalId, reason: 'a second opinion' },
        HUMAN,
      )) as ProposalsRejectOutput

      expect(second.outcome).toBe('already-rejected')
      if (second.outcome !== 'already-rejected') throw new Error('unreachable')
      // The FIRST decision is what survives, and the second caller is told about it rather than
      // about its own — which is the whole difference between a decision and a last write.
      expect(second.entry.envelope.decision?.reason).toBe('the evidence is a month old')

      // …and the inbox agrees: exactly one rejected row, nothing pending.
      const listed = await list()
      expect(listed.entries.map((entry) => entry.envelope.status)).toEqual(['rejected'])
    })

  it('refuses an AGENT-origin reject by name while list and show stay origin-agnostic', async () => {
    const proposalId = await propose('checkout button', 11)

    await expect(
      invokeFunction(host.registry, REJECT_ID, { proposalId }, AGENT),
    ).rejects.toBeInstanceOf(FunctionOriginError)

    // NOTHING HAPPENED. The refusal is pre-dispatch, so the proposal is exactly as pending as it
    // was — an agent cannot quietly retire what a person has not seen yet.
    const listed = await list()
    expect(listed.entries.map((entry) => entry.envelope.status)).toEqual(['pending'])

    // The reads are unaffected, which is what makes the refusal a claim about THIS OP rather than
    // about agent callers: the same caller reaches both read verbs on the same host.
    expect((await list(host, {}, AGENT)).entries).toHaveLength(1)
    const shown = (await invokeFunction(
      host.registry, SHOW_ID, { proposalId }, AGENT,
    )) as ProposalsShowOutput
    expect(shown.kind).toBe('found')

    // CONTROL: the same call from a human is admitted, so the refusal above is the origin check
    // doing its job rather than something else refusing everything.
    const rejected = (await invokeFunction(
      host.registry, REJECT_ID, { proposalId }, HUMAN,
    )) as ProposalsRejectOutput
    expect(rejected.outcome).toBe('rejected')
  })

  it('reports a pending proposal as expired once the window has passed, file untouched', async () => {
    const proposalId = await propose('checkout button', 11)
    const proposedAt = (await list()).entries[0]!.envelope.payload.proposedAt

    // A SECOND host over the SAME root, whose only difference is the clock the whole composition
    // reads. Nothing on disk moves; the question is asked from a month later.
    const later = compose(() => new Date(proposedAt + PROPOSAL_EXPIRY_MS + 1).toISOString())

    expect((await list(later)).entries.map((entry) => entry.envelope.status)).toEqual(['expired'])
    // The proposal is intact — no reaper ran, nothing was deleted, and the original host still
    // reads it as pending because expiry is a fact about when you look.
    expect((await list()).entries.map((entry) => entry.envelope.id)).toEqual([proposalId])
    expect((await list()).entries.map((entry) => entry.envelope.status)).toEqual(['pending'])

    // A DECISION OUTLIVES THE WINDOW: rejecting it now leaves it rejected from the later host's
    // point of view too, rather than reverting to expired.
    await invokeFunction(host.registry, REJECT_ID, { proposalId }, HUMAN)
    expect((await list(later)).entries.map((entry) => entry.envelope.status)).toEqual(['rejected'])
  })

  it('filters by status without hiding anything from a caller that did not ask', async () => {
    const kept = await propose('checkout button', 11)
    const declined = await propose('payment button', 12)
    await invokeFunction(host.registry, REJECT_ID, { proposalId: declined }, HUMAN)

    expect((await list(host, { status: 'pending' })).entries.map((entry) => entry.envelope.id))
      .toEqual([kept])
    expect((await list(host, { status: 'rejected' })).entries.map((entry) => entry.envelope.id))
      .toEqual([declined])
    // The unfiltered question still answers everything — the filter narrows, it does not become
    // the default view of a store that retains its decisions forever.
    expect((await list()).entries).toHaveLength(2)
  })

  it('yields an empty listing as a RESULT on a host that has never proposed anything', async () => {
    const listed = await list()

    expect(listed.entries).toEqual([])
    // …and it is a RESULT rather than an absence: the op dispatched, the contract parsed, and the
    // answer is the honest one for a project with nothing waiting on anybody.
    expect(Array.isArray(listed.entries)).toBe(true)
  })

  it('lists all three verbs as BOUND on this composition, refusing nothing by name', () => {
    const listed = host.registry.list(HUMAN)
    for (const id of [LIST_ID, SHOW_ID, REJECT_ID]) {
      expect(listed.find((entry) => entry.id === id)?.bindingStatus, id).toBe('bound')
    }
    // The origin requirement is visible ON THE DECLARATION, which is what lets a listing filter
    // and the enforcement read the same field (D-16).
    expect(listed.find((entry) => entry.id === REJECT_ID)?.requiresHumanOrigin).toBe(true)
    expect(listed.find((entry) => entry.id === LIST_ID)?.requiresHumanOrigin).toBeUndefined()
  })
})
