// THE TERMINAL HOST'S PROPOSAL STAGE, TRACED END TO END (Phase 422 plan 09, D-01/D-09/D-10/D-13..D-15).
//
// WHAT THIS FILE EXISTS TO CATCH. 422-07 declared `stageAdversarialProposal` and 422-08 declared
// `runReplayGate`, `listBundles`, `gateReceiptsFor` and `readProposeCorpusPosture`. Every one of
// them typechecked, every sibling suite was green, and NOT ONE of them was bound at a production
// host — so the third chain stage shipped as a typed no-op for three waves while the record it
// wrote said, truthfully, that it had staged nothing. A capability that typechecks is not a
// capability that runs, and the only assertion that can tell those apart is one that drives the
// PRODUCTION composition and reads back what the durable record says afterwards.
//
// So the cells below are in two layers and neither of them is a fixture:
//
//   THE WIRE   `composeCliLocalAgent` is called for real and the object it hands
//              `composeLocalAgent` is inspected. That answers "is it bound", which is exactly
//              the question three waves of green suites could not answer.
//   THE PUMP   a REAL `composeLocalAgent` over a REAL sqlite store in a temporary root runs the
//              fold's successor and the checkpoint is read back off the store. That answers "is
//              it reachable", which is a different question with a different failure mode.
//
// NOTHING HERE REACHES A PROVIDER OR A NETWORK. The eval session composition — the single module
// behind the replay gate, the committed corpus digest and the adversarial staging verb — is
// substituted at its own seam, which is where a fake belongs: below it sit an LLM, a browser and
// a committed corpus, and above it sits every line this plan wrote.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { chainJobIdsForRun, stampReceiptDigest } from '@vostride/agent-qa-agent'
import type {
  ConfigReaderPort,
  JobModelCapability,
  KnowledgeBundleSummary,
  KnowledgeGatesListResult,
  ProposeGate1Report,
} from '@vostride/agent-qa-agent'
import type { GateReceipt, GateVerdict } from '@vostride/agent-qa-schema'

vi.mock('@vostride/agent-qa-agent-local', async (original) => {
  const actual = await original<typeof import('@vostride/agent-qa-agent-local')>()
  return {
    ...actual,
    // Spied, never replaced: `vi.fn(actual.x)` still runs the real composition, so the wire
    // cells read the real argument and the pump cells drive the real queue.
    composeLocalAgent: vi.fn(actual.composeLocalAgent),
    createKnowledgeReader: vi.fn(actual.createKnowledgeReader),
  }
})
vi.mock('../../eval-session-composition.js', async (original) => {
  const actual = await original<typeof import('../../eval-session-composition.js')>()
  return {
    ...actual,
    resolveEvalSession: vi.fn(),
    runReplayGateVerb: vi.fn(),
    readCanaryCorpusDigest: vi.fn(),
    runAdversarialVerb: vi.fn(),
  }
})

import {
  composeLocalAgent,
  createKnowledgeReader,
  DIGEST_JOB_ID_SOURCE,
  type LocalAgentHost,
} from '@vostride/agent-qa-agent-local'
import {
  readCanaryCorpusDigest,
  resolveEvalSession,
  runAdversarialVerb,
  runReplayGateVerb,
} from '../../eval-session-composition.js'

import {
  composeCliLocalAgent,
  proposalStageCapabilities,
  resolveProposeGate1MaxPerJob,
} from '../../composition/local-agent-host.js'
import { curateCompletedRun, type CurationTailReceipt } from '../curation-tail.js'

const RUN_ID = 'r_422-09-terminal'
const PRODUCT = 'storefront'
const CURRENT_DIGEST = 'c'.repeat(64)
const MINT_IDENTITY = (filePath: string): string => filePath

const TEST_MODEL: JobModelCapability = {
  modelId: 'test:422-09-propose-improvements-host',
  generate: async () => ({ text: 'not an author payload' }),
}
const TEST_CONFIG: ConfigReaderPort = {
  getMasked: async () => ({ schemaVersion: 1, configPath: '/tmp/422-09.config.yaml', entries: [] }),
}

