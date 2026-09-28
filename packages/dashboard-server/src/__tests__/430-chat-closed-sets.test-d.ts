import { expectTypeOf, test } from 'vitest'

import type { ChatRouteHandlerName } from '../chat/chat-routes.js'
import type { AGENT_HOST_MEMBERS, AgentHost } from '../chat/host.js'

test('C430-CHAT-ROUTE-TABLE-EXACT', () => {
  type Expected = 'runConfirm' | 'runConfirmChannel'
  expectTypeOf<ChatRouteHandlerName>().toEqualTypeOf<Expected>()
  expectTypeOf<Exclude<ChatRouteHandlerName, Expected>>().toEqualTypeOf<never>()
  expectTypeOf<Exclude<Expected, ChatRouteHandlerName>>().toEqualTypeOf<never>()
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
