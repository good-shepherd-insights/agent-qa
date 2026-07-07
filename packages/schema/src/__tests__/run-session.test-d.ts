import { expectTypeOf } from 'vitest'
import type { RunId, RunStatus, ExecutionContext } from '../run/index'
import type { RunCompletion, RunSession } from '../run/run-session'

// M1-lite contract (D-13, SESSION-01): identity + status, the subscribe/replay seam,
// run-level cancel, awaitable done. liveUrl/arbiter/control stay ABSENT (M5).
expectTypeOf<RunSession['id']>().toEqualTypeOf<RunId>()
expectTypeOf<RunSession['status']>().toEqualTypeOf<'running' | RunStatus>()
expectTypeOf<RunSession['executionContext']>().toEqualTypeOf<ExecutionContext>()
expectTypeOf<RunSession['cancel']>().toEqualTypeOf<() => void>()
expectTypeOf<RunSession['done']>().toEqualTypeOf<Promise<RunCompletion>>()
expectTypeOf<RunSession['subscribe']>().parameter(0).toEqualTypeOf<number>()
expectTypeOf<RunSession['subscribe']>().returns.toEqualTypeOf<() => void>()
expectTypeOf<keyof RunSession>().toEqualTypeOf<
  'id' | 'status' | 'executionContext' | 'subscribe' | 'cancel' | 'done'
>()

const ok: RunSession = {
  id: '' as RunId,
  status: 'running',
  executionContext: 'ci',
  subscribe: () => () => {},
  cancel: () => {},
  done: Promise.resolve({} as RunCompletion),
}

const bad: RunSession = {
  id: '' as RunId,
  // @ts-expect-error RunSession status must be 'running' or a RunStatus terminal value.
  status: 'web',
  executionContext: 'ci',
  subscribe: () => () => {},
  cancel: () => {},
  done: Promise.resolve({} as RunCompletion),
}

void ok
void bad
