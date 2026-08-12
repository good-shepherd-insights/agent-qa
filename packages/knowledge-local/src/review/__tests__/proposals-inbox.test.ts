// The proposals INBOX over 387's store substrate (Phase 391, PROP-03 / D-08 · D-10 · D-12).
//
// 387 wrote the substrate and deliberately left enumeration owner-less: "391 is the owner; this
// module is the substrate." This file is the corpus for what 391 adds — the `.rejected.json`
// sibling of the `.applied.json` idiom, enumeration over EVERY durable name shape the directory
// can hold, expiry computed at read, and the WR-03 orphaned-claim reap.
//
// EVERY FIXTURE IS PRODUCED, NEVER WRITTEN. Not one proposal, claim marker or applied record in
// this file is hand-assembled JSON: `proposeReview` mints, `claimPendingProposal` claims,
// `publishAppliedProposal` publishes and `rejectPendingProposal` rejects. A corpus assembled as
// literals can pin an input the producers cannot make, and a classification suite is exactly
// where that bites — the five name shapes below are five real shapes because five real functions
// made them.
//
// THE ONE CONTROL THAT IS NOT PRODUCED is process liveness, and it is separated out rather than
// smuggled in. A live process cannot produce a dead pid's claim marker, so `isProcessAlive` is an
// injected predicate for the reap cases and the SHIPPED predicate is pinned separately against a
// genuinely dead pid obtained from a child process that has exited. Injecting the predicate and
// never measuring the real one would have left the reap's only real dependency untested.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { PROPOSAL_EXPIRY_MS } from '@vostride/agent-qa-schema'
import type { Anchor, BundleDraft, KnowledgeProposalV1 } from '@vostride/agent-qa-schema'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { publishBundle, type BundleStoreConfig } from '../../bundle-publish.test-helper.js'
import {
  makeBundleDraftFixture,
  makeScreenStateFixture,
  scaffoldKnowledgeRoot,
} from '../../__tests__/fixtures/bundle-fixture.js'
import { proposeReview } from '../propose-review.js'
import {
  claimPendingProposal,
  extractStoredProposal,
  isProcessAlive,
  listProposalEnvelopes,
  proposalsDir,
  publishAppliedProposal,
  readPendingProposal,
  rejectPendingProposal,
  showProposalEnvelope,
  writePendingProposal,
} from '../proposals-store.js'

const ANCHOR: Anchor = { t: 'el', role: 'Button', name: 'Checkout' }

/** A pid that is genuinely dead: a child process this suite ran to completion. */
function deadPid(): number {
  const child = spawnSync(process.execPath, ['-e', ''], { stdio: 'ignore' })
  if (child.pid === undefined) throw new Error('could not obtain a dead pid')
  return child.pid
}

const ALIVE = (): boolean => true
const DEAD = (): boolean => false

