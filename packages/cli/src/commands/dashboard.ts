import { Command } from 'commander'
import { resolve, dirname } from 'node:path'
import { createRequire } from 'node:module'
import pc from 'picocolors'
import {
  AGENT_ASK_FUNCTION_ID,
  foldFunctionResult,
  invokeFunction,
  type ConfigReaderPort,
  type FunctionRegistry,
} from '@vostride/agent-qa-agent'
import type { LocalAgentHost } from '@vostride/agent-qa-agent-local'
import { resolveWorkspacePaths } from '@vostride/agent-qa-core'
import type {
  AgentDeclarationRow,
  AgentHost,
  AgentRegistryHandle,
  AgentResultFold,
} from '@vostride/agent-qa-dashboard'
import { resolveVisionConfig } from '@vostride/agent-qa-model'
import type {
  AgentAskInput,
  ChatSessionEvent,
  ExecutionContext,
  FunctionCaller,
  MaskedConfigEntry,
} from '@vostride/agent-qa-schema'
import { resolveConfig } from '../config.js'
import {
  CLI_FUNCTION_CALLER,
  composeCliLocalAgent,
  createMaskedConfigReader,
} from '../composition/local-agent-host.js'
import {
  applyResolvedAuthToModelConfig,
  resolveCliChatCapabilities,
  resolveModelAuth,
  type CliChatCapabilities,
  type LLMConfigLike,
} from '../llm-utils.js'
import { DEFAULT_ANTHROPIC_MODEL } from '../model-defaults.js'

/** The dot-path 387 D-10's card `url` is read from, spelled here exactly as the producer reads it. */
export const DASHBOARD_BASE_URL_CONFIG_KEY = 'services.dashboard.baseUrl'

/**
 * The caller the dashboard door dispatches as (400-01, D-08 / Pitfall 9).
 *
 * DERIVED FROM THE CLI CHAT DOOR'S OWN MINT, with the surface name — attribution only, never a
 * permission input — as the single difference. A hand-typed scope list here is the drift vector
 * D-08 names by name: the parity suite's whole claim about the two interactive doors is that the
 * same utterance refuses, or does not, identically on both, and two lists that agree today are how
 * that stops being true. The spread makes the agreement structural: a seventh scope minted by a
 * later phase reaches this door the day it reaches the CLI's, without anyone remembering to come
 * here. `origin` rides along unchanged and deliberately — a person typed into a browser this
 * machine's own process is serving, which is the same fact `agent-qa chat` mints `human` for.
 */
export const DASHBOARD_FUNCTION_CALLER: FunctionCaller = Object.freeze({
  ...CLI_FUNCTION_CALLER,
  surface: 'dashboard',
})

/**
 * One notification in, however many watchers out (400-01, D-03).
 *
 * IT IS A FAN-OUT AND NOT A BUS, and the distinction is the whole of D-03. A bus is something a
 * producer publishes to; this is handed a record the session log has ALREADY written and copies it
 * to whoever is listening. It holds no history, decides no ordering and can answer no question —
 * the buffering, the ids and the replay all live in the server that serves them, where their
 * bounds belong.
 *
 * A LISTENER'S THROW IS SWALLOWED so one broken watcher cannot silence the others, on the same
 * reasoning the composition's own notify site swallows: this channel is downstream of the durable
 * log, and nothing on it may reach back and affect a turn.
 */
export interface SessionEventFanOut {
  emit(sessionId: string, event: ChatSessionEvent): void
  subscribe(listener: (sessionId: string, event: ChatSessionEvent) => void): () => void
}

