import { afterEach, expect, it, vi } from 'vitest'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { asRecordId, computeBriefDigest, guardCompletedRunHandoff, canonicalJson, sha256hex } from '@vostride/agent-qa-schema'
import type { RunSession, ServedBrief, StepEvidence } from '@vostride/agent-qa-schema'
import { runInProcessCliRun } from '../../composition/in-process-run-execution.js'
import { createInProcessFixture } from '../../composition/__tests__/in-process-run-fixture.js'
import { composeCliLocalAgent } from '../../composition/local-agent-host.js'
import { prepareMisdirectionEvidence } from '../misdirection-tail.js'
import { readMisdirectionRunState } from '../misdirection-run-state.js'

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

it('retains host ownership after the real runner timeout until evidence-bound analysis exists', async () => {
  const fixture = createInProcessFixture({ origin: 'http://127.0.0.1:1', environment: 'local' })
  roots.push(fixture.project)
  const fetchTrap = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('provider forbidden'))
  const release = deferred<void>()
  const reserved = deferred<void>()
  const checked = vi.fn(async () => {
    reserved.resolve()
    await release.promise
    return { kind: 'checked' as const, crossCheck: 'held' as const, seedHonored: true }
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
      bindRunContext: () => undefined, applyAssembly: () => undefined,
      bindSession: () => undefined, takeFrameworkError: () => undefined,
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
    release.resolve()
    const outcome = await running
    expect(outcome.exitCode).toBe(1)
    expect(checked).toHaveBeenCalledTimes(1)
    expect(fetchTrap).not.toHaveBeenCalled()
    const final = guardCompletedRunHandoff(JSON.parse(readFileSync(join(runDir, 'handoff.json'), 'utf8')))
    expect(final.misdirectionEvidence).toHaveLength(1)
    const host = composeCliLocalAgent({ agentQaRoot: fixture.agentQaRoot, configPath: fixture.configPath })
    try {
      const jobs = await host.jobs()
      const rows = await jobs.store.list({ kind: 'analyze-run' })
      expect(rows).toHaveLength(1)
      expect(rows[0]!.payload).toMatchObject({ handoffDigest: sha256hex(canonicalJson(final)),
        misdirectionEvidence: final.misdirectionEvidence })
    } finally { await host.close() }
    expect(existsSync(join(runDir, 'post-verdict-pending.json'))).toBe(false)
  } finally {
    release.resolve()
    await running
  }
}, 30_000)
