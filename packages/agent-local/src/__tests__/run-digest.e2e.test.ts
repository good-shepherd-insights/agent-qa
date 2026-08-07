// `runs.digest` over the REAL composition — the projection's behaviour (Phase 391, PROP-04).
//
// What this file measures that a unit test could not: that the digest a person can actually
// reach is composed from the SAME four read paths the rest of the system serves from. Every hop
// goes through `composeLocalAgent()` and `invokeFunction`, so the op is registered, the deps are
// bound at the one root, the gate lets a read through, and the answer is parsed against the
// declared output contract before this file ever sees it.
//
// TWO RUNS, ALWAYS. A single-run fixture is structurally incapable of noticing a run-scoping
// defect — every proposal belongs to the only run there is, so a filter that did nothing would
// pass — and that exact blind spot shipped a cross-instance attribution bug in phase 388 that
// roughly thirty-five differentials did not see. So the corpus carries proposals under two run
// ids, and the absence claim is asserted in BOTH directions: run B's proposal is missing from
// run A's digest, and PRESENT in run B's, from the same store on the same call pair.
//
// PRODUCED, NEVER LITERAL. Every proposal is minted through `proposeReview` — the same function
// the composition's `KnowledgeReviewPort.propose` delegates to, against a real published record
// — with the run attribution the port's own signature already accepts. Nothing here writes a
// store file by hand: a corpus assembled as a literal can pin an input the producer cannot make,
// and a differential over impossible fixtures cannot tell a vacuous corpus from a real closure.

import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  ANALYSIS_GET_FUNCTION_ID,
  invokeFunction,
  RUNS_DIGEST_FUNCTION_ID,
} from '@vostride/agent-qa-agent'
import type { JobModelCapability } from '@vostride/agent-qa-agent'
import { proposeReview, publishBundleForTest } from '@vostride/agent-qa-knowledge-local'
import type { BundleStoreConfig } from '@vostride/agent-qa-knowledge-local'
import { HANDOFF_FILE, RUNS_SUBDIR, slugBranch } from '@vostride/agent-qa-runner-local'
import {
  asRunId,
  CURRENT_HANDOFF_SCHEMA_VERSION,
  FunctionScopeSchema,
  MASKED_RESOLVED_CONFIG_SCHEMA_VERSION,
} from '@vostride/agent-qa-schema'
import type {
  AnalysisGetOutput,
  Anchor,
  CompletedRunHandoff,
  FunctionCaller,
  MaskedResolvedConfig,
  ProposalsListOutput,
  RunDigest,
  Verdict,
} from '@vostride/agent-qa-schema'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { composeLocalAgent } from '../composition/compose-local-agent.js'
import type { LocalAgentHost } from '../composition/compose-local-agent.js'

const MINT_IDENTITY = (filePath: string): string => filePath

const RUN_A = 'run-391-digest-a'
const RUN_B = 'run-391-digest-b'
/** A third run with nothing attributed to it — the empty arm (edge PROP-04/empty). */
const RUN_EMPTY = 'run-391-digest-empty'

const ANCHOR: Anchor = { t: 'el', role: 'Button', name: 'Checkout' }

const MASKED_CONFIG: MaskedResolvedConfig = {
  schemaVersion: MASKED_RESOLVED_CONFIG_SCHEMA_VERSION,
  configPath: '/fixture/agent-qa.config.yaml',
  entries: [],
}

const MODEL: JobModelCapability = {
  modelId: 'fixture:run-digest',
  generate: () => Promise.resolve({ text: 'unused' }),
}

/** A person holding every scope, so nothing below can be refused for the wrong reason. */
const HUMAN: FunctionCaller = {
  surface: 'test',
  grantedScopes: [...FunctionScopeSchema.options],
  safeMode: false,
  origin: 'human',
}

function failingVerdict(perTest: number): Verdict {
  return {
    class: 'app_bug',
    producer: 'deterministic-classifier',
    confidence: 0.9,
    evidence: {
      citedSteps: [0],
      citedAnchors: [],
      citedArtifacts: [],
      rationale: 'the submit control is gone from the checkout DOM',
    },
    memoryMisdirectionRuledOut: true,
    perTest,
  } as Verdict
}

