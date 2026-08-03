// Apply routes through the ONE commit path, race-safely and idempotently (387-08, KREV-01).
//
// The zero-recall case is the one that had to be built carefully rather than merely written. A
// "the record is gone from search" assertion is worthless unless the record was FINDABLE first, on
// BOTH legs, so each leg is asserted present before the forget and absent after. The vec leg in
// particular is populated with a real embedder-shaped backfill; without that, "no vec row" would
// have been true before the verb ran and the whole half would have been measuring nothing.

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
import type { DatabaseSync } from 'node:sqlite'

import {
  BundleOutcomeEventSchema,
  DEFAULT_EMBEDDING_PROFILE,
  KNOWLEDGE_REVIEW_VERBS,
} from '@vostride/agent-qa-schema'
import type { Anchor, KnowledgeReviewVerb, RecordId } from '@vostride/agent-qa-schema'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { appendOutcomeEvent } from '../../bundle-append.js'
import { publishBundle, type BundleStoreConfig } from '../../bundle-publish.test-helper.js'
import { enumerateBundleDirs } from '../../bundle-scan.js'
import { UserDeltaCitationIntegrityError } from '../../curator/disposition.js'
import { reconcileOnDrainStart } from '../../journal/reconcile.js'
import { listBundles } from '../../list-bundles.js'
import { openIndexReaderConnection, vecTableName } from '../../index-open.js'
import { rebuildIndex } from '../../index-rebuild.js'
import { acquireWriterLease, releaseLease } from '../../lease/writer-lease.js'
import { listQueuedCandidates } from '../../queue/curation-queue.js'
import { claimedRoot } from '../../queue/queue-layout.js'
import {
  makeBundleDraftFixture,
  makeScreenStateFixture,
  scaffoldKnowledgeRoot,
} from '../../__tests__/fixtures/bundle-fixture.js'
import { makeFakeEmbedder } from '../../__tests__/fixtures/fake-embedder.js'
import {
  APPLY_DELEGATE_TIMEOUT_MS,
  APPLY_IN_FLIGHT_WAIT_MS,
  ApplyDelegateTimeoutError,
  ApplyDelegateUnavailableError,
  ProposalApplyInFlightError,
  applyReview,
} from '../apply-review.js'
import { FORGET_SCRUBBED_PROJECTIONS, proposeReview } from '../propose-review.js'
import {
  ProposalNotFoundError,
  claimPendingProposal,
  proposalsDir,
  publishAppliedProposal,
  readAppliedProposal,
  readPendingProposal,
  restorePendingProposal,
} from '../proposals-store.js'

const ANCHOR: Anchor = { t: 'el', role: 'Button', name: 'Checkout' }

/**
 * A content hash of every regular file under a directory tree, path-relative and sorted.
 *
 * Paths are part of the digest, not just contents: an apply that created an empty marker file
 * or renamed a bundle directory would leave every byte of content identical, and a
 * contents-only digest would call that "unchanged".
 *
 * DELIBERATELY DUPLICATED from propose-apply.test.ts:48-74 rather than extracted to a shared
 * module. The sibling wave-11 plan 387-18 owns that file and runs in the same wave; a shared
 * helper would couple the two diffs for no gain, and a digest helper is exactly the kind of
 * thing each corpus should be able to read in full without leaving its own file.
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

/**
 * The digest's own input domain, spelled out — asserted BEFORE the digest so a change is NAMED.
 *
 * `hashTree` answers "did anything change" with one opaque hex string; a corpus whose only
 * statement is that string reports a leak as `expected 'a1b2…' to be 'c3d4…'`, which tells the
 * next reader nothing about WHERE. This listing carries exactly what the digest carries — every
 * directory by path, every file by path and content hash — so asserting it first makes the
 * failure output print the offending entry itself.
 *
 * DIRECTORIES ARE ENTRIES HERE, and that is not decoration: the first draft of this helper listed
 * files only, and it went green against a bridge that no longer wrote `payload.json` but whose
 * caller still materialized an EMPTY `memory/queue/claimed/` on the way past. A files-only
 * listing would have reported the residue as "nothing to see" while the digest disagreed with it.
 */
