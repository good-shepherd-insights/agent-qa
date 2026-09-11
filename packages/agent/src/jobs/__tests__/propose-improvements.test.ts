// 422-08-T2 — the proposal stage's per-job Gate-1 allowance (D-14 / D-15).
//
// WHAT THIS FILE IS FOR, stated because the ordinary cap cells below are the easy half and are
// not the reason it exists. An independent plan review blocked the first version of this plan on
// a single observation: retaining completed attempts across a retry and checkpointing gate
// results only after the port acknowledged them does not durably account for allowance consumed
// BEFORE that checkpoint. Two interruption windows follow from it, and they fail in opposite
// directions:
//
//   1. The replay ran and the receipt write was refused or never answered. Nothing stands, so a
//      naive retry re-selects the same candidate and buys the same replay twice.
//   2. The receipt IS durable and the checkpoint recording the result never landed. The standing
//      receipt correctly suppresses that candidate — and its spent allowance is now invisible, so
//      the retry admits a DIFFERENT candidate and the job exceeds its own cap without ever
//      re-screening anything.
//
// Both windows are proven here by RESTART, not by reasoning: one durable store, two handler
// attempts over it, and a replay-call counter that neither attempt can reset. A cell that merely
// asserted the cap on a single uninterrupted pass would pass on a build with either bug.
//
// The store is a faithful stand-in for exactly the two facts this seam reads — checkpoints
// survive an attempt that died, and `readCheckpoint` answers the envelope `publishCheckpoint`
// wrote. Everything else the real store guarantees is proven against the real store in
// agent-local; a second copy of those proofs here would only prove this file.

import {
  stampReceiptDigest,
  type GateReceipt,
  type GateVerdict,
  type Job,
  type JobHandlerOutcome,
  type KnowledgeBundleSummary,
  type KnowledgeGatesListResult,
} from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'

import {
  createRealJobKindRegistry,
  parseProposeGate1Allowance,
  PROPOSE_DEFAULT_MAX_GATE1_PER_JOB,
  PROPOSE_GATE1_ALLOWANCE_CHECKPOINT,
  REAL_JOB_KIND_DECLARATIONS,
} from '../kinds.js'
import type {
  PostRunJobCapabilities,
  ProposeCorpusPosture,
  ProposeGate1Report,
  ProposeImprovementsCheckpoint,
} from '../kinds.js'
import type { JobCheckpointRecord } from '../../ports/job-store.js'
import type { JobHandlerContext } from '../kind-registry.js'

const RUN_ID = 'run-422-propose'
const JOB_ID = 'job_propose_422'
const PRODUCT = 'storefront'
const CURRENT_DIGEST = 'c'.repeat(64)
const OLD_DIGEST = 'd'.repeat(64)

const AXIS = { baseline: 0, candidate: 0, delta: 0, floor: 0, n: 1 }
const PER_AXIS = {
  headline: AXIS,
  elementIdentity: AXIS,
  value: AXIS,
  opClass: AXIS,
  sideEffect: AXIS,
  loop: AXIS,
}

function gate1Receipt(
  candidateId: string,
  verdict: GateVerdict,
  corpusDigest: string,
): GateReceipt {
  return stampReceiptDigest({
    schemaVersion: 1 as const,
    gate: 1 as const,
    candidateId,
    verdict,
    producedAtOrdinal: 7,
    producedBy: { jobId: 'fixture' },
    perAxisScore: PER_AXIS,
    corpusVersion: {
      corpusDigest,
      partitionVersion: 1,
      gateSetSize: 3,
      excludedCount: 0,
      minimumGateSet: 1,
    },
    samples: { k: 3, seeds: [11], seedHonored: true, modelCalls: 0 },
    crossCheck: 'not-run' as const,
  })
}

