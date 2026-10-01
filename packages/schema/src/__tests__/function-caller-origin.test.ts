import { describe, expect, it } from 'vitest'

import {
  CHAT_SESSION_EVENT_KINDS,
  CURRENT_CHAT_SESSION_SCHEMA_VERSION,
  ClauseReceiptSchema,
  FUNCTION_CALLER_ORIGINS,
  FunctionScopeSchema,
  guardChatSessionEvent,
} from '../index'
import type { FunctionCaller } from '../index'

describe('the actor-origin axis (391 D-06)', () => {
  it('is closed at exactly two members', () => {
    expect(FUNCTION_CALLER_ORIGINS).toEqual(['human', 'agent'])
  })

  it('has no third "unknown" member for a default to hide in', () => {
    // The fail-closed half of the design. A third value would need a rule, every safe rule for
    // it reads "treat it as agent", and a vocabulary with a member that always means another
    // member is two spellings of one thing.
    expect(FUNCTION_CALLER_ORIGINS).not.toContain('unknown')
    expect(FUNCTION_CALLER_ORIGINS).toHaveLength(2)
  })

  it('is REQUIRED on the caller record — an omitted origin never defaults to human', () => {
    // The type-level claim, driven rather than asserted in prose. Both lines are rejected by
    // `tsc`, which is the only authority here; vitest's own typecheck line has printed
    // "no errors" beside real tsc failures in this repo.
    // @ts-expect-error a caller record with no origin does not type
    const withoutOrigin: FunctionCaller = { surface: 'cli', grantedScopes: [], safeMode: false }
    const invented: FunctionCaller = {
      surface: 'cli',
      grantedScopes: [],
      safeMode: false,
      // @ts-expect-error the union admits nothing but its two members
      origin: 'system',
    }
    void withoutOrigin
    void invented
  })
})

describe('the capability-scope union', () => {
  it('carries test-write as a sixth, distinct member (394 WTST-01)', () => {
    expect(FunctionScopeSchema.options).toEqual([
      'read',
      'run',
      'config-write',
      'knowledge-write',
      'approval-write',
      'test-write',
    ])
    expect(FunctionScopeSchema.options).toHaveLength(6)
  })

  it('refuses anything off the union', () => {
    expect(FunctionScopeSchema.safeParse('approval-write').success).toBe(true)
    expect(FunctionScopeSchema.safeParse('test-write').success).toBe(true)
    expect(FunctionScopeSchema.safeParse('approvals-write').success).toBe(false)
    expect(FunctionScopeSchema.safeParse('tests-write').success).toBe(false)
    expect(FunctionScopeSchema.safeParse('write').success).toBe(false)
  })

  it('keeps approval-write distinct from knowledge-write', () => {
    // The privilege-conflation counter-note, made checkable: changing what the system LEARNED
    // and changing what it may do WITHOUT ASKING are two grants, so a caller can hold either
    // without the other.
    const knowledgeOnly: FunctionCaller = {
      surface: 'synthetic',
      grantedScopes: ['knowledge-write'],
      safeMode: false,
      origin: 'human',
    }
    expect(knowledgeOnly.grantedScopes).not.toContain('approval-write')
  })

  it('keeps test-write distinct from run', () => {
    // 394's counter-note, made checkable on the same pattern: executing this project's tests and
    // authoring new ones into the repository are two grants, so a caller can hold either without
    // the other.
    const runOnly: FunctionCaller = {
      surface: 'synthetic',
      grantedScopes: ['run', 'read'],
      safeMode: false,
      origin: 'agent',
    }
    expect(runOnly.grantedScopes).not.toContain('test-write')
  })
})

// 2026-10-01 (432-19, D-14/D-22). The origin axis's surviving reader is the clause RECEIPT: every
// receipt names the origin the composition minted, and that is the contract the axis keeps once the
// execution gate (which decided by it) is deleted. No new origin label is introduced, and the one
// approval record the axis ever attributed — `approval_decision` — stays a READABLE historical kind
// with no writer, so a session file a pre-432 build wrote still opens.
describe('the origin axis after the gate (432-19)', () => {
  it('C432-HISTORICAL-READER: the clause receipt carries origin, with its exact key set', () => {
    expect(Object.keys(ClauseReceiptSchema.shape).sort()).toEqual(
      ['clause', 'functionId', 'origin', 'outcome', 'status'],
    )
    for (const origin of FUNCTION_CALLER_ORIGINS) {
      expect(ClauseReceiptSchema.parse({
        clause: 'show the last run', functionId: 'runs.list', origin, status: 'executed', outcome: 'ok',
      }).origin).toBe(origin)
    }
  })

  it('C432-HISTORICAL-READER: a pre-432 approval_decision line still parses, both sources and all three decisions', () => {
    expect(CHAT_SESSION_EVENT_KINDS).toContain('approval_decision')
    for (const source of ['gate', 'verb'] as const) {
      for (const decision of ['accept', 'accept-always', 'deny'] as const) {
        const line = {
          kind: 'approval_decision',
          turnId: 't_0001',
          at: '2026-09-01T10:00:00.000Z',
          actionClass: 'fn:authoring.draft.write',
          decision,
          source,
        }
        expect(guardChatSessionEvent(line, CURRENT_CHAT_SESSION_SCHEMA_VERSION)).toEqual(line)
      }
    }
  })

  it('C432-HISTORICAL-READER: the historical kind keeps its exact key set — no field is added or dropped', () => {
    const line = {
      kind: 'approval_decision',
      turnId: 't_0001',
      at: '2026-09-01T10:00:00.000Z',
      actionClass: 'fn:runs.mark',
      decision: 'deny',
      source: 'gate',
    }
    expect(() => guardChatSessionEvent({ ...line, origin: 'human' }, CURRENT_CHAT_SESSION_SCHEMA_VERSION))
      .toThrow(/approval_decision/)
    const { source: _source, ...withoutSource } = line
    expect(() => guardChatSessionEvent(withoutSource, CURRENT_CHAT_SESSION_SCHEMA_VERSION))
      .toThrow(/approval_decision/)
  })

  it('C432-HISTORICAL-READER: the origin vocabulary gains no approval-shaped label', () => {
    expect([...FUNCTION_CALLER_ORIGINS]).toEqual(['human', 'agent'])
    for (const retired of ['approved', 'confirmed', 'granted', 'trusted']) {
      expect(FUNCTION_CALLER_ORIGINS as readonly string[]).not.toContain(retired)
    }
  })
})