function treeEntries(root: string): string[] {
  const found: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        found.push(`D:${relative(root, path)}`)
        walk(path)
        continue
      }
      found.push(
        `F:${relative(root, path)}:${createHash('sha256').update(readFileSync(path)).digest('hex')}`,
      )
    }
  }
  walk(root)
  return found.sort()
}

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

  function storeConfig(): BundleStoreConfig {
    return {
      knowledgeRoot,
      productKey: 'Apply Product',
      auditBaseDir: agentQaRoot,
      commitArtifacts: 'none',
    }
  }

  function publish(summary: string): string {
    const outcome = publishBundle(
      storeConfig(),
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

  function proposeReject(recordId: string, reason: string): string {
    const outcome = proposeReview({
      agentQaRoot,
      knowledgeRoot,
      request: { verb: 'reject', input: { target: { grain: 'record', recordId }, reason } },
    })
    if (outcome.kind !== 'proposed') throw new Error('expected a reject proposal')
    return outcome.proposal.proposalId
  }

  function proposeAccept(recordId: string): string {
    const outcome = proposeReview({
      agentQaRoot,
      knowledgeRoot,
      request: { verb: 'accept', input: { target: { grain: 'record', recordId } } },
    })
    if (outcome.kind !== 'proposed') throw new Error('expected an accept proposal')
    return outcome.proposal.proposalId
  }

  /**
   * How many bundle DIRECTORIES exist, measured off the filesystem rather than off the fold.
   *
   * Deliberately not `listBundles().length`: that walk skips a bundle whose canonical files do
   * not strictly parse, so a mint that lands half-written would be invisible to it. The minted
   * clone this matrix refuses is a whole new directory, and the cheapest total statement about
   * it is a directory count taken from `enumerateBundleDirs` — the same enumeration
   * `listBundles` composes, read one layer lower.
   */
  function bundleDirCount(): number {
    return enumerateBundleDirs(knowledgeRoot).length
  }

  /**
   * Drive a bundle to `superseded` through ORDINARY CURATION, never through a review verb.
   *
   * The append is the same one the curator's `Supersede` arm performs (curator/commit.ts:1459
   * emits `type: 'superseded'` into the outcome log); it is reproduced here rather than driving a
   * full drift-supersede because the matrix's input is the STATUS, and a status reached through a
   * forget would make "reject over a superseded target" a case about the forget path instead. The
   * `buildOrdinal` must exceed the fixture's `createdAtOrdinal` (10) or the fold keeps `candidate`.
   */
  function supersede(recordId: string): void {
    const appended = appendOutcomeEvent(
      storeConfig(),
      recordId as RecordId,
      BundleOutcomeEventSchema.parse({
        type: 'superseded',
        evidenceToken: `apply-review-superseded-${recordId}`,
        curationJobId: `apply-review-superseded-job-${recordId}`,
        buildOrdinal: 43,
        byRecordId: 'fact-replacement-0123456789abcdef',
      }),
    )
    if (appended.kind !== 'appended') throw new Error(`fixture supersede failed: ${appended.kind}`)
  }

  /** Rows claiming ONE record id — a second entry means a second directory claims that id. */
  function rowsFor(recordId: string) {
    return listBundles(knowledgeRoot).filter((row) => row.bundleId === recordId)
  }

  /**
   * The CR-02 integrity assertion, applied identically to every cell of the matrix.
   *
   * THE CANDIDATE SCAN IS STORE-WIDE, AND THAT IS THE WHOLE POINT OF THIS HELPER. The first draft
   * of it filtered every assertion to rows whose `bundleId` equals the target id, on the
   * verifier's wording ("no second directory claims the record id") — and that draft PASSED
   * against the unmodified defect. Dumping the minted bundle showed why: the unauthored record is
   * a verbatim CLONE of the target's own content (same anchors, same scope, same summary)
   * re-addressed under `originClass: user` at the next ordinal, so its content address DIFFERS
   * from the target's and it lands under the scope-derived product directory rather than the
   * target's. An id-scoped scan cannot see it. The row that matters is the one
   * `isEligibleCandidate` (serving/brief-selection.ts:142-151) would re-admit into serving, and it
   * carries whatever id the clone hashed to — so the assertion is over the STORE, not over an id.
   *
   * Four facts, each load-bearing: the store is row-for-row unchanged; no `candidate` row exists
   * anywhere (the serving re-admission channel); exactly one directory claims the target id (the
   * duplicate-id wedge); and the POSITIVE post-state holds — a guard that refused the whole apply
   * would satisfy all three negatives and still be wrong.
   */
  function expectNoUnauthoredMint(
    recordId: string,
    expectedStatus: string,
    before: ReturnType<typeof listBundles>,
  ): void {
    const all = listBundles(knowledgeRoot)
    expect(all, 'the store must be row-for-row unchanged: any new row is a record nobody authored')
      .toEqual(before)
    expect(
      all.filter((row) => row.status === 'candidate'),
      'a resurrected candidate row anywhere is re-admittable into serving by isEligibleCandidate',
    ).toHaveLength(0)
    const mine = all.filter((row) => row.bundleId === recordId)
    expect(new Set(mine.map((row) => row.dir)).size, 'exactly one directory may claim the id')
      .toBe(1)
    expect(mine[0]?.status, 'the target must still hold its tombstoned state').toBe(expectedStatus)
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

    // EVERY settled entry is inspected, and that is the change this case exists to make. It used
    // to filter `settled` to `fulfilled` before asserting, so a REJECTED loser was silently
    // dropped and `1 applied + 0 already-applied === 1 outcome` passed over an untyped throw. The
    // verifier's judgement is the right one: a concurrent case that exists and is blind is worse
    // than one that does not exist, because it reads as coverage.
    //
    // RED BASELINE, observed against unmodified apply-review.ts (bare `throw new Error(...)` at
    // :248) before the fix landed:
    //
    //   × records exactly one application even when two applies overlap
    //     → AssertionError: the loser must not receive an untyped no-such-proposal Error …
    //       expected true to be false
    //   and, in the same run, the loser's reason printed as:
    //       Error: No knowledge proposal is stored under id prop_…
    //
    // The LOSER PATH is path A — claim loss — and it is deterministic in this harness, not a
    // coin flip. `claimPendingProposal` is fully synchronous (`renameSync`) and `applyReview` runs
    // synchronously to its first `await` inside `commitAndPublish`, so in a
    // `Promise.allSettled([a, b])` the first call claims AND acquires the writer lease before the
    // second call begins. The OTHER loser path — winning the claim and then losing the LEASE,
    // which refuses with `ApplyDelegateUnavailableError` at apply-review.ts:265 — is therefore
    // unreachable here. That limit is stated rather than implied, exactly as the interleaving
    // limit above is: were the two calls in separate OS processes, the lease-loss shape would be
    // legitimate too and this assertion would have to admit it BY TYPE rather than relax.
    const committed = settled.filter(
      (entry) => entry.status === 'fulfilled' && entry.value.outcome === 'applied',
    ) as PromiseFulfilledResult<Awaited<ReturnType<typeof applyReview>>>[]
    expect(committed, 'exactly one call may commit').toHaveLength(1)
    const winner = committed[0]!.value

    for (const entry of settled) {
      if (entry.status === 'fulfilled' && entry.value === winner) continue
      if (entry.status === 'fulfilled') {
        // The loser that arrives after the publish is told what the WINNER did, verbatim.
        expect(entry.value.outcome).toBe('already-applied')
        expect(entry.value.forgetReceipt).toEqual(winner.forgetReceipt)
        continue
      }
      const reason = entry.reason as Error
      expect(
        reason.name === 'Error'
          && /No knowledge proposal is stored under id/.test(reason.message),
        'the loser must not receive an untyped no-such-proposal Error: the proposal exists, it '
          + 'is mid-apply, and telling the caller it names nothing is the exact confusion '
          + 'restorePendingProposal exists to prevent',
      ).toBe(false)
      expect(reason).toBeInstanceOf(ProposalApplyInFlightError)
      expect(reason.name).toBe('ProposalApplyInFlightError')
    }

    // POST-FIX NOTE, so the case is not read as asserting something it does not observe: with the
    // apply-in-flight arm in place the loser no longer REJECTS on this schedule at all — it waits
    // out the winner's commit and resolves `already-applied` with the winner's receipt. The
    // rejection branch above is therefore a live guard rather than the observed path, which is
    // why the directed in-flight case below parks a claim that nobody ever finishes: that is the
    // only way to make the refusal itself the observed outcome.

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
    // WR-02, added by 387-12: this case previously asserted nothing about the scrub list, so the
    // short-circuit's three unperformed scrub claims passed through it unread. Silence is not
    // pinning, but it is the reason the dishonesty survived — the assertion is now explicit.
    expect(second.forgetReceipt?.projectionsScrubbed).toEqual([])
    // …and the FIRST receipt did claim its three scrubs, because that apply really performed them.
    expect(firstReceipt?.projectionsScrubbed).toEqual([...FORGET_SCRUBBED_PROJECTIONS])
    // …and nothing was destroyed a second time: the record still exists with the same status.
    expect(listBundles(knowledgeRoot)).toEqual(afterFirst)
  })

  // ── CR-03: the claim window is VISIBLE, and every arm of it is answered by type ─────────────
  //
  // Four arms, four directed cases. The window these open is the one the race case above cannot
  // hold still: `claimPendingProposal` renames the pending name away and `publishAppliedProposal`
  // writes the applied name last, so between them neither name exists — and the duration of that
  // gap is the duration of a commit, not an instant. Parking a claim directly is how a test gets
  // to stand inside it.
  //
  // EVERY case overrides `inFlightWaitMs`. None of them may depend on the production bound: a
  // directed case that sat out `APPLY_IN_FLIGHT_WAIT_MS` under turbo contention would be a flake
  // dressed as coverage, and one that RELIED on the production value would fail the day it is
  // retuned for a real reason.

  it('refuses a claimed-but-unfinished apply by TYPE, not as a missing proposal (CR-03)', async () => {
    const recordId = publish('checkout button')
    const proposalId = proposeForget(recordId)

    // A winner, parked mid-commit: claimed, nothing published yet.
    expect(claimPendingProposal(agentQaRoot, proposalId).kind).toBe('consumed')

    const refusal = await applyReview({
      agentQaRoot,
      knowledgeRoot,
      proposalId,
      inFlightWaitMs: 40,
    }).catch((error: unknown) => error)

    expect(refusal).toBeInstanceOf(ProposalApplyInFlightError)
    expect((refusal as Error).name).toBe('ProposalApplyInFlightError')
    expect((refusal as ProposalApplyInFlightError).proposalId).toBe(proposalId)
    expect((refusal as ProposalApplyInFlightError).waitedMs).toBe(40)

    // WR-06: THE REFUSAL NAMES THE PARKED FILE. An orphaned claim is disclosed-by-design until
    // Phase 391's reaper exists (D-17, WR-03), and until then the only recovery is an operator
    // renaming the claim back by hand — which they cannot do if the refusal makes them derive the
    // naming scheme from the source. The expected filename is written out in full rather than
    // read off the error, because an assertion that compared the error to itself would pass over
    // any path at all. The test parked the claim in THIS process, so it knows the pid.
    const parked = join(proposalsDir(agentQaRoot), `${proposalId}.json.claimed.${process.pid}`)
    expect(existsSync(parked), 'the fixture must really have parked a claim to name').toBe(true)
    expect((refusal as ProposalApplyInFlightError).claimPath).toBe(parked)

    // IN-02, 387-17: THIS SUPERSEDES 387-16's `message).toContain(parked)`, deliberately and with
    // its contract preserved. 387-16 pinned the absolute path INTO the message because an
    // operator who cannot see the filename cannot rename it back. That reason is unchanged — but
    // this message is what crosses `knowledge.proposal.apply`'s function boundary uncaught, which
    // means it can land in a tool result a model provider reads, carrying the host's home
    // directory with it. So the two requirements are split rather than traded: the MESSAGE names
    // the claim relative to `agentQaRoot` (same filename, same recovery instruction), and the
    // absolute path stays on the `claimPath` FIELD above, byte-identical to what 387-16 pinned,
    // for the operator's own tooling. The not-contains arm is the half that reds a regression.
    const parkedRelative = relative(agentQaRoot, parked)
    expect(parkedRelative, 'the relative form must still name the file, not just a suffix')
      .toBe(join('proposals', `${proposalId}.json.claimed.${process.pid}`))
    expect((refusal as Error).message).toContain(parkedRelative)
    expect(
      (refusal as Error).message,
      'the host filesystem layout may not cross the function boundary inside an error message',
    ).not.toContain(agentQaRoot)

    // …and the refusal changed nothing: no commit, and the winner's claim is untouched, so the
    // winner can still finish. A waiter that "recovered" by restoring the claim would have stolen
    // the proposal out from under a live commit.
    expect(readAppliedProposal(agentQaRoot, proposalId)).toBeUndefined()
    expect(listBundles(knowledgeRoot).every((row) => row.status !== 'deprecated')).toBe(true)
    // The bound is pinned well above the poll interval, so the production wait is a wait and not
    // a single glance.
    expect(APPLY_IN_FLIGHT_WAIT_MS).toBeGreaterThan(1_000)
  })

  it('resolves already-applied when the winner PUBLISHES during the wait (CR-03)', async () => {
    const recordId = publish('checkout button')
    await projectIndex()
    const proposalId = proposeForget(recordId)

    const claimed = claimPendingProposal(agentQaRoot, proposalId)
    if (claimed.kind !== 'consumed') throw new Error('the fixture must win the claim')
    // The winner finishes mid-wait. Scheduled rather than awaited so the waiter is genuinely
    // inside its poll loop when the applied file appears.
    const previewed = claimed.proposal.receiptPreview?.tombstonedRecords
    if (previewed === undefined) throw new Error('a forget proposal must carry a preview')
    const winnersReceipt = {
      schemaVersion: 1 as const,
      proposalId,
      tombstonedRecords: previewed.map((row) => ({ ...row })),
      projectionsScrubbed: [...FORGET_SCRUBBED_PROJECTIONS],
      resultingBundleStatus: 'tombstoned' as const,
      forgottenAt: 99,
    }
    setTimeout(() => {
      publishAppliedProposal(agentQaRoot, {
        proposal: claimed.proposal,
        forgetReceipt: winnersReceipt,
      })
    }, 30)

    const waiter = await applyReview({
      agentQaRoot,
      knowledgeRoot,
      proposalId,
      inFlightWaitMs: 2_000,
    })

    expect(waiter.outcome).toBe('already-applied')
    // The WINNER'S receipt, verbatim — not one recomputed by the waiter over a store that has
    // since moved on.
    expect(waiter.forgetReceipt).toEqual(winnersReceipt)
    expect(waiter.forgetReceipt?.forgottenAt).toBe(99)
  })

  it('proceeds and commits when the winner RESTORES during the wait (CR-03)', async () => {
    const recordId = publish('checkout button')
    await projectIndex()
    const proposalId = proposeForget(recordId)

    expect(claimPendingProposal(agentQaRoot, proposalId).kind).toBe('consumed')
    // The winner REFUSED — a held lease, a gate hold — and put the proposal back. The waiter now
    // legitimately inherits the work: this is the first commit, not a second one.
    setTimeout(() => { restorePendingProposal(agentQaRoot, proposalId) }, 30)

    const waiter = await applyReview({
      agentQaRoot,
      knowledgeRoot,
      proposalId,
      inFlightWaitMs: 2_000,
      now: () => 777,
    })

    expect(waiter.outcome).toBe('applied')
    expect(waiter.forgetReceipt?.forgottenAt).toBe(777)
    expect(listBundles(knowledgeRoot).filter((row) => row.status === 'deprecated')).toHaveLength(1)
  })

  it('refuses an id this store never minted with the typed not-found (CR-03)', async () => {
    publish('checkout button')

    const refusal = await applyReview({
      agentQaRoot,
      knowledgeRoot,
      proposalId: 'prop_00000000-0000-4000-8000-000000000000',
      inFlightWaitMs: 40,
    }).catch((error: unknown) => error)

    // The store's OWN error, not a bare `Error` a caller would have to read a message to identify.
    expect(refusal).toBeInstanceOf(ProposalNotFoundError)
    expect((refusal as Error).name).toBe('ProposalNotFoundError')
    // …and it is NOT the in-flight refusal: an unknown id and a claimed id are different facts,
    // and a caller that retried an unknown id forever would be the cost of merging them.
    expect(refusal).not.toBeInstanceOf(ProposalApplyInFlightError)
  })

  // ── CR-02: the complete {reject, forget} × {deprecated, superseded} matrix ──────────────────
  //
  // The suite's input domain before this block contained exactly one cell — forget over a target
  // a forget had tombstoned — and the defect lived in every other cell. `propose-review.ts` emits
  // an IDENTICAL `Deprecate` delta for reject (:183-188) and forget (:190-195), so the hazard
  // belongs to the DELTA KIND; a guard scoped to one verb of the emitting set is the same
  // root-cause shape as a status table scoped to hand-picked members of a union (387-11 / CR-04).
  // The cases are therefore written over the whole set, not over the member that failed.
  //
  // RED BASELINE, observed against unmodified apply-review.ts (short-circuit still
  // `proposal.verb === 'forget' && …` at :297), transcribed from the failing run:
  //
  //   × a reject over an ALREADY-DEPRECATED target (prior reject) mints nothing
  //     → AssertionError: the store must be row-for-row unchanged … expected [ {…}, {…} ] to
  //       deeply equal [ {…} ]
  //   × a reject over an ALREADY-DEPRECATED target (prior FORGET) mints nothing
  //     → AssertionError: the store must be row-for-row unchanged … expected [ {…}, {…} ] to
  //       deeply equal [ {…} ]
  //   × a forget over an already-superseded target claims ZERO scrubs it did not perform
  //     → AssertionError: expected [ 'fts', 'vec', 'graph' ] to deeply equal []
  //   × (FUNC-04 adjacency, below) a forget over a forgotten target
  //     → AssertionError: expected [ 'fts', 'vec', 'graph' ] to deeply equal []
  //   × a THIRD addressed operation on a twice-applied record id still resolves
  //     → AssertionError: the store must be row-for-row unchanged … two rows in, two rows out,
  //       differing — the third reject reached commit() and mutated the clone
  //
  // ONE CELL WAS ALREADY GREEN PRE-FIX, and saying so is more useful than a matrix that reds
  // uniformly, because the green cell says where the hazard actually lives:
  //
  //   ✓ reject over an already-SUPERSEDED target — measured green before the fix. The Deprecate
  //     had real work to do (the target was not `deprecated`), so it committed an ordinary
  //     `deprecated` outcome event at the apply's build ordinal, which the fold ranks BELOW the
  //     supersede at ordinal 43 — status stays `superseded` and nothing is minted. The defect
  //     needs a target that is already `deprecated` specifically. The case is kept as a
  //     regression pin over the cell, not as a reproduction of it.
  //
  // The third-operation case reds, but NOT with the verifier's
  // `BundleTargetResolutionError: … is ambiguous`. That error needs the minted clone to collide
  // with the target's record id; in this fixture it does not, because the clone re-addresses
  // under `originClass: user` at the next ordinal and hashes differently (dumped:
  // `fact-el-button-checkout-ac9994…` beside the target's `…969cd289…`, under the scope-derived
  // product dir `apply-storefront/` rather than the fixture's `Apply-Product/`). The ambiguity
  // wedge is therefore reachable but fixture-dependent; what this suite observes instead is the
  // third reject reaching commit() and mutating the clone. Stated rather than implied.
  //
  // What DID reproduce in every red cell is the sharper fact: the unauthored record is a verbatim
  // CLONE of the fact the reviewer just rejected — same anchors, same scope, same summary —
  // published `status: candidate`, which `isEligibleCandidate` re-admits into serving.

  it('a reject over an ALREADY-DEPRECATED target (prior reject) mints nothing (CR-02)', async () => {
    const recordId = publish('checkout button')
    await projectIndex()

    const first = await applyReview({
      agentQaRoot,
      knowledgeRoot,
      proposalId: proposeReject(recordId, 'flaky selector'),
    })
    expect(first.outcome).toBe('applied')
    expect(rowsFor(recordId)[0]?.status).toBe('deprecated')
    const before = listBundles(knowledgeRoot)

    // The single most ordinary operator repetition in a review queue: reject the same record twice.
    const second = await applyReview({
      agentQaRoot,
      knowledgeRoot,
      proposalId: proposeReject(recordId, 'flaky selector, again'),
    })

    expect(second.outcome).toBe('applied')
    // reject carries no receipt on any path, short-circuit included.
    expect(second.forgetReceipt).toBeUndefined()
    expectNoUnauthoredMint(recordId, 'deprecated', before)
  })

  it('a reject over an ALREADY-DEPRECATED target (prior FORGET) mints nothing (CR-02)', async () => {
    const recordId = publish('checkout button')
    await projectIndex()

    // The second provenance path to the same status. Both verbs emit the same delta, so a guard
    // that keyed on how the target GOT tombstoned would pass one of these two and fail the other.
    await applyReview({ agentQaRoot, knowledgeRoot, proposalId: proposeForget(recordId) })
    expect(rowsFor(recordId)[0]?.status).toBe('deprecated')
    const before = listBundles(knowledgeRoot)

    const rejected = await applyReview({
      agentQaRoot,
      knowledgeRoot,
      proposalId: proposeReject(recordId, 'already forgotten'),
    })

    expect(rejected.outcome).toBe('applied')
    expectNoUnauthoredMint(recordId, 'deprecated', before)
  })

  it('a reject over an ALREADY-SUPERSEDED target mints nothing (CR-02)', async () => {
    const recordId = publish('checkout button')
    await projectIndex()

    // Superseded through ordinary curation, never through a review verb — the third tombstoned
    // provenance, and the one no review verb can produce.
    supersede(recordId)
    expect(rowsFor(recordId)[0]?.status).toBe('superseded')
    const before = listBundles(knowledgeRoot)

    const rejected = await applyReview({
      agentQaRoot,
      knowledgeRoot,
      proposalId: proposeReject(recordId, 'replaced upstream'),
    })

    expect(rejected.outcome).toBe('applied')
    // `superseded`, not `deprecated`: the short-circuit reports the state that IS, and does not
    // overwrite one tombstoned status with another it never committed.
    expectNoUnauthoredMint(recordId, 'superseded', before)
  })

  it('a forget over an already-superseded target claims ZERO scrubs it did not perform (WR-02)', async () => {
    const recordId = publish('checkout button')
    await projectIndex()
    supersede(recordId)
    const before = listBundles(knowledgeRoot)

    const forgotten = await applyReview({
      agentQaRoot,
      knowledgeRoot,
      proposalId: proposeForget(recordId),
      now: () => 4321,
    })

    const receipt = forgotten.forgetReceipt
    if (receipt === undefined) throw new Error('a forget must produce a receipt')
    // WR-02: the branch committed nothing and scrubbed nothing. `scrubSetSchema`
    // (schema/src/knowledge/proposal.ts:140-146) admits any unique SUBSET including the empty one,
    // so an honest empty list is expressible — and a receipt asserting work nobody did is exactly
    // what propose-review.ts:44-45 forbids.
    expect(receipt.projectionsScrubbed).toEqual([])
    // …while the rest of the receipt still reports the post-state honestly rather than going silent.
    expect(receipt.tombstonedRecords.map((row) => row.recordId)).toEqual([recordId])
    expect(receipt.tombstonedRecords[0]?.provenance.mode).toBe('run-linked')
    expect(receipt.resultingBundleStatus).toBe('tombstoned')
    expect(receipt.forgottenAt).toBe(4321)
    expectNoUnauthoredMint(recordId, 'superseded', before)
  })

  it('a THIRD addressed operation on a twice-applied record id still resolves (CR-02)', async () => {
    const recordId = publish('checkout button')
    await projectIndex()

    await applyReview({
      agentQaRoot,
      knowledgeRoot,
      proposalId: proposeReject(recordId, 'first'),
    })
    await applyReview({
      agentQaRoot,
      knowledgeRoot,
      proposalId: proposeReject(recordId, 'second'),
    })
    // Snapshotted AFTER both applies on purpose: this case asks whether the state two applies
    // leave behind can still be addressed, so its baseline is that state, whatever it is.
    const before = listBundles(knowledgeRoot)

    // The wedge the verifier observed: with two directories claiming one id, resolving the target
    // throws `BundleTargetResolutionError: … is ambiguous` — a retryable-looking error that can
    // never succeed, because the failing apply restores its own proposal to pending each time.
    // BOTH halves are asserted, because the throw can land on either: the propose resolves AND
    // the apply settles.
    const thirdId = proposeReject(recordId, 'third')
    const third = await applyReview({ agentQaRoot, knowledgeRoot, proposalId: thirdId })

    expect(third.outcome).toBe('applied')
    expectNoUnauthoredMint(recordId, 'deprecated', before)
  })

  it('CONTROL: a first reject over a LIVE candidate target still commits (CR-02)', async () => {
    const recordId = publish('checkout button')
    await projectIndex()
    // Drawn from OUTSIDE the rescoped guard's own assumption: the guard's precondition is
    // "already tombstoned", so a corpus made only of tombstoned targets would be satisfied by a
    // guard that swallowed EVERY Deprecate. This is the input it must admit.
    expect(rowsFor(recordId)[0]?.status).toBe('candidate')
    const before = listBundles(knowledgeRoot)

    const rejected = await applyReview({
      agentQaRoot,
      knowledgeRoot,
      proposalId: proposeReject(recordId, 'flaky selector'),
    })

    expect(rejected.outcome).toBe('applied')
    // The legitimate first destruction HAPPENED: the state changed, through commit(). This is the
    // positive half — `listBundles` unchanged in LENGTH but changed in CONTENT is precisely the
    // shape a swallow-everything guard could not produce.
    expect(rowsFor(recordId)[0]?.status).toBe('deprecated')
    expect(listBundles(knowledgeRoot).length).toBe(before.length)
    expect(listBundles(knowledgeRoot)).not.toEqual(before)
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

  // ── CR-02′: the matrix is driven from the VERB REGISTRY, not from a list of verbs ──────────
  //
  // The block above walks {reject, forget}. That set was hand-picked — it is the set of verbs
  // whose hazard had been NOTICED — and `accept` was simply absent, so `expectNoUnauthoredMint`
  // was never applied to the third verb and the identical mint reproduced through it. Round 1's
  // verifier measured the omission exactly: zero occurrences of `accept` in this file.
  //
  // The correction is mechanical rather than another case. The walk iterates
  // `KNOWLEDGE_REVIEW_VERBS` — the RUNTIME registry in `schema/src/knowledge/proposal.ts`, which
  // is the authority independent of anything this file writes down — and looks each verb's
  // expected behaviour up in a table declared `satisfies Record<KnowledgeReviewVerb, …>`. A
  // fourth verb added to the registry with no row here is a COMPILE ERROR, and a row here naming
  // no registry member is the same. So the corpus cannot fall behind the vocabulary the way it
  // just did; `proposalFor`'s switch is exhaustive over the same union for the same reason.
  //
  // RED BASELINE, observed against unmodified disposition.ts + apply-review.ts (before the
  // origin-discriminated refusal of Task 2), transcribed from the failing run:
  //
  //   × accept over a target already deprecated by a prior applied reject → refuses (CR-02′)
  //     → AssertionError: an accept over a tombstoned target must REFUSE by type, never report
  //       a confirmation it did not perform: expected 'resolved' to be 'rejected'
  //   × accept over a target already deprecated by a prior applied forget → refuses (CR-02′)
  //     → (byte-identical failure)
  //
  // …and with that first assertion replaced by a dump, in the same run, the defect's own
  // artifacts — printed for BOTH provenances, character for character identical:
  //
  //   PROBE accept reject resolved applied dirs 1 -> 2 rows
  //     [["memory/Apply-Product/bundles/fact-el-button-checkout-969cd289e646aae2","deprecated"],
  //      ["memory/apply-storefront/bundles/fact-el-button-checkout-ac9994c92f7366a8","candidate"]]
  //   PROBE accept forget resolved applied dirs 1 -> 2 rows  … (the same two rows)
  //   → AssertionError: the store must be row-for-row unchanged: any new row is a record nobody
  //     authored: expected [ { …(13) }, { …(13) } ] to deeply equal [ { …(13) } ]
  //
  // The second row is the mint: a verbatim CLONE of the fact the reviewer removed, re-addressed
  // under the scope-derived product directory (`apply-storefront/`, not the fixture's
  // `Apply-Product/`) at a different content address, `status: 'candidate'` — which
  // `isEligibleCandidate` re-admits into serving. Same clone id the round-0 CR-02 block names at
  // the top of this file; the same defect, arriving through the verb the matrix did not walk.
  //
  // BOTH provenances of `deprecated` are walked (a prior reject and a prior forget), because a
  // fix keyed on HOW the target got tombstoned would pass one and fail the other — the
  // full-input-set law this phase has now paid for twice.

  type TombstonedTargetExpectation = 'refuses' | 'short-circuits-applied'

  /**
   * What each review verb must do when the record it addresses is ALREADY `deprecated`.
   *
   * `accept` REFUSES and the other two do not, and the asymmetry is not a preference: reject and
   * forget over a tombstone are idempotent no-ops with an honest receipt — the state they ask for
   * already holds. An accept over a tombstone asks for the OPPOSITE of the state that holds, and
   * the store has no way to grant it; reporting `applied` there tells a human their decision was
   * reversed when it was not, and the path that produced the `applied` minted a clone of the very
   * fact the earlier decision removed.
   */
  const TOMBSTONED_TARGET_EXPECTATION_BY_VERB = {
    accept: 'refuses',
    reject: 'short-circuits-applied',
    forget: 'short-circuits-applied',
  } satisfies Record<KnowledgeReviewVerb, TombstonedTargetExpectation>

  /** The two ways a review verb can leave a record `deprecated`. Both are in the corpus. */
  const TOMBSTONING_PROVENANCES = ['reject', 'forget'] as const

  function proposalFor(verb: KnowledgeReviewVerb, recordId: string): string {
    switch (verb) {
      case 'accept':
        return proposeAccept(recordId)
      case 'reject':
        return proposeReject(recordId, `matrix reject of ${recordId}`)
      case 'forget':
        return proposeForget(recordId)
    }
  }

  async function settle(proposalId: string) {
    return await applyReview({ agentQaRoot, knowledgeRoot, proposalId }).then(
      (value) => ({ kind: 'resolved' as const, value }),
      (error: unknown) => ({ kind: 'rejected' as const, error }),
    )
  }

  for (const verb of KNOWLEDGE_REVIEW_VERBS) {
    const expectation = TOMBSTONED_TARGET_EXPECTATION_BY_VERB[verb]
    for (const provenance of TOMBSTONING_PROVENANCES) {
      it(
        `${verb} over a target already deprecated by a prior applied ${provenance} `
          + `→ ${expectation} (CR-02′)`,
        async () => {
          const recordId = publish('checkout button')
          await projectIndex()

          const tombstoning = provenance === 'reject'
            ? proposeReject(recordId, 'the first decision')
            : proposeForget(recordId)
          const first = await applyReview({ agentQaRoot, knowledgeRoot, proposalId: tombstoning })
          expect(first.outcome, 'the tombstoning apply is fixture, not subject').toBe('applied')
          expect(rowsFor(recordId)[0]?.status).toBe('deprecated')

          const before = listBundles(knowledgeRoot)
          const dirsBefore = bundleDirCount()

          const proposalId = proposalFor(verb, recordId)
          const settled = await settle(proposalId)

          if (expectation === 'refuses') {
            expect(
              settled.kind,
              'an accept over a tombstoned target must REFUSE by type, never report a '
                + 'confirmation it did not perform',
            ).toBe('rejected')
            const error = settled.kind === 'rejected' ? settled.error as Error : undefined
            expect(error).toBeInstanceOf(UserDeltaCitationIntegrityError)
            expect(error?.name).toBe('UserDeltaCitationIntegrityError')
            expect((error as UserDeltaCitationIntegrityError | undefined)?.recordId).toBe(recordId)
            // NOTHING was published as applied: the caller is never told `applied` for a
            // confirmation that confirmed nothing.
            expect(readAppliedProposal(agentQaRoot, proposalId)).toBeUndefined()
            // …and the proposal is back under its PENDING name, so a retry finds it applicable
            // rather than vanished. A refusal that consumed the proposal would be the
            // half-consumed data loss `restorePendingProposal` exists to prevent.
            expect(readPendingProposal(agentQaRoot, proposalId)?.proposalId).toBe(proposalId)
          } else {
            expect(settled.kind).toBe('resolved')
            expect(settled.kind === 'resolved' ? settled.value.outcome : undefined).toBe('applied')
          }

          // Identical on BOTH arms, and that is the point: whichever answer the verb gives, no
          // record nobody authored may exist afterwards.
          expectNoUnauthoredMint(recordId, 'deprecated', before)
          expect(bundleDirCount(), 'a new bundle directory is a minted record').toBe(dirsBefore)
        },
      )
    }
  }

  it('ADMIT: accept over a SUPERSEDED target still commits an ordinary Confirm (CR-02′)', async () => {
    const recordId = publish('checkout button')
    await projectIndex()
    // Superseded through ordinary curation, never through a review verb — a tombstoned-looking
    // status the refusal must NOT swallow. Without this the refusal is satisfiable by "refuse
    // every accept over anything that is not `candidate`".
    supersede(recordId)
    expect(rowsFor(recordId)[0]?.status).toBe('superseded')
    const confirmedBefore = rowsFor(recordId)[0]?.counters.confirmed
    const dirsBefore = bundleDirCount()

    const accepted = await applyReview({
      agentQaRoot,
      knowledgeRoot,
      proposalId: proposeAccept(recordId),
    })

    expect(accepted.outcome).toBe('applied')
    expect(accepted.forgetReceipt).toBeUndefined()
    // The POSITIVE half: the Confirm really reached commit() and the fold saw it. A guard that
    // swallowed the apply would satisfy every negative below and still be wrong.
    expect(confirmedBefore).toBe(0)
    expect(rowsFor(recordId)[0]?.counters.confirmed).toBe(1)
    expect(rowsFor(recordId)[0]?.status, 'a Confirm does not un-supersede').toBe('superseded')
    expect(bundleDirCount(), 'an ordinary Confirm mints nothing').toBe(dirsBefore)
    expect(listBundles(knowledgeRoot).filter((row) => row.status === 'candidate')).toHaveLength(0)

    // STATED LIMIT, on the 387-12 finding-3 precedent: this cell was GREEN before the fix. It is
    // a REGRESSION PIN over the admit half, not a reproduction of anything — `superseded` never
    // reached `checkCitedIdIntegrity`'s deprecated arm, which is exactly why the defect needed a
    // target that is `deprecated` specifically. Its job is to red if the refusal is ever widened
    // from "the cited-id-integrity check failed" to "the target looks tombstoned".
  })

  it('ADMIT: accept over a LIVE candidate commits normally (CR-02′, SOUND-10 extended)', async () => {
    const recordId = publish('checkout button')
    await projectIndex()
    expect(rowsFor(recordId)[0]?.status).toBe('candidate')
    const dirsBefore = bundleDirCount()

    const accepted = await applyReview({
      agentQaRoot,
      knowledgeRoot,
      proposalId: proposeAccept(recordId),
    })

    expect(accepted.outcome).toBe('applied')
    expect(rowsFor(recordId)[0]?.counters.confirmed).toBe(1)
    expect(bundleDirCount()).toBe(dirsBefore)
    expect(new Set(rowsFor(recordId).map((row) => row.dir)).size).toBe(1)
  })

  // ── CR-02″: the refusal's neutrality is measured over the WHOLE knowledge root ──────────────
  //
  // The two cases below exist because round 2's gates could not see the leak they were written
  // to catch. `expectNoUnauthoredMint` reads `listBundles`, and `bundleDirCount` reads
  // `enumerateBundleDirs`; both observe the BUNDLE tree, and round 1's refusal moved the residue
  // one directory over — into `memory/queue/claimed/`, where the knowledge-port bridge had
  // already materialized a curation candidate seeded from the tombstoned record's own
  // `summarySeed` / `anchors` / `bodySeed` / `kind` before disposition ever ran. Nothing unwound
  // it on the throw, `reconcileOnDrainStart` requeued it under the next lease, and the curator
  // re-authored the removed fact one drain later with `origin: 'agent'`.
  //
  // So the invariant here is the WHOLE root, not a shape of harm somebody enumerated. The bundle
  // gates stay — they name the specific harm and print a legible diff — but the digest is what
  // makes the next narrowing a test failure rather than an argument.
  //
  // RED BASELINE, observed against unmodified knowledge-store.ts (bridgeDelta still writing),
  // transcribed from the failing run:
  //
  //   × a refused accept leaves the WHOLE knowledge root byte-identical (CR-02″)
  //     → AssertionError: a refused apply may not leave a file ANYWHERE under the knowledge root
  //       — the queue tree is inside the invariant, not outside it:
  //       expected [ '.epoch', '.gitignore', …(10) ] to deeply equal [ '.epoch', … …(9) ]
  //       - Expected  + Received
  //       + "memory/queue/claimed/867e619b-7876-444a-8d26-eb89789674e8/
  //          07491443aeead09c87ccc3fe31b96da13ec8728c516528e6f002055c1e4f030e/payload.json"
  //   × the next drain adopts NOTHING from a refused accept (CR-02″ requeue half)
  //     → AssertionError: a refusal must leave the next drain nothing to adopt: expected 1 to be 0
  //
  // (the leaked payload.json is the candidate the requeue then adopts — one leak, two cases. The
  // lease uuid and the candidate content address vary per run.)
  //
  // WHY THE FIRST CASE HOLDS THE LEASE ITSELF. With the leak fixed, the digest STILL moved, and
  // the second measurement named the reason: `.epoch` and `.writer-authority.sqlite`, and nothing
  // else. `acquireWriterLease` advances the fencing epoch on every acquisition, so an apply that
  // takes its own lease moves those two bytes whether it commits, refuses, or does nothing at
  // all. Leaving them inside the window would force the invariant to become "equal except for
  // this list", and a hand-written exclusion list is the exact shape this phase keeps paying for.
  // The lease is therefore acquired by the FIXTURE and handed in through `writerAuthority` (the
  // holder branch — same `commitAndPublish`, same store, same bridge), which takes the lease
  // lifecycle out of the measured window instead of carving it out of the assertion. The
  // acquire-and-release CONTROL below proves the exclusion is really the lease's own doing rather
  // than an assumption: a bare lease round-trip, committing nothing, must move the digest and
  // must move NOTHING under `memory/`. The ordinary acquiring path is covered end-to-end by the
  // adoption case that follows, which asserts over the queue tree directly.

  /** Entries under `memory/` — the curation state, as opposed to root-level lease bookkeeping. */
  function curationEntries(entries: string[]): string[] {
    return entries.filter((entry) => entry.slice(2).startsWith('memory/'))
  }

  it('a refused accept leaves the WHOLE knowledge root byte-identical (CR-02″)', async () => {
    const recordId = publish('checkout button')
    await projectIndex()
    const tombstoning = await applyReview({
      agentQaRoot,
      knowledgeRoot,
      proposalId: proposeReject(recordId, 'the first decision'),
    })
    expect(tombstoning.outcome, 'the tombstoning apply is fixture, not subject').toBe('applied')

    // CONTROL — what the lease lifecycle alone costs, MEASURED rather than assumed. A bare
    // acquire-and-release commits nothing; if it moved no bytes there would be no reason to hold
    // the lease across the window below, and if it moved curation state the window would be
    // hiding something.
    const beforeBareLease = treeEntries(knowledgeRoot)
    const bare = acquireWriterLease(knowledgeRoot)
    if (bare.kind !== 'acquired') throw new Error('fixture could not take the lease')
    releaseLease({ knowledgeRoot, leaseId: bare.leaseId })
    const afterBareLease = treeEntries(knowledgeRoot)
    expect(
      afterBareLease,
      'taking and dropping the lease must move SOMETHING, or holding it across the window '
        + 'below would be pointless ceremony',
    ).not.toEqual(beforeBareLease)
    expect(
      curationEntries(afterBareLease),
      'and it must move nothing under memory/ — the exclusion is lease bookkeeping, not a '
        + 'carve-out that could be hiding curation state',
    ).toEqual(curationEntries(beforeBareLease))

    const lease = acquireWriterLease(knowledgeRoot)
    if (lease.kind !== 'acquired') throw new Error('fixture could not take the lease')
    try {
      const proposalId = proposeAccept(recordId)
      const entriesBefore = treeEntries(knowledgeRoot)
      const treeBefore = hashTree(knowledgeRoot)

      const refusal = await applyReview({
        agentQaRoot,
        knowledgeRoot,
        proposalId,
        writerAuthority: { leaseId: lease.leaseId, epoch: lease.epoch },
      }).catch((error: unknown) => error)
      expect(refusal).toBeInstanceOf(UserDeltaCitationIntegrityError)

      expect(
        treeEntries(knowledgeRoot),
        'a refused apply may not leave a file OR a directory anywhere under the knowledge root '
          + '— the queue tree is inside the invariant, not outside it',
      ).toEqual(entriesBefore)
      expect(
        hashTree(knowledgeRoot),
        'the refusal must be byte-identical over the whole root: paths, sizes and contents',
      ).toBe(treeBefore)
      // The specific shape the leak took, named so a regression reads as itself rather than as a
      // digest mismatch. A consequence of the invariant above, never a substitute for it.
      expect(
        existsSync(claimedRoot(knowledgeRoot)),
        'the write-free bridge materializes no claimed candidate, so the tree never appears',
      ).toBe(false)

      // POTENCY, measured over THIS root and THIS digest rather than asserted about hashing in
      // general: without it a digest taken over the wrong directory would report success forever.
      // One byte, deliberately written, must move it.
      writeFileSync(join(knowledgeRoot, 'potency-probe.txt'), 'x', 'utf8')
      expect(
        hashTree(knowledgeRoot),
        'the invariant must be FALSIFIABLE over this exact root, or it measures nothing',
      ).not.toBe(treeBefore)
    } finally {
      releaseLease({ knowledgeRoot, leaseId: lease.leaseId })
    }
  })

  it('the next drain adopts NOTHING from a refused accept (CR-02″ requeue half)', async () => {
    const recordId = publish('checkout button')
    await projectIndex()
    const tombstoning = await applyReview({
      agentQaRoot,
      knowledgeRoot,
      proposalId: proposeReject(recordId, 'the first decision'),
    })
    expect(tombstoning.outcome).toBe('applied')

    const refusal = await applyReview({
      agentQaRoot,
      knowledgeRoot,
      proposalId: proposeAccept(recordId),
    }).catch((error: unknown) => error)
    expect(refusal).toBeInstanceOf(UserDeltaCitationIntegrityError)

    // A DIFFERENT lease, which is the whole point: `reconcileOnDrainStart` skips its own
    // authority's claims and recovers everybody else's, so the next drain is exactly a caller
    // holding a lease the refusing apply did not hold.
    const lease = acquireWriterLease(knowledgeRoot)
    if (lease.kind !== 'acquired') throw new Error('fixture could not take the lease')
    const replayed: string[] = []
    try {
      const report = reconcileOnDrainStart({
        knowledgeRoot,
        writerAuthority: { leaseId: lease.leaseId, epoch: lease.epoch },
        hasIndexRow: () => true,
        applyIndexDelta: (intent) => { replayed.push(intent.bundleId) },
        deriveIndexRowFromBundle: (bundleId) => { replayed.push(bundleId) },
      })
      expect(
        report.jobsRequeued,
        'a refusal must leave the next drain nothing to adopt: a requeued candidate is the '
          + 'removed fact re-entering under `origin: agent` one drain later',
      ).toBe(0)
    } finally {
      releaseLease({ knowledgeRoot, leaseId: lease.leaseId })
    }

    expect(listQueuedCandidates(knowledgeRoot), 'nothing was seeded into the pending queue')
      .toEqual([])
    expect(replayed, 'and no index work was inherited from a commit that never happened')
      .toEqual([])
    // …and the record the reviewer removed is still removed, which is the positive half: a
    // reconcile that recovered nothing because the STORE was empty would satisfy every negative.
    expect(rowsFor(recordId)[0]?.status).toBe('deprecated')
  })

  it('refuses an input claiming BOTH writerAuthority and delegate (WR-04)', async () => {
    const recordId = publish('checkout button')
    const proposalId = proposeForget(recordId)

    let delegateCalls = 0
    await expect(applyReview({
      agentQaRoot,
      knowledgeRoot,
      proposalId,
      writerAuthority: { leaseId: 'lease-that-does-not-exist', epoch: 1 },
      delegate: async () => {
        delegateCalls += 1
        throw new Error('the delegate must never be reached')
      },
    })).rejects.toBeInstanceOf(TypeError)

    // The refusal is STRUCTURAL and happens before anything is touched: the delegate was never
    // called, and — the half that matters — the proposal was never claimed, so a caller that
    // fixes its input finds the proposal exactly as applicable as before.
    expect(delegateCalls).toBe(0)
    expect(readPendingProposal(agentQaRoot, proposalId)?.proposalId).toBe(proposalId)
    expect(readAppliedProposal(agentQaRoot, proposalId)).toBeUndefined()

    // EACH FIELD ALONE still works, and neither half is duplicated here: `delegate` alone is
    // covered by 'delegates instead of stealing when a live holder exists, and waits BOUNDED'
    // above, and `writerAuthority` alone by the daemon-authority suite in
    // knowledge-proposal-apply's tests (387-10). What this case adds is only the conjunction.
  })
})