const AXIS = { baseline: 0, candidate: 0, delta: 0, floor: 0, n: 1 }
const PER_AXIS = {
  headline: AXIS,
  elementIdentity: AXIS,
  value: AXIS,
  opClass: AXIS,
  sideEffect: AXIS,
  loop: AXIS,
}

function gate1Receipt(candidateId: string, verdict: GateVerdict): GateReceipt {
  return stampReceiptDigest({
    schemaVersion: 1 as const,
    gate: 1 as const,
    candidateId,
    verdict,
    producedAtOrdinal: 7,
    producedBy: { jobId: 'fixture' },
    perAxisScore: PER_AXIS,
    corpusVersion: {
      corpusDigest: CURRENT_DIGEST,
      partitionVersion: 1,
      gateSetSize: 3,
      excludedCount: 0,
      minimumGateSet: 1,
    },
    samples: { k: 3, seeds: [11], seedHonored: true, modelCalls: 0 },
    crossCheck: 'not-run' as const,
  })
}

function bundle(bundleId: string): KnowledgeBundleSummary {
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
  }
}

/** The committed knowledge this host's reader serves, and the receipts a Gate-1 write leaves. */
interface CommittedStore {
  bundles: KnowledgeBundleSummary[]
  standing: Map<string, GateReceipt>
}

function committedStore(ids: readonly string[]): CommittedStore {
  return { bundles: ids.map(bundle), standing: new Map() }
}

function readerOver(store: CommittedStore) {
  return {
    listBundles: async () => store.bundles,
    gateReceipts: async ({ candidateId }: { candidateId: string }): Promise<KnowledgeGatesListResult> => {
      const row = store.bundles.find((entry) => entry.bundleId === candidateId)
      if (row === undefined) return { kind: 'not-found', recordId: candidateId }
      const receipt = store.standing.get(candidateId)
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
  }
}

/**
 * The eval session seam, standing in for a provider, a browser and a committed corpus.
 *
 * Every substitution is at `eval-session-composition`'s own exported boundary, which is the
 * boundary the production bindings reach through — so what is exercised above it is the real
 * closure, the real projection and the real refusal handling.
 */
function stubEvalSession(store: CommittedStore, over: {
  readonly replay?: (candidateId: string) => unknown
  readonly adversarial?: unknown
  readonly digest?: unknown
  readonly gate1MaxPerJob?: number
} = {}) {
  vi.mocked(resolveEvalSession).mockResolvedValue({
    evalConfig: over.gate1MaxPerJob === undefined ? {} : { gate1: { maxPerJob: over.gate1MaxPerJob } },
    configDir: '/tmp/422-09',
    configPath: '/tmp/422-09/agent-qa.config.yaml',
  } as unknown as Awaited<ReturnType<typeof resolveEvalSession>>)
  vi.mocked(readCanaryCorpusDigest).mockReturnValue(
    (over.digest ?? { kind: 'digest', corpusDigest: CURRENT_DIGEST }) as ReturnType<
      typeof readCanaryCorpusDigest
    >,
  )
  vi.mocked(runReplayGateVerb).mockImplementation((async (
    _session: unknown,
    candidateId: string,
  ) => {
    if (over.replay !== undefined) return over.replay(candidateId)
    const receipt = gate1Receipt(candidateId, 'pass')
    store.standing.set(candidateId, receipt)
    return { kind: 'receipt', receipt, recorded: 'appended', lines: [], notices: [], exit: 0 }
  }) as unknown as typeof runReplayGateVerb)
  vi.mocked(runAdversarialVerb).mockResolvedValue(
    (over.adversarial ?? {
      kind: 'staged',
      product: PRODUCT,
      staged: [{ seedCassetteId: 's1' }, { seedCassetteId: 's2' }],
      skips: [{ reason: 'settled' }],
      stagingSkips: [],
      refusals: [],
      settledRefusals: [],
      admitted: [],
    }) as unknown as Awaited<ReturnType<typeof runAdversarialVerb>>,
  )
}

const roots: string[] = []
const hosts: LocalAgentHost[] = []

beforeEach(() => {
  vi.clearAllMocks()
})
afterEach(async () => {
  for (const host of hosts.splice(0)) await host.close().catch(() => undefined)
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  vi.restoreAllMocks()
})

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'agent-qa-422-09-'))
  roots.push(root)
  return root
}

