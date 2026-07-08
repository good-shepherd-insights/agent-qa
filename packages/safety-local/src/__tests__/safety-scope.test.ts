import { describe, expect, it } from 'vitest'

import {
  createMaskingContext,
  getActiveAuditSink,
  getActiveExecutionContext,
  getActiveMaskingContext,
  type AuditSink,
} from '@vostride/agent-qa-safety'

import * as surface from '../index'
import { detectExecutionContext } from '../execution-context-detector'
import { JsonlAuditSink } from '../jsonl-audit-sink'
import { runSafetyScope } from '../safety-scope'

function fakeSink(): AuditSink {
  return { appendExecutionAudit() {}, appendGuardrailAudit() {} }
}

describe('runSafetyScope', () => {
  it('resolves the full bundle inside the scope, across awaits (Test 1)', async () => {
    const ctx = createMaskingContext()
    const sink = fakeSink()

    await runSafetyScope(
      { maskingContext: ctx, auditSink: sink, executionContext: 'cloud' },
      async () => {
        expect(getActiveMaskingContext()).toBe(ctx)
        expect(getActiveAuditSink()).toBe(sink)
        expect(getActiveExecutionContext()).toBe('cloud')

        await Promise.resolve()

        expect(getActiveMaskingContext()).toBe(ctx)
        expect(getActiveAuditSink()).toBe(sink)
        expect(getActiveExecutionContext()).toBe('cloud')
      },
    )
  })

  it('falls back outside any scope: masking undefined, ctx=detector, sink=memoized default (Test 2)', () => {
    expect(getActiveMaskingContext()).toBeUndefined()
    expect(getActiveExecutionContext()).toBe(detectExecutionContext())

    const first = getActiveAuditSink()
    const second = getActiveAuditSink()

    expect(first).toBeInstanceOf(JsonlAuditSink)
    expect(second).toBe(first)
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

  it('partial bundle: omitted auditSink falls through to the process default (Test 5)', () => {
    const ctx = createMaskingContext()

    runSafetyScope({ maskingContext: ctx, executionContext: 'cloud' }, () => {
      expect(getActiveMaskingContext()).toBe(ctx)
      expect(getActiveExecutionContext()).toBe('cloud')
      expect(getActiveAuditSink()).toBeInstanceOf(JsonlAuditSink)
    })
  })

  it('keeps interleaved sibling scopes isolated — D-02 concurrent-run clobber fix (Test 6)', async () => {
    const ctxA = createMaskingContext()
    const ctxB = createMaskingContext()
    const sinkA = fakeSink()
    const sinkB = fakeSink()

    await Promise.all([
      runSafetyScope(
        { maskingContext: ctxA, auditSink: sinkA, executionContext: 'ci' },
        async () => {
          expect(getActiveMaskingContext()).toBe(ctxA)
          expect(getActiveAuditSink()).toBe(sinkA)
          expect(getActiveExecutionContext()).toBe('ci')
          await Promise.resolve()
          expect(getActiveMaskingContext()).toBe(ctxA)
          expect(getActiveAuditSink()).toBe(sinkA)
          expect(getActiveExecutionContext()).toBe('ci')
        },
      ),
      runSafetyScope(
        { maskingContext: ctxB, auditSink: sinkB, executionContext: 'cloud' },
        async () => {
          expect(getActiveMaskingContext()).toBe(ctxB)
          expect(getActiveAuditSink()).toBe(sinkB)
          expect(getActiveExecutionContext()).toBe('cloud')
          await Promise.resolve()
          expect(getActiveMaskingContext()).toBe(ctxB)
          expect(getActiveAuditSink()).toBe(sinkB)
          expect(getActiveExecutionContext()).toBe('cloud')
        },
      ),
    ])

    expect(getActiveMaskingContext()).toBeUndefined()
  })

  it('process-default sink is a lazily-constructed memoized singleton, never clobbered by scopes (Test 7)', () => {
    const scopedSink = fakeSink()

    const outerDefault = getActiveAuditSink()
    expect(outerDefault).toBeInstanceOf(JsonlAuditSink)

    runSafetyScope({ auditSink: scopedSink }, () => {
      // an active scope with its own sink never consults the process default
      expect(getActiveAuditSink()).toBe(scopedSink)
    })

    // the memoized process-default survives the scope transition — same instance,
    // proving it is a single lazily-built singleton, not reconstructed per resolution
    expect(getActiveAuditSink()).toBe(outerDefault)
  })

  it('is exported from the safety-local barrel (reachability)', () => {
    expect(surface.runSafetyScope).toBe(runSafetyScope)
  })
})
