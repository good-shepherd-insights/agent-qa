import { expectTypeOf, test } from 'vitest'

import type { ComposeCliLocalAgentInput } from '../local-agent-host.js'

test('C430-NO-SESSION-SURFACE-OPTION: ComposeCliLocalAgentInput takes no session-surface tag', () => {
  expectTypeOf<Extract<keyof ComposeCliLocalAgentInput, 'sessionSurface'>>().toEqualTypeOf<never>()
})

// 2026-10-01 (432-17, D-05): `mintingSurface` stamped the proposal records the inbox held, and is
// deleted with them; `observeSessionEvent` is the CLI chat and ask option that stays.
test('C430-NO-SESSION-SURFACE-OPTION: ComposeCliLocalAgentInput keeps the CLI chat and ask options', () => {
  type Kept = 'observeSessionEvent'
  expectTypeOf<Extract<keyof ComposeCliLocalAgentInput, Kept>>().toEqualTypeOf<Kept>()
  expectTypeOf<Extract<keyof ComposeCliLocalAgentInput, 'mintingSurface'>>().toEqualTypeOf<never>()
})
