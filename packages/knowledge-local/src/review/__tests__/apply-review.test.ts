// Apply routes through the ONE commit path, race-safely and idempotently (387-08, KREV-01).
//
// The zero-recall case is the one that had to be built carefully rather than merely written. A
// "the record is gone from search" assertion is worthless unless the record was FINDABLE first, on
// BOTH legs, so each leg is asserted present before the forget and absent after. The vec leg in
// particular is populated with a real embedder-shaped backfill; without that, "no vec row" would
// have been true before the verb ran and the whole half would have been measuring nothing.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'

import { DEFAULT_EMBEDDING_PROFILE } from '@vostride/agent-qa-schema'
import type { Anchor } from '@vostride/agent-qa-schema'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { publishBundle } from '../../bundle-publish.test-helper.js'
import { listBundles } from '../../list-bundles.js'
import { openIndexReaderConnection, vecTableName } from '../../index-open.js'
import { rebuildIndex } from '../../index-rebuild.js'
import { acquireWriterLease, releaseLease } from '../../lease/writer-lease.js'
import {
  makeBundleDraftFixture,
  makeScreenStateFixture,
  scaffoldKnowledgeRoot,
} from '../../__tests__/fixtures/bundle-fixture.js'
import { makeFakeEmbedder } from '../../__tests__/fixtures/fake-embedder.js'
import {
  APPLY_DELEGATE_TIMEOUT_MS,
  ApplyDelegateTimeoutError,
  ApplyDelegateUnavailableError,
  applyReview,
} from '../apply-review.js'
import { proposeReview } from '../propose-review.js'
import { readAppliedProposal, readPendingProposal } from '../proposals-store.js'

const ANCHOR: Anchor = { t: 'el', role: 'Button', name: 'Checkout' }

interface RecallRows {
  readonly fts: number
  readonly vec: number
  readonly graph: number
}

