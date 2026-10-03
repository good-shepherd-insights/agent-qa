import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

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

// 2026-10-03 (quick-261003-tsr, IN-39): every directory a cell makes is removed after it.
const madeDirs: string[] = []
afterEach(() => {
  for (const dir of madeDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  madeDirs.push(dir)
  return dir
}

function fakeSink(): AuditSink {
  return { appendGuardrailAudit() {} }
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

  // 432-19 (D-17/D-22), task 2: the concurrency edge of the guardrail-only sink. Two runs resolve
  // their own durable sinks through the ambient resolver at once; each run directory holds a legacy
  // execution trail an older build left. Each run's guardrail rows land in its own directory, nothing
  // crosses, and neither legacy trail is read, rewritten or joined by a new one.
  it('C432-AUDIT-UNREAD: interleaved runs append their own guardrail rows and leave each legacy execution trail untouched', async () => {
    const runDirs = [tempDir('scope-run-a-'), tempDir('scope-run-b-')]
    const legacy = runDirs.map((dir, index) => {
      const bytes = `{"ts":"2026-09-01T10:00:0${String(index)}.000Z","verdict":"deny","outcome":"blocked"}\n`
      writeFileSync(join(dir, 'execution_audit.jsonl'), bytes)
      return bytes
    })

    await Promise.all(runDirs.map((dir, index) => runSafetyScope(
      { auditSink: new JsonlAuditSink(dir), executionContext: index === 0 ? 'ci' : 'local-headless' },
      async () => {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          await Promise.resolve()
          getActiveAuditSink()?.appendGuardrailAudit({ runId: `run-${String(index)}`, action: 'pass' })
        }
      },
    )))

    runDirs.forEach((dir, index) => {
      expect(readFileSync(join(dir, 'execution_audit.jsonl'), 'utf8')).toBe(legacy[index])
      const rows = readFileSync(join(dir, 'guardrail_audit.jsonl'), 'utf8').trim().split('\n')
        .map((line) => JSON.parse(line) as Record<string, unknown>)
      expect(rows).toHaveLength(3)
      expect(rows.every((row) => row.runId === `run-${String(index)}`)).toBe(true)
    })
    // And a run directory that had no legacy trail never gets one.
    const fresh = tempDir('scope-run-c-')
    runSafetyScope({ auditSink: new JsonlAuditSink(fresh) }, () => {
      getActiveAuditSink()?.appendGuardrailAudit({ action: 'pass' })
    })
    expect(existsSync(join(fresh, 'execution_audit.jsonl'))).toBe(false)
  })
})
