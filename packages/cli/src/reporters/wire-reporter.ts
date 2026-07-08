import type { RunEventEnvelope } from '@vostride/agent-qa-schema'

// NOTE (D-02/D-09): the stdout wire is a SPAWN/CI-captured surface — it stays MASKED. Each
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
 * `createWireReporter` — the D-02 successor to core's `StdoutLiveReporter`. Gated by
 * `AGENT_QA_LIVE_EVENTS === 'true'` (the same env contract the dashboard spawn sets); prints
 * one line per envelope: the 15-char `AGENT_QA_EVENT:` prefix immediately followed by the
 * verbatim `JSON.stringify(envelope)`.
 */
export function createWireReporter(target?: WireReporterTarget): WireReporterHandle {
  const sink = target?.write ?? ((chunk: string) => void process.stdout.write(chunk))
  function handler(envelope: RunEventEnvelope): void {
    if (process.env.AGENT_QA_LIVE_EVENTS !== 'true') return
    sink(`${WIRE_PREFIX}${JSON.stringify(envelope)}\n`)
  }
  return { handler }
}
