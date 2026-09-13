import { afterEach, expect, it, vi } from 'vitest'
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { asRecordId, computeBriefDigest, guardCompletedRunHandoff, canonicalJson, sha256hex } from '@vostride/agent-qa-schema'
import type { RunSession, ServedBrief, StepEvidence } from '@vostride/agent-qa-schema'
import { runInProcessCliRun } from '../../composition/in-process-run-execution.js'
import { createInProcessFixture } from '../../composition/__tests__/in-process-run-fixture.js'
import { composeCliLocalAgent } from '../../composition/local-agent-host.js'
import { prepareMisdirectionEvidence } from '../misdirection-tail.js'
import { readMisdirectionRunState } from '../misdirection-run-state.js'
import { DRAIN_BUDGET_MS } from '@vostride/agent-qa-agent-local'
import { generateRunId } from '@vostride/agent-qa-ids'
import { ownPostVerdictContinuation, postVerdictPendingPath } from '../post-verdict-continuation.js'
import { runPostRunTail } from '../post-run-tail.js'
import { defaultPostRunGuardrailPolicy } from '../curation-tail.js'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createPostVerdictStep } from '../post-verdict-step.js'
import { recoverPendingPostVerdictContinuations } from '../post-verdict-continuation.js'
import { CURATION_QUEUE_POLL_MS, runDaemonHost, type DaemonHostOperations } from '../../daemon/host.js'
import type { MisdirectionPreparationCapabilities, MisdirectionArbiterPort } from '../misdirection-tail.js'

const roots: string[] = []
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

