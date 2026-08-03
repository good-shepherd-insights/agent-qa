// One real daemon generation, serving the real post-run chain (Phase 388 plan 06, SC4).
//
// Nothing about the daemon is stubbed that the claim depends on: it classifies the predecessor
// registration, acquires the REAL writer lease on the project's knowledge root, heartbeats it,
// composes the REAL local agent over the project's `agent-jobs.db`, adopts the epoch that lease
// minted, runs `recoverAbandonedClaims`, binds its real socket, and serves the real six-kind
// registry through the shipped serialized dispatcher. That is the entire mechanism SC4 is about.
//
// TWO seams are injected, and both are shipped test opt-outs rather than new ones:
//
//   1. `drainQueue` — the real one, passed explicitly, exactly as the 386 socket-takeover fixture
//      passes it. Supplying it is how `runDaemonHost` itself decides the embedder worker lifecycle
//      is not this host's concern (`embedderLifecycleEnabled`, host.ts:503). The knowledge queue is
//      empty in every leg here, so it is never reached; the AGENT-job dispatcher, which is what
//      these legs measure, stays entirely real.
//   2. `postRun.curateRun` — the daemon's own binding, WRAPPED. The production closure
//      (host.ts, the single `postRun:` site) folds `curateCompletedRun` through an author factory
//      and a guardrail policy, i.e. through real provider credentials; a spawned fixture cannot
//      supply those, and plan 04's own in-process proof substitutes the same one callable for the
//      same reason. The substitute also does the one thing this proof genuinely needs and the real
//      fold cannot be asked to do: PARK, deterministically, inside `curate-memory`'s handler with
//      `analyze-run` already committed — which is what puts the SIGKILL between the two stages
//      rather than wherever a sleep happened to land it.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { ConfigReaderPort, JobModelCapability } from '@vostride/agent-qa-agent'
import { composeLocalAgent } from '@vostride/agent-qa-agent-local'
import type { ComposeLocalAgentInput, LocalAgentHost } from '@vostride/agent-qa-agent-local'
import { drainQueue } from '@vostride/agent-qa-knowledge-local'

import { DAEMON_EVENTS_FILE } from '../../daemon/events.js'
import { runDaemonHost, type DaemonHostOperations } from '../../daemon/host.js'
import { readDaemonRegistration } from '../../daemon/registration.js'
import { writeDurableJson } from '../fencing/spawn-helpers.js'
import { POST_RUN_DAEMON_ENV } from './spawn-helpers.js'

const CONFIG: ConfigReaderPort = {
  getMasked: () => Promise.resolve({
    schemaVersion: 1,
    configPath: '/tmp/post-run-daemon.config.yaml',
    entries: [],
  }),
}

/** The post-run chain never authors in 388: a daemon that reached a provider would be a bug. */
const MODEL: JobModelCapability = {
  modelId: 'post-run-daemon:unused',
  generate: () => {
    throw new Error('the post-run chain never authors in 388')
  },
}

/** What the substituted fold reports, so a completed chain has honest, pinned counts. */
export const FIXTURE_CURATION_COUNTS = { curated: 2, deprecated: 1 } as const

/** The gate is polled rather than watched: a rename under a watcher is the flakier of the two. */
const POLL_MS = 25
/** Well past any leg's own budget. A fold that waits this long has been abandoned, not gated. */
const GATE_DEADLINE_MS = 240_000
const READY_DEADLINE_MS = 120_000

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (value === undefined || value === '') throw new Error(`missing ${name}`)
  return value
}

function readEvents(agentQaRoot: string): Record<string, unknown>[] {
  const file = join(agentQaRoot, DAEMON_EVENTS_FILE)
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8').split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

async function waitUntil(
  predicate: () => boolean,
  message: string,
  abort: () => unknown,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    const error = abort()
    if (error !== undefined) throw error instanceof Error ? error : new Error(String(error))
    if (Date.now() > deadline) throw new Error(message)
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  }
}

