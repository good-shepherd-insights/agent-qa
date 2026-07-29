// `agent-qa daemon` is the standing host for the CURATION QUEUE and AGENT JOB QUEUE. It never
// serves the RUN QUEUE — v1 test executions remain owned by the dashboard server. D-21's three
// names stay explicit here so a user cannot mistake one queue's leaseholder for another's worker.

import { dirname, resolve } from 'node:path'

import {
  LOCAL_DAEMON_CAPABILITIES,
} from '@vostride/agent-qa-agent-local'
import type {
  ReadWriterLeaseOutcome,
  WriterLease,
} from '@vostride/agent-qa-agent-local'
import { Command } from 'commander'
import pc from 'picocolors'

import { createMaskedConfigReader } from '../composition/local-agent-host.js'
import { resolveConfig, resolveConfiguredKnowledgeRoot } from '../config.js'
import { runDaemonHost } from '../daemon/host.js'
import type { DaemonHostOptions } from '../daemon/host.js'
import {
  processIsAlive,
  readDaemonRegistration,
} from '../daemon/registration.js'
import type {
  DaemonRegistration,
  ReadDaemonRegistrationOutcome,
} from '../daemon/registration.js'
import { resolveCliJobModel } from '../llm-utils.js'

export interface DaemonProjectPaths {
  agentQaRoot: string
  knowledgeRoot: string
}

export interface DaemonCommandDeps {
  runHost(options: DaemonHostOptions): Promise<number>
  resolvePaths(configPath: string): Promise<DaemonProjectPaths>
  readRegistration(agentQaRoot: string): ReadDaemonRegistrationOutcome
  processIsAlive(pid: number): boolean
  readWriterLease(knowledgeRoot: string): ReadWriterLeaseOutcome
  countPendingCurationJobs(knowledgeRoot: string): number
  signalProcess(pid: number, signal: NodeJS.Signals): void
  now(): number
}

export type DaemonStatusDto =
  | { state: 'stopped' }
  | { state: 'malformed' }
  | { state: 'stale'; pid: number; startedAtMs: number }
  | {
      state: 'running'
      pid: number
      startedAtMs: number
      uptimeMs: number
      curationQueueDepth: number
      lease: WriterLease | null
    }

async function resolveDaemonPaths(configPath: string): Promise<DaemonProjectPaths> {
  const configDir = dirname(configPath)
  const config = await resolveConfig({ configPath, loadAuthPlugins: false })
  return {
    agentQaRoot: resolve(configDir, '.agent-qa'),
    knowledgeRoot: resolveConfiguredKnowledgeRoot(config, configDir),
  }
}

const DEFAULT_DEPS: DaemonCommandDeps = {
  runHost: runDaemonHost,
  resolvePaths: resolveDaemonPaths,
  readRegistration: readDaemonRegistration,
  processIsAlive,
  readWriterLease: LOCAL_DAEMON_CAPABILITIES.readWriterLease,
  countPendingCurationJobs: LOCAL_DAEMON_CAPABILITIES.countPendingCurationJobs,
  signalProcess: (pid, signal) => process.kill(pid, signal),
  now: () => Date.now(),
}

function configPathFor(command: Command): string {
  let root = command
  while (root.parent !== null) root = root.parent
  const globalOpts = root.opts<{ config?: string }>()
  return resolve(globalOpts.config ?? 'agent-qa.config.yaml')
}

function inspectRegistration(
  deps: DaemonCommandDeps,
  agentQaRoot: string,
):
  | { kind: 'absent' }
  | { kind: 'malformed' }
  | { kind: 'live'; registration: DaemonRegistration }
  | { kind: 'stale'; registration: DaemonRegistration } {
  const outcome = deps.readRegistration(agentQaRoot)
  if (outcome.kind !== 'parsed') return outcome
  return deps.processIsAlive(outcome.registration.pid)
    ? { kind: 'live', registration: outcome.registration }
    : { kind: 'stale', registration: outcome.registration }
}

