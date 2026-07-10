// The RPLY-01 belt-and-braces clause: a hard-error adapter-shaped stub. plan() structurally
// touches no adapter on the replay path, but anywhere an adapter-shaped object is demanded
// this stub stands in and hard-errors from every method — replay never acts. execute() is
// first among them; every action-capable method throws unconditionally.

import type { PlatformAdapter } from '@vostride/agent-qa-runner'
import type { ScreenState } from '@vostride/agent-qa-schema'

/**
 * Thrown by every method of the null adapter. Replay measures the recorded decision
 * function only; it must never drive a live platform. The engine surfaces this as a hard
 * harness error if any code path ever reaches for the adapter.
 */
export class ReplayExecutionForbiddenError extends Error {
  constructor(message = 'replay never executes') {
    super(message)
    this.name = 'ReplayExecutionForbiddenError'
  }
}

/**
 * An adapter-shaped stand-in whose every method throws {@link ReplayExecutionForbiddenError}
 * synchronously. Typed as the runner's {@link PlatformAdapter}; the shared `forbid` thunk
 * returns `never`, which structurally satisfies each method's Promise/array return type.
 */
export function createNullAdapter(
  platform: ScreenState['platform'] = 'web',
): PlatformAdapter {
  const forbid = (): never => {
    throw new ReplayExecutionForbiddenError()
  }
  return {
    platform,
    setup: forbid,
    cleanup: forbid,
    observe: forbid,
    execute: forbid,
    screenshot: forbid,
    drainConsoleLogs: forbid,
    drainNetworkLogs: forbid,
  }
}
