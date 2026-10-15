import { describe, expect, it } from 'vitest'

import {
  createMaskingContext,
  getActiveExecutionContext,
  getActiveMaskingContext,
} from '@vostride/agent-qa-safety'

import * as surface from '../index'
import { detectExecutionContext } from '../execution-context-detector'
import { runSafetyScope } from '../safety-scope'

describe('runSafetyScope', () => {
  it('resolves the full bundle inside the scope, across awaits (Test 1)', async () => {
    const ctx = createMaskingContext()

    await runSafetyScope(
      { maskingContext: ctx, executionContext: 'cloud' },
      async () => {
        expect(getActiveMaskingContext()).toBe(ctx)
        expect(getActiveExecutionContext()).toBe('cloud')

        await Promise.resolve()

        expect(getActiveMaskingContext()).toBe(ctx)
        expect(getActiveExecutionContext()).toBe('cloud')
      },
    )
  })

  it('falls back outside any scope: masking undefined, ctx=detector, sink=memoized default (Test 2)', () => {
    expect(getActiveMaskingContext()).toBeUndefined()
    expect(getActiveExecutionContext()).toBe(detectExecutionContext())
  })

  it('restores the outer bundle after an inner scope returns (Test 3)', () => {
    const outer = createMaskingContext()
    const inner = createMaskingContext()

    runSafetyScope({ maskingContext: outer, executionContext: 'ci' }, () => {
      expect(getActiveMaskingContext()).toBe(outer)
      expect(getActiveExecutionContext()).toBe('ci')

      runSafetyScope({ maskingContext: inner, executionContext: 'cloud' }, () => {
        expect(getActiveMaskingContext()).toBe(inner)
        expect(getActiveExecutionContext()).toBe('cloud')
      })

      expect(getActiveMaskingContext()).toBe(outer)
      expect(getActiveExecutionContext()).toBe('ci')
    })

    expect(getActiveMaskingContext()).toBeUndefined()
  })

  it('returns fn() result, including resolved async values (Test 4)', async () => {
    const sync = runSafetyScope({}, () => 42)
    expect(sync).toBe(42)

    const asyncValue = await runSafetyScope({}, async () => {
      await Promise.resolve()
      return 'done'
    })
    expect(asyncValue).toBe('done')
  })

  it('keeps interleaved sibling scopes isolated — D-02 concurrent-run clobber fix (Test 6)', async () => {
    const ctxA = createMaskingContext()
    const ctxB = createMaskingContext()

    await Promise.all([
      runSafetyScope(
        { maskingContext: ctxA, executionContext: 'ci' },
        async () => {
          expect(getActiveMaskingContext()).toBe(ctxA)
          expect(getActiveExecutionContext()).toBe('ci')
          await Promise.resolve()
          expect(getActiveMaskingContext()).toBe(ctxA)
          expect(getActiveExecutionContext()).toBe('ci')
        },
      ),
      runSafetyScope(
        { maskingContext: ctxB, executionContext: 'cloud' },
        async () => {
          expect(getActiveMaskingContext()).toBe(ctxB)
          expect(getActiveExecutionContext()).toBe('cloud')
          await Promise.resolve()
          expect(getActiveMaskingContext()).toBe(ctxB)
          expect(getActiveExecutionContext()).toBe('cloud')
        },
      ),
    ])

    expect(getActiveMaskingContext()).toBeUndefined()
  })

  it('is exported from the safety-local barrel (reachability)', () => {
    expect(surface.runSafetyScope).toBe(runSafetyScope)
  })

  // 2026-10-15 (441-44, D-15): moved from the deleted jsonl-audit-sink.test.ts with the sink class
  // gone from the roster.
  it('exports only the fingerprint helper, masking scope binding and its ambient resolver, and execution-context detector', () => {
    expect(Object.keys(surface).sort()).toEqual([
      'ambientMaskingContextResolver',
      'detectExecutionContext',
      'fingerprint',
      'runSafetyScope',
    ])
  })
})