// ---- THE WIRE -------------------------------------------------------------------------------

describe('the terminal host BINDS the proposal stage rather than declaring it (422 D-01/D-14)', () => {
  it('hands the composition every proposal capability, not only the allowance reader', () => {
    const root = tempRoot()
    const store = committedStore(['rec-a'])
    stubEvalSession(store)
    vi.mocked(createKnowledgeReader).mockReturnValue(
      readerOver(store) as unknown as ReturnType<typeof createKnowledgeReader>,
    )
    composeCliLocalAgent({
      configPath: join(root, 'agent-qa.config.yaml'),
      agentQaRoot: join(root, '.agent-qa'),
      confirm: undefined,
      config: TEST_CONFIG,
      model: () => TEST_MODEL,
      postRun: {
        candidateProse: 'masker-active',
        curateRun: async () => ({ curated: 0, deprecated: 0, complete: true, candidateIds: [] }),
        resolveClaimAuthority: () => undefined,
      },
    })
    const handed = vi.mocked(composeLocalAgent).mock.calls.at(-1)![0].postRun
    // The five members 422-08's window names, plus the two that were already there. Asserted as
    // a SET rather than member-by-member: a capability silently dropped from this literal is the
    // exact regression, and a per-member assertion would pass for the members somebody
    // remembered while the forgotten one stayed invisible.
    expect(Object.keys(handed!).sort()).toEqual([
      'candidateProse',
      'curateRun',
      'gateReceiptsFor',
      'listBundles',
      'proposeGate1MaxPerJob',
      'readProposeCorpusPosture',
      'runReplayGate',
      'stageAdversarialProposal',
    ])
  })

  it('resolves the borrowed writer lease at the Gate-1 CLAIM, never when the host is composed', async () => {
    const root = tempRoot()
    const store = committedStore(['rec-a'])
    stubEvalSession(store)
    vi.mocked(createKnowledgeReader).mockReturnValue(
      readerOver(store) as unknown as ReturnType<typeof createKnowledgeReader>,
    )
    // The production ordering: the host is composed BEFORE the pump takes its lease, exactly as
    // `runPostRunTail` composes before `acquireWriterLease`. A binding that read the lease here
    // would read `undefined` forever and every Gate-1 write would ask the writer for a lease
    // this process already holds.
    let held: { leaseId: string; epoch: number } | undefined
    composeCliLocalAgent({
      configPath: join(root, 'agent-qa.config.yaml'),
      agentQaRoot: join(root, '.agent-qa'),
      confirm: undefined,
      config: TEST_CONFIG,
      model: () => TEST_MODEL,
      postRun: {
        candidateProse: 'masker-active',
        curateRun: async () => ({ curated: 0, deprecated: 0, complete: true }),
        resolveClaimAuthority: () => held,
      },
    })
    const handed = vi.mocked(composeLocalAgent).mock.calls.at(-1)![0].postRun!
    held = { leaseId: 'lease-terminal', epoch: 11 }
    await handed.runReplayGate!('rec-a' as Parameters<NonNullable<typeof handed.runReplayGate>>[0])
    const options = vi.mocked(runReplayGateVerb).mock.calls.at(-1)![2] as {
      claimAuthority?: { leaseId: string; epoch: number }
    }
    expect(options.claimAuthority).toEqual({ leaseId: 'lease-terminal', epoch: 11 })
  })
})

// ---- THE CAPABILITIES THEMSELVES ------------------------------------------------------------

