import type {
  ContextHookResult,
  ToolCallHookDenyResult,
  ToolCallHookResult,
  ToolResultHookResult,
} from '@vostride/agent-qa-schema'

import type {
  ContextHook,
  HookRegistryOptions,
  ProviderRequestHook,
  ProviderRequestParams,
  ToolCallHook,
  ToolResultHook,
} from './interfaces'

export class HookRegistry {
  private readonly toolCallHooks: ToolCallHook[] = []
  private readonly toolResultHooks: ToolResultHook[] = []
  private readonly contextHooks: ContextHook[] = []
  private readonly providerRequestHooks: ProviderRequestHook[] = []

  constructor(private readonly options: HookRegistryOptions = {}) {}

  registerToolCall(hook: ToolCallHook): void {
    this.toolCallHooks.push(hook)
  }

  registerToolResult(hook: ToolResultHook): void {
    this.toolResultHooks.push(hook)
  }

  registerContext(hook: ContextHook): void {
    this.contextHooks.push(hook)
  }

  registerProviderRequest(hook: ProviderRequestHook): void {
    this.providerRequestHooks.push(hook)
  }

  runToolCall<TCall>(call: TCall): ToolCallHookResult<TCall> {
    let currentCall = call

    for (const hook of this.toolCallHooks as ToolCallHook<TCall>[]) {
      const result = hook(currentCall)

      if (result.action === 'deny') {
        this.auditToolCallDeny(result)
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

  runProviderRequest<TParams extends ProviderRequestParams>(params: TParams): TParams {
    let currentParams = params

    for (const hook of this.providerRequestHooks as ProviderRequestHook<TParams>[]) {
      currentParams = hook(currentParams)
    }

    return currentParams
  }

  private auditToolCallDeny(result: ToolCallHookDenyResult): void {
    this.options.auditSink?.appendExecutionAudit({
      riskTier: result.policy?.riskTier ?? 'restricted',
      verdict: result.policy?.verdict ?? 'deny',
      reason: result.reason,
    })
  }
}

export function createHookRegistry(options?: HookRegistryOptions): HookRegistry {
  return new HookRegistry(options)
}
