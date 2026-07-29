import type { ConfigReaderPort, JobModelCapability } from '@vostride/agent-qa-agent'
import {
  composeJobRecovery,
  composeLocalAgent,
  DIGEST_JOB_ID_SOURCE,
  SYSTEM_CLOCK,
} from '@vostride/agent-qa-agent-local'
import type {
  ComposeJobRecoveryInput,
  ComposeLocalAgentInput,
  JobRecoveryHost,
  LocalAgentHost,
  RunExecutionPort,
} from '@vostride/agent-qa-agent-local'
import {
  acquireWriterLease,
  heartbeatLease,
  releaseLease,
} from '@vostride/agent-qa-knowledge-local'
import type {
  AcquireWriterLeaseOutcome,
  HeartbeatLeaseOutcome,
  LeaseOperationOptions,
  ReleaseLeaseOutcome,
} from '@vostride/agent-qa-knowledge-local'
import { setActiveExecutionContextResolver } from '@vostride/agent-qa-safety'

import { createShutdownController } from '../commands/shutdown-controller.js'
import { appendDaemonEvent } from './events.js'
import type { DaemonEvent } from './events.js'
import {
  DAEMON_REGISTRATION_SCHEMA_VERSION,
  daemonRegistrationSocketPath,
  inspectDaemonRegistration,
  removeDaemonRegistration,
  writeDaemonRegistration,
} from './registration.js'
import type { DaemonRegistration } from './registration.js'

/** Provisional daemon heartbeat interval; retune from operational evidence without adding config. */
export const LEASE_HEARTBEAT_INTERVAL_MS = 10_000

/** Provisional graceful-stop backstop; retune from operational evidence without adding config. */
export const DAEMON_SHUTDOWN_GRACE_MS = 10_000

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
    acquireWriterLease,
    heartbeatLease,
    releaseLease,
    composeJobRecovery,
    composeLocalAgent,
    appendDaemonEvent,
    writeDaemonRegistration,
    removeDaemonRegistration,
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

/**
 * Run the foreground daemon until a signal or lease-heartbeat refusal closes it.
 *
 * Startup order is part of the safety contract: pin posture, acquire authority, recover under the
 * acquired epoch, compose the local agent once, register, then start the independent heartbeat.
 */
export async function runDaemonHost(input: DaemonHostOptions): Promise<number> {
  // D-09: this is deliberately the first effect and is never injectable or TTY-dependent.
  setActiveExecutionContextResolver(() => 'local-headless')

  const operations = { ...defaultOperations(), ...input.operations }
  const logger = input.logger ?? DEFAULT_LOGGER
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
  let graceTimer: ReturnType<typeof setTimeout> | undefined
  let resolveCompletion: ((code: number) => void) | undefined
  let shutdownPromise: Promise<void> | undefined
  let shutdownCompleted = false

  const completion = new Promise<number>((resolve) => {
    resolveCompletion = resolve
  })

  let controller: ReturnType<typeof createShutdownController> | undefined

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
      if (graceTimer !== undefined) {
        operations.clearTimeout(graceTimer)
        graceTimer = undefined
      }

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
    operations.writeDaemonRegistration(input.agentQaRoot, {
      schemaVersion: DAEMON_REGISTRATION_SCHEMA_VERSION,
      pid: process.pid,
      socketPath: input.socketPath ?? daemonRegistrationSocketPath(input.agentQaRoot),
      startedAtMs: operations.now(),
    })
    registrationWritten = true
    operations.trace?.('registration-written')

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