function bundle(
  bundleId: string,
  over: Partial<KnowledgeBundleSummary> = {},
): KnowledgeBundleSummary {
  return {
    bundleId,
    product: PRODUCT,
    dir: `bundles/${bundleId}`,
    kind: 'fact',
    scope: { tier: 'product', key: PRODUCT },
    status: 'candidate',
    trust: 0.5,
    counters: { confirmed: 0, contradicted: 0, helpful: 0, harmful: 0 },
    openedAtOrdinal: 1,
    lastConfirmedOrdinal: 0,
    summary: `${bundleId} summary`,
    evidenceIncomplete: false,
    ...over,
  }
}

/** A crash that escapes the handler entirely — the process-death stand-in. */
class HarnessCrash extends Error {}

interface Harness {
  /** Every `runReplayGate` invocation, in order, across EVERY attempt. Never reset. */
  readonly replayCalls: string[]
  /** What each attempt published, most recent last. */
  readonly published: { attempt: number; checkpointId: string; value: unknown }[]
  /** Durable Gate-1 receipts, as `gateReceiptsFor` would read them back. */
  readonly standing: Map<string, GateReceipt>
  attempt(): Promise<JobHandlerOutcome>
  /** The durable value of a checkpoint, envelope already peeled. */
  durableValue(checkpointId: string): unknown
  report(): ProposeGate1Report | undefined
  /** The next attempt's failure injection, set between attempts. */
  crashAt: string | undefined
  /** Candidates whose replay call refuses to acknowledge a receipt. */
  refuse: Set<string>
  bundles: readonly KnowledgeBundleSummary[]
  posture: ProposeCorpusPosture
  maxPerJob: number | undefined
  payloadCandidateIds: readonly string[]
  staged: { proposed: number; skipped: number } | undefined
  /** Bind nothing at all — the typed no-op posture. */
  unbind: boolean
  /** Corrupt the durable charge between attempts. */
  corruptAllowance(value: unknown): void
}