it.each(['settles', 'host deadline expires'] as const)('retains host ownership after the real runner timeout until evidence-bound analysis exists: %s', async (mode) => {
  const fixture = createInProcessFixture({ origin: 'http://127.0.0.1:1', environment: 'local' })
  roots.push(fixture.project)
  const fetchTrap = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('provider forbidden'))
  const release = deferred<void>()
  const reserved = deferred<void>()
  const checked = vi.fn(async () => {
    reserved.resolve()
    await release.promise
    return { kind: 'checked' as const, crossCheck: 'held' as const, seedHonored: true,
      samples: { k: 1, seeds: [11], modelCalls: 0 } }
  })
  const brief: ServedBrief = {
    scope: { tier: 'product', key: fixture.targetName }, asOfBuild: 1, budget: 1000,
    truncation: 'none', channel1: [{ id: asRecordId(`rec-${sha256hex(fixture.directTestId)}`), kind: 'fact',
      summary: 'checkout candidate', trust: 0.5, status: 'candidate', servedAsCanary: false, tier: 'L1' }],
    channel2: [], channel3: [], briefDigest: '',
  }
  const evidence: StepEvidence = { stepIndex: 0, stepText: 'Open checkout', cacheStatus: 'miss',
    servedBrief: { ...brief, briefDigest: computeBriefDigest(brief) }, subActions: [],
    verifierVerdict: { pass: false, reasoning: 'checkout remains closed' } }
  let session!: RunSession
  let hostSettled = false
  let runnerSettled = false
  let dispose!: ReturnType<typeof vi.spyOn>
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  const running = runInProcessCliRun({
    configPath: fixture.configPath, agentQaRoot: fixture.agentQaRoot,
    executionContext: 'local-headless', trust: { trustMode: true },
    onSession: (value) => { session = value; void value.done.then(() => { runnerSettled = true }) },
    produceMembers: async () => ({
      members: [{ testId: fixture.directTestId, name: 'checkout', filePath: 'tests/direct.yaml' }],
      executor: async () => ({ name: 'checkout', filePath: 'tests/direct.yaml', status: 'failed',
        duration: 1, steps: [{ name: 'Open checkout', status: 'failed', duration: 1, evidence }] }),
      configDigests: { suiteConfigDigest: 'suite', testConfigDigest: 'test' },
      product: fixture.targetName, configDir: fixture.project, configFilePath: fixture.configPath,
      knowledgeRoot: join(fixture.project, 'knowledge'), targetClass: 'local',
      targetNames: [fixture.targetName], memberProbeUrls: [],
      bindRunContext: ({ maskingContext }) => { dispose = vi.spyOn(maskingContext, 'dispose') }, applyAssembly: () => undefined,
      bindSession: () => undefined, takeFrameworkError: () => undefined,
      getCurationModelDeps: () => undefined,
    }),
    postProcessing: { misdirection: { prepareMisdirectionEvidence: (input) =>
      prepareMisdirectionEvidence({ ...input, arbiter: {
        rootPosture: async () => ({ kind: 'eval-root', corpusDigest: 'c'.repeat(64), profileDigest: 'd'.repeat(64) }),
        resolveCaps: async () => ({ maxChecks: 1, source: 'default' }),
        locate: async () => ({ kind: 'located', decisionOrdinal: 0 }), check: checked,
      } }) } },
    afterVerdict: () => { hostSettled = true; return 1 },
  }, { patterns: [fixture.testPattern] })
  try {
    await reserved.promise
    const runDir = join(fixture.agentQaRoot, 'runs', String(session.id))
    expect(readMisdirectionRunState(runDir, String(session.id)).reservations).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(5001)
    expect(runnerSettled).toBe(true)
    expect(hostSettled, 'the host must retain the still-pending preparation after runner.done').toBe(false)
    expect(existsSync(join(runDir, 'post-verdict-pending.json'))).toBe(true)
    expect(guardCompletedRunHandoff(JSON.parse(readFileSync(join(runDir, 'handoff.json'), 'utf8'))).misdirectionEvidence).toBeUndefined()
    if (mode === 'host deadline expires') {
      await vi.advanceTimersByTimeAsync(DRAIN_BUDGET_MS + 1)
      const pending = await running
      expect(hostSettled).toBe(true)
      expect(pending.settled).toBeDefined()
      expect(dispose).not.toHaveBeenCalled()
      expect(existsSync(join(runDir, 'post-verdict-pending.json.owner', 'owner.json'))).toBe(true)
    }
    release.resolve()
    const outcome = await running
    await outcome.settled
    expect(outcome.exitCode).toBe(1)
    expect(checked).toHaveBeenCalledTimes(1)
    expect(fetchTrap).not.toHaveBeenCalled()
    const final = guardCompletedRunHandoff(JSON.parse(readFileSync(join(runDir, 'handoff.json'), 'utf8')))
    expect(final.misdirectionEvidence).toHaveLength(1)
    const host = composeCliLocalAgent({ agentQaRoot: fixture.agentQaRoot, configPath: fixture.configPath })
    try {
      const jobs = await host.jobs()
      const rows = (await jobs.store.dumpState()).jobs.filter((row) => row.kind === 'analyze-run')
      expect(rows).toHaveLength(1)
      expect(rows[0]!.payload).toMatchObject({ handoffDigest: sha256hex(canonicalJson(final)),
        misdirectionEvidence: final.misdirectionEvidence })
    } finally { await host.close() }
    expect(existsSync(join(runDir, 'post-verdict-pending.json'))).toBe(false)
    expect(dispose).toHaveBeenCalledTimes(1)
  } finally {
    release.resolve()
    await running
  }
}, 30_000)

