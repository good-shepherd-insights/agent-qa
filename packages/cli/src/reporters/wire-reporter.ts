import type { RunEventEnvelope } from '@vostride/agent-qa-schema'

// NOTE (D-02/D-09): the stdout wire is an operator- or CI-captured surface — it stays MASKED. Each
// envelope is printed VERBATIM (payloads already masked at the sink); no redaction, no
// reshaping, and originals are never restored here. (T-363-14.)

const WIRE_PREFIX = 'AGENT_QA_EVENT:'

export interface WireReporterTarget {
  write: (chunk: string) => void
}

export interface WireReporterHandle {
  handler: (envelope: RunEventEnvelope) => void
}

/**
 * `createWireReporter` — the D-02 successor to core's `StdoutLiveReporter`, and one of the TWO
 * writers on the `AGENT_QA_EVENT:` stdout channel. It is a SUPPORTED OPT-IN, not a leftover of the
 * retired dashboard spawn, and the header above used to describe it by that retired relationship.
 *
 * Gated by `AGENT_QA_LIVE_EVENTS === 'true'`, read here on every envelope; prints one line per
 * envelope: the 15-char `AGENT_QA_EVENT:` prefix immediately followed by the verbatim
 * `JSON.stringify(envelope)`. The reporter is ATTACHED UNCONDITIONALLY by
 * `run-session-composition.ts` and gated internally — attachment is not arming, and a reader of
 * that call site should not infer that the channel is on.
 *
 * The variable used to be set by the dashboard child's environment. That child is gone and NOTHING
 * IN THE PRODUCT SETS THE VARIABLE any more; `composition/__tests__/spawn-absence-census.test.ts`
 * holds that absence, and a module that started arming the channel reds there. A consumer that sees
 * these lines set the variable deliberately.
 *
 * THE SECOND WRITER on the same prefix is `core/src/logging/log-manager.ts`'s `emitNdjson`, which
 * prints `{"type":"log", ...}` entries and is switched on from the same variable in
 * `commands/run.ts`. A change to the line shape here that is not mirrored there leaves the channel
 * half-described. The user-facing contract for both is README.md, "Live events on stdout (opt-in)".
 */
export function createWireReporter(target?: WireReporterTarget): WireReporterHandle {
  const sink = target?.write ?? ((chunk: string) => void process.stdout.write(chunk))
  function handler(envelope: RunEventEnvelope): void {
    if (process.env.AGENT_QA_LIVE_EVENTS !== 'true') return
    sink(`${WIRE_PREFIX}${JSON.stringify(envelope)}\n`)
  }
  return { handler }
}
