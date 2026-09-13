import { afterEach, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
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
  writeFileSync(handoffPath, JSON.stringify(guardCompletedRunHandoff({
    schemaVersion: 7, runId: input.runId, scope: { tier: 'product', key: fixture.targetName },
    buildOrdinal: 1, executionContext: 'local-headless', aggregateVerdict: 'failed',
    configDigests: { suiteConfigDigest: 'suite', testConfigDigest: 'test' }, startedAt: 1, endedAt: 2,
    tests: [{ testId: fixture.directTestId, testName: 'checkout', filePath: 'tests/direct.yaml',
      testIndex: 0, outcome: 'failed', steps: [] }],
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

it('failed publication retains the intent and queues nothing; changed config refuses retry', async () => {
  const f = continuationFixture()
  await expect(f.own({ prepare: async () => { throw new Error('publication failed') } })).rejects.toThrow('publication failed')
  const before = readFileSync(f.pendingPath)
  expect(f.enqueue).not.toHaveBeenCalled()
  writeFileSync(f.input.configPath, '\n# changed host config\n', { flag: 'a' })
  await expect(f.own()).rejects.toThrow('identity-conflict')
  expect(readFileSync(f.pendingPath)).toEqual(before)
  expect(f.prepare).not.toHaveBeenCalled()
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
