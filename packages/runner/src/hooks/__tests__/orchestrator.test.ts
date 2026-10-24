import { describe, it, expect, vi } from 'vitest'
import { runHooks, type HookEmitSeam, type HookRunIdentity } from '../orchestrator.js'
import type { HookDefinition, HookResult } from '../types.js'
import type { HookExecutorPort, HookExecuteOptions } from '../../run/ports.js'
import type { HookStartedPayload, HookFinishedPayload } from '@vostride/agent-qa-schema'

function makeHook(name: string, overrides: Partial<HookDefinition> = {}): HookDefinition {
  return {
    id: `h_${name}-amber-birch-coral-delta-ember-falcon-garden-harbor`,
    name,
    runtime: 'node',
    file: `/project/hooks/${name}.js`,
    deps: [],
    timeout: 30000,
    network: true,
    ...overrides,
  }
}

function successResult(vars: Record<string, string> = {}): HookResult {
  return { success: true, variables: vars, output: 'ok', stdout: 'out', stderr: '', duration: 100 }
}

function failResult(error: string): HookResult {
  return { success: false, variables: {}, output: '', stdout: '', stderr: 'boom', duration: 50, error }
}

/** A fake HookExecutorPort that returns queued results and records the opts it was called with. */
function fakeExecutor(results: HookResult[]): HookExecutorPort & {
  calls: Array<{ hook: HookDefinition; opts: HookExecuteOptions }>
} {
  const calls: Array<{ hook: HookDefinition; opts: HookExecuteOptions }> = []
  let i = 0
  return {
    calls,
    async execute(hook, opts) {
      calls.push({ hook, opts })
      return results[i++] ?? successResult()
    },
  }
}

function fakeEmitter(): HookEmitSeam & {
  started: HookStartedPayload[]
  finished: HookFinishedPayload[]
} {
  const started: HookStartedPayload[] = []
  const finished: HookFinishedPayload[] = []
  return {
    started,
    finished,
    hookStarted(payload) {
      started.push(payload)
    },
    hookFinished(payload) {
      finished.push(payload)
    },
  }
}

