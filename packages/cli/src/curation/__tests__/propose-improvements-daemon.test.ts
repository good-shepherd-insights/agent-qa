// THE DAEMON'S HALF OF THE PROPOSAL STAGE, AND THE PARITY BETWEEN THE TWO (422 plan 09, D-01/D-13/D-14).
//
// A CAPABILITY BOUND ON ONE HOST AND FORGOTTEN ON THE OTHER IS THE FAILURE THIS FILE EXISTS FOR.
// The terminal and the daemon are two ways of running the same product over the same durable
// queue: whichever holds the writer lease claims the row. So a proposal stage that screens on the
// terminal and no-ops on the daemon is not a smaller feature, it is a feature whose behaviour
// depends on a fact no user can see. 422-08's window named all three production hosts for exactly
// this reason, and every cell below is written so that binding one host and not the other fails.
//
// The parity claims are asserted by COMPARING THE TWO REAL HOSTS rather than by asserting a
// literal twice. A cell that restated the expected member set for each host would go green the
// moment somebody updated both restatements and neither binding.
//
// NOTHING HERE REACHES A PROVIDER, A SOCKET OR A NETWORK. The daemon is driven through
// `runDaemonHost`'s own injected operations table, and the eval session composition is
// substituted at its own exported seam.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { chainJobIdsForRun } from '@vostride/agent-qa-agent'
import type { ConfigReaderPort, JobModelCapability } from '@vostride/agent-qa-agent'
import { stampReceiptDigest } from '@vostride/agent-qa-schema'
import type {
  GateReceipt,
  GateVerdict,
  KnowledgeBundleSummary,
  KnowledgeGatesListResult,
} from '@vostride/agent-qa-schema'
import { defaultGuardrailPolicyInput, loadGuardrailPolicy } from '@vostride/agent-qa-safety'

