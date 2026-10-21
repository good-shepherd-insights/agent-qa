// The one opt-out decision site. It is made once, before any transport exists, and its answer is
// the transport: opted out builds the noop transport and never the PostHog one.
// `analytics.privacy: true` is the only input (447-03, D-06).

import { createAnalyticsPort, resolveAnonymousIdentity } from './port.js'
import { createPosthogTransport, NoopTransport } from './transports.js'
import { AGENT_QA_POSTHOG_HOST, AGENT_QA_POSTHOG_KEY } from './posthog-project.js'
import type { AnalyticsMaskingContext } from './masking-seam.js'
import type {
  AnalyticsEventEnvelope,
  AnalyticsIdentityResolver,
  AnalyticsPort,
  AnalyticsTransport,
} from './port.js'
import type { PosthogTransportFactory } from './transports.js'

export type AnalyticsOptOutReason = 'config-privacy'

export type AnalyticsTransportKind = 'noop' | 'posthog'

export interface AnalyticsOptOutConfig {
  readonly analytics?: {
    readonly privacy?: boolean
  }
}

export interface ComposeAnalyticsOptions {
  readonly config?: AnalyticsOptOutConfig
  readonly identity?: AnalyticsIdentityResolver
  readonly projectKey?: string
  readonly projectHost?: string
  /**
   * The host's declared-secret mask, which the send seam applies (D-19, plan 06).
   *
   * It reaches only the opted-IN arm, and that is not a gap: the deny arm's transport sends nothing
   * at all, so there is no payload for a seam to stand in front of.
   */
  readonly maskingContext?: AnalyticsMaskingContext
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

export function composeAnalytics<TEvent extends AnalyticsEventEnvelope = AnalyticsEventEnvelope>(
  options: ComposeAnalyticsOptions = {},
): ComposedAnalytics<TEvent> {
  const optedOut = options.config?.analytics?.privacy === true
  const optOutReasons: AnalyticsOptOutReason[] = optedOut ? ['config-privacy'] : []

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
      ...(options.maskingContext ? { maskingContext: options.maskingContext } : {}),
    }),
    transportKind: 'posthog',
  }
}
