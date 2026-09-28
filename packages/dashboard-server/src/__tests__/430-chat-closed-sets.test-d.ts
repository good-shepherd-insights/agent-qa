import { expectTypeOf, test } from 'vitest'

import type { ChatRouteHandlerName } from '../chat/chat-routes.js'

test('C430-CHAT-ROUTE-TABLE-EXACT', () => {
  type Expected = 'runConfirm' | 'runConfirmChannel'
  expectTypeOf<ChatRouteHandlerName>().toEqualTypeOf<Expected>()
  expectTypeOf<Exclude<ChatRouteHandlerName, Expected>>().toEqualTypeOf<never>()
  expectTypeOf<Exclude<Expected, ChatRouteHandlerName>>().toEqualTypeOf<never>()
})
