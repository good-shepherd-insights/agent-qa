import { describe, expect, it, vi } from 'vitest'

import { createProviderRequestMiddleware } from '../../egress/provider-request-middleware'
import { FIRST_PARTY, FirstPartyHookError } from '../capability'
import type { AuditSink, ExecutionAuditRow, GuardrailAuditRow } from '../../ports/audit-sink'
import type { AsyncToolCallHook, ProviderRequestParams } from '../interfaces'
import { createHookRegistry } from '../registry'

interface ToolCallFixture {
  name: string
  args: {
    count: number
  }
}

interface ProviderRequestFixture {
  prompt: string
  markers: string[]
}

function providerRequestFixture(params: ProviderRequestParams): ProviderRequestFixture {
  return params as unknown as ProviderRequestFixture
}

function asProviderRequestParams(params: ProviderRequestFixture): ProviderRequestParams {
  return params as unknown as ProviderRequestParams
}

describe('HookRegistry', () => {
  it('invokes one hook at each point in run order', () => {
    const registry = createHookRegistry()
    const calls: string[] = []

    registry.registerToolCall((call) => {
      calls.push('tool_call')
      return { action: 'allow', call }
    }, FIRST_PARTY)
    registry.registerToolResult((result) => {
      calls.push('tool_result')
      return { result }
    }, FIRST_PARTY)
    registry.registerContext((context) => {
      calls.push('context')
      return { context }
    }, FIRST_PARTY)
    registry.registerProviderRequest((params) => {
      calls.push('provider_request')
      return params
    }, FIRST_PARTY)

    registry.runToolCall({ name: 'click', args: { count: 1 } })
    registry.runToolResult({ ok: true })
    registry.runContext([{ role: 'user', content: 'hello' }])
    registry.runProviderRequest(asProviderRequestParams({ prompt: 'hello', markers: [] }))

    expect(calls).toEqual(['tool_call', 'tool_result', 'context', 'provider_request'])
  })

  it('short-circuits a denied sync tool call without writing any audit row', () => {
    const appendExecutionAudit = vi.fn<(row: ExecutionAuditRow) => void>()
    const auditSink: AuditSink = {
      appendExecutionAudit,
      appendGuardrailAudit: vi.fn<(row: GuardrailAuditRow) => void>(),
    }
    const registry = createHookRegistry({ auditSink })
    const laterHook = vi.fn()

    registry.registerToolCall(() => ({
      action: 'deny',
      reason: 'restricted action blocked',
      policy: {
        verdict: 'deny',
        reason: 'restricted action blocked',
        riskTier: 'restricted',
        // 400 D-15: `remedies` is a required member of a decision — a restricted-tier block
        // is the arm that offers nothing, and it has to SAY nothing rather than omit the field.
        remedies: [],
      },
    }), FIRST_PARTY)
    registry.registerToolCall(laterHook, FIRST_PARTY)

    const result = registry.runToolCall({ name: 'deleteAll', args: { count: 1 } })

    expect(result).toEqual({
      action: 'deny',
      reason: 'restricted action blocked',
      policy: {
        verdict: 'deny',
        reason: 'restricted action blocked',
        riskTier: 'restricted',
        remedies: [],
      },
    })
    expect(laterHook).not.toHaveBeenCalled()
    // The registry is a pure dispatcher: the policy gate's evaluate() is the sole
    // execution-audit author (349 D-02). A registry-side second writer would emit
    // two rows per deny — assert zero rows here.
    expect(appendExecutionAudit).not.toHaveBeenCalled()
  })

  it('makes a tool-call mutation visible to the next hook', () => {
    const registry = createHookRegistry()
    const callsSeenBySecondHook: ToolCallFixture[] = []

    registry.registerToolCall((call) => {
      const fixture = call as ToolCallFixture
      return {
        action: 'mutate',
        mutated: {
          ...fixture,
          args: {
            count: fixture.args.count + 1,
          },
        },
        reason: 'increment count',
      }
    }, FIRST_PARTY)
    registry.registerToolCall((call) => {
      const fixture = call as ToolCallFixture
      callsSeenBySecondHook.push(fixture)
      return { action: 'allow', call: fixture }
    }, FIRST_PARTY)

    const result = registry.runToolCall<ToolCallFixture>({ name: 'step', args: { count: 1 } })

    expect(callsSeenBySecondHook).toEqual([{ name: 'step', args: { count: 2 } }])
    expect(result).toEqual({ action: 'allow', call: { name: 'step', args: { count: 2 } } })
  })

  it('composes tool_result, context, and provider_request as transform chains', () => {
    const registry = createHookRegistry()
    const secondHookInputs: unknown[] = []

    registry.registerToolResult((result) => ({ result: `${String(result)}:first` }), FIRST_PARTY)
    registry.registerToolResult((result) => {
      secondHookInputs.push(result)
      return { result: `${String(result)}:second` }
    }, FIRST_PARTY)

    registry.registerContext((context) => {
      const items = context as string[]
      return { context: [...items, 'first'] }
    }, FIRST_PARTY)
    registry.registerContext((context) => {
      const items = context as string[]
      secondHookInputs.push(items)
      return { context: [...items, 'second'] }
    }, FIRST_PARTY)

    registry.registerProviderRequest((params) => {
      const request = providerRequestFixture(params)
      return asProviderRequestParams({
        prompt: `${request.prompt}:first`,
        markers: [...request.markers, 'first'],
      })
    }, FIRST_PARTY)
    registry.registerProviderRequest((params) => {
      const request = providerRequestFixture(params)
      secondHookInputs.push(request)
      return asProviderRequestParams({
        prompt: `${request.prompt}:second`,
        markers: [...request.markers, 'second'],
      })
    }, FIRST_PARTY)

    const toolResult = registry.runToolResult('raw')
    const context = registry.runContext(['raw'])
    const providerRequest = providerRequestFixture(
      registry.runProviderRequest(asProviderRequestParams({ prompt: 'raw', markers: [] })),
    )

    expect(toolResult).toEqual({ result: 'raw:first:second' })
    expect(context).toEqual({ context: ['raw', 'first', 'second'] })
    expect(providerRequest).toEqual({ prompt: 'raw:first:second', markers: ['first', 'second'] })
    expect(secondHookInputs).toEqual([
      'raw:first',
      ['raw', 'first'],
      { prompt: 'raw:first', markers: ['first'] },
    ])
  })

  it('creates a v3 provider-request middleware that passes params through with an empty registry', async () => {
    const registry = createHookRegistry()
    const middleware = createProviderRequestMiddleware(registry)
    const params = asProviderRequestParams({ prompt: 'unchanged', markers: [] })

    expect(middleware.specificationVersion).toBe('v3')
    await expect(
      middleware.transformParams?.({
        params,
      } as Parameters<NonNullable<typeof middleware.transformParams>>[0]),
    ).resolves.toBe(params)
  })
})

