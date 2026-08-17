// THE CLI'S BINDING OF `composeAnalytics` (Phase 398 plan 10, D-17 / D-19 / D-20 · ANLY-01).
//
// WHAT THIS FILE IS AND IS NOT. It is the one place in `packages/cli` that names
// `@vostride/agent-qa-analytics`'s `composeAnalytics`, and every host — run, chat, daemon, mcp,
// init — calls it once at its own composition root and holds the object it returns. It is NOT a
// second decision site: the opt-out question is asked and answered inside `composeAnalytics`, and
// this function neither reads `DO_NOT_TRACK` nor inspects `config.analytics.privacy`. A cell counts
// the shipped call sites of `composeAnalytics` in this package and refuses any number but one, and
// a second cell counts the shipped reads of `DO_NOT_TRACK` here and refuses any number but zero.
//
// WHAT IT ADDS, and why each addition belongs to a HOST rather than to the package:
//
//   1. THE STANDARD PROPERTIES. Version, surface, runtime context and agent product are facts
//      about the process that started, which is exactly what a composition root knows and a
//      library does not. They are resolved once here and handed to every emitter, so two events
//      from one invocation cannot disagree about which surface produced them.
//   2. THE IDENTITY GATE. `resolveAnalyticsIdentity` MINTS AND WRITES `~/.agent-qa/analytics.json`
//      on a machine that has none. Under the v1 module that write could not happen while opted
//      out, because `capture()` returned before the identity was ever resolved. The port has no
//      such early return — it resolves the identity and then hands the payload to whichever
//      transport exists — so a naive rewire would make `DO_NOT_TRACK=1` MINT A PERSISTENT
//      ANONYMOUS USER ID on first use. That is not a network leak, and the zero-network
//      differential would still pass, which is precisely why it is written down here: a user who
//      set the ecosystem's opt-out variable did not ask for a new identity file either.
//
//      The gate reads `composed.optedOut` — the ANSWER the one decision produced — rather than
//      re-deriving it. Reading the decision is not making it.
//
// THERE IS STILL NO AMBIENT ANYTHING. This module exports a function that RETURNS a host object.
// It holds no module-level state, there is no `getAnalytics()`, and a file that has not been handed
// a `CliAnalyticsHost` cannot emit.

import {
  ANONYMOUS_ANALYTICS_IDENTITY,
  composeAnalytics,
  resolveAnalyticsIdentity,
} from '@vostride/agent-qa-analytics'
import type {
  AgentQaAnalyticsEvent,
  AgentQaAnalyticsPort,
  AnalyticsIdentity,
  AnalyticsMaskingContext,
  AnalyticsOptOutConfig,
  AnalyticsOptOutReason,
  AnalyticsRunStandardProperties,
  AnalyticsTransport,
  AnalyticsTransportKind,
} from '@vostride/agent-qa-analytics'
import { getAgentQaVersion } from '@vostride/agent-qa-core'

/**
 * Which process is emitting, taken from the subscriber's own standard-properties type rather than
 * restated. `ANALYTICS_EMITTING_HOSTS` is the array behind it; naming the type keeps this file from
 * carrying a second spelling of a vocabulary the union owns.
 */
export type CliAnalyticsSurface = NonNullable<AnalyticsRunStandardProperties['surface']>

export interface ComposeAnalyticsHostInput {
  /** Which process is emitting. A host names itself; nothing infers it. */
  surface: CliAnalyticsSurface
  /** The resolved project configuration, when this host has one. `undefined` is a real posture. */
  config?: AnalyticsOptOutConfig
  /** This host's environment slice. Defaults to `process.env`; passed in so a cell can drive it. */
  env?: Readonly<Record<string, string | undefined>>
  /**
   * The run/session masking context, when the host already built one.
   *
   * Handed straight through to the package's send seam. A host never masks an event itself — that
   * would be a second masking site, and the seam exists so there is one.
   */
  maskingContext?: AnalyticsMaskingContext
  /** Cell seam: replaces the transport on the opted-IN arm only (the package's own rule). */
  transportOverride?: AnalyticsTransport
  /** Cell seam: replaces the identity resolution so a suite never touches a real home directory. */
  resolveIdentity?: typeof resolveAnalyticsIdentity
}

