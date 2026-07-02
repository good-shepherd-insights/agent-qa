import type {
  ContextHookResult,
  ToolCallHookResult,
  ToolResultHookResult,
} from '@vostride/agent-qa-schema'

import type {
  AsyncToolCallHook,
  ContextHook,
  HookRegistryOptions,
  ProviderRequestHook,
  ProviderRequestParams,
  SafetyHookRunner,
  ToolCallHook,
  ToolResultHook,
} from './interfaces'
import { FIRST_PARTY, FirstPartyHookError } from './capability'

export class HookRegistry implements SafetyHookRunner {
  private readonly toolCallHooks: ToolCallHook[] = []
  private readonly asyncToolCallHooks: AsyncToolCallHook[] = []
  private readonly toolResultHooks: ToolResultHook[] = []
  private readonly contextHooks: ContextHook[] = []
  private readonly providerRequestHooks: ProviderRequestHook[] = []

  constructor(private readonly options: HookRegistryOptions = {}) {}

  registerToolCall(hook: ToolCallHook, capability: unknown): void {
    this.assertFirstParty(capability)
    this.toolCallHooks.push(hook)
  }

  registerToolCallAsync(hook: AsyncToolCallHook, capability: unknown): void {
    this.assertFirstParty(capability)
    this.asyncToolCallHooks.push(hook)
  }

  registerToolResult(hook: ToolResultHook, capability: unknown): void {
    this.assertFirstParty(capability)
    this.toolResultHooks.push(hook)
  }

  registerContext(hook: ContextHook, capability: unknown): void {
    this.assertFirstParty(capability)
    this.contextHooks.push(hook)
  }

  registerProviderRequest(hook: ProviderRequestHook, capability: unknown): void {
    this.assertFirstParty(capability)
    this.providerRequestHooks.push(hook)
  }

  runToolCall<TCall>(call: TCall): ToolCallHookResult<TCall> {
    let currentCall = call

    for (const hook of this.toolCallHooks as ToolCallHook<TCall>[]) {
      const result = hook(currentCall)

      if (result.action === 'deny') {
        return result
      }

      if (result.action === 'mutate') {
        currentCall = result.mutated
      }
    }

    return { action: 'allow', call: currentCall }
  }

  async runToolCallAsync<TCall>(call: TCall): Promise<ToolCallHookResult<TCall>> {
    let currentCall = call

    for (const hook of this.asyncToolCallHooks as AsyncToolCallHook<TCall>[]) {
      const result = await hook(currentCall)

      if (result.action === 'deny') {
        return result
      }

      if (result.action === 'mutate') {
        currentCall = result.mutated
      }
    }

    return { action: 'allow', call: currentCall }
  }

  runToolResult<TResult>(result: TResult): ToolResultHookResult<TResult> {
    let currentResult = result

    for (const hook of this.toolResultHooks as ToolResultHook<TResult>[]) {
      currentResult = hook(currentResult).result
    }

    return { result: currentResult }
  }

  runContext<TContext>(context: TContext): ContextHookResult<TContext> {
    let currentContext = context

    for (const hook of this.contextHooks as ContextHook<TContext>[]) {
      currentContext = hook(currentContext).context
    }

    return { context: currentContext }
  }

  runProviderRequest(params: ProviderRequestParams): ProviderRequestParams {
    let currentParams = params

    for (const hook of this.providerRequestHooks) {
      currentParams = hook(currentParams)
    }

    return currentParams
  }

  private assertFirstParty(capability: unknown): void {
    if (capability !== FIRST_PARTY) {
      throw new FirstPartyHookError()
    }
  }
}

export function createHookRegistry(options?: HookRegistryOptions): HookRegistry {
  return new HookRegistry(options)
}