function harness(
  options: {
    bundles?: readonly KnowledgeBundleSummary[]
    standing?: readonly [string, GateReceipt][]
    payloadCandidateIds?: readonly string[]
    maxPerJob?: number
    posture?: ProposeCorpusPosture
  } = {},
): Harness {
  const durable = new Map<string, JobCheckpointRecord>()
  const state: Harness = {
    replayCalls: [],
    published: [],
    standing: new Map(options.standing ?? []),
    crashAt: undefined,
    refuse: new Set<string>(),
    bundles: options.bundles ?? [bundle('cand-a'), bundle('cand-b', { openedAtOrdinal: 2 })],
    posture: options.posture ?? { kind: 'resolved', corpusDigest: CURRENT_DIGEST },
    maxPerJob: options.maxPerJob,
    payloadCandidateIds: options.payloadCandidateIds ?? ['cand-a'],
    staged: undefined,
    unbind: false,
    attempt: undefined as unknown as Harness['attempt'],
    durableValue: (checkpointId: string) => durable.get(checkpointId)?.value,
    report: () => {
      const authored = durable.get('proposals-authored')?.value as
        | ProposeImprovementsCheckpoint
        | undefined
      return authored?.gate1
    },
    corruptAllowance: (value: unknown) => {
      const record = durable.get(PROPOSE_GATE1_ALLOWANCE_CHECKPOINT)
      if (record === undefined) throw new Error('no durable allowance to corrupt')
      durable.set(PROPOSE_GATE1_ALLOWANCE_CHECKPOINT, { ...record, value })
    },
  }

  let attempts = 0
  const base: PostRunJobCapabilities = {
    loadCompletedRunHandoff: () => {
      throw new Error('the proposal stage reads no handoff')
    },
    curateRun: async () => ({ curated: 0, deprecated: 0, complete: true }),
    persistAnalysis: () => {},
    stageAdversarialProposal: async () =>
      state.staged ?? { proposed: 0, skipped: 0 },
    listBundles: async () => state.bundles,
    gateReceiptsFor: async ({ candidateId }): Promise<KnowledgeGatesListResult> => {
      const row = state.bundles.find((entry) => entry.bundleId === candidateId)
      if (row === undefined) return { kind: 'not-found', recordId: candidateId }
      const receipt = state.standing.get(candidateId)
      return {
        kind: 'found',
        recordId: row.bundleId,
        product: row.product,
        recordKind: row.kind,
        status: row.status,
        lines: receipt === undefined ? [] : [receipt],
        standing: receipt === undefined ? [] : [receipt],
        live: { verdict: 'hold', reason: 'not-candidate' },
        posture: 'resolved',
      }
    },
    readProposeCorpusPosture: async () => state.posture,
    readProposeGate1Allowance: async () => {
      const record = durable.get(PROPOSE_GATE1_ALLOWANCE_CHECKPOINT)
      return parseProposeGate1Allowance(
        record === undefined ? { found: false } : { found: true, payload: record },
      )
    },
    runReplayGate: async (candidateId) => {
      const id = String(candidateId)
      state.replayCalls.push(id)
      // THE ORDERING CLAIM, asserted from INSIDE the call: a charge written after the port was
      // entered would be invisible to any after-the-fact inspection, so the assertion has to
      // happen while the call is in flight.
      const record = durable.get(PROPOSE_GATE1_ALLOWANCE_CHECKPOINT)
      const charged = parseProposeGate1Allowance(
        record === undefined ? { found: false } : { found: true, payload: record },
      )
      expect(charged.kind, 'the allowance is durable before the first port call').toBe('claimed')
      if (state.refuse.has(id)) {
        throw new Error(`Gate 1 for candidate ${id} produced a receipt the writer did not record`)
      }
      const receipt = gate1Receipt(id, 'pass', CURRENT_DIGEST)
      state.standing.set(id, receipt)
      return receipt
    },
    ...(options.maxPerJob === undefined ? {} : { proposeGate1MaxPerJob: options.maxPerJob }),
  }

  state.attempt = async () => {
    attempts += 1
    const attempt = attempts
    const job = {
      id: JOB_ID,
      kind: 'propose-improvements',
      status: 'queued',
      summary: 'fixture',
      attempts: attempt,
      createdAt: '2026-09-11T00:00:00.000Z',
      updatedAt: '2026-09-11T00:00:00.000Z',
    } as unknown as Job
    const context: JobHandlerContext = {
      job,
      payload: {
        runId: RUN_ID,
        executionContext: 'local-headless',
        candidateIds: [...state.payloadCandidateIds],
        upstream: { analysisStatus: 'done', curation: { curated: 1, deprecated: 0, complete: true } },
      },
      publishCheckpoint: async (checkpointId: string, value: unknown) => {
        // Durable FIRST, then the crash: a kill between the store accepting the bytes and the
        // caller learning it did is the lost-acknowledgement window, and it is a real window.
        durable.set(checkpointId, {
          checkpointId,
          jobId: JOB_ID as unknown as JobCheckpointRecord['jobId'],
          attempt,
          recordedAt: '2026-09-11T00:00:00.000Z',
          value,
        })
        state.published.push({ attempt, checkpointId, value })
        if (state.crashAt === checkpointId) {
          state.crashAt = undefined
          throw new HarnessCrash(`killed at ${checkpointId}`)
        }
      },
      recordLlmAuthorship: (async () => {
        throw new Error('the proposal stage authors nothing')
      }) as unknown as JobHandlerContext['recordLlmAuthorship'],
    }
    // The unbound posture drops the GATE capabilities only. The staging port stays bound, so the
    // cell can show a stage that staged real counts beside a `gate1` member that is absent
    // because nothing screened — two different capabilities, two different absences.
    const capabilities: PostRunJobCapabilities = state.unbind
      ? {
          loadCompletedRunHandoff: base.loadCompletedRunHandoff,
          curateRun: base.curateRun,
          persistAnalysis: base.persistAnalysis,
          ...(base.stageAdversarialProposal === undefined
            ? {}
            : { stageAdversarialProposal: base.stageAdversarialProposal }),
        }
      : {
          ...base,
          ...(state.maxPerJob === undefined ? {} : { proposeGate1MaxPerJob: state.maxPerJob }),
        }
    return createRealJobKindRegistry(capabilities)
      .require('propose-improvements')
      .handler(context)
  }
  return state
}