describe('the composed capabilities answer from the host, not from a fixture (422 D-14)', () => {
  function capabilities(store: CommittedStore, authority?: { leaseId: string; epoch: number }) {
    const root = tempRoot()
    vi.mocked(createKnowledgeReader).mockReturnValue(
      readerOver(store) as unknown as ReturnType<typeof createKnowledgeReader>,
    )
    return proposalStageCapabilities({
      configPath: join(root, 'agent-qa.config.yaml'),
      agentQaRoot: join(root, '.agent-qa'),
      resolveKnowledgeRoot: () => join(root, 'knowledge'),
      ...(authority === undefined ? {} : { resolveClaimAuthority: () => authority }),
    })
  }

  it('projects the three corpus postures without folding unreadable into absent', async () => {
    const store = committedStore([])
    stubEvalSession(store)
    const caps = capabilities(store)
    expect(await caps.readProposeCorpusPosture({ product: PRODUCT })).toEqual({
      kind: 'resolved',
      corpusDigest: CURRENT_DIGEST,
    })
    vi.mocked(readCanaryCorpusDigest).mockReturnValue({ kind: 'no-eval-root' } as ReturnType<
      typeof readCanaryCorpusDigest
    >)
    expect(await caps.readProposeCorpusPosture({ product: PRODUCT })).toEqual({ kind: 'no-root' })
    vi.mocked(readCanaryCorpusDigest).mockReturnValue({
      kind: 'unavailable',
      reason: 'corpus-unreadable',
    } as ReturnType<typeof readCanaryCorpusDigest>)
    expect(await caps.readProposeCorpusPosture({ product: PRODUCT })).toEqual({
      kind: 'unavailable',
      reason: 'corpus-unreadable',
    })
  })

  it('stages the run product WITHOUT admitting, and projects the batch into the neutral counts', async () => {
    const store = committedStore(['rec-a', 'rec-b'])
    stubEvalSession(store)
    const caps = capabilities(store)
    const staged = await caps.stageAdversarialProposal({
      runId: RUN_ID,
      executionContext: undefined,
      candidateIds: ['rec-a'],
      upstream: { analysisStatus: 'done', curation: { curated: 1, deprecated: 0, complete: true } },
    })
    expect(staged).toEqual({ proposed: 2, skipped: 1 })
    const options = vi.mocked(runAdversarialVerb).mock.calls.at(-1)![1]
    // D-01's authority law, asserted on the ARGUMENT rather than on an outcome: a background
    // job may stage for review and may never admit, and `admit` is the one field that decides.
    expect(options.admit).toBeUndefined()
    expect(options.batch).toBeUndefined()
    expect(options.product).toBe(PRODUCT)
  })

  it('finishes an explicit no-op when no eval root is configured, and never loops', async () => {
    const store = committedStore(['rec-a'])
    stubEvalSession(store, { adversarial: { kind: 'refused', reason: 'no-eval-root', staged: [], skips: [], stagingSkips: [], refusals: [], settledRefusals: [] } })
    const caps = capabilities(store)
    expect(
      await caps.stageAdversarialProposal({
        runId: RUN_ID,
        executionContext: undefined,
        candidateIds: ['rec-a'],
        upstream: { analysisStatus: 'done', curation: { curated: 0, deprecated: 0, complete: true } },
      }),
    ).toEqual({ proposed: 0, skipped: 0 })
    expect(vi.mocked(runAdversarialVerb)).toHaveBeenCalledTimes(1)
  })

  it('refuses to hand the proposal stage a receipt the writer never acknowledged', async () => {
    const store = committedStore(['rec-a'])
    stubEvalSession(store, {
      replay: (candidateId) => ({
        kind: 'receipt',
        receipt: gate1Receipt(candidateId, 'pass'),
        recorded: 'lease-held',
        lines: [],
        notices: [],
        exit: 2,
      }),
    })
    const caps = capabilities(store, { leaseId: 'lease-x', epoch: 3 })
    await expect(
      caps.runReplayGate('rec-a' as Parameters<typeof caps.runReplayGate>[0]),
    ).rejects.toThrow(/rec-a/)
  })

  it('reads the operator override for the per-job Gate-1 cap, and the default when there is none', async () => {
    const store = committedStore([])
    stubEvalSession(store, { gate1MaxPerJob: 2 })
    expect(await resolveProposeGate1MaxPerJob('/tmp/422-09/agent-qa.config.yaml')).toBe(2)
    stubEvalSession(store)
    expect(await resolveProposeGate1MaxPerJob('/tmp/422-09/agent-qa.config.yaml')).toBeUndefined()
  })
})

// ---- THE PUMP -------------------------------------------------------------------------------

