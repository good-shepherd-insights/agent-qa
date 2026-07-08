import { describe, it, expect } from 'vitest'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { FsEventLog, RUNS_SUBDIR, slugBranch } from '@vostride/agent-qa-runner-local'
import { runSafetyScope } from '@vostride/agent-qa-safety-local'
import { getActiveMaskingContext } from '@vostride/agent-qa-safety'
import type { AuditSink, ExecutionAuditRow, GuardrailAuditRow } from '@vostride/agent-qa-safety'
import {
  computeRunConfigDigests,
  buildIdentityMasking,
  buildRunPorts,
  createSuiteLifecycle,
  resolveRunExecutionContext,
  sensitiveEnvSlice,
  extractAuthStateSensitiveStrings,
  buildRunMaskingContext,
  stampAuditSink,
  buildRunAuditSink,
  buildRunSafetyHooks,
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

// ---- (7) masking seed pipeline (D-05/D-06/D-07) --------------------------------------------

// D-05: the env slice is name-based ONLY — masking must not degrade planning, so planner-visible
// config never seeds, while every ambient-credential-shaped name does.
describe('sensitiveEnvSlice (D-05 — name-based sensitive-env selection)', () => {
  it('selects credential-shaped names (positive set)', () => {
    const env = {
      MY_API_KEY: 'a1',
      STRIPE_SECRET: 'a2',
      DB_PASSWORD: 'a3',
      CI_JOB_TOKEN: 'a4',
      AWS_SECRET_ACCESS_KEY: 'a5',
      GITHUB_TOKEN: 'a6',
      ANTHROPIC_API_KEY: 'a7',
    }
    const slice = sensitiveEnvSlice(env)
    expect(Object.keys(slice).sort()).toEqual(
      [
        'ANTHROPIC_API_KEY',
        'AWS_SECRET_ACCESS_KEY',
        'CI_JOB_TOKEN',
        'DB_PASSWORD',
        'GITHUB_TOKEN',
        'MY_API_KEY',
        'STRIPE_SECRET',
      ].sort(),
    )
  })

  it('NEVER selects planner-visible config names (negative set — asserted explicitly)', () => {
    const env = {
      BASE_URL: 'https://example.com',
      NODE_ENV: 'production',
      HOME: '/home/agent',
      PATH: '/usr/bin:/bin',
      CI: 'true',
      TERM: 'xterm',
    }
    const slice = sensitiveEnvSlice(env)
    expect(slice).toEqual({})
    expect(Object.keys(slice)).not.toContain('BASE_URL')
    expect(Object.keys(slice)).not.toContain('NODE_ENV')
    expect(Object.keys(slice)).not.toContain('HOME')
    expect(Object.keys(slice)).not.toContain('PATH')
    expect(Object.keys(slice)).not.toContain('CI')
    expect(Object.keys(slice)).not.toContain('TERM')
  })

  it('skips undefined values (never seeds a missing var)', () => {
    const slice = sensitiveEnvSlice({ MY_API_KEY: undefined, OTHER_TOKEN: 'present' })
    expect(slice).toEqual({ OTHER_TOKEN: 'present' })
  })
})

// D-07: all cookie values + all localStorage values, no classification heuristics; tolerant of
// missing/odd sections (exact-string masking means benign blobs only mask when rendered verbatim).
describe('extractAuthStateSensitiveStrings (D-07 — cookies + localStorage values)', () => {
  it('returns every cookie value and every localStorage value from a storageState payload', () => {
    const payload = {
      cookies: [
        { name: 'session', value: 'cookie-session-value', domain: 'example.com' },
        { name: 'csrf', value: 'cookie-csrf-value' },
      ],
      origins: [
        {
          origin: 'https://example.com',
          localStorage: [
            { name: 'token', value: 'ls-token-value' },
            { name: 'refresh', value: 'ls-refresh-value' },
          ],
        },
      ],
    }
    expect(extractAuthStateSensitiveStrings(payload).sort()).toEqual(
      ['cookie-session-value', 'cookie-csrf-value', 'ls-token-value', 'ls-refresh-value'].sort(),
    )
  })

  it('tolerates non-string values and absent sections', () => {
    expect(extractAuthStateSensitiveStrings({ cookies: [{ name: 'n', value: 42 }] })).toEqual([])
    expect(extractAuthStateSensitiveStrings({ origins: [{ origin: 'x' }] })).toEqual([])
    expect(extractAuthStateSensitiveStrings({})).toEqual([])
  })

  it('returns [] for a non-object payload', () => {
    expect(extractAuthStateSensitiveStrings(null)).toEqual([])
    expect(extractAuthStateSensitiveStrings('nope')).toEqual([])
    expect(extractAuthStateSensitiveStrings(undefined)).toEqual([])
  })
})

// buildRunMaskingContext seeds a REAL MaskingContext from all three sources and returns the full
// context (register/dispose included) so 362-06 can register mid-run auth values (D-06) at load/capture.
describe('buildRunMaskingContext (D-05/06/07 — real seeded context)', () => {
  it('masks a secrets-file value, a sensitive env value, and a cookie value; passes a BASE_URL value through', () => {
    const secretStore = {
      forEachSecret(cb: (name: string, value: string) => void) {
        cb('FILE_SECRET', 'super-secret-file-value')
      },
    }
    const ctx = buildRunMaskingContext({
      secretStore,
      env: { MY_API_KEY: 'env-api-key-value', BASE_URL: 'https://example.com' },
      authStatePayloads: [
        { cookies: [{ name: 'session', value: 'cookie-session-value' }] },
      ],
    })

    const masked = ctx.mask(
      'file=super-secret-file-value env=env-api-key-value cookie=cookie-session-value url=https://example.com',
    )
    expect(masked).not.toContain('super-secret-file-value')
    expect(masked).not.toContain('env-api-key-value')
    expect(masked).not.toContain('cookie-session-value')
    // BASE_URL is planner-visible config — it must survive unmasked (D-05 negative).
    expect(masked).toContain('https://example.com')
  })

  it('does not register values shorter than the 4-char minRegisteredLength guard', () => {
    const secretStore = {
      forEachSecret(cb: (name: string, value: string) => void) {
        cb('SHORT', 'abc')
      },
    }
    const ctx = buildRunMaskingContext({ secretStore })
    expect(ctx.mask('value=abc')).toBe('value=abc')
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

// ---- (8) per-run stamped audit sink (D-12/D-13) --------------------------------------------

// D-13 (RESEARCH Open Q3): the stamp WINS over any pre-existing row runId/executionContext —
// correlation is authored at the single composition-root stamping site, not by callers.
describe('stampAuditSink (D-13 — stamp-wins correlation)', () => {
  it('overrides row runId + executionContext on execution rows, and runId on guardrail rows', async () => {
    const execRows: ExecutionAuditRow[] = []
    const guardRows: GuardrailAuditRow[] = []
    const inner: AuditSink = {
      appendExecutionAudit(row) {
        execRows.push(row)
      },
      appendGuardrailAudit(row) {
        guardRows.push(row)
      },
    }
    const stamped = stampAuditSink(inner, 'run-1', 'ci')

    await stamped.appendExecutionAudit({
      runId: 'STALE',
      executionContext: 'cloud',
      action: 'delete_record',
      riskTier: 'destructive',
      verdict: 'deny',
      outcome: 'fail-closed-denied',
      reason: 'r',
    })
    await stamped.appendGuardrailAudit({ runId: 'STALE', action: 'redact' })

    expect(execRows).toHaveLength(1)
    expect(execRows[0].runId).toBe('run-1')
    expect(execRows[0].executionContext).toBe('ci')
    expect(guardRows).toHaveLength(1)
    expect(guardRows[0].runId).toBe('run-1')
  })
})

// D-12: the per-run sink writes into the SAME .agent-qa/runs/<slug(runId)>/ directory FsEventLog
// uses — the paths cannot fork (a completed run is one self-contained directory).
describe('buildRunAuditSink (D-12 — path identity with FsEventLog)', () => {
  it('writes execution_audit.jsonl in the exact dir FsEventLog writes events.jsonl', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'run-audit-'))
    const runId = 'r_audit-path-check'
    const sink = buildRunAuditSink({ configDir, runId, executionContext: 'ci' })

    await sink.appendExecutionAudit({
      action: 'noop',
      riskTier: 'read-only',
      verdict: 'allow',
      outcome: 'proceeded',
      reason: 'r',
    })

    const root = resolve(configDir, '.agent-qa')
    new FsEventLog({ root, runId }).append({
      seq: 1,
      ts: 0,
      runId,
      type: 'runWarning',
      payload: { code: 'x', message: 'x' },
    } as never)

    const runDir = join(root, RUNS_SUBDIR, slugBranch(runId))
    expect(existsSync(join(runDir, 'execution_audit.jsonl'))).toBe(true)
    expect(existsSync(join(runDir, 'events.jsonl'))).toBe(true)
  })
})

// ---- (9) per-run safety-hooks registrar (D-01/D-15/D-10/D-11) ------------------------------

describe('buildRunSafetyHooks (D-01/D-15/D-10 — per-run registrar invocation)', () => {
  it('denies a destructive descriptor in a fail-closed ci context AND appends a stamped execution row (D-01)', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'run-hooks-'))
    const runId = 'r_hooks-deny'
    const auditSink = buildRunAuditSink({ configDir, runId, executionContext: 'ci' })
    const { safetyHooks } = buildRunSafetyHooks({ auditSink, executionContext: 'ci', trustMode: false })

    const result = await safetyHooks.runToolCallAsync({ name: 'delete_record', recognized: true })
    expect(result.action).toBe('deny')

    const line = readFileSync(
      join(resolve(configDir, '.agent-qa'), RUNS_SUBDIR, slugBranch(runId), 'execution_audit.jsonl'),
      'utf-8',
    ).trim()
    const row = JSON.parse(line) as Record<string, unknown>
    expect(row).toHaveProperty('runId', runId)
    expect(row).toHaveProperty('executionContext', 'ci')
    expect(row.outcome).toBe('fail-closed-denied')
  })

  it('allows the same dispatch under session trustMode (D-15)', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'run-hooks-'))
    const runId = 'r_hooks-trust'
    const auditSink = buildRunAuditSink({ configDir, runId, executionContext: 'ci' })
    const { safetyHooks } = buildRunSafetyHooks({ auditSink, executionContext: 'ci', trustMode: true })

    const result = await safetyHooks.runToolCallAsync({ name: 'delete_record', recognized: true })
    expect(result.action).toBe('allow')

    const line = readFileSync(
      join(resolve(configDir, '.agent-qa'), RUNS_SUBDIR, slugBranch(runId), 'execution_audit.jsonl'),
      'utf-8',
    ).trim()
    const row = JSON.parse(line) as Record<string, unknown>
    expect(row.outcome).toBe('proceeded')
    expect(row.trustSource).toBe('session-trust-mode')
  })

  it('accumulates awaited confirm time; confirmPausedMs() reports the running total (D-10)', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'run-hooks-'))
    const runId = 'r_hooks-pause'
    const auditSink = buildRunAuditSink({ configDir, runId, executionContext: 'local-interactive' })
    const confirm = async () => {
      await new Promise((r) => setTimeout(r, 10))
      return true
    }
    const { safetyHooks, confirmPausedMs } = buildRunSafetyHooks({
      auditSink,
      executionContext: 'local-interactive',
      trustMode: false,
      confirm,
    })

    expect(confirmPausedMs()).toBe(0)
    const first = await safetyHooks.runToolCallAsync({ name: 'delete_record', recognized: true })
    expect(first.action).toBe('allow')
    const afterOne = confirmPausedMs()
    expect(afterOne).toBeGreaterThan(0)

    await safetyHooks.runToolCallAsync({ name: 'delete_record', recognized: true })
    expect(confirmPausedMs()).toBeGreaterThanOrEqual(afterOne)
  })
})

