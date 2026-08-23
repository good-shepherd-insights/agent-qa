// THE ENVELOPE-PARITY ANCHOR (Phase 401 plan 07, D-09 / INVK-01 truth 2).
//
// NOT A TEST FILE: this package's vitest include is `src/**/__tests__/**/*.test.ts`, so this module
// is imported, never collected.
//
// WHAT THE ANCHOR IS FOR. D-09's whole build-order pin is that the queue, the db writes, the live
// SSE and the CURRENT step projection are untouched while the PRODUCER underneath them changes from
// a spawned child's scraped stdout to a `RunSession` bus subscription. "Untouched" is only a claim
// if something pins what those consumers actually receive — so this fixture defines ONE run's worth
// of bus envelopes and the two mechanisms are each driven over it:
//
//   the OLD wire  — `TestRunner` spawning a child that prints `AGENT_QA_EVENT:<json>` lines;
//   the NEW wire  — `createInProcessExecutionBackend` bridging a `RunSession.subscribe(0, …)`.
//
// Both must hand the consumer surface (the per-run buffer AND the `execution-event` emission) the
// same `LiveExecutionEvent[]`. The golden is captured from the OLD wire BEFORE `test-runner.ts` is
// deleted, because after that the anchor is unrecoverable.
//
// THE SEQUENCE IS NOT A HAPPY PATH. It deliberately carries the four things a bridge can get wrong
// and a five-event smoke test cannot see:
//   - a `heartbeat`, whose type maps to NO process status (the "leave the running status alone" arm);
//   - a `testFinished` that says `failed` BEFORE a `verdict` that says `passed`, so last-writer-wins
//     at the run level is discriminated from first-writer-wins;
//   - a `stepFinalized` carrying a nested payload, so "carried verbatim" ranges more than scalars;
//   - a plain (non-envelope) stdout line and a malformed `AGENT_QA_EVENT:` line, neither of which
//     may reach the buffer.
//
// The last two only exist on the old wire (there is no stdout any more), which is the point: their
// ABSENCE from the golden is what says the buffer never carried them in the first place.

import type { RunEventEnvelope } from '@vostride/agent-qa-schema'

/** The run id both wires are driven with. Fixed so the golden is a literal a human can read. */
export const PARITY_RUN_ID = 'parity-run-0001'

/**
 * The envelope sequence, frozen. `ts` values are fixed rather than minted so the golden needs no
 * timestamp scrubbing — an anchor that has to be scrubbed on a field can hide a change in it.
 */
export const PARITY_ENVELOPES: readonly RunEventEnvelope[] = Object.freeze([
  { seq: 1, ts: '2026-08-23T00:00:00.000Z', runId: PARITY_RUN_ID, type: 'runStarted', payload: { testCount: 1 } },
  { seq: 2, ts: '2026-08-23T00:00:01.000Z', runId: PARITY_RUN_ID, type: 'testStarted', payload: { testId: 't-1', testIndex: 0, name: 'the parity test', filePath: 'tests/parity.yaml', totalSteps: 1 } },
  { seq: 3, ts: '2026-08-23T00:00:02.000Z', runId: PARITY_RUN_ID, type: 'heartbeat', payload: {} },
  { seq: 4, ts: '2026-08-23T00:00:03.000Z', runId: PARITY_RUN_ID, type: 'stepStarted', payload: { testIndex: 0, stepIndex: 0, stepText: 'Verify the page says "Example"' } },
  { seq: 5, ts: '2026-08-23T00:00:04.000Z', runId: PARITY_RUN_ID, type: 'stepFinalized', payload: { testIndex: 0, stepIndex: 0, status: 'healed', durationMs: 12, evidence: { screenshots: ['a.png'], attempts: 2 } } },
  { seq: 6, ts: '2026-08-23T00:00:05.000Z', runId: PARITY_RUN_ID, type: 'testFinished', payload: { testId: 't-1', testIndex: 0, outcome: 'failed', durationMs: 34 } },
  { seq: 7, ts: '2026-08-23T00:00:06.000Z', runId: PARITY_RUN_ID, type: 'verdict', payload: { verdict: 'passed' } },
  { seq: 8, ts: '2026-08-23T00:00:07.000Z', runId: PARITY_RUN_ID, type: 'runFinished', payload: { aggregateVerdict: 'passed' } },
] as unknown as RunEventEnvelope[])

/** A line the child prints that is NOT an envelope. It must never reach the buffer. */
export const PARITY_PLAIN_STDOUT_LINE = 'Running 1 test(s)...'

/** A line that CLAIMS to be an envelope and is not parseable. It must never reach the buffer. */
export const PARITY_MALFORMED_WIRE_LINE = 'AGENT_QA_EVENT:{"seq":9,'

/**
 * The one scrub, and the only one: `run-complete.duration` is wall-clock.
 *
 * Applied by BOTH the generator and the assertion through this single function, so a golden and a
 * reading can never be scrubbed by two rules that quietly disagree (401-11's own instrument law).
 */
export function scrubParityEvents(
  events: readonly { id: number; type: string; [key: string]: unknown }[],
): { id: number; type: string; [key: string]: unknown }[] {
  return events.map((event) =>
    event.type === 'run-complete' && typeof event.duration === 'number'
      ? { ...event, duration: '<duration>' }
      : { ...event },
  )
}