interface ProposalCheckpoint {
  readonly runId: string
  readonly candidateIds: readonly string[]
  readonly proposed?: number
  readonly skipped?: number
  readonly gate1?: ProposeGate1Report
}

describe('the third stage runs after the fold and reads back real receipts (422 D-13/D-14)', () => {
  async function drainChain(store: CommittedStore, foldCandidateIds: readonly string[]) {
    const root = tempRoot()
    const agentQaRoot = join(root, '.agent-qa')
    stubEvalSession(store)
    vi.mocked(createKnowledgeReader).mockReturnValue(
      readerOver(store) as unknown as ReturnType<typeof createKnowledgeReader>,
    )
    const caps = proposalStageCapabilities({
      configPath: join(root, 'agent-qa.config.yaml'),
      agentQaRoot,
      resolveKnowledgeRoot: () => join(root, 'knowledge'),
      resolveClaimAuthority: () => ({ leaseId: 'lease-pump', epoch: 5 }),
    })
    const host = composeLocalAgent({
      mintQuarantineIdentityPath: MINT_IDENTITY,
      agentQaRoot,
      config: TEST_CONFIG,
      knowledgeRoot: () => join(root, 'knowledge'),
      model: () => TEST_MODEL,
      idSource: DIGEST_JOB_ID_SOURCE,
      postRun: {
        candidateProse: 'masker-active',
        curateRun: async () => ({
          curated: 2,
          deprecated: 0,
          complete: true,
          candidateIds: [...foldCandidateIds],
        }),
        ...caps,
      },
    })
    hosts.push(host)
    const jobs = await host.jobs()
    const fence = await jobs.store.adoptEpoch(5)
    const chain = chainJobIdsForRun(RUN_ID, DIGEST_JOB_ID_SOURCE)
    await jobs.queue.enqueue(
      'curate-memory',
      { runId: RUN_ID, executionContext: 'local-headless' },
      String(chain.curateMemory),
    )
    const fold = await jobs.queue.runNextJob({ fence })
    const proposal = await jobs.queue.runNextJob({ fence })
    const read = await jobs.store.readCheckpoint(
      chain.proposeImprovements,
      'proposals-authored',
    )
    return {
      fold,
      proposal,
      chain,
      checkpoint: read.found ? (read.record.value as ProposalCheckpoint) : undefined,
    }
  }

  it('runs the fold FIRST and the proposal job second, on the fold-derived chain id', async () => {
    const store = committedStore(['rec-a', 'rec-b'])
    const { fold, proposal, chain } = await drainChain(store, ['rec-a', 'rec-b'])
    expect(fold.ran && String(fold.job.kind)).toBe('curate-memory')
    expect(proposal.ran && String(proposal.job.kind)).toBe('propose-improvements')
    expect(proposal.ran && String(proposal.job.id)).toBe(String(chain.proposeImprovements))
  })

  it('reads back candidate Gate-1 receipts and a concrete staged batch after the third job', async () => {
    const store = committedStore(['rec-a', 'rec-b'])
    const { checkpoint } = await drainChain(store, ['rec-a', 'rec-b'])
    expect(checkpoint?.gate1?.disposition).toBe('claimed')
    expect(checkpoint?.gate1?.reservedGate1).toEqual(['rec-a', 'rec-b'])
    expect(checkpoint?.gate1?.screenedGate1).toEqual([
      { candidateId: 'rec-a', verdict: 'pass' },
      { candidateId: 'rec-b', verdict: 'pass' },
    ])
    expect(checkpoint?.gate1?.interruptedGate1).toEqual([])
    // A CONCRETE batch, which is what distinguishes this record from the three waves of records
    // that said `proposals: {status: 'done'}` with no counts at all.
    expect(checkpoint?.proposed).toBe(2)
    expect(checkpoint?.skipped).toBe(1)
  })

  it('carries the fold receipt ids and the upstream curation counts through unchanged', async () => {
    const store = committedStore(['rec-a', 'rec-b'])
    const { checkpoint } = await drainChain(store, ['rec-b', 'rec-a'])
    expect(checkpoint?.runId).toBe(RUN_ID)
    // The order the FOLD reported, not a re-sort: the payload's ids are the work this run
    // committed, and the selection walks them before it sweeps the product.
    expect(checkpoint?.candidateIds).toEqual(['rec-b', 'rec-a'])
    expect(checkpoint?.gate1?.reservedGate1).toEqual(['rec-b', 'rec-a'])
    // The staging never admitted, so the committed corpus digest this attempt screened against
    // is the one it started from.
    const options = vi.mocked(runAdversarialVerb).mock.calls.at(-1)![1]
    expect(options.admit).toBeUndefined()
    expect(vi.mocked(readCanaryCorpusDigest).mock.results.every(
      (result) => (result.value as { corpusDigest?: string }).corpusDigest === CURRENT_DIGEST,
    )).toBe(true)
  })
})