function proposeDeclaration(): (typeof REAL_JOB_KIND_DECLARATIONS)[number] {
  const declaration = REAL_JOB_KIND_DECLARATIONS.find(
    (entry) => entry.kind === 'propose-improvements',
  )
  if (declaration === undefined) throw new Error('propose-improvements is not declared')
  return declaration
}

describe('the proposal stage charges its Gate-1 allowance before it spends one (422 D-14)', () => {
  it('declares the charge checkpoint AHEAD of the result checkpoint', () => {
    // The order is the contract, not a listing convention: a charge published after the result
    // could not be read by the attempt that has to learn what a dead one already spent.
    expect(proposeDeclaration().checkpointSchedule).toEqual([
      PROPOSE_GATE1_ALLOWANCE_CHECKPOINT,
      'proposals-authored',
    ])
    expect(PROPOSE_DEFAULT_MAX_GATE1_PER_JOB).toBe(4)
    // Five kinds, still. This stage gained a checkpoint, not a sibling.
    expect(REAL_JOB_KIND_DECLARATIONS.map((entry) => entry.kind).sort()).toEqual([
      'analyze-run',
      'chat',
      'consolidate',
      'curate-memory',
      'propose-improvements',
    ])
  })

  it('gates payload candidates first, then the product sweep oldest-first with the id as tie-break', async () => {
    const h = harness({
      bundles: [
        bundle('sweep-young', { openedAtOrdinal: 9 }),
        bundle('sweep-b', { openedAtOrdinal: 3 }),
        bundle('sweep-a', { openedAtOrdinal: 3 }),
        bundle('cand-second', { openedAtOrdinal: 1 }),
        bundle('cand-first', { openedAtOrdinal: 8 }),
        bundle('other-product', { product: 'elsewhere', openedAtOrdinal: 1 }),
      ],
      // Duplicated on purpose: a payload that names one candidate twice buys one slot, not two.
      payloadCandidateIds: ['cand-first', 'cand-second', 'cand-first', 'not-in-the-corpus'],
      maxPerJob: 6,
    })
    await h.attempt()
    // Payload ORDER, not corpus order — `cand-first` opened later than `cand-second` and still
    // comes first, because the payload is the work this run's fold actually committed.
    expect(h.replayCalls).toEqual([
      'cand-first',
      'cand-second',
      'sweep-a',
      'sweep-b',
      'sweep-young',
    ])
    expect(h.report()?.reservedGate1).toEqual(h.replayCalls)
    // A different product's candidate is never swept: this job has no evidence about it.
    expect(h.replayCalls).not.toContain('other-product')
  })

  it('skips a standing decision, selects a stale one, and defers the rest of the cap', async () => {
    const h = harness({
      bundles: [
        bundle('cand-fail', { openedAtOrdinal: 1 }),
        bundle('cand-abstain', { openedAtOrdinal: 2 }),
        bundle('cand-stale', { openedAtOrdinal: 3 }),
        bundle('cand-fresh', { openedAtOrdinal: 4 }),
        bundle('cand-deferred', { openedAtOrdinal: 5 }),
        bundle('cand-procedure', { openedAtOrdinal: 6, kind: 'procedure' }),
        bundle('cand-policy', { openedAtOrdinal: 7, kind: 'policy' }),
        bundle('cand-active', { openedAtOrdinal: 8, status: 'active' }),
      ],
      standing: [
        ['cand-fail', gate1Receipt('cand-fail', 'fail', CURRENT_DIGEST)],
        ['cand-abstain', gate1Receipt('cand-abstain', 'abstain', CURRENT_DIGEST)],
        ['cand-stale', gate1Receipt('cand-stale', 'pass', OLD_DIGEST)],
      ],
      payloadCandidateIds: ['cand-fail', 'cand-abstain', 'cand-stale'],
      maxPerJob: 2,
    })
    await h.attempt()
    const report = h.report()
    // A standing fail and a standing abstain are DECISIONS this corpus already made. Re-buying
    // them would spend the charge on a question that has an answer.
    expect(h.replayCalls).toEqual(['cand-stale', 'cand-fresh'])
    expect(report?.stale).toEqual(['cand-stale'])
    expect(report?.cap).toEqual({ value: 2, source: 'config' })
    // The cap binds, and what it did not admit is DISCLOSED rather than dropped — it waits for a
    // later run's distinct job or the operator's replay-gate verb.
    expect(report?.ungatedRemaining).toEqual(['cand-deferred'])
    expect(report?.kindExcluded).toEqual(['cand-procedure', 'cand-policy'])
    // A record that is not a candidate is not eligible at all, and is not disclosed as deferred.
    expect(report?.ungatedRemaining).not.toContain('cand-active')
    expect(report?.screenedGate1).toEqual([
      { candidateId: 'cand-stale', verdict: 'pass' },
      { candidateId: 'cand-fresh', verdict: 'pass' },
    ])
  })

  it('records the default bound and its source when no override is configured', async () => {
    const h = harness({
      bundles: Array.from({ length: 6 }, (_, index) =>
        bundle(`cand-${index}`, { openedAtOrdinal: index }),
      ),
      payloadCandidateIds: ['cand-0'],
    })
    await h.attempt()
    expect(h.report()?.cap).toEqual({
      value: PROPOSE_DEFAULT_MAX_GATE1_PER_JOB,
      source: 'default',
    })
    expect(h.replayCalls).toHaveLength(PROPOSE_DEFAULT_MAX_GATE1_PER_JOB)
  })

  it('never counts a refused receipt as a screened success, and staging cannot erase it', async () => {
    const h = harness({
      bundles: [bundle('cand-a'), bundle('cand-b', { openedAtOrdinal: 2 })],
      payloadCandidateIds: ['cand-a', 'cand-b'],
      maxPerJob: 2,
    })
    h.refuse.add('cand-a')
    h.staged = { proposed: 5, skipped: 1 }
    const outcome = await h.attempt()
    expect(outcome.status).toBe('complete')
    const report = h.report()
    expect(report?.screenedGate1).toEqual([{ candidateId: 'cand-b', verdict: 'pass' }])
    // Refused, so UNKNOWN — its slot stays charged and it is not a zero, not a fail, and not a
    // candidate anything may screen again inside this job.
    expect(report?.interruptedGate1).toEqual(['cand-a'])
    expect(report?.reservedGate1).toEqual(['cand-a', 'cand-b'])
    // The staging counts land on the SAME checkpoint and take nothing away from the refusal.
    const authored = h.durableValue('proposals-authored') as ProposeImprovementsCheckpoint
    expect(authored.proposed).toBe(5)
    expect(authored.skipped).toBe(1)
    expect(authored.gate1?.interruptedGate1).toEqual(['cand-a'])
  })

  // ---- window 1: the call was made and no receipt was acknowledged -------------------------

  it('with cap one, a kill after the call and before an acknowledged receipt buys nothing twice', async () => {
    const h = harness({
      bundles: [bundle('cand-a'), bundle('cand-b', { openedAtOrdinal: 2 })],
      payloadCandidateIds: ['cand-a'],
      maxPerJob: 1,
    })
    h.refuse.add('cand-a')
    h.crashAt = 'proposals-authored'
    await expect(h.attempt()).rejects.toBeInstanceOf(HarnessCrash)
    expect(h.replayCalls).toEqual(['cand-a'])
    // Nothing stands for `cand-a`: the replay ran and its receipt was never written. That is
    // exactly the state in which a naive retry would buy the same replay a second time.
    expect(h.standing.has('cand-a')).toBe(false)

    const outcome = await h.attempt()
    expect(outcome.status).toBe('complete')
    // ZERO further replay calls — for `cand-a` and for the ungated `cand-b` behind it.
    expect(h.replayCalls).toEqual(['cand-a'])
    const report = h.report()
    expect(report?.disposition).toBe('resumed')
    expect(report?.reservedGate1).toEqual(['cand-a'])
    expect(report?.cap).toEqual({ value: 1, source: 'config' })
    // UNKNOWN, disclosed as such: no screened success, and no recovered receipt either.
    expect(report?.interruptedGate1).toEqual(['cand-a'])
    expect(report?.screenedGate1).toEqual([])
    expect(report?.recoveredGate1Receipts).toEqual([])
    // The charge was not refilled and no replacement candidate was admitted in its place.
    expect(report?.ungatedRemaining).toEqual([])
  })

  // ---- window 2: the receipt is durable and the result checkpoint never landed -------------

  it('with cap one, a kill after a durable receipt recovers it without calling anything again', async () => {
    const h = harness({
      bundles: [bundle('cand-a'), bundle('cand-b', { openedAtOrdinal: 2 })],
      payloadCandidateIds: ['cand-a'],
      maxPerJob: 1,
    })
    h.crashAt = 'proposals-authored'
    await expect(h.attempt()).rejects.toBeInstanceOf(HarnessCrash)
    expect(h.replayCalls).toEqual(['cand-a'])
    // The receipt IS durable here. Without the charge, `cand-a` would be correctly suppressed on
    // the retry — and its spent slot would be invisible, so `cand-b` would be bought instead and
    // the job would exceed its own cap having re-screened nothing.
    expect(h.standing.has('cand-a')).toBe(true)

    await h.attempt()
    expect(h.replayCalls).toEqual(['cand-a'])
    const report = h.report()
    expect(report?.disposition).toBe('resumed')
    expect(report?.reservedGate1).toEqual(['cand-a'])
    expect(report?.cap).toEqual({ value: 1, source: 'config' })
    // RECOVERED, and reported separately: this attempt found the receipt, it did not produce it.
    expect(report?.recoveredGate1Receipts).toEqual([{ candidateId: 'cand-a', verdict: 'pass' }])
    expect(report?.screenedGate1).toEqual([])
    expect(report?.interruptedGate1).toEqual([])
  })

  it('recovers nothing from a receipt produced against a corpus the charge was not made against', async () => {
    const h = harness({
      bundles: [bundle('cand-a')],
      payloadCandidateIds: ['cand-a'],
      maxPerJob: 1,
    })
    h.crashAt = 'proposals-authored'
    await expect(h.attempt()).rejects.toBeInstanceOf(HarnessCrash)
    // The corpus moved between the attempts, and the standing receipt moved with it.
    h.standing.set('cand-a', gate1Receipt('cand-a', 'pass', OLD_DIGEST))
    h.posture = { kind: 'resolved', corpusDigest: OLD_DIGEST }
    await h.attempt()
    const report = h.report()
    // A receipt about a different corpus answers a different question, so the slot stays UNKNOWN
    // rather than being recovered as though it settled this one.
    expect(report?.recoveredGate1Receipts).toEqual([])
    expect(report?.interruptedGate1).toEqual(['cand-a'])
    expect(h.replayCalls).toEqual(['cand-a'])
  })

  // ---- the lost acknowledgement of the charge itself ----------------------------------------

  it('spends nothing at all when the charge landed and its acknowledgement was lost', async () => {
    const h = harness({
      bundles: [bundle('cand-a'), bundle('cand-b', { openedAtOrdinal: 2 })],
      payloadCandidateIds: ['cand-a'],
      maxPerJob: 1,
    })
    h.crashAt = PROPOSE_GATE1_ALLOWANCE_CHECKPOINT
    await expect(h.attempt()).rejects.toBeInstanceOf(HarnessCrash)
    // Not one call was made: only the execution that hears its own charge acknowledged may spend.
    expect(h.replayCalls).toEqual([])

    await h.attempt()
    // Still none — and the charge is not refunded to buy a fresh selection either.
    expect(h.replayCalls).toEqual([])
    const report = h.report()
    expect(report?.disposition).toBe('resumed')
    expect(report?.reservedGate1).toEqual(['cand-a'])
    expect(report?.interruptedGate1).toEqual(['cand-a'])
    expect(report?.ungatedRemaining).toEqual([])
  })

  // ---- a retry cannot be talked into a bigger budget ----------------------------------------

  it('ignores a raised bound, a moved corpus and a reordered corpus on the resumed attempt', async () => {
    const h = harness({
      bundles: [bundle('cand-a'), bundle('cand-b', { openedAtOrdinal: 2 })],
      payloadCandidateIds: ['cand-a'],
    })
    h.maxPerJob = undefined
    h.crashAt = PROPOSE_GATE1_ALLOWANCE_CHECKPOINT
    await expect(h.attempt()).rejects.toBeInstanceOf(HarnessCrash)
    const charged = h.durableValue(PROPOSE_GATE1_ALLOWANCE_CHECKPOINT)
    expect(charged).toMatchObject({
      jobId: JOB_ID,
      runId: RUN_ID,
      product: PRODUCT,
      corpusDigest: CURRENT_DIGEST,
      cap: { value: PROPOSE_DEFAULT_MAX_GATE1_PER_JOB, source: 'default' },
    })

    // Everything an operator or a corpus could change between the attempts, changed at once.
    h.maxPerJob = 32
    h.posture = { kind: 'resolved', corpusDigest: OLD_DIGEST }
    h.bundles = [
      bundle('cand-z', { openedAtOrdinal: 0 }),
      bundle('cand-a'),
      bundle('cand-b', { openedAtOrdinal: 2 }),
    ]
    h.payloadCandidateIds = ['cand-z', 'cand-a', 'cand-b']
    await h.attempt()
    const report = h.report()
    // The charge is a record of what was spent, not a proposal to be renegotiated.
    expect(report?.cap).toEqual({ value: PROPOSE_DEFAULT_MAX_GATE1_PER_JOB, source: 'default' })
    expect(report?.reservedGate1).toEqual(['cand-a', 'cand-b'])
    expect(h.replayCalls).toEqual([])
    expect(report?.ungatedRemaining).toEqual([])
  })

  it('spends nothing when the persisted charge cannot be read or belongs to another job', async () => {
    const h = harness({ payloadCandidateIds: ['cand-a'], maxPerJob: 1 })
    h.crashAt = PROPOSE_GATE1_ALLOWANCE_CHECKPOINT
    await expect(h.attempt()).rejects.toBeInstanceOf(HarnessCrash)

    // A charge this build cannot read is NOT an absent one. Degrading it to absence would
    // license a second selection against slots that may already be spent.
    h.corruptAllowance({ jobId: JOB_ID, runId: RUN_ID, product: PRODUCT, cap: { value: 0 } })
    await h.attempt()
    expect(h.replayCalls).toEqual([])
    expect(h.report()).toMatchObject({
      disposition: 'allowance-unavailable',
      reservedGate1: [],
      screenedGate1: [],
    })

    // …and a readable charge that names a different run is refused rather than adopted.
    h.corruptAllowance({
      jobId: JOB_ID,
      runId: 'some-other-run',
      product: PRODUCT,
      corpusDigest: CURRENT_DIGEST,
      cap: { value: 1, source: 'default' },
      selectedCandidateIds: ['cand-a'],
    })
    await h.attempt()
    expect(h.replayCalls).toEqual([])
    expect(h.report()?.disposition).toBe('allowance-unavailable')
  })

  it('parses a charge back exactly, and refuses one that outruns its own cap', () => {
    const allowance = {
      jobId: JOB_ID,
      runId: RUN_ID,
      product: PRODUCT,
      corpusDigest: CURRENT_DIGEST,
      cap: { value: 2, source: 'default' as const },
      selectedCandidateIds: ['cand-a', 'cand-b'],
    }
    expect(
      parseProposeGate1Allowance({
        found: true,
        payload: { checkpointId: PROPOSE_GATE1_ALLOWANCE_CHECKPOINT, value: allowance },
      }),
    ).toEqual({ kind: 'claimed', allowance })
    expect(parseProposeGate1Allowance({ found: false })).toEqual({ kind: 'absent' })
    expect(
      parseProposeGate1Allowance({
        found: true,
        payload: { value: { ...allowance, selectedCandidateIds: ['a', 'b', 'c'] } },
      }),
    ).toMatchObject({ kind: 'unreadable' })
  })

  // ---- the postures that spend nothing and still finish -------------------------------------

  it('completes with no gate1 member at all when no gate capability is bound', async () => {
    const h = harness({ payloadCandidateIds: ['cand-a'] })
    h.unbind = true
    h.staged = { proposed: 1, skipped: 0 }
    const outcome = await h.attempt()
    expect(outcome.status).toBe('complete')
    expect(h.replayCalls).toEqual([])
    // ABSENT, not an empty report: a host that bound no gate did not screen zero candidates, it
    // did not screen. Every record written before this widening still says the same thing.
    expect(h.durableValue('proposals-authored')).toEqual({
      runId: RUN_ID,
      candidateIds: ['cand-a'],
      proposed: 1,
      skipped: 0,
    })
    expect(h.durableValue(PROPOSE_GATE1_ALLOWANCE_CHECKPOINT)).toBeUndefined()
  })

  it('completes posture-unavailable on a broken root without spending or retrying', async () => {
    const h = harness({ payloadCandidateIds: ['cand-a'] })
    h.posture = { kind: 'unavailable', reason: 'the committed corpus root is unreadable' }
    const outcome = await h.attempt()
    // COMPLETE, not retryable: a broken root does not become readable because a job asked twice,
    // and a stage that refused to finish would strand the chain terminal for the whole run.
    expect(outcome.status).toBe('complete')
    expect(h.replayCalls).toEqual([])
    expect(h.report()).toMatchObject({
      disposition: 'posture-unavailable',
      reason: 'the committed corpus root is unreadable',
      reservedGate1: [],
    })
    expect(h.durableValue(PROPOSE_GATE1_ALLOWANCE_CHECKPOINT)).toBeUndefined()

    const absent = harness({ payloadCandidateIds: ['cand-a'] })
    absent.posture = { kind: 'no-root' }
    expect((await absent.attempt()).status).toBe('complete')
    expect(absent.report()?.disposition).toBe('posture-unavailable')
    expect(absent.replayCalls).toEqual([])
  })

  it('charges nothing when the payload names no candidate this corpus holds', async () => {
    const h = harness({ payloadCandidateIds: [] })
    await h.attempt()
    expect(h.report()?.disposition).toBe('no-candidates')
    expect(h.replayCalls).toEqual([])
    // No product anchor means no sweep: a proposal job is about ONE run, and a sweep scoped by
    // anything else would spend this run's charge on a corpus it has no evidence about.
    expect(h.durableValue(PROPOSE_GATE1_ALLOWANCE_CHECKPOINT)).toBeUndefined()
  })

  it('finishes the stage even when the Gate-1 leg had nothing to do', async () => {
    const h = harness({
      bundles: [bundle('cand-a')],
      standing: [['cand-a', gate1Receipt('cand-a', 'pass', CURRENT_DIGEST)]],
      payloadCandidateIds: ['cand-a'],
    })
    const outcome = await h.attempt()
    expect(outcome).toEqual({ status: 'complete', next: [] })
    expect(h.replayCalls).toEqual([])
    expect(h.report()).toMatchObject({ disposition: 'claimed', reservedGate1: [], stale: [] })
    expect(h.durableValue(PROPOSE_GATE1_ALLOWANCE_CHECKPOINT)).toBeUndefined()
  })
})
