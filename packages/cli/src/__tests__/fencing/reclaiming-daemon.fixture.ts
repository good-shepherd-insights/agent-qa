import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { ConfigReaderPort, FunctionRegistry, JobModelCapability } from '@vostride/agent-qa-agent'
import type {
  ComposeJobRecoveryInput,
  ComposeLocalAgentInput,
  JobRecoveryHost,
  LocalAgentHost,
} from '@vostride/agent-qa-agent-local'
import {
  drainQueue,
  readWriterLease,
} from '@vostride/agent-qa-knowledge-local'
import {
  defaultGuardrailPolicyInput,
  loadGuardrailPolicy,
} from '@vostride/agent-qa-safety'

import { DAEMON_EVENTS_FILE } from '../../daemon/events.js'
import { runDaemonHost, type DaemonHostOperations } from '../../daemon/host.js'
import { DAEMON_REGISTRATION_FILE } from '../../daemon/registration.js'
import { createScriptedAuthor, readFixture } from '../dual-host/fixtures.js'
import { canonicalBundleTree, orderedLogicalDump } from '../dual-host/logical-dump.js'
import { FENCING_ENV, writeDurableJson } from './spawn-helpers.js'

const CONFIG: ConfigReaderPort = {
  getMasked: () => Promise.resolve({
    schemaVersion: 1,
    configPath: '/tmp/sigstop-fencing.config.yaml',
    entries: [],
  }),
}
const MODEL: JobModelCapability = {
  modelId: 'sigstop-fencing:unused',
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

function currentEpoch(knowledgeRoot: string): number {
  return Number(readFileSync(join(knowledgeRoot, '.epoch'), 'utf8').trim())
}

function storeDigest(knowledgeRoot: string): string {
  return createHash('sha256')
    .update(canonicalBundleTree(knowledgeRoot))
    .update('\0')
    .update(orderedLogicalDump(knowledgeRoot))
    .digest('hex')
}

export async function runReclaimingDaemonFixture(): Promise<void> {
  const root = requiredEnv(FENCING_ENV.root)
  const fixture = readFixture(requiredEnv(FENCING_ENV.fixture))
  const readyMarker = requiredEnv(FENCING_ENV.readyMarker)
  const committedMarker = requiredEnv(FENCING_ENV.committedMarker)
  const reportFile = requiredEnv(FENCING_ENV.report)
  const candidateId = fixture.candidates[0]?.candidateId
  if (candidateId === undefined || fixture.candidates.length !== 1) {
    throw new Error('fencing fixture requires exactly one candidate')
  }
  const agentQaRoot = join(root, '.agent-qa')
  const knowledgeRoot = join(root, 'agent-qa-knowledge')
  const author = createScriptedAuthor(fixture, [])
  let hostError: unknown
  const errors: string[] = []

  const host = runDaemonHost({
    agentQaRoot,
    knowledgeRoot,
    config: CONFIG,
    model: () => MODEL,
    author: () => author,
    policy: loadGuardrailPolicy(defaultGuardrailPolicyInput),
    operations: {
      drainQueue,
      composeJobRecovery: (_input: ComposeJobRecoveryInput) => fakeRecovery(),
      composeLocalAgent: (_input: ComposeLocalAgentInput) => fakeLocalAgent(),
    } satisfies Partial<DaemonHostOperations>,
    logger: {
      info: (message) => process.stderr.write(`[fencing-daemon] ${message}\n`),
      error: (message) => {
        errors.push(message)
        process.stderr.write(`[fencing-daemon] error: ${message}\n`)
      },
    },
  })
  void host.catch((error: unknown) => { hostError = error })

  await waitUntil(
    () => existsSync(join(agentQaRoot, DAEMON_REGISTRATION_FILE)),
    'reclaiming daemon registration was not written',
    () => hostError,
  )
  const acquired = readWriterLease(knowledgeRoot)
  if (acquired.kind !== 'parsed') throw new Error(`successor lease is ${acquired.kind}`)
  writeDurableJson(readyMarker, {
    ready: true,
    pid: process.pid,
    leaseId: acquired.lease.leaseId,
    epoch: acquired.lease.epoch,
  })

  await waitUntil(() => {
    const events = readEvents(agentQaRoot)
    const completed = events.findIndex((event) =>
      event.kind === 'job-completed' && event.candidateId === candidateId)
    return completed >= 0 && events.slice(completed + 1).some((event) =>
      event.kind === 'lease-heartbeated')
  }, 'successor did not commit X and timer-heartbeat afterward', () => hostError)

  const events = readEvents(agentQaRoot)
  const completed = events.findIndex((event) =>
    event.kind === 'job-completed' && event.candidateId === candidateId)
  const heartbeat = events.slice(completed + 1).find((event) =>
    event.kind === 'lease-heartbeated')
  const lease = readWriterLease(knowledgeRoot)
  if (lease.kind !== 'parsed' || heartbeat === undefined) {
    throw new Error('successor lost its live lease before publishing the committed marker')
  }
  writeDurableJson(committedMarker, {
    committed: true,
    candidateId,
    holderPid: lease.lease.pid,
    leaseId: lease.lease.leaseId,
    epoch: lease.lease.epoch,
    heartbeatAtMs: lease.lease.heartbeatAtMs,
    eventHeartbeatAtMs: heartbeat.heartbeatAtMs,
    diskEpoch: currentEpoch(knowledgeRoot),
    storeDigest: storeDigest(knowledgeRoot),
  })

  const exitCode = await host
  if (exitCode !== 0 || errors.length > 0) {
    throw new Error(`daemon stopped with ${exitCode}: ${errors.join('; ')}`)
  }
  writeDurableJson(reportFile, {
    failed: false,
    pid: process.pid,
    candidateId,
    exitCode,
    events: readEvents(agentQaRoot),
  })
}

if (process.env[FENCING_ENV.role] === 'reclaiming-daemon') {
  void runReclaimingDaemonFixture().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
