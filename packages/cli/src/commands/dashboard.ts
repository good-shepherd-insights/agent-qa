import { Command } from 'commander'
import { AsyncLocalStorage } from 'node:async_hooks'
import { basename, resolve, dirname } from 'node:path'
import { createRequire } from 'node:module'
import pc from 'picocolors'
import {
  AGENT_ASK_FUNCTION_ID,
  createMaskingContext,
  foldFunctionResult,
  invokeFunction,
  LiveViewUnavailableError,
  RUNS_EVENTS_FUNCTION_ID,
  RUNS_POST_PROCESSING_FUNCTION_ID,
  RUNS_START_FUNCTION_ID,
  unmaskForHumanOutput,
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
  MintLiveUrlInput,
  RunServicePorts,
  RunServiceStartInput,
} from '@vostride/agent-qa-dashboard'
import { resolveVisionConfig } from '@vostride/agent-qa-model'
import type {
  ChatSessionEvent,
  ExecutionContext,
  FunctionCaller,
  FunctionScope,
  MaskedConfigEntry,
  MaskedResolvedConfig,
  RiskActionDescriptor,
  RunEventEnvelope,
  RunServiceReadiness,
  RunServiceTokenEntry,
  RunSession,
  RunStartAcknowledgement,
  RunsLiveUrlResult,
  RunsStartInput,
  TrustScope,
} from '@vostride/agent-qa-schema'
import {
  RUN_SERVICE_CONTRACT_VERSION,
  RunStartAcknowledgementSchema,
} from '@vostride/agent-qa-schema'
import { createRunServiceSessionRegistry } from '../composition/run-service-session-registry.js'
import type { RunServiceSessionRegistry } from '../composition/run-service-session-registry.js'
import { composeLiveView, mintLiveUrlThrough } from '../composition/live-view-composition.js'
import {
  matchServiceBearer,
  resolveRunServiceTokens,
  runServiceTokenSecretStore,
  type ResolvedRunServiceToken,
} from '../composition/run-service-token-resolution.js'
import { loadCapabilityCatalog } from '../capability-catalog/loader.js'
import { resolveConfig } from '../config.js'
import {
  CLI_FUNCTION_CALLER,
  composeCliLocalAgent,
  createMaskedConfigReader,
} from '../composition/local-agent-host.js'
import type { ComposeCliLocalAgentInput } from '../composition/local-agent-host.js'
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
 * The OTHER dot-path the same producer reads (400-10, gap 1 / WINDOWS #195).
 *
 * `readDashboardUrlBase` is an AND over two keys, not one: a base with no workspace cannot render
 * the pinned `/t/:workspace/:kind/:shortId/:slug` route, so either half alone yields no url base at
 * all. 400-01 supplied `baseUrl` and nothing in this build produced a workspace, which made the
 * whole overlay INERT — every card the dashboard's own conversation rendered came back url-absent
 * while the overlay's own entry looked perfectly correct. Both halves or neither.
 */
export const DASHBOARD_WORKSPACE_CONFIG_KEY = 'services.dashboard.workspace'

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
/**
 * The asking conversation an invocation belongs to, read STRUCTURALLY off an `unknown` input.
 *
 * The seam's `input` widened in 404-05 because the door now dispatches three ops, not one — and
 * only `agent.ask` has a `sessionId`. Reading it defensively rather than by type is what keeps a
 * post-processing read from being scoped to a conversation it has nothing to do with, and it is
 * the same posture the door already takes on a FIRST turn, where the id does not exist yet
 * (WINDOWS #192): no asker, no claim.
 */
function askingSessionOf(input: unknown): string | undefined {
  if (typeof input !== 'object' || input === null) return undefined
  const sessionId = (input as { sessionId?: unknown }).sessionId
  return typeof sessionId === 'string' ? sessionId : undefined
}

export function composeDashboardAgentHost(
  host: LocalAgentHost,
  sessionEvents: SessionEventFanOut,
  confirms?: ConfirmRegistry,
  /**
   * The door's ambient asking-session scope, entered around each turn (400-15, gap 3).
   *
   * A CALLBACK RATHER THAN THE STORE, so this composer keeps deciding nothing: it is handed a way
   * to run the invocation inside the door's scope and it uses it, exactly as it is handed
   * `invokeFunction` and calls it. Optional so a caller that composes only the routes' seam — this
   * function is published for that reason — gets the un-scoped behaviour rather than a broken one:
   * with no scope entered, {@link postureFor} sees no asker and answers `local-headless`, which is
   * the fail-closed direction.
   */
  enterAskingSession?: <T>(sessionId: string | undefined, run: () => T) => T,
): AgentHost {
  const enter = enterAskingSession ?? (<T>(_sessionId: string | undefined, run: () => T): T => run())
  return {
    registry: host.registry,
    onSessionEvent: (listener) => sessionEvents.subscribe(listener),
    // 400-03: the SAME registry the composition parks questions in, handed to the routes that
    // serve them. Conditionally spread so a door composed without a confirm channel carries no
    // field at all — the translated no-TTY posture, in one place.
    ...(confirms === undefined ? {} : { confirms }),
    caller: DASHBOARD_FUNCTION_CALLER,
    agentAskFunctionId: AGENT_ASK_FUNCTION_ID,
    // 404-05 (D-16/D-18/D-22): the two ids the post-processing routes dispatch, PASSED on
    // `agentAskFunctionId`'s exact footing. `packages/dashboard-server` may not import this
    // package (validate:arch), so the ids reach it the only way an id can — as data from the
    // composition that already knows them.
    runsPostProcessingFunctionId: RUNS_POST_PROCESSING_FUNCTION_ID,
    runsEventsFunctionId: RUNS_EVENTS_FUNCTION_ID,
    // 400-15: THE ONE PLACE THE ASKING CONVERSATION IS KNOWN AND STILL AHEAD OF EVERYTHING THAT
    // NEEDS IT. `handleTurn` makes exactly one call here per turn, carrying the browser's
    // `sessionId`; the gate's context resolver and the confirm port are both further down this same
    // async chain. Scoping the WHOLE invocation is what makes "who is asking" available to both
    // without widening either contract.
    //
    // `input.sessionId` IS `undefined` ON A FIRST TURN and is passed through as such rather than
    // recovered: the engine mints the id partway down this call, and a browser cannot have opened a
    // stream on an id that does not exist yet (WINDOWS #192). No asker, no claim.
    //
    // `input` IS `unknown` SINCE 404-05, and the asking-session scoping still reads `sessionId`
    // off it — structurally, because that is what it always was. `agent.ask` carries one; the two
    // post-processing reads carry none, and a read with no asker enters no session, which is the
    // fail-closed direction and exactly what {@link postureFor} already answers for.
    invokeFunction: (
      registry: AgentRegistryHandle,
      functionId: string,
      input: unknown,
      caller: FunctionCaller,
    ): Promise<unknown> =>
      enter(
        askingSessionOf(input),
        () => invokeFunction(registry as FunctionRegistry, functionId, input, caller),
      ),
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
    // The fourth door's display boundary, in `chat.ts`'s `emitHuman` shape and for its law
    // (400-06): "everything a surface prints goes through the masker". The context is created and
    // disposed per emit rather than held, exactly as every CLI emit site does it — a long-lived
    // one would be a resolved secret map kept alive for the lifetime of a server process, for no
    // gain over building it at the moment bytes leave.
    // 400-06: the ONE loader, called by the door that serves the browser's `/help`. The path is
    // resolved by `loader.ts` (which ships the file) and never by dashboard-server.
    readCapabilityCatalog: (): unknown => loadCapabilityCatalog(),
    unmaskForDisplay: (text: string): string => {
      const maskingContext = createMaskingContext()
      try {
        return unmaskForHumanOutput(maskingContext, text)
      } finally {
        maskingContext.dispose()
      }
    },
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
 *
 * BOTH HALVES, because the producer requires both (400-10, gap 1). The workspace segment is
 * supplied on identical rules — operator wins, `source: 'default'`, `masked: false` — and is
 * INDEPENDENT of the origin: it is overlaid whenever it is supplied, including while the server
 * has not bound a port yet, because the producer's own AND makes a lone workspace inert rather
 * than wrong. Gating it on the origin would be a second, invisible precondition on a value that
 * has none.
 */
export function overlayDashboardBaseUrl(
  inner: ConfigReaderPort,
  boundOrigin: () => string | undefined,
  workspaceSegment: string | undefined,
): ConfigReaderPort {
  return {
    async getMasked() {
      const masked = await inner.getMasked()
      const supplied: MaskedConfigEntry[] = []

      const origin = boundOrigin()
      if (origin !== undefined && !hasVerbatim(masked, DASHBOARD_BASE_URL_CONFIG_KEY)) {
        supplied.push({
          key: DASHBOARD_BASE_URL_CONFIG_KEY,
          value: origin,
          source: 'default',
          masked: false,
        })
      }

      // An empty segment is left ABSENT rather than overlaid as `''`: `formatEntityUrl` refuses an
      // empty workspace, so an empty entry would be a base that reads as present and renders
      // nothing — the same inert state gap 1 was, one layer down.
      if (
        workspaceSegment !== undefined
        && workspaceSegment.trim() !== ''
        && !hasVerbatim(masked, DASHBOARD_WORKSPACE_CONFIG_KEY)
      ) {
        supplied.push({
          key: DASHBOARD_WORKSPACE_CONFIG_KEY,
          value: workspaceSegment,
          source: 'default',
          masked: false,
        })
      }

      if (supplied.length === 0) return masked
      const overlaidKeys = new Set(supplied.map((entry) => entry.key))
      return {
        ...masked,
        entries: [
          ...masked.entries.filter((entry) => !overlaidKeys.has(entry.key)),
          ...supplied,
        ],
      }
    },
  }
}

/**
 * Does the inner config already carry the operator's OWN value for this key?
 *
 * The `masked` flag is read rather than the value, on `card-context.ts`'s own reasoning: a reduced
 * entry is not the operator's value, and treating it as a presence would leave the overlay refusing
 * to fill an absence that is, as far as the producer is concerned, exactly what it is.
 */
function hasVerbatim(masked: MaskedResolvedConfig, key: string): boolean {
  const entry = masked.entries.find((candidate) => candidate.key === key)
  return entry !== undefined && !entry.masked && entry.value.trim() !== ''
}

/**
 * WHICH CONVERSATION IS ASKING — the one fact the gate's own contract cannot carry (400-15, gap 3).
 *
 * THE GATE HOOK TAKES AN ACTION AND NOTHING ELSE, deliberately, and `invoke.ts` says why beside its
 * own `deny` overlay: a policy engine that read callers would depend on the function layer's
 * vocabulary in order to answer one question. So "which conversation is asking" is narrowed AT THE
 * COMPOSITION BOUNDARY instead — the door scopes each turn, and the two seams that need the answer
 * read it from the ambient scope rather than from a widened contract.
 *
 * ONE SCOPE, TWO READERS, AND BOTH RUN INSIDE THE TURN: `resolveExecutionContext()` is called by
 * `invoke.ts` on its way to `evaluate()`, and the confirm port is called by `evaluate()`'s ask arm.
 * Both are downstream of the one `host.invokeFunction` call `handleTurn` makes, so an
 * `AsyncLocalStorage` set there reaches both across every await between.
 *
 * PER-DOOR AND NEVER MODULE-GLOBAL. A store hung off the module would be shared by every door
 * composed in this process — the conformance suite composes several — and would be exactly the
 * process-level answer to a per-conversation question that gap 3 IS.
 */
interface AskingSessionScope {
  readonly askingSession: string | undefined
  /**
   * Whether a live confirm channel ALONE makes this scope reachable (401-09, D-11 / Pitfall 3).
   *
   * A CONVERSATION NEEDS TWO THINGS AND A RUN TRIGGER NEEDS ONE, and the difference is not a
   * loosening. A watched conversation with no turn in flight is a person reading their transcript —
   * there is no question outstanding for them to be handed, so `watchedAndInFlight` requires the
   * turn as well. A queued run has no turn and never will: being INSIDE this frame is the run's own
   * gate asking, so the channel is the whole question. Claiming otherwise in either direction is
   * the dishonesty this seam exists to prevent — a trigger that required a turn could never be
   * interactive, and a conversation that did not would claim a person who is not being asked.
   *
   * SET BY THE MINTER, never inferred at the read. The run door mints the trigger scope and enters
   * this frame; nothing else can set it, so no chat turn can acquire the trigger's rule.
   */
  readonly reachableByChannelAlone: boolean
}

/**
 * Is a person reachable RIGHT NOW, ON THE CONVERSATION BEING GATED? (400-03 / 400-13 / 400-15,
 * D-05 · RESEARCH Pattern 2.)
 *
 * THE CLAIM TAKES THE ASKER AND ASKS ABOUT THE ASKER. The question is whether THIS conversation —
 * the one being gated — has a channel live on it AND a turn in flight on it. A live channel says a
 * browser is there; an active turn id says that conversation is the one waiting on an answer.
 * Neither alone identifies a reachable asker, and neither is a fact about the process.
 *
 * WHICH IS WHY NOTHING HERE COUNTS ASKERS (400-17, ratified 2026-08-22). Two conversations that are
 * each watched and each in flight are each interactive FOR THEMSELVES: each raises its own question
 * in its own transcript, and answering one settles nothing of the other's. The wrong-transcript
 * defect stays closed STRUCTURALLY rather than by uniqueness — the confirm target is the ambient
 * asking conversation (400-15), so a question can only ever reach the conversation that asked it or
 * be refused, and widening this posture to concurrent conversations cannot widen who approves.
 *
 * AN UNNAMED ASKER IS HEADLESS BY CONSTRUCTION, which is WINDOWS #192 rather than an oversight: a
 * dashboard conversation's FIRST turn carries no session id — the engine mints it — and a browser
 * cannot hold a stream open on a conversation that does not exist yet. There is nobody to reach, so
 * there is no claim to make.
 *
 * The vocabulary's ONE consequence is `requiresFailClosed`, so a door that claimed
 * `local-interactive` with nobody reachable would be telling the gate to consult a confirm port
 * that can only deny — spending an ask-tier call on a question nobody sees, and recording it as one
 * that was asked. `local-headless` denies it in the gate, by name, with `fail-closed-denied` on the
 * audit row.
 *
 * ONE PRODUCER, TWO SURFACES. The gate-facing resolver and the door's published measurement API
 * both come through here, so a cell can read production's own rule for a NAMED conversation without
 * writing a second copy of it — and there is no second copy to disagree.
 */
export function postureFor(
  askingSession: string | undefined,
  watchedAndInFlight: (sessionId: string) => boolean,
): ExecutionContext {
  return askingSession !== undefined && watchedAndInFlight(askingSession)
    ? 'local-interactive'
    : 'local-headless'
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
 * WHICH CONVERSATION IS ASKED is `resolveTargetSession`'s answer, and since 400-15 that answer is
 * THE CALLER ITSELF — the conversation the door scoped around this turn — rather than whichever
 * conversation the process happens to be able to reach. A `ConfirmPort` is handed an action and no
 * caller (392-12), so the caller is narrowed at the composition boundary and delivered here; where
 * it is absent this port REFUSES, and it never substitutes somebody else. A confirm shown in the
 * wrong transcript IS the defect; a denial is not.
 */
/**
 * THE SURFACE THIS DOOR ANSWERS ON (G-401-17), declared ONCE for the two gates it serves.
 *
 * ONE VALUE FOR BOTH SCOPES, and the next reader will wonder whether the run-trigger button
 * deserves its own: it does not. A trust source names the SURFACE a person used, not the feature
 * they used it from — somebody clicking "accept" in a browser did the same thing in the same place
 * whether the question came from the chat panel or the run button, and two values would put two
 * words for one human act into a durable audit vocabulary.
 *
 * ONE CONSTANT READ TWICE rather than two literals, for the reason the port itself is one object
 * at both gates (401-09, D-11): the factory below builds the port, and the run gate's forwarder
 * further down wraps it, and a second spelling is a place for the two halves of one door to
 * disagree about who was standing at it.
 */
/**
 * Typed THROUGH the composition input rather than off `@vostride/agent-qa-safety` directly: a
 * `commands/` module is behind the surface firewall and may not reach into safety un-ledgered
 * (`validate:arch` LINT-01..05 refuses it). Deriving the vocabulary from the seam this file already
 * binds is the stronger spelling anyway — the value it may declare and the value the composition
 * accepts are one type by construction, not two that happen to agree today.
 */
type DashboardConfirmSurface = Exclude<
  NonNullable<ComposeLocalAgentInput['confirm']>['surface'],
  null
>

const DASHBOARD_CONFIRM_SURFACE: DashboardConfirmSurface = 'browser-click'

export function createDashboardConfirmFactory(input: {
  readonly confirms: ConfirmRegistry
  /**
   * The confirm scope this call is inside — a conversation, or a run trigger (401-09, D-11).
   *
   * ONE PORT FOR BOTH, which is what "one confirm vocabulary across the dashboard" means in code.
   * Everything below is scope-agnostic already: the registry parks by scope, the mint is 391's and
   * knows nothing about doors, and the transcript append fail-safes for a scope no conversation
   * claims. A second factory for the run button would have been a second set of three answers and a
   * second place for them to drift.
   */
  readonly resolveConfirmScope: () => string | undefined
}): NonNullable<ComposeLocalAgentInput['chatConfirm']> {
  return (bindings) => {
    /**
     * The session-log append is a RECORD of the decision, never a veto over it.
     *
     * IT NAMES THE CONVERSATION IT IS RECORDING (401-01, D-13). The door has already resolved its
     * asking session by the time any arm below decides anything, so the id is carried here rather
     * than inferred at the far end — the composition used to guess it by counting turns in flight,
     * and lost a real human approval every time a second conversation was mid-turn.
     */
    const ledger = async (
      actionClass: string,
      decision: 'accept' | 'accept-always' | 'deny',
      sessionId: string,
    ): Promise<void> => {
      try {
        // A RUN TRIGGER'S SCOPE NAMES NO CONVERSATION, and the composition's own writer is what
        // decides that: `chatScopes.get(...)` answers nothing for a trigger scope, so no row is
        // appended and none is guessed into somebody else's transcript (401-01, D-13). That is the
        // designed outcome rather than an omission — writing a run's approval into a chat log would
        // be the second spelling of run history this plan's design decision refuses, and the gate's
        // `execution_audit` row remains the record of a trigger's decision.
        await bindings.onDecision({ actionClass, decision, sessionId })
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
      await ledger(action.name, recorded ? 'accept-always' : 'accept', sessionId)
    }

    return {
      surface: DASHBOARD_CONFIRM_SURFACE,
      ask: async (action) => {
        const sessionId = input.resolveConfirmScope()
        if (sessionId === undefined) {
          // NOBODY TO ASK. The same answer the TTY wrapper gives a process with no terminal, reached
          // one layer later because liveness here is a per-turn fact rather than a per-process one.
          //
          // AND NO TRANSCRIPT ROW (401-01, D-13): there is no conversation to carry one. The
          // composition would refuse an unplaceable row anyway, and writing it into whichever
          // conversation happened to be open is the wrong-transcript defect itself. The gate's
          // `execution_audit` row remains the record of this denial — a different mechanism, and the
          // measured blast radius of NEW-AUDIT-01 is exactly that this one is never the audit trail.
          return false
        }

        const answer = await input.confirms.request({
          scopeId: sessionId,
          actionClass: action.name,
          // The action's OWN disclosure — what this invocation is about to cost, composed by the op
          // and carried as inert data. Absent on almost every action, exactly as at the terminal.
          ...(action.disclosure === undefined ? {} : { preview: action.disclosure }),
        })

        if (answer === 'accept-always') {
          await acceptAlways(action, sessionId)
          return true
        }
        await ledger(action.name, answer === 'accept' ? 'accept' : 'deny', sessionId)
        return answer === 'accept'
      },
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
   * An EXPLICIT OVERRIDE of the context this door's policy decisions are taken in (D-05, spec §2.2).
   *
   * OPTIONAL SINCE 400-13, AND THE ABSENCE IS THE HONEST DEFAULT rather than a convenience. The
   * per-conversation posture — is there a watched conversation with a turn in flight — can only be
   * computed INSIDE the composition, because it reads the composed host's own turn state through
   * the mutable box below. A caller outside cannot answer it, so production used to hand in the
   * one answer it COULD compute (any channel anywhere) and the door stated a posture it had no way
   * to know. Absent now means the door derives it from {@link postureFor} over its own
   * per-conversation watched-and-in-flight predicate and the ambient asking conversation; supplied
   * is the spec's explicit-override rung, which is the conformance suite's posture and unchanged.
   *
   * WHAT IS NOT DEFAULTED IS THE PROCESS. Neither arm ever falls back to TTY and CI markers, which
   * is the ambient reach this seam exists to remove.
   */
  readonly resolveExecutionContext?: () => ExecutionContext
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
  /**
   * What this door needs back from the runs it triggers (401-07, D-09 — INVK-01).
   *
   * PASSED STRAIGHT THROUGH to `composeCliLocalAgent`, and this composer decides nothing about it —
   * the same rule that governs `chatModel` and `confirms` above. Absent (the conformance suite's
   * posture, and any caller that only wants the chat door) composes exactly what it composed before.
   */
  readonly runBridge?: ComposeCliLocalAgentInput['runBridge']
  /**
   * 403 D-03: the live-view mint seam `runs.liveurl` binds through.
   *
   * PASSED STRAIGHT THROUGH to `composeCliLocalAgent`, on the same rule as `runBridge` above — this
   * composer decides nothing about it. Absent (the conformance suite's posture, and any door with
   * no served origin) lists `runs.liveurl` `unbound` BY NAME.
   */
  readonly liveView?: ComposeCliLocalAgentInput['liveView']
}

/** The composed door: the local host it owns, and the seam the routes consume. */
export interface DashboardDoor {
  readonly host: LocalAgentHost
  readonly agentHost: AgentHost
  /**
   * The posture this door actually decides under FOR A NAMED CONVERSATION — the caller's override,
   * or the derived one.
   *
   * PUBLISHED SO IT CAN BE MEASURED. The derivation lives inside the composition (it reads the
   * composed host's turn state), so a cell that wanted production's own answer would otherwise have
   * to write a second copy of the rule — which is the two-spellings failure gap 3 is.
   *
   * IT TAKES A SESSION SINCE 400-15, and that is not a convenience: the gate-facing resolver reads
   * the AMBIENT asker this door scopes around each turn, and nothing outside a turn is inside that
   * scope — so a zero-arg read from a cell could only ever answer `local-headless`, which would be
   * a measurement API that agrees with the gate about nothing. Both surfaces resolve through the
   * same {@link postureFor}; this one names the conversation instead of inheriting it.
   */
  readonly resolveExecutionContext: (
    scopeId: string,
    options?: { readonly reachableByChannelAlone?: boolean },
  ) => ExecutionContext
  /**
   * Run a call inside a RUN TRIGGER's confirm scope (401-09, D-11 / D-07).
   *
   * THE RUN DOOR'S HALF OF THE SAME NARROWING `invokeFunction` DOES FOR A TURN. The gate's context
   * resolver and the confirm port are both zero-argument by contract (392-12), so the only way a
   * caller can tell them who is asking is to be inside the scope when they run. A queued run is not
   * a turn and never enters the turn wrapper, which is precisely why the interim posture was
   * `local-headless`; this is the entry that makes a trigger nameable without widening either
   * contract.
   *
   * PUBLISHED BECAUSE THE RUN DOOR IS COMPOSED SEPARATELY. `createDashboardRunDoor` is built BEFORE
   * this composition (it supplies the bridge that is an input to it), so the two are joined by
   * mutable boxes in both directions — `bindHost` one way, this the other.
   */
  readonly enterRunTriggerScope: <T>(scopeId: string, run: () => T) => T
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
   * The workspace half of the card url base: this workspace directory's own NAME (400-10, gap 1).
   *
   * IT IS THE ONLY WORKSPACE IDENTITY A LOCALLY-SERVED HOST HAS. This build carries no
   * workspace-name concept anywhere — `WorkspaceSchema` declares none and `resolveWorkspacePaths`
   * returns paths — so the directory the config file lives in is the one durable, human-recognisable
   * name available at composition time. It is a display segment in a route, never an identity a
   * decision is taken on, and `formatEntityUrl` percent-encodes it.
   *
   * THE OPERATOR'S CONFIGURED VALUE WINS, on the baseUrl half's own precedence: whoever names the
   * workspace their hosted dashboard serves has said something this process cannot know, and
   * overwriting it would point every card link at a workspace that host does not have. M5's hosted
   * naming therefore arrives through the existing knob with nothing here to change.
   *
   * Empty or `/`-degenerate is passed as `undefined`, because absence is the honest state:
   * `formatEntityUrl` refuses an empty workspace, so a blank segment would be a base that reads as
   * present and renders no link.
   */
  const workspaceSegment = ((): string | undefined => {
    const name = basename(dirname(resolve(input.configPath)))
    return name === '' || name === '/' || name === '.' ? undefined : name
  })()

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

  /**
   * The composed browser confirm port, in a box (401-09, D-11).
   *
   * THE SAME OBJECT AT BOTH GATES, WHICH IS 401-05's `doorConfirm` RULE APPLIED HERE. This host
   * answers for two gates — the op-level one and the run one — and `composeCliLocalAgent` resolves
   * "is there somebody at this door" ONCE for both, because two resolutions would be free to
   * disagree. Until this plan the dashboard supplied none, so the run gate inherited
   * `createTtyConfirmPort()`: a terminal prompt, at a web server, that the headless interim posture
   * meant nobody ever reached. A trigger that CAN be interactive would reach it.
   *
   * A BOX BECAUSE THE ORDER CANNOT BE INVERTED, exactly as `composed` above. The port cannot be
   * built out here: it needs `recordStandingApproval` and `onDecision`, which are the composition's
   * OWN mint and session writer, handed to the factory while the composition runs. So the factory
   * captures what it built and the run gate's forwarder reads it at call time — one port, one mint,
   * one set of three answers. A second port built here would be the second mint D-11 forbids.
   */
  let browserConfirm: NonNullable<ComposeLocalAgentInput['confirm']> | undefined

  /**
   * This door's ambient asking-session scope (400-15).
   *
   * COMPOSITION-LOCAL. It is created here, entered by this door's own `invokeFunction` wrapper and
   * read by this door's own posture and confirm target — nothing outside this composition can set
   * it or see it, which is what keeps a second door composed in the same process from answering
   * with this one's asker.
   */
  const askingSessions = new AsyncLocalStorage<AskingSessionScope>()
  const askingSession = (): string | undefined => askingSessions.getStore()?.askingSession

  // THE ONE SPELLING of "is THIS conversation watched and in flight", read through the mutable box
  // above because the composed host does not exist yet at composition time. It is asked about a
  // NAMED conversation and about nothing else; `postureFor` is what turns it into a claim about the
  // conversation actually being gated, by asking it of the asker.
  const watchedAndInFlight = (sessionId: string): boolean =>
    confirms !== undefined
    && confirms.hasLiveChannel(sessionId)
    && composed?.chat.stateFor(sessionId)?.activeTurnId !== undefined

  /**
   * The posture this door decides under, for a NAMED conversation (400-15).
   *
   * The explicit-override rung first — supplied is the spec §2.2 rung the conformance suite
   * composes, and it answers for the whole door by construction because that is what an injected
   * context IS. Absent, the honest per-conversation claim. No `confirms` needs no separate arm: the
   * predicate answers false for every asker on a door with no confirm channel, so the translated
   * no-TTY posture falls out of the one rule.
   */
  /**
   * IS A LIVE CONFIRM CHANNEL ENOUGH for this scope? (401-09, Pitfall 3.)
   *
   * ONE PRODUCER, TWO RULES, AND THE SCOPE ITSELF SAYS WHICH — the frame the caller entered carries
   * the answer, so nothing here inspects an id's spelling and no caller can acquire the other
   * rule by naming itself differently. A run trigger's claim is `hasLiveChannel(triggerScope)` at
   * EVALUATE time and nothing else: the browser that clicked run is still there, or it is not.
   */
  const reachableFor = (scopeId: string, channelAlone: boolean): boolean =>
    channelAlone
      ? confirms !== undefined && confirms.hasLiveChannel(scopeId)
      : watchedAndInFlight(scopeId)

  const postureOf = (
    scopeId: string | undefined,
    channelAlone = false,
  ): ExecutionContext =>
    input.resolveExecutionContext === undefined
      ? postureFor(scopeId, (id) => reachableFor(id, channelAlone))
      : input.resolveExecutionContext()

  // WHAT THE GATE READS. Zero-arg because `invoke.ts` calls it with nothing — the narrowing happens
  // here, at the composition boundary, by reading the scope this door entered around the call. Both
  // halves of the frame are read: WHICH scope is asking, and which reachability rule that scope's
  // kind is honest under.
  const resolveExecutionContext = (): ExecutionContext => {
    const frame = askingSessions.getStore()
    return postureOf(frame?.askingSession, frame?.reachableByChannelAlone === true)
  }

  const host = composeCliLocalAgent({
    agentQaRoot: input.agentQaRoot,
    configPath: input.configPath,
    // 403 D-03: forwarded untouched, conditionally spread — an absent port is an ABSENT field.
    ...(input.liveView === undefined ? {} : { liveView: input.liveView }),
    config: overlayDashboardBaseUrl(
      createMaskedConfigReader(input.configPath),
      input.boundOrigin,
      workspaceSegment,
    ),
    resolveExecutionContext,
    // D-04 (400-03): ONE substrate, tagged. A dashboard conversation rides the exact
    // `.agent-qa/sessions/chat-*.jsonl` log `agent-qa chat` writes — resume, compaction and the
    // cleartext-masking adjudication apply once, to one population — and what distinguishes it is
    // this word on the session HEADER. Never on an event: the grammar's exact-key guard would make
    // every pre-400 file unreadable (Pitfall 4).
    //
    // THE SAME WORD `DASHBOARD_FUNCTION_CALLER.surface` CARRIES, deliberately: the door that
    // dispatched a turn and the door that opened its session are the same fact, and two spellings
    // of it would be free to disagree.
    ...(input.runBridge === undefined ? {} : { runBridge: input.runBridge }),
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
      // 400-15: THE TARGET IS THE ASKER, never the process's single watched conversation. The gate
      // above already refuses to claim `local-interactive` for an unwatched asker, so this is the
      // choke point behind that door rather than a second copy of it: a `ConfirmPort` that cannot
      // name its caller has nobody to ask, and `request()` denies a session with no channel without
      // parking anything. Substituting whoever happens to be watching is the wrong-transcript
      // defect itself, and after this it is not expressible here.
      chatConfirm: (bindings) => {
        const port = createDashboardConfirmFactory({
          confirms,
          resolveConfirmScope: askingSession,
        })(bindings)
        browserConfirm = port
        return port
      },
      // THE RUN GATE'S HALF OF THE SAME PORT (401-09, D-11). A forwarder rather than a second
      // construction: `chatConfirmPort ?? input.confirm` is what the op registry reads, and this is
      // what `createComposedRunExecution` reads, and both resolve to the one object above. A run
      // triggered from the button and a `runs.start` typed into the dashboard's own conversation
      // therefore ask the same way, through the same mint, with the same three answers.
      //
      // `false` BEFORE THE COMPOSITION FINISHES is unreachable in practice — nothing can start a
      // run before the host exists — and is the fail-closed direction if it ever were.
      confirm: {
        // The SAME surface the boxed port declares, read off the one constant above rather than
        // spelled again — this forwarder cannot read `browserConfirm.surface` because the box is
        // still empty when this literal is built, and a second literal would be a second answer
        // to a question this file has already closed once (G-401-17).
        surface: DASHBOARD_CONFIRM_SURFACE,
        ask: async (action) => browserConfirm !== undefined && await browserConfirm.ask(action),
      },
      // Pattern 5: cost previews and diffs land in the transcript BEFORE the confirm bubble, on
      // the same channel and routed to the same conversation. Dropped where no conversation can be
      // identified, for the reason the confirm is denied there.
      chatPresent: (text: string) => {
        const sessionId = askingSession()
        if (sessionId !== undefined) confirms.present(sessionId, text)
      },
    }),
  })
  composed = host
  return {
    host,
    agentHost: composeDashboardAgentHost(
      host,
      sessionEvents,
      confirms,
      (sessionId, run) => askingSessions.run(
        { askingSession: sessionId, reachableByChannelAlone: false },
        run,
      ),
    ),
    resolveExecutionContext: (scopeId, options) =>
      postureOf(scopeId, options?.reachableByChannelAlone === true),
    enterRunTriggerScope: (scopeId, run) => askingSessions.run(
      { askingSession: scopeId, reachableByChannelAlone: true },
      run,
    ),
  }
}


// ---- The fourth door's RUN trigger (401-07, D-01/D-09/D-10 — INVK-01) ------------------------

/**
 * The dashboard's queue used to start a run by SPAWNING `agent-qa run` and reading the child's
 * stdout for `AGENT_QA_EVENT:` lines. `packages/dashboard-server` cannot compose the gated run
 * itself — it may not name `@vostride/agent-qa-agent*` — so the door is composed HERE, in the
 * process that runs that server, and injected. That is the same arrangement, and the same reason,
 * as `agentHost` two hundred lines below.
 *
 * D-10 — THE RUN BUTTON IS ONE MORE CALLER OF `runs.start`. The starter below invokes the composed
 * host's own registry through the shipped `invokeFunction`, so the op-level gate, the run-start
 * gate, the receipt classification, the ack-read-off-the-durable-record and both audit rows apply
 * identically to a browser click and to a sentence typed at `agent-qa chat`. There is no dashboard
 * carve-out and no second spelling of "start a run".
 *
 * THE POSTURE IS THE TRIGGER'S OWN, AND IT IS HONEST BY CONSTRUCTION (401-09, D-11 / Pitfall 3).
 * 401-07 shipped this door `local-headless` for every run, because a queued run is not a turn and
 * so never entered the asking-session scope. That was honest and it was also a floor: an ask-tier
 * run against a shared target could only ever fail closed, even with the person who clicked it
 * sitting in front of the page. This door now mints a CONFIRM SCOPE per queued run and runs the
 * whole `runs.start` invocation inside it, so the gate's context resolver and the confirm port both
 * name that scope — and the posture is `local-interactive` exactly when the triggering browser is
 * still holding a channel on it, `local-headless` otherwise. The claim is never made because "the
 * dashboard is a browser"; it is made because a socket is open, which is the class Pitfall 3 names.
 */
export interface DashboardRunDoor {
  /** Handed to `composeDashboardDoor` BEFORE the host exists — see `bindHost`. */
  readonly runBridge: NonNullable<ComposeCliLocalAgentInput['runBridge']>
  /** Handed to `startServer`. The queue calls `execute` on it and nothing else does. */
  readonly backend: DashboardExecutionBackend
  /**
   * Bind the composed host once it exists.
   *
   * A MUTABLE BOX BECAUSE THE ORDER CANNOT BE INVERTED, exactly as `composed` and `boundOrigin`
   * above: the bridge is an INPUT to the composition, and the starter needs the composition's
   * registry. Reading it at call time is what makes both true at once.
   */
  bindHost(host: LocalAgentHost): void
  /**
   * Bind the door's run-trigger scope entry (401-09, D-11).
   *
   * THE SAME BOX FOR THE SAME REASON, and it is separate from `bindHost` deliberately: a caller
   * that composes this door WITHOUT one — no confirm registry, no browser — gets the 401-07 posture
   * unchanged, because an unentered scope is `undefined` and `postureFor` answers `local-headless`.
   * Absent is the fail-closed direction, so nothing has to remember to pass it for safety's sake.
   */
  bindTriggerScope(enter: <T>(scopeId: string, run: () => T) => T): void
  /**
   * The composed host, or nothing if it has not been bound yet (402-01).
   *
   * PUBLISHED SO A SECOND DOOR IN THIS PROCESS CAN READ THE SAME STATE the run starter's own guard
   * throws on. `/ok`'s `hostComposed` fact and the invoke path's refusal are then two readings of
   * one box rather than two beliefs that can disagree.
   */
  resolveHost(): LocalAgentHost | undefined
  /**
   * Watch every `RunSession` this process's host starts, whichever door started it (402-01).
   *
   * WHY A FAN-OUT AND NOT A SECOND BRIDGE. `composeCliLocalAgent` takes ONE `runBridge`, so there
   * is exactly one place a started session becomes visible in this process. The queue's own routing
   * — by the session's id, into the entry the queue registered — cannot see a run the queue did not
   * enqueue, which is every run the remote service door starts. Rather than mint a second bridge
   * that the composition has no slot for, the one bridge notifies observers as well as routing, and
   * the service door registers one.
   *
   * Returns the unregister handle. An observer's throw is SWALLOWED, on the session fan-out's own
   * reasoning: this channel is downstream of a run that has already started, and nothing on it may
   * reach back and affect that run.
   */
  observeSessions(observer: (session: RunSession) => void): () => void
  /**
   * Bind the secrets THIS PROCESS holds that every run through this door must mask (402-06, #224).
   *
   * THE SAME MUTABLE-BOX SHAPE AS `bindHost`, AND FOR THE SAME ORDERING REASON. The door's bridge
   * is an INPUT to `composeDashboardDoor`, and the run-service credentials are dereferenced by
   * `composeRunServicePorts` — which needs the door. Neither can be built first, so the value
   * arrives through a box the bridge reads at run time.
   *
   * IT IS NOT OPTIONAL PLUMBING A CALLER MIGHT FORGET: `composeRunServicePorts` calls it itself,
   * so any composition that goes through the shipped composer is seeded. A cell that assembled its
   * own verifier and starter beside that composer would be measuring a door this product does not
   * ship, which is the lookalike assembly the conformance suite refuses by name.
   *
   * 2026-08-25 (403-01, T-403-16): IT IS ADDITIVE. Two composers now bind the store THEY own —
   * `composeRunServicePorts` the declared credentials, `composeLiveView` the minted `liveUrl`
   * tokens — and the door UNIONS them through `mergedSecretStore`. It used to be a single
   * assignment, which is how one of them would have vanished without a cell noticing: each
   * composer binds correctly, and only the door could see that the second bind erased the first.
   * `live-view-masking.test.ts` pins BOTH values masked under BOTH composition orders.
   */
  bindMaskingSecrets(store: {
    forEachSecret(cb: (name: string, value: string) => void): void
  }): void
}

/** Structural, so this module names the dashboard package's own type without importing its value. */
type DashboardExecutionBackend = import('@vostride/agent-qa-dashboard').ExecutionBackend

/** What the door holds for a run between `runs.start` going in and the run coming out. */
interface DashboardRunEntry {
  readonly onSession: (session: RunSession) => void
  readonly appiumUrl?: string
  readonly flags: DashboardRunFlags
  readonly ingest: {
    handler: (envelope: RunEventEnvelope) => void
    finalize: () => Promise<void>
  }
}

/** The queue's argv operands that are FLAGS rather than patterns. Exactly one today. */
export interface DashboardRunFlags {
  readonly disableCache?: boolean
}

/**
 * Split the queue's argv operands into request patterns and this door's own flags.
 *
 * THE QUEUE STILL SPEAKS ARGV because that is what its rows contain — `metadata.args` is persisted,
 * and rows enqueued before this change are still in the database. `RunsStartInput` has `patterns`
 * and nothing else, so the operands have to be read rather than forwarded.
 *
 * AN UNRECOGNISED FLAG IS REFUSED BY NAME, never passed through as a pattern. A `--something` that
 * silently became a glob would match no files and either disappear or fail as "no test files found"
 * — a person who asked for a behaviour would get a different run and no indication of it.
 */
export function partitionDashboardRunArgs(args: readonly string[]): {
  readonly patterns: string[]
  readonly flags: DashboardRunFlags
  readonly unsupported: string[]
} {
  const patterns: string[] = []
  const unsupported: string[] = []
  let disableCache: true | undefined
  for (const arg of args) {
    if (!arg.startsWith('-')) {
      patterns.push(arg)
      continue
    }
    if (arg === '--disable-cache') {
      disableCache = true
      continue
    }
    unsupported.push(arg)
  }
  return {
    patterns,
    flags: disableCache === undefined ? {} : { disableCache },
    unsupported,
  }
}

/**
 * Compose the run door — ONE composer, for production and for the cells that measure it.
 *
 * PUBLISHED AND SINGULAR for `composeDashboardDoor`'s own reason: a cell that assembled its own
 * starter beside this one would be measuring a door this product does not ship.
 *
 * ASYNC because the dashboard package is imported lazily throughout this command (so `agent-qa
 * --help` does not pay for a web server), and both of the values below live in it.
 */
export async function createDashboardRunDoor(input: {
  /** The dashboard database THIS SERVER holds. One connection, one writer, one process. */
  readonly db: unknown
}): Promise<DashboardRunDoor> {
  const {
    createDashboardRunIngest,
    createInProcessExecutionBackend,
    // 401-09: the scope-namespace question, asked of the module that owns the namespace rather
    // than answered with a prefix spelled here. This module's relationship with the dashboard
    // package is type-only at module scope on purpose (so `agent-qa --help` does not pay for a web
    // server), so a static import of this value would be a startup regression — this lazy import is
    // already paid for.
    isRunTriggerConfirmScope,
  } = await import('@vostride/agent-qa-dashboard')
  // DEFERRED, and load-bearing: `in-process-run-execution.ts` imports `commands/run.ts`'s producers
  // statically and `commands/run.ts` imports this command's neighbours, so a static edge back can
  // close an ESM cycle at module-evaluation time. Every other door acquires this port the same way.
  // 403-01 (T-403-16): `mergedSecretStore` rides the SAME deferred import for the same reason —
  // a static edge back into `in-process-run-execution.ts` closes an ESM cycle through
  // `commands/run.ts`. It is imported rather than re-written here because the door's
  // `maskingSecrets` contract IS that function's three states, and a second union would be free
  // to disagree about the one-store case the #224 identity cell pins.
  const { cliRunSubscribers, mergedSecretStore } = await import('../composition/in-process-run-execution.js')

  const entries = new Map<string, DashboardRunEntry>()
  /** 402-01: everyone watching the ONE bridge this process's host publishes sessions through. */
  const sessionObservers = new Set<(session: RunSession) => void>()
  let boundHost: LocalAgentHost | undefined
  /** Absent runs the invocation unscoped, which is `local-headless` — the fail-closed default. */
  let enterTriggerScope: (<T>(scopeId: string, run: () => T) => T) | undefined
  /**
   * 402-06 (#224) + 403-01 (T-403-16): the secrets OTHER composers in this process hold, read at
   * RUN time.
   *
   * A SET, NOT A SLOT, and the difference is the whole of T-403-16. Two composers legitimately bind
   * here — `composeRunServicePorts` binds the declared run-service credentials, `composeLiveView`
   * binds the `liveUrl` tokens it mints — and with one slot whichever bound LAST won, silently,
   * with no cell able to see it: each composer is correct on its own, and the door was the only
   * place the collision existed. Empty is still the honest state of a dashboard that holds neither.
   */
  const maskingSecretStores = new Set<{
    forEachSecret(cb: (name: string, value: string) => void): void
  }>()

  const runBridge: NonNullable<ComposeCliLocalAgentInput['runBridge']> = {
    // 402-06 (T-402-04): READ PER RUN, never captured. See `bindMaskingSecrets`.
    maskingSecrets: () => mergedSecretStore(...maskingSecretStores),
    // THE BRIDGE HOOK (D-09). Routed by the session's OWN id rather than by "the run in flight",
    // because this door runs as many at once as the queue has slots.
    onSession: (session: RunSession): void => {
      entries.get(session.id as unknown as string)?.onSession(session)
      // 402-01: and every watcher, whichever door started the run. See `observeSessions`.
      for (const observer of [...sessionObservers]) {
        try {
          observer(session)
        } catch { /* one watcher's failure is not another's, and never the run's */ }
      }
    },
    // THE DB WRITES, UNCHANGED IN WHAT THEY WRITE (D-09's build-order pin). `createDashboardRunIngest`
    // is the same subscriber the spawned child composed; what moved is where it runs and how it
    // learns which row to adopt. That correlation used to be three environment variables the queue
    // put in a child's environment; it is construction data now, per run, which is also what makes
    // two concurrent runs adopt two different rows instead of racing one global.
    subscribers: (attach) => {
      const entry = entries.get(attach.session.id as unknown as string)
      if (entry === undefined) return undefined
      return cliRunSubscribers({
        // NO CONSOLE REPORTER. This process's stdout is a server's log, not a run's transcript, and
        // a run's transcript is the typed bus event log (D-04).
        console: false,
        extraSubscribers: [{
          handler: entry.ingest.handler,
          flush: () => entry.ingest.finalize(),
        }],
      })(attach)
    },
    resolveAppiumUrl: (runId: string): string | undefined => entries.get(runId)?.appiumUrl,
    resolveRunFlags: (runId: string): DashboardRunFlags | undefined => entries.get(runId)?.flags,
  }

  const backend = createInProcessExecutionBackend({
    invokeRun: async ({ opts, onSession }) => {
      const host = boundHost
      if (host === undefined) {
        throw new Error('The dashboard run door was asked to start a run before its host was composed.')
      }
      const { patterns, flags, unsupported } = partitionDashboardRunArgs(opts.args)
      if (unsupported.length > 0) {
        throw new Error(
          `The dashboard run door does not honour ${unsupported.join(', ')}. `
          + 'Queued run arguments now travel as `runs.start` patterns and a small set of named '
          + 'flags; an operand nobody reads would change the run without saying so.',
        )
      }

      // The correlation the retiring child received as `AGENT_QA_RUN_ID` / `AGENT_QA_SUITE_QUEUE_ID`,
      // as construction data. `AGENT_QA_PARENT_RUN_ID` and `AGENT_QA_MAX_RETRIES` are absent because
      // queue retries retired with the machinery that minted their children (D-12).
      const ingest = createDashboardRunIngest({
        db: input.db as never,
        ...(opts.attributes === undefined ? {} : { attributes: opts.attributes }),
        correlationEnv: opts.source === 'suite'
          ? { suiteQueueId: opts.runId }
          : { runId: opts.runId },
      })

      entries.set(opts.runId, {
        onSession,
        ...(opts.appiumUrl === undefined ? {} : { appiumUrl: opts.appiumUrl }),
        flags,
        ingest,
      })
      try {
        const request: RunsStartInput = {
          // THE ENQUEUED ROW'S ID IS THE RUN'S ID. `RunsStartInput.runId` is 401-03's additive
          // field, and this is the caller it was added for: the retiring port already chose the id
          // and handed it to a child, so "the door that starts the run chooses its id" is the
          // shipped trust level rather than a new one.
          runId: opts.runId as RunsStartInput['runId'],
          ...(patterns.length === 0 ? {} : { patterns }),
        }
        // THE SHIPPED DISPATCHER, NOT THE PORT UNDERNEATH IT. Going straight to the run execution
        // would skip the op-level gate, the receipt classification and the ack law — which is the
        // dashboard carve-out D-10 exists to refuse.
        //
        // INSIDE THE TRIGGER'S CONFIRM SCOPE (401-09, D-11). The whole invocation, not a part of it:
        // the op-level gate, the run gate and the confirm port are all further down this one call,
        // and an `AsyncLocalStorage` entered here reaches every one of them across every await
        // between — which is the same mechanism, and the same reason, as the turn wrapper's.
        const dispatch = (): Promise<unknown> => invokeFunction(
          host.registry as FunctionRegistry,
          'runs.start',
          request,
          DASHBOARD_FUNCTION_CALLER,
        )
        // A TRIGGER SCOPE OR NOTHING. `isRunTriggerConfirmScope` is checked here as well as at the
        // route that accepted it, and the redundancy is deliberate: this scope is entered under the
        // CHANNEL-ALONE reachability rule, so a live CHAT conversation named here would have this
        // run's question written into somebody's transcript and let that conversation's watcher
        // approve a run they never triggered. Two doors, one refusal, and the one nearest the
        // decision is this one.
        const scope = opts.confirmScope
        await (
          enterTriggerScope === undefined
          || scope === undefined
          || !isRunTriggerConfirmScope(scope)
            ? dispatch()
            : enterTriggerScope(scope, dispatch)
        )
      } finally {
        entries.delete(opts.runId)
      }
    },
  }) as unknown as DashboardExecutionBackend

  return {
    runBridge,
    backend,
    bindHost: (host: LocalAgentHost): void => { boundHost = host },
    bindTriggerScope: (enter): void => { enterTriggerScope = enter },
    resolveHost: (): LocalAgentHost | undefined => boundHost,
    observeSessions: (observer): (() => void) => {
      sessionObservers.add(observer)
      return () => { sessionObservers.delete(observer) }
    },
    bindMaskingSecrets: (store): void => { maskingSecretStores.add(store) },
  }
}


// ---- The REMOTE door's composition (402-01, D-01/D-02/D-04/D-05/D-06 — INVK-03) ---------------

/**
 * What the run service's own `FunctionCaller` may do — FIXED at composition, never per token.
 *
 * D-06: the door's capability set is decided here, once, for every holder of every credential.
 *
 * A LIST AND NOT A SPREAD, which is the opposite of {@link DASHBOARD_FUNCTION_CALLER}'s rule and
 * for the opposite reason. That door's claim is parity with the CLI chat door, so its grant must
 * track the CLI's automatically. This door's claim is LEAST PRIVILEGE, so a scope minted tomorrow
 * must NOT reach it by default: the whole point is that a remote token-holder's powers are the
 * ones somebody wrote down.
 *
 * Dated note (2026-08-25, Phase 403 plan 03 / D-03, Q3): `read` joins `run`, and this is the diff
 * the 402 wording above pre-authorised in its own words — "the diff that needs `read` is the diff
 * that adds it". `GET /run/:runId/live-url` dispatches `runs.liveurl`, whose declared
 * `requiredScopes` is `['read']`, and without this member `invokeFunction` raises
 * `FunctionScopeError` before the op is ever reached. Measured, not assumed: the conformance door
 * answered 500 `live_url_mint_failed` for a credentialled mint until this line changed.
 *
 * WHAT WAS REJECTED, AND WHY. Retagging `runs.liveurl` as a `run` op instead would have kept this
 * list at one member — and it would have re-axised a capability's declared cost to fit ONE door's
 * grant, telling every other caller that the price of VIEWING a run is the power to EXECUTE one.
 * That is the privilege conflation `FunctionScopeSchema`'s own counter-notes refuse three times
 * over, pointed the other way.
 *
 * WHAT THIS DOES AND DOES NOT WIDEN. A scope is not a route. This door publishes four paths and
 * dispatches exactly two ops; `runs.get`, `runs.list`, `analysis.get` and every other read the
 * registry declares stay UNREACHABLE from here because no route reaches them, which is a stronger
 * bound than a scope list and the one `runServiceSurfaceAdapter.notApplicable` now states.
 */
export const RUN_SERVICE_GRANTED_SCOPES: readonly FunctionScope[] = Object.freeze(['run', 'read'])

/** The surface id this door attributes its calls to. Attribution only, never a permission input. */
export const RUN_SERVICE_SURFACE = 'run-service'

/**
 * Mint the caller for ONE verified request (D-04, Pitfall 4).
 *
 * NEVER `DASHBOARD_FUNCTION_CALLER`. That caller holds the CLI chat door's whole scope set and
 * mints `origin: 'human'`; reusing it here would hand a remote token every power a person sitting
 * at this machine has, and would tell the gate a person decided something nobody decided.
 *
 * `origin: 'agent'` is the fail-closed reading of the closed two-member axis (391 D-06): the axis
 * asks "did a person decide this", and on a request that arrived over a socket from another
 * machine the answer this process can honestly give is no. `human` would be a self-grant minted
 * from a header.
 *
 * `credential` is the matched entry's TrustScope, PASSED THROUGH UNTOUCHED — the function layer
 * never inspects or rewrites it and `evaluate()` owns ask-tier resolution against it. This is the
 * whole of "the token is the trust grant": one credential family, no second auth vocabulary, and
 * the reserved v48 field filled rather than a new machinery built beside it.
 */
export function runServiceCallerFor(trustScope: TrustScope): FunctionCaller {
  return Object.freeze({
    surface: RUN_SERVICE_SURFACE,
    grantedScopes: RUN_SERVICE_GRANTED_SCOPES,
    origin: 'agent',
    safeMode: false,
    credential: { scope: trustScope },
  })
}

/**
 * THE READINESS PREDICATE — ONE DECLARATION SITE, TWO DOORS (D-15).
 *
 * Exported rather than inlined into `composeRunServicePorts` because `/ok` is not the only place
 * this question is asked: the local door's preflight (402-05) serves the SAME answer, and D-15's
 * whole content is that there is one readiness spelling rather than two that agree today. A second
 * copy of these four facts is how the remote door and the dashboard start disagreeing about
 * whether this process can run anything.
 *
 * EVERY FIELD IS MEASURED, AND NOTHING IS PREDICTED. `hostComposed` reads the SAME box the run
 * starter's guard throws on — not a parallel flag — so `/ok` cannot say yes where `POST /run` says
 * no. `authConfigured` is a COUNT reduced to a boolean: whether this process resolved any
 * credential, never how many and never which. `contractVersion` is a constant, which is the point
 * of it: a caller learns which route set it is talking to without this process guessing anything.
 *
 * WHAT IS DELIBERATELY ABSENT is a `ready` verdict. Whether a run will succeed depends on a
 * browser, a model, a network and a target, none of which this predicate touched — and a field
 * that claimed otherwise would be the most useful-looking lie on the whole door. Deep diagnostics
 * are 407's `doctor`.
 */
export function createRunServiceReadiness(input: {
  /** The composed-host box. Read at CALL time, because a host binds after this is built. */
  readonly resolveHost: () => LocalAgentHost | undefined
  /** How many credentials resolved. Reduced to a boolean here and never published as a count. */
  readonly tokenCount: number
}): () => RunServiceReadiness {
  return () => ({
    service: 'up',
    hostComposed: input.resolveHost() !== undefined,
    authConfigured: input.tokenCount > 0,
    contractVersion: RUN_SERVICE_CONTRACT_VERSION,
  })
}

export interface RunServiceCompositionInput {
  /** The declared entries, straight off `services.dashboard.runServiceTokens`. */
  readonly entries: readonly RunServiceTokenEntry[]
  /** The environment the declared variables are dereferenced from, once, now. */
  readonly env?: NodeJS.ProcessEnv
  /** The run door this process composed — the host box and the one session bridge. */
  readonly door: Pick<
    DashboardRunDoor,
    'resolveHost' | 'observeSessions' | 'bindMaskingSecrets'
  >
  /** How long a finished run stays attachable. Defaults to the registry's own window. */
  readonly retentionMs?: number
  /**
   * 403 D-14 (WINDOWS #264): the process's ALREADY-COMPOSED session registry, when there is one.
   *
   * The command now hoists the registry above the door composition so it exists on BOTH token arms
   * — a zero-token dashboard has live runs to attach to too, and building the lookup only inside
   * this composer is precisely how the local run-stream door came to answer 503 for a run this
   * process was executing. Supplied ⇒ used as-is and `dispose` leaves it to its owner; absent ⇒
   * this composer builds and owns one, exactly as it did.
   */
  readonly sessions?: RunServiceSessionRegistry
}

export interface RunServiceComposition {
  /** Handed to `startServer` as `runService`. */
  readonly ports: RunServicePorts
  /** The resolved values, shaped as the run masker's secret-store port. Seeded by declared name. */
  readonly secretStore: { forEachSecret(cb: (name: string, value: string) => void): void }
  /** How many credentials resolved. A COUNT, never the values — `/ok` reports whether it is > 0. */
  readonly tokenCount: number
  /**
   * THE READINESS PREDICATE THIS COMPOSITION BUILT (402-05, D-15).
   *
   * PUBLISHED SO THE LOCAL DOOR CAN SERVE THE SAME FUNCTION OBJECT — not an equal one. `ports`
   * above carries it too, and they are the identical reference by construction; a cell pins that
   * identity, because "two doors agree today" and "there is one predicate" are different claims
   * and only the second one survives a later edit.
   */
  readonly readiness: () => RunServiceReadiness
  /** Unregister the session observer and drop every retained handle. */
  dispose(): void
}

/**
 * Compose the remote door's ports — ONE composer, for production and for the cells that measure it.
 *
 * PUBLISHED AND SINGULAR for `composeDashboardDoor`'s own reason: a cell that assembled its own
 * verifier, caller mint or starter beside this one would be measuring a door this product does not
 * ship, which is the lookalike-assembly failure the conformance suite refuses by name.
 *
 * THE TOKENS ARE DEREFERENCED HERE, ONCE, BEFORE ANYTHING LISTENS. A declared variable that is
 * unset throws `RunServiceTokenEnvVarUnsetError` out of this call and out of `agent-qa dashboard`
 * — startup REFUSES, naming the variable and never a value (D-05). A server that started with a
 * credential nobody can present reads to an operator exactly like a server rejecting their token.
 *
 * THE STARTER IS NAMED `invokeRunStart`-STYLE AND NOT `startRun`. `startRun` is the RUN SHELL's
 * entry point in `@vostride/agent-qa-runner`, and `run-door-invocation-census.test.ts` makes a
 * complete-set claim over this package that no file acquires it.
 */
export function composeRunServicePorts(input: RunServiceCompositionInput): RunServiceComposition {
  const tokens: readonly ResolvedRunServiceToken[] = resolveRunServiceTokens(
    input.entries,
    input.env ?? process.env,
  )
  // THE ATTACHABLE-SESSION LOOKUP, in its own module. See that module's header for why the
  // retention timer may not live in this file. 403 D-14: the command hoists one above BOTH token
  // arms and hands it in; owning one here is now the fallback for a caller that composed none.
  const ownsSessions = input.sessions === undefined
  const sessions = input.sessions ?? createRunServiceSessionRegistry({
    observeSessions: input.door.observeSessions,
    ...(input.retentionMs === undefined ? {} : { retentionMs: input.retentionMs }),
  })

  const invokeRunStart = async (start: RunServiceStartInput): Promise<RunStartAcknowledgement> => {
    const host = input.door.resolveHost()
    if (host === undefined) {
      throw new Error('The run service was asked to start a run before its host was composed.')
    }
    // NO `runId`, NO `scope`, NO `executionContext` ON THE REQUEST. The remote door does not carry
    // a caller's claim about any of them, and it does not substitute a claim of its own: the core
    // mints the id, the config resolves the scope, and the context is this composition's own
    // fail-closed default. The dashboard door legitimately forwards a pre-minted id because its
    // queue chose one; a remote caller has chosen nothing.
    const request: RunsStartInput = start.patterns === undefined || start.patterns.length === 0
      ? {}
      : { patterns: [...start.patterns] }
    // THE SHIPPED DISPATCHER, NOT THE PORT UNDERNEATH IT (D-04). Going straight to the run
    // execution would skip the op-level gate, the receipt classification and the ack law — the
    // carve-out the no-private-powers law refuses.
    const result = await invokeFunction(
      host.registry as FunctionRegistry,
      RUNS_START_FUNCTION_ID,
      request,
      runServiceCallerFor(start.trustScope),
    )
    // PARSED, NOT CAST. The ack law says every field comes off the durable record; this is the
    // read side of it, and it is what makes the router's typed 202 a fact rather than a hope.
    return RunStartAcknowledgementSchema.parse(result)
  }

  /**
   * THE MINT, UNDER THE CALLER'S OWN TRUST SCOPE (403 D-03, Q3 · T-403-01).
   *
   * THE SAME HELPER THE LOCAL DOOR CALLS, by reference — see `mintLiveUrlThrough`. The two doors
   * differ in the `FunctionCaller` and in nothing else: `runServiceCallerFor(trustScope)` here,
   * built from the VERIFIED bearer's scope, against the dashboard's own local caller there. A door
   * that substituted a caller of its own would let a token-holder mint a viewing credential under
   * this host's authority rather than under the authorization it actually presented.
   *
   * AN UNCOMPOSED HOST IS `live_view_unavailable`, NOT A CRASH. It is the same genuine host fact
   * `runs.liveurl` itself raises when no live-view port is bound, said in the same word, so a
   * caller cannot distinguish a host with no live view and a host not composed yet — which is
   * correct, because from where they stand those are the same situation.
   *
   * (The wording above deliberately avoids a quoted string immediately after a bare keyword:
   * `validate:arch` reads every `<keyword> '…'` in a file as a declared dependency, and a JSDoc
   * sentence shaped that way is reported as a phantom external dep. Measured live here; the same
   * false positive `handle-scope.ts` records at its own `handleRosterOf`.)
   */
  const mintLiveUrl = async (mint: MintLiveUrlInput): Promise<RunsLiveUrlResult> => {
    const host = input.door.resolveHost()
    if (host === undefined) {
      throw new LiveViewUnavailableError('the run service host is not composed yet')
    }
    return mintLiveUrlThrough(
      host.registry as FunctionRegistry,
      runServiceCallerFor(mint.trustScope),
    )(mint.runId, mint.handle)
  }

  // THE ONE PREDICATE, CALLED — not a second copy of it. See `createRunServiceReadiness`.
  const readiness = createRunServiceReadiness({
    resolveHost: input.door.resolveHost,
    tokenCount: tokens.length,
  })

  const ports: RunServicePorts = {
    verifyBearer: (header) => matchServiceBearer(header, tokens),
    invokeRunStart,
    attach: (runId) => sessions.attach(runId),
    readiness,
    mintLiveUrl,
  }

  // THE STORE IS BOUND HERE, NOT PUBLISHED AND HOPED FOR (402-06, WINDOWS #224). Until this line
  // `runServiceTokenSecretStore` was built, exported and consumed by nothing: the values a remote
  // caller presents are in this process's environment under a name `sensitiveEnvSlice` cannot
  // recognise, so a run started through this door printed them in the clear if anything echoed the
  // variable. Binding inside the composer rather than at the command means every composition that
  // uses the shipped composer is seeded, including the suites.
  const secretStore = runServiceTokenSecretStore(tokens)
  input.door.bindMaskingSecrets(secretStore)

  return {
    ports,
    secretStore,
    tokenCount: tokens.length,
    // THE SAME OBJECT `ports.readiness` HOLDS, deliberately — see the field's own doc.
    readiness,
    dispose: () => { if (ownsSessions) sessions.dispose() },
  }
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

    // ---- The run door (401-07, D-01/D-09/D-10) -------------------------------------------------
    //
    // COMPOSED BEFORE THE HOST AND BOUND AFTER IT, for the reason `composed` and `boundOrigin`
    // inside `composeDashboardDoor` are boxes: the bridge is an INPUT to the composition and the
    // starter needs the composition's registry, so one of the two has to be read at call time.
    const runDoor = await createDashboardRunDoor({ db })

    // ---- The live-view composition (403 D-03/D-14 — closes WINDOWS #264) -----------------------
    //
    // HOISTED ABOVE THE DOOR, AND UNCONDITIONAL. The attachable-session registry used to be built
    // inside `composeRunServicePorts`, which runs ONLY when `runServiceTokens` is declared — so on
    // the default zero-token dashboard nothing ever registered a session and the local
    // `/api/run-stream/:runId` door answered 503 about runs this very process was executing. It is
    // composed here, once, for both arms; the token arm receives it rather than building a second.
    const sessions = createRunServiceSessionRegistry({ observeSessions: runDoor.observeSessions })
    // The signer, the mint port and the validator, joined once. `composeLiveView` binds its own
    // minted-token masking store inside the composer (402-06's law) — the command never does.
    const liveView = composeLiveView({ sessions, origin: () => boundOrigin, door: runDoor })

    const { agentHost, host: runHost, enterRunTriggerScope } = composeDashboardDoor({
      agentQaRoot: resolve(configDir, '.agent-qa'),
      configPath: configFilePath,
      boundOrigin: () => boundOrigin,
      liveView: liveView.liveView,
      ...(chatModel === undefined ? {} : { chatModel }),
      // NO `resolveExecutionContext` (400-13). D-05 is answered per RESEARCH Pattern 2 — reuse
      // `local-interactive` rather than minting a fifth vocabulary member — but the answer is a
      // PER-CONVERSATION fact that only the composition can compute, so production supplies no
      // override and takes the derived predicate. What this command used to pass was "any channel
      // anywhere", which is the posture gap 3 measured false. Nothing here reaches
      // `setActiveExecutionContextResolver` either: that setter is a process global and would
      // re-answer the question for every composition in this process (Pitfall 5).
      confirms,
      runBridge: runDoor.runBridge,
    })
    runDoor.bindHost(runHost)
    // 401-09 (D-11): the other half of the box pair. With it bound, an ask-tier queued run asks the
    // browser that triggered it; without it — a door composed with no confirm registry at all —
    // every trigger stays `local-headless`, which is the posture 401-07 shipped.
    runDoor.bindTriggerScope(enterRunTriggerScope)

    // ---- The REMOTE door (402-01, D-02/D-05/D-06 — INVK-03) -----------------------------------
    //
    // COMPOSED HERE FOR `agentHost`'s AND `executionBackend`'s OWN REASON: the ports name
    // `runs.start`, `invokeFunction`, the composed local host and this project's credential
    // resolution, none of which `packages/dashboard-server` may import. The server mounts the
    // module; this process supplies everything it reaches through.
    //
    // NOT MOUNTED WHEN NOTHING IS DECLARED, and that is the shipped default rather than a
    // degradation: a project that has declared no run-service credential gets today's dashboard,
    // byte for byte. The alternative — mounting with an empty token list — would be a door every
    // request is refused at, which is honest but adds a surface nobody asked for.
    //
    // AN UNSET DECLARED VARIABLE REFUSES STARTUP FROM INSIDE THIS CALL, naming the variable and
    // never a value (D-05). The refusal reaches the `catch` below as an ordinary command error.
    const configuredHost = typeof servicesConfig.host === 'string' && servicesConfig.host.trim() !== ''
      ? (servicesConfig.host as string).trim()
      : undefined
    const runServiceEntries = (servicesConfig.runServiceTokens ?? []) as readonly RunServiceTokenEntry[]
    const runService = runServiceEntries.length === 0
      ? undefined
      : composeRunServicePorts({ entries: runServiceEntries, door: runDoor, sessions })

    const { close, port: listeningPort } = await startServer({
      db,
      port,
      // 402-05 (D-07 — INVK-03): the interface this server binds. A non-loopback value is REFUSED
      // pre-listen, unconditionally — the credential count that once exempted it was deleted in
      // the phase-402 verification round, because a run-service token authenticates the three
      // run-service paths and leaves `/api/runs/trigger` anonymous. The config schema still does
      // not refuse a non-loopback host at parse time, so the refusal reads as a security decision
      // rather than a config-shape error.
      ...(configuredHost === undefined ? {} : { host: configuredHost }),
      // 402-05 (D-15): the LOCAL readiness door, supplied on BOTH arms. With the service mounted
      // this is the identical function object the authed `/ok` serves; without it, the SAME
      // producer is called with a zero count, so a project that declared no credential gets an
      // honest `authConfigured: false` rather than a 404 the browser preflight cannot read. What
      // is deliberately NOT here is a second copy of these four facts.
      runServiceReadiness: runService?.readiness
        ?? createRunServiceReadiness({ resolveHost: runDoor.resolveHost, tokenCount: 0 }),
      // 403 D-14 (WINDOWS #264): the session lookup, on BOTH arms — this is the
      // `runServiceReadiness` line's own argument, not the `runService` conditional's. The
      // registry is hoisted above both, so the local run-stream door and the frame socket can
      // attach to a run this process is executing whether or not a credential was declared.
      runServiceAttach: sessions.attach,
      // 403 D-03/D-06: the live-view seam, likewise on both arms. `validate` is the function
      // layer's own validator by reference; `mintLiveUrl` dispatches the op through the SHIPPED
      // dispatcher, so the mint pays the op-level gate and the receipt classification exactly as
      // `runs.start` does — a direct call to the port underneath would be the carve-out the
      // no-private-powers law refuses.
      liveView: {
        validate: liveView.validate,
        // 403-03 (D-03, Q3): THE SAME FUNCTION THE AUTHED DOOR CALLS, by reference. Both doors mint
        // the identical credential through the identical dispatcher and differ only in the caller
        // identity — which is what makes the two-door parity corpus a claim about one mint.
        mintLiveUrl: mintLiveUrlThrough(
          runHost.registry as FunctionRegistry,
          DASHBOARD_FUNCTION_CALLER,
        ),
      },
      uiDir,
      artifactsDir: resolve(configDir, artifactsDir),
      workspacePaths,
      configPath: configFilePath,
      llmConfig: dashboardLLMConfig,
      authFetch,
      agentHost,
      // INVK-01: the queue executes through this, in this process, over `runs.start`. A dashboard
      // started without it would answer 503 from the execution routes — which is what an
      // unresolvable `agent-qa` binary used to produce, and the honest shape of the same absence.
      executionBackend: runDoor.backend,
      // 402-01: absent is an ABSENT field and never a present `undefined`, on the house rule
      // `agentHost` and `executionBackend` already follow — the server's own mount arm decides.
      ...(runService === undefined ? {} : { runService: runService.ports }),
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
      // 402-01: unregister the session observer and drop every retained handle. Without it the
      // run door's observer set keeps a closure alive that keeps this map alive that keeps every
      // finished run's bus alive.
      runService?.dispose()
      // 403 D-14: the hoisted registry is the command's to dispose — `composeRunServicePorts`
      // leaves a registry it did not build alone.
      sessions.dispose()
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
