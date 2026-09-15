import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LOCAL_CURATION_CAPABILITIES, DIGEST_JOB_ID_SOURCE, type ComposeLocalAgentInput } from '@vostride/agent-qa-agent-local'
import { asRecordId, asRunId, CurationSnapshotSchema } from '@vostride/agent-qa-schema'
import * as tailModule from '../curation-tail.js'
import { emptyCanaryCreditCounters } from '../canary-credit.js'
import { runPostRunTail, type PostRunTailHostInput, type PostRunTailOperations } from '../post-run-tail.js'
import { runDaemonHost, type DaemonHostOperations } from '../../daemon/host.js'
import { createInProcessFixture } from '../../composition/__tests__/in-process-run-fixture.js'

const roots: string[] = []
const RUN_ID = asRunId('synthetic-423-run')
const snapshot = CurationSnapshotSchema.parse({ schemaVersion: 1,
  rows: ['added', 'confirmed', 'superseded', 'deprecated', 'proposed'].map((bucket, i) => ({
    recordId: `record-${i}`, bucket, ...(bucket === 'superseded' ? { byRecordId: 'replacement' } : {}),
    changes: [{ bucket, change: { schemaVersion: 1, recordId: `record-${i}`,
      change: bucket === 'proposed' ? 'added' : bucket, atOrdinal: 42,
      sourceRunId: RUN_ID, observationId: `observation-${i}`,
      ...(bucket === 'superseded' ? { byRecordId: 'replacement' } : {}) } }],
  })), breakdown: { added: 1, confirmed: 1, superseded: 1, deprecated: 1, proposed: 1 } })
const malformedSnapshot = { ...snapshot, breakdown: { ...snapshot.breakdown, added: 20 } }
function tempRoot() { const root = mkdtempSync(join(tmpdir(), '423-curation-tail-')); roots.push(root); return root }
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function fixture(over: Record<string, unknown> = {}) {
  const root = tempRoot()
  const info = vi.fn()
  const drainQueue = vi.fn(async () => ({ kind: 'drained', committed: 9, deprecated: 2,
    failures: 0, requeued: 0, remaining: 0, noops: 0, noopDetails: [], snapshot, ...over }))
  const canaryDetail = { candidateId: asRecordId('canary'), testId: 'test', testIndex: 0,
    stepIndex: 1, benefit: 'positive', outcome: { kind: 'emitted' } }
  const operations = {
    runSafetyScope: async (_options: unknown, body: () => Promise<void>) => body(),
    emitCurationCandidates: () => ({ details: [], refused: 0, capExceeded: 0 }),
    openKnowledgeReader: () => ({ emitCanaryOutcome: () => undefined }),
    emitCanaryOutcomes: async () => ({ refused: 0, unresolved: 0, canary: emptyCanaryCreditCounters(), details: [canaryDetail] }),
    foldRunOutcomes: () => ({ kind: 'folded', quarantine: { kind: 'not-evaluated' } }),
    drainQueue,
  } as unknown as Partial<tailModule.CurationTailOperations>
  const input = { runDir: root, handoff: { runId: RUN_ID, schemaVersion: 5, buildOrdinal: 42,
    executionContext: 'local-headless', scope: { tier: 'product', key: 'storefront' } },
    knowledgeRoot: join(root, 'knowledge'), agentQaRoot: root, auditSink: {}, policy: {},
    authority: { leaseId: 'lease', epoch: 1 }, log: { warn: vi.fn(), info }, operations,
  } as unknown as tailModule.CurateCompletedRunInput
  return { root, input, drainQueue, info, canaryDetail }
}