export async function runPostRunDaemonFixture(): Promise<void> {
  const root = requiredEnv(POST_RUN_DAEMON_ENV.root)
  const generation = requiredEnv(POST_RUN_DAEMON_ENV.generation)
  const readyMarker = requiredEnv(POST_RUN_DAEMON_ENV.readyMarker)
  const reportFile = requiredEnv(POST_RUN_DAEMON_ENV.report)
  const enteredMarker = requiredEnv(POST_RUN_DAEMON_ENV.enteredMarker)
  const gate = requiredEnv(POST_RUN_DAEMON_ENV.gate)
  const agentQaRoot = join(root, '.agent-qa')
  const knowledgeRoot = join(root, 'agent-qa-knowledge')

  let hostError: unknown
  let hostExitCode: number | undefined
  const errors: string[] = []
  const curationEntries: string[] = []

  const operations: Partial<DaemonHostOperations> = {
    drainQueue,
    composeLocalAgent: (input: ComposeLocalAgentInput): LocalAgentHost => composeLocalAgent({
      ...input,
      postRun: {
        curateRun: async ({ runId }) => {
          curationEntries.push(runId)
          writeDurableJson(enteredMarker, {
            runId,
            pid: process.pid,
            generation,
            enteredAtMs: Date.now(),
          })
          await waitUntil(
            () => existsSync(gate),
            `the curation gate never opened for ${runId}`,
            () => undefined,
            GATE_DEADLINE_MS,
          )
          return { ...FIXTURE_CURATION_COUNTS }
        },
      },
    }),
  }

  const host = runDaemonHost({
    agentQaRoot,
    knowledgeRoot,
    config: CONFIG,
    model: () => MODEL,
    operations,
    logger: {
      info: (message) => process.stderr.write(`[post-run-${generation}] ${message}\n`),
      error: (message) => {
        errors.push(message)
        process.stderr.write(`[post-run-${generation}] error: ${message}\n`)
      },
    },
  })
  void host.then(
    (code) => { hostExitCode = code },
    (error: unknown) => { hostError = error },
  )

  const writeReport = (failed: boolean, reason?: string): void => {
    writeDurableJson(reportFile, {
      failed,
      generation,
      pid: process.pid,
      exitCode: hostExitCode,
      errors,
      curationEntries,
      ...(reason === undefined ? {} : { reason }),
      events: readEvents(agentQaRoot),
    })
  }

  try {
    // Readiness is the daemon's OWN registration, exactly as the 386 takeover fixture defines it:
    // the socket is listening and the handlers are live by the time those bytes exist. A host that
    // REFUSES (a fresh predecessor lease) resolves its exit code without ever registering, and that
    // refusal is evidence rather than an accident — so it aborts the wait by name.
    await waitUntil(
      () => {
        const outcome = readDaemonRegistration(agentQaRoot)
        return outcome.kind === 'parsed' && outcome.registration.pid === process.pid
      },
      `the ${generation} daemon never published its own registration`,
      () => hostError ?? (
        hostExitCode === undefined
          ? undefined
          : new Error(`the ${generation} daemon exited ${hostExitCode} before readiness`)
      ),
      READY_DEADLINE_MS,
    )
    const published = readDaemonRegistration(agentQaRoot)
    if (published.kind !== 'parsed') throw new Error('registration vanished after publication')
    writeDurableJson(readyMarker, {
      ready: true,
      generation,
      pid: process.pid,
      instanceId: published.registration.instanceId,
      socketPath: published.registration.socketPath,
    })

    hostExitCode = await host
    writeReport(false)
  } catch (error) {
    writeReport(true, error instanceof Error ? error.message : String(error))
    throw error
  }
}

if (process.env[POST_RUN_DAEMON_ENV.role] === 'daemon') {
  void runPostRunDaemonFixture().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
    )
    process.exitCode = 1
  })
}
