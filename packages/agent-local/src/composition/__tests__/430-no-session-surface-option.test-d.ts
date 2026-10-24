import { expectTypeOf, test } from 'vitest'

import type { ComposeLocalAgentInput } from '../compose-local-agent.js'

test('C430-NO-SESSION-SURFACE-OPTION: ComposeLocalAgentInput takes no session-surface tag', () => {
  expectTypeOf<Extract<keyof ComposeLocalAgentInput, 'sessionSurface'>>().toEqualTypeOf<never>()
})

// 2026-10-01 (432-17, D-05): `mintingSurface` stamped the proposal records the inbox held, and is
// deleted with them; `observeSessionEvent` is the CLI chat and ask option that stays.
test('C430-NO-SESSION-SURFACE-OPTION: ComposeLocalAgentInput keeps the CLI chat and ask options', () => {
  type Kept = 'observeSessionEvent'
  expectTypeOf<Extract<keyof ComposeLocalAgentInput, Kept>>().toEqualTypeOf<Kept>()
  expectTypeOf<Extract<keyof ComposeLocalAgentInput, 'mintingSurface'>>().toEqualTypeOf<never>()
})
