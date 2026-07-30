import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import type { Readable } from 'node:stream'

import type { ConfigReaderPort, JobModelCapability } from '@vostride/agent-qa-agent'
import {
  composeJobRecovery,
  composeLocalAgent,
  DIGEST_JOB_ID_SOURCE,
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
  daemonSocketPath,
  startInvokeServer,
  type InvokeServerHandle,
  type StartInvokeServerOptions,
} from './server.js'
import {
  DAEMON_REGISTRATION_SCHEMA_VERSION,
  inspectDaemonRegistration,
  removeDaemonRegistration,
  writeDaemonRegistration,
} from './registration.js'
import type { DaemonRegistration } from './registration.js'

/** Provisional daemon heartbeat interval; retune from operational evidence without adding config. */
export const LEASE_HEARTBEAT_INTERVAL_MS = 10_000

/** Provisional lost-nudge backstop; retune from operational evidence without adding config. */
export const CURATION_QUEUE_POLL_MS = 30_000

/** Provisional writer-maintenance cadence; retune from operational evidence without adding config. */
export const MAINTENANCE_CADENCE_MS = 300_000

/** Provisional synchronous drain wait; retune from operational evidence without adding config. */
export const DRAIN_WAIT_TIMEOUT_MS = 120_000

/** Provisional graceful-stop backstop; retune from operational evidence without adding config. */
export const DAEMON_SHUTDOWN_GRACE_MS = 10_000

/** Provisional worker residency window; retune from daemon telemetry without adding config. */
export const EMBEDDER_WORKER_IDLE_MS = 300_000

/** Bound each captured worker stream before it is attributed to the daemon event log. */
export const EMBEDDER_WORKER_OUTPUT_CAP_BYTES = 65_536

/** Provisional child readiness backstop; model loading must not stall a drain indefinitely. */
export const EMBEDDER_WORKER_START_TIMEOUT_MS = 120_000

