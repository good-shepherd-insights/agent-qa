import { expectTypeOf } from 'vitest'
import type { RunId, RunStatus, ExecutionContext } from '../run/index'
import type { RunSession } from '../run/run-session'

expectTypeOf<RunSession['id']>().toEqualTypeOf<RunId>()
expectTypeOf<RunSession['status']>().toEqualTypeOf<RunStatus>()
expectTypeOf<RunSession['executionContext']>().toEqualTypeOf<ExecutionContext>()
expectTypeOf<keyof RunSession>().toEqualTypeOf<'id' | 'status' | 'executionContext'>()

const ok: RunSession = {
  id: '' as RunId,
  status: 'passed',
  executionContext: 'ci',
}

const bad: RunSession = {
  id: '' as RunId,
  // @ts-expect-error RunSession status must use RunStatus terminal values.
  status: 'web',
  executionContext: 'ci',
}

void ok
void bad
