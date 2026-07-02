import { expectTypeOf } from 'vitest'
import { asRunId, type RunSession } from '@vostride/agent-qa-schema'

import { resolveExecutionContext } from '../execution-context'

const session: RunSession = {
  id: asRunId('run_execution_context'),
  status: 'passed',
  executionContext: resolveExecutionContext({ isTty: false, ciMarkers: true }),
}

expectTypeOf(session.executionContext).toEqualTypeOf<
  'local-interactive' | 'local-headless' | 'ci' | 'cloud'
>()