export type DaemonHostTraceStep =
  | 'posture-pinned'
  | 'lease-acquired'
  | 'recovery-composed'
  | 'epoch-adopted'
  | 'claims-recovered'
  | 'pending-resumed'
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
  acquireWriterLease(knowledgeRoot: string): AcquireWriterLeaseOutcome
  heartbeatLease(options: LeaseOperationOptions): HeartbeatLeaseOutcome
  releaseLease(options: LeaseOperationOptions): ReleaseLeaseOutcome
  composeJobRecovery(input: ComposeJobRecoveryInput): JobRecoveryHost
  composeLocalAgent(input: ComposeLocalAgentInput): LocalAgentHost
  appendDaemonEvent(agentQaRoot: string, event: DaemonEvent): void
  writeDaemonRegistration(agentQaRoot: string, registration: DaemonRegistration): void
  removeDaemonRegistration(agentQaRoot: string): void
  startInvokeServer(options: StartInvokeServerOptions): Promise<InvokeServerHandle>
  listQueuedCandidates(knowledgeRoot: string): string[]
  drainQueue: typeof LOCAL_DAEMON_CAPABILITIES.drainQueue
  runMaintenanceTail: typeof LOCAL_DAEMON_CAPABILITIES.runMaintenanceTail
  appendDrainSessionReceipt(agentQaRoot: string, receipt: DrainSessionReceipt): void
  resolveEmbedderWorkerEntryPath(): string
  spawnEmbedderWorker(options: EmbedderWorkerSpawnOptions): ChildProcess
  waitForEmbedderWorkerReady(agentQaRoot: string, pid: number | undefined): Promise<void>
  removeEmbedderWorkerRegistration(agentQaRoot: string): boolean
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
  /** Plan 08 supplies the daemon's piped child launcher. */
  runExecution?: RunExecutionPort
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
): Promise<void> {
  const deadline = Date.now() + EMBEDDER_WORKER_START_TIMEOUT_MS
  while (Date.now() < deadline) {
    const outcome = LOCAL_DAEMON_CAPABILITIES.readEmbedderWorkerRegistration(agentQaRoot)
    if (
      outcome.kind === 'parsed'
      && (pid === undefined || outcome.registration.pid === pid)
    ) {
      return
    }
    if (outcome.kind === 'malformed') {
      throw new Error('Embedder worker registration is malformed')
    }
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error('Embedder worker did not publish a live registration before the timeout')
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
    acquireWriterLease: LOCAL_DAEMON_CAPABILITIES.acquireWriterLease,
    heartbeatLease: LOCAL_DAEMON_CAPABILITIES.heartbeatLease,
    releaseLease: LOCAL_DAEMON_CAPABILITIES.releaseLease,
    composeJobRecovery,
    composeLocalAgent,
    appendDaemonEvent,
    writeDaemonRegistration,
    removeDaemonRegistration,
    startInvokeServer,
    listQueuedCandidates: LOCAL_DAEMON_CAPABILITIES.listQueuedCandidates,
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
 * Startup order is part of the safety contract: pin posture, acquire authority, recover under the
 * acquired epoch, compose the local agent once, register, then start the independent heartbeat.
 */
export async function runDaemonHost(input: DaemonHostOptions): Promise<number> {
  // D-09: this is deliberately the first effect and is never injectable or TTY-dependent.
  LOCAL_DAEMON_CAPABILITIES.pinLocalHeadlessExecutionContext()

  const operations = { ...defaultOperations(), ...input.operations }
  const logger = input.logger ?? DEFAULT_LOGGER
  // `operations` is test-only. Legacy injected drain fixtures opt out unless they also provide
  // the worker command seam; production (no operations table) always manages the child.
  const embedderLifecycleEnabled = input.operations?.drainQueue === undefined
    || input.operations.spawnEmbedderWorker !== undefined
  operations.trace?.('posture-pinned')

  const registration = inspectDaemonRegistration(input.agentQaRoot)
  if (registration.kind === 'live') {
    logger.error(liveRegistrationMessage(registration.registration))
    return 1
  }
  if (registration.kind === 'malformed') {
    logger.error('agent-qa daemon registration is malformed; refusing to overwrite it')
    return 1
  }
  if (registration.kind === 'stale') {
    operations.removeDaemonRegistration(input.agentQaRoot)
  }

  const acquired = operations.acquireWriterLease(input.knowledgeRoot)
  if (acquired.kind === 'held') {
    logger.error(heldMessage(acquired.holder))
    return 1
  }
  operations.trace?.('lease-acquired')

  const authority: LeaseOperationOptions = {
    knowledgeRoot: input.knowledgeRoot,
    leaseId: acquired.leaseId,
  }
  operations.appendDaemonEvent(input.agentQaRoot, {
    kind: 'lease-acquired',
    pid: process.pid,
    leaseId: acquired.leaseId,
    epoch: acquired.epoch,
  })
  operations.appendDaemonEvent(input.agentQaRoot, {
    kind: 'epoch-bump',
    epoch: acquired.epoch,
  })

  let recovery: JobRecoveryHost | undefined
  let localAgent: LocalAgentHost | undefined
  let registrationWritten = false
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined
  let curationPollTimer: ReturnType<typeof setInterval> | undefined
  let maintenanceTimer: ReturnType<typeof setInterval> | undefined
  let invokeServer: InvokeServerHandle | undefined
  let graceTimer: ReturnType<typeof setTimeout> | undefined
  let resolveCompletion: ((code: number) => void) | undefined
  let shutdownPromise: Promise<void> | undefined
  let shutdownCompleted = false
  let drainRequested = false
  let drainWorker: Promise<void> | undefined
  let maintenanceWorker: Promise<void> | undefined
  let authorPromise: Promise<CuratorAuthor> | undefined
  let embedderWorkerIdleTimer: ReturnType<typeof setTimeout> | undefined

  type EmbedderWorkerExitReason = 'idle' | 'crash' | 'daemon-stop' | 'start-error'
  interface EmbedderWorkerRuntime {
    readonly child: ChildProcess
    readonly sessionId: string
    readonly stdout: CapturedWorkerOutput
    readonly stderr: CapturedWorkerOutput
    readonly exit: Promise<void>
    readonly resolveExit: () => void
    stopReason?: Exclude<EmbedderWorkerExitReason, 'crash'>
  }

  let embedderWorker: EmbedderWorkerRuntime | undefined

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
    if (embedderWorker === runtime) {
      clearEmbedderWorkerIdleTimer()
      embedderWorker = undefined
    }

    try {
      operations.removeEmbedderWorkerRegistration(input.agentQaRoot)
    } catch (error) {
      logger.error(
        `Embedder worker registration cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    try {
      operations.resetEmbedderCapability()
    } catch (error) {
      logger.error(
        `Embedder capability reset failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }

    try {
      operations.appendDaemonEvent(input.agentQaRoot, {
        kind: 'embedder-worker-exit',
        sessionId: runtime.sessionId,
        pid: runtime.child.pid,
        code,
        signal,
        reason: runtime.stopReason ?? 'crash',
        stdout: runtime.stdout.read(),
        stderr: runtime.stderr.read(),
        outputTruncated: runtime.stdout.wasTruncated() || runtime.stderr.wasTruncated(),
      })
    } catch (error) {
      logger.error(
        `Embedder worker exit event failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    } finally {
      runtime.resolveExit()
    }
  }

  const ensureEmbedderWorker = async (sessionId: string): Promise<EmbedderWorkerRuntime> => {
    while (embedderWorker?.stopReason !== undefined) await embedderWorker.exit
    if (embedderWorker !== undefined) {
      clearEmbedderWorkerIdleTimer()
      return embedderWorker
    }

    const projectRoot = dirname(input.agentQaRoot)
    const entryPath = operations.resolveEmbedderWorkerEntryPath()
    const spawnOptions: EmbedderWorkerSpawnOptions = {
      command: process.execPath,
      args: [
        entryPath,
        projectRoot,
        JSON.stringify(DEFAULT_EMBEDDING_PROFILE),
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
      child,
      sessionId,
      stdout: captureWorkerOutput(child.stdout),
      stderr: captureWorkerOutput(child.stderr),
      exit,
      resolveExit,
    }
    embedderWorker = runtime
    child.once('error', (error) => {
      logger.error(`Embedder worker spawn error: ${error.message}`)
    })
    child.once('close', (code, signal) => finishEmbedderWorkerExit(runtime, code, signal))

    try {
      operations.appendDaemonEvent(input.agentQaRoot, {
        kind: 'embedder-worker-start',
        sessionId,
        pid: child.pid,
        modelId: DEFAULT_EMBEDDING_PROFILE.model_id,
      })
      await Promise.race([
        operations.waitForEmbedderWorkerReady(input.agentQaRoot, child.pid),
        runtime.exit.then(() => {
          throw new Error('Embedder worker exited before publishing its registration')
        }),
      ])
    } catch (error) {
      runtime.stopReason ??= 'start-error'
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
      await runtime.exit
      throw error
    }
    return runtime
  }

  const stopEmbedderWorker = async (
    reason: Exclude<EmbedderWorkerExitReason, 'crash' | 'start-error'>,
  ): Promise<void> => {
    const runtime = embedderWorker
    if (runtime === undefined) return
    clearEmbedderWorkerIdleTimer()
    if (runtime.child.exitCode !== null || runtime.child.signalCode !== null) {
      await runtime.exit
      return
    }
    runtime.stopReason ??= reason
    runtime.child.kill('SIGTERM')
    await runtime.exit
  }

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

  const drainSession = async (): Promise<void> => {
    const initialCandidates = operations.listQueuedCandidates(input.knowledgeRoot)
    if (initialCandidates.length === 0) return
    if (input.author === undefined || input.policy === undefined) {
      throw new Error('Daemon curation requires an author factory and guardrail policy')
    }

    const sessionId = operations.randomUUID()
    const seenCandidateIds = new Set(initialCandidates)
    let jobsProcessed = 0
    let remainingAfter = initialCandidates.length
    operations.appendDaemonEvent(input.agentQaRoot, {
      kind: 'drain-session-start',
      sessionId,
      holderPid: process.pid,
      epoch: acquired.epoch,
    })

    const author = await (authorPromise ??= Promise.resolve(input.author()))
    while (remainingAfter > 0) {
      for (const candidateId of operations.listQueuedCandidates(input.knowledgeRoot)) {
        seenCandidateIds.add(candidateId)
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
      let report: Awaited<ReturnType<DaemonHostOperations['drainQueue']>>
      try {
        report = await operations.drainQueue({
          knowledgeRoot: input.knowledgeRoot,
          auditBaseDir: input.agentQaRoot,
          budgetMs: 'unbounded',
          lease: { leaseId: acquired.leaseId, epoch: acquired.epoch },
          author,
          executionContext: 'local-headless',
          policy: input.policy,
          maintenance: 'skip',
        })
      } finally {
        if (worker !== undefined) armEmbedderWorkerIdleTimer(worker)
      }
      jobsProcessed += report.jobsProcessed
      remainingAfter = report.remaining
      if (report.remaining > 0 && report.jobsProcessed === 0) break
    }

    const candidateIds = [...seenCandidateIds].sort()
    if (jobsProcessed > 0) {
      operations.appendDrainSessionReceipt(input.agentQaRoot, {
        ts: new Date(operations.now()).toISOString(),
        sessionId,
        holderPid: process.pid,
        epoch: acquired.epoch,
        candidateIds,
        remainingAfter,
      })
    }
    operations.appendDaemonEvent(input.agentQaRoot, {
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
      await drainSession()
    }
  }

  const requestDrain = (): void => {
    if (shutdownPromise !== undefined) return
    drainRequested = true
    if (drainWorker !== undefined) return
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
  }

  const detachSignals = (): void => {
    if (controller === undefined) return
    operations.offSignal('SIGINT', controller.handleSignal)
    operations.offSignal('SIGTERM', controller.handleSignal)
    controller.dispose()
  }

  const beginShutdown = (
    requestedCode: number,
    releaseAuthority: boolean,
    reason: 'signal' | 'lease-lost' | 'startup-error',
  ): Promise<void> => {
    if (shutdownPromise !== undefined) return shutdownPromise
    shutdownPromise = (async () => {
      operations.trace?.('shutdown-started')
      if (heartbeatTimer !== undefined) {
        operations.clearInterval(heartbeatTimer)
        heartbeatTimer = undefined
      }
      if (curationPollTimer !== undefined) {
        operations.clearInterval(curationPollTimer)
        curationPollTimer = undefined
      }
      if (maintenanceTimer !== undefined) {
        operations.clearInterval(maintenanceTimer)
        maintenanceTimer = undefined
      }
      if (graceTimer !== undefined) {
        operations.clearTimeout(graceTimer)
        graceTimer = undefined
      }

      if (invokeServer !== undefined) {
        await invokeServer.close()
        invokeServer = undefined
      }

      await drainWorker
      await maintenanceWorker
      clearEmbedderWorkerIdleTimer()
      await stopEmbedderWorker('daemon-stop')

      localAgent?.close()
      localAgent = undefined
      recovery?.close()
      recovery = undefined

      let exitCode = requestedCode
      if (releaseAuthority) {
        const released = operations.releaseLease(authority)
        if (released.kind === 'released') {
          operations.trace?.('lease-released')
        } else {
          exitCode = 1
          operations.appendDaemonEvent(input.agentQaRoot, {
            kind: 'lease-lost',
            reason: released.reason,
            observedEpoch: released.holder?.epoch,
          })
        }
      }

      if (registrationWritten) {
        operations.removeDaemonRegistration(input.agentQaRoot)
        registrationWritten = false
        operations.trace?.('registration-removed')
      }
      operations.appendDaemonEvent(input.agentQaRoot, {
        kind: 'daemon-stopped',
        exitCode,
        reason,
      })
      detachSignals()
      shutdownCompleted = true
      resolveCompletion?.(exitCode)
    })()
    return shutdownPromise
  }

  try {
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
    await recovery.resumePending(fence)
    operations.trace?.('pending-resumed')
    recovery.close()
    recovery = undefined

    localAgent = operations.composeLocalAgent({
      agentQaRoot: input.agentQaRoot,
      config: input.config,
      knowledgeRoot: () => input.knowledgeRoot,
      model: () => model,
      ...(input.runExecution === undefined ? {} : { runExecution: input.runExecution }),
      clock: SYSTEM_CLOCK,
      idSource: DIGEST_JOB_ID_SOURCE,
    })
    operations.trace?.('local-agent-composed')
    await localAgent.jobs()
    operations.trace?.('jobs-opened')

    controller = createShutdownController({
      cancel: () => {
        void beginShutdown(0, true, 'signal')
      },
      exit: (code) => operations.hardExit(code),
      // A daemon's first signal is a successful operator stop, not a cancelled test verdict.
      setExitCode: () => undefined,
      armGrace: () => {
        if (shutdownCompleted) return
        graceTimer ??= operations.setTimeout(
          () => operations.hardExit(130),
          DAEMON_SHUTDOWN_GRACE_MS,
        )
        graceTimer.unref?.()
      },
    })
    operations.onSignal('SIGINT', controller.handleSignal)
    operations.onSignal('SIGTERM', controller.handleSignal)

    // Registration advertises a signalable daemon, so publish it only after handlers are live.
    const socketPath = input.socketPath ?? daemonSocketPath(
      input.agentQaRoot,
      dirname(input.agentQaRoot),
    )
    operations.writeDaemonRegistration(input.agentQaRoot, {
      schemaVersion: DAEMON_REGISTRATION_SCHEMA_VERSION,
      pid: process.pid,
      socketPath,
      startedAtMs: operations.now(),
    })
    registrationWritten = true
    operations.trace?.('registration-written')

    const startedServer = await operations.startInvokeServer({
      socketPath,
      registry: localAgent.registry,
      onNudge: requestDrain,
    })
    if (shutdownPromise !== undefined) {
      await startedServer.close()
      await shutdownPromise
      return completion
    }
    invokeServer = startedServer

    curationPollTimer = operations.setInterval(requestDrain, CURATION_QUEUE_POLL_MS)
    maintenanceTimer = operations.setInterval(() => {
      if (shutdownPromise !== undefined || maintenanceWorker !== undefined) return
      maintenanceWorker = operations.runMaintenanceTail({
        knowledgeRoot: input.knowledgeRoot,
        lease: { leaseId: acquired.leaseId, epoch: acquired.epoch },
      })
        .then(() => undefined)
        .catch((error) => {
          operations.appendDaemonEvent(input.agentQaRoot, {
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

    heartbeatTimer = operations.setInterval(() => {
      if (shutdownPromise !== undefined) return
      try {
        const heartbeat = operations.heartbeatLease(authority)
        if (heartbeat.kind === 'heartbeated') {
          operations.appendDaemonEvent(input.agentQaRoot, {
            kind: 'lease-heartbeated',
            pid: heartbeat.holder.pid,
            epoch: heartbeat.holder.epoch,
            heartbeatAtMs: heartbeat.holder.heartbeatAtMs,
          })
          return
        }

        operations.appendDaemonEvent(input.agentQaRoot, {
          kind: 'lease-lost',
          reason: heartbeat.reason,
          observedEpoch: heartbeat.observedEpoch ?? heartbeat.holder?.epoch,
        })
        void beginShutdown(1, false, 'lease-lost')
      } catch (error) {
        operations.appendDaemonEvent(input.agentQaRoot, {
          kind: 'lease-lost',
          reason: 'heartbeat-error',
          detail: error instanceof Error ? error.message : String(error),
        })
        void beginShutdown(1, false, 'lease-lost')
      }
    }, LEASE_HEARTBEAT_INTERVAL_MS)
    operations.trace?.('heartbeat-started')
    logger.info(`agent-qa daemon started (pid ${process.pid}, epoch ${acquired.epoch})`)

    return completion
  } catch (error) {
    await beginShutdown(1, true, 'startup-error')
    throw error
  }
}