/**
 * A completed run with TWO failing members, so the analysis floor resolves two verdicts and the
 * cluster fold has something to fold. A zero-failure handoff would have made the verdict-section
 * assertions below vacuous — an empty list deep-equals an empty list.
 */
function fixtureHandoff(runId: string): CompletedRunHandoff {
  return {
    schemaVersion: CURRENT_HANDOFF_SCHEMA_VERSION,
    runId: asRunId(runId),
    scope: { tier: 'product', key: 'digest-storefront' },
    buildOrdinal: 3,
    executionContext: 'local-headless',
    aggregateVerdict: 'failed',
    configDigests: { suiteConfigDigest: 'suite-digest', testConfigDigest: 'test-digest' },
    startedAt: 1,
    endedAt: 2,
    tests: [
      {
        testId: 'TST-101',
        testName: 'checks out',
        filePath: 'tests/checkout.yaml',
        testIndex: 0,
        outcome: 'failed',
        steps: [],
        rootCause: failingVerdict(0),
      },
      {
        testId: 'TST-102',
        testName: 'checks out with a coupon',
        filePath: 'tests/coupon.yaml',
        testIndex: 1,
        outcome: 'failed',
        steps: [],
        rootCause: failingVerdict(1),
      },
    ],
  } as unknown as CompletedRunHandoff
}

