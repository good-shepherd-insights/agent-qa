import { expectTypeOf, test } from 'vitest'

import type { ComposeCliLocalAgentInput } from '../local-agent-host.js'

test('C430-NO-SESSION-SURFACE-OPTION: ComposeCliLocalAgentInput takes no session-surface tag', () => {
  expectTypeOf<Extract<keyof ComposeCliLocalAgentInput, 'sessionSurface'>>().toEqualTypeOf<never>()
})

test('C430-NO-SESSION-SURFACE-OPTION: ComposeCliLocalAgentInput keeps the CLI chat and ask options', () => {
  type Kept = 'mintingSurface' | 'observeSessionEvent'
  expectTypeOf<Extract<keyof ComposeCliLocalAgentInput, Kept>>().toEqualTypeOf<Kept>()
})
