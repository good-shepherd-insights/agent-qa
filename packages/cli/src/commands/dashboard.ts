import { Command } from 'commander'
import { resolve, dirname } from 'node:path'
import { createRequire } from 'node:module'
import pc from 'picocolors'
import { resolveWorkspacePaths } from '@vostride/agent-qa-core'
import { resolveVisionConfig } from '@vostride/agent-qa-model'
import { resolveConfig } from '../config.js'
import { applyResolvedAuthToModelConfig, resolveModelAuth, type LLMConfigLike } from '../llm-utils.js'
import { DEFAULT_ANTHROPIC_MODEL } from '../model-defaults.js'

type DashboardCommandOptions = {
  port?: string
  db?: string
  open?: boolean
}

type ServiceCommandLabels = {
  error: string
  shutdown: string
}

async function startDashboardBackedServices(
  opts: DashboardCommandOptions,
  command: Command,
  labels: ServiceCommandLabels,
): Promise<void> {
  try {
    const program = command.parent!
    const globalOpts = program.opts<{ config?: string; verbose?: boolean }>()

    const config = await resolveConfig({
      configPath: globalOpts.config,
    })

    const configFilePath = resolve(globalOpts.config ?? 'agent-qa.config.yaml')
    const configDir = dirname(configFilePath)
    const workspacePaths = resolveWorkspacePaths({
      config,
      configPath: configFilePath,
      requireExistingFiles: true,
    })

    const servicesConfig = (config as any).services?.dashboard ?? {}
    const port = opts.port ? parseInt(opts.port, 10) : (servicesConfig.port || 3470)
    const configuredDbPath = opts.db ?? servicesConfig.dbPath
    const artifactsDir = servicesConfig.artifactsDir ?? '.agent-qa/artifacts'

    const registryLlms = (config as any).registry?.llms ?? []
    const useLlm = (config as any).use?.llm
    const defaultCfg = registryLlms.find((c: any) => c.name === useLlm) ?? {}
    const configName = defaultCfg.name ?? useLlm ?? ''
    const llmConfig: LLMConfigLike = {
      provider: defaultCfg.provider ?? 'anthropic-subscription',
      model: defaultCfg.model ?? DEFAULT_ANTHROPIC_MODEL,
      baseURL: defaultCfg.baseURL,
      providerHeaders: defaultCfg.providerHeaders,
      vision: defaultCfg.vision,
    }
    const resolvedAuth = await resolveModelAuth(configName, llmConfig)
    let authFetch: typeof globalThis.fetch | undefined
    let resolvedLLMConfig: LLMConfigLike = llmConfig
    if (resolvedAuth.kind !== 'missing') {
      const runtimeConfig = applyResolvedAuthToModelConfig(llmConfig, resolvedAuth)
      const { fetch, ...modelConfig } = runtimeConfig
      authFetch = fetch
      resolvedLLMConfig = modelConfig
    }
    const { vision: _modelVision, ...serverLLMConfig } = resolvedLLMConfig
    void _modelVision
    const dashboardLLMConfig = {
      ...serverLLMConfig,
      vision: resolveVisionConfig((config as any).services?.vision),
    }

    const { DashboardDatabase, resolveDashboardDbPath, startServer } = await import('@vostride/agent-qa-dashboard')

    const db = new DashboardDatabase({
      dbPath: resolveDashboardDbPath({ configDir, configuredDbPath }),
    })

    let uiDir: string | undefined
    try {
      const require = createRequire(import.meta.url)
      const pkgPath = require.resolve('@vostride/agent-qa-dashboard-ui/package.json')
      uiDir = resolve(dirname(pkgPath), 'dist')
    } catch {
      if (globalOpts.verbose) {
        console.log(pc.yellow('Warning: @vostride/agent-qa-dashboard-ui not found — API-only mode'))
      }
    }

    const { close } = await startServer({
      db,
      port,
      uiDir,
      artifactsDir: resolve(configDir, artifactsDir),
      workspacePaths,
      configPath: configFilePath,
      llmConfig: dashboardLLMConfig,
      authFetch,
    })

    if (opts.open) {
      const { exec } = await import('node:child_process')
      const openCmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'
      exec(`${openCmd} http://localhost:${port}`)
    }

    let shuttingDown = false
    const shutdown = async () => {
      if (shuttingDown) return
      shuttingDown = true
      console.log(pc.dim(`\nShutting down ${labels.shutdown}...`))
      close()
      // 2026-08-17 (Phase 398 plan 10, D-18/D-20): THE DASHBOARD EMITS NO ANALYTICS, and the flush
      // that used to stand here is gone with the events it drained.
      //
      // The three v33 members — `dashboard.opened`, `dashboard.live_mode.started`,
      // `dashboard.entity.created` — are dropped rather than ported, because the dashboard is being
      // rebuilt: carrying the v1 answers forward would pre-decide what a rebuilt dashboard is worth
      // measuring. They are listed in the analytics package's `RETIRED_V33_EVENT_NAMES` so their
      // absence is a decision on the record rather than an omission, and a cell asserts that set is
      // disjoint from the live membership. M5 re-adds what it needs against the `AnalyticsPort`.
      //
      // Nothing replaces the flush either. This process captured nothing — the v1 call drained a
      // process-global service that other commands filled, which is exactly the ambient reach D-17
      // removed. A host that emits nothing has nothing to drain.
      process.exit(0)
    }

    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)
  } catch (err) {
    console.error(pc.red(`${labels.error} error: ${err instanceof Error ? err.message : String(err)}`))
    process.exit(2)
  }
}

export function createDashboardCommand(): Command {
  const cmd = new Command('dashboard')
    .description('Start the dashboard web server')
    .option('--port <number>', 'server port (default: 3470)')
    .option('--db <path>', 'database file path')
    .option('--open', 'open browser after start')
    .action(async (opts: DashboardCommandOptions, command: Command) => {
      await startDashboardBackedServices(opts, command, {
        error: 'Dashboard',
        shutdown: 'dashboard',
      })
    })

  return cmd
}

export function createServeCommand(): Command {
  const cmd = new Command('serve')
    .description('Start configured local agent-qa services')
    .action(async (_opts: unknown, command: Command) => {
      await startDashboardBackedServices({}, command, {
        error: 'Serve',
        shutdown: 'local services',
      })
    })

  return cmd
}
