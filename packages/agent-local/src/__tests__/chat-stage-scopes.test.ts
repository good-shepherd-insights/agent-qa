// The chat stages' capability grant (Phase 394, WTST-01).
//
// `CHAT_STAGE_SCOPES` enumerates the capability union member-by-member, so a member the constant
// does not list is a capability chat cannot reach AT ALL — the invoke gate refuses it before any
// op runs. That makes this list load-bearing for 394's authoring loop in a way no op-level test
// would catch: the loop would refuse for a reason that has nothing to do with the loop.

import { FunctionScopeSchema } from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'

import {
  CHAT_PLANNER_CALLER,
  CHAT_RESOLVER_CALLER,
  CHAT_STAGE_SCOPES,
} from '../composition/compose-local-agent.js'

describe('CHAT_STAGE_SCOPES', () => {
  it('carries test-write, so the chat planner can reach the authoring loop', () => {
    expect(CHAT_STAGE_SCOPES).toContain('test-write')
    expect(CHAT_PLANNER_CALLER.grantedScopes).toContain('test-write')
    expect(CHAT_RESOLVER_CALLER.grantedScopes).toContain('test-write')
  })

  it('enumerates the whole capability union, member for member', () => {
    // Not a restatement of the case above: this one goes red when a LATER phase mints a seventh
    // scope without deciding whether chat holds it. The two decision points D-03 names — the
    // dispatch ask-tier confirm and the 391 inbox accept — are what constrain what chat may do
    // with a grant; silently withholding the grant would be a refusal nobody chose.
    expect([...CHAT_STAGE_SCOPES].sort()).toEqual([...FunctionScopeSchema.options].sort())
  })

  it('mints both stage callers identical but for origin (392 / 391 D-06)', () => {
    expect(CHAT_PLANNER_CALLER.grantedScopes).toEqual(CHAT_RESOLVER_CALLER.grantedScopes)
    expect(CHAT_RESOLVER_CALLER.origin).toBe('human')
    expect(CHAT_PLANNER_CALLER.origin).toBe('agent')
  })
})