describe('423 curation tail snapshot', () => {
  it('TAIL-SNAPSHOT-ROUNDTRIP persists exact rows and returns the immutable completed receipt after later effects', async () => {
    const f = fixture()
    const first = await tailModule.curateCompletedRun(f.input)
    expect(first).toHaveProperty('snapshot', snapshot)
    expect(tailModule.readCurationTailReceipt(f.root)).toHaveProperty('snapshot', snapshot)
    const before = readFileSync(join(f.root, tailModule.CURATION_TAIL_RECEIPT_FILE))
    f.drainQueue.mockImplementation(async () => { throw new Error('a completed run must not refold later effects') })
    const second = await tailModule.curateCompletedRun(f.input)
    expect(second).toHaveProperty('snapshot', snapshot)
    expect(f.drainQueue).toHaveBeenCalledTimes(1)
    expect(readFileSync(join(f.root, tailModule.CURATION_TAIL_RECEIPT_FILE)).equals(before)).toBe(true)
    expect(f.info).toHaveBeenCalledWith('curation: added 1, confirmed 1, superseded 1, deprecated 1, proposed 1')
  })

  it('TAIL-LEGACY-READ retains historical counters without minting a snapshot', async () => {
    const f = fixture({ snapshot: undefined })
    await tailModule.curateCompletedRun(f.input)
    const path = join(f.root, tailModule.CURATION_TAIL_RECEIPT_FILE)
    const legacy = { ...JSON.parse(readFileSync(path, 'utf8')), curated: 7, deprecated: 2 }
    delete legacy.snapshot
    writeFileSync(path, JSON.stringify(legacy))
    expect(tailModule.readCurationTailReceipt(f.root)).toMatchObject({ curated: 7, deprecated: 2 })
    expect(tailModule.readCurationTailReceipt(f.root)).not.toHaveProperty('snapshot')
  })

  it.each([{ failures: 1 }, { remaining: 1 }, { requeued: 1 }])('TAIL-INCOMPLETE with %j cannot publish completed counts', async (over) => {
    const f = fixture(over)
    expect(await tailModule.curateCompletedRun(f.input)).toMatchObject({ complete: false })
    expect(await tailModule.readCurationTailReceipt(f.root)).toBeUndefined()
  })

  it('TAIL-ATTRIBUTION passes exact run and emitted canary observation identities to the drain', async () => {
    const f = fixture()
    await tailModule.curateCompletedRun(f.input)
    expect(f.drainQueue).toHaveBeenCalledWith(expect.objectContaining({ sourceRunId: RUN_ID,
      observationIds: [LOCAL_CURATION_CAPABILITIES.canaryOutcomeObservationId({ ...f.canaryDetail, runId: RUN_ID })] }))
  })

  it('TAIL-VALIDATION omits a malformed supplied snapshot from the written receipt', async () => {
    const f = fixture({ snapshot: malformedSnapshot })
    await expect(tailModule.curateCompletedRun(f.input)).resolves.toMatchObject({ complete: true })
    const written = tailModule.readCurationTailReceipt(f.root)
    expect(written).toBeDefined()
    expect(written).not.toHaveProperty('snapshot')
    expect(readFileSync(join(f.root, tailModule.CURATION_TAIL_RECEIPT_FILE), 'utf8')).not.toContain('"snapshot"')
    const invalid = { ...written, snapshot: malformedSnapshot }
    expect(() => tailModule.defaultCurationTailOperations().writeCurationTailReceipt(f.root, invalid as never)).toThrow()
  })

  it.each([
    ['a malformed drain snapshot', { snapshot: malformedSnapshot }],
    ['a failed snapshot fold', { snapshot: undefined, snapshotFoldFailed: true }],
  ] as const)('TAIL-SNAPSHOT-DEGRADES completes on %s and records no snapshot', async (_label, over) => {
    const f = fixture(over)
    const writeCurationTailReceipt = vi.fn()
    const input = { ...f.input, operations: { ...f.input.operations,
      readCurationTailReceipt: () => undefined, writeCurationTailReceipt } } as tailModule.CurateCompletedRunInput
    const folded = tailModule.curateCompletedRun(input)
    await expect(folded).resolves.toMatchObject({ complete: true, drainKind: 'drained' })
    expect(await folded).not.toHaveProperty('snapshot')
    expect(writeCurationTailReceipt).toHaveBeenCalledTimes(1)
    expect(writeCurationTailReceipt.mock.calls[0]![1]).not.toHaveProperty('snapshot')
    const warn = f.input.log.warn as ReturnType<typeof vi.fn>
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(
      'curation snapshot could not be validated and was not recorded; committed bundles are unaffected')
    expect(String(warn.mock.calls[0]![0])).not.toMatch(/record-|observation-|replacement/)
  })

  it('CURATE-CAPABILITY-SNAPSHOT terminal preserves complete snapshot through the real tail adapter', async () => {
    const root = tempRoot()
    let bound: PostRunTailHostInput | undefined
    const folded = { curated: 9, deprecated: 2, complete: true, drainKind: 'drained' as const, candidateIds: [], snapshot }
    const operations = {
      loadCompletedRunHandoff: () => ({ runId: RUN_ID, schemaVersion: 5, executionContext: 'local-headless' }),
      resolveKnowledgeRoot: () => join(root, 'knowledge'),
      composeHost: (input: PostRunTailHostInput) => { bound = input; return {
        jobs: async () => ({ queue: { runNextJob: async () => ({ ran: false, reason: 'no-job' }),
          recoverAbandonedClaims: async () => ({ released: [] }) },
          store: { adoptEpoch: async () => ({ epoch: 7 }) }, idSource: DIGEST_JOB_ID_SOURCE }), close: async () => undefined } },
      acquireWriterLease: () => ({ kind: 'acquired', leaseId: 'lease-tail', epoch: 7 }),
      releaseLease: () => ({ kind: 'released' }), nudgeDaemon: async () => undefined,
      curateCompletedRun: async () => folded, runCurationTail: async () => undefined,
      createChipEmitter: () => ({ observe: () => undefined, finish: () => undefined }),
      readPostProcessingStatus: async () => ({ kind: 'ready' }), readRunDigest: async () => ({}), now: () => 1000,
    } as unknown as PostRunTailOperations
    await runPostRunTail({ runId: RUN_ID, agentQaRoot: root, configPath: join(root, 'agent-qa.config.yaml'),
      knowledgeConfig: { dir: 'knowledge' }, configDir: root, auditSink: {}, policy: {},
      log: { warn: () => undefined }, operations } as never).drain()
    expect(await bound!.curateRun({ runId: RUN_ID, executionContext: 'local-headless' })).toHaveProperty('snapshot', snapshot)
    expect(bound!.resolveClaimAuthority?.()).toBeUndefined()
  })

  it('CURATE-CAPABILITY-SNAPSHOT daemon preserves complete snapshot through its real bound capability', async () => {
    const defaultOperations = tailModule.defaultCurationTailOperations()
    vi.spyOn(tailModule, 'defaultCurationTailOperations').mockReturnValue({ ...defaultOperations,
      loadCompletedRunHandoff: (() => ({ runId: RUN_ID, schemaVersion: 5, buildOrdinal: 42,
        executionContext: 'local-headless', scope: { tier: 'product', key: 'storefront' } })) as never })
    vi.spyOn(tailModule, 'curateCompletedRun').mockResolvedValue({ curated: 9, deprecated: 2,
      complete: true, drainKind: 'drained', candidateIds: [], snapshot } as never)
    const daemon = await startDaemon()
    try {
      expect(await daemon.postRun().curateRun({ runId: RUN_ID, executionContext: 'local-headless' })).toHaveProperty('snapshot', snapshot)
      expect(daemon.postRun().candidateProse).toBe('no-masker')
    } finally { await daemon.stop() }
  })
})

const DAEMON_LEASE = { leaseId: 'lease-daemon', epoch: 41 }
const TEST_CONFIG = { getMasked: async () => ({ schemaVersion: 1, configPath: '/tmp/423.config.yaml', entries: [] }) }
const TEST_MODEL = { modelId: 'synthetic:test', generate: async () => { throw new Error('no provider work') } }
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
    policy: tailModule.defaultPostRunGuardrailPolicy(),
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