function continuationFixture() {
  const fixture = createInProcessFixture({ origin: 'http://127.0.0.1:1', environment: 'local' })
  roots.push(fixture.project)
  const input = { ...fixture, runId: generateRunId(), knowledgeRoot: join(fixture.project, 'knowledge') }
  const runDir = join(input.agentQaRoot, 'runs', input.runId)
  mkdirSync(runDir, { recursive: true })
  const handoffPath = join(runDir, 'handoff.json')
  const brief: ServedBrief = { scope: { tier: 'product', key: fixture.targetName }, asOfBuild: 1,
    budget: 1000, truncation: 'none', channel1: [{ id: asRecordId(`rec-${sha256hex(fixture.directTestId)}`),
      kind: 'fact', summary: 'checkout candidate', trust: 0.5, status: 'candidate', servedAsCanary: false, tier: 'L1' }],
    channel2: [], channel3: [], briefDigest: '' }
  writeFileSync(handoffPath, JSON.stringify(guardCompletedRunHandoff({
    schemaVersion: 7, runId: input.runId, scope: { tier: 'product', key: fixture.targetName },
    buildOrdinal: 1, executionContext: 'local-headless', aggregateVerdict: 'failed',
    configDigests: { suiteConfigDigest: 'suite', testConfigDigest: 'test' }, startedAt: 1, endedAt: 2,
    tests: [{ testId: fixture.directTestId, testName: 'checkout', filePath: 'tests/direct.yaml',
      testIndex: 0, outcome: 'failed', steps: [{ stepIndex: 0, stepText: 'Open checkout', cacheStatus: 'miss',
        servedBrief: { ...brief, briefDigest: computeBriefDigest(brief) }, subActions: [],
        verifierVerdict: { pass: false, reasoning: 'checkout remains closed' } }] }],
  })))
  const pendingPath = postVerdictPendingPath(input)
  let queued = false
  const prepare = vi.fn(async () => undefined)
  const enqueue = vi.fn(async () => { queued = true; return 'enqueued' as const })
  return { input, runDir, handoffPath, pendingPath, prepare, enqueue,
    own: (over: Partial<Parameters<typeof ownPostVerdictContinuation>[0]> = {}) =>
      ownPostVerdictContinuation({ ...input, prepare, enqueue, queued: async () => queued, ...over }) }
}

it('same-process callers observe one producer and one publication', async () => {
  const f = continuationFixture()
  const release = deferred<void>()
  const prepare = vi.fn(() => release.promise)
  const first = f.own({ prepare })
  const second = f.own({ prepare })
  expect(first).toBe(second)
  await Promise.resolve()
  expect(prepare).toHaveBeenCalledTimes(1)
  release.resolve()
  await first
  expect(f.enqueue).toHaveBeenCalledTimes(1)
})

function recoveryCapabilities(check: MisdirectionArbiterPort['check']): MisdirectionPreparationCapabilities {
  return { prepareMisdirectionEvidence: (input) => prepareMisdirectionEvidence({ ...input, arbiter: {
    rootPosture: async () => ({ kind: 'eval-root', corpusDigest: 'c'.repeat(64), profileDigest: 'd'.repeat(64) }),
    resolveCaps: async () => ({ maxChecks: 1, source: 'default' }),
    locate: async () => ({ kind: 'located', decisionOrdinal: 0 }), check,
  } }) }
}

// A test-owned real process. Vitest's threads share this PID; killing it kills only this harness.
// The payload is a disposable fixture's trusted host options, never a persisted intent path.
if (process.env.AGENT_QA_CONTINUATION_CHILD !== undefined) {
  it('child-owned-production-preparation', async () => {
    const data = JSON.parse(process.env.AGENT_QA_CONTINUATION_CHILD!)
    const forbidden = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('provider forbidden'))
    const pause = async () => {
      writeFileSync(data.ready, 'ready')
      await new Promise<void>(() => {})
    }
    const caps = recoveryCapabilities(async () => {
      writeFileSync(data.calls, 'check\n', { flag: 'a' })
      if (data.window === 'reservation') await pause()
      if (data.window === 'completion') {
        mkdirSync(join(data.input.agentQaRoot, 'runs', data.input.runId, 'misdirection-completions'))
        chmodSync(join(data.input.agentQaRoot, 'runs', data.input.runId), 0o500)
      }
      return { kind: 'checked', crossCheck: 'held', seedHonored: true,
        samples: { k: 1, seeds: [11], modelCalls: 0 } }
    })
    const step = createPostVerdictStep({ ...data.input, detach: true, log: { warn: () => undefined },
      misdirection: { prepareMisdirectionEvidence: async (input) => {
        const result = await caps.prepareMisdirectionEvidence(input)
        if (data.window === 'sidecar') await pause()
        return result
      } },
      ...(data.window === 'enqueue' ? { operations: { composeHost: (input: { agentQaRoot: string; configPath: string }) => {
        const host = composeCliLocalAgent(input)
        return { ...host, jobs: async () => {
          const jobs = await host.jobs()
          return { ...jobs, queue: { ...jobs.queue, enqueue: async (...args: Parameters<typeof jobs.queue.enqueue>) => {
            const result = await jobs.queue.enqueue(...args)
            await pause()
            return result
          } } }
        } }
      } } } : {}),
    })
    if (data.window === 'before-intent') await pause()
    await step.port.run({} as never)
    if (data.window === 'completion' || data.window === 'contender') await pause()
    expect(forbidden).not.toHaveBeenCalled()
  }, 25_000)
}

