import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { calibrateLabels, canonicalJson } from '@vostride/agent-qa-eval'
import { sha256hex } from '@vostride/agent-qa-schema'
import { defaultGuardrailPolicyInput, loadGuardrailPolicy } from '@vostride/agent-qa-safety'
import type { ComposeLocalAgentInput } from '@vostride/agent-qa-agent-local'
import { LOCAL_CURATION_CAPABILITIES } from '@vostride/agent-qa-agent-local'
import { createInProcessFixture } from '../../composition/__tests__/in-process-run-fixture.js'
import { MAINTENANCE_CADENCE_MS, runDaemonHost, type DaemonHostOperations } from '../host.js'

vi.mock('@vostride/agent-qa-eval-local', async original => {
  const actual = await original<typeof import('@vostride/agent-qa-eval-local')>()
  return { ...actual, readLabelCalibration: vi.fn(actual.readLabelCalibration) }
})
vi.mock('@vostride/agent-qa-agent-local', async original => {
  const actual = await original<typeof import('@vostride/agent-qa-agent-local')>()
  return { ...actual, LOCAL_CURATION_CAPABILITIES: { ...actual.LOCAL_CURATION_CAPABILITIES,
    openKnowledgeReader: vi.fn(actual.LOCAL_CURATION_CAPABILITIES.openKnowledgeReader),
    drainQueue: vi.fn(actual.LOCAL_CURATION_CAPABILITIES.drainQueue),
  } }
})
import { readLabelCalibration } from '@vostride/agent-qa-eval-local'

const roots: string[] = []
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function artifact(root: string, precision = 0.75) {
  const report = calibrateLabels({ snapshot: { entries: [], labelsById: new Map(), cassettesById: new Map(), blobPresentById: new Map() }, marks: [] })
  const body = { ...report, schemaVersion: 1, evidenceDigest: sha256hex('daemon fixture'), targetRevisions: [],
    channels: { ...report.channels, 'recorded-verdict': { status: 'calibrated', n: 20, n_gold: 20, precision, wilson95: { lower: 0.1, upper: 0.9, halfWidth: 0.4 } } },
    priors: { 'agent-verified': { alpha: precision * 3, beta: (1 - precision) * 3 } } }
  const value = { ...body, generationId: sha256hex(canonicalJson(body)) }
  const path = join(root, 'agent-qa-eval/labels/calibration.json')
  mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(value))
  return value
}

function project() {
  const f = createInProcessFixture({ origin: 'http://127.0.0.1:1', environment: 'local' })
  roots.push(f.project)
  return f
}

