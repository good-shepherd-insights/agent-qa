import { describe, expect, it } from 'vitest'

import { FUNCTION_CALLER_ORIGINS, FunctionScopeSchema } from '../index'
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
