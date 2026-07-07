import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  computeRunConfigDigests,
  buildIdentityMasking,
  buildRunPorts,
  createSuiteLifecycle,
  resolveRunExecutionContext,
} from '../run-session-composition.js'

// D-20: computeRunConfigDigests is the ONE digest mint. Both the cache path (per-member) and
// the handoff header (run-level) draw from a single call, so run identity and handoff identity
// cannot fork.
describe('computeRunConfigDigests (D-20 — one mint)', () => {
  const input = {
    configContent: 'config-yaml',
    members: [
      { testFileContent: 'test-a', suiteFileContent: 'suite-1' },
      { testFileContent: 'test-b', suiteFileContent: 'suite-1' },
    ],
  }

  it('is deterministic: same inputs => same run-level pair and per-member pairs', () => {
    const a = computeRunConfigDigests(input)
    const b = computeRunConfigDigests(input)
    expect(a).toEqual(b)
    expect(a.perMember).toHaveLength(2)
    // both members share the same suite content => equal per-member suite digest.
    expect(a.perMember[0].suiteConfigDigest).toBe(a.perMember[1].suiteConfigDigest)
    // distinct test content => distinct per-member test digest.
    expect(a.perMember[0].testConfigDigest).not.toBe(a.perMember[1].testConfigDigest)
    // run-level pair is a stable 16-hex digest.
    expect(a.runLevel.suiteConfigDigest).toMatch(/^[0-9a-f]{16}$/)
    expect(a.runLevel.testConfigDigest).toMatch(/^[0-9a-f]{16}$/)
  })

  it('collapses a single-member run to the member values', () => {
    const d = computeRunConfigDigests({
      configContent: 'cfg',
      members: [{ testFileContent: 't', suiteFileContent: 's' }],
    })
    expect(d.runLevel).toEqual(d.perMember[0])
  })

  it('folds config + suite content into the per-member suite digest (config change forks it)', () => {
    const base = computeRunConfigDigests({
      configContent: 'c',
      members: [{ testFileContent: 't', suiteFileContent: 's' }],
    })
    const changed = computeRunConfigDigests({
      configContent: 'c2',
      members: [{ testFileContent: 't', suiteFileContent: 's' }],
    })
    expect(changed.perMember[0].suiteConfigDigest).not.toBe(base.perMember[0].suiteConfigDigest)
    expect(changed.perMember[0].testConfigDigest).toBe(base.perMember[0].testConfigDigest)
  })

  it('treats an absent suiteFileContent as empty (single-test path shape)', () => {
    const d = computeRunConfigDigests({
      configContent: 'c',
      members: [{ testFileContent: 't' }],
    })
    expect(d.perMember[0].suiteConfigDigest).toMatch(/^[0-9a-f]{16}$/)
    expect(d.runLevel).toEqual(d.perMember[0])
  })
})

// D-09 / Pitfall 2: the identity MaskingContext is constructed UNCONDITIONALLY — the masking
// seam exists cache-on or cache-off; Phase 362 seeds the real redactor at this exact point.
describe('buildIdentityMasking (D-09 — decoupled from cache)', () => {
  it('returns an identity masking context regardless of any cache-enabled flag', () => {
    for (const _cacheEnabled of [true, false]) {
      const m = buildIdentityMasking()
      expect(m.mask('secret-value')).toBe('secret-value')
      expect(m.unmask('secret-value')).toBe('secret-value')
    }
  })

  it('takes no cache-enablement parameter', () => {
    expect(buildIdentityMasking).toHaveLength(0)
  })
})

// buildRunPorts constructs the runner-local persistence ports rooted at the run's `.agent-qa`
// runtime dir (the FsActionCache rooting idiom).
describe('buildRunPorts (roots under .agent-qa)', () => {
  it('roots the event log + handoff store under <configDir>/.agent-qa', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'run-ports-'))
    const runId = 'r_ports-root-check'
    const ports = buildRunPorts({ configDir, runId })
    expect(typeof ports.eventLog.append).toBe('function')
    expect(typeof ports.handoffStore.save).toBe('function')

    // Append one envelope; the write must land under <configDir>/.agent-qa/runs.
    ports.eventLog.append({
      seq: 1,
      ts: 0,
      runId,
      type: 'runWarning',
      payload: { code: 'root-check', message: 'root-check' },
    } as never)
    expect(existsSync(join(configDir, '.agent-qa', 'runs'))).toBe(true)
  })
})

// createSuiteLifecycle lazily sets up a suite on its first member, tears down the previous suite
// on a cross-suite member, and finalize() tears down the last active suite — a wholly-skipped
// suite never sets up (ensureReady is only called by the executor for non-skipped members).
describe('createSuiteLifecycle (lazy per-suite setup/teardown)', () => {
  it('sets up lazily on first member, tears down previous on cross-suite, finalize tears down last', async () => {
    const events: string[] = []
    const hooksFor = (key: string) => ({
      setup: async () => { events.push(`setup:${key}`) },
      teardown: async () => { events.push(`teardown:${key}`) },
    })
    const lc = createSuiteLifecycle()

    await lc.ensureReady('A', hooksFor('A'))
    await lc.ensureReady('A', hooksFor('A')) // same suite => no re-setup
    await lc.ensureReady('B', hooksFor('B')) // cross-suite => tears down A, sets up B
    await lc.finalize() // tears down the last active suite (B)

    // Suite C is never ensured => it never appears (a wholly-skipped suite never sets up).
    expect(events).toEqual(['setup:A', 'teardown:A', 'setup:B', 'teardown:B'])
  })

  it('finalize is a no-op when no suite was ever set up (all members skipped)', async () => {
    const events: string[] = []
    const lc = createSuiteLifecycle()
    await lc.finalize()
    expect(events).toEqual([])
  })
})

describe('resolveRunExecutionContext (delegates to safety-local)', () => {
  it('resolves a valid execution context', () => {
    const ctx = resolveRunExecutionContext()
    expect(['local-interactive', 'local-headless', 'ci', 'cloud']).toContain(ctx)
  })

  it('honors an explicit override', () => {
    const ctx = resolveRunExecutionContext('cloud')
    expect(ctx).toBe('cloud')
  })
})
