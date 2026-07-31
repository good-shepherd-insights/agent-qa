import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

export const DAEMON_EVENTS_FILE = 'daemon-events.jsonl'

export type DaemonEventKind =
  | 'lease-acquired'
  | 'lease-reclaimed'
  | 'lease-heartbeated'
  | 'lease-lost'
  | 'epoch-bump'
  | 'registration-recovered'
  | 'job-claimed'
  | 'job-completed'
  | 'drain-session-start'
  | 'drain-session-end'
  | 'embedder-worker-start'
  | 'embedder-worker-exit'
  | 'embedder-worker-terminate-escalated'
  | 'run-child-exit'
  | 'shutdown-stage-failed'
  | 'daemon-stopped'

/** A lifecycle fact. Kinds are closed while later plans may add kind-specific scalar fields. */
export type DaemonEvent = Readonly<{ kind: DaemonEventKind } & Record<string, unknown>>

/**
 * Append one daemon lifecycle fact under the project runtime root.
 *
 * `ts` is deliberately constructed before the event spread so it is the first persisted JSON
 * field, matching the execution-audit JSONL house format. The daemon is the single appender.
 */
export function appendDaemonEvent(
  agentQaRoot: string,
  event: DaemonEvent,
  now: () => Date = () => new Date(),
): void {
  mkdirSync(agentQaRoot, { recursive: true })
  appendFileSync(
    join(agentQaRoot, DAEMON_EVENTS_FILE),
    `${JSON.stringify({ ts: now().toISOString(), ...event })}\n`,
  )
}