async function start(f: ReturnType<typeof project>, legacy = false) {
  const signals = new Map<NodeJS.Signals, () => void>()
  const timers = new Map<number, () => void>()
  const receipts: unknown[] = []
  const errors: string[] = []
  let hostInput: ComposeLocalAgentInput | undefined
  let server: Parameters<DaemonHostOperations['startInvokeServer']>[0] | undefined
  let queued = 0
  const model = { modelId: 'test:trust-prior-daemon', generate: vi.fn(async () => { throw new Error('unexpected model call') }) }
  const author = vi.fn(async () => ({ kind: 'fallback-required' as const, reason: 'no-model' as const }))
  const authorFactory = vi.fn(() => author)
  const drainQueue = vi.fn<DaemonHostOperations['drainQueue']>(async () => {
    queued = 0
    return { kind: 'drained', jobsProcessed: 1, committed: 1, failures: 0, quarantined: 0, remaining: 0, remainingWork: { queued: 0, claimedNonterminal: 0, quarantined: 0 } } as Awaited<ReturnType<DaemonHostOperations['drainQueue']>>
  })
  const runMaintenanceTail = vi.fn<DaemonHostOperations['runMaintenanceTail']>(async () => undefined as never)
  const operations = {
    composeJobRecovery: () => ({ store: { adoptEpoch: async () => ({ epoch: 1 }) }, recoverAbandonedClaims: async () => ({ recovered: 0 }), close: vi.fn() }),
    composeLocalAgent: (input: ComposeLocalAgentInput) => {
      hostInput = input
      return { registry: {}, jobs: async () => ({ queue: { runNextJob: async () => ({ ran: false, reason: 'no-job' }) } }), close: vi.fn() }
    },
    inspectDrainableCurationWork: () => ({ queuedCandidateIds: queued ? [sha256hex('candidate')] : [], recoverableClaimedCandidateIds: [] }),
    countRemainingCurationWork: () => ({ queued, claimedNonterminal: 0, quarantined: 0 }),
    listQueuedCandidates: () => queued ? [sha256hex('candidate')] : [],
    drainQueue, runMaintenanceTail,
    appendDrainSessionReceipt: (_root: string, receipt: unknown) => receipts.push(receipt),
    setInterval: (callback: () => void, interval: number) => { timers.set(interval, callback); return interval },
    clearInterval: () => undefined, setTimeout: () => 1, clearTimeout: () => undefined,
    onSignal: (signal: NodeJS.Signals, listener: () => void) => signals.set(signal, listener),
    offSignal: (signal: NodeJS.Signals) => signals.delete(signal),
    startHeartbeatSupervisor: async () => ({ exited: Promise.resolve(), stop: async () => undefined }),
    startInvokeServer: async (input: Parameters<DaemonHostOperations['startInvokeServer']>[0]) => { server = input; return { socketPath: input.socketPath, close: async () => undefined } },
  } as unknown as Partial<DaemonHostOperations>
  const running = runDaemonHost({ agentQaRoot: f.agentQaRoot, knowledgeRoot: join(f.project, 'knowledge'),
    ...(legacy ? {} : { configPath: f.configPath }),
    config: { getMasked: async () => ({ schemaVersion: 1, configPath: f.configPath, entries: [] }) },
    model: () => model, author: authorFactory, policy: loadGuardrailPolicy(defaultGuardrailPolicyInput), operations,
    logger: { info: vi.fn(), error: message => errors.push(message) } })
  await vi.waitFor(() => expect(server).toBeDefined())
  return { input: hostInput!, authorFactory, model, drainQueue, runMaintenanceTail, errors,
    async drain() { queued = 1; const before = receipts.length; await server!.onNudge!({ kind: 'candidates-enqueued', requireReceipt: true }); await vi.waitFor(() => expect(receipts.length).toBe(before + 1)) },
    async maintenance() { const before = runMaintenanceTail.mock.calls.length; timers.get(MAINTENANCE_CADENCE_MS)!(); await vi.waitFor(() => expect(runMaintenanceTail).toHaveBeenCalledTimes(before + 1)) },
    async stop() { signals.get('SIGTERM')!(); expect(await running).toBe(0); expect(model.generate).not.toHaveBeenCalled() },
  }
}

it('keeps one daemon prior snapshot across two drains, review composition and maintenance until a fresh host', async () => {
  const f = project(); const old = artifact(f.project)
  const first = await start(f)
  try {
    expect(first.authorFactory).not.toHaveBeenCalled()
    await first.drain()
    artifact(f.project, 0.25)
    await first.drain(); await first.maintenance()
    expect(first.input.resolveTrustPriors?.()).toEqual(old.priors)
    for (const [input] of first.drainQueue.mock.calls) {
      expect(input.priors).toBe(first.input.resolveTrustPriors?.())
      expect(input.priors).toEqual(old.priors)
      expect(input.lease).toEqual(await first.input.resolveWriterAuthority!())
    }
    expect(first.runMaintenanceTail.mock.calls[0]![0].priors).toBe(first.input.resolveTrustPriors?.())
    expect(first.authorFactory).toHaveBeenCalledTimes(1)
    expect(readLabelCalibration).toHaveBeenCalledTimes(1)
    expect(first.errors).toHaveLength(2)
    for (const error of first.errors) expect(error).toMatch(/^curation: posture unavailable: noise-floor:/)
  } finally { await first.stop() }
  const second = await start(f)
  try { expect(second.input.resolveTrustPriors?.()).toEqual(artifact(f.project, 0.25).priors); expect(readLabelCalibration).toHaveBeenCalledTimes(2) }
  finally { await second.stop() }
})

it('forwards the daemon snapshot into the actual in-process run producer', async () => {
  const f = project(); const old = artifact(f.project)
  const run = await import('../../commands/run.js')
  const producer = vi.spyOn(run, 'produceMembersFromPatterns').mockRejectedValue(new Error('captured producer boundary'))
  const host = await start(f)
  try {
    artifact(f.project, 0.25)
    await expect(host.input.runExecution!.execute({ patterns: [f.testPattern] })).rejects.toThrow('captured producer boundary')
    expect(producer.mock.calls[0]![0].resolveTrustPriors?.()).toEqual(old.priors)
    expect(producer.mock.calls[0]![0].resolveTrustPriors).toBe(host.input.resolveTrustPriors)
    expect(readLabelCalibration).toHaveBeenCalledTimes(1)
  } finally { await host.stop() }
})

