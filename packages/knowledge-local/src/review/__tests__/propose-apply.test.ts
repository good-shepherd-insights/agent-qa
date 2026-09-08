// Propose computes everything and commits nothing (Phase 387-08, KREV-01 / D-17 · D-19).
//
// The load-bearing case in this file is not "propose returns a proposal" — it is the pair of
// controls around the byte-identity claim. Hashing the knowledge root before and after a propose
// only proves something if a propose COULD have written there, so the hash's POTENCY is measured
// first (a deliberate one-byte write into the root must change it) and only then is invariance
// asserted. Without the potency half, a hash over the wrong directory would report success
// forever.

import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'

import type { Anchor, BundleDraft } from '@vostride/agent-qa-schema'
import { asRunId, asRecordId, asEvidenceToken, KnowledgeProposalV1Schema,
  type KnowledgeMarkInput } from '@vostride/agent-qa-schema'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { publishBundle, type BundleStoreConfig } from '../../bundle-publish.test-helper.js'
import {
  makeBundleDraftFixture,
  makeScreenStateFixture,
  scaffoldKnowledgeRoot,
} from '../../__tests__/fixtures/bundle-fixture.js'
import {
  FORGET_SCRUBBED_PROJECTIONS,
  proposeReview,
  MarkPlanIntegrityError,
} from '../propose-review.js'
import {
  PROPOSALS_DIR_NAME,
  claimPendingProposal,
  proposalsDir,
  readAppliedProposal,
  readPendingProposal,
  publishAppliedProposal,
  restorePendingProposal,
} from '../proposals-store.js'

const ANCHOR: Anchor = { t: 'el', role: 'Button', name: 'Checkout' }

/**
 * A content hash of every regular file under a directory tree, path-relative and sorted.
 *
 * Paths are part of the digest, not just contents: a propose that created an empty marker file
 * or renamed a bundle directory would leave every byte of content identical, and a
 * contents-only digest would call that "unchanged".
 */
function hashTree(root: string): string {
  const digest = createHash('sha256')
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    )) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        digest.update(`D:${relative(root, path)}\n`)
        walk(path)
        continue
      }
      digest.update(`F:${relative(root, path)}:${statSync(path).size}:`)
      digest.update(readFileSync(path))
      digest.update('\n')
    }
  }
  walk(root)
  return digest.digest('hex')
}

