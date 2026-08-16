// THE OPT-OUT DECISION SITE. There is exactly one, and it is here (Phase 398 plan 03, D-19 ·
// ANLY-01).
//
// 2026-08-17. Read this before adding an environment read anywhere else in this package, because
// the property being protected is not "the opt-out is respected" — it is that the opt-out CANNOT be
// bypassed by code written later, including code written by someone who never read this comment.
//
// The v1 module resolved the question with a `disabled` boolean consulted at the top of `capture()`
// and `flush()`, and constructed its PostHog transport in the constructor before consulting
// anything but `config.analytics.privacy`. Two consequences followed, and neither is a bug in the
// usual sense — the code did what it said. First, a process that had opted out still held a live
// PostHog client with the project key in it, one `if` away from sending; anything that reached the
// transport directly, or any future send path that forgot the guard, fired. Second, `DO_NOT_TRACK`
// was not handled at all: the ONLY opt-out was a config flag, which a user who set the ecosystem's
// standard variable had no way to discover.
//
// What replaces it is a decision made ONCE, before any transport object exists, whose ANSWER IS THE
// OBJECT. Opted out means the noop transport was constructed and the PostHog transport was not —
// there is no live client in the process to bypass a guard to reach, because there is no client.
// That is what makes the claim structural rather than behavioural, and it is why the cell that
// matters asserts the PostHog factory was never CALLED rather than that it sent nothing.
//
// Two inputs, and DENY WINS over both. `DO_NOT_TRACK` is the ecosystem convention; the config
// privacy flag is what shipped. Either one alone opts out, and neither can opt back in over the
// other — `DO_NOT_TRACK=0` beside `privacy: true` is still opted out, because a user who set the
// flag meant it and an unset variable is not a request to be tracked.

import { createAnalyticsPort, resolveAnonymousIdentity } from './port.js'
import { createPosthogTransport, NoopTransport } from './transports.js'
import { AGENT_QA_POSTHOG_HOST, AGENT_QA_POSTHOG_KEY } from './posthog-project.js'
import type {
  AnalyticsEventEnvelope,
  AnalyticsIdentityResolver,
  AnalyticsPort,
  AnalyticsTransport,
} from './port.js'
import type { PosthogTransportFactory } from './transports.js'

export type AnalyticsOptOutReason = 'do-not-track' | 'config-privacy'

export type AnalyticsTransportKind = 'noop' | 'posthog'

export interface AnalyticsOptOutConfig {
  readonly analytics?: {
    readonly privacy?: boolean
  }
}

export interface ComposeAnalyticsOptions {
  /** The host's environment slice. Passed in rather than read off `process` so composition is pure. */
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly config?: AnalyticsOptOutConfig
  readonly identity?: AnalyticsIdentityResolver
  readonly projectKey?: string
  readonly projectHost?: string
  /** Replaces the transport on the OPTED-IN arm only. Never consulted once the answer is deny. */
  readonly transportOverride?: AnalyticsTransport
  /** Replaces the PostHog transport CONSTRUCTOR, so a cell can observe whether it was called. */
  readonly posthogTransportFactory?: PosthogTransportFactory
}

export interface ComposedAnalytics<TEvent extends AnalyticsEventEnvelope = AnalyticsEventEnvelope> {
  readonly port: AnalyticsPort<TEvent>
  /** The transport the port was built over — exposed so a cell can assert WHICH one exists. */
  readonly transport: AnalyticsTransport
  readonly optedOut: boolean
  readonly optOutReasons: readonly AnalyticsOptOutReason[]
  readonly transportKind: AnalyticsTransportKind
}

/**
 * The permissive reading of the `DO_NOT_TRACK` convention: present, and not one of the three
 * spellings that mean "no".
 *
 * RESEARCH A1 recorded that adopters split between "any value opts out" and "a truthy value opts
 * out", and that D-19's tested value is `DO_NOT_TRACK=1`. The split only reaches values nobody sets
 * deliberately, so the tie is broken toward the user: an unrecognised value opts OUT. Comparison is
 * trimmed and case-folded because a variable exported from a shell script arrives with whatever
 * whitespace the script left on it.
 */
export function isDoNotTrack(value: string | undefined): boolean {
  if (value === undefined) return false
  const normalized = value.trim().toLowerCase()
  return normalized !== '' && normalized !== '0' && normalized !== 'false'
}

function resolveOptOutReasons(
  env: Readonly<Record<string, string | undefined>>,
  config: AnalyticsOptOutConfig | undefined,
): AnalyticsOptOutReason[] {
  const reasons: AnalyticsOptOutReason[] = []
  if (isDoNotTrack(env.DO_NOT_TRACK)) reasons.push('do-not-track')
  if (config?.analytics?.privacy === true) reasons.push('config-privacy')
  return reasons
}

export function composeAnalytics<TEvent extends AnalyticsEventEnvelope = AnalyticsEventEnvelope>(
  options: ComposeAnalyticsOptions = {},
): ComposedAnalytics<TEvent> {
  const optOutReasons = resolveOptOutReasons(options.env ?? {}, options.config)
  const optedOut = optOutReasons.length > 0

  // The whole decision, in one expression, before any transport exists. Note what is NOT reachable
  // from the deny arm: not the override, not the factory, not the project key. A transport built on
  // this arm cannot send because it is a `NoopTransport`, and no other transport was built.
  const { transport, transportKind } = optedOut
    ? { transport: new NoopTransport() as AnalyticsTransport, transportKind: 'noop' as const }
    : enabledTransport(options)

  return {
    port: createAnalyticsPort<TEvent>({
      transport,
      identity: options.identity ?? resolveAnonymousIdentity,
    }),
    transport,
    optedOut,
    optOutReasons,
    transportKind,
  }
}

/**
 * The opted-in arm.
 *
 * An empty project key lands on the noop transport too, and that is NOT an opt-out: the committed
 * key file ships blank and the release pipeline fills it, so every developer checkout would
 * otherwise construct a client with a blank key and report itself as a user who declined tracking.
 * The two states are reported separately for exactly that reason.
 */
function enabledTransport(options: ComposeAnalyticsOptions): {
  transport: AnalyticsTransport
  transportKind: AnalyticsTransportKind
} {
  if (options.transportOverride) {
    return { transport: options.transportOverride, transportKind: 'posthog' }
  }

  const projectKey = (options.projectKey ?? AGENT_QA_POSTHOG_KEY).trim()
  if (projectKey === '') {
    return { transport: new NoopTransport(), transportKind: 'noop' }
  }

  const factory = options.posthogTransportFactory ?? createPosthogTransport
  return {
    transport: factory({
      projectKey,
      host: options.projectHost ?? AGENT_QA_POSTHOG_HOST,
      disableGeoip: false,
    }),
    transportKind: 'posthog',
  }
}