it('refuses malformed calibration before acquiring the daemon writer lease', async () => {
  const f = project(); artifact(f.project)
  writeFileSync(join(f.project, 'agent-qa-eval/labels/calibration.json'), '{"private":"bad"}')
  const acquire = vi.fn(() => { throw new Error('authority acquisition reached') })
  await expect(runDaemonHost({ agentQaRoot: f.agentQaRoot, knowledgeRoot: join(f.project, 'knowledge'), configPath: f.configPath,
    config: { getMasked: async () => ({ schemaVersion: 1, configPath: f.configPath, entries: [] }) },
    model: async () => { throw new Error('unexpected model') }, operations: { acquireWriterLease: acquire } })).rejects.toThrow('Trust prior calibration is invalid or unavailable')
  expect(acquire).not.toHaveBeenCalled()
})

it('hands the cached table into the real completed-run reader and drain under the daemon lease', async () => {
  const { markFixture } = await import('../../gates/__tests__/feedback-fixture.js')
  const marked = markFixture(); roots.push(marked.root)
  const f = { ...project(), project: marked.root, configPath: marked.configPath, agentQaRoot: marked.agentQaRoot }
  const old = artifact(f.project)
  const reader = vi.mocked(LOCAL_CURATION_CAPABILITIES.openKnowledgeReader)
  const drain = vi.mocked(LOCAL_CURATION_CAPABILITIES.drainQueue)
  const host = await start(f)
  try {
    artifact(f.project, 0.25)
    await host.input.postRun!.curateRun!({ runId: marked.handoff.runId, executionContext: 'local-headless' })
    const readerInput = reader.mock.calls.at(-1)![0] as unknown as { priors?: unknown }
    expect(readerInput.priors).toEqual(old.priors)
    expect(drain.mock.calls.at(-1)![0].priors).toBe(host.input.resolveTrustPriors?.())
    expect(drain.mock.calls.at(-1)![0].lease).toEqual(await host.input.resolveWriterAuthority!())
    expect(readLabelCalibration).toHaveBeenCalledTimes(1)
  } finally { await host.stop() }
})

it('preserves default priors and no calibration read for a legacy daemon without configPath', async () => {
  const f = project(); artifact(f.project)
  const host = await start(f, true)
  try { await host.drain(); await host.maintenance(); expect(host.input.resolveTrustPriors?.()).toBeUndefined(); expect(readLabelCalibration).not.toHaveBeenCalled() }
  finally { await host.stop() }
})

it.each([false, true])('daemon selects request B priors before the producer (malformed=%s)', async malformed => {
  const a = project(), b = project()
  const old = artifact(a.project), selected = artifact(b.project, 0.25)
  if (malformed) writeFileSync(join(b.project, 'agent-qa-eval/labels/calibration.json'), '{"private":"invalid B"}')
  const run = await import('../../commands/run.js')
  const producer = vi.spyOn(run, 'produceMembersFromPatterns').mockRejectedValue(new Error('captured producer boundary'))
  const host = await start(a)
  try {
    artifact(a.project, 0.5)
    await expect(host.input.runExecution!.execute({ configPath: b.configPath, patterns: [b.testPattern] }))
      .rejects.toThrow(malformed ? 'Trust prior calibration is invalid or unavailable' : 'captured producer boundary')
    expect(readLabelCalibration).toHaveBeenCalledTimes(2)
    if (malformed) expect(producer).not.toHaveBeenCalled()
    else {
      expect(producer.mock.calls[0]![0].inputs.configFilePath).toBe(b.configPath)
      expect(producer.mock.calls[0]![0].resolveTrustPriors?.()).toEqual(selected.priors)
      expect(producer.mock.calls[0]![0].resolveTrustPriors).not.toBe(host.input.resolveTrustPriors)
    }
    expect(host.input.resolveTrustPriors?.()).toEqual(old.priors)
    await expect(host.input.runExecution!.execute({ patterns: [a.testPattern] })).rejects.toThrow('captured producer boundary')
    expect(producer.mock.calls.at(-1)![0].resolveTrustPriors).toBe(host.input.resolveTrustPriors)
    expect(readLabelCalibration).toHaveBeenCalledTimes(2)
  } finally { await host.stop() }
})
