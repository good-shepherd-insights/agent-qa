import { describe, expect, it } from 'vitest'

import {
  CURRENT_CHAT_SESSION_SCHEMA_VERSION,
  ChatSessionEventSchemaError,
  guardChatSessionEvent,
} from '../index'

const userMessage = {
  kind: 'user_message',
  turnId: 'turn-1',
  at: '2026-08-21T09:00:00.000Z',
  text: 'list the runs',
}

describe('user records stamps', () => {
  it('reads a chat event from a session stamped 2', () => {
    expect(CURRENT_CHAT_SESSION_SCHEMA_VERSION).toBe(2)
    expect(guardChatSessionEvent(userMessage, 2)).toEqual(userMessage)
  })

  it.each([1, 3])('refuses a chat event from a session stamped %i', (stamp) => {
    expect(() => guardChatSessionEvent(userMessage, stamp)).toThrow(ChatSessionEventSchemaError)
  })
})
