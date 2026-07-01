import { describe, expect, it, vi } from 'vitest'

import { createProviderRequestMiddleware } from '../../egress/provider-request-middleware'
import type { AuditSink, ExecutionAuditRow, GuardrailAuditRow } from '../../ports/audit-sink'
import type { ProviderRequestParams } from '../interfaces'
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
    })
    registry.registerToolResult((result) => {
      calls.push('tool_result')
      return { result }
    })
    registry.registerContext((context) => {
      calls.push('context')
      return { context }
    })
    registry.registerProviderRequest((params) => {
      calls.push('provider_request')
      return params
    })

    registry.runToolCall({ name: 'click', args: { count: 1 } })
    registry.runToolResult({ ok: true })
    registry.runContext([{ role: 'user', content: 'hello' }])
    registry.runProviderRequest(asProviderRequestParams({ prompt: 'hello', markers: [] }))

    expect(calls).toEqual(['tool_call', 'tool_result', 'context', 'provider_request'])
  })

  it('short-circuits a denied tool call and appends one execution audit row', () => {
    const appendExecutionAudit = vi.fn<void, [ExecutionAuditRow]>()
    const auditSink: AuditSink = {
      appendExecutionAudit,
      appendGuardrailAudit: vi.fn<void, [GuardrailAuditRow]>(),
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
      },
    }))
    registry.registerToolCall(laterHook)

    const result = registry.runToolCall({ name: 'deleteAll', args: { count: 1 } })

    expect(result).toEqual({
      action: 'deny',
      reason: 'restricted action blocked',
      policy: {
        verdict: 'deny',
        reason: 'restricted action blocked',
        riskTier: 'restricted',
      },
    })
    expect(laterHook).not.toHaveBeenCalled()
    expect(appendExecutionAudit).toHaveBeenCalledTimes(1)
    expect(appendExecutionAudit).toHaveBeenCalledWith({
      verdict: 'deny',
      reason: 'restricted action blocked',
      riskTier: 'restricted',
    })
  })

  it('makes a tool-call mutation visible to the next hook', () => {
    const registry = createHookRegistry()
    const callsSeenBySecondHook: ToolCallFixture[] = []

    registry.registerToolCall((call: ToolCallFixture) => ({
      action: 'mutate',
      mutated: {
        ...call,
        args: {
          count: call.args.count + 1,
        },
      },
      reason: 'increment count',
    }))
    registry.registerToolCall((call: ToolCallFixture) => {
      callsSeenBySecondHook.push(call)
      return { action: 'allow', call }
    })

    const result = registry.runToolCall<ToolCallFixture>({ name: 'step', args: { count: 1 } })

    expect(callsSeenBySecondHook).toEqual([{ name: 'step', args: { count: 2 } }])
    expect(result).toEqual({ action: 'allow', call: { name: 'step', args: { count: 2 } } })
  })

  it('composes tool_result, context, and provider_request as transform chains', () => {
    const registry = createHookRegistry()
    const secondHookInputs: unknown[] = []

    registry.registerToolResult((result: string) => ({ result: `${result}:first` }))
    registry.registerToolResult((result: string) => {
      secondHookInputs.push(result)
      return { result: `${result}:second` }
    })

    registry.registerContext((context: string[]) => ({ context: [...context, 'first'] }))
    registry.registerContext((context: string[]) => {
      secondHookInputs.push(context)
      return { context: [...context, 'second'] }
    })

    registry.registerProviderRequest((params) => {
      const request = providerRequestFixture(params)
      return asProviderRequestParams({
        prompt: `${request.prompt}:first`,
        markers: [...request.markers, 'first'],
      })
    })
    registry.registerProviderRequest((params) => {
      const request = providerRequestFixture(params)
      secondHookInputs.push(request)
      return asProviderRequestParams({
        prompt: `${request.prompt}:second`,
        markers: [...request.markers, 'second'],
      })
    })

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
