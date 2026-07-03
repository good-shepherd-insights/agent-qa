// Abort / step-timeout helpers for the runner-owned step-execution loop.
// CRITICAL: provider-neutral + storage-neutral. No node:* imports, no fs/sharp,
// no model/core/adapter package imports. Pure AbortSignal plumbing.
// Moved verbatim from core/src/agent/loop.ts:15-64 (D-02); core orchestration
// (agent/runner.ts, suite/runner.ts) imports these from the runner barrel.

export type AgentAbortScope = 'test' | 'step'

export interface AgentTimeoutAbortReason {
  type: 'agent-qa-timeout'
  scope: AgentAbortScope
  timeoutMs: number
  message: string
}

export function createTimeoutAbortReason(scope: AgentAbortScope, timeoutMs: number): AgentTimeoutAbortReason {
  const label = scope === 'test' ? 'Test' : 'Step'
  return {
    type: 'agent-qa-timeout',
    scope,
    timeoutMs,
    message: `${label} timed out after ${timeoutMs}ms`,
  }
}

export function getTimeoutAbortReason(signal: AbortSignal | undefined): AgentTimeoutAbortReason | undefined {
  const reason = signal?.reason
  if (!reason || typeof reason !== 'object') return undefined
  const maybeReason = reason as Partial<AgentTimeoutAbortReason>
  return maybeReason.type === 'agent-qa-timeout'
    && (maybeReason.scope === 'test' || maybeReason.scope === 'step')
    && typeof maybeReason.timeoutMs === 'number'
    && typeof maybeReason.message === 'string'
    ? maybeReason as AgentTimeoutAbortReason
    : undefined
}

export async function withAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (!signal) return await promise
  if (signal.aborted) throw signal.reason ?? new Error('Operation aborted')

  let onAbort: (() => void) | undefined
  const abortPromise = new Promise<T>((_, reject) => {
    onAbort = () => reject(signal.reason ?? new Error('Operation aborted'))
    signal.addEventListener('abort', onAbort, { once: true })
  })

  try {
    return await Promise.race([promise, abortPromise])
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort)
  }
}
