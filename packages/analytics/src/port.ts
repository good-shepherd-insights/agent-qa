// The analytics port (Phase 398 plan 03, D-17 / D-19 · ANLY-01).
//
// WHAT SURVIVED THE RE-DERIVATION, and what did not. The v1 module's transport split — a small
// `capture`/`flush` interface with a noop implementation and an injectable factory, every call
// wrapped best-effort — was the one part of it that was right, and it is carried over here
// deliberately. What is NOT carried: the `if (this.disabled) return` guard inside `capture()`, the
// per-instance privacy decision taken in the constructor, the module-level `defaultAnalyticsService`
// singleton, and the ambient `captureAnalytics`/`flushAnalytics` helpers that let any caller in the
// process reach telemetry without ever naming it as a dependency. The opt-out decision lives in
// `compose.ts` and nowhere else; there is no ambient anything here.
//
// WHY `capture` RETURNS `void`. A host emits an event on a path it does not want to await — a run
// finishing, a tool call returning. Making the caller await a telemetry write is how telemetry
// acquires the power to slow down or fail the thing it is measuring. The port takes the event,
// returns immediately, and keeps the resulting work internally so `flush()` has something to wait
// for. Nothing here throws: the port is the best-effort boundary, and the host side of it observes
// no exception even when every transport call rejects (T-398-08).

/**
 * The shape every member of the closed event union satisfies.
 *
 * The port is written against this rather than against the union itself so the transport layer
 * carries no knowledge of which events exist; `AnalyticsPort` is parameterised by the union at the
 * package surface, which is what keeps a non-member event from reaching `capture` at a call site.
 */
export interface AnalyticsEventEnvelope {
  readonly name: string
  readonly properties: Readonly<Record<string, AnalyticsPropertyValue>>
}

export type AnalyticsPropertyValue =
  | string
  | number
  | boolean
  | undefined
  | Readonly<Record<string, string | number | boolean | undefined>>

/** What a transport is handed: the event plus the identity it is attributed to. */
export interface AnalyticsCapturePayload {
  readonly distinctId: string
  readonly isInternal?: boolean
  readonly event: AnalyticsEventEnvelope
}

/**
 * The wire side. Implementations may be synchronous (noop, test sinks) or asynchronous (PostHog);
 * the port normalises both and swallows either one's failures.
 *
 * `flush` and `shutdown` are separate on purpose. A host flushes at natural boundaries — a run
 * ending, a command returning — and shuts down once, at exit; collapsing them means either a
 * process that leaks a live client or a mid-session teardown of the thing still being used.
 */
export interface AnalyticsTransport {
  capture(payload: AnalyticsCapturePayload): void | Promise<void>
  flush(): void | Promise<void>
  shutdown(): void | Promise<void>
}

/** Resolves the anonymous distinct id an event is attributed to. */
export type AnalyticsIdentityResolver = () => AnalyticsIdentity | Promise<AnalyticsIdentity>

export interface AnalyticsIdentity {
  readonly distinctId: string
  readonly isInternal?: boolean
}

export interface AnalyticsPort<TEvent extends AnalyticsEventEnvelope = AnalyticsEventEnvelope> {
  capture(event: TEvent): void
  flush(): Promise<void>
  shutdown(): Promise<void>
}

export interface AnalyticsPortOptions {
  readonly transport: AnalyticsTransport
  readonly identity: AnalyticsIdentityResolver
}

/**
 * The only `AnalyticsPort` implementation, and the best-effort boundary itself.
 *
 * EVERY method is wrapped. That is not defensive habit: this object is held by a CLI process, a
 * chat session and a daemon, and an unhandled rejection out of a telemetry write would surface as
 * the host crashing on something the user never asked for. Losing in-flight events instead is the
 * trade the whole package is built around.
 */
class BestEffortAnalyticsPort<TEvent extends AnalyticsEventEnvelope> implements AnalyticsPort<TEvent> {
  private readonly transport: AnalyticsTransport
  private readonly identity: AnalyticsIdentityResolver
  private inFlight: Promise<void>[] = []
  private capturedSinceFlush = 0

  constructor(options: AnalyticsPortOptions) {
    this.transport = options.transport
    this.identity = options.identity
  }

  capture(event: TEvent): void {
    try {
      this.capturedSinceFlush += 1
      // The `.catch` is attached in the same tick the promise is created, so a rejection can never
      // become an unhandled rejection even if `flush()` is never called.
      this.inFlight.push(
        (async () => {
          const identity = await this.identity()
          await this.transport.capture({
            distinctId: identity.distinctId,
            ...(identity.isInternal === true ? { isInternal: true } : {}),
            event,
          })
        })().catch(() => {}),
      )
    } catch {
      // Best-effort: a synchronous throw out of an identity resolver is a lost event, not a
      // host-visible failure.
    }
  }

  /**
   * EDGE ANLY-01/empty. A flush with nothing captured touches the transport at ALL — not "makes no
   * network call", but makes no call. The distinction matters because `flush` on the PostHog
   * transport is a send, so a host that flushes on every command return would otherwise poke the
   * wire once per invocation whether or not anything happened. Zero captures in, zero calls out,
   * and the promise still resolves.
   */
  async flush(): Promise<void> {
    try {
      const pending = this.inFlight
      const captured = this.capturedSinceFlush
      this.inFlight = []
      this.capturedSinceFlush = 0

      await Promise.all(pending)
      if (captured === 0) return
      await this.transport.flush()
    } catch {
      // Best-effort.
    }
  }

  /**
   * Shutdown always reaches the transport, even with an empty queue: it releases whatever the
   * transport holds (a PostHog client owns timers), and "release nothing" is cheap while "leak a
   * timer because the session happened to be silent" keeps a process alive.
   */
  async shutdown(): Promise<void> {
    try {
      await this.flush()
      await this.transport.shutdown()
    } catch {
      // Best-effort.
    }
  }
}

export function createAnalyticsPort<TEvent extends AnalyticsEventEnvelope = AnalyticsEventEnvelope>(
  options: AnalyticsPortOptions,
): AnalyticsPort<TEvent> {
  return new BestEffortAnalyticsPort<TEvent>(options)
}

/**
 * The identity stand-in for plan 03.
 *
 * 2026-08-17 (Phase 398 plan 03): the real store — `~/.agent-qa/analytics.json`, the `id-agent`
 * word id, the `XDG_DATA_HOME` override — re-homes from `core/src/analytics/identity.ts` in plan
 * 06, which owns that move and its carried-over cells. Until then the resolver is an explicit
 * injected dependency with a constant default, so the port's shape does not change when the real
 * one arrives and no host silently gets a different identity than it had.
 */
export const ANONYMOUS_ANALYTICS_IDENTITY: AnalyticsIdentity = { distinctId: 'anonymous' }

export const resolveAnonymousIdentity: AnalyticsIdentityResolver = () => ANONYMOUS_ANALYTICS_IDENTITY