export function createSessionEventFanOut(): SessionEventFanOut {
  const listeners = new Set<(sessionId: string, event: ChatSessionEvent) => void>()
  return {
    emit(sessionId, event) {
      for (const listener of [...listeners]) {
        try {
          listener(sessionId, event)
        } catch { /* one watcher's failure is not another's, and never the turn's */ }
      }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}

/**
 * The composed host, as the dashboard's chat routes consume it (400-01, D-01).
 *
 * THE WHOLE OF THE COMPOSER, and it decides nothing. Every member is either a handle from the host
 * this function was handed or a function the `agent` package exports, bound. There is no listing
 * assembled here, no op id spelled here and no scope decided here — a composer that computed any
 * of those would be a second answer to a question the composition root has already answered, which
 * is the shape `chat/host.ts`'s header refuses at length.
 *
 * PUBLISHED rather than private because the conformance suite composes the door the same way the
 * command does. An adapter that assembled its own seam would be enumerating a door this product
 * does not ship (397 D-01's produced-enumeration law, applied to the composition itself).
 */
export function composeDashboardAgentHost(
  host: LocalAgentHost,
  sessionEvents: SessionEventFanOut,
): AgentHost {
  return {
    registry: host.registry,
    onSessionEvent: (listener) => sessionEvents.subscribe(listener),
    caller: DASHBOARD_FUNCTION_CALLER,
    agentAskFunctionId: AGENT_ASK_FUNCTION_ID,
    invokeFunction: (
      registry: AgentRegistryHandle,
      functionId: string,
      input: AgentAskInput,
      caller: FunctionCaller,
    ): Promise<unknown> =>
      invokeFunction(registry as FunctionRegistry, functionId, input, caller),
    foldFunctionResult: (
      registry: AgentRegistryHandle,
      functionId: string,
      payload: unknown,
    ): AgentResultFold =>
      foldFunctionResult(registry as FunctionRegistry, functionId, payload),
    listDeclarations: (
      registry: AgentRegistryHandle,
      caller: FunctionCaller,
    ): readonly AgentDeclarationRow[] => (registry as FunctionRegistry).list(caller),
  }
}

/**
 * The masked config reader, with the bound origin standing in for an UNSET dashboard base URL
 * (400-01, D-16 / 387 D-10).
 *
 * ONE MECHANISM, TWO SUPPLIERS. 387 D-10 made the entity card's `url` config-derived and absent by
 * default, read through the masker at `services.dashboard.baseUrl`; that knob stays THE mechanism
 * and is how a CLI or MCP host is pointed at somebody's dashboard. What this adds is the second
 * supplier: a dashboard serving its own in-process conversation knows its own origin, so the cards
 * in that conversation carry working links with no user setup at all.
 *
 * THE OPERATOR'S VALUE WINS, and the precedence is deliberate rather than incidental. A configured
 * base is somebody pointing at something — a reverse proxy, a tunnel, a path prefix — and
 * overwriting it with `http://localhost:<port>` would silently redirect every link away from the
 * address they chose. So the overlay fills an ABSENCE and never replaces a presence.
 *
 * `masked: false` because this value is not the operator's secret and was not reduced by the
 * masker: it is a loopback origin this process minted from the port it bound. The producer reads
 * that flag to decide whether a base is verbatim (`card-context.ts`), so a `true` here would make
 * the overlay contribute nothing — which is the failure mode this comment exists to prevent
 * somebody re-introducing.
 *
 * `source: 'default'` on the same reasoning: no config file, environment variable or flag carries
 * this value. It is what this host supplies when nothing else did.
 *
 * The origin is a FACTORY, not a string, because the server has not bound a port when the host is
 * composed — and an ephemeral port (`port: 0`) is a real posture, in this suite and in tests. A
 * value captured at composition time would be a guess; a factory read per invocation is the truth.
 */
export function overlayDashboardBaseUrl(
  inner: ConfigReaderPort,
  boundOrigin: () => string | undefined,
): ConfigReaderPort {
  return {
    async getMasked() {
      const masked = await inner.getMasked()
      const origin = boundOrigin()
      if (origin === undefined) return masked
      const existing = masked.entries.find(
        (entry) => entry.key === DASHBOARD_BASE_URL_CONFIG_KEY,
      )
      if (existing !== undefined && !existing.masked && existing.value.trim() !== '') {
        return masked
      }
      const overlaid: MaskedConfigEntry = {
        key: DASHBOARD_BASE_URL_CONFIG_KEY,
        value: origin,
        source: 'default',
        masked: false,
      }
      return {
        ...masked,
        entries: [
          ...masked.entries.filter((entry) => entry.key !== DASHBOARD_BASE_URL_CONFIG_KEY),
          overlaid,
        ],
      }
    },
  }
}

/** Everything the door's composition needs that only its host knows. */
export interface DashboardDoorInput {
  /** The project's runtime root, i.e. `<configDir>/.agent-qa`. */
  readonly agentQaRoot: string
  /** The configuration file this door resolves against. */
  readonly configPath: string
  /**
   * The origin this server bound, read per configuration lookup (D-16).
   *
   * A FACTORY because the server has not bound a port when the door is composed, and an ephemeral
   * port is a real posture. Answering `undefined` leaves the operator's config knob — or its
   * absence, and therefore a `url`-absent card — exactly as it was.
   */
  readonly boundOrigin: () => string | undefined
  /**
   * The context every policy decision on this door is taken in (D-05).
   *
   * REQUIRED rather than defaulted, because the whole point of the seam is that a door STATES its
   * posture rather than inheriting the process's. A door composed without one would be answering
   * from TTY and CI markers, which is the ambient reach `resolveExecutionContext` exists to remove.
   */
  readonly resolveExecutionContext: () => ExecutionContext
  /**
   * What this door plans with, ALREADY RESOLVED (CHAT-06 / Pitfall 12).
   *
   * Absent composes the shipped HEADLESS posture: every deterministic utterance still routes and
   * a natural-language one fails the turn closed by name. That is a real posture — a project with
   * no usable LLM configuration gets a deterministic door rather than no door — and it is also
   * what the conformance suite composes, deliberately, so no cell can reach a provider.
   */
  readonly chatModel?: CliChatCapabilities
}

/** The composed door: the local host it owns, and the seam the routes consume. */
export interface DashboardDoor {
  readonly host: LocalAgentHost
  readonly agentHost: AgentHost
}

/**
 * Compose the fourth door — ONE composer, for production and for the suite that measures it.
 *
 * PUBLISHED AND SINGULAR, and both halves matter. The conformance adapter enumerates this door and
 * the dispatch driver drives it; if either assembled its own host beside this one, the suite would
 * be measuring a door this product does not ship — the lookalike-assembly failure `spawned-chat.ts`
 * names and `surface-dispatch.ts` refuses by source assertion. So the command below calls this, and
 * so does the suite, and there is no third assembly to disagree with either.
 *
 * IT DECIDES NOTHING ITS CALLER HAS NOT SAID. Model, execution context and bound origin all arrive
 * as inputs; what this function contributes is the wiring — the CLI port set, the base-URL overlay
 * and the injected-host seam — which is the part that must not be written twice.
 */
export function composeDashboardDoor(input: DashboardDoorInput): DashboardDoor {
  const sessionEvents = createSessionEventFanOut()
  const host = composeCliLocalAgent({
    agentQaRoot: input.agentQaRoot,
    configPath: input.configPath,
    config: overlayDashboardBaseUrl(
      createMaskedConfigReader(input.configPath),
      input.boundOrigin,
    ),
    resolveExecutionContext: input.resolveExecutionContext,
    // D-04 (400-03): ONE substrate, tagged. A dashboard conversation rides the exact
    // `.agent-qa/sessions/chat-*.jsonl` log `agent-qa chat` writes — resume, compaction and the
    // cleartext-masking adjudication apply once, to one population — and what distinguishes it is
    // this word on the session HEADER. Never on an event: the grammar's exact-key guard would make
    // every pre-400 file unreadable (Pitfall 4).
    //
    // THE SAME WORD `DASHBOARD_FUNCTION_CALLER.surface` CARRIES, deliberately: the door that
    // dispatched a turn and the door that opened its session are the same fact, and two spellings
    // of it would be free to disagree.
    sessionSurface: DASHBOARD_FUNCTION_CALLER.surface,
    // D-03: the door's half of the projection. The composition notifies this once per APPENDED
    // event; the fan-out is what turns one notification into however many browsers are watching.
    observeSessionEvent: (sessionId, event) => { sessionEvents.emit(sessionId, event) },
    ...(input.chatModel === undefined
      ? {}
      : {
        chatModel: input.chatModel.model,
        chatModelFor: input.chatModel.modelFor,
        chatAccounting: input.chatModel.accounting,
      }),
  })
  return { host, agentHost: composeDashboardAgentHost(host, sessionEvents) }
}

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

    // ---- The fourth door's host (400-01, D-01/D-05/D-08/D-16) ---------------------------------
    //
    // COMPOSED HERE AND HANDED OVER. The host lives in this process, which is the process
    // dashboard-server runs in — D-01's requirement, met without dashboard-server acquiring the
    // agent packages or re-assembling the port set this command already has. It is the SAME
    // `composeCliLocalAgent` `agent-qa chat` composes, so the two interactive doors answer "what
    // can a conversation do" once.
    //
    // THE MODEL IS BOUND EXACTLY AS `agent-qa chat` BINDS IT. A host composed without it is
    // HEADLESS by design: every deterministic utterance still routes and every natural-language one
    // fails the turn closed by name. That posture passes every model-free conformance cell and
    // refuses every real sentence a person types into the browser, which is precisely the shape of
    // a green that never ran — so the resolution is paid here, once, when the server opens.
    // `undefined` stays a real posture: a project with no usable LLM configuration gets a
    // deterministic door rather than no door.
    const chatModel = await resolveCliChatCapabilities(configFilePath)

    // The bound origin, written once the server has a port and read per configuration lookup. See
    // `overlayDashboardBaseUrl` for why this is a mutable box rather than a value.
    let boundOrigin: string | undefined

    const { agentHost } = composeDashboardDoor({
      agentQaRoot: resolve(configDir, '.agent-qa'),
      configPath: configFilePath,
      boundOrigin: () => boundOrigin,
      ...(chatModel === undefined ? {} : { chatModel }),
      // D-05, answered per RESEARCH Pattern 2: reuse `local-interactive` through the spec's own
      // explicit-override rung rather than minting a fifth vocabulary member, and supply it
      // INJECTED rather than through `setActiveExecutionContextResolver` — that setter is a process
      // global and would re-answer the question for every composition in this process (Pitfall 5).
      //
      // THIS IS THE TYPED HOOK PLAN 400-03 NARROWS, not a placeholder. The predicate it will read
      // is "is a confirm channel live for this turn" — a browser with an open stream is a person
      // demonstrably present, and a browser that closed one is not. Today the server has no confirm
      // channel at all, so there is no liveness to consult and the honest constant answer is the
      // posture D-05 ratified for this door; the shape is already the one that predicate slots
      // into, so 400-03 changes a body and not a seam.
      resolveExecutionContext: (): ExecutionContext => 'local-interactive',
    })

    const { close, port: listeningPort } = await startServer({
      db,
      port,
      uiDir,
      artifactsDir: resolve(configDir, artifactsDir),
      workspacePaths,
      configPath: configFilePath,
      llmConfig: dashboardLLMConfig,
      authFetch,
      agentHost,
    })

    // D-16: the second supplier, now that there is a port to name. Loopback rather than a hostname,
    // matching where this server binds.
    boundOrigin = `http://localhost:${String(listeningPort)}`

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
