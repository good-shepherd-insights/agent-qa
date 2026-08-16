// The two transports (Phase 398 plan 03, D-17 / D-19 · ANLY-01).
//
// NEITHER TRANSPORT READS THE ENVIRONMENT, and neither one decides anything. That is the whole
// content of D-19 at this layer: by the time a transport exists, the opt-out question has already
// been answered in `compose.ts`, and the answer is expressed by WHICH of these two objects was
// constructed. A `disabled` flag checked inside a send path — the v1 shape — leaves a live PostHog
// client sitting in the process one branch away from firing.
//
// There is no module-level state in this file. Every value a transport needs arrives through its
// constructor argument.

import { PostHog } from 'posthog-node'
import type { PostHogOptions } from 'posthog-node'
import type { AnalyticsCapturePayload, AnalyticsTransport } from './port.js'

/**
 * Records nothing and counts calls.
 *
 * The counters are the point: "opted out" has to be observable as ZERO send attempts rather than as
 * an absent assertion, and a transport that silently discards is indistinguishable from a transport
 * nobody called. Plan 06's network differential asserts the same claim one layer down, at the
 * socket; this one lets a composition-level cell see it without a wire at all.
 */
export class NoopTransport implements AnalyticsTransport {
  captureCount = 0
  flushCount = 0
  shutdownCount = 0

  capture(): void {
    this.captureCount += 1
  }

  flush(): void {
    this.flushCount += 1
  }

  shutdown(): void {
    this.shutdownCount += 1
  }
}

/** The subset of the PostHog client this transport uses. */
export interface PosthogAnalyticsClient {
  capture(input: {
    distinctId: string
    event: string
    properties: Record<string, unknown>
  }): void
  shutdown(): void | Promise<void>
}

export interface PosthogTransportOptions {
  readonly projectKey: string
  readonly host: string
  readonly disableGeoip?: boolean
  /**
   * posthog-node's own `fetch` option, passed straight through.
   *
   * 2026-08-17 (Phase 398 plan 03): this exists for plan 06's sandboxed-sink arm of the zero-network
   * differential. posthog-node 5.33.2 sends through `this.options.fetch ?? fetch`, so injecting here
   * observes the SHIPPED send path rather than a parallel one built for the test — which is the
   * difference between measuring the product and measuring the fixture.
   */
  readonly fetch?: PostHogOptions['fetch']
  /** An already-constructed client, for tests that need to observe construction itself. */
  readonly client?: PosthogAnalyticsClient
}

class PosthogTransport implements AnalyticsTransport {
  private readonly client: PosthogAnalyticsClient

  constructor(options: PosthogTransportOptions) {
    this.client = options.client ?? new PostHog(options.projectKey, {
      host: options.host,
      disableGeoip: options.disableGeoip ?? false,
      ...(options.fetch ? { fetch: options.fetch } : {}),
    })
  }

  capture(payload: AnalyticsCapturePayload): void {
    const properties: Record<string, unknown> = { ...payload.event.properties }
    if (payload.isInternal === true) {
      properties.$set = { is_internal: true }
    }

    this.client.capture({
      distinctId: payload.distinctId,
      event: payload.event.name,
      properties,
    })
  }

  async flush(): Promise<void> {
    await this.client.shutdown()
  }

  async shutdown(): Promise<void> {
    await this.client.shutdown()
  }
}

export function createPosthogTransport(options: PosthogTransportOptions): AnalyticsTransport {
  return new PosthogTransport(options)
}

/** The factory shape `composeAnalytics` calls, so a cell can spy on whether it was called at all. */
export type PosthogTransportFactory = (options: PosthogTransportOptions) => AnalyticsTransport
