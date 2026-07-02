import type {
  ContextHookResult,
  ToolCallHookResult,
  ToolResultHookResult,
} from '@vostride/agent-qa-schema'
import type { LanguageModelMiddleware } from 'ai'

import type { AuditSink } from '../ports/audit-sink'

export type ProviderRequestParams =
  Parameters<NonNullable<LanguageModelMiddleware['transformParams']>>[0]['params']

export interface ToolCallHook<TCall = unknown> {
  (call: TCall): ToolCallHookResult<TCall>
}

export interface AsyncToolCallHook<TCall = unknown> {
  (call: TCall): Promise<ToolCallHookResult<TCall>>
}

export interface ToolResultHook<TResult = unknown> {
  (result: TResult): ToolResultHookResult<TResult>
}

export interface ContextHook<TContext = unknown> {
  (context: TContext): ContextHookResult<TContext>
}

export interface ProviderRequestHook<TParams = ProviderRequestParams> {
  (params: TParams): TParams
}

export interface HookRegistryOptions {
  auditSink?: AuditSink
}

// The run-facing surface consumers (core's agent loop, the HOOK-FUT-01 wire-in
// point) depend on. It deliberately excludes every register method so the
// registration surface never leaks past the safety package.
export interface SafetyHookRunner {
  runToolCall<TCall>(call: TCall): ToolCallHookResult<TCall>
  runToolResult<TResult>(result: TResult): ToolResultHookResult<TResult>
  runContext<TContext>(context: TContext): ContextHookResult<TContext>
  runProviderRequest(params: ProviderRequestParams): ProviderRequestParams
  runToolCallAsync<TCall>(call: TCall): Promise<ToolCallHookResult<TCall>>
}