/**
 * What a host holds for the life of its invocation.
 *
 * `port` is the only way to emit. `flush`/`shutdown` are forwarded rather than re-implemented so a
 * host's teardown is the port's teardown; `optedOut`/`optOutReasons`/`transportKind` are reported
 * for a `--verbose` or doctor line, so a host never re-reads the variable to describe the posture.
 */
export interface CliAnalyticsHost {
  readonly port: AgentQaAnalyticsPort
  readonly properties: AnalyticsRunStandardProperties
  readonly optedOut: boolean
  readonly optOutReasons: readonly AnalyticsOptOutReason[]
  readonly transportKind: AnalyticsTransportKind
  flush(): Promise<void>
  shutdown(): Promise<void>
}

/**
 * Compose this host's analytics. Called ONCE per invocation, at the composition root.
 *
 * Async because the identity store is on disk. The await happens on the opted-in arm only — see the
 * identity gate in the header — so an opted-out invocation pays no I/O and leaves no trace.
 */
export async function composeAnalyticsHost(
  input: ComposeAnalyticsHostInput,
): Promise<CliAnalyticsHost> {
  // Assigned below, before anything can capture: the port resolves the identity lazily, at the
  // first `capture()`, and there is no capture between this line and the assignment.
  let identity: AnalyticsIdentity = ANONYMOUS_ANALYTICS_IDENTITY

  const composed = composeAnalytics<AgentQaAnalyticsEvent>({
    env: input.env ?? process.env,
    ...(input.config === undefined ? {} : { config: input.config }),
    ...(input.maskingContext === undefined ? {} : { maskingContext: input.maskingContext }),
    ...(input.transportOverride === undefined ? {} : { transportOverride: input.transportOverride }),
    identity: () => identity,
  })

  const properties: AnalyticsRunStandardProperties = {
    agent_qa_version: getAgentQaVersion(),
    surface: input.surface,
    // PostHog's own directive; see the union's base properties. Set on every event this CLI emits.
    $process_person_profile: false,
  }

  if (!composed.optedOut) {
    const resolve = input.resolveIdentity ?? resolveAnalyticsIdentity
    const resolved = await resolve({ env: { ...(input.env ?? process.env) } })
    identity = {
      distinctId: resolved.distinctId,
      ...(resolved.isInternal === true ? { isInternal: true } : {}),
    }
    properties.runtime_context = resolved.runtimeContext
    if (resolved.agentProduct !== undefined) properties.agent_product = resolved.agentProduct
  }

  return {
    port: composed.port,
    properties,
    optedOut: composed.optedOut,
    optOutReasons: composed.optOutReasons,
    transportKind: composed.transportKind,
    flush: () => composed.port.flush(),
    shutdown: () => composed.port.shutdown(),
  }
}

/**
 * Build a full event from this host's standard properties and a member's own fields.
 *
 * Typed against the closed union rather than against `Record<string, unknown>`: the member name and
 * its properties are checked at every call site, so a field the union does not declare is a
 * compile error at the emitter rather than a `.strictObject` refusal at parse time. That is the
 * whole reason `AgentQaAnalyticsPort` is parameterised by the union.
 */
export function analyticsEvent<TName extends AgentQaAnalyticsEvent['name']>(
  host: CliAnalyticsHost,
  name: TName,
  properties: Omit<
    Extract<AgentQaAnalyticsEvent, { name: TName }>['properties'],
    keyof AnalyticsRunStandardProperties
  >,
): Extract<AgentQaAnalyticsEvent, { name: TName }> {
  return {
    name,
    properties: { ...host.properties, ...properties },
  } as Extract<AgentQaAnalyticsEvent, { name: TName }>
}