function formatUptime(uptimeMs: number): string {
  const seconds = Math.floor(uptimeMs / 1_000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h`
}

function renderStatusHuman(status: DaemonStatusDto): void {
  if (status.state === 'stopped') {
    console.log('agent-qa daemon is not running')
    return
  }
  if (status.state === 'malformed') {
    console.error(pc.red('agent-qa daemon registration is malformed'))
    return
  }
  if (status.state === 'stale') {
    console.log(`agent-qa daemon has a stale registration (pid ${status.pid})`)
    return
  }
  console.log(
    `agent-qa daemon running: pid ${status.pid}, uptime ${formatUptime(status.uptimeMs)}, ` +
      `curation queue depth ${status.curationQueueDepth}`,
  )
}

export function createDaemonCommand(deps: DaemonCommandDeps = DEFAULT_DEPS): Command {
  const cmd = new Command('daemon')
    .description('Run and inspect the foreground daemon host')
    .addHelpText(
      'after',
      '\nagent-qa runs three separate queues; this command hosts the latter two only:\n' +
        '  run queue        test executions dispatched by the dashboard server (never served here)\n' +
        '  curation queue   knowledge curation work drained under this daemon writer lease\n' +
        '  agent job queue  durable background agent jobs served from .agent-qa/agent-jobs.db\n' +
        '\nSee docs/queues.md.\n',
    )
    .action(async (_opts: unknown, command: Command) => {
      try {
        const configPath = configPathFor(command)
        const configDir = dirname(configPath)
        const config = await resolveConfig({ configPath, loadAuthPlugins: false })
        const exitCode = await deps.runHost({
          agentQaRoot: resolve(configDir, '.agent-qa'),
          knowledgeRoot: resolveConfiguredKnowledgeRoot(config, configDir),
          config: createMaskedConfigReader(configPath),
          model: () => resolveCliJobModel(configPath),
        })
        process.exitCode = exitCode
      } catch (error) {
        console.error(pc.red(`Daemon error: ${error instanceof Error ? error.message : String(error)}`))
        process.exitCode = 1
      }
    })

  cmd
    .command('status')
    .description('Report daemon liveness and pending work depth')
    .option('--json', 'output the raw status object')
    .action(async (opts: { json?: boolean }, command: Command) => {
      try {
        const paths = await deps.resolvePaths(configPathFor(command))
        const inspected = inspectRegistration(deps, paths.agentQaRoot)
        let status: DaemonStatusDto
        if (inspected.kind === 'absent') {
          status = { state: 'stopped' }
        } else if (inspected.kind === 'malformed') {
          status = { state: 'malformed' }
          process.exitCode = 1
        } else if (inspected.kind === 'stale') {
          status = {
            state: 'stale',
            pid: inspected.registration.pid,
            startedAtMs: inspected.registration.startedAtMs,
          }
        } else {
          const lease = deps.readWriterLease(paths.knowledgeRoot)
          status = {
            state: 'running',
            pid: inspected.registration.pid,
            startedAtMs: inspected.registration.startedAtMs,
            uptimeMs: Math.max(0, deps.now() - inspected.registration.startedAtMs),
            curationQueueDepth: deps.countPendingCurationJobs(paths.knowledgeRoot),
            lease: lease.kind === 'parsed' ? lease.lease : null,
          }
        }

        if (opts.json) console.log(JSON.stringify(status))
        else renderStatusHuman(status)
      } catch (error) {
        console.error(
          pc.red(`Daemon status error: ${error instanceof Error ? error.message : String(error)}`),
        )
        process.exitCode = 1
      }
    })

  cmd
    .command('stop')
    .description('Gracefully stop the registered live daemon')
    .action(async (_opts: unknown, command: Command) => {
      try {
        const paths = await deps.resolvePaths(configPathFor(command))
        const inspected = inspectRegistration(deps, paths.agentQaRoot)
        if (inspected.kind !== 'live') {
          console.log('agent-qa daemon has nothing to stop')
          process.exitCode = 1
          return
        }
        deps.signalProcess(inspected.registration.pid, 'SIGTERM')
        console.log(`sent SIGTERM to agent-qa daemon pid ${inspected.registration.pid}`)
      } catch (error) {
        console.error(
          pc.red(`Daemon stop error: ${error instanceof Error ? error.message : String(error)}`),
        )
        process.exitCode = 1
      }
    })

  return cmd
}
