// The stream result kind, exercised end-to-end against the injected event-log reader
// (Phase 384, Plan 04 — FUNC-07 / D-08 / D-11).
//
// D-08: a stream op resolves a typed async iterable of seq-stamped envelopes, and each
// envelope's own `seq` IS the resume token — a caller that observed seq N re-invokes with
// `lastEventId: N` and receives N+1 onward. Connection-independent by construction, so
// 386's live attach is contract-identical to this completed-run replay.
//
// The gate is NOT stubbed in the pipeline case: `invokeFunction` calls the real `evaluate`,
// so "the execution-audit row exists before the first event is yielded" is proven against
// the shipped classifier rather than against a fake gate.

import { ReplayIncompleteError } from '@vostride/agent-qa-runner'
import { MASKED_RESOLVED_CONFIG_SCHEMA_VERSION } from '@vostride/agent-qa-schema'
import type {
  ExecutionContext,
  FunctionCaller,
  RunEventEnvelope,
  RunEventType,
  RunId,
} from '@vostride/agent-qa-schema'
import type { AuditSink, ExecutionAuditRow, GuardrailAuditRow } from '@vostride/agent-qa-safety'
import { describe, expect, it } from 'vitest'

import { invokeFunction } from '../functions/invoke.js'
import {
  RUNS_EVENTS_FUNCTION_ID,
  StreamReplayFloorError,
  runsEventsSpec,
} from '../functions/ops/runs-events.js'
import { createRegistryFromSpecs } from '../functions/registry.js'
import type { FunctionDeps, FunctionStream } from '../functions/spec.js'

const RUN_ID = 'run-alpha' as RunId
const FIXED_CONTEXT: () => ExecutionContext = () => 'local-interactive'

function envelope(seq: number, type: RunEventType = 'heartbeat'): RunEventEnvelope {
  return { seq, ts: 1_000 + seq, runId: RUN_ID, type, payload: {} }
}

/** A five-event completed-run log, gap-free at seq 1 exactly as the v49 bus writes it. */
const FIVE_EVENTS: readonly RunEventEnvelope[] = [
  envelope(1, 'runStarted'),
  envelope(2, 'testStarted'),
  envelope(3, 'stepStarted'),
  envelope(4, 'testFinished'),
  envelope(5, 'runFinished'),
]

interface EventsReaderSpy {
  deps: FunctionDeps
  calls: () => readonly { runId: string; fromSeq: number }[]
}

/**
 * A fake `EventLogPort`-shaped reader over an in-memory log. `floorAt` reproduces the
 * runner bus's own refusal: a resume request below the earliest retained seq throws
 * `ReplayIncompleteError` rather than serving a silently truncated prefix.
 */
function eventsDeps(options: {
  events?: readonly RunEventEnvelope[]
  floorAt?: number
} = {}): EventsReaderSpy {
  const events = options.events ?? []
  const calls: { runId: string; fromSeq: number }[] = []
  return {
    deps: {
      runs: {
        list: () => Promise.resolve([]),
        get: () => Promise.resolve(undefined),
        readEvents: (runId, fromSeq) => {
          calls.push({ runId, fromSeq })
          if (options.floorAt !== undefined && fromSeq < options.floorAt) {
            return Promise.reject(new ReplayIncompleteError(fromSeq, options.floorAt))
          }
          return Promise.resolve(events.filter((event) => event.seq >= fromSeq))
        },
      },
      knowledge: { listBundles: () => Promise.resolve([]) },
      config: {
        getMasked: () => Promise.resolve({
          schemaVersion: MASKED_RESOLVED_CONFIG_SCHEMA_VERSION,
          configPath: 'agent-qa.config.yaml',
          entries: [],
        }),
      },
    },
    calls: () => calls,
  }
}

interface CapturedSink {
  sink: AuditSink
  executionRows: () => readonly ExecutionAuditRow[]
}

function capturingSink(): CapturedSink {
  const executionRows: ExecutionAuditRow[] = []
  const guardrailRows: GuardrailAuditRow[] = []
  return {
    sink: {
      appendExecutionAudit(row) {
        executionRows.push(row)
      },
      appendGuardrailAudit(row) {
        guardrailRows.push(row)
      },
    },
    executionRows: () => executionRows,
  }
}

const READ_CALLER: FunctionCaller = {
  surface: 'test',
  grantedScopes: ['read'],
  safeMode: false,
}

async function drain(stream: FunctionStream<RunEventEnvelope>): Promise<RunEventEnvelope[]> {
  const collected: RunEventEnvelope[] = []
  for await (const event of stream) {
    collected.push(event)
  }
  return collected
}