describe('the proposals inbox (PROP-03, D-10/D-12)', () => {
  let root: string
  let knowledgeRoot: string
  let agentQaRoot: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'proposals-inbox-'))
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
    const outcome = publishBundle(storeConfig('Inbox Product'), {
      draft: makeBundleDraftFixture({
        kind: 'fact',
        anchors: [ANCHOR],
        scope: { tier: 'product', key: 'inbox-storefront' },
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
        runId: `inbox-${summary}`,
        testId: 'inbox-test',
        stepIndex: 0,
      },
      artifacts: [],
    })
    if (outcome.kind !== 'published') throw new Error(`fixture publish failed: ${outcome.kind}`)
    return outcome.id
  }

  /** Mint one real proposal through the real propose path. */
  function mint(
    summary: string,
    options: { at?: number; emittedBy?: string; runId?: string } = {},
  ): KnowledgeProposalV1 {
    const recordId = publish(summary)
    const outcome = proposeReview({
      agentQaRoot,
      knowledgeRoot,
      request: { verb: 'accept', input: { target: { grain: 'record', recordId } } },
      ...(options.at === undefined ? {} : { now: () => options.at! }),
      ...(options.emittedBy === undefined
        ? {}
        : {
            origin: {
              emittedBy: options.emittedBy,
              ...(options.runId === undefined ? {} : { runId: options.runId }),
            },
          }),
    })
    if (outcome.kind !== 'proposed') throw new Error(`fixture propose failed: ${outcome.kind}`)
    return outcome.proposal
  }

  function names(): string[] {
    return readdirSync(proposalsDir(agentQaRoot)).sort()
  }

  describe('rejection — the .rejected.json sibling of the .applied idiom', () => {
    it('renames a pending proposal into its .rejected.json sibling and leaves no pending name', () => {
      const proposal = mint('reject-me')
      const id = proposal.proposalId
      expect(existsSync(join(proposalsDir(agentQaRoot), `${id}.json`))).toBe(true)

      const outcome = rejectPendingProposal(agentQaRoot, id, { at: 1_000, reason: 'not now' })

      expect(outcome.kind).toBe('rejected')
      if (outcome.kind !== 'rejected') throw new Error('unreachable')
      // A KNOWLEDGE rejection still lands in the 391 wrapper, byte for byte (394-18). The narrow
      // is the assertion: the kind-generic decision path writes `record` instead of `proposal`,
      // so a knowledge rejection that started using it would fail HERE rather than silently
      // changing the shape of files this store retains forever.
      if (!('proposal' in outcome.record)) throw new Error('expected the 391 rejection wrapper')
      expect(outcome.record.proposal.proposalId).toBe(id)
      expect(outcome.record.decision).toEqual({ decision: 'rejected', at: 1_000, reason: 'not now' })

      // The durable name landed and the pending name is gone — one rename, one decision file.
      expect(existsSync(join(proposalsDir(agentQaRoot), `${id}.rejected.json`))).toBe(true)
      expect(existsSync(join(proposalsDir(agentQaRoot), `${id}.json`))).toBe(false)
      expect(readPendingProposal(agentQaRoot, id)).toBeUndefined()
      // …and the proposal itself survives inside the wrapper: rejection is retention, not deletion.
      const onDisk = JSON.parse(
        readFileSync(join(proposalsDir(agentQaRoot), `${id}.rejected.json`), 'utf8'),
      ) as { proposal: KnowledgeProposalV1 }
      expect(onDisk.proposal).toEqual(proposal)
    })

    it('reports already-applied for a proposal somebody already applied, writing no second file', () => {
      const proposal = mint('applied-then-rejected')
      const id = proposal.proposalId
      expect(claimPendingProposal(agentQaRoot, id).kind).toBe('consumed')
      publishAppliedProposal(agentQaRoot, { proposal })
      const before = names()

      const outcome = rejectPendingProposal(agentQaRoot, id, { at: 2_000 })

      expect(outcome.kind).toBe('already-applied')
      if (outcome.kind !== 'already-applied') throw new Error('unreachable')
      if (!('proposal' in outcome.record)) throw new Error('expected the 387 applied wrapper')
      expect(outcome.record.proposal.proposalId).toBe(id)
      expect(existsSync(join(proposalsDir(agentQaRoot), `${id}.rejected.json`))).toBe(false)
      expect(names()).toEqual(before)
    })

    it('reports already-rejected on a second reject, keeping the FIRST decision', () => {
      const proposal = mint('rejected-twice')
      const id = proposal.proposalId
      expect(rejectPendingProposal(agentQaRoot, id, { at: 10, reason: 'first' }).kind)
        .toBe('rejected')

      const second = rejectPendingProposal(agentQaRoot, id, { at: 20, reason: 'second' })

      expect(second.kind).toBe('already-rejected')
      if (second.kind !== 'already-rejected') throw new Error('unreachable')
      // The winner's decision is what the loser is told about — never its own.
      expect(second.record.decision).toEqual({ decision: 'rejected', at: 10, reason: 'first' })
    })

    it('reports not-found for an id this store never minted', () => {
      expect(
        rejectPendingProposal(agentQaRoot, 'prop_00000000-0000-4000-8000-000000000000', { at: 1 })
          .kind,
      ).toBe('not-found')
    })

    it('reports apply-in-flight while somebody holds the claim, and writes nothing', () => {
      const proposal = mint('claimed-then-rejected')
      const id = proposal.proposalId
      expect(claimPendingProposal(agentQaRoot, id).kind).toBe('consumed')
      const before = names()

      const outcome = rejectPendingProposal(agentQaRoot, id, { at: 3_000 })

      expect(outcome.kind).toBe('apply-in-flight')
      expect(names()).toEqual(before)
    })

    it('refuses a traversal id BEFORE any join (the id-as-path law)', () => {
      const escaped = join(root, 'escaped.json')
      writeFileSync(escaped, '{}', 'utf8')
      expect(() =>
        rejectPendingProposal(agentQaRoot, '../../escaped' as string, { at: 1 }),
      ).toThrow()
      // The refused id left no probe behind: the file it named is untouched and unmoved.
      expect(readFileSync(escaped, 'utf8')).toBe('{}')
    })

    it('tells an apply that the proposal was REJECTED rather than that it never existed', () => {
      const proposal = mint('rejected-then-applied')
      const id = proposal.proposalId
      expect(rejectPendingProposal(agentQaRoot, id, { at: 5 }).kind).toBe('rejected')

      const outcome = claimPendingProposal(agentQaRoot, id)

      expect(outcome.kind).toBe('already-rejected')
    })
  })

  describe('enumeration over every durable name shape', () => {
    it('classifies all five durable name shapes, each produced by the function that makes it', () => {
      const pending = mint('shape-pending', { at: 1_000 })
      const claimed = mint('shape-claimed', { at: 2_000 })
      const applied = mint('shape-applied', { at: 3_000 })
      const rejected = mint('shape-rejected', { at: 4_000 })

      // shape 2: a LIVE claim marker — `<id>.json.claimed.<pid>` — this process holds it.
      expect(claimPendingProposal(agentQaRoot, claimed.proposalId).kind).toBe('consumed')
      // shapes 3 + 5: the applied record and the RETIRED claim marker it leaves behind.
      expect(claimPendingProposal(agentQaRoot, applied.proposalId).kind).toBe('consumed')
      publishAppliedProposal(agentQaRoot, { proposal: applied })
      // shape 4: the rejected record.
      expect(rejectPendingProposal(agentQaRoot, rejected.proposalId, { at: 4_500 }).kind)
        .toBe('rejected')

      // The five shapes really are on disk, spelled as the store spells them. The reject path
      // retires its OWN claim marker in the same publish order the apply path uses — durable
      // name first — which is why there are two retired markers and not one.
      expect(names()).toEqual([
        `${applied.proposalId}.applied.json`,
        `${applied.proposalId}.applied.json.claim`,
        `${claimed.proposalId}.json.claimed.${process.pid}`,
        `${pending.proposalId}.json`,
        `${rejected.proposalId}.rejected.json`,
        `${rejected.proposalId}.rejected.json.claim`,
      ].sort())

      const entries = listProposalEnvelopes(agentQaRoot, { now: 5_000, isProcessAlive: ALIVE })

      expect(entries.map((entry) => [entry.envelope.id, entry.envelope.status])).toEqual([
        [pending.proposalId, 'pending'],
        [claimed.proposalId, 'pending'],
        [applied.proposalId, 'applied'],
        [rejected.proposalId, 'rejected'],
      ])
      // The retired marker is not a fifth ENTRY: its durable name is already listed.
      expect(entries).toHaveLength(4)
      expect(entries.map((entry) => entry.applyInFlight)).toEqual([false, true, false, false])
      expect(entries.every((entry) => entry.envelope.kind === 'knowledge')).toBe(true)
    })

    it('yields an empty listing as a RESULT for a store that has never written a proposal', () => {
      expect(existsSync(proposalsDir(agentQaRoot))).toBe(false)
      expect(listProposalEnvelopes(agentQaRoot, { now: 1 })).toEqual([])
    })

    it('orders deterministically by proposed-at then id, stably across repeated calls', () => {
      // Two proposals share an instant, so the id tie-break is exercised rather than assumed.
      const late = mint('order-late', { at: 9_000 })
      const tieA = mint('order-tie-a', { at: 1_000 })
      const tieB = mint('order-tie-b', { at: 1_000 })

      const expected = [
        ...[tieA.proposalId, tieB.proposalId].sort(),
        late.proposalId,
      ]
      for (let call = 0; call < 3; call += 1) {
        expect(listProposalEnvelopes(agentQaRoot, { now: 9_500 }).map((e) => e.envelope.id))
          .toEqual(expected)
      }
    })

    it('carries the payload and the evidence ref a human decides on, BEFORE any decision', () => {
      const proposal = mint('show-me', { emittedBy: 'knowledge.accept.propose', runId: 'run-7' })

      const entry = showProposalEnvelope(agentQaRoot, proposal.proposalId, { now: 1 })

      expect(entry?.envelope.payload).toEqual(proposal)
      expect(entry?.envelope.status).toBe('pending')
      expect(entry?.envelope.decision).toBeUndefined()
      expect(entry?.envelope.origin).toEqual({
        emittedBy: 'knowledge.accept.propose',
        runId: 'run-7',
        at: proposal.proposedAt,
      })
      expect(entry?.envelope.evidenceRefs).toContainEqual({
        grain: 'record',
        ref: (proposal.targetRef as { grain: 'record'; recordId: string }).recordId,
      })
      expect(entry?.envelope.evidenceRefs).toContainEqual({ grain: 'run', ref: 'run-7' })
    })

    it('answers undefined for an id no name shape in the directory carries', () => {
      mint('present')
      expect(
        showProposalEnvelope(agentQaRoot, 'prop_00000000-0000-4000-8000-000000000000', { now: 1 }),
      ).toBeUndefined()
    })

    it('surfaces the decision trail on a rejected envelope', () => {
      const proposal = mint('trail')
      rejectPendingProposal(agentQaRoot, proposal.proposalId, { at: 77, reason: 'stale evidence' })

      const entry = showProposalEnvelope(agentQaRoot, proposal.proposalId, { now: 100 })

      expect(entry?.envelope.status).toBe('rejected')
      expect(entry?.envelope.decision).toEqual({
        decision: 'rejected',
        at: 77,
        reason: 'stale evidence',
      })
    })
  })

  describe('expiry is computed at read — no reaper, no deletion', () => {
    it('reports a pending proposal older than the window as expired with its file intact', () => {
      const stale = mint('stale', { at: 1_000 })
      const fresh = mint('fresh', { at: 1_000 + PROPOSAL_EXPIRY_MS })
      const now = 1_000 + PROPOSAL_EXPIRY_MS + 1
      const before = names()

      const entries = listProposalEnvelopes(agentQaRoot, { now })

      expect(entries.map((entry) => [entry.envelope.id, entry.envelope.status])).toEqual([
        [stale.proposalId, 'expired'],
        [fresh.proposalId, 'pending'],
      ])
      // NOTHING WAS REAPED. The bytes are exactly where they were.
      expect(names()).toEqual(before)
      expect(readPendingProposal(agentQaRoot, stale.proposalId)).toEqual(stale)
    })

    it('keeps a DECIDED proposal decided forever — a decision outlives the window', () => {
      const proposal = mint('decided-long-ago', { at: 1_000 })
      rejectPendingProposal(agentQaRoot, proposal.proposalId, { at: 1_100 })

      const entries = listProposalEnvelopes(agentQaRoot, {
        now: 1_000 + PROPOSAL_EXPIRY_MS * 10,
      })

      expect(entries[0]?.envelope.status).toBe('rejected')
    })
  })

  describe('the WR-03 orphaned-claim reap', () => {
    it('restores a claim whose holder is dead back to pending, at enumeration', () => {
      const proposal = mint('orphaned', { at: 1_000 })
      const id = proposal.proposalId
      expect(claimPendingProposal(agentQaRoot, id).kind).toBe('consumed')
      expect(existsSync(join(proposalsDir(agentQaRoot), `${id}.json`))).toBe(false)

      const entries = listProposalEnvelopes(agentQaRoot, { now: 2_000, isProcessAlive: DEAD })

      expect(entries.map((entry) => [entry.envelope.id, entry.envelope.status]))
        .toEqual([[id, 'pending']])
      expect(entries[0]?.applyInFlight).toBe(false)
      // The RESTORE is durable, not a read-time story: the pending name is back on disk and the
      // claim marker is gone, so a fresh apply can take it.
      expect(existsSync(join(proposalsDir(agentQaRoot), `${id}.json`))).toBe(true)
      expect(names().filter((name) => name.includes('.claimed.'))).toEqual([])
      expect(claimPendingProposal(agentQaRoot, id).kind).toBe('consumed')
    })

    it('leaves a LIVE claim alone and reports it as apply-in-flight', () => {
      const proposal = mint('held', { at: 1_000 })
      const id = proposal.proposalId
      expect(claimPendingProposal(agentQaRoot, id).kind).toBe('consumed')
      const before = names()

      const entries = listProposalEnvelopes(agentQaRoot, { now: 2_000, isProcessAlive: ALIVE })

      expect(entries[0]?.applyInFlight).toBe(true)
      expect(entries[0]?.envelope.status).toBe('pending')
      expect(names()).toEqual(before)
    })

    it('CONTROL: the shipped liveness predicate really tells this process from a dead child', () => {
      expect(isProcessAlive(process.pid)).toBe(true)
      expect(isProcessAlive(deadPid())).toBe(false)
    })
  })

  describe('387-era files are read without migration (D-08 absorb-as-data)', () => {
    it('lists a bare legacy proposal file, minted with no origin, as an ordinary envelope', () => {
      // `proposeReview` with no origin writes the 387 shape — a BARE KnowledgeProposalV1 — and
      // this is the producer that made every proposal already on real machines.
      const legacy = mint('legacy', { at: 1_000 })
      const raw = JSON.parse(
        readFileSync(join(proposalsDir(agentQaRoot), `${legacy.proposalId}.json`), 'utf8'),
      ) as Record<string, unknown>
      expect(raw.schemaVersion).toBe(1)
      expect(raw.proposalId).toBe(legacy.proposalId)
      expect(raw.payload).toBeUndefined()

      const entry = showProposalEnvelope(agentQaRoot, legacy.proposalId, { now: 1_100 })

      expect(entry?.envelope.payload).toEqual(legacy)
      expect(entry?.envelope.status).toBe('pending')
      // ORIGIN IS ABSENT, not invented. A 387-era file records who proposed it nowhere, and
      // deriving an emitter from the verb would be attribution this store cannot vouch for.
      expect(entry?.envelope.origin).toBeUndefined()
    })

    it('wraps a mint that CARRIES an origin, and both shapes read through one extractor', () => {
      const wrapped = mint('wrapped', { at: 1_000, emittedBy: 'knowledge.forget.propose' })
      const raw = JSON.parse(
        readFileSync(join(proposalsDir(agentQaRoot), `${wrapped.proposalId}.json`), 'utf8'),
      ) as Record<string, unknown>
      expect(raw.kind).toBe('knowledge')
      expect(raw.payload).toEqual(wrapped)

      // `id` and `kind` joined the extraction in 394-18, when the store learned the envelope's
      // other two kinds. A bare 387-era document answers `knowledge` because that is the only
      // kind 387 could write — read off the shape, never defaulted for the convenience of a
      // reader.
      expect(extractStoredProposal(raw)).toEqual({
        id: wrapped.proposalId,
        kind: 'knowledge',
        payload: wrapped,
        origin: { emittedBy: 'knowledge.forget.propose', at: wrapped.proposedAt },
      })
      // …and the legacy shape through the SAME extractor, which is what "no migration" means.
      expect(extractStoredProposal(wrapped)).toEqual({
        id: wrapped.proposalId,
        kind: 'knowledge',
        payload: wrapped,
      })
      // The ordinary read path is indifferent to which shape it found.
      expect(readPendingProposal(agentQaRoot, wrapped.proposalId)).toEqual(wrapped)
    })

    it('survives an APPLY of a wrapped proposal, carrying the origin onto the applied record', () => {
      const wrapped = mint('apply-wrapped', { at: 1_000, emittedBy: 'knowledge.accept.propose' })
      const claim = claimPendingProposal(agentQaRoot, wrapped.proposalId)
      expect(claim.kind).toBe('consumed')
      if (claim.kind !== 'consumed') throw new Error('unreachable')
      publishAppliedProposal(agentQaRoot, {
        proposal: claim.proposal,
        ...(claim.origin === undefined ? {} : { origin: claim.origin }),
      })

      const entry = showProposalEnvelope(agentQaRoot, wrapped.proposalId, { now: 2_000 })

      expect(entry?.envelope.status).toBe('applied')
      expect(entry?.envelope.origin?.emittedBy).toBe('knowledge.accept.propose')
    })

    it('writePendingProposal still accepts the bare 387 call shape', () => {
      const proposal = mint('bare-rewrite', { at: 1_000 })
      rmSync(join(proposalsDir(agentQaRoot), `${proposal.proposalId}.json`))
      writePendingProposal(agentQaRoot, proposal)
      expect(readPendingProposal(agentQaRoot, proposal.proposalId)).toEqual(proposal)
    })
  })
})
