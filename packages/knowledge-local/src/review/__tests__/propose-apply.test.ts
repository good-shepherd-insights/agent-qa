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
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'

import type { Anchor, BundleDraft } from '@vostride/agent-qa-schema'
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

    // The second claim finds the pending name GONE. Before the winner publishes, that is a
    // not-found rather than an already-applied — the two are different facts and the store says
    // so instead of guessing.
    expect(claimPendingProposal(agentQaRoot, id).kind).toBe('not-found')

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
