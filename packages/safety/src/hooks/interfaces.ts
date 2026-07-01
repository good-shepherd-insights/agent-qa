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
