import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { ConfigReaderPort, FunctionRegistry, JobModelCapability } from '@vostride/agent-qa-agent'
import type {
  ComposeJobRecoveryInput,
  ComposeLocalAgentInput,
  JobRecoveryHost,
  LocalAgentHost,
} from '@vostride/agent-qa-agent-local'
import { drainQueue } from '@vostride/agent-qa-knowledge-local'

import { DAEMON_EVENTS_FILE } from '../../daemon/events.js'
import { runDaemonHost, type DaemonHostOperations } from '../../daemon/host.js'
import { readDaemonRegistration } from '../../daemon/registration.js'
import { writeDurableJson } from '../fencing/spawn-helpers.js'
import { TAKEOVER_ENV } from './spawn-helpers.js'

const CONFIG: ConfigReaderPort = {
  getMasked: () => Promise.resolve({
    schemaVersion: 1,
    configPath: '/tmp/socket-takeover.config.yaml',
    entries: [],
  }),
}
const MODEL: JobModelCapability = {
  modelId: 'socket-takeover:unused',
  generate: () => Promise.resolve({ text: 'unused' }),
}

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (value === undefined || value === '') throw new Error(`missing ${name}`)
  return value
}

function fakeRecovery(): JobRecoveryHost {
  return {
    store: { adoptEpoch: () => Promise.resolve({ epoch: 1 }) },
    recoverAbandonedClaims: () => Promise.resolve({ recovered: 0 }),
    resumePending: () => Promise.resolve([]),
    close() {},
  } as unknown as JobRecoveryHost
}

function fakeLocalAgent(): LocalAgentHost {
  return {
    registry: {} as FunctionRegistry,
    jobs: () => Promise.resolve({
      queue: { runNextJob: () => Promise.resolve({ ran: false, reason: 'no-job' }) },
    }),
    close() {},
  } as unknown as LocalAgentHost
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
  rejected: () => unknown,
): Promise<void> {
  const deadline = Date.now() + 120_000
  while (!predicate()) {
    const error = rejected()
    if (error !== undefined) throw error
    if (Date.now() > deadline) throw new Error(message)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

/**
 * Run one full daemon generation over a shared project root.
 *
 * Nothing about the transport is stubbed: the host binds its real socket, publishes its real
 * registration, and serves the real identity route. That is the only way a takeover leg can
 * observe whether a predecessor's kernel objects gate a successor's readiness.
 */
export async function runTakeoverDaemonFixture(): Promise<void> {
  const root = requiredEnv(TAKEOVER_ENV.root)
  const generation = requiredEnv(TAKEOVER_ENV.generation)
  const readyMarker = requiredEnv(TAKEOVER_ENV.readyMarker)
  const reportFile = requiredEnv(TAKEOVER_ENV.report)
  const agentQaRoot = join(root, '.agent-qa')
  const knowledgeRoot = join(root, 'agent-qa-knowledge')
  let hostError: unknown
  const errors: string[] = []

  const host = runDaemonHost({
    agentQaRoot,
    knowledgeRoot,
    config: CONFIG,
    model: () => MODEL,
    operations: {
      drainQueue,
      composeJobRecovery: (_input: ComposeJobRecoveryInput) => fakeRecovery(),
      composeLocalAgent: (_input: ComposeLocalAgentInput) => fakeLocalAgent(),
    } satisfies Partial<DaemonHostOperations>,
    logger: {
      info: (message) => process.stderr.write(`[takeover-${generation}] ${message}\n`),
      error: (message) => {
        errors.push(message)
        process.stderr.write(`[takeover-${generation}] error: ${message}\n`)
      },
    },
  })
  void host.catch((error: unknown) => { hostError = error })

  const ownRegistration = (): ReturnType<typeof readDaemonRegistration> => {
    const outcome = readDaemonRegistration(agentQaRoot)
    return outcome
  }

  try {
    await waitUntil(
      () => {
        const outcome = ownRegistration()
        return outcome.kind === 'parsed' && outcome.registration.pid === process.pid
      },
      `${generation} daemon never published its own registration`,
      () => hostError,
    )
    const published = ownRegistration()
    if (published.kind !== 'parsed') throw new Error('registration vanished after publication')
    writeDurableJson(readyMarker, {
      ready: true,
      generation,
      pid: process.pid,
      instanceId: published.registration.instanceId,
      socketPath: published.registration.socketPath,
      startedAtMs: published.registration.startedAtMs,
    })

    const exitCode = await host
    writeDurableJson(reportFile, {
      failed: false,
      generation,
      pid: process.pid,
      exitCode,
      errors,
      events: readEvents(agentQaRoot),
    })
  } catch (error) {
    writeDurableJson(reportFile, {
      failed: true,
      generation,
      pid: process.pid,
      errors,
      reason: error instanceof Error ? error.message : String(error),
      events: readEvents(agentQaRoot),
    })
    throw error
  }
}

if (process.env[TAKEOVER_ENV.role] === 'daemon') {
  void runTakeoverDaemonFixture().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
