import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Readable } from 'node:stream'
import { isDeepStrictEqual } from 'node:util'

import type { ConfigReaderPort, JobModelCapability } from '@vostride/agent-qa-agent'
import {
  composeJobRecovery,
  composeLocalAgent,
  DIGEST_JOB_ID_SOURCE,
  EMBEDDER_WORKER_START_TIMEOUT_MS,
  EMBEDDER_WORKER_TERM_GRACE_MS,
  EmbedderWorkerTimeoutError,
  LOCAL_DAEMON_CAPABILITIES,
  SYSTEM_CLOCK,
} from '@vostride/agent-qa-agent-local'
import type {
  ComposeJobRecoveryInput,
  ComposeLocalAgentInput,
  CuratorAuthor,
  JobRecoveryHost,
  LocalAgentHost,
  RunExecutionPort,
  AcquireWriterLeaseOutcome,
  HeartbeatLeaseOutcome,
  LeaseOperationOptions,
  ReleaseLeaseOutcome,
} from '@vostride/agent-qa-agent-local'
import {
  DEFAULT_EMBEDDING_PROFILE,
  slugBranch,
  type GuardrailPolicy,
} from '@vostride/agent-qa-schema'

import { createShutdownController } from '../commands/shutdown-controller.js'
import {
  appendDrainSessionReceipt,
  type DrainSessionReceipt,
} from './drain-receipts.js'
import { appendDaemonEvent } from './events.js'
import type { DaemonEvent } from './events.js'
import {
  DAEMON_IDENTITY_SCHEMA_VERSION,
  daemonSocketPath,
  startInvokeServer,
  type InvokeServerHandle,
  type StartInvokeServerOptions,
} from './server.js'
import {
  classifyDaemonRegistration,
  DAEMON_REGISTRATION_SCHEMA_VERSION,
  readDaemonRegistration,
  removeDaemonRegistration,
  removeRegistrationIfOwned,
  writeDaemonRegistration,
} from './registration.js'
import type {
  ClassifyDaemonRegistrationInput,
  ClassifyDaemonRegistrationOutcome,
} from './registration.js'
import type { DaemonRegistration } from './registration.js'
import {
  createJobDispatcher,
  type JobDispatcher,
} from './job-dispatcher.js'
import {
  HEARTBEAT_SUPERVISOR_STOP_TIMEOUT_MS,
  startHeartbeatSupervisor,
  type HeartbeatSupervisorHandle,
  type HeartbeatSupervisorMessage,
  type StartHeartbeatSupervisorOptions,
} from './heartbeat-supervisor.js'

/** Provisional daemon heartbeat interval; retune from operational evidence without adding config. */
export const LEASE_HEARTBEAT_INTERVAL_MS = 10_000

/** Provisional lost-nudge backstop; retune from operational evidence without adding config. */
export const CURATION_QUEUE_POLL_MS = 30_000

/** Provisional writer-maintenance cadence; retune from operational evidence without adding config. */
export const MAINTENANCE_CADENCE_MS = 300_000

/** Provisional synchronous drain wait; retune from operational evidence without adding config. */
export const DRAIN_WAIT_TIMEOUT_MS = 120_000

/** Provisional graceful-stop backstop; includes all worker termination bounds plus scheduling. */
export const DAEMON_SHUTDOWN_GRACE_MS =
  (EMBEDDER_WORKER_TERM_GRACE_MS * 2) + HEARTBEAT_SUPERVISOR_STOP_TIMEOUT_MS + 1_000

/** Provisional worker residency window; retune from daemon telemetry without adding config. */
export const EMBEDDER_WORKER_IDLE_MS = 300_000

/** Bound each captured worker stream before it is attributed to the daemon event log. */
export const EMBEDDER_WORKER_OUTPUT_CAP_BYTES = 65_536

export { EMBEDDER_WORKER_START_TIMEOUT_MS, EMBEDDER_WORKER_TERM_GRACE_MS }

export type EmbedderWorkerRegistration = Extract<
  ReturnType<typeof LOCAL_DAEMON_CAPABILITIES.readEmbedderWorkerRegistration>,
  { kind: 'parsed' }
>['registration']
type ReadEmbedderWorkerRegistrationOutcome = ReturnType<
  typeof LOCAL_DAEMON_CAPABILITIES.readEmbedderWorkerRegistration
>
type OwnedEmbedderWorkerRegistration = Parameters<
  typeof LOCAL_DAEMON_CAPABILITIES.removeEmbedderWorkerRegistration
>[1]

/** Run-scoped daemon captures; raw child streams never enter daemon-events.jsonl. */
export const RUN_CHILD_STDOUT_FILE = 'run-child.stdout.log'
export const RUN_CHILD_STDERR_FILE = 'run-child.stderr.log'

export type DaemonHostTraceStep =
  | 'posture-pinned'
  | 'lease-acquired'
  | 'recovery-composed'
  | 'epoch-adopted'
  | 'claims-recovered'
  | 'local-agent-composed'
  | 'jobs-opened'
  | 'registration-written'
  | 'heartbeat-started'
  | 'shutdown-started'
  | 'lease-released'
  | 'registration-removed'

export interface DaemonHostLogger {
  info(message: string): void
  error(message: string): void
}

export interface EmbedderWorkerSpawnOptions {
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly stdio: readonly ['ignore', 'pipe', 'pipe']
}

export type DaemonShutdownStage =
  | 'heartbeatSupervisor.stop'
  | 'invokeServer.close'
  | 'drainWorker'
  | 'maintenanceWorker'
  | 'stopEmbedderWorker'
  | 'jobDispatcher.stop'
  | 'localAgent.close'
  | 'releaseLease'