vi.mock('@vostride/agent-qa-agent-local', async (original) => {
  const actual = await original<typeof import('@vostride/agent-qa-agent-local')>()
  return {
    ...actual,
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
  type ComposeLocalAgentInput,
  type LocalAgentHost,
} from '@vostride/agent-qa-agent-local'
import {
  readCanaryCorpusDigest,
  resolveEvalSession,
  runAdversarialVerb,
  runReplayGateVerb,
} from '../../eval-session-composition.js'

import { createInProcessFixture } from '../../composition/__tests__/in-process-run-fixture.js'
import { composeCliLocalAgent, proposalStageCapabilities } from '../../composition/local-agent-host.js'
import { runDaemonHost, type DaemonHostOperations } from '../../daemon/host.js'
import { createReplayGatePortForHost } from '../../gates/replay-gate-host.js'

const PRODUCT = 'storefront'
const CURRENT_DIGEST = 'c'.repeat(64)
const DAEMON_LEASE = { leaseId: 'lease-daemon', epoch: 41 }
const MINT_IDENTITY = (filePath: string): string => filePath

const TEST_MODEL: JobModelCapability = {
  modelId: 'test:422-09-propose-improvements-daemon',
  generate: async () => {
    throw new Error('the proposal stage authors nothing')
  },
}
const TEST_CONFIG: ConfigReaderPort = {
  getMasked: async () => ({ schemaVersion: 1, configPath: '/tmp/422-09d.config.yaml', entries: [] }),
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
    gateReceipts: async ({
      candidateId,
    }: {
      candidateId: string
    }): Promise<KnowledgeGatesListResult> => {
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

/** Every writer-lease call the Gate-1 write makes, so "acquires and releases nothing" is counted. */
interface LeaseCounters {
  acquires: number
  releases: number
}

function stubEvalSession(
  store: CommittedStore,
  leases: LeaseCounters,
  over: {
    readonly recorded?: 'appended' | 'duplicate' | 'lease-held' | 'lease-refused' | 'dry-run'
    readonly adversarial?: unknown
    readonly digest?: unknown
  } = {},
) {
  vi.mocked(resolveEvalSession).mockResolvedValue({
    evalConfig: {},
    configDir: '/tmp/422-09d',
    configPath: '/tmp/422-09d/agent-qa.config.yaml',
  } as unknown as Awaited<ReturnType<typeof resolveEvalSession>>)
  vi.mocked(readCanaryCorpusDigest).mockReturnValue(
    (over.digest ?? { kind: 'digest', corpusDigest: CURRENT_DIGEST }) as ReturnType<
      typeof readCanaryCorpusDigest
    >,
  )
  vi.mocked(runReplayGateVerb).mockImplementation((async (
    _session: unknown,
    candidateId: string,
    options: { claimAuthority?: { leaseId: string; epoch: number } },
  ) => {
    // THE BORROWED CONTRACT, COUNTED FROM INSIDE THE VERB. A borrowed call acquires nothing and
    // releases nothing; a standalone one does both. Counting here is what makes "no extra
    // acquire/release occurs inside inline Gate 1" a measurement rather than a promise.
    if (options.claimAuthority === undefined) {
      leases.acquires += 1
      leases.releases += 1
    }
    const recorded = over.recorded ?? 'appended'
    const receipt = gate1Receipt(candidateId, 'pass')
    if (recorded === 'appended' || recorded === 'duplicate') store.standing.set(candidateId, receipt)
    return { kind: 'receipt', receipt, recorded, lines: [], notices: [], exit: 0 }
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

/** One memoised bridge per host, the way both production hosts build theirs. */
function sharedGate(root: string, resolveClaimAuthority: () => { leaseId: string; epoch: number } | undefined) {
  let memo: ReturnType<typeof createReplayGatePortForHost> | undefined
  return () => (memo ??= createReplayGatePortForHost({
    configPath: join(root, 'agent-qa.config.yaml'),
    agentQaRoot: join(root, '.agent-qa'),
    resolveClaimAuthority,
  }))
}

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'agent-qa-422-09d-'))
  roots.push(root)
  return root
}

/**
 * Start the REAL daemon host over injected operations and capture what it composes.
 *
 * Everything substituted here is a boundary the daemon owns and this plan does not: the lease,
 * the recovery composition, the socket, the timers and the drain. What is NOT substituted is the
 * one thing under test — the `postRun` literal the daemon hands `composeLocalAgent`.
 */
async function startDaemon() {
  const fixture = createInProcessFixture({ origin: 'http://127.0.0.1:1', environment: 'local' })
  roots.push(fixture.project)
  const signals = new Map<NodeJS.Signals, () => void>()
  let composed: ComposeLocalAgentInput | undefined
  let started = false
  const operations = {
    acquireWriterLease: () => ({ kind: 'acquired', ...DAEMON_LEASE }),
    releaseLease: () => ({ kind: 'released' }),
    heartbeatLease: () => ({ kind: 'alive', holder: { ...DAEMON_LEASE, pid: process.pid } }),
    readWriterLease: () => ({ kind: 'free' }),
    composeJobRecovery: () => ({
      store: { adoptEpoch: async () => ({ epoch: DAEMON_LEASE.epoch }) },
      recoverAbandonedClaims: async () => ({ recovered: 0 }),
      close: vi.fn(),
    }),
    composeLocalAgent: (input: ComposeLocalAgentInput) => {
      composed = input
      return {
        registry: {},
        jobs: async () => ({
          queue: { runNextJob: async () => ({ ran: false, reason: 'no-job' }) },
        }),
        close: vi.fn(),
      }
    },
    reconcileRunOutcomesProjection: () => ({ kind: 'skipped' as const }),
    inspectDrainableCurationWork: () => ({
      queuedCandidateIds: [],
      recoverableClaimedCandidateIds: [],
    }),
    countRemainingCurationWork: () => ({ queued: 0, claimedNonterminal: 0, quarantined: 0 }),
    listQueuedCandidates: () => [],
    drainQueue: async () => ({ kind: 'drained', jobsProcessed: 0, committed: 0, failures: 0 }),
    runMaintenanceTail: async () => undefined,
    appendDrainSessionReceipt: () => undefined,
    setInterval: () => 1,
    clearInterval: () => undefined,
    setTimeout: () => 1,
    clearTimeout: () => undefined,
    onSignal: (signal: NodeJS.Signals, listener: () => void) => signals.set(signal, listener),
    offSignal: (signal: NodeJS.Signals) => signals.delete(signal),
    startHeartbeatSupervisor: async () => ({ exited: new Promise<void>(() => {}), stop: async () => undefined }),
    startInvokeServer: async (input: { socketPath: string }) => {
      started = true
      return { socketPath: input.socketPath, close: async () => undefined }
    },
  } as unknown as Partial<DaemonHostOperations>
  const running = runDaemonHost({
    agentQaRoot: fixture.agentQaRoot,
    knowledgeRoot: join(fixture.project, 'knowledge'),
    configPath: fixture.configPath,
    config: TEST_CONFIG,
    model: () => TEST_MODEL,
    author: () => async () => ({ kind: 'fallback-required' as const, reason: 'no-model' as const }),
    policy: loadGuardrailPolicy(defaultGuardrailPolicyInput),
    operations,
    logger: { info: () => undefined, error: () => undefined },
  } as unknown as Parameters<typeof runDaemonHost>[0])
  await vi.waitFor(() => expect(started).toBe(true))
  return {
    postRun: () => composed!.postRun!,
    async stop() {
      signals.get('SIGTERM')!()
      await running
    },
  }
}

/** Compose the terminal host the same way `runPostRunTail` does, and return its `postRun`. */
function terminalPostRun(resolveClaimAuthority?: () => { leaseId: string; epoch: number } | undefined) {
  const root = tempRoot()
  composeCliLocalAgent({
    configPath: join(root, 'agent-qa.config.yaml'),
    agentQaRoot: join(root, '.agent-qa'),
    confirm: undefined,
    config: TEST_CONFIG,
    model: () => TEST_MODEL,
    postRun: {
      candidateProse: 'masker-active',
      curateRun: async () => ({ curated: 0, deprecated: 0, complete: true, candidateIds: [] }),
      ...(resolveClaimAuthority === undefined ? {} : { resolveClaimAuthority }),
    },
  })
  return vi.mocked(composeLocalAgent).mock.calls.at(-1)![0].postRun!
}

describe('the daemon binds what the terminal binds (422 D-01/D-14)', () => {
  it('composes the same proposal capability set as the terminal, member for member', async () => {
    const store = committedStore(['rec-a'])
    stubEvalSession(store, { acquires: 0, releases: 0 })
    vi.mocked(createKnowledgeReader).mockReturnValue(
      readerOver(store) as unknown as ReturnType<typeof createKnowledgeReader>,
    )
    const daemon = await startDaemon()
    try {
      // Compared against the OTHER HOST rather than against a literal. Two restatements would
      // both have to be updated to go green, and the regression this guards against is exactly
      // the one where somebody updates one place.
      expect(Object.keys(daemon.postRun()).sort()).toEqual(Object.keys(terminalPostRun()).sort())
      expect(Object.keys(daemon.postRun()).sort()).toEqual([
        'candidateProse',
        'curateRun',
        'gateReceiptsFor',
        'listBundles',
        'proposeGate1MaxPerJob',
        'readProposeCorpusPosture',
        'runReplayGate',
        'stageAdversarialProposal',
      ])
    } finally {
      await daemon.stop()
    }
  })

  it('lends the lease it already holds and acquires or releases nothing inside Gate 1', async () => {
    const store = committedStore(['rec-a'])
    const leases: LeaseCounters = { acquires: 0, releases: 0 }
    stubEvalSession(store, leases)
    vi.mocked(createKnowledgeReader).mockReturnValue(
      readerOver(store) as unknown as ReturnType<typeof createKnowledgeReader>,
    )
    const daemon = await startDaemon()
    try {
      const postRun = daemon.postRun()
      await postRun.runReplayGate!('rec-a' as Parameters<NonNullable<typeof postRun.runReplayGate>>[0])
      const options = vi.mocked(runReplayGateVerb).mock.calls.at(-1)![2] as {
        claimAuthority?: { leaseId: string; epoch: number }
      }
      // The lease the daemon acquired at startup, not one it went and asked for: a holder that
      // re-acquires is told `held` by itself, and a holder that released would end its own
      // authority mid-drain.
      expect(options.claimAuthority).toEqual(DAEMON_LEASE)
      expect(leases).toEqual({ acquires: 0, releases: 0 })
    } finally {
      await daemon.stop()
    }
  })

  it('produces the same result DTO as the terminal for an equivalent fixture', async () => {
    const store = committedStore(['rec-a', 'rec-b'])
    stubEvalSession(store, { acquires: 0, releases: 0 })
    vi.mocked(createKnowledgeReader).mockReturnValue(
      readerOver(store) as unknown as ReturnType<typeof createKnowledgeReader>,
    )
    const daemon = await startDaemon()
    try {
      const args = {
        runId: 'r_422-09-parity',
        executionContext: undefined,
        candidateIds: ['rec-a'],
        upstream: {
          analysisStatus: 'done' as const,
          curation: { curated: 1, deprecated: 0, complete: true as const },
        },
      }
      const terminal = terminalPostRun()
      expect(await daemon.postRun().stageAdversarialProposal!(args)).toEqual(
        await terminal.stageAdversarialProposal!(args),
      )
      expect(await daemon.postRun().readProposeCorpusPosture!({ product: PRODUCT })).toEqual(
        await terminal.readProposeCorpusPosture!({ product: PRODUCT }),
      )
      expect(await daemon.postRun().listBundles!()).toEqual(await terminal.listBundles!())
      // The CAP is data, and both hosts read it from the same resolver over their own config.
      expect(await daemon.postRun().proposeGate1MaxPerJob!()).toEqual(
        await terminal.proposeGate1MaxPerJob!(),
      )
    } finally {
      await daemon.stop()
    }
  })

  it('degrades both hosts identically on a missing and on an unreadable eval root', async () => {
    const store = committedStore(['rec-a'])
    const leases: LeaseCounters = { acquires: 0, releases: 0 }
    stubEvalSession(store, leases, {
      adversarial: {
        kind: 'refused',
        reason: 'no-eval-root',
        staged: [],
        skips: [],
        stagingSkips: [],
        refusals: [],
        settledRefusals: [],
      },
      digest: { kind: 'no-eval-root' },
    })
    vi.mocked(createKnowledgeReader).mockReturnValue(
      readerOver(store) as unknown as ReturnType<typeof createKnowledgeReader>,
    )
    const daemon = await startDaemon()
    try {
      const args = {
        runId: 'r_422-09-no-root',
        executionContext: undefined,
        candidateIds: ['rec-a'],
        upstream: {
          analysisStatus: 'done' as const,
          curation: { curated: 0, deprecated: 0, complete: true as const },
        },
      }
      const terminal = terminalPostRun()
      // An explicit no-op that FINISHES. A throw here would become a retry asking the same
      // unanswerable question under the same conditions until the declared bound ran out.
      expect(await daemon.postRun().stageAdversarialProposal!(args)).toEqual({
        proposed: 0,
        skipped: 0,
      })
      expect(await daemon.postRun().readProposeCorpusPosture!({ product: PRODUCT })).toEqual({
        kind: 'no-root',
      })
      expect(await terminal.readProposeCorpusPosture!({ product: PRODUCT })).toEqual({
        kind: 'no-root',
      })
      vi.mocked(readCanaryCorpusDigest).mockReturnValue({
        kind: 'unavailable',
        reason: 'corpus-unreadable',
      } as ReturnType<typeof readCanaryCorpusDigest>)
      // UNREADABLE is not ABSENT: a root this build cannot read completes the stage
      // `posture-unavailable`, which is a report and not a retry.
      for (const host of [daemon.postRun(), terminal]) {
        expect(await host.readProposeCorpusPosture!({ product: PRODUCT })).toEqual({
          kind: 'unavailable',
          reason: 'corpus-unreadable',
        })
      }
    } finally {
      await daemon.stop()
    }
  })
})

describe('the borrowed lease is read at the claim, and a refused write is never a receipt', () => {
  function capabilities(store: CommittedStore, resolve: () => { leaseId: string; epoch: number } | undefined) {
    const root = tempRoot()
    vi.mocked(createKnowledgeReader).mockReturnValue(
      readerOver(store) as unknown as ReturnType<typeof createKnowledgeReader>,
    )
    return proposalStageCapabilities({
      configPath: join(root, 'agent-qa.config.yaml'),
      agentQaRoot: join(root, '.agent-qa'),
      resolveKnowledgeRoot: () => join(root, 'knowledge'),
      replayGate: sharedGate(root, resolve),
    })
  }

  it('carries the epoch as it stands at each call, never the one composition saw', async () => {
    const store = committedStore(['rec-a', 'rec-b'])
    const leases: LeaseCounters = { acquires: 0, releases: 0 }
    stubEvalSession(store, leases)
    let current: { leaseId: string; epoch: number } | undefined
    const caps = capabilities(store, () => current)
    current = { leaseId: 'lease-1', epoch: 3 }
    await caps.runReplayGate('rec-a' as Parameters<typeof caps.runReplayGate>[0])
    // The epoch moved between two claims — a reclaim, a restart, another writer. The second call
    // must carry the CURRENT one: a captured value would keep writing under an epoch the store
    // has already retired.
    current = { leaseId: 'lease-2', epoch: 9 }
    await caps.runReplayGate('rec-b' as Parameters<typeof caps.runReplayGate>[0])
    const [first, second] = vi.mocked(runReplayGateVerb).mock.calls.map(
      (call) => (call[2] as { claimAuthority?: { leaseId: string; epoch: number } }).claimAuthority,
    )
    expect(first).toEqual({ leaseId: 'lease-1', epoch: 3 })
    expect(second).toEqual({ leaseId: 'lease-2', epoch: 9 })
    expect(leases).toEqual({ acquires: 0, releases: 0 })
  })

  it('refuses a receipt the writer would not take, and releases nothing it never acquired', async () => {
    const store = committedStore(['rec-a'])
    const leases: LeaseCounters = { acquires: 0, releases: 0 }
    stubEvalSession(store, leases, { recorded: 'lease-refused' })
    const caps = capabilities(store, () => ({ leaseId: 'lease-stale', epoch: 1 }))
    await expect(
      caps.runReplayGate('rec-a' as Parameters<typeof caps.runReplayGate>[0]),
    ).rejects.toThrow(/rec-a/)
    expect(store.standing.size).toBe(0)
    expect(leases).toEqual({ acquires: 0, releases: 0 })
  })
})

describe('a repeated daemon drain spends nothing it already spent (422 D-14/D-15)', () => {
  async function pump(store: CommittedStore, runId: string, agentQaRoot: string) {
    const root = agentQaRoot
    const caps = proposalStageCapabilities({
      configPath: join(root, '..', 'agent-qa.config.yaml'),
      agentQaRoot: root,
      resolveKnowledgeRoot: () => join(root, 'knowledge'),
      replayGate: sharedGate(join(root, '..'), () => DAEMON_LEASE),
    })
    const host = composeLocalAgent({
      mintQuarantineIdentityPath: MINT_IDENTITY,
      agentQaRoot: root,
      config: TEST_CONFIG,
      knowledgeRoot: () => join(root, 'knowledge'),
      model: () => TEST_MODEL,
      idSource: DIGEST_JOB_ID_SOURCE,
      postRun: {
        // The daemon's own declared posture: it folds with no masker, so the kind that folds is
        // unclaimable for it and only the third stage is pumped here.
        candidateProse: 'no-masker',
        curateRun: async () => ({ curated: 0, deprecated: 0, complete: true, candidateIds: [] }),
        ...caps,
      },
    })
    hosts.push(host)
    const jobs = await host.jobs()
    const fence = await jobs.store.adoptEpoch(DAEMON_LEASE.epoch)
    const chain = chainJobIdsForRun(runId, DIGEST_JOB_ID_SOURCE)
    const payload = {
      runId,
      candidateIds: ['rec-a', 'rec-b'],
      upstream: {
        analysisStatus: 'done' as const,
        curation: { curated: 2, deprecated: 0, complete: true },
      },
    }
    const key = `${String(chain.curateMemory)}->propose-improvements`
    const first = await jobs.queue.enqueue('propose-improvements', payload, key)
    const again = await jobs.queue.enqueue('propose-improvements', payload, key)
    const outcome = await jobs.queue.runNextJob({ fence })
    const read = await jobs.store.readCheckpoint(chain.proposeImprovements, 'proposals-authored')
    await host.close()
    hosts.splice(hosts.indexOf(host), 1)
    return {
      first,
      again,
      outcome,
      chain,
      report: read.found
        ? (read.payload as { value: { gate1?: { reservedGate1: readonly string[] } } }).value.gate1
        : undefined,
    }
  }

  it('dedupes the third id and lets standing receipts suppress a second replay', async () => {
    const store = committedStore(['rec-a', 'rec-b'])
    stubEvalSession(store, { acquires: 0, releases: 0 })
    vi.mocked(createKnowledgeReader).mockReturnValue(
      readerOver(store) as unknown as ReturnType<typeof createKnowledgeReader>,
    )
    const root = tempRoot()
    const agentQaRoot = join(root, '.agent-qa')
    const one = await pump(store, 'r_422-09-daemon-a', agentQaRoot)
    expect(one.first.deduped).toBe(false)
    // The same derived key twice is ONE row. A second row would be a second charge against the
    // same corpus for the same run.
    expect(one.again.deduped).toBe(true)
    expect(String(one.again.job.id)).toBe(String(one.first.job.id))
    expect(one.report?.reservedGate1).toEqual(['rec-a', 'rec-b'])
    expect(vi.mocked(runReplayGateVerb)).toHaveBeenCalledTimes(2)

    // A LATER run's proposal job over the SAME committed corpus. Both candidates now carry a
    // standing Gate-1 line at the current digest, so the selection admits neither and the port
    // is never entered — the suppression is a property of the selection, not of a counter.
    const two = await pump(store, 'r_422-09-daemon-b', agentQaRoot)
    expect(two.report?.reservedGate1).toEqual([])
    expect(vi.mocked(runReplayGateVerb)).toHaveBeenCalledTimes(2)
  })
})