// 362-06 SEAM-01 — the exact run-body wrap shape both startRun sites use: a real seeded
// MaskingContext resolves inside `runSafetyScope` (getActiveMaskingContext returns it), and
// `dispose()` is the LAST statement inside the scope body (Pitfall 8) so values masked DURING
// the in-scope run body (handoff assembly, teardown capture) are replaced, but a post-run stray
// egress sees no masking. This pins the pattern the run.ts wiring reproduces at both sites.
describe('runSafetyScope run-body wrap (SEAM-01 / Pitfall 8, 362-06)', () => {
  const tmpAuditDir = mkdtempSync(join(tmpdir(), 'run-scope-wrap-'))

  it('resolves the seeded run MaskingContext inside the scope and disposes last', async () => {
    const maskingContext = buildRunMaskingContext({
      env: { MY_SERVICE_TOKEN: 'super-secret-token-value' },
    })
    const auditSink = buildRunAuditSink({
      configDir: tmpAuditDir,
      runId: 'run-scope-wrap',
      executionContext: 'local-interactive',
    })

    let inScopeMasked = ''
    let handoffMasked = ''
    await runSafetyScope({ maskingContext, auditSink, executionContext: 'local-interactive' }, async () => {
      try {
        // The active resolver reaches the run's context for every in-scope egress.
        inScopeMasked = getActiveMaskingContext()?.mask('leak super-secret-token-value here') ?? 'NO-CTX'
        // A late masker (handoff assembly / teardown capture) still masks — dispose has not run yet.
        handoffMasked = maskingContext.mask('handoff has super-secret-token-value')
      } finally {
        maskingContext.dispose()
      }
    })

    expect(inScopeMasked).not.toContain('super-secret-token-value')
    expect(handoffMasked).not.toContain('super-secret-token-value')
    // After the scope body disposed the context, mask() no longer replaces (order pinned).
    expect(maskingContext.mask('super-secret-token-value')).toBe('super-secret-token-value')
    // Outside the scope the active resolver returns no run context.
    expect(getActiveMaskingContext()).toBeUndefined()
  })
})