export interface DaemonHostOperations {
  /** Test-only scheduler seam; production uses libuv's monotonic timer scheduling. */
  setInterval(callback: () => void, intervalMs: number): ReturnType<typeof setInterval>
  clearInterval(timer: ReturnType<typeof setInterval>): void
  setTimeout(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>
  clearTimeout(timer: ReturnType<typeof setTimeout>): void
  /** Wall-clock epoch milliseconds for registration and human elapsed-time rendering only. */
  now(): number
  onSignal(signal: NodeJS.Signals, listener: () => void): void
  offSignal(signal: NodeJS.Signals, listener: () => void): void
  hardExit(code: number): void
  /** Focused failure-injection seam around each awaited shutdown stage. */
  runShutdownStage(
    stage: DaemonShutdownStage,
    action: () => void | Promise<void>,
  ): Promise<void>
  startHeartbeatSupervisor(
    options: StartHeartbeatSupervisorOptions,
  ): Promise<HeartbeatSupervisorHandle>
  acquireWriterLease(knowledgeRoot: string): AcquireWriterLeaseOutcome
  heartbeatLease(options: LeaseOperationOptions): HeartbeatLeaseOutcome
  releaseLease(options: LeaseOperationOptions): ReleaseLeaseOutcome
  composeJobRecovery(input: ComposeJobRecoveryInput): JobRecoveryHost
  composeLocalAgent(input: ComposeLocalAgentInput): LocalAgentHost
  appendDaemonEvent(agentQaRoot: string, event: DaemonEvent): void
  writeDaemonRegistration(agentQaRoot: string, registration: DaemonRegistration): void
  removeDaemonRegistration(agentQaRoot: string): void
  removeRegistrationIfOwned(agentQaRoot: string, instanceId: string): boolean
  classifyDaemonRegistration(
    input: ClassifyDaemonRegistrationInput,
  ): Promise<ClassifyDaemonRegistrationOutcome>
  startInvokeServer(options: StartInvokeServerOptions): Promise<InvokeServerHandle>
  countRemainingCurationWork: typeof LOCAL_DAEMON_CAPABILITIES.countRemainingCurationWork
  inspectDrainableCurationWork: typeof LOCAL_DAEMON_CAPABILITIES.inspectDrainableCurationWork
  listQueuedCandidates(knowledgeRoot: string): string[]
  acquireEmbedder: typeof LOCAL_DAEMON_CAPABILITIES.acquireEmbedder
  drainQueue: typeof LOCAL_DAEMON_CAPABILITIES.drainQueue
  runMaintenanceTail: typeof LOCAL_DAEMON_CAPABILITIES.runMaintenanceTail
  appendDrainSessionReceipt(agentQaRoot: string, receipt: DrainSessionReceipt): void
  resolveEmbedderWorkerEntryPath(): string
  spawnEmbedderWorker(options: EmbedderWorkerSpawnOptions): ChildProcess
  waitForEmbedderWorkerReady(
    agentQaRoot: string,
    pid: number | undefined,
    instanceId: string,
    signal: AbortSignal,
  ): Promise<EmbedderWorkerRegistration>
  readEmbedderWorkerRegistration(agentQaRoot: string): ReadEmbedderWorkerRegistrationOutcome
  embedderWorkerProcessIsAlive(pid: number): boolean
  embedderWorkerSocketPath(
    agentQaRoot: string,
    projectRoot: string,
    instanceId: string,
  ): string
  probeEmbedderWorkerSocket(socketPath: string): Promise<boolean>
  signalEmbedderWorkerProcess(pid: number, signal: NodeJS.Signals): boolean
  waitForEmbedderWorkerProcessExit(pid: number, timeoutMs: number): Promise<boolean>
  unlinkEmbedderWorkerSocket(socketPath: string): void
  removeEmbedderWorkerRegistration(
    agentQaRoot: string,
    expected: OwnedEmbedderWorkerRegistration,
  ): boolean
  resetEmbedderCapability(): void
  randomUUID(): string
  trace?(step: DaemonHostTraceStep): void
}

export interface DaemonHostOptions {
  /** The project's runtime root (`<config-dir>/.agent-qa`), always absolute. */
  agentQaRoot: string
  /** The project's writer-gated knowledge root, always absolute. */
  knowledgeRoot: string
  /** Masked project configuration supplied to the one local composition root. */
  config: ConfigReaderPort
  /** Already-host-owned model factory; agent-local never constructs a provider. */
  model: () => JobModelCapability | Promise<JobModelCapability>
  /** Lazy so an idle daemon does not resolve curation credentials until work appears. */
  author?: () => CuratorAuthor | Promise<CuratorAuthor>
  /** Shipped guardrail policy applied to every daemon-authored curation pass. */
  policy?: GuardrailPolicy
  /** Explicit test/embedding override; it wins over the production Plan 08 binding. */
  runExecution?: RunExecutionPort
  /** Exact resolved project config path. Presence binds the production run executor. */
  configPath?: string
  /** Test-only real-child fixture entry. Production re-enters the current CLI entry. */
  cliEntry?: string
  /** Plan 05 binds the recorded path to the live invoke server. */
  socketPath?: string
  logger?: DaemonHostLogger
  /** Test-only operations table. Production callers omit it. */
  operations?: Partial<DaemonHostOperations>
}

const DEFAULT_LOGGER: DaemonHostLogger = {
  info: (message) => console.log(message),
  error: (message) => console.error(message),
}

async function waitForEmbedderWorkerReady(
  agentQaRoot: string,
  pid: number | undefined,
  instanceId: string,
  signal: AbortSignal,
): Promise<EmbedderWorkerRegistration> {
  while (!signal.aborted) {
    const outcome = LOCAL_DAEMON_CAPABILITIES.readEmbedderWorkerRegistration(agentQaRoot)
    if (
      outcome.kind === 'parsed'
      && (pid === undefined || outcome.registration.pid === pid)
      && outcome.registration.instanceId === instanceId
    ) {
      return outcome.registration
    }
    if (outcome.kind === 'malformed') {
      throw new Error('Embedder worker registration is malformed')
    }
    await new Promise<void>((resolve, reject) => {
      const onAbort = (): void => {
        clearTimeout(timer)
        reject(signal.reason)
      }
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort)
        resolve()
      }, 25)
      signal.addEventListener('abort', onAbort, { once: true })
      if (signal.aborted) onAbort()
    })
  }
  throw signal.reason
}

function signalEmbedderWorkerProcess(pid: number, signal: NodeJS.Signals): boolean {
  try {
    process.kill(pid, signal)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false
    throw error
  }
}

async function waitForEmbedderWorkerProcessExit(
  pid: number,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (LOCAL_DAEMON_CAPABILITIES.embedderWorkerProcessIsAlive(pid)) {
    if (Date.now() >= deadline) return false
    await new Promise<void>((resolve) => setTimeout(resolve, 25))
  }
  return true
}

function defaultOperations(): DaemonHostOperations {
  return {
    setInterval: (callback, intervalMs) => setInterval(callback, intervalMs),
    clearInterval: (timer) => clearInterval(timer),
    setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
    clearTimeout: (timer) => clearTimeout(timer),
    now: () => Date.now(),
    onSignal: (signal, listener) => process.on(signal, listener),
    offSignal: (signal, listener) => process.off(signal, listener),
    hardExit: (code) => process.exit(code),
    runShutdownStage: async (_stage, action) => {
      await action()
    },
    startHeartbeatSupervisor,
    acquireWriterLease: LOCAL_DAEMON_CAPABILITIES.acquireWriterLease,
    heartbeatLease: LOCAL_DAEMON_CAPABILITIES.heartbeatLease,
    releaseLease: LOCAL_DAEMON_CAPABILITIES.releaseLease,
    composeJobRecovery,
    composeLocalAgent,
    appendDaemonEvent,
    writeDaemonRegistration,
    removeDaemonRegistration,
    removeRegistrationIfOwned,
    classifyDaemonRegistration,
    startInvokeServer,
    countRemainingCurationWork: LOCAL_DAEMON_CAPABILITIES.countRemainingCurationWork,
    inspectDrainableCurationWork: LOCAL_DAEMON_CAPABILITIES.inspectDrainableCurationWork,
    listQueuedCandidates: LOCAL_DAEMON_CAPABILITIES.listQueuedCandidates,
    acquireEmbedder: LOCAL_DAEMON_CAPABILITIES.acquireEmbedder,
    drainQueue: LOCAL_DAEMON_CAPABILITIES.drainQueue,
    runMaintenanceTail: LOCAL_DAEMON_CAPABILITIES.runMaintenanceTail,
    appendDrainSessionReceipt,
    resolveEmbedderWorkerEntryPath: LOCAL_DAEMON_CAPABILITIES.resolveEmbedderWorkerEntryPath,
    spawnEmbedderWorker: (options) => spawn(
      options.command,
      [...options.args],
      {
        cwd: options.cwd,
        stdio: [...options.stdio],
      },
    ),
    waitForEmbedderWorkerReady,
    readEmbedderWorkerRegistration: LOCAL_DAEMON_CAPABILITIES.readEmbedderWorkerRegistration,
    embedderWorkerProcessIsAlive: LOCAL_DAEMON_CAPABILITIES.embedderWorkerProcessIsAlive,
    embedderWorkerSocketPath: LOCAL_DAEMON_CAPABILITIES.embedderWorkerSocketPath,
    probeEmbedderWorkerSocket: LOCAL_DAEMON_CAPABILITIES.probeEmbedderWorkerSocket,
    signalEmbedderWorkerProcess,
    waitForEmbedderWorkerProcessExit,
    unlinkEmbedderWorkerSocket: (socketPath) => rmSync(socketPath, { force: true }),
    removeEmbedderWorkerRegistration:
      LOCAL_DAEMON_CAPABILITIES.removeEmbedderWorkerRegistration,
    resetEmbedderCapability: LOCAL_DAEMON_CAPABILITIES.resetEmbedderCapability,
    randomUUID,
  }
}

