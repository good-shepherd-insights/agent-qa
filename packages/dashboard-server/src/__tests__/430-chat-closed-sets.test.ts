// THE CONFIRM ROUTER'S CLOSED SETS (430 D-02).
//
// The type half is pinned in the sibling `.test-d.ts`; this is the runtime half, so a reordered or
// padded table is caught even where the handler union still agrees.

import { describe, expect, it } from 'vitest'

import { CHAT_ROUTE_TABLE } from '../chat/chat-routes.js'

describe('the confirm router closed sets (430)', () => {
  it('C430-CHAT-ROUTE-TABLE-EXACT: the router serves the run-confirm pair and nothing else', () => {
    expect(CHAT_ROUTE_TABLE.map((row) => [row.method, row.path, row.handler])).toEqual([
      ['POST', '/api/run-confirm/answer', 'runConfirm'],
      ['GET', '/api/run-confirm/channel', 'runConfirmChannel'],
    ])
  })
})
