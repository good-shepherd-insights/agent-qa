// `agent-qa daemon` is the standing host for the CURATION QUEUE and AGENT JOB QUEUE. It never
// serves the RUN QUEUE — v1 test executions remain owned by the dashboard server. D-21's three
// names stay explicit here so a user cannot mistake one queue's leaseholder for another's worker.

import { dirname, resolve } from 'node:path'

import { resolveKnowledgeRoot } from '@vostride/agent-qa-core'
import { Command } from 'commander'
import pc from 'picocolors'

import { createMaskedConfigReader } from '../composition/local-agent-host.js'
import { resolveConfig } from '../config.js'
import { resolveCliJobModel } from '../llm-utils.js'
import { runDaemonHost } from '../daemon/host.js'
import type { DaemonHostOptions } from '../daemon/host.js'

export interface DaemonCommandDeps {
  runHost(options: DaemonHostOptions): Promise<number>
}

const DEFAULT_DEPS: DaemonCommandDeps = { runHost: runDaemonHost }

export function createDaemonCommand(deps: DaemonCommandDeps = DEFAULT_DEPS): Command {
  const cmd = new Command('daemon')
    .description('Run the foreground curation queue and agent job queue host')
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
        const globalOpts = command.parent?.opts<{ config?: string }>() ?? {}
        const configPath = resolve(globalOpts.config ?? 'agent-qa.config.yaml')
        const configDir = dirname(configPath)
        const config = await resolveConfig({ configPath, loadAuthPlugins: false })
        const exitCode = await deps.runHost({
          agentQaRoot: resolve(configDir, '.agent-qa'),
          knowledgeRoot: resolveKnowledgeRoot(config.knowledge, configDir),
          config: createMaskedConfigReader(configPath),
          model: () => resolveCliJobModel(configPath),
        })
        process.exitCode = exitCode
      } catch (error) {
        console.error(pc.red(`Daemon error: ${error instanceof Error ? error.message : String(error)}`))
        process.exitCode = 1
      }
    })

  return cmd
}