function heldMessage(
  holder: Extract<AcquireWriterLeaseOutcome, { kind: 'held' }>['holder'],
): string {
  return (
    `agent-qa daemon is already running (pid ${holder.pid}; ` +
    `lease heartbeat since ${new Date(holder.heartbeatAtMs).toISOString()})`
  )
}

function liveRegistrationMessage(registration: DaemonRegistration): string {
  return (
    `agent-qa daemon is already running (pid ${registration.pid}; ` +
    `daemon registration since ${new Date(registration.startedAtMs).toISOString()})`
  )
}

interface CapturedWorkerOutput {
  readonly read: () => string
  readonly wasTruncated: () => boolean
}

function captureWorkerOutput(stream: Readable): CapturedWorkerOutput {
  const chunks: Buffer[] = []
  let capturedBytes = 0
  let truncated = false
  stream.on('data', (chunk: Buffer | string) => {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    const remaining = EMBEDDER_WORKER_OUTPUT_CAP_BYTES - capturedBytes
    if (remaining > 0) {
      const captured = buffer.subarray(0, remaining)
      chunks.push(captured)
      capturedBytes += captured.byteLength
    }
    if (buffer.byteLength > remaining) truncated = true
  })
  return {
    read: () => Buffer.concat(chunks).toString('utf8'),
    wasTruncated: () => truncated,
  }
}

/**
 * Run the foreground daemon until a signal or lease-heartbeat refusal closes it.
 *
 * Startup order is part of the safety contract: pin posture, acquire authority, heartbeat once,
 * install the independent heartbeat, then recover and compose under the protected epoch.
 */