// ---- THE FOLD'S OWN RECEIPT -----------------------------------------------------------------

describe('the fold forwards the ids its COMMITTED receipt names (422 D-13)', () => {
  function foldOperations(over: {
    readonly candidateIds: readonly string[]
    readonly refused?: number
  }) {
    const written: CurationTailReceipt[] = []
    const details = over.candidateIds.map((candidateId) => ({
      kind: 'fact' as const,
      candidateId,
      outcome: { kind: 'enqueued' as const },
    }))
    const operations = {
      runSafetyScope: (async (_options: unknown, body: () => Promise<void>) => await body()) as never,
      emitCurationCandidates: (() => ({
        details,
        refused: over.refused ?? 0,
        capExceeded: 0,
      })) as never,
      openKnowledgeReader: (() => ({ emitCanaryOutcome: () => undefined })) as never,
      emitCanaryOutcomes: (async () => ({
        refused: 0,
        unresolved: 0,
        canary: {},
        attributions: [],
      })) as never,
      foldRunOutcomes: (() => ({ kind: 'folded', quarantine: { kind: 'not-evaluated' } })) as never,
      drainQueue: (async () => ({
        kind: 'drained' as const,
        committed: over.candidateIds.length,
        deprecated: 0,
        failures: 0,
        requeued: 0,
        noops: 0,
        noopDetails: [],
      })) as never,
      readCurationTailReceipt: (() => undefined) as never,
      writeCurationTailReceipt: ((_runDir: string, receipt: CurationTailReceipt) => {
        written.push(receipt)
      }) as never,
      nudgeDaemon: (async () => undefined) as never,
      acquireWriterLease: (() => ({ kind: 'acquired', leaseId: 'l', epoch: 1 })) as never,
      releaseLease: (() => ({ kind: 'released' })) as never,
    }
    return { operations, written }
  }

  async function fold(over: { candidateIds: readonly string[]; refused?: number }) {
    const root = tempRoot()
    const { operations, written } = foldOperations(over)
    const report = await curateCompletedRun({
      runDir: join(root, 'runs', RUN_ID),
      handoff: { runId: RUN_ID, schemaVersion: 5, scope: { tier: 'product', key: PRODUCT } } as never,
      knowledgeRoot: join(root, 'knowledge'),
      agentQaRoot: join(root, '.agent-qa'),
      auditSink: {} as never,
      policy: {} as never,
      authority: { leaseId: 'l', epoch: 1 },
      log: { warn: () => undefined },
      operations,
    })
    return { report, written }
  }

  it('reports the receipt array itself, never a second projection of the emit report', async () => {
    const { report, written } = await fold({ candidateIds: ['rec-b', 'rec-a'] })
    expect(report.complete).toBe(true)
    expect(written).toHaveLength(1)
    // Identity with the COMMITTED bytes, which is the only claim a later reader can check. A
    // re-projection of the emit report would pass an equality assertion here and still be free
    // to drift from what the receipt says.
    expect(report.candidateIds).toEqual(written[0]!.candidateIds)
    expect(report.candidateIds).toEqual(['rec-a', 'rec-b'])
  })

  it('reports NO candidate ids at all when it wrote no receipt — absent, never empty', async () => {
    const { report, written } = await fold({ candidateIds: ['rec-a'], refused: 1 })
    expect(report.complete).toBe(false)
    expect(written).toEqual([])
    expect('candidateIds' in report).toBe(false)
  })
})