describe('propose computes everything and commits nothing (D-17)', () => {
  let root: string
  let knowledgeRoot: string
  let agentQaRoot: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'knowledge-review-propose-'))
    knowledgeRoot = join(root, 'agent-qa-knowledge')
    agentQaRoot = join(root, '.agent-qa')
    scaffoldKnowledgeRoot(knowledgeRoot)
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function storeConfig(product: string): BundleStoreConfig {
    return {
      knowledgeRoot,
      productKey: product,
      auditBaseDir: agentQaRoot,
      commitArtifacts: 'none',
    }
  }

  function publish(summary: string, overrides: Partial<BundleDraft> = {}): string {
    const outcome = publishBundle(storeConfig('Review Product'), {
      draft: makeBundleDraftFixture({
        kind: 'fact',
        anchors: [ANCHOR],
        scope: { tier: 'product', key: 'review-storefront' },
        summary,
        ...overrides,
      }),
      discriminant: {
        kind: 'fact',
        subtype: 'selector',
        elementRef: { role: 'Button', name: summary },
      },
      originClass: 'agent-verified',
      createdAtOrdinal: 10,
      screenStates: [makeScreenStateFixture()],
      initialEvents: [],
      relations: [],
      provenance: {
        mode: 'run-linked',
        runId: `review-${summary}`,
        testId: 'review-test',
        stepIndex: 0,
      },
      artifacts: [],
    })
    if (outcome.kind !== 'published') throw new Error(`fixture publish failed: ${outcome.kind}`)
    return outcome.id
  }

  function markInput(recordId: string): KnowledgeMarkInput {
    const runId = asRunId('review-mark-run')
    const target = { grain: 'record' as const, recordId }
    const mark = { markId: 'mark_0123456789ab', runId, testIndex: 0,
      kind: 'false-fail' as const, fix: 'fact' as const }
    const scope = { tier: 'product' as const, key: 'review-storefront' }
    return { target, mark, plan: { schemaVersion: 1, markId: mark.markId, kind: 'knowledge',
      fix: 'fact', target, wording: 'floor', feedbackSource: { runId, testIndex: 0, kind: mark.kind },
      runTraceRef: { runId, runSlug: runId }, deltas: [{ kind: 'Supersede', origin: 'user', scope,
        citedIds: [asRecordId(recordId)], victimId: asRecordId(recordId),
        evidenceToken: asEvidenceToken(`mark:${mark.markId}`),
        newBundle: makeBundleDraftFixture({ scope, anchors: [ANCHOR] }),
      }] } }
  }

  it.each(['floor', 'model'] as const)('files one stamped mark proposal with persisted %s wording and no knowledge writes', wording => {
    const input = markInput(publish('checkout button'))
    input.plan.wording = wording
    const before = hashTree(knowledgeRoot)
    const result = proposeReview({ agentQaRoot, knowledgeRoot, request: { verb: 'mark', input } })
    expect(result.kind).toBe('proposed')
    if (result.kind !== 'proposed') throw new Error('expected proposal')
    expect(result.proposal).toMatchObject({ verb: 'mark', wording, deltas: input.plan.deltas,
      targetRef: input.plan.target, mark: input.mark, status: 'pending' })
    expect(KnowledgeProposalV1Schema.parse(result.proposal)).toEqual(result.proposal)
    expect(readPendingProposal(agentQaRoot, result.proposal.proposalId)).toEqual(result.proposal)
    expect(readdirSync(proposalsDir(agentQaRoot)).filter((name) => name.endsWith('.json'))).toHaveLength(1)
    expect(hashTree(knowledgeRoot)).toBe(before)
  })

  it.each(['origin', 'citation', 'scope', 'stamp', 'target'] as const)(
    'refuses a mark plan with invalid %s before filing', (field) => {
      const input = markInput(publish('checkout button'))
      if (field === 'origin') input.plan.deltas[0]!.origin = 'agent'
      if (field === 'citation') input.plan.deltas[0]!.citedIds = [asRecordId('foreign-record')]
      if (field === 'scope') input.plan.deltas[0]!.scope = { tier: 'global', key: 'global' }
      if (field === 'stamp') input.mark.markId = 'mark_abcdefabcdef'
      if (field === 'target') input.plan.target = { grain: 'record', recordId: 'foreign-record' }
      const before = hashTree(knowledgeRoot)
      expect(() => proposeReview({ agentQaRoot, knowledgeRoot, request: { verb: 'mark', input } }))
        .toThrow(MarkPlanIntegrityError)
      expect(existsSync(proposalsDir(agentQaRoot)) ? readdirSync(proposalsDir(agentQaRoot)) : []).toEqual([])
      expect(hashTree(knowledgeRoot)).toBe(before)
    })

  it('POTENCY CONTROL: the tree hash notices a single byte written into the knowledge root', () => {
    publish('checkout button')
    const before = hashTree(knowledgeRoot)
    writeFileSync(join(knowledgeRoot, 'a-single-byte'), 'x', 'utf8')
    // If this were equal, every invariance assertion in this file would be measuring nothing.
    expect(hashTree(knowledgeRoot)).not.toBe(before)
    rmSync(join(knowledgeRoot, 'a-single-byte'))
    expect(hashTree(knowledgeRoot)).toBe(before)
  })

  it('leaves the knowledge store byte-identical across all three verbs', () => {
    const recordId = publish('checkout button')
    const before = hashTree(knowledgeRoot)

    for (const request of [
      { verb: 'accept' as const, input: { target: { grain: 'record' as const, recordId } } },
      {
        verb: 'reject' as const,
        input: { target: { grain: 'record' as const, recordId }, reason: 'flaky selector' },
      },
      { verb: 'forget' as const, input: { target: { grain: 'record' as const, recordId } } },
    ]) {
      const outcome = proposeReview({ agentQaRoot, knowledgeRoot, request })
      expect(outcome.kind).toBe('proposed')
      expect(hashTree(knowledgeRoot), `${request.verb} wrote into the knowledge store`).toBe(before)
    }

    // …and the proposals themselves landed SOMEWHERE, so the invariance above is not the
    // invariance of a function that did nothing at all.
    expect(readdirSync(proposalsDir(agentQaRoot)).length).toBe(3)
    expect(PROPOSALS_DIR_NAME).toBe('proposals')
  })

  it('enumerates the tombstone preview for a bundle ref and for a record ref alike (D-19)', () => {
    const recordId = publish('checkout button')

    const byRecord = proposeReview({
      agentQaRoot,
      knowledgeRoot,
      request: { verb: 'forget', input: { target: { grain: 'record', recordId } } },
    })
    const byBundle = proposeReview({
      agentQaRoot,
      knowledgeRoot,
      request: { verb: 'forget', input: { target: { grain: 'bundle', shortId: 'MEM-001' } } },
      resolveBundleShortId: (shortId) => (shortId === 'MEM-001' ? recordId : undefined),
    })

    if (byRecord.kind !== 'proposed' || byBundle.kind !== 'proposed') {
      throw new Error('both grains must propose')
    }
    for (const proposal of [byRecord.proposal, byBundle.proposal]) {
      expect(proposal.receiptPreview?.tombstonedRecords.map((row) => row.recordId))
        .toEqual([recordId])
      // Provenance is REQUIRED on every previewed record: a preview listing an id with no
      // provenance is a list nobody can act on.
      expect(proposal.receiptPreview?.tombstonedRecords[0]?.provenance.mode).toBe('run-linked')
      expect(proposal.receiptPreview?.projectionsToScrub).toEqual([...FORGET_SCRUBBED_PROJECTIONS])
    }
    // The two grains address the SAME record through different routes — a bundle ref that
    // resolved to something else would make D-19's "either grain" a coincidence.
    expect(byBundle.proposal.targetRef).toEqual({ grain: 'bundle', shortId: 'MEM-001' })
    expect(byRecord.proposal.targetRef).toEqual({ grain: 'record', recordId })
  })

  it('only forget previews tombstones — accept and reject carry no receipt preview', () => {
    const recordId = publish('checkout button')
    const accept = proposeReview({
      agentQaRoot,
      knowledgeRoot,
      request: { verb: 'accept', input: { target: { grain: 'record', recordId } } },
    })
    const reject = proposeReview({
      agentQaRoot,
      knowledgeRoot,
      request: {
        verb: 'reject',
        input: { target: { grain: 'record', recordId }, reason: 'superseded by a newer selector' },
      },
    })
    if (accept.kind !== 'proposed' || reject.kind !== 'proposed') throw new Error('expected both')

    expect(accept.proposal.receiptPreview).toBeUndefined()
    expect(reject.proposal.receiptPreview).toBeUndefined()
    expect(accept.proposal.deltas.map((delta) => delta.kind)).toEqual(['Confirm'])
    expect(reject.proposal.deltas.map((delta) => delta.kind)).toEqual(['Deprecate'])
    // The reject's reason travels into the delta rather than being invented at apply time.
    expect((reject.proposal.deltas[0] as { reason?: string }).reason)
      .toBe('superseded by a newer selector')
    // origin `user`: a review verb records that a PERSON decided, and `agent` is the origin
    // disposition's autonomy floor downgrades precisely so an agent cannot decide for itself.
    expect(accept.proposal.deltas[0]?.origin).toBe('user')
  })

  it('answers a typed not-found for an unknown target — never a throw', () => {
    publish('checkout button')

    const missingRecord = proposeReview({
      agentQaRoot,
      knowledgeRoot,
      request: { verb: 'accept', input: { target: { grain: 'record', recordId: 'rec-nope' } } },
    })
    expect(missingRecord).toEqual({
      kind: 'target-not-found',
      target: { grain: 'record', recordId: 'rec-nope' },
    })

    // A short-ID nothing resolves is the same answer, and it must not fall through to a scan:
    // no resolver is supplied at all here.
    const missingBundle = proposeReview({
      agentQaRoot,
      knowledgeRoot,
      request: { verb: 'forget', input: { target: { grain: 'bundle', shortId: 'MEM-404' } } },
    })
    expect(missingBundle.kind).toBe('target-not-found')

    // Nothing was minted for either — a not-found must not leave an applicable proposal behind.
    // The directory is not even created, which is the stronger statement: propose reaches the
    // store only after it has something to store.
    const dir = proposalsDir(agentQaRoot)
    expect(existsSync(dir) ? readdirSync(dir).length : 0).toBe(0)
  })
})