export async function runDaemonHost(input: DaemonHostOptions): Promise<number> {
  // D-09: this is deliberately the first effect and is never injectable or TTY-dependent.
  LOCAL_DAEMON_CAPABILITIES.pinLocalHeadlessExecutionContext()

  const operations = { ...defaultOperations(), ...input.operations }
  const logger = input.logger ?? DEFAULT_LOGGER
  const instanceId = randomUUID()
  const recordDaemonEvent = (event: DaemonEvent): void => {
    try {
      operations.appendDaemonEvent(input.agentQaRoot, event)
    } catch (error) {
      logger.error(
        `Daemon event append failed (${event.kind}): ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
  let runExecution = input.runExecution
  if (runExecution === undefined && input.configPath !== undefined) {
    // Keep legacy/test hosts that omit configPath independent of the CLI-only composition graph.
    // Production has the resolved path and loads its real child boundary exactly once at startup.
    const { createCliRunExecution, createPipedLaunchChild } = await import(
      '../composition/local-agent-host.js'
    )
    const configPath = input.configPath
    const cliEntry = input.cliEntry ?? process.argv[1] ?? ''
    runExecution = createCliRunExecution({
      configPath,
      cliEntry,
      launchChild: createPipedLaunchChild(cliEntry, async (closed) => {
        const runDir = join(input.agentQaRoot, 'runs', slugBranch(closed.runId))
        await mkdir(runDir, { recursive: true })
        await Promise.all([
          writeFile(join(runDir, RUN_CHILD_STDOUT_FILE), closed.stdout, 'utf8'),
          writeFile(join(runDir, RUN_CHILD_STDERR_FILE), closed.stderr, 'utf8'),
        ])
        recordDaemonEvent({
          kind: 'run-child-exit',
          runId: closed.runId,
          exitCode: closed.exitCode,
        })
      }),
    })
  }
  // `operations` is test-only. Legacy injected drain fixtures opt out unless they also provide
  // the worker command seam; production (no operations table) always manages the child.
  const embedderLifecycleEnabled = input.operations?.drainQueue === undefined
    || input.operations.spawnEmbedderWorker !== undefined
  operations.trace?.('posture-pinned')

  const registrationSnapshot = readDaemonRegistration(input.agentQaRoot)
  const registration = registrationSnapshot.kind === 'parsed'
    ? await operations.classifyDaemonRegistration({
      agentQaRoot: input.agentQaRoot,
      knowledgeRoot: input.knowledgeRoot,
    })
    : registrationSnapshot
  if (registration.kind === 'live-confirmed') {
    logger.error(liveRegistrationMessage(registration.registration))
    return 1
  }
  if (registration.kind === 'malformed') {
    logger.error('agent-qa daemon registration is malformed; refusing to overwrite it')
    return 1
  }
  if (registration.kind === 'unreachable-lease-fresh') {
    logger.error(heldMessage(registration.holder))
    return 1
  }
  if (
    registration.kind === 'obsolete'
    || registration.kind === 'unreachable-lease-stale'
  ) {
    operations.removeDaemonRegistration(input.agentQaRoot)
    recordDaemonEvent({
      kind: 'registration-recovered',
      classification: registration.kind,
      pid: registration.registration.pid,
      ...('instanceId' in registration.registration
        ? { instanceId: registration.registration.instanceId }
        : {}),
    })
  }

  const acquired = operations.acquireWriterLease(input.knowledgeRoot)
  if (acquired.kind === 'held') {
    logger.error(heldMessage(acquired.holder))
    return 1
  }
  if (acquired.kind === 'refused') {
    logger.error(
      `agent-qa daemon writer lease acquisition refused [${acquired.reason}]: `
      + acquired.error.message,
    )
    return 1
  }
  operations.trace?.('lease-acquired')

  const authority: LeaseOperationOptions = {
    knowledgeRoot: input.knowledgeRoot,
    leaseId: acquired.leaseId,
  }

  let recovery: JobRecoveryHost | undefined
  let localAgent: LocalAgentHost | undefined
  let jobDispatcher: JobDispatcher | undefined
  let registrationWritten = false
  let heartbeatSupervisor: HeartbeatSupervisorHandle | undefined
  let curationPollTimer: ReturnType<typeof setInterval> | undefined
  let maintenanceTimer: ReturnType<typeof setInterval> | undefined
  let invokeServer: InvokeServerHandle | undefined
  let graceTimer: ReturnType<typeof setTimeout> | undefined
  let resolveCompletion: ((code: number) => void) | undefined
  let shutdownPromise: Promise<void> | undefined
  let shutdownCompleted = false
  let drainRequested = false
  let drainReceiptRequired = false
  let requestedDrainSessionId: string | undefined
  let activeDrainSessionId: string | undefined
  let drainWorker: Promise<void> | undefined
  let maintenanceWorker: Promise<void> | undefined
  let authorPromise: Promise<CuratorAuthor> | undefined
  let embedderWorkerIdleTimer: ReturnType<typeof setTimeout> | undefined

  type EmbedderWorkerExitReason = 'idle' | 'crash' | 'daemon-stop' | 'start-error' | 'replace'
  interface EmbedderWorkerRuntime {
    readonly mode: 'spawned' | 'adopted'
    readonly child?: ChildProcess
    readonly sessionId: string
    readonly stdout?: CapturedWorkerOutput
    readonly stderr?: CapturedWorkerOutput
    readonly exit: Promise<void>
    readonly resolveExit: () => void
    ready: Promise<void>
    registration?: EmbedderWorkerRegistration
    stopReason?: Exclude<EmbedderWorkerExitReason, 'crash'>
    finished: boolean
  }

  let embedderWorker: EmbedderWorkerRuntime | undefined
  let embedderWorkerEnsure: Promise<EmbedderWorkerRuntime> | undefined

  const completion = new Promise<number>((resolve) => {
    resolveCompletion = resolve
  })

  let controller: ReturnType<typeof createShutdownController> | undefined

  const clearEmbedderWorkerIdleTimer = (): void => {
    if (embedderWorkerIdleTimer === undefined) return
    operations.clearTimeout(embedderWorkerIdleTimer)
    embedderWorkerIdleTimer = undefined
  }

  const finishEmbedderWorkerExit = (
    runtime: EmbedderWorkerRuntime,
    code: number | null,
    signal: NodeJS.Signals | null,
  ): void => {
    if (runtime.finished) return
    runtime.finished = true
    if (embedderWorker === runtime) {
      clearEmbedderWorkerIdleTimer()
      embedderWorker = undefined
    }

    if (runtime.registration !== undefined) {
      try {
        operations.removeEmbedderWorkerRegistration(
          input.agentQaRoot,
          runtime.registration,
        )
      } catch (error) {
        logger.error(
          `Embedder worker registration cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
      try {
        operations.unlinkEmbedderWorkerSocket(runtime.registration.socketPath)
      } catch (error) {
        logger.error(
          `Embedder worker socket cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
    try {
      operations.resetEmbedderCapability()
    } catch (error) {
      logger.error(
        `Embedder capability reset failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }

    try {
      recordDaemonEvent({
        kind: 'embedder-worker-exit',
        sessionId: runtime.sessionId,
        pid: runtime.registration?.pid ?? runtime.child?.pid,
        mode: runtime.mode,
        code,
        signal,
        reason: runtime.stopReason ?? 'crash',
        stdout: runtime.stdout?.read() ?? '',
        stderr: runtime.stderr?.read() ?? '',
        outputTruncated:
          (runtime.stdout?.wasTruncated() ?? false)
          || (runtime.stderr?.wasTruncated() ?? false),
      })
    } catch (error) {
      logger.error(
        `Embedder worker exit event failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    } finally {
      runtime.resolveExit()
    }
  }

  const waitForEmbedderWorkerExit = (
    runtime: EmbedderWorkerRuntime,
    timeoutMs: number,
  ): Promise<boolean> => new Promise((resolve) => {
    let settled = false
    let timeout: ReturnType<typeof setTimeout> | undefined
    const finish = (exited: boolean): void => {
      if (settled) return
      settled = true
      if (timeout !== undefined) operations.clearTimeout(timeout)
      resolve(exited)
    }
    timeout = operations.setTimeout(() => finish(false), timeoutMs)
    timeout.unref?.()
    void runtime.exit.then(() => finish(true))
  })

  const stopEmbedderWorker = async (
    reason: Exclude<EmbedderWorkerExitReason, 'crash'>,
  ): Promise<void> => {
    const runtime = embedderWorker
    if (runtime === undefined) return
    clearEmbedderWorkerIdleTimer()
    runtime.stopReason ??= reason

    if (runtime.mode === 'adopted') {
      const registration = runtime.registration
      if (registration === undefined) {
        throw new Error('Adopted embedder worker is missing its retained registration')
      }
      const termWasSent = operations.signalEmbedderWorkerProcess(registration.pid, 'SIGTERM')
      if (
        await operations.waitForEmbedderWorkerProcessExit(
          registration.pid,
          EMBEDDER_WORKER_TERM_GRACE_MS,
        )
      ) {
        finishEmbedderWorkerExit(runtime, null, termWasSent ? 'SIGTERM' : null)
        return
      }

      recordDaemonEvent({
        kind: 'embedder-worker-terminate-escalated',
        sessionId: runtime.sessionId,
        pid: registration.pid,
        instanceId: registration.instanceId,
        mode: runtime.mode,
        signal: 'SIGKILL',
        reason,
      })
      const killWasSent = operations.signalEmbedderWorkerProcess(registration.pid, 'SIGKILL')
      if (
        await operations.waitForEmbedderWorkerProcessExit(
          registration.pid,
          EMBEDDER_WORKER_TERM_GRACE_MS,
        )
      ) {
        finishEmbedderWorkerExit(runtime, null, killWasSent ? 'SIGKILL' : null)
        return
      }
      throw new EmbedderWorkerTimeoutError('terminate', EMBEDDER_WORKER_TERM_GRACE_MS)
    }

    const child = runtime.child
    if (child === undefined) throw new Error('Spawned embedder worker is missing its child handle')

    if (child.exitCode !== null || child.signalCode !== null) {
      if (await waitForEmbedderWorkerExit(runtime, EMBEDDER_WORKER_TERM_GRACE_MS)) return
      throw new EmbedderWorkerTimeoutError('terminate', EMBEDDER_WORKER_TERM_GRACE_MS)
    }

    child.kill('SIGTERM')
    if (await waitForEmbedderWorkerExit(runtime, EMBEDDER_WORKER_TERM_GRACE_MS)) return

    recordDaemonEvent({
      kind: 'embedder-worker-terminate-escalated',
      sessionId: runtime.sessionId,
      pid: child.pid,
      mode: runtime.mode,
      signal: 'SIGKILL',
      reason,
    })
    child.kill('SIGKILL')
    if (await waitForEmbedderWorkerExit(runtime, EMBEDDER_WORKER_TERM_GRACE_MS)) return
    throw new EmbedderWorkerTimeoutError('terminate', EMBEDDER_WORKER_TERM_GRACE_MS)
  }

  const cleanOwnedEmbedderWorkerResources = (
    registration: OwnedEmbedderWorkerRegistration,
  ): void => {
    operations.removeEmbedderWorkerRegistration(input.agentQaRoot, registration)
    if (registration.schemaVersion === 2) {
      operations.unlinkEmbedderWorkerSocket(registration.socketPath)
    }
    operations.resetEmbedderCapability()
  }

  const terminateRegisteredEmbedderWorker = async (
    registration: EmbedderWorkerRegistration,
    sessionId: string,
  ): Promise<void> => {
    operations.signalEmbedderWorkerProcess(registration.pid, 'SIGTERM')
    if (
      await operations.waitForEmbedderWorkerProcessExit(
        registration.pid,
        EMBEDDER_WORKER_TERM_GRACE_MS,
      )
    ) return

    recordDaemonEvent({
      kind: 'embedder-worker-terminate-escalated',
      sessionId,
      pid: registration.pid,
      instanceId: registration.instanceId,
      mode: 'orphan-replacement',
      signal: 'SIGKILL',
      reason: 'replace',
    })
    operations.signalEmbedderWorkerProcess(registration.pid, 'SIGKILL')
    if (
      await operations.waitForEmbedderWorkerProcessExit(
        registration.pid,
        EMBEDDER_WORKER_TERM_GRACE_MS,
      )
    ) return
    throw new EmbedderWorkerTimeoutError('terminate', EMBEDDER_WORKER_TERM_GRACE_MS)
  }

  type EmbedderWorkerPreflight =
    | { readonly kind: 'adopt'; readonly registration: EmbedderWorkerRegistration }
    | {
        readonly kind: 'spawn'
        readonly outcome: 'fresh' | 'replaced' | 'stale-recovered'
        readonly replacedRegistration?: EmbedderWorkerRegistration
      }

  const classifyEmbedderWorkerBeforeSpawn = async (
    sessionId: string,
  ): Promise<EmbedderWorkerPreflight> => {
    const projectRoot = dirname(input.agentQaRoot)
    const outcome = operations.readEmbedderWorkerRegistration(input.agentQaRoot)
    if (outcome.kind === 'absent') return { kind: 'spawn', outcome: 'fresh' }
    if (outcome.kind === 'malformed') {
      throw new Error('Embedder worker registration is malformed; refusing to overwrite it')
    }
    if (outcome.kind === 'stale-recoverable') {
      cleanOwnedEmbedderWorkerResources(outcome.registration)
      return { kind: 'spawn', outcome: 'stale-recovered' }
    }

    const registration = outcome.registration
    const expectedSocketPath = operations.embedderWorkerSocketPath(
      input.agentQaRoot,
      projectRoot,
      registration.instanceId,
    )
    if (registration.socketPath !== expectedSocketPath) {
      throw new Error('Embedder worker registration names a non-owned socket path')
    }

    // The socket probe intentionally precedes every possible signal delivery. A schema-valid file
    // narrows the pid-reuse hazard to the one registered pid; ESRCH confirmation bounds the stop.
    const socketAnswers = await operations.probeEmbedderWorkerSocket(registration.socketPath)
    const processIsAlive = operations.embedderWorkerProcessIsAlive(registration.pid)
    const profileMatches = isDeepStrictEqual(registration.profile, DEFAULT_EMBEDDING_PROFILE)
    if (socketAnswers && processIsAlive && profileMatches) {
      return { kind: 'adopt', registration }
    }

    if (processIsAlive) await terminateRegisteredEmbedderWorker(registration, sessionId)
    cleanOwnedEmbedderWorkerResources(registration)
    return { kind: 'spawn', outcome: 'replaced', replacedRegistration: registration }
  }

  const adoptEmbedderWorker = (
    sessionId: string,
    registration: EmbedderWorkerRegistration,
  ): EmbedderWorkerRuntime => {
    let resolveExit = (): void => undefined
    const exit = new Promise<void>((resolve) => {
      resolveExit = resolve
    })
    const runtime: EmbedderWorkerRuntime = {
      mode: 'adopted',
      sessionId,
      exit,
      resolveExit,
      ready: Promise.resolve(),
      registration,
      finished: false,
    }
    embedderWorker = runtime
    recordDaemonEvent({
      kind: 'embedder-worker-start',
      sessionId,
      pid: registration.pid,
      instanceId: registration.instanceId,
      modelId: registration.profile.model_id,
      mode: runtime.mode,
      outcome: 'adopted',
    })
    return runtime
  }

  const spawnFreshEmbedderWorker = async (
    sessionId: string,
    preflight: Extract<EmbedderWorkerPreflight, { kind: 'spawn' }>,
  ): Promise<EmbedderWorkerRuntime> => {
    const projectRoot = dirname(input.agentQaRoot)
    const entryPath = operations.resolveEmbedderWorkerEntryPath()
    const workerInstanceId = operations.randomUUID()
    const spawnOptions: EmbedderWorkerSpawnOptions = {
      command: process.execPath,
      args: [
        entryPath,
        projectRoot,
        JSON.stringify(DEFAULT_EMBEDDING_PROFILE),
        workerInstanceId,
      ],
      cwd: projectRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    }
    const child = operations.spawnEmbedderWorker(spawnOptions)
    if (child.stdout === null || child.stderr === null) {
      child.kill('SIGTERM')
      throw new Error('Embedder worker stdout/stderr pipes were not created')
    }

    let resolveExit = (): void => undefined
    const exit = new Promise<void>((resolve) => {
      resolveExit = resolve
    })
    const runtime: EmbedderWorkerRuntime = {
      mode: 'spawned',
      child,
      sessionId,
      stdout: captureWorkerOutput(child.stdout),
      stderr: captureWorkerOutput(child.stderr),
      exit,
      resolveExit,
      ready: Promise.resolve(),
      finished: false,
    }
    embedderWorker = runtime
    child.once('error', (error) => {
      logger.error(`Embedder worker spawn error: ${error.message}`)
    })
    child.once('close', (code, signal) => finishEmbedderWorkerExit(runtime, code, signal))

    runtime.ready = (async () => {
      recordDaemonEvent({
        kind: 'embedder-worker-start',
        sessionId,
        pid: child.pid,
        instanceId: workerInstanceId,
        modelId: DEFAULT_EMBEDDING_PROFILE.model_id,
        mode: runtime.mode,
        outcome: preflight.outcome,
        ...(preflight.replacedRegistration === undefined
          ? {}
          : { replacedInstanceId: preflight.replacedRegistration.instanceId }),
      })
      const startAbort = new AbortController()
      const startTimeout = operations.setTimeout(() => {
        startAbort.abort(
          new EmbedderWorkerTimeoutError('start', EMBEDDER_WORKER_START_TIMEOUT_MS),
        )
      }, EMBEDDER_WORKER_START_TIMEOUT_MS)
      startTimeout.unref?.()
      try {
        const registration = await Promise.race([
          operations.waitForEmbedderWorkerReady(
            input.agentQaRoot,
            child.pid,
            workerInstanceId,
            startAbort.signal,
          ),
          runtime.exit.then(() => {
            throw new Error('Embedder worker exited before publishing its registration')
          }),
        ])
        const expectedSocketPath = operations.embedderWorkerSocketPath(
          input.agentQaRoot,
          projectRoot,
          workerInstanceId,
        )
        if (
          registration.socketPath !== expectedSocketPath
          || !isDeepStrictEqual(registration.profile, DEFAULT_EMBEDDING_PROFILE)
        ) {
          throw new Error('Embedder worker published a registration outside its owned generation')
        }
        runtime.registration = registration
      } finally {
        operations.clearTimeout(startTimeout)
        if (!startAbort.signal.aborted) startAbort.abort()
      }
    })()
    try {
      await runtime.ready
    } catch (error) {
      runtime.stopReason ??= 'start-error'
      await stopEmbedderWorker('start-error')
      throw error
    }
    return runtime
  }

  const initializeEmbedderWorker = async (
    sessionId: string,
  ): Promise<EmbedderWorkerRuntime> => {
    const preflight = await classifyEmbedderWorkerBeforeSpawn(sessionId)
    return preflight.kind === 'adopt'
      ? adoptEmbedderWorker(sessionId, preflight.registration)
      : spawnFreshEmbedderWorker(sessionId, preflight)
  }

  const ensureEmbedderWorker = async (sessionId: string): Promise<EmbedderWorkerRuntime> => {
    while (true) {
      const current = embedderWorker
      if (current !== undefined) {
        if (current.stopReason !== undefined) {
          await current.exit
          continue
        }
        clearEmbedderWorkerIdleTimer()
        await current.ready
        if (current.mode === 'adopted') {
          const registration = current.registration
          if (registration === undefined) {
            throw new Error('Adopted embedder worker is missing its retained registration')
          }
          const socketAnswers = await operations.probeEmbedderWorkerSocket(
            registration.socketPath,
          )
          const processIsAlive = operations.embedderWorkerProcessIsAlive(registration.pid)
          if (socketAnswers && processIsAlive) return current
          if (processIsAlive) {
            await stopEmbedderWorker('replace')
          } else {
            current.stopReason = 'replace'
            finishEmbedderWorkerExit(current, null, null)
          }
          continue
        }
        return current
      }

      if (embedderWorkerEnsure !== undefined) return embedderWorkerEnsure
      const pending = initializeEmbedderWorker(sessionId)
      embedderWorkerEnsure = pending
      try {
        return await pending
      } finally {
        if (embedderWorkerEnsure === pending) embedderWorkerEnsure = undefined
      }
    }
  }

  const acquireRequiredEmbedder = () => operations.acquireEmbedder({
    allowDownload: false,
    workerPolicy: 'required',
    agentQaRoot: input.agentQaRoot,
  })

  const armEmbedderWorkerIdleTimer = (runtime: EmbedderWorkerRuntime): void => {
    clearEmbedderWorkerIdleTimer()
    if (shutdownPromise !== undefined || embedderWorker !== runtime) return
    const timer = operations.setTimeout(() => {
      if (embedderWorkerIdleTimer !== timer || embedderWorker !== runtime) return
      embedderWorkerIdleTimer = undefined
      void stopEmbedderWorker('idle').catch((error) => {
        logger.error(
          `Embedder worker idle stop failed: ${error instanceof Error ? error.message : String(error)}`,
        )
      })
    }, EMBEDDER_WORKER_IDLE_MS)
    timer.unref?.()
    embedderWorkerIdleTimer = timer
  }

  const remainingTotal = (
    work: ReturnType<DaemonHostOperations['countRemainingCurationWork']>,
  ): number => work.queued + work.claimedNonterminal + work.quarantined

  const drainSession = async (
    sessionId: string,
    receiptRequired: boolean,
  ): Promise<void> => {
    const initialWork = operations.inspectDrainableCurationWork({
      knowledgeRoot: input.knowledgeRoot,
      currentLeaseId: acquired.leaseId,
    })
    const initialCandidates = [
      ...initialWork.queuedCandidateIds,
      ...initialWork.recoverableClaimedCandidateIds,
    ]
    if (initialCandidates.length === 0 && !receiptRequired) return
    if (
      initialCandidates.length > 0
      && (input.author === undefined || input.policy === undefined)
    ) {
      throw new Error('Daemon curation requires an author factory and guardrail policy')
    }

    const seenCandidateIds = new Set(initialCandidates)
    let jobsProcessed = 0
    let failures = 0
    let quarantined = 0
    let remainingAfter = remainingTotal(operations.countRemainingCurationWork(
      input.knowledgeRoot,
      { currentLeaseId: acquired.leaseId },
    ))
    recordDaemonEvent({
      kind: 'drain-session-start',
      sessionId,
      holderPid: process.pid,
      epoch: acquired.epoch,
    })

    const author = initialCandidates.length === 0
      ? undefined
      : await (authorPromise ??= Promise.resolve(input.author!()))
    while (remainingAfter > 0) {
      const observed = operations.inspectDrainableCurationWork({
        knowledgeRoot: input.knowledgeRoot,
        currentLeaseId: acquired.leaseId,
      })
      for (const candidateId of [
        ...observed.queuedCandidateIds,
        ...observed.recoverableClaimedCandidateIds,
      ]) {
        seenCandidateIds.add(candidateId)
      }
      if (
        observed.queuedCandidateIds.length === 0
        && observed.recoverableClaimedCandidateIds.length === 0
      ) {
        break
      }
      let worker: EmbedderWorkerRuntime | undefined
      if (embedderLifecycleEnabled) {
        try {
          worker = await ensureEmbedderWorker(sessionId)
        } catch (error) {
          logger.error(
            `Embedder worker start failed: ${error instanceof Error ? error.message : String(error)}`,
          )
        }
      }
      const embeddingCapability = embedderLifecycleEnabled
        ? await acquireRequiredEmbedder()
        : { kind: 'deferred' as const, reason: 'worker-unavailable' as const }
      let report: Awaited<ReturnType<DaemonHostOperations['drainQueue']>>
      try {
        report = await operations.drainQueue({
          knowledgeRoot: input.knowledgeRoot,
          auditBaseDir: input.agentQaRoot,
          budgetMs: 'unbounded',
          lease: { leaseId: acquired.leaseId, epoch: acquired.epoch },
          author: author!,
          executionContext: 'local-headless',
          policy: input.policy!,
          embeddingCapability,
          maintenance: 'skip',
          onJobLifecycle: (event) => {
            seenCandidateIds.add(event.candidateId)
            recordDaemonEvent({
              kind: event.kind,
              sessionId,
              candidateId: event.candidateId,
              holderPid: process.pid,
              leaseId: acquired.leaseId,
              epoch: acquired.epoch,
            })
          },
        })
      } catch (error) {
        failures += 1
        logger.error(
          `Daemon curation drain failed: ${error instanceof Error ? error.message : String(error)}`,
        )
        remainingAfter = remainingTotal(operations.countRemainingCurationWork(
          input.knowledgeRoot,
          { currentLeaseId: acquired.leaseId },
        ))
        break
      } finally {
        if (worker !== undefined) armEmbedderWorkerIdleTimer(worker)
      }
      jobsProcessed += report.jobsProcessed
      failures += report.failures
      quarantined += report.quarantined
      remainingAfter = remainingTotal(operations.countRemainingCurationWork(
        input.knowledgeRoot,
        { currentLeaseId: acquired.leaseId },
      ))
      if (
        remainingAfter > 0
        && (
          report.jobsProcessed === 0
          || report.failures > 0
          || report.quarantined > 0
          || report.requeued > 0
        )
      ) break
    }

    const candidateIds = [...seenCandidateIds].sort()
    const outcome = failures === 0 && quarantined === 0 && remainingAfter === 0
      ? 'completed' as const
      : 'failed' as const
    if (receiptRequired || jobsProcessed > 0 || outcome === 'failed') {
      operations.appendDrainSessionReceipt(input.agentQaRoot, {
        ts: new Date(operations.now()).toISOString(),
        sessionId,
        holderPid: process.pid,
        epoch: acquired.epoch,
        candidateIds,
        remainingAfter,
        outcome,
        failures,
        quarantined,
      })
    }
    recordDaemonEvent({
      kind: 'drain-session-end',
      sessionId,
      holderPid: process.pid,
      epoch: acquired.epoch,
      candidateIds,
      jobsProcessed,
      remainingAfter,
    })
  }

  const serviceDrainRequests = async (): Promise<void> => {
    while (drainRequested && shutdownPromise === undefined) {
      drainRequested = false
      const sessionId = requestedDrainSessionId ?? operations.randomUUID()
      const receiptRequired = drainReceiptRequired
      requestedDrainSessionId = undefined
      drainReceiptRequired = false
      activeDrainSessionId = sessionId
      try {
        await drainSession(sessionId, receiptRequired)
      } finally {
        activeDrainSessionId = undefined
      }
    }
  }

  const requestDrain = (receiptRequired = false): string | undefined => {
    if (shutdownPromise !== undefined) return undefined
    drainRequested = true
    drainReceiptRequired ||= receiptRequired
    // A nudge arriving during an unreceipted cadence pass must identify the
    // follow-up session whose terminal receipt is guaranteed to be written.
    if (activeDrainSessionId !== undefined) {
      requestedDrainSessionId ??= operations.randomUUID()
      return requestedDrainSessionId
    }
    requestedDrainSessionId ??= operations.randomUUID()
    const sessionId = requestedDrainSessionId
    if (drainWorker !== undefined) return sessionId
    drainWorker = serviceDrainRequests()
      .catch((error) => {
        logger.error(
          `Daemon curation drain failed: ${error instanceof Error ? error.message : String(error)}`,
        )
      })
      .finally(() => {
        drainWorker = undefined
        if (drainRequested && shutdownPromise === undefined) requestDrain()
      })
    return sessionId
  }

  const detachSignals = (): void => {
    if (controller === undefined) return
    const activeController = controller
    controller = undefined
    let firstFailure: unknown
    try {
      operations.offSignal('SIGINT', activeController.handleSignal)
    } catch (error) {
      firstFailure = error
    }
    try {
      operations.offSignal('SIGTERM', activeController.handleSignal)
    } catch (error) {
      firstFailure ??= error
    }
    try {
      activeController.dispose()
    } catch (error) {
      firstFailure ??= error
    }
    if (firstFailure !== undefined) throw firstFailure
  }

  const armShutdownGrace = (): void => {
    if (shutdownCompleted || graceTimer !== undefined) return
    graceTimer = operations.setTimeout(
      () => operations.hardExit(130),
      DAEMON_SHUTDOWN_GRACE_MS,
    )
    graceTimer.unref?.()
  }

  const beginShutdown = (
    requestedCode: number,
    releaseAuthority: boolean,
    reason: 'signal' | 'lease-lost' | 'startup-error',
  ): Promise<void> => {
    if (shutdownPromise !== undefined) return shutdownPromise
    const executeShutdown = async (): Promise<void> => {
      const failures: Array<{ stage: string; message: string }> = []
      let exitCode = requestedCode
      const recordShutdownFailure = (stage: string, error: unknown): void => {
        const message = error instanceof Error ? error.message : String(error)
        failures.push({ stage, message })
        try {
          logger.error(`Daemon shutdown stage ${stage} failed: ${message}`)
        } catch {
          // A logger failure must not interrupt cleanup convergence.
        }
        try {
          recordDaemonEvent({
            kind: 'shutdown-stage-failed',
            stage,
            message,
          })
        } catch {
          // Event recording is best-effort and already reports its own sink failures.
        }
      }
      const runStage = async (
        stage: DaemonShutdownStage,
        action: () => void | Promise<void>,
      ): Promise<void> => {
        try {
          await operations.runShutdownStage(stage, action)
        } catch (error) {
          recordShutdownFailure(stage, error)
        }
      }
      const runSyncCleanup = (stage: string, action: () => void): void => {
        try {
          action()
        } catch (error) {
          recordShutdownFailure(stage, error)
        }
      }

      try {
        if (reason === 'lease-lost') {
          runSyncCleanup('shutdownGrace.arm', armShutdownGrace)
        }
        runSyncCleanup('shutdown.trace', () => operations.trace?.('shutdown-started'))
        const supervisor = heartbeatSupervisor
        heartbeatSupervisor = undefined
        await runStage('heartbeatSupervisor.stop', async () => {
          await supervisor?.stop()
        })
        if (curationPollTimer !== undefined) {
          const timer = curationPollTimer
          curationPollTimer = undefined
          runSyncCleanup('curationPollTimer.clear', () => operations.clearInterval(timer))
        }
        if (maintenanceTimer !== undefined) {
          const timer = maintenanceTimer
          maintenanceTimer = undefined
          runSyncCleanup('maintenanceTimer.clear', () => operations.clearInterval(timer))
        }

        const server = invokeServer
        invokeServer = undefined
        await runStage('invokeServer.close', async () => {
          await server?.close()
        })

        await runStage('drainWorker', async () => {
          await drainWorker
        })
        drainWorker = undefined
        await runStage('maintenanceWorker', async () => {
          await maintenanceWorker
        })
        maintenanceWorker = undefined

        runSyncCleanup('embedderWorkerIdleTimer.clear', clearEmbedderWorkerIdleTimer)
        await runStage('stopEmbedderWorker', async () => {
          await stopEmbedderWorker('daemon-stop')
        })

        const dispatcher = jobDispatcher
        jobDispatcher = undefined
        await runStage('jobDispatcher.stop', async () => {
          await dispatcher?.stop()
        })
        const agent = localAgent
        localAgent = undefined
        await runStage('localAgent.close', async () => {
          await agent?.close()
        })
        const activeRecovery = recovery
        recovery = undefined
        runSyncCleanup('recovery.close', () => activeRecovery?.close())

        if (releaseAuthority) {
          await runStage('releaseLease', () => {
            const released = operations.releaseLease(authority)
            if (released.kind === 'released') {
              operations.trace?.('lease-released')
            } else {
              exitCode = 1
              recordDaemonEvent({
                kind: 'lease-lost',
                reason: released.reason,
                observedEpoch: released.holder?.epoch,
              })
            }
          })
        }
      } catch (error) {
        // The staged helpers should contain failures; this protects convergence from helper bugs.
        recordShutdownFailure('shutdown.unexpected', error)
      } finally {
        if (registrationWritten) {
          registrationWritten = false
          runSyncCleanup('removeRegistrationIfOwned', () => {
            const removed = operations.removeRegistrationIfOwned(
              input.agentQaRoot,
              instanceId,
            )
            if (removed) operations.trace?.('registration-removed')
          })
        }
        runSyncCleanup('signals.detach', detachSignals)
        if (graceTimer !== undefined) {
          const timer = graceTimer
          graceTimer = undefined
          runSyncCleanup('shutdownGrace.clear', () => operations.clearTimeout(timer))
        }

        if (failures.length > 0) exitCode = 1
        try {
          recordDaemonEvent({
            kind: 'daemon-stopped',
            exitCode,
            reason,
            failureCount: failures.length,
            failedStages: failures.map((failure) => failure.stage),
            failures,
          })
        } catch {
          // Completion still settles if both the event sink and its logger fail.
        }
        shutdownCompleted = true
        resolveCompletion?.(exitCode)
      }
    }
    // Publish the memo before cleanup begins so even a synchronous re-entrant trigger observes it.
    shutdownPromise = Promise.resolve().then(executeShutdown)
    return shutdownPromise
  }

  const handleHeartbeatMessage = (heartbeat: HeartbeatSupervisorMessage): void => {
    if (shutdownPromise !== undefined) return
    if (heartbeat.kind === 'heartbeated') {
      recordDaemonEvent({
        kind: 'lease-heartbeated',
        pid: heartbeat.holder.pid,
        epoch: heartbeat.holder.epoch,
        heartbeatAtMs: heartbeat.holder.heartbeatAtMs,
      })
      return
    }

    if (heartbeat.kind === 'refused') {
      recordDaemonEvent({
        kind: 'lease-lost',
        reason: heartbeat.reason,
        observedEpoch: heartbeat.observedEpoch ?? heartbeat.holder?.epoch,
      })
    } else {
      recordDaemonEvent({
        kind: 'lease-lost',
        reason: 'heartbeat-error',
        detail: `${heartbeat.name}: ${heartbeat.message}`,
      })
    }
    void beginShutdown(1, false, 'lease-lost')
  }

  const handleUnexpectedHeartbeatExit = (error: Error): void => {
    if (shutdownPromise !== undefined) return
    recordDaemonEvent({
      kind: 'lease-lost',
      reason: 'heartbeat-error',
      detail: error.message,
    })
    void beginShutdown(1, false, 'lease-lost')
  }

  try {
    const initialHeartbeat = operations.heartbeatLease(authority)
    if (initialHeartbeat.kind === 'refused') {
      recordDaemonEvent({
        kind: 'lease-lost',
        reason: initialHeartbeat.reason,
        observedEpoch: initialHeartbeat.observedEpoch ?? initialHeartbeat.holder?.epoch,
      })
      await beginShutdown(1, false, 'lease-lost')
      return await completion
    }

    heartbeatSupervisor = await operations.startHeartbeatSupervisor({
      knowledgeRoot: authority.knowledgeRoot,
      leaseId: authority.leaseId,
      intervalMs: LEASE_HEARTBEAT_INTERVAL_MS,
      onMessage: handleHeartbeatMessage,
      onUnexpectedExit: handleUnexpectedHeartbeatExit,
    })
    operations.trace?.('heartbeat-started')
    recordDaemonEvent({
      kind: 'lease-acquired',
      pid: process.pid,
      leaseId: acquired.leaseId,
      epoch: acquired.epoch,
    })
    if (acquired.reclaimed !== undefined) {
      recordDaemonEvent({
        kind: 'lease-reclaimed',
        priorHolderPid: acquired.reclaimed.pid,
        priorLeaseId: acquired.reclaimed.leaseId,
        priorEpoch: acquired.reclaimed.epoch,
        newEpoch: acquired.epoch,
      })
    }
    recordDaemonEvent({
      kind: 'epoch-bump',
      epoch: acquired.epoch,
    })
    recordDaemonEvent({
      kind: 'lease-heartbeated',
      pid: initialHeartbeat.holder.pid,
      epoch: initialHeartbeat.holder.epoch,
      heartbeatAtMs: initialHeartbeat.holder.heartbeatAtMs,
    })

    const model = await input.model()
    recovery = operations.composeJobRecovery({
      agentQaRoot: input.agentQaRoot,
      clock: SYSTEM_CLOCK,
      idSource: DIGEST_JOB_ID_SOURCE,
      model,
    })
    operations.trace?.('recovery-composed')
    const fence = await recovery.store.adoptEpoch(acquired.epoch)
    operations.trace?.('epoch-adopted')
    await recovery.recoverAbandonedClaims(fence)
    operations.trace?.('claims-recovered')
    recovery.close()
    recovery = undefined

    localAgent = operations.composeLocalAgent({
      agentQaRoot: input.agentQaRoot,
      config: input.config,
      knowledgeRoot: () => input.knowledgeRoot,
      model: () => model,
      ...(runExecution === undefined ? {} : { runExecution }),
      clock: SYSTEM_CLOCK,
      idSource: DIGEST_JOB_ID_SOURCE,
    })
    operations.trace?.('local-agent-composed')
    const jobs = await localAgent.jobs()
    operations.trace?.('jobs-opened')
    jobDispatcher = createJobDispatcher({
      queue: jobs.queue,
      fence,
      scheduler: {
        now: operations.now,
        setTimeout: operations.setTimeout,
        clearTimeout: operations.clearTimeout,
      },
      recordEvent: recordDaemonEvent,
      reportError: (error) => logger.error(
        `Daemon agent-job dispatch failed: ${error instanceof Error ? error.message : String(error)}`,
      ),
    })

    controller = createShutdownController({
      cancel: () => {
        armShutdownGrace()
        void beginShutdown(0, true, 'signal')
      },
      exit: (code) => operations.hardExit(code),
      // A daemon's first signal is a successful operator stop, not a cancelled test verdict.
      setExitCode: () => undefined,
      armGrace: armShutdownGrace,
    })
    operations.onSignal('SIGINT', controller.handleSignal)
    operations.onSignal('SIGTERM', controller.handleSignal)

    // Registration is the readiness commit: handlers are live and the socket must listen first.
    const socketPath = input.socketPath ?? daemonSocketPath(
      input.agentQaRoot,
      dirname(input.agentQaRoot),
    )
    const startedServer = await operations.startInvokeServer({
      socketPath,
      registry: localAgent.registry,
      identity: {
        schemaVersion: DAEMON_IDENTITY_SCHEMA_VERSION,
        instanceId,
        pid: process.pid,
      },
      onNudge: (nudge) => {
        const sessionId = requestDrain(nudge.requireReceipt)
        jobDispatcher?.wake()
        if (sessionId === undefined) {
          throw new Error('Daemon is shutting down and cannot accept a drain nudge')
        }
        return { sessionId }
      },
    })
    if (shutdownPromise !== undefined) {
      await startedServer.close()
      await shutdownPromise
      return await completion
    }
    invokeServer = startedServer

    operations.writeDaemonRegistration(input.agentQaRoot, {
      schemaVersion: DAEMON_REGISTRATION_SCHEMA_VERSION,
      instanceId,
      pid: process.pid,
      socketPath,
      startedAtMs: operations.now(),
    })
    registrationWritten = true
    operations.trace?.('registration-written')

    curationPollTimer = operations.setInterval(requestDrain, CURATION_QUEUE_POLL_MS)
    maintenanceTimer = operations.setInterval(() => {
      if (shutdownPromise !== undefined || maintenanceWorker !== undefined) return
      maintenanceWorker = (async () => {
        const sessionId = operations.randomUUID()
        let worker: EmbedderWorkerRuntime | undefined
        if (embedderLifecycleEnabled) {
          try {
            worker = await ensureEmbedderWorker(sessionId)
          } catch (error) {
            logger.error(
              `Embedder worker start failed: ${error instanceof Error ? error.message : String(error)}`,
            )
          }
        }
        const embeddingCapability = embedderLifecycleEnabled
          ? await acquireRequiredEmbedder()
          : { kind: 'deferred' as const, reason: 'worker-unavailable' as const }
        try {
          await operations.runMaintenanceTail({
            knowledgeRoot: input.knowledgeRoot,
            lease: { leaseId: acquired.leaseId, epoch: acquired.epoch },
            embeddingCapability,
          })
        } finally {
          if (worker !== undefined) armEmbedderWorkerIdleTimer(worker)
        }
      })()
        .then(() => undefined)
        .catch((error) => {
          recordDaemonEvent({
            kind: 'lease-lost',
            reason:
              typeof error === 'object'
                && error !== null
                && 'reason' in error
                && typeof error.reason === 'string'
                ? error.reason
                : 'maintenance-error',
            observedEpoch:
              typeof error === 'object'
                && error !== null
                && 'observedEpoch' in error
                && typeof error.observedEpoch === 'number'
                ? error.observedEpoch
                : undefined,
            detail: error instanceof Error ? error.message : String(error),
          })
          void beginShutdown(1, false, 'lease-lost')
        })
        .finally(() => {
          maintenanceWorker = undefined
        })
    }, MAINTENANCE_CADENCE_MS)

    logger.info(`agent-qa daemon started (pid ${process.pid}, epoch ${acquired.epoch})`)

    return await completion
  } catch (error) {
    await beginShutdown(1, true, 'startup-error')
    throw error
  } finally {
    if (!shutdownCompleted) await beginShutdown(1, true, 'startup-error')
  }
}