describe('apply — one commit path, receipts at the boundary, race-safe consumption', () => {
  let root: string
  let knowledgeRoot: string
  let agentQaRoot: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'knowledge-review-apply-'))
    knowledgeRoot = join(root, 'agent-qa-knowledge')
    agentQaRoot = join(root, '.agent-qa')
    scaffoldKnowledgeRoot(knowledgeRoot)
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function publish(summary: string): string {
    const outcome = publishBundle(
      {
        knowledgeRoot,
        productKey: 'Apply Product',
        auditBaseDir: agentQaRoot,
        commitArtifacts: 'none',
      },
      {
        draft: makeBundleDraftFixture({
          kind: 'fact',
          anchors: [ANCHOR],
          scope: { tier: 'product', key: 'apply-storefront' },
          summary,
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
        provenance: { mode: 'run-linked', runId: `apply-${summary}`, testId: 't', stepIndex: 0 },
        artifacts: [],
      },
    )
    if (outcome.kind !== 'published') throw new Error(`fixture publish failed: ${outcome.kind}`)
    return outcome.id
  }

  async function projectIndex(): Promise<void> {
    const lease = acquireWriterLease(knowledgeRoot)
    if (lease.kind !== 'acquired') throw new Error('fixture could not take the lease')
    try {
      await rebuildIndex({
        knowledgeRoot,
        embedder: makeFakeEmbedder(),
        writerAuthority: { knowledgeRoot, leaseId: lease.leaseId, epoch: lease.epoch },
      })
    } finally {
      releaseLease({ knowledgeRoot, leaseId: lease.leaseId })
    }
  }

  /** Recall rows for ONE record, on all three legs the §7.7 scrub covers. */
  function recallRows(recordId: string): RecallRows {
    const connection = openIndexReaderConnection(knowledgeRoot)
    const db: DatabaseSync = connection.db
    try {
      const record = db
        .prepare('SELECT record_rowid FROM records WHERE bundle_id = ?')
        .get(recordId) as { record_rowid?: number } | undefined
      if (record?.record_rowid === undefined) return { fts: 0, vec: 0, graph: 0 }
      const rowid = Number(record.record_rowid)
      const count = (sql: string): number => {
        const row = db.prepare(sql).get(BigInt(rowid)) as { n?: number } | undefined
        return Number(row?.n ?? 0)
      }
      return {
        fts: count('SELECT COUNT(*) AS n FROM fts_records WHERE rowid = ?'),
        vec: count(
          `SELECT COUNT(*) AS n FROM ${vecTableName(DEFAULT_EMBEDDING_PROFILE)} ` +
            'WHERE record_rowid = ?',
        ),
        graph: count('SELECT COUNT(*) AS n FROM graph_edges WHERE record_rowid = ?'),
      }
    } finally {
      db.close()
    }
  }

  function proposeForget(recordId: string): string {
    const outcome = proposeReview({
      agentQaRoot,
      knowledgeRoot,
      request: { verb: 'forget', input: { target: { grain: 'record', recordId } } },
    })
    if (outcome.kind !== 'proposed') throw new Error('expected a forget proposal')
    return outcome.proposal.proposalId
  }

  it('tombstones without destroying, scrubs every projection it names, and receipts it', async () => {
    const recordId = publish('checkout button')
    await projectIndex()

    // POSITIVE CONTROL, and the case is worthless without it: every leg the receipt will claim
    // to have scrubbed must be POPULATED first, or "zero rows afterwards" is a fact about a leg
    // that was never there.
    const before = recallRows(recordId)
    expect(before.fts, 'the FTS leg must be populated for the absence to mean anything').toBe(1)
    expect(before.vec, 'the VEC leg must be populated for the absence to mean anything').toBe(1)

    const proposalId = proposeForget(recordId)
    const result = await applyReview({ agentQaRoot, knowledgeRoot, proposalId, now: () => 1234 })

    expect(result.outcome).toBe('applied')
    expect(result.proposal.status).toBe('applied')
    const receipt = result.forgetReceipt
    if (receipt === undefined) throw new Error('a forget must produce a receipt')
    expect(receipt.tombstonedRecords.map((row) => row.recordId)).toEqual([recordId])
    expect(receipt.tombstonedRecords[0]?.provenance.mode).toBe('run-linked')
    expect(receipt.resultingBundleStatus).toBe('tombstoned')
    expect(receipt.forgottenAt).toBe(1234)

    // NEVER DESTROY: the bundle is still enumerable and still says what happened to it.
    const rows = listBundles(knowledgeRoot)
    expect(rows.map((row) => row.bundleId)).toEqual([recordId])
    expect(rows[0]?.status).toBe('deprecated')

    // …and every projection the receipt NAMES is verified individually rather than trusted.
    //
    // A TOTAL lookup with no fallback, deliberately. The first draft of this loop ended in a
    // `: after.graph` else-branch, which silently mapped a claimed `exemplar` onto the graph
    // count — so a receipt claiming a projection nobody scrubs would have PASSED. That is the
    // exact failure mode this case exists to catch, and an unverifiable claim is now a failure
    // rather than a coincidence.
    const after = recallRows(recordId)
    const verifiable: Readonly<Record<string, number>> = {
      fts: after.fts,
      vec: after.vec,
      graph: after.graph,
    }
    for (const projection of receipt.projectionsScrubbed) {
      expect(
        Object.hasOwn(verifiable, projection),
        `the receipt claims ${projection} was scrubbed and this case cannot verify it — a ` +
          'receipt naming a projection nobody scrubbed is worse than no receipt',
      ).toBe(true)
      expect(verifiable[projection], `receipt claims ${projection} was scrubbed`).toBe(0)
    }
    // …and it does NOT claim `exemplar`, because nothing scrubs one: an exemplar in this system
    // is a test reference out of the run-outcome projection, not a knowledge record.
    expect(receipt.projectionsScrubbed).not.toContain('exemplar')
  })

  it('is idempotent: a second apply returns the FIRST receipt and commits nothing', async () => {
    const recordId = publish('checkout button')
    await projectIndex()
    const proposalId = proposeForget(recordId)

    const first = await applyReview({ agentQaRoot, knowledgeRoot, proposalId, now: () => 111 })
    const storeAfterFirst = listBundles(knowledgeRoot)

    const second = await applyReview({ agentQaRoot, knowledgeRoot, proposalId, now: () => 222 })

    expect(second.outcome).toBe('already-applied')
    // The FIRST receipt, verbatim — a recomputed one would carry `222` and would be an answer
    // about now rather than about what happened.
    expect(second.forgetReceipt).toEqual(first.forgetReceipt)
    expect(second.forgetReceipt?.forgottenAt).toBe(111)
    expect(listBundles(knowledgeRoot)).toEqual(storeAfterFirst)
  })

  it('records exactly one application even when two applies overlap', async () => {
    const recordId = publish('checkout button')
    await projectIndex()
    const proposalId = proposeForget(recordId)

    // Both applies are STARTED before either is awaited, so the claim, the lease acquisition and
    // the commit interleave on one event loop. This is genuine overlap of the async work; it is
    // NOT two OS processes contending on the rename, and that limit is stated rather than
    // implied — the atomic-rename property under real multi-process contention is asserted at
    // the kernel and is not what this case measures.
    const settled = await Promise.allSettled([
      applyReview({ agentQaRoot, knowledgeRoot, proposalId, now: () => 1 }),
      applyReview({ agentQaRoot, knowledgeRoot, proposalId, now: () => 2 }),
    ])

    const fulfilled = settled.filter((entry) => entry.status === 'fulfilled')
    const outcomes = fulfilled.map((entry) => (entry as PromiseFulfilledResult<{
      outcome: string
    }>).value.outcome)
    // Exactly one commit: one `applied`, and the other call either loses the claim
    // (`already-applied`) or loses the LEASE and refuses — never a second commit.
    expect(outcomes.filter((outcome) => outcome === 'applied')).toHaveLength(1)
    expect(outcomes.filter((outcome) => outcome === 'applied').length
      + outcomes.filter((outcome) => outcome === 'already-applied').length)
      .toBe(outcomes.length)

    // The store shows ONE application: a second Deprecate would append a second event.
    const applied = readAppliedProposal(agentQaRoot, proposalId)
    expect(applied?.proposal.proposalId).toBe(proposalId)
    expect(listBundles(knowledgeRoot).filter((row) => row.status === 'deprecated')).toHaveLength(1)
  })

  it('names the already-tombstoned state rather than destroying twice (FUNC-04 adjacency)', async () => {
    const recordId = publish('checkout button')
    await projectIndex()

    const firstReceipt = (await applyReview({
      agentQaRoot,
      knowledgeRoot,
      proposalId: proposeForget(recordId),
      now: () => 10,
    })).forgetReceipt
    expect(firstReceipt?.resultingBundleStatus).toBe('tombstoned')
    const afterFirst = listBundles(knowledgeRoot)

    // A SECOND, independently minted forget over the same, now-tombstoned target.
    const secondId = proposeForget(recordId)
    const second = await applyReview({
      agentQaRoot,
      knowledgeRoot,
      proposalId: secondId,
      now: () => 20,
    })

    expect(second.outcome).toBe('applied')
    // The receipt states what IS: already tombstoned. The status is read back after the commit,
    // never copied forward from the preview.
    expect(second.forgetReceipt?.resultingBundleStatus).toBe('tombstoned')
    // …and nothing was destroyed a second time: the record still exists with the same status.
    expect(listBundles(knowledgeRoot)).toEqual(afterFirst)
  })

  it('leaves the proposal APPLICABLE when the commit refuses', async () => {
    const recordId = publish('checkout button')
    const proposalId = proposeForget(recordId)

    // A held lease is the realistic refusal, and it exercises the failure path end to end: the
    // claim is taken, the acquisition fails, and the proposal must come back.
    const holder = acquireWriterLease(knowledgeRoot)
    if (holder.kind !== 'acquired') throw new Error('fixture could not take the lease')
    try {
      await expect(applyReview({ agentQaRoot, knowledgeRoot, proposalId }))
        .rejects.toBeInstanceOf(ApplyDelegateUnavailableError)
    } finally {
      releaseLease({ knowledgeRoot, leaseId: holder.leaseId })
    }

    // Exactly as applicable as before the attempt — never half-consumed.
    expect(readPendingProposal(agentQaRoot, proposalId)?.proposalId).toBe(proposalId)
    expect(readAppliedProposal(agentQaRoot, proposalId)).toBeUndefined()

    const retried = await applyReview({ agentQaRoot, knowledgeRoot, proposalId })
    expect(retried.outcome).toBe('applied')
  })

  it('delegates instead of stealing when a live holder exists, and waits BOUNDED', async () => {
    const recordId = publish('checkout button')
    const proposalId = proposeForget(recordId)

    const holder = acquireWriterLease(knowledgeRoot)
    if (holder.kind !== 'acquired') throw new Error('fixture could not take the lease')
    try {
      // The delegate is handed the SAME proposal id and nothing else — no lease, no epoch, no
      // store handle. There is nothing here it could steal with.
      const seen: string[] = []
      const delegated = await applyReview({
        agentQaRoot,
        knowledgeRoot,
        proposalId,
        delegate: async (id) => {
          seen.push(id)
          return { outcome: 'applied', proposal: { ...readPendingProposal(agentQaRoot, id)!, status: 'applied' } }
        },
      })
      expect(seen).toEqual([proposalId])
      expect(delegated.outcome).toBe('applied')

      // The holder still holds it: nothing about delegating took, reclaimed or bumped the lease.
      const stillHeld = acquireWriterLease(knowledgeRoot)
      expect(stillHeld.kind).toBe('held')

      // A holder that never answers is REFUSED at the bound, not waited out and not taken over.
      await expect(applyReview({
        agentQaRoot,
        knowledgeRoot,
        proposalId,
        delegateTimeoutMs: 25,
        delegate: () => new Promise(() => {}),
      })).rejects.toBeInstanceOf(ApplyDelegateTimeoutError)

      // Still not stolen, and the proposal is still pending for the holder to find.
      expect(acquireWriterLease(knowledgeRoot).kind).toBe('held')
      expect(readPendingProposal(agentQaRoot, proposalId)?.proposalId).toBe(proposalId)
    } finally {
      releaseLease({ knowledgeRoot, leaseId: holder.leaseId })
    }

    expect(APPLY_DELEGATE_TIMEOUT_MS).toBeGreaterThan(1_000)
  })
})