describe('the proposals store is durable across processes and atomic under a race', () => {
  let root: string
  let agentQaRoot: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'knowledge-review-store-'))
    agentQaRoot = join(root, '.agent-qa')
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function publishAndRead(knowledgeRoot: string, agentRoot: string): string {
    scaffoldKnowledgeRoot(knowledgeRoot)
    const outcome = publishBundle(
      {
        knowledgeRoot,
        productKey: 'Durability Product',
        auditBaseDir: agentRoot,
        commitArtifacts: 'none',
      },
      {
        draft: makeBundleDraftFixture({ kind: 'fact', anchors: [ANCHOR], summary: 'durable' }),
        discriminant: {
          kind: 'fact',
          subtype: 'selector',
          elementRef: { role: 'Button', name: 'durable' },
        },
        originClass: 'agent-verified',
        createdAtOrdinal: 3,
        screenStates: [makeScreenStateFixture()],
        initialEvents: [],
        relations: [],
        provenance: { mode: 'run-linked', runId: 'durable', testId: 't', stepIndex: 0 },
        artifacts: [],
      },
    )
    if (outcome.kind !== 'published') throw new Error('fixture publish failed')
    return outcome.id
  }

  it('round-trips a proposal through the FILESYSTEM with its schemaVersion intact', () => {
    const knowledgeRoot = join(root, 'agent-qa-knowledge')
    const recordId = publishAndRead(knowledgeRoot, agentQaRoot)
    const minted = proposeReview({
      agentQaRoot,
      knowledgeRoot,
      request: { verb: 'forget', input: { target: { grain: 'record', recordId } } },
    })
    if (minted.kind !== 'proposed') throw new Error('expected a proposal')

    // Read back through the module's own boundary — which parses, so a document that could not
    // survive a second process would throw here rather than be believed.
    const reread = readPendingProposal(agentQaRoot, minted.proposal.proposalId)
    expect(reread).toEqual(minted.proposal)
    expect(reread?.schemaVersion).toBe(1)
    expect(reread?.status).toBe('pending')

    // And the bytes on disk are a document, not a memo: the id is in the file NAME, so a second
    // process needs nothing but the id it was handed.
    const raw = JSON.parse(
      readFileSync(join(proposalsDir(agentQaRoot), `${minted.proposal.proposalId}.json`), 'utf8'),
    ) as { schemaVersion: number }
    expect(raw.schemaVersion).toBe(1)
  })

  it('lets exactly ONE claim win, and tells the loser what the winner did', () => {
    const knowledgeRoot = join(root, 'agent-qa-knowledge')
    const recordId = publishAndRead(knowledgeRoot, agentQaRoot)
    const minted = proposeReview({
      agentQaRoot,
      knowledgeRoot,
      request: { verb: 'accept', input: { target: { grain: 'record', recordId } } },
    })
    if (minted.kind !== 'proposed') throw new Error('expected a proposal')
    const id = minted.proposal.proposalId

    const first = claimPendingProposal(agentQaRoot, id)
    expect(first.kind).toBe('consumed')

    // The second claim finds the pending name GONE — and, since 387-12, is told WHY.
    //
    // THIS ASSERTION PREVIOUSLY READ `not-found`, AND IT WAS PINNING THE DEFECT. The comment it
    // carried argued that before the winner publishes, "that is a not-found rather than an
    // already-applied — the two are different facts and the store says so instead of guessing".
    // The premise was right and the conclusion was wrong: there are THREE facts, not two, and
    // collapsing the third into `not-found` is what made `applyReview` tell a racing loser that
    // the id it is holding names nothing (CR-03). The window between the claim rename and the
    // applied publish spans the entire commit, so it is not a sliver — it is the normal duration
    // of an apply.
    expect(claimPendingProposal(agentQaRoot, id).kind).toBe('apply-in-flight')

    // An id with NO pending file, NO applied file and NO claim marker is still `not-found`. The
    // control matters: without it, an arm that answered `apply-in-flight` unconditionally would
    // satisfy the assertion above.
    expect(claimPendingProposal(agentQaRoot, 'prop_00000000-0000-4000-8000-000000000000').kind)
      .toBe('not-found')

    publishAppliedProposal(agentQaRoot, { proposal: minted.proposal })
    const loser = claimPendingProposal(agentQaRoot, id)
    expect(loser.kind).toBe('already-applied')
    if (loser.kind !== 'already-applied') throw new Error('unreachable')
    expect(loser.record.proposal.status).toBe('applied')
    expect(loser.record.proposal.proposalId).toBe(id)

    // Applied proposals are RETAINED (D-04): the address a forgotten entity resolves to must not
    // be a file somebody reaped.
    expect(readAppliedProposal(agentQaRoot, id)?.proposal.proposalId).toBe(id)
  })

  it('tells apply-in-flight, already-applied and not-found apart by the FILES (CR-03)', () => {
    const knowledgeRoot = join(root, 'agent-qa-knowledge')
    const recordId = publishAndRead(knowledgeRoot, agentQaRoot)
    const minted = proposeReview({
      agentQaRoot,
      knowledgeRoot,
      request: { verb: 'forget', input: { target: { grain: 'record', recordId } } },
    })
    if (minted.kind !== 'proposed') throw new Error('expected a proposal')
    const id = minted.proposal.proposalId
    const dir = proposalsDir(agentQaRoot)

    // PENDING, nothing claimed: the ordinary first claim.
    expect(claimPendingProposal(agentQaRoot, id).kind).toBe('consumed')

    // The claim marker is a REAL file with the winner's pid in its name, and the detection is a
    // point lookup for this id's prefix rather than a listing. Asserting the file's existence
    // first is what keeps the arm below from being satisfiable by an unconditional answer.
    const markers = readdirSync(dir).filter((entry) => entry.startsWith(`${id}.json.claimed.`))
    expect(markers, 'the claim must be visible on disk for the arm to read it').toHaveLength(1)
    expect(markers[0]).toBe(`${id}.json.claimed.${process.pid}`)
    expect(claimPendingProposal(agentQaRoot, id).kind).toBe('apply-in-flight')

    // A NEIGHBOURING id must not be answered from this one's marker. `${id}x` shares the whole
    // id as a prefix, which is exactly the collision a naive `startsWith(id)` would make: the
    // `.json` separator in the real prefix is what prevents it.
    expect(claimPendingProposal(agentQaRoot, `${id}x`).kind).toBe('not-found')

    // PUBLISH retires the marker, and the answer flips to already-applied. This is the
    // double-check ordering case: `publishAppliedProposal` writes the applied file FIRST and
    // renames the marker away second, so a caller can observe "marker present, applied present"
    // — and must report the applied record rather than a wait.
    publishAppliedProposal(agentQaRoot, { proposal: minted.proposal })
    expect(readdirSync(dir).filter((entry) => entry.startsWith(`${id}.json.claimed.`)))
      .toHaveLength(0)
    expect(claimPendingProposal(agentQaRoot, id).kind).toBe('already-applied')
  })

  it('reports already-applied when a marker and an applied file BOTH exist (CR-03)', () => {
    const knowledgeRoot = join(root, 'agent-qa-knowledge')
    const recordId = publishAndRead(knowledgeRoot, agentQaRoot)
    const minted = proposeReview({
      agentQaRoot,
      knowledgeRoot,
      request: { verb: 'accept', input: { target: { grain: 'record', recordId } } },
    })
    if (minted.kind !== 'proposed') throw new Error('expected a proposal')
    const id = minted.proposal.proposalId

    expect(claimPendingProposal(agentQaRoot, id).kind).toBe('consumed')
    // The applied file lands without the marker being retired — the durable intermediate state
    // `publishAppliedProposal` passes through, reconstructed here by hand.
    //
    // WHAT THIS CASE MEASURES, corrected in round 2 because the previous wording claimed more:
    // it is an ADMIT CONTROL for a durable state, not a measurement of the resolution's ordering.
    // The applied file is present BEFORE the call, so the resolution's very first read answers and
    // no window arm ever executes — which is exactly why deleting the window's re-read left this
    // case green (the WR-05 vacuity measurement). The window between the first read and the claim
    // scan is owned by the seam-driven cases below, which stand inside it rather than around it.
    writeFileSync(
      join(proposalsDir(agentQaRoot), `${id}.applied.json`),
      `${JSON.stringify({ proposal: { ...minted.proposal, status: 'applied' } }, undefined, 2)}\n`,
      'utf8',
    )
    expect(existsSync(join(proposalsDir(agentQaRoot), `${id}.json.claimed.${process.pid}`)))
      .toBe(true)

    // A wait here would be a wait for work already durable.
    const outcome = claimPendingProposal(agentQaRoot, id)
    expect(outcome.kind).toBe('already-applied')
    if (outcome.kind !== 'already-applied') throw new Error('unreachable')
    expect(outcome.record.proposal.proposalId).toBe(id)
  })

  // ── CR-03′: the window BETWEEN the resolution's first applied read and its claim scan ────────
  //
  // Every case above arranges a durable state and then calls the resolution, so the resolution
  // reads a filesystem that is holding still. The cases below do the opposite: they let the
  // filesystem MOVE while the resolution is midway through reading it, which is the only place
  // the defect CR-03′ names can live. `onAfterFirstRead` is what makes that possible — the window
  // is otherwise syscall-width and no test can stand inside it.
  //
  // The write set the window must survive has exactly two members, and both are here, because
  // exactly two renames in this module retire a claim marker: `publishAppliedProposal` (which
  // makes the applied file durable FIRST and retires the marker SECOND, so its partial state
  // W1-only is a third observable and is also here) and `restorePendingProposal` (whose single
  // rename retires the marker and lands the pending name in the same operation). A resolution
  // that re-reads only ONE of those two durable names after the scan is directional again under
  // a different name.
  //
  // IN-PROCESS LIMIT, inherited rather than re-argued (387-12 recorded it for the claim cases
  // above): `publishAppliedProposal` can only retire a claim parked under its OWN pid, so the
  // winner these cases play is this process. Two OS processes contending on the rename is a
  // kernel property, asserted where it belongs and not measured here.

  it('answers already-applied when the winner publishes INSIDE the resolution window (CR-03′)', () => {
    const knowledgeRoot = join(root, 'agent-qa-knowledge')
    const recordId = publishAndRead(knowledgeRoot, agentQaRoot)
    const minted = proposeReview({
      agentQaRoot,
      knowledgeRoot,
      request: { verb: 'accept', input: { target: { grain: 'record', recordId } } },
    })
    if (minted.kind !== 'proposed') throw new Error('expected a proposal')
    const id = minted.proposal.proposalId

    // The winner takes the claim; this caller is the loser from here on.
    expect(claimPendingProposal(agentQaRoot, id).kind).toBe('consumed')

    // L1 · W1 · W2 · L2 — the interleave the round-2 verifier reproduced. The loser's first
    // applied read misses, and only THEN does the winner complete its whole publish.
    let fired = 0
    const outcome = claimPendingProposal(agentQaRoot, id, {
      onAfterFirstRead: () => {
        fired += 1
        publishAppliedProposal(agentQaRoot, { proposal: minted.proposal })
      },
    })
    expect(fired, 'the seam must fire exactly once, between the first read and the scan').toBe(1)
    // The marker really IS gone by the time the scan runs, so this case exercises the
    // marker-absent exit rather than sneaking through the marker-present one. The retired name is
    // `<id>.applied.json.claim`, which the claim prefix cannot match.
    expect(readdirSync(proposalsDir(agentQaRoot)).filter((e) => e.startsWith(`${id}.json.claimed.`)))
      .toHaveLength(0)

    // RED BASELINE, observed against the seam-added-but-still-DIRECTIONAL resolution (the re-read
    // living only inside the marker-present arm), transcribed from the failing run:
    //
    //   × answers already-applied when the winner publishes INSIDE the resolution window (CR-03′)
    //     → AssertionError: a durably applied proposal must never be reported as never-minted
    //       expected 'not-found' to be 'already-applied'
    expect(outcome.kind, 'a durably applied proposal must never be reported as never-minted')
      .toBe('already-applied')
    if (outcome.kind !== 'already-applied') throw new Error('unreachable')
    expect(outcome.record.proposal.proposalId).toBe(id)
    expect(outcome.record.proposal.status).toBe('applied')
  })

  it('answers already-applied when only the applied FILE lands inside the window (CR-03′)', () => {
    const knowledgeRoot = join(root, 'agent-qa-knowledge')
    const recordId = publishAndRead(knowledgeRoot, agentQaRoot)
    const minted = proposeReview({
      agentQaRoot,
      knowledgeRoot,
      request: { verb: 'accept', input: { target: { grain: 'record', recordId } } },
    })
    if (minted.kind !== 'proposed') throw new Error('expected a proposal')
    const id = minted.proposal.proposalId

    expect(claimPendingProposal(agentQaRoot, id).kind).toBe('consumed')

    // W1 WITHOUT W2 — the publish is half done inside the window: the applied file is durable and
    // the marker is still parked. This is the arm the OLD one-sided re-read served, and it must
    // keep being served by the single post-scan re-read that replaced it. Two exits, one
    // mechanism: deleting that re-read must red THIS case as well as the one above.
    const outcome = claimPendingProposal(agentQaRoot, id, {
      onAfterFirstRead: () => {
        writeFileSync(
          join(proposalsDir(agentQaRoot), `${id}.applied.json`),
          `${JSON.stringify({ proposal: { ...minted.proposal, status: 'applied' } }, undefined, 2)}\n`,
          'utf8',
        )
      },
    })

    expect(existsSync(join(proposalsDir(agentQaRoot), `${id}.json.claimed.${process.pid}`)))
      .toBe(true)
    expect(outcome.kind, 'a wait here would be a wait for work already durable')
      .toBe('already-applied')
    if (outcome.kind !== 'already-applied') throw new Error('unreachable')
    expect(outcome.record.proposal.proposalId).toBe(id)
  })

  it('does not report not-found when the winner RESTORES inside the window (CR-03′ sibling)', () => {
    const knowledgeRoot = join(root, 'agent-qa-knowledge')
    const recordId = publishAndRead(knowledgeRoot, agentQaRoot)
    const minted = proposeReview({
      agentQaRoot,
      knowledgeRoot,
      request: { verb: 'reject', input: { target: { grain: 'record', recordId }, reason: 'no' } },
    })
    if (minted.kind !== 'proposed') throw new Error('expected a proposal')
    const id = minted.proposal.proposalId

    expect(claimPendingProposal(agentQaRoot, id).kind).toBe('consumed')

    // THE SIBLING RENAME. `restorePendingProposal` retires the claim marker too, and it does so in
    // the same single rename that lands the pending name — so a scan that sees the marker absent
    // has exactly two explanations, and a resolution that checks only the applied one calls a
    // fully applicable pending proposal never-minted.
    //
    // RED BASELINE, observed against the seam-added-but-still-DIRECTIONAL resolution:
    //
    //   × does not report not-found when the winner RESTORES inside the window (CR-03′ sibling)
    //     → AssertionError: the pending name is back on disk; nothing here is missing
    //       expected 'not-found' not to be 'not-found'
    // 387-18 extends this case with the SECOND seam position, attached and INERT — it is the
    // no-third-claimer control for the three-participant case below. Same interleave, nobody in
    // gap 2: the answer must still never be not-found, and the resolution must reach it on pass
    // ONE (the count below), so the re-entry is not what is rescuing this case.
    let scanFired = 0
    const outcome = claimPendingProposal(agentQaRoot, id, {
      onAfterFirstRead: () => { restorePendingProposal(agentQaRoot, id) },
      onAfterClaimScan: () => { scanFired += 1 },
    })

    expect(readPendingProposal(agentQaRoot, id)).toEqual(minted.proposal)
    expect(outcome.kind, 'the pending name is back on disk; nothing here is missing')
      .not.toBe('not-found')
    // `apply-in-flight` is the arm that routes to `settleClaim`'s existing bounded retry loop,
    // which re-asks and claims the restored proposal on its next poll. The store does not grow a
    // second recovery mechanism beside the one the caller already has.
    expect(outcome.kind).toBe('apply-in-flight')
    expect(scanFired, 'the pending re-read answers on pass 1; nothing re-enters here').toBe(1)
  })

  // ── CR-03″: the gap BETWEEN the scan and the re-reads, which needs a THIRD participant ───────
  //
  // The block above establishes SINGLE-RETIREMENT totality: one rename retiring one marker cannot
  // hide a proposal from the post-scan re-reads, because every such rename leaves a durable name
  // on disk at the instant the scan runs. True, and it is not the same statement as "no
  // interleaving can hide a proposal" — the scan is not atomic with the re-reads, so a name that
  // IS on disk when the scan runs can be consumed before a re-read reaches it. Two renames by two
  // different participants, one in each gap, is the cheapest schedule that does it.
  //
  // What makes the answer a mechanism instead of another sentence: the resolution re-enters
  // ITSELF once before it will say not-found, and each pass is headed by the claim rename, the
  // only atomic operation on this path. `onAfterClaimScan` is what makes the schedule drivable at
  // all — the same measurement-demands-it ground as `onAfterFirstRead`.

  it('never answers not-found when a THIRD participant claims the restored name (CR-03″)', () => {
    const knowledgeRoot = join(root, 'agent-qa-knowledge')
    const recordId = publishAndRead(knowledgeRoot, agentQaRoot)
    const minted = proposeReview({
      agentQaRoot,
      knowledgeRoot,
      request: { verb: 'accept', input: { target: { grain: 'record', recordId } } },
    })
    if (minted.kind !== 'proposed') throw new Error('expected a proposal')
    const id = minted.proposal.proposalId
    const dir = proposalsDir(agentQaRoot)

    // W wins the claim, and its commit is about to fail.
    expect(claimPendingProposal(agentQaRoot, id).kind).toBe('consumed')

    // C is the THIRD participant and lives in another process, so its claim carries a pid that is
    // not ours. It is parked by hand for the reason stated at the top of this block: this
    // module's own renames only move a claim filed under THIS pid, so a foreign holder is a state
    // the fixture has to construct rather than one it can drive through the module.
    const foreignPid = process.pid + 1
    const foreignClaim = join(dir, `${id}.json.claimed.${foreignPid}`)

    let firstReadCalls = 0
    let firstReadActions = 0
    let scanCalls = 0
    let scanActions = 0

    const outcome = claimPendingProposal(agentQaRoot, id, {
      // GAP 1 — W's commit refuses and it hands the proposal back. This is the second
      // marker-retiring rename (387-16 D-1): the marker is retired and the pending name lands in
      // the same operation, so after it there is a proposal on disk and no marker at all.
      onAfterFirstRead: () => {
        firstReadCalls += 1
        if (firstReadActions > 0) return
        firstReadActions += 1
        restorePendingProposal(agentQaRoot, id)
      },
      // GAP 2 — C claims the restored pending name, AFTER the scan that just found no marker and
      // BEFORE the re-reads that would have found the pending file. Each durable name this
      // resolution knows how to look for was on disk one syscall before the read that looks for
      // it, and neither is there now. Single-retirement totality is untouched by this and does
      // not cover it: there were two retirements, by two participants, one per gap.
      onAfterClaimScan: () => {
        scanCalls += 1
        if (scanActions > 0) return
        scanActions += 1
        renameSync(join(dir, `${id}.json`), foreignClaim)
      },
    })

    // The fixture really drove the schedule: C holds the proposal under a foreign pid, and
    // neither name this store answers from exists. Without these three lines the assertion below
    // could be satisfied by an interleave that never happened.
    expect(existsSync(foreignClaim), 'C must really hold the proposal for the arm to find it')
      .toBe(true)
    expect(readPendingProposal(agentQaRoot, id)).toBeUndefined()
    expect(readAppliedProposal(agentQaRoot, id)).toBeUndefined()

    // RED BASELINE, observed against the seam-added-but-SINGLE-PASS resolution (both hook
    // positions present, the bounded re-entry not), transcribed from the failing run:
    //
    //   × never answers not-found when a THIRD participant claims the restored name (CR-03″)
    //     → AssertionError: a proposal parked under a foreign claim is not one this store never
    //       minted: expected 'not-found' to be 'apply-in-flight' // Object.is equality
    //         Expected: "apply-in-flight"
    //         Received: "not-found"
    //
    // `not-found` for a file sitting on disk, fully applicable, is the repudiation this whole
    // arc is about: `settleClaim` maps it to an immediate ProposalNotFoundError with no retry.
    expect(
      outcome.kind,
      'a proposal parked under a foreign claim is not one this store never minted',
    ).toBe('apply-in-flight')
    if (outcome.kind !== 'apply-in-flight') throw new Error('unreachable')
    // …and the answer NAMES C's file. An arm that answered `apply-in-flight` whenever it was
    // confused would satisfy the line above; naming the parked path means the second pass's own
    // scan is what produced the answer (WR-06).
    expect(outcome.claimPath).toBe(foreignClaim)

    // THE VISIBLE EVIDENCE THAT A SECOND PASS RAN. Both hooks stay attached for the whole call
    // and are invoked once per pass; each acts only on its first invocation. So `2 calls / 1
    // action` reads as: two full passes ran, and pass 2 ran against disk state alone with no
    // fixture event inside it — it answered from the atomic rename and the scan, not from
    // anything this test did while it was running.
    expect(firstReadCalls, 'the first-read seam fires once per pass; two passes ran').toBe(2)
    expect(scanCalls, 'the post-scan seam fires once per pass; two passes ran').toBe(2)
    expect(firstReadActions, 'the restore happened exactly once, in gap 1 of pass 1').toBe(1)
    expect(scanActions, 'C claimed exactly once, in gap 2 of pass 1').toBe(1)
  })

  it('still answers apply-in-flight and not-found with the seam in place (CR-03′ controls)', () => {
    const knowledgeRoot = join(root, 'agent-qa-knowledge')
    const recordId = publishAndRead(knowledgeRoot, agentQaRoot)
    const minted = proposeReview({
      agentQaRoot,
      knowledgeRoot,
      request: { verb: 'forget', input: { target: { grain: 'record', recordId } } },
    })
    if (minted.kind !== 'proposed') throw new Error('expected a proposal')
    const id = minted.proposal.proposalId

    // THE OVER-BROADENING CONTROLS. A resolution that answered `already-applied` — or anything
    // other than these two — whenever its window was driven would satisfy every case above. Both
    // run WITH BOTH seam positions attached and inert, so the seam itself is not what changes the
    // answer.
    //
    // THE INVOCATION COUNTS BELOW ARE ALSO PASS COUNTS, and they differ between the two controls
    // for a reason worth reading rather than normalising: 387-18's bounded re-entry re-runs the
    // whole resolution ONLY when the first pass reaches the not-found exit. A control that
    // terminates on pass 1 still counts 1. The parked control does; the unknown-id control does
    // not, and its 2 is the visible evidence that the second pass ran and also found nothing.
    // Each count was measured by running, not derived — the parked control's stayed 1 unchanged.
    expect(claimPendingProposal(agentQaRoot, id).kind).toBe('consumed')
    let parkedFirstRead = 0
    let parkedScan = 0
    expect(
      claimPendingProposal(agentQaRoot, id, {
        onAfterFirstRead: () => { parkedFirstRead += 1 },
        onAfterClaimScan: () => { parkedScan += 1 },
      }).kind,
    ).toBe('apply-in-flight')
    expect(parkedFirstRead, 'the marker is found on pass 1, so no re-entry happens').toBe(1)
    expect(parkedScan, 'the marker is found on pass 1, so no re-entry happens').toBe(1)

    let unknownFirstRead = 0
    let unknownScan = 0
    expect(
      claimPendingProposal(agentQaRoot, 'prop_00000000-0000-4000-8000-000000000000', {
        onAfterFirstRead: () => { unknownFirstRead += 1 },
        onAfterClaimScan: () => { unknownScan += 1 },
      }).kind,
    ).toBe('not-found')
    // CHANGED BY 387-18, and named rather than quietly loosened (this file's assertion previously
    // read `toBe(1)`). A not-found answer now requires TWO complete resolutions to find nothing,
    // the second entered through the atomic claim rename, so an id that names nothing runs the
    // seam twice by construction. A 1 here would mean the re-entry did not happen.
    expect(unknownFirstRead, 'not-found costs two full passes since 387-18').toBe(2)
    expect(unknownScan, 'not-found costs two full passes since 387-18').toBe(2)
  })

  // IN-03 — OUT OF DENOMINATOR. Defence-in-depth at the boundary that does the joining; it
  // closes no scored truth and moves no score. `knowledge.proposal.apply`'s function layer
  // already refuses a malformed id one package away, which is exactly the argument this case
  // exists to stop relying on: the refusal is on ONE path a caller can reach this store by, and
  // the store is the module that turns a caller's id into a rename target.
  //
  // THE INPUT IS DRAWN FROM OUTSIDE THE SHAPE THE MODULE ITSELF MINTS (the precondition-guarded
  // corpus law). `mintProposalId` produces `prop_<uuid>`; a rule checked only against ids of that
  // shape is checked from inside its own assumption. This id is one `mintProposalId` cannot
  // produce and `join()` happily resolves.
  it('refuses a traversal-bearing proposal id before any syscall (IN-03)', () => {
    const knowledgeRoot = join(root, 'agent-qa-knowledge')
    const recordId = publishAndRead(knowledgeRoot, agentQaRoot)
    const minted = proposeReview({
      agentQaRoot,
      knowledgeRoot,
      request: { verb: 'accept', input: { target: { grain: 'record', recordId } } },
    })
    if (minted.kind !== 'proposed') throw new Error('expected a proposal')

    // A DECOY OUTSIDE THE PROPOSALS DIRECTORY, holding a document this store would recognise.
    // `proposalsDir` is `<root>/.agent-qa/proposals`, so `../../escaped` resolves to `<root>`,
    // which is inside the digest's reach — the effect is therefore visible rather than merely
    // argued about. An assertion that something did not happen is load-bearing only if the input
    // could have made it happen, and this input could: with no shape check, the claim rename
    // moves this file and the store returns its contents as a consumed proposal.
    const TRAVERSAL_ID = '../../escaped'
    const escaped = join(root, 'escaped.json')
    writeFileSync(escaped, `${JSON.stringify(minted.proposal, undefined, 2)}\n`, 'utf8')

    const before = hashTree(root)

    // POTENCY. The digest can see the exact effect the guard prevents: renaming the decoy the way
    // an unguarded join() would moves it, and putting it back returns the digest. Without this
    // pair the invariance assertion below could be a hash over the wrong directory.
    renameSync(escaped, `${escaped}.claimed.probe`)
    expect(hashTree(root), 'the digest must be able to SEE the traversal it is asserting against')
      .not.toBe(before)
    renameSync(`${escaped}.claimed.probe`, escaped)
    expect(hashTree(root)).toBe(before)

    // RED BASELINE, observed against the unguarded store, transcribed from the failing run:
    //
    //   × refuses a traversal-bearing proposal id before any syscall (IN-03)
    //     → AssertionError: an id this store could never have minted may not become a rename
    //       target: expected [Function] to throw an error
    //
    // …and the RED was not merely a missing throw. The unguarded call answered
    // `{ kind: 'consumed' }` carrying the decoy's contents, having renamed
    // `<root>/escaped.json` to `<root>/escaped.json.claimed.<pid>` — renameSync as an
    // arbitrary-path primitive, driven by a caller-supplied string (T-387-18-03).
    expect(
      () => claimPendingProposal(agentQaRoot, TRAVERSAL_ID),
      'an id this store could never have minted may not become a rename target',
    ).toThrow()

    // Nothing moved, anywhere under the tmp root — not just inside the proposals directory.
    expect(hashTree(root), 'a refused id may not leave a trace outside the proposals directory')
      .toBe(before)
    expect(existsSync(escaped), 'the decoy is exactly where it was').toBe(true)

    // ADMIT CONTROL, in the same case so the guard cannot pass by rejecting everything: the id
    // this module mints for itself still resolves through the ordinary path.
    expect(claimPendingProposal(agentQaRoot, minted.proposal.proposalId).kind).toBe('consumed')
  })

  it('puts a claimed proposal BACK when the work it was claimed for fails', () => {
    const knowledgeRoot = join(root, 'agent-qa-knowledge')
    const recordId = publishAndRead(knowledgeRoot, agentQaRoot)
    const minted = proposeReview({
      agentQaRoot,
      knowledgeRoot,
      request: { verb: 'reject', input: { target: { grain: 'record', recordId }, reason: 'no' } },
    })
    if (minted.kind !== 'proposed') throw new Error('expected a proposal')
    const id = minted.proposal.proposalId

    expect(claimPendingProposal(agentQaRoot, id).kind).toBe('consumed')
    expect(readPendingProposal(agentQaRoot, id)).toBeUndefined()

    restorePendingProposal(agentQaRoot, id)

    // Exactly as applicable as before the attempt — a half-consumed proposal is invisible data
    // loss, because the caller sees an error and is then told the id names nothing.
    expect(readPendingProposal(agentQaRoot, id)).toEqual(minted.proposal)
    expect(claimPendingProposal(agentQaRoot, id).kind).toBe('consumed')
  })
})