describe('HookRegistry async tool_call dispatch', () => {
  it('stores an async tool_call hook registered with FIRST_PARTY and invokes it via runToolCallAsync', async () => {
    const registry = createHookRegistry()
    const hook = vi.fn<AsyncToolCallHook<ToolCallFixture>>(async (call) => ({
      action: 'allow',
      call,
    }))

    registry.registerToolCallAsync(hook as AsyncToolCallHook, FIRST_PARTY)

    const result = await registry.runToolCallAsync<ToolCallFixture>({
      name: 'click',
      args: { count: 1 },
    })

    expect(hook).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ action: 'allow', call: { name: 'click', args: { count: 1 } } })
  })

  it('rejects registration without a capability token (FirstPartyHookError)', () => {
    const registry = createHookRegistry()
    const hook: AsyncToolCallHook = async (call) => ({ action: 'allow', call })

    expect(() => registry.registerToolCallAsync(hook, undefined)).toThrow(FirstPartyHookError)
  })

  it('rejects a forged token with the same description (identity check, not description check)', () => {
    const registry = createHookRegistry()
    const hook: AsyncToolCallHook = async (call) => ({ action: 'allow', call })

    expect(() =>
      registry.registerToolCallAsync(hook, Symbol('agent-qa-safety-first-party')),
    ).toThrow(FirstPartyHookError)
  })

  it('awaits hooks in registration order and threads a mutation into the next hook', async () => {
    const registry = createHookRegistry()
    const callsSeenBySecondHook: ToolCallFixture[] = []

    registry.registerToolCallAsync(
      (async (call) => {
        const fixture = call as ToolCallFixture
        return {
          action: 'mutate',
          mutated: { ...fixture, args: { count: fixture.args.count + 1 } },
          reason: 'increment count',
        }
      }) as AsyncToolCallHook,
      FIRST_PARTY,
    )
    registry.registerToolCallAsync(
      (async (call) => {
        const fixture = call as ToolCallFixture
        callsSeenBySecondHook.push(fixture)
        return { action: 'allow', call: fixture }
      }) as AsyncToolCallHook,
      FIRST_PARTY,
    )

    const result = await registry.runToolCallAsync<ToolCallFixture>({
      name: 'step',
      args: { count: 1 },
    })

    expect(callsSeenBySecondHook).toEqual([{ name: 'step', args: { count: 2 } }])
    expect(result).toEqual({ action: 'allow', call: { name: 'step', args: { count: 2 } } })
  })

  it('short-circuits on a deny result, never invokes later hooks, and writes no audit row', async () => {
    const appendExecutionAudit = vi.fn<(row: ExecutionAuditRow) => void>()
    const auditSink: AuditSink = {
      appendExecutionAudit,
      appendGuardrailAudit: vi.fn<(row: GuardrailAuditRow) => void>(),
    }
    const registry = createHookRegistry({ auditSink })
    const laterHook = vi.fn<AsyncToolCallHook>(async (call) => ({ action: 'allow', call }))

    registry.registerToolCallAsync(
      (async () => ({
        action: 'deny',
        reason: 'restricted action blocked',
        policy: {
          verdict: 'deny',
          reason: 'restricted action blocked',
          riskTier: 'restricted',
          remedies: [],
        },
      })) as AsyncToolCallHook,
      FIRST_PARTY,
    )
    registry.registerToolCallAsync(laterHook, FIRST_PARTY)

    const result = await registry.runToolCallAsync<ToolCallFixture>({
      name: 'deleteAll',
      args: { count: 1 },
    })

    expect(result).toEqual({
      action: 'deny',
      reason: 'restricted action blocked',
      policy: {
        verdict: 'deny',
        reason: 'restricted action blocked',
        riskTier: 'restricted',
        remedies: [],
      },
    })
    expect(laterHook).not.toHaveBeenCalled()
    expect(appendExecutionAudit).not.toHaveBeenCalled()
  })

  it('returns allow with the original call when no async hooks are registered', async () => {
    const registry = createHookRegistry()

    const result = await registry.runToolCallAsync<ToolCallFixture>({
      name: 'noop',
      args: { count: 1 },
    })

    expect(result).toEqual({ action: 'allow', call: { name: 'noop', args: { count: 1 } } })
  })
})
