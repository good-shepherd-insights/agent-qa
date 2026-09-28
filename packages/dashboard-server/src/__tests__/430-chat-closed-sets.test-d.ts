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
  expectTypeOf<
    Extract<
      keyof AgentHost,
      | 'agentAskFunctionId'
      | 'foldFunctionResult'
      | 'listDeclarations'
      | 'onSessionEvent'
      | 'readCapabilityCatalog'
    >
  >().toEqualTypeOf<never>()
})
