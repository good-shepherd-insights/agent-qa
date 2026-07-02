import type { ExecutionContext } from '@vostride/agent-qa-schema'

export interface ExecutionContextSignals {
  isTty: boolean
  ciMarkers: boolean
}

export function resolveExecutionContext(
  signals: ExecutionContextSignals,
  override?: ExecutionContext,
): ExecutionContext {
  if (override !== undefined) return override
  if (signals.ciMarkers) return 'ci'
  if (signals.isTty) return 'local-interactive'
  return 'local-headless'
}

export type ExecutionContextResolver = () => ExecutionContext

let active: ExecutionContextResolver = () => 'local-headless'

export function setActiveExecutionContextResolver(resolve: ExecutionContextResolver): void {
  active = resolve
}

export function getActiveExecutionContext(): ExecutionContext {
  return active()
}

export function requiresFailClosed(ctx: ExecutionContext): boolean {
  return ctx !== 'local-interactive'
}
