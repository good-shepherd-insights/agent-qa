import type { ExecutionPolicyResult } from './risk-tier'

export interface ToolCallHookAllowResult<TCall = unknown> {
  action: 'allow'
  call: TCall
}

export interface ToolCallHookMutateResult<TCall = unknown> {
  action: 'mutate'
  mutated: TCall
  reason?: string
}

export interface ToolCallHookDenyResult {
  action: 'deny'
  reason: string
  policy?: ExecutionPolicyResult
}

export type ToolCallHookResult<TCall = unknown> =
  | ToolCallHookAllowResult<TCall>
  | ToolCallHookMutateResult<TCall>
  | ToolCallHookDenyResult

export interface ToolResultHookResult<TResult = unknown> {
  result: TResult
}

export interface ContextHookResult<TContext = unknown> {
  context: TContext
}
