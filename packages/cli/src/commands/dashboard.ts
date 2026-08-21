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
import type { ComposeLocalAgentInput, LocalAgentHost } from '@vostride/agent-qa-agent-local'
import { resolveWorkspacePaths } from '@vostride/agent-qa-core'
import type {
  AgentDeclarationRow,
  AgentHost,
  AgentRegistryHandle,
  AgentResultFold,
  ConfirmRegistry,
} from '@vostride/agent-qa-dashboard'
import { resolveVisionConfig } from '@vostride/agent-qa-model'
import type {
  AgentAskInput,
  ChatSessionEvent,
  ExecutionContext,
  FunctionCaller,
  MaskedConfigEntry,
  RiskActionDescriptor,
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
  confirms?: ConfirmRegistry,
): AgentHost {
  return {
    registry: host.registry,
    onSessionEvent: (listener) => sessionEvents.subscribe(listener),
    // 400-03: the SAME registry the composition parks questions in, handed to the routes that
    // serve them. Conditionally spread so a door composed without a confirm channel carries no
    // field at all — the translated no-TTY posture, in one place.
    ...(confirms === undefined ? {} : { confirms }),
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

/**
 * Is a person reachable RIGHT NOW? (400-03, D-05 · RESEARCH Pattern 2.)
 *
 * THE PREDICATE PLAN 400-01 LEFT A SEAM FOR, filled. That plan bound
 * `resolveExecutionContext: () => 'local-interactive'` — honest then, because the server had no
 * confirm channel at all and there was no liveness to consult. There is one now, and this is what
 * consulting it looks like: `local-interactive` while a browser holds an open stream this door can
 * ask a question down, `local-headless` the moment the last one goes away.
 *
 * THE HONESTY IS THE POINT, NOT THE CAPABILITY. D-05 ruled that the browser confirm makes this door
 * interactive; the vocabulary's ONE consequence is `requiresFailClosed`, so a door that claimed
 * `local-interactive` with nobody watching would be telling the gate to consult a confirm port that
 * can only deny — spending an ask-tier call on a question nobody sees. Dropping to `local-headless`
 * denies it in the gate, by name, with `fail-closed-denied` on the audit row rather than a
 * `prompted-denied` that names a prompt nobody was shown.
 *
 * STRUCTURALLY TYPED over the one method it reads, so this module keeps its type-only relationship
 * with `@vostride/agent-qa-dashboard` — the CLI loads that package lazily, and a value import here
 * would put the whole dashboard server on the startup path of every `agent-qa` invocation.
 */
export function dashboardExecutionContext(
  confirms: { hasLiveChannel(): boolean } | undefined,
): () => ExecutionContext {
  return () => (confirms?.hasLiveChannel() === true ? 'local-interactive' : 'local-headless')
}

/**
 * The dashboard's `chatConfirm` factory — 391's approval machinery, rendered in a browser.
 *
 * A RENDER AND NEVER NEW APPROVAL MACHINERY (D-07). Everything that decides anything is supplied:
 * `recordStandingApproval` is a closure over the composition's own `StandingGrantsPort` — the same
 * instance `proposals.accept --always` mints through, with its protected-class refusal, its
 * already-granted fold, its writer lease and its committed ledger — and `onDecision` is what writes
 * the `approval_decision` session event. This function contributes the three answers a person can
 * give and the socket they give them on.
 *
 * IT IS THE TTY WRAPPER'S LOGIC IN A DIFFERENT MEDIUM, deliberately parallel: the `a` arm mints
 * first and answers second (nothing has happened yet, so the standing half is settled while it can
 * still be reported), the log records the EFFECT rather than the request (392-05: `accept-always` is
 * written only where a standing approval actually exists), a mint failure is reported and the call
 * still proceeds, and anything that is not an explicit yes is a refusal.
 *
 * WHICH CONVERSATION IS ASKED is `resolveTargetSession`'s answer, and the fail-safe direction is
 * the composition's own (392-12, plan 13): a `ConfirmPort` is handed an action and no caller, so
 * where more than one watched conversation has a turn in flight this port cannot tell which one is
 * asking — and it denies rather than putting somebody else's question in front of a person. A
 * confirm shown in the wrong transcript IS the defect; a denial is not.
 */
export function createDashboardConfirmFactory(input: {
  readonly confirms: ConfirmRegistry
  readonly resolveTargetSession: () => string | undefined
}): NonNullable<ComposeLocalAgentInput['chatConfirm']> {
  return (bindings) => {
    /** The session-log append is a RECORD of the decision, never a veto over it. */
    const ledger = async (
      actionClass: string,
      decision: 'accept' | 'accept-always' | 'deny',
    ): Promise<void> => {
      try {
        await bindings.onDecision({ actionClass, decision })
      } catch {
        // Swallowed here and nowhere else, on the TTY wrapper's stated reasoning: letting a logging
        // failure out through a `ConfirmPort` would turn it into an exception where the gate
        // expects a boolean, and the person who just said yes would be told their action failed.
      }
    }

    const acceptAlways = async (
      action: RiskActionDescriptor,
      sessionId: string,
    ): Promise<void> => {
      let outcome: Awaited<ReturnType<typeof bindings.recordStandingApproval>> | undefined
      try {
        outcome = await bindings.recordStandingApproval(action.name)
      } catch (error) {
        input.confirms.present(
          sessionId,
          `agent-qa: the standing approval could not be recorded `
          + `(${error instanceof Error ? error.name : String(error)}); this call still proceeds.`,
        )
      }
      if (outcome?.kind === 'protected-class') {
        // D-05's mint half, reported rather than swallowed: a person who chose "always" and got a
        // plain accept must be told which half of their answer did not happen.
        input.confirms.present(
          sessionId,
          `agent-qa: ${outcome.actionClass} is a protected class and never takes a standing `
          + 'approval; this call is approved once.',
        )
      }
      const recorded = outcome?.kind === 'recorded' || outcome?.kind === 'already-granted'
      await ledger(action.name, recorded ? 'accept-always' : 'accept')
    }

    return async (action) => {
      const sessionId = input.resolveTargetSession()
      if (sessionId === undefined) {
        // NOBODY TO ASK. The same answer the TTY wrapper gives a process with no terminal, reached
        // one layer later because liveness here is a per-turn fact rather than a per-process one.
        await ledger(action.name, 'deny')
        return false
      }

      const answer = await input.confirms.request({
        sessionId,
        actionClass: action.name,
        // The action's OWN disclosure — what this invocation is about to cost, composed by the op
        // and carried as inert data. Absent on almost every action, exactly as at the terminal.
        ...(action.disclosure === undefined ? {} : { preview: action.disclosure }),
      })

      if (answer === 'accept-always') {
        await acceptAlways(action, sessionId)
        return true
      }
      await ledger(action.name, answer === 'accept' ? 'accept' : 'deny')
      return answer === 'accept'
    }
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
   * Where this door's ask-tier questions wait for a person (400-03, D-05 / D-06 / D-07).
   *
   * SUPPLIED RATHER THAN CREATED HERE, for one mechanical reason: the registry's implementation
   * lives in `@vostride/agent-qa-dashboard`, and this module's relationship with that package is
   * type-only on purpose — the CLI imports it lazily so `agent-qa --help` does not pay for a web
   * server. The command creates one through the same dynamic import it already takes; the
   * conformance suite creates none.
   *
   * ABSENT IS THE TRANSLATED NO-TTY POSTURE and is what the suite composes: no confirm port is
   * bound, so every ask-tier call meets the gate's own deny-by-default, unchanged.
   */
  readonly confirms?: ConfirmRegistry
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
  const confirms = input.confirms

  /**
   * The composed host, in a box the confirm factory closes over (400-03).
   *
   * A MUTABLE BOX BECAUSE THE ORDER IS FIXED AND CANNOT BE INVERTED: `composeCliLocalAgent` CALLS
   * the `chatConfirm` factory while it composes, so the factory exists before the host does — and
   * the question the factory has to answer ("which watched conversation has a turn in flight") is a
   * question about that host. The same shape, and the same reason, as `boundOrigin` above: a value
   * captured at composition time would be a guess, and this one would be `undefined` forever.
   */
  let composed: LocalAgentHost | undefined

  const resolveTargetSession = (): string | undefined => {
    if (confirms === undefined) return undefined
    // WATCHED **AND** IN FLIGHT. A live channel says a browser is there; an active turn id says
    // that conversation is the one waiting on an answer. Neither alone identifies the asker, and
    // the composition's own `onDecision` takes exactly this fail-safe (392-12): more than one
    // candidate, or none, and this port refuses rather than guessing a transcript.
    const candidates = confirms.liveSessionIds()
      .filter((sessionId) => composed?.chat.stateFor(sessionId)?.activeTurnId !== undefined)
    return candidates.length === 1 ? candidates[0] : undefined
  }

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
    // 400-05: the same word again, and again read off the caller rather than typed. A config
    // proposal minted in a browser is accepted from wherever the person happens to be — often the
    // CLI inbox, hours later — so this is the ONLY moment at which the door that proposed can be
    // recorded truthfully.
    mintingSurface: DASHBOARD_FUNCTION_CALLER.surface,
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
    // D-05/D-06/D-07 (400-03): the inline confirm and the mid-turn artifact seam beside it, both
    // conditionally spread on the composition's own idiom — a door with no confirm channel binds
    // NEITHER, which leaves the gate's deny-by-default and the engine's render-nothing posture
    // exactly as plan 400-01 shipped them.
    ...(confirms === undefined ? {} : {
      chatConfirm: createDashboardConfirmFactory({ confirms, resolveTargetSession }),
      // Pattern 5: cost previews and diffs land in the transcript BEFORE the confirm bubble, on
      // the same channel and routed to the same conversation. Dropped where no conversation can be
      // identified, for the reason the confirm is denied there.
      chatPresent: (text: string) => {
        const sessionId = resolveTargetSession()
        if (sessionId !== undefined) confirms.present(sessionId, text)
      },
    }),
  })
  composed = host
  return { host, agentHost: composeDashboardAgentHost(host, sessionEvents, confirms) }
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

    const {
      DashboardDatabase,
      createConfirmRegistry,
      resolveDashboardDbPath,
      startServer,
    } = await import('@vostride/agent-qa-dashboard')

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

    // ---- The confirm channel (400-03, D-05/D-06/D-07) -----------------------------------------
    //
    // ONE REGISTRY FOR THE WHOLE PROCESS, created here because both halves of an inline confirm
    // need the SAME one: the composition parks ask-tier questions in it, and the routes below push
    // those questions down a browser's stream and spend their ids on the answer route. Two
    // registries would park a question in the one the answer never reaches.
    const confirms = createConfirmRegistry()

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
      // 400-03 NARROWED THE BODY, and the seam is the one 400-01 shipped: the answer is now
      // `local-interactive` only while a browser holds a stream this door can ask a question down.
      // See `dashboardExecutionContext` for why claiming otherwise would be dishonest rather than
      // merely optimistic.
      resolveExecutionContext: dashboardExecutionContext(confirms),
      confirms,
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