describe('runs.events declaration', () => {
  it('declares a read-only STREAM contract bound in this composition', () => {
    expect(runsEventsSpec.id).toBe(RUNS_EVENTS_FUNCTION_ID)
    expect(runsEventsSpec.id).toBe('runs.events')
    expect(runsEventsSpec.requiredScopes).toEqual(['read'])
    expect(runsEventsSpec.resultKind).toBe('stream')
    expect(runsEventsSpec.bindingStatus).toBe('bound')
    expect(runsEventsSpec.risk).toEqual({
      name: 'fn:runs.events',
      recognized: true,
      readOnly: true,
    })
  })

  it('declares the ELEMENT contract as its output schema, not the whole stream', () => {
    const parsed = runsEventsSpec.output.safeParse(envelope(7, 'heartbeat'))

    expect(parsed.success).toBe(true)
    expect(runsEventsSpec.output.safeParse({ seq: 1 }).success).toBe(false)
  })
})

describe('runs.events replay', () => {
  it('resumes at lastEventId + 1 and yields the remainder in seq order', async () => {
    const spy = eventsDeps({ events: FIVE_EVENTS })

    const events = await drain(await runsEventsSpec.invoke({ runId: RUN_ID, lastEventId: 2 }, spy.deps))

    expect(events.map((event) => event.seq)).toEqual([3, 4, 5])
    // The resume arithmetic is the port's contract, so it is asserted at the seam too.
    expect(spy.calls()).toEqual([{ runId: RUN_ID, fromSeq: 3 }])
  })

  it('replays the whole log when no resume token is supplied', async () => {
    const spy = eventsDeps({ events: FIVE_EVENTS })

    const events = await drain(await runsEventsSpec.invoke({ runId: RUN_ID }, spy.deps))

    expect(events.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5])
    expect(spy.calls()).toEqual([{ runId: RUN_ID, fromSeq: 1 }])
  })

  it('yields a completed EMPTY stream for a run that recorded no events', async () => {
    const spy = eventsDeps({ events: [] })

    const events = await drain(await runsEventsSpec.invoke({ runId: RUN_ID }, spy.deps))

    // An empty log is an ordinary result, never a floor refusal: nothing was truncated.
    expect(events).toEqual([])
  })

  it('maps the port replay refusal onto a typed resume-floor error carrying the floor', async () => {
    const spy = eventsDeps({ events: FIVE_EVENTS.slice(3), floorAt: 4 })

    const thrown = await runsEventsSpec
      .invoke({ runId: RUN_ID, lastEventId: 1 }, spy.deps)
      .catch((error: unknown) => error)

    expect(thrown).toBeInstanceOf(StreamReplayFloorError)
    expect((thrown as StreamReplayFloorError).name).toBe('StreamReplayFloorError')
    expect((thrown as StreamReplayFloorError).earliestAvailableSeq).toBe(4)
    expect((thrown as StreamReplayFloorError).requestedSeq).toBe(2)
    expect((thrown as StreamReplayFloorError).runId).toBe(RUN_ID)
    // Never a silently truncated prefix — the caller learns exactly where replay can start.
    expect((thrown as Error).message).toContain('4')
  })
})

describe('runs.events through invokeFunction (D-11 uniform gating)', () => {
  it('audits the invocation BEFORE the first event is yielded', async () => {
    const spy = eventsDeps({ events: FIVE_EVENTS })
    const audit = capturingSink()
    const registry = createRegistryFromSpecs([runsEventsSpec], {
      deps: spy.deps,
      auditSink: audit.sink,
      resolveExecutionContext: FIXED_CONTEXT,
    })

    const result = await invokeFunction(registry, 'runs.events', { runId: RUN_ID }, READ_CALLER)

    // The row exists while the stream is still un-consumed: the gate verdict precedes
    // every byte a caller can observe.
    expect(audit.executionRows()).toHaveLength(1)
    expect(audit.executionRows()[0]).toMatchObject({
      action: 'fn:runs.events',
      riskTier: 'read-only',
      verdict: 'allow',
    })

    const events = await drain(result as FunctionStream<RunEventEnvelope>)
    expect(events.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5])
    expect(audit.executionRows()).toHaveLength(1)
  })

  it('returns the async iterable itself rather than a zod-parsed unary DTO', async () => {
    const spy = eventsDeps({ events: FIVE_EVENTS })
    const registry = createRegistryFromSpecs([runsEventsSpec], {
      deps: spy.deps,
      resolveExecutionContext: FIXED_CONTEXT,
    })

    const result = await invokeFunction(registry, 'runs.events', { runId: RUN_ID }, READ_CALLER)

    expect(typeof (result as FunctionStream<RunEventEnvelope>)[Symbol.asyncIterator])
      .toBe('function')
    expect(Array.isArray(result)).toBe(false)
  })

  it('rejects a malformed resume token before the reader is touched', async () => {
    const spy = eventsDeps({ events: FIVE_EVENTS })
    const registry = createRegistryFromSpecs([runsEventsSpec], {
      deps: spy.deps,
      resolveExecutionContext: FIXED_CONTEXT,
    })

    await expect(
      invokeFunction(registry, 'runs.events', { runId: RUN_ID, lastEventId: -1 }, READ_CALLER),
    ).rejects.toThrow()
    expect(spy.calls()).toEqual([])
  })
})