async function startOwnedChild(f: ReturnType<typeof continuationFixture>, window: string) {
  const ready = join(f.input.project, `child-ready-${randomUUID()}`)
  const calls = join(f.input.project, 'child-checks')
  const child = spawn(process.execPath, [fileURLToPath(new URL('../../../node_modules/vitest/vitest.mjs', import.meta.url)),
    'run', fileURLToPath(import.meta.url), '-t', '^child-owned-production-preparation$',
    '--pool=threads', '--maxWorkers=1', '--typecheck.enabled=false'], {
    cwd: fileURLToPath(new URL('../../..', import.meta.url)),
    env: { ...process.env, AGENT_QA_CONTINUATION_CHILD: JSON.stringify({ input: f.input, ready, calls, window }) },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', (data) => { output += data })
  child.stderr.on('data', (data) => { output += data })
  const exited = new Promise<void>((done) => child.once('exit', () => done()))
  try {
    await vi.waitFor(() => {
      if (child.exitCode !== null) throw new Error(`child exited: ${output}`)
      expect(existsSync(ready)).toBe(true)
    }, { timeout: 15_000, interval: 25 })
  } catch (error) { child.kill('SIGKILL'); await exited; throw error }
  return { calls, stop: async () => { child.kill('SIGKILL'); await exited } }
}

async function terminalRecover(f: ReturnType<typeof continuationFixture>, caps: MisdirectionPreparationCapabilities) {
  const tail = runPostRunTail({ runId: generateRunId(), agentQaRoot: f.input.agentQaRoot,
    configPath: f.input.configPath, configDir: f.input.project, knowledgeConfig: { dir: 'knowledge' },
    auditSink: { emit: () => undefined } as never, policy: defaultPostRunGuardrailPolicy(),
    log: { warn: () => undefined }, operations: {
      resolveKnowledgeRoot: () => f.input.knowledgeRoot,
      recoverPendingPostVerdictContinuations: (input) => recoverPendingPostVerdictContinuations({ ...input, misdirection: caps }),
      acquireWriterLease: (() => ({ kind: 'held', holder: { pid: process.pid } })) as never,
      nudgeDaemon: async () => undefined,
    },
  })
  await tail.drain()
}

async function startRecoveryDaemon(f: ReturnType<typeof continuationFixture>, caps: MisdirectionPreparationCapabilities) {
  const signals = new Map<NodeJS.Signals, () => void>()
  const cadence: (() => void)[] = []
  let started = false
  const operations = {
    recoverPendingPostVerdictContinuations: (input: Parameters<typeof recoverPendingPostVerdictContinuations>[0]) =>
      recoverPendingPostVerdictContinuations({ ...input, misdirection: caps }),
    acquireWriterLease: () => ({ kind: 'acquired', leaseId: 'fixture-daemon', epoch: 41 }),
    releaseLease: () => ({ kind: 'released' }), heartbeatLease: () => ({ kind: 'alive',
      holder: { pid: process.pid, epoch: 41, heartbeatAtMs: Date.now(), leaseId: 'fixture-daemon' } }),
    readWriterLease: () => ({ kind: 'free' }),
    composeJobRecovery: () => ({ store: { adoptEpoch: async () => ({ epoch: 41 }) },
      recoverAbandonedClaims: async () => ({ recovered: 0 }), close: async () => undefined }),
    composeLocalAgent: () => ({ registry: {}, jobs: async () => ({
      queue: { runNextJob: async () => ({ ran: false, reason: 'no-job' }) },
    }), close: async () => undefined }),
    reconcileRunOutcomesProjection: () => ({ kind: 'skipped' }),
    inspectDrainableCurationWork: () => ({ queuedCandidateIds: [], recoverableClaimedCandidateIds: [] }),
    countRemainingCurationWork: () => ({ queued: 0, claimedNonterminal: 0, quarantined: 0 }),
    listQueuedCandidates: () => [], runMaintenanceTail: async () => undefined,
    setInterval: (callback: () => void, ms: number) => { if (ms === CURATION_QUEUE_POLL_MS) cadence.push(callback); return 1 },
    clearInterval: () => undefined, setTimeout: () => 1, clearTimeout: () => undefined,
    onSignal: (signal: NodeJS.Signals, listener: () => void) => signals.set(signal, listener),
    offSignal: (signal: NodeJS.Signals) => signals.delete(signal),
    startHeartbeatSupervisor: async () => ({ exited: new Promise<void>(() => {}), stop: async () => undefined }),
    startInvokeServer: async (input: { socketPath: string }) => { started = true; return { socketPath: input.socketPath, close: async () => undefined } },
  } as unknown as Partial<DaemonHostOperations>
  const running = runDaemonHost({ agentQaRoot: f.input.agentQaRoot, knowledgeRoot: f.input.knowledgeRoot,
    configPath: f.input.configPath, config: { getMasked: async () => ({ schemaVersion: 1, configPath: f.input.configPath, entries: [] }) },
    model: () => ({ modelId: 'fixture', generate: async () => { throw new Error('provider forbidden') } }),
    operations, logger: { info: () => undefined, error: () => undefined },
  })
  try { await vi.waitFor(() => expect(started && cadence.length > 0).toBe(true)) }
  catch (error) { signals.get('SIGTERM')?.(); await running; throw error }
  return { tick: () => cadence.forEach((callback) => callback()),
    stop: async () => { signals.get('SIGTERM')!(); await running } }
}

it.each(['terminal', 'daemon'] as const)('%s discovers a killed owner without repeating its consumed check', async (door) => {
  const f = continuationFixture()
  const check = vi.fn(async () => { throw new Error('must not repeat the reserved check') })
  const caps = recoveryCapabilities(check)
  const child = await startOwnedChild(f, 'reservation')
  let daemon: Awaited<ReturnType<typeof startRecoveryDaemon>> | undefined
  try {
    if (door === 'daemon') daemon = await startRecoveryDaemon(f, caps)
    const before = readMisdirectionRunState(f.runDir, f.input.runId)
    expect(before.reservations).toHaveLength(1)
    const reservationHash = sha256hex(canonicalJson(before.reservations))
    const reservationDir = join(f.runDir, 'misdirection-reservations')
    const reservationBytes = readdirSync(reservationDir).sort().map((file) => sha256hex(readFileSync(join(reservationDir, file), 'utf8')))
    // An already-running daemon/terminal must not treat a live reservation as interrupted.
    if (daemon === undefined) await terminalRecover(f, caps)
    else { daemon.tick(); await new Promise((done) => setTimeout(done, 50)) }
    expect(existsSync(f.pendingPath)).toBe(true)
    expect(existsSync(join(f.runDir, 'misdirection-completions'))).toBe(false)
    await child.stop()
    if (daemon === undefined) await terminalRecover(f, caps)
    else { daemon.tick(); await vi.waitFor(() => expect(existsSync(f.pendingPath)).toBe(false)) }
    const after = readMisdirectionRunState(f.runDir, f.input.runId)
    expect(sha256hex(canonicalJson(after.reservations))).toBe(reservationHash)
    expect(readdirSync(reservationDir).sort().map((file) => sha256hex(readFileSync(join(reservationDir, file), 'utf8')))).toEqual(reservationBytes)
    expect(after.policy).toEqual(before.policy)
    expect(readFileSync(child.calls, 'utf8')).toBe('check\n')
    expect(check).not.toHaveBeenCalled()
    const final = guardCompletedRunHandoff(JSON.parse(readFileSync(f.handoffPath, 'utf8')))
    expect(final.misdirectionEvidence?.[0]).toMatchObject({ crossCheck: 'not-run', reason: 'interrupted' })
    const host = composeCliLocalAgent({ agentQaRoot: f.input.agentQaRoot, configPath: f.input.configPath })
    try {
      const rows = (await (await host.jobs()).store.dumpState()).jobs.filter((row) => row.kind === 'analyze-run')
      expect(rows).toHaveLength(1)
      expect(rows[0]!.payload).toMatchObject({ handoffDigest: sha256hex(canonicalJson(final)), misdirectionEvidence: final.misdirectionEvidence })
    } finally { await host.close() }
  } finally { await child.stop(); await daemon?.stop() }
}, 30_000)

it.each(['before-intent', 'completion', 'sidecar', 'enqueue'] as const)('recovers the %s crash window without another check', async (window) => {
  const f = continuationFixture()
  const child = await startOwnedChild(f, window)
  try {
    await child.stop()
    chmodSync(f.runDir, 0o700)
    const check = vi.fn(async () => { throw new Error('no repeated check') })
    const before = readMisdirectionRunState(f.runDir, f.input.runId)
    if (window === 'completion') {
      expect(before.completions).toHaveLength(1)
      expect(guardCompletedRunHandoff(JSON.parse(readFileSync(f.handoffPath, 'utf8'))).misdirectionEvidence).toBeUndefined()
    }
    const sidecarBefore = window === 'enqueue' ? readFileSync(f.handoffPath) : undefined
    await terminalRecover(f, recoveryCapabilities(check))
    expect(check).not.toHaveBeenCalled()
    const host = composeCliLocalAgent({ agentQaRoot: f.input.agentQaRoot, configPath: f.input.configPath })
    try {
      const rows = (await (await host.jobs()).store.dumpState()).jobs.filter((row) => row.kind === 'analyze-run')
      expect(rows).toHaveLength(window === 'before-intent' ? 0 : 1)
      if (window !== 'before-intent') {
        const final = guardCompletedRunHandoff(JSON.parse(readFileSync(f.handoffPath, 'utf8')))
        expect(final.misdirectionEvidence?.[0]?.crossCheck).toBe('held')
        expect(rows[0]!.payload).toMatchObject({ handoffDigest: sha256hex(canonicalJson(final)), misdirectionEvidence: final.misdirectionEvidence })
        expect(readFileSync(child.calls, 'utf8')).toBe('check\n')
        expect(existsSync(f.pendingPath)).toBe(false)
      }
      if (sidecarBefore !== undefined) expect(readFileSync(f.handoffPath)).toEqual(sidecarBefore)
    } finally { await host.close() }
  } finally { await child.stop(); chmodSync(f.runDir, 0o700) }
}, 30_000)

it('separate live process contenders cannot publish interrupted evidence or spend twice', async () => {
  const f = continuationFixture()
  const first = await startOwnedChild(f, 'reservation')
  try {
    const second = await startOwnedChild(f, 'contender')
    try {
      expect(readFileSync(first.calls, 'utf8')).toBe('check\n')
      expect(readMisdirectionRunState(f.runDir, f.input.runId).completions).toHaveLength(0)
      expect(guardCompletedRunHandoff(JSON.parse(readFileSync(f.handoffPath, 'utf8'))).misdirectionEvidence).toBeUndefined()
    } finally { await second.stop() }
  } finally { await first.stop() }
}, 30_000)

it.each(['live', 'EPERM', 'unknown', 'partial'] as const)('refuses %s owner without preparation', async (mode) => {
  const f = continuationFixture()
  await expect(f.own({ prepare: async () => { throw new Error('retain intent') } })).rejects.toThrow()
  const lock = `${f.pendingPath}.owner`
  mkdirSync(lock)
  if (mode !== 'partial') writeFileSync(join(lock, 'owner.json'), JSON.stringify({
    ...JSON.parse(readFileSync(f.pendingPath, 'utf8')), pid: process.pid, token: randomUUID(),
  }))
  if (mode === 'EPERM' || mode === 'unknown') vi.spyOn(process, 'kill').mockImplementation(() => {
    throw Object.assign(new Error('uncertain'), { code: mode === 'EPERM' ? 'EPERM' : 'EIO' })
  })
  await expect(Promise.resolve().then(() => f.own())).rejects.toThrow('owner-busy')
  expect(f.prepare).not.toHaveBeenCalled()
  expect(f.enqueue).not.toHaveBeenCalled()
})

it('a stale release cannot remove a newer owner generation', async () => {
  const f = continuationFixture()
  const release = deferred<void>()
  const active = f.own({ prepare: () => release.promise })
  await Promise.resolve()
  const lock = `${f.pendingPath}.owner`
  const old = JSON.parse(readFileSync(join(lock, 'owner.json'), 'utf8'))
  renameSync(lock, `${lock}.dead-${old.token}`)
  mkdirSync(lock)
  const newer = { ...old, token: randomUUID() }
  writeFileSync(join(lock, 'owner.json'), JSON.stringify(newer))
  release.resolve()
  await expect(active).rejects.toThrow('owner-busy')
  expect(JSON.parse(readFileSync(join(lock, 'owner.json'), 'utf8'))).toEqual(newer)
  expect(existsSync(`${lock}.dead-${old.token}`)).toBe(true)
  expect(f.enqueue).not.toHaveBeenCalled()
})

it.each(['malformed', 'foreign', 'symlink', 'write-failure'] as const)('refuses %s intent before preparation', async (mode) => {
  const f = continuationFixture()
  if (mode === 'malformed') writeFileSync(f.pendingPath, '{bad')
  if (mode === 'foreign') writeFileSync(f.pendingPath, JSON.stringify({ schemaVersion: 1,
    runId: generateRunId(), sourceDigest: 'a'.repeat(64), configDigest: 'b'.repeat(64) }))
  if (mode === 'symlink') symlinkSync(f.handoffPath, f.pendingPath)
  if (mode === 'write-failure') mkdirSync(f.pendingPath)
  await expect(Promise.resolve().then(() => f.own())).rejects.toThrow()
  expect(f.prepare).not.toHaveBeenCalled()
  expect(f.enqueue).not.toHaveBeenCalled()
  expect(existsSync(f.pendingPath)).toBe(true)
})

it.each(['config', 'source'] as const)('failed publication retains the intent and queues nothing; changed %s refuses retry', async (changed) => {
  const f = continuationFixture()
  await expect(f.own({ prepare: async () => { throw new Error('publication failed') } })).rejects.toThrow('publication failed')
  const before = readFileSync(f.pendingPath)
  expect(f.enqueue).not.toHaveBeenCalled()
  if (changed === 'config') writeFileSync(f.input.configPath, '\n# changed host config\n', { flag: 'a' })
  else {
    const source = JSON.parse(readFileSync(f.handoffPath, 'utf8'))
    source.tests[0].testName = 'changed source'
    writeFileSync(f.handoffPath, JSON.stringify(source))
  }
  await expect(f.own()).rejects.toThrow('identity-conflict')
  expect(readFileSync(f.pendingPath)).toEqual(before)
  expect(f.prepare).not.toHaveBeenCalled()
})

it('an uncertain owner does not starve an unrelated eligible intent', async () => {
  const f = continuationFixture()
  await expect(f.own({ prepare: async () => { throw new Error('retain') } })).rejects.toThrow()
  mkdirSync(`${f.pendingPath}.owner`)
  const otherId = generateRunId()
  const otherDir = join(f.input.agentQaRoot, 'runs', otherId)
  mkdirSync(otherDir)
  writeFileSync(join(otherDir, 'handoff.json'), JSON.stringify({
    ...JSON.parse(readFileSync(f.handoffPath, 'utf8')), runId: otherId,
  }))
  await expect(ownPostVerdictContinuation({ ...f.input, runId: otherId,
    queued: async () => false, prepare: async () => { throw new Error('retain') }, enqueue: f.enqueue,
  })).rejects.toThrow()
  await terminalRecover(f, recoveryCapabilities(async () => ({ kind: 'checked', crossCheck: 'held',
    seedHonored: true, samples: { k: 1, seeds: [11], modelCalls: 0 } })))
  expect(existsSync(f.pendingPath)).toBe(true)
  expect(existsSync(join(otherDir, 'post-verdict-pending.json'))).toBe(false)
  const host = composeCliLocalAgent({ agentQaRoot: f.input.agentQaRoot, configPath: f.input.configPath })
  try {
    const rows = (await (await host.jobs()).store.dumpState()).jobs
    expect(rows.filter((row) => row.kind === 'analyze-run').map((row) => row.idempotencyKey)).toEqual([otherId])
  } finally { await host.close() }
})

it('a conflicting durable queue row refuses recovery and preserves the intent without preparation', async () => {
  const f = continuationFixture()
  await expect(f.own({ prepare: async () => { throw new Error('retain') } })).rejects.toThrow()
  const intent = readFileSync(f.pendingPath)
  const host = composeCliLocalAgent({ agentQaRoot: f.input.agentQaRoot, configPath: f.input.configPath })
  try {
    const jobs = await host.jobs()
    await jobs.queue.enqueue('analyze-run', { runId: f.input.runId, handoffDigest: 'a'.repeat(64),
      handoffSchemaVersion: 7, executionContext: 'local-headless' }, f.input.runId)
    const check = vi.fn(async () => { throw new Error('no check allowed') })
    await terminalRecover(f, recoveryCapabilities(check))
    expect(check).not.toHaveBeenCalled()
    expect(readFileSync(f.pendingPath)).toEqual(intent)
    expect((await jobs.store.dumpState()).jobs).toHaveLength(1)
    expect(guardCompletedRunHandoff(JSON.parse(readFileSync(f.handoffPath, 'utf8'))).misdirectionEvidence).toBeUndefined()
  } finally { await host.close() }
})

it('terminal drain discovers recorded pending work before an unrelated empty FIFO', async () => {
  const f = continuationFixture()
  await expect(f.own({ prepare: async () => { throw new Error('interrupted before prepare') } })).rejects.toThrow()
  const tail = runPostRunTail({ runId: generateRunId(), agentQaRoot: f.input.agentQaRoot,
    configPath: f.input.configPath, configDir: f.input.project, knowledgeConfig: { dir: 'knowledge' },
    auditSink: { emit: () => undefined } as never, policy: defaultPostRunGuardrailPolicy(),
    log: { warn: () => undefined }, operations: {
      acquireWriterLease: (() => ({ kind: 'held', holder: { pid: process.pid } })) as never,
      nudgeDaemon: async () => undefined,
    },
  })
  await tail.drain()
  const host = composeCliLocalAgent({ agentQaRoot: f.input.agentQaRoot, configPath: f.input.configPath })
  try {
    const rows = (await (await host.jobs()).store.dumpState()).jobs
    expect(rows.filter((row) => row.kind === 'analyze-run' && row.idempotencyKey === f.input.runId)).toHaveLength(1)
    expect(existsSync(f.pendingPath)).toBe(false)
  } finally { await host.close() }
})