describe('the per-run digest, over the composed host (PROP-04 / D-16 / D-18)', () => {
  let root: string
  let agentQaRoot: string
  let knowledgeRoot: string
  let host: LocalAgentHost
  const hosts: LocalAgentHost[] = []
  let ordinal = 10

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'run-digest-e2e-'))
    agentQaRoot = join(root, '.agent-qa')
    knowledgeRoot = join(root, 'agent-qa-knowledge')
    mkdirSync(agentQaRoot, { recursive: true })
    for (const runId of [RUN_A, RUN_B, RUN_EMPTY]) writeHandoff(runId)
    host = compose()
    ordinal = 10
  })

  afterEach(async () => {
    for (const composed of hosts.splice(0)) await composed.close()
    rmSync(root, { recursive: true, force: true })
  })

  function writeHandoff(runId: string): void {
    const runDir = join(agentQaRoot, RUNS_SUBDIR, slugBranch(runId))
    mkdirSync(runDir, { recursive: true })
    writeFileSync(join(runDir, HANDOFF_FILE), `${JSON.stringify(fixtureHandoff(runId))}\n`, 'utf8')
  }

  function compose(): LocalAgentHost {
    const composed = composeLocalAgent({
      mintQuarantineIdentityPath: MINT_IDENTITY,
      agentQaRoot,
      config: { getMasked: () => Promise.resolve(MASKED_CONFIG) },
      knowledgeRoot: () => knowledgeRoot,
      model: () => MODEL,
    })
    hosts.push(composed)
    return composed
  }

  function storeConfig(): BundleStoreConfig {
    return {
      knowledgeRoot,
      productKey: 'Digest E2E Product',
      auditBaseDir: agentQaRoot,
      commitArtifacts: 'none',
    }
  }

  /** A real published record, so a proposal below has something real to be about. */
  function publish(summary: string): string {
    ordinal += 1
    const outcome = publishBundleForTest(storeConfig(), {
      draft: {
        kind: 'fact',
        subtype: 'selector',
        anchors: [ANCHOR],
        scope: { tier: 'product', key: 'digest-e2e' },
        summary,
        body: `Selecting ${summary} advances to the payment page.`,
        distilledEvidenceRef: { id: `digest-${summary}`, sha: 'a'.repeat(64) },
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
      provenance: { mode: 'run-linked', runId: 'digest-e2e', testId: 't', stepIndex: 0 },
      artifacts: [],
    })
    if (outcome.kind !== 'published') throw new Error(`fixture publish failed: ${outcome.kind}`)
    return outcome.id
  }

  /**
   * Mint ONE proposal attributed to a run, through the REAL mint seam.
   *
   * `proposeReview` is the function `createKnowledgeReview.propose` delegates to inside the
   * composition, and the `origin` argument is the one that function already takes — the KREV
   * ops pass `{ emittedBy }` because a function invocation knows no run, while a run-scoped
   * caller passes the run too. So this is the shipped writer with the attribution it was built
   * to carry, not a fixture-only path invented so a field could be populated.
   */
  function mintForRun(
    runId: string | undefined,
    summary: string,
  ): { proposalId: string; recordId: string } {
    const recordId = publish(summary)
    const outcome = proposeReview({
      agentQaRoot,
      knowledgeRoot,
      request: { verb: 'forget', input: { target: { grain: 'record', recordId } } },
      origin: {
        emittedBy: 'knowledge.forget.propose',
        ...(runId === undefined ? {} : { runId }),
      },
    })
    if (outcome.kind !== 'proposed') throw new Error(`fixture propose failed: ${outcome.kind}`)
    return { proposalId: outcome.proposal.proposalId, recordId }
  }

  function proposeForRun(runId: string | undefined, summary: string): string {
    return mintForRun(runId, summary).proposalId
  }

  async function digest(runId: string, on: LocalAgentHost = host): Promise<RunDigest> {
    return (await invokeFunction(
      on.registry,
      RUNS_DIGEST_FUNCTION_ID,
      { runId },
      HUMAN,
    )) as RunDigest
  }

  it('lists exactly the proposals attributed to the run, and the OTHER run\'s in its own digest',
    async () => {
      const firstOfA = proposeForRun(RUN_A, 'checkout button')
      const secondOfA = proposeForRun(RUN_A, 'payment button')
      const onlyOfB = proposeForRun(RUN_B, 'coupon field')

      const digestA = await digest(RUN_A)
      const digestB = await digest(RUN_B)

      // Direction one: A's digest carries exactly A's two, and B's is absent from it.
      expect(digestA.proposalsMintedThisRun.map((row) => row.id))
        .toEqual([firstOfA, secondOfA])
      expect(digestA.proposalsMintedThisRun.map((row) => row.id)).not.toContain(onlyOfB)

      // Direction two, and it is what makes direction one a claim about the FILTER rather than
      // about the store: the same proposal, from the same store, on the same call pair, IS in
      // run B's digest. Without this leg an absence assertion passes on a digest that lists
      // nothing at all.
      expect(digestB.proposalsMintedThisRun.map((row) => row.id)).toEqual([onlyOfB])
      expect(digestB.proposalsMintedThisRun.map((row) => row.id)).not.toContain(firstOfA)

      // The COUNT is store-wide on both, which is what the exit-line pointer carries: three
      // proposals are waiting on a human, whichever run you asked about.
      expect(digestA.pendingProposalCount).toBe(3)
      expect(digestB.pendingProposalCount).toBe(3)
      // …and the rendered lines say the same thing the sections do, on both halves.
      expect(digestA.lines.some((line) => line.includes('2 minted this run · 3 pending overall')))
        .toBe(true)
      expect(digestB.lines.some((line) => line.includes('1 minted this run · 3 pending overall')))
        .toBe(true)
    })

  it('renders a run with no attributed proposals as zeros, not as an error (edge PROP-04/empty)',
    async () => {
      // The store is NOT empty — two proposals exist, both belonging to another run. That is
      // what makes this the zero-ATTRIBUTION arm rather than the zero-store arm, and the two
      // fail differently: a filter that returned everything would pass on an empty store.
      proposeForRun(RUN_A, 'checkout button')
      proposeForRun(RUN_A, 'payment button')

      const empty = await digest(RUN_EMPTY)

      expect(empty.runId).toBe(RUN_EMPTY)
      expect(empty.proposalsMintedThisRun).toEqual([])
      expect(empty.pendingProposalCount).toBe(2)
      expect(empty.candidates).toEqual({ curated: 0, deprecated: 0 })
      expect(empty.quarantine).toEqual({ quarantined: 0, expired: 0, refs: [] })
      expect(empty.lines.some((line) => line.includes('none minted this run'))).toBe(true)
    })

  it('carries an unattributed proposal in NO run\'s digest, and still counts it as pending',
    async () => {
      // A 387-era mint — no origin at all, which the store deliberately still accepts. It is
      // waiting on a human (so it counts) and belongs to no run (so it is listed nowhere).
      proposeForRun(undefined, 'legacy button')
      const attributed = proposeForRun(RUN_A, 'checkout button')

      const digestA = await digest(RUN_A)
      expect(digestA.proposalsMintedThisRun.map((row) => row.id)).toEqual([attributed])
      expect(digestA.pendingProposalCount).toBe(2)
      expect((await digest(RUN_B)).proposalsMintedThisRun).toEqual([])
    })

  it('orders the listing minted-at then id, stably across renders (edge PROP-04/ordering)',
    async () => {
      const first = proposeForRun(RUN_A, 'first button')
      const second = proposeForRun(RUN_A, 'second button')
      const third = proposeForRun(RUN_A, 'third button')

      const once = await digest(RUN_A)
      const twice = await digest(RUN_A)
      // Stable across renders — a table a person is reading must not reshuffle under them.
      expect(twice.proposalsMintedThisRun).toEqual(once.proposalsMintedThisRun)
      expect(once.proposalsMintedThisRun.map((row) => row.id)).toEqual([first, second, third])

      // …and it is the STORE's law rather than a second sort here: the digest's order is the
      // enumeration's order, filtered. Compared against `proposals.list` through the same
      // registry, so the claim is about two ops agreeing and not about this file's expectation.
      const listed = (await invokeFunction(
        host.registry,
        'proposals.list',
        {},
        HUMAN,
      )) as ProposalsListOutput
      expect(once.proposalsMintedThisRun.map((row) => row.id)).toEqual(
        listed.entries
          .filter((entry) => entry.envelope.origin?.runId === RUN_A)
          .map((entry) => entry.envelope.id),
      )
    })

  it('carries the analysis op\'s OWN cluster views, sentence bytes included (D-18 / 389 D-05)',
    async () => {
      proposeForRun(RUN_A, 'checkout button')

      const analysis = (await invokeFunction(
        host.registry,
        ANALYSIS_GET_FUNCTION_ID,
        { runId: RUN_A },
        HUMAN,
      )) as AnalysisGetOutput
      const digestA = await digest(RUN_A)

      // NON-VACUITY FIRST. Two failing members resolve through the D-10 accessor and the floor
      // renderer, so there is something to compare; without this line an empty-equals-empty
      // pass would certify nothing.
      expect(analysis.clusters.length).toBeGreaterThan(0)
      expect(analysis.clusters.every((cluster) => cluster.representative.sentence !== ''))
        .toBe(true)

      // The bytes are compared against the RENDERER'S ACTUAL OUTPUT for this run — obtained by
      // invoking the one producer through the same registry — never against a sentence this
      // file re-spelled. A check that restates a constant inside its own package binds nothing
      // to reality; this one goes red the moment the digest composes anything of its own.
      expect(digestA.verdictClusters).toEqual(analysis.clusters)
      for (const cluster of analysis.clusters) {
        expect(digestA.lines.join('\n')).toContain(cluster.representative.sentence)
      }
    })

  it('composes the chain section from the chip vocabulary, and persists NOTHING (D-16)',
    async () => {
      proposeForRun(RUN_A, 'checkout button')
      const before = readdirSync(join(agentQaRoot, 'proposals')).sort()

      const digestA = await digest(RUN_A)

      // Nothing was enqueued for this run, so the chips read exactly what a chain nobody
      // started reads — the `runs.postprocessing` words, not a synonym.
      expect(digestA.chain).toEqual({
        analysis: 'pending',
        curation: 'pending',
        issues: 'reserved',
      })
      expect(digestA.chain.outcome).toBeUndefined()
      expect(digestA.lines.some((line) =>
        line === 'chain — analysis: pending · curation: pending · issues: reserved')).toBe(true)

      // The projection wrote nothing. Rendering the same digest twice cannot change the store,
      // which is the whole of "nothing new persisted, nothing to drift".
      await digest(RUN_A)
      expect(readdirSync(join(agentQaRoot, 'proposals')).sort()).toEqual(before)
    })

  it('refuses a run this host has never recorded, rather than answering a page of zeros',
    async () => {
      await expect(digest('run-that-never-happened')).rejects.toMatchObject({
        name: 'RunNotFoundError',
      })
    })

  it('carries refs and counts and NO receipt bytes, on a forget proposal that has them (D-18)',
    async () => {
      const { proposalId, recordId } = mintForRun(RUN_A, 'checkout button')
      // A second real record, published and never proposed about — the control that makes the
      // absence claims below about WHAT THE DIGEST SELECTS rather than about an empty store.
      const untouchedRecordId = publish('unrelated button')
      const digestA = await digest(RUN_A)
      const row = digestA.proposalsMintedThisRun[0]

      expect(row?.id).toBe(proposalId)
      // The short form is a PREFIX of the full id — a display value, never a second address.
      expect(proposalId.startsWith(row?.shortId ?? ' ')).toBe(true)
      expect(row?.requiredDecision).toBe('accept or reject')
      // Counts, not contents: the summary names the verb, the target ref and how much would
      // move — and the forget's tombstone COUNT, never the tombstoned record ids.
      expect(row?.summaryLine).toContain('forget ')
      expect(row?.summaryLine).toMatch(/\d+ delta/u)
      expect(row?.summaryLine).toMatch(/\d+ to tombstone/u)

      // The prohibition, measured against the proposal's OWN receipt rather than a generic
      // scan: whatever `proposals.show` renders as evidence must not be in these bytes.
      //
      // WHERE THE LINE ACTUALLY FALLS, measured rather than assumed. A record-grain forget
      // tombstones exactly its target, so the ONE record id in the preview is also the target
      // REF — and a ref is the thing D-18 explicitly admits ("refs and counts only"). The
      // prohibition is about the receipt's own bytes: the provenance each tombstone carries,
      // the projection set the scrub would touch, and the record's content. Those are what
      // `proposals.show` exists to serve and what a terminal, a chat and a dashboard must not
      // be handed by default.
      const shown = (await invokeFunction(
        host.registry,
        'proposals.show',
        { proposalId },
        HUMAN,
      )) as { kind: string; entry?: { envelope: { payload: { receiptPreview?: unknown } } } }
      const preview = shown.entry?.envelope.payload.receiptPreview as {
        tombstonedRecords: { recordId: string; provenance: unknown }[]
        projectionsToScrub: string[]
      } | undefined
      expect(preview?.tombstonedRecords.length).toBeGreaterThan(0)
      expect(preview?.projectionsToScrub.length).toBeGreaterThan(0)

      const rendered = JSON.stringify(digestA)
      for (const record of preview?.tombstonedRecords ?? []) {
        // The only record id the digest names is the one it names as the TARGET REF.
        expect(record.recordId).toBe(recordId)
        // Its provenance — the bundle, the run and the step the record came from — is not.
        expect(rendered).not.toContain(JSON.stringify(record.provenance))
        expect(rendered).not.toContain('digest-e2e')
      }
      // The receipt's own structure never crosses: neither key, and neither the projection set
      // nor the record's body text a reader would go to `show` for.
      expect(rendered).not.toContain('tombstonedRecords')
      expect(rendered).not.toContain('projectionsToScrub')
      expect(rendered).not.toContain('advances to the payment page')
      // …and a record this proposal is not about is absent, which is what makes the three
      // absence claims above about selection rather than about an empty store.
      expect(rendered).not.toContain(untouchedRecordId)
    })
})