describe('runHooks', () => {
  it('runs all hooks sequentially and merges variables', async () => {
    const executor = fakeExecutor([successResult({ TOKEN: 'abc' }), successResult({ SESSION: 'xyz' })])
    const result = await runHooks([makeHook('auth'), makeHook('seed')], { executor })

    expect(result.allPassed).toBe(true)
    expect(result.variables).toEqual({ TOKEN: 'abc', SESSION: 'xyz' })
    expect(result.results.size).toBe(2)
    expect(executor.calls).toHaveLength(2)
  })

  it('passes accumulated variables to subsequent hooks as env vars', async () => {
    const executor = fakeExecutor([successResult({ TOKEN: 'abc' }), successResult({})])
    await runHooks([makeHook('auth'), makeHook('seed')], { executor })

    expect(executor.calls[1].opts.env).toMatchObject({ TOKEN: 'abc' })
  })

  it('threads user env into the first hook and secretEnv into every hook', async () => {
    const executor = fakeExecutor([successResult({}), successResult({})])
    await runHooks([makeHook('auth'), makeHook('seed')], {
      executor,
      env: { BASE: '1' },
      secretEnv: { API_KEY: 'runtime-secret' },
    })

    expect(executor.calls[0].opts.env).toEqual({ BASE: '1' })
    expect(executor.calls[0].opts.secretEnv).toEqual({ API_KEY: 'runtime-secret' })
    expect(executor.calls[1].opts.secretEnv).toEqual({ API_KEY: 'runtime-secret' })
  })

  it('does not allow hook-emitted auth-state env vars to chain into later hooks', async () => {
    const executor = fakeExecutor([
      successResult({
        SAFE: 'value',
        AGENT_QA_AUTH_STATE_JSON: '{"name":"bad"}',
        AGENT_QA_AUTH_STATE_STORAGE_STATE_PATH: '/tmp/bad.json',
      }),
      successResult({}),
    ])

    const result = await runHooks([makeHook('auth'), makeHook('seed')], { executor })

    expect(result.variables).toEqual({ SAFE: 'value' })
    expect(executor.calls[1].opts.env).toEqual({ SAFE: 'value' })
  })

  it('stops on first failure and skips remaining hooks', async () => {
    const executor = fakeExecutor([successResult({ TOKEN: 'abc' }), failResult('script error')])

    const result = await runHooks(
      [makeHook('auth'), makeHook('seed'), makeHook('cleanup')],
      { executor },
    )

    expect(result.allPassed).toBe(false)
    expect(result.results.size).toBe(3)
    expect(executor.calls).toHaveLength(2)

    const cleanupResult = result.results.get('cleanup')!
    expect(cleanupResult.success).toBe(false)
    expect(cleanupResult.error).toContain('Skipped')
    expect(cleanupResult.error).toContain('seed')
  })

  it('returns empty results for empty hooks array', async () => {
    const executor = fakeExecutor([])
    const result = await runHooks([], { executor })
    expect(result.allPassed).toBe(true)
    expect(result.variables).toEqual({})
    expect(result.results.size).toBe(0)
  })

  it('later hook variables override earlier ones', async () => {
    const executor = fakeExecutor([
      successResult({ TOKEN: 'first', SHARED: 'a' }),
      successResult({ TOKEN: 'second' }),
    ])

    const result = await runHooks([makeHook('hook1'), makeHook('hook2')], { executor })
    expect(result.variables.TOKEN).toBe('second')
    expect(result.variables.SHARED).toBe('a')
  })

  it('tracks duration', async () => {
    const executor = fakeExecutor([successResult()])
    const result = await runHooks([makeHook('fast')], { executor })
    expect(result.duration).toBeGreaterThanOrEqual(0)
  })

  describe('lifecycle emit seam', () => {
    const identity: HookRunIdentity = { phase: 'setup', scope: 'suite' }

    it('emits one started + one finished per executed hook with the result detail', async () => {
      const executor = fakeExecutor([successResult({ TOKEN: 'abc' }), successResult({ SESSION: 'xyz' })])
      const emit = fakeEmitter()

      await runHooks([makeHook('auth'), makeHook('seed')], { executor, emit, identity })

      expect(emit.started).toHaveLength(2)
      expect(emit.finished).toHaveLength(2)

      expect(emit.started[0]).toMatchObject({ hookName: 'auth', phase: 'setup', scope: 'suite' })
      expect(emit.finished[0]).toMatchObject({
        hookName: 'auth',
        status: 'passed',
        durationMs: 100,
        stdout: 'out',
        stderr: '',
        variables: { TOKEN: 'abc' },
        kind: 'hook',
      })
      // started/finished correlate via a stable per-hook execution id
      expect(emit.finished[0].hookExecutionId).toBe(emit.started[0].hookExecutionId)
      expect(emit.finished[1].hookExecutionId).toBe(emit.started[1].hookExecutionId)
      expect(emit.started[0].hookExecutionId).not.toBe(emit.started[1].hookExecutionId)
    })

    it('emits a failed finished for a failing hook and does not emit skipped hooks', async () => {
      const executor = fakeExecutor([successResult(), failResult('script error')])
      const emit = fakeEmitter()

      await runHooks([makeHook('auth'), makeHook('seed'), makeHook('cleanup')], { executor, emit, identity })

      expect(emit.started.map((s) => s.hookName)).toEqual(['auth', 'seed'])
      expect(emit.finished.map((f) => f.status)).toEqual(['passed', 'failed'])
      expect(emit.finished[1]).toMatchObject({ error: 'script error', stderr: 'boom' })
    })

    it('does not emit when identity is absent', async () => {
      const executor = fakeExecutor([successResult()])
      const emit = fakeEmitter()
      await runHooks([makeHook('auth')], { executor, emit })
      expect(emit.started).toHaveLength(0)
      expect(emit.finished).toHaveLength(0)
    })
  })
})
