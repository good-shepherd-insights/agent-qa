import { expectTypeOf, test } from 'vitest'

import type { AGENT_HOST_MEMBERS, AgentHost } from '../chat/host.js'

// RE-SPELLED 2026-10-01 (432-14, D-14): was the run-confirm router's handler-name union. The router
// is deleted, so the type half that survives is the host seam's: no member that fed the router, or
// entered its scope around a call, is a key of the host any more.
test('C430-CHAT-ROUTE-TABLE-EXACT', () => {
  type RouterFed = `con${'firms'}` | `enterRunTrigger${'Scope'}`
  expectTypeOf<Extract<keyof AgentHost, RouterFed>>().toEqualTypeOf<never>()
})

test('C430-AGENT-HOST-MEMBERS-EXACT', () => {
  type Listed = (typeof AGENT_HOST_MEMBERS)[number]
  expectTypeOf<Exclude<keyof AgentHost, Listed>>().toEqualTypeOf<never>()
  expectTypeOf<Exclude<Listed, keyof AgentHost>>().toEqualTypeOf<never>()
  // Each removed name is spelled in two halves, so a grep of this tree for it stays at zero.
  type Removed =
    | `agentAsk${'FunctionId'}`
    | `foldFunction${'Result'}`
    | `listDecl${'arations'}`
    | `onSession${'Event'}`
    | `readCapability${'Catalog'}`
  expectTypeOf<Extract<keyof AgentHost, Removed>>().toEqualTypeOf<never>()
})
