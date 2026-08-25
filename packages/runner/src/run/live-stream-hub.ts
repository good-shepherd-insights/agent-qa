// The per-run LIVE STREAM HUB (403 D-05/D-07). One screencast per HANDLE, refcounted across every
// viewer attached to that handle: the primary noun is the stream, and a viewer is a member of its
// subscriber set — never the identity. Storage-neutral like the bus beside it: the only clock is
// the injected `RunTimerPort`, and the hub holds the adapter's capability object and nothing else
// (no `Page`, no `CDPSession`, no host API — validate:arch).
//
// Why lazy + graced rather than always-on: a screencast is real work in the browser, so it must not
// run when nobody is watching (D-07), and a page reload / iframe re-attach must not tear the
// producer down and start it again a beat later — hence the stop GRACE, cancelled by a re-subscribe
// inside the window. The ack bound exists for the symmetric reason: CDP will not send frame N+1
// until frame N is acked, so ONE wedged viewer would freeze the stream for everyone. After
// `ackBoundMs` the hub acks on that viewer's behalf and the frames keep flowing.

import type { LiveFrame, LiveFrameSubscription, LiveStreamDeclaration } from '@vostride/agent-qa-schema'
import type { LiveStreamCapability } from '../platform.js'
import type { RunTimerPort } from './ports.js'

/** How long a handle's stream keeps running after its LAST viewer detaches (403 D-07). */
export const LIVE_STREAM_STOP_GRACE_MS = 2_000
/** How long the hub waits for every subscriber to ack a frame before acking on their behalf. */
export const LIVE_STREAM_ACK_BOUND_MS = 250

/** Default timer: the `bus.ts` idiom — unref'd so a pending grace never holds the process open. */
function defaultTimer(): RunTimerPort {
  return {
    schedule(delayMs: number, fn: () => void): () => void {
      const handle = setTimeout(fn, delayMs) as unknown as { unref?: () => void }
      handle.unref?.()
      return () => clearTimeout(handle as unknown as ReturnType<typeof setTimeout>)
    },
    now: () => Date.now(),
  }
}

export interface CreateLiveStreamHubOptions {
  timer?: RunTimerPort
  graceMs?: number
  ackBoundMs?: number
  onWarning?: (code: string, message: string) => void
}

/**
 * The run's frame fan-out. `register` is the PRODUCER side (the member executor hands its adapter's
 * capability in, and hands `undefined` in when the member finishes); `subscribe`/`capabilityOf` are
 * the CONSUMER side the `RunSession` exposes.
 */
export interface LiveStreamHub {
  register(handle: number, capability: LiveStreamCapability | undefined): void
  subscribe(handle: number, onFrame: (frame: LiveFrame) => void): LiveFrameSubscription | undefined
  capabilityOf(handle: number): LiveStreamDeclaration
  close(): Promise<void>
}

interface Subscriber {
  onFrame: (frame: LiveFrame) => void
}

/**
 * One handle's stream state.
 *
 * `desired` and `running` ARE SEPARATE ON PURPOSE, and keeping them separate is what makes the
 * "one start, one stop per watched interval" claim survive real async. `desired` is what the
 * SUBSCRIBER SET asks for and flips synchronously; `running` is what the PRODUCER is actually
 * doing and can only change inside the reconciler, which is serialised on `chain`. A single
 * `started` flag conflates the two, and 403-02's invariant found exactly what that costs: a stop
 * landing while `capability.start()` was still in flight let the start's own continuation flip the
 * flag back on AFTER the stop, so the hub believed a stopped screencast was running and never
 * restarted it for the next viewer — a live view permanently blank with nothing reporting an error.
 */
interface StreamState {
  capability: LiveStreamCapability
  subscribers: Set<Subscriber>
  /** What the subscriber set asks for. True on first attach; false when the grace elapses empty. */
  desired: boolean
  /** What the producer is actually doing, as the reconciler last left it. */
  running: boolean
  /** A reconcile pass is already queued; it will observe any later `desired` flip by itself. */
  reconciling: boolean
  /** Serialises every producer call, so a start and a stop can never be in flight together. */
  chain: Promise<void>
  pendingStop?: () => void
  /** frameId → the subscribers that have not yet acked it, plus its bound-timer cancel. */
  awaiting: Map<number, { outstanding: Set<Subscriber>; cancel: () => void }>
}

const NONE: LiveStreamDeclaration = { kind: 'none' }

export function createLiveStreamHub(opts: CreateLiveStreamHubOptions = {}): LiveStreamHub {
  const timer = opts.timer ?? defaultTimer()
  const graceMs = opts.graceMs ?? LIVE_STREAM_STOP_GRACE_MS
  const ackBoundMs = opts.ackBoundMs ?? LIVE_STREAM_ACK_BOUND_MS
  const onWarning = opts.onWarning
  const streams = new Map<number, StreamState>()
  let closed = false

  const warn = (code: string, message: string): void => {
    try {
      onWarning?.(code, message)
    } catch {
      /* a warning sink that throws must never take the stream down */
    }
  }

  const describe = (error: unknown): string =>
    error instanceof Error ? error.message : String(error)

  /** Ack a frame to the producer exactly once, then forget it. */
  function settleFrame(state: StreamState, frameId: number): void {
    const entry = state.awaiting.get(frameId)
    if (!entry) return
    state.awaiting.delete(frameId)
    entry.cancel()
    void state.capability.ack(frameId).catch(() => {
      // Acking a frame after the stream stopped is expected, not an error (D-07).
    })
  }

  /**
   * THE ONE PLACE `start` AND `stop` ARE CALLED. Queued on the state's own chain and looping until
   * `desired === running`, so a flip that arrives mid-await is picked up by the pass already in
   * flight rather than racing it.
   */
  function reconcile(state: StreamState): void {
    if (state.reconciling) return
    state.reconciling = true
    state.chain = state.chain.then(async () => {
      try {
        while (state.desired !== state.running) {
          if (state.desired) {
            state.running = true
            try {
              await state.capability.start((frame) => { deliver(state, frame) })
            } catch (error: unknown) {
              state.running = false
              warn('live-stream-start-failed', `live stream failed to start: ${describe(error)}`)
              break
            }
          } else {
            state.running = false
            try {
              await state.capability.stop()
            } catch (error: unknown) {
              warn('live-stream-stop-failed', `live stream failed to stop: ${describe(error)}`)
            }
          }
        }
      } finally {
        state.reconciling = false
      }
    })
  }

  /** Cancel a pending grace, if one is armed. Idempotent. */
  function cancelGrace(state: StreamState): void {
    const cancel = state.pendingStop
    state.pendingStop = undefined
    cancel?.()
  }

  /** End the watched interval NOW: drop the in-flight acks and ask the producer to stop. */
  function stopStream(state: StreamState): void {
    cancelGrace(state)
    for (const [, entry] of state.awaiting) entry.cancel()
    state.awaiting.clear()
    state.desired = false
    reconcile(state)
  }

  function scheduleStop(state: StreamState): void {
    cancelGrace(state)
    state.pendingStop = timer.schedule(graceMs, () => {
      state.pendingStop = undefined
      if (state.subscribers.size > 0) return
      stopStream(state)
    })
  }

  function deliver(state: StreamState, frame: LiveFrame): void {
    // Snapshot so a mid-delivery detach (or a subscriber that unsubscribes from its own callback)
    // cannot disturb the walk — the `bus.ts:125-139` shape.
    const receivers = [...state.subscribers]
    const outstanding = new Set<Subscriber>()
    let detached = false
    for (const subscriber of receivers) {
      if (!state.subscribers.has(subscriber)) continue
      try {
        subscriber.onFrame(frame)
        if (state.subscribers.has(subscriber)) outstanding.add(subscriber)
      } catch {
        state.subscribers.delete(subscriber)
        detached = true
        warn('live-stream-subscriber-detached', 'live-frame subscriber threw during delivery and was detached')
      }
    }
    if (outstanding.size === 0) {
      // Nobody is left to ack — keep the producer moving rather than stalling on an empty set.
      void state.capability.ack(frame.id).catch(() => {})
    } else {
      const cancel = timer.schedule(ackBoundMs, () => {
        // THE ACK BOUND: one wedged viewer must not freeze the stream for the others.
        settleFrame(state, frame.id)
      })
      state.awaiting.set(frame.id, { outstanding, cancel })
    }
    // THE THROW PATH IS A DETACH LIKE ANY OTHER. A viewer removed here never calls `unsubscribe`,
    // so without this the last viewer could leave by throwing and the browser would keep encoding
    // JPEGs for nobody until the run ended — the exact work D-07 exists to refuse.
    if (detached && state.subscribers.size === 0) scheduleStop(state)
  }

  return {
    register(handle, capability): void {
      const existing = streams.get(handle)
      if (capability === undefined) {
        // The member finished (or declares nothing): stop whatever was running and declare `none`.
        streams.delete(handle)
        if (existing) stopStream(existing)
        return
      }
      if (existing && existing.capability === capability) return
      if (existing) stopStream(existing)
      streams.set(handle, {
        capability,
        subscribers: new Set<Subscriber>(),
        desired: false,
        running: false,
        reconciling: false,
        chain: Promise.resolve(),
        awaiting: new Map(),
      })
    },

    subscribe(handle, onFrame): LiveFrameSubscription | undefined {
      if (closed) return undefined
      const state = streams.get(handle)
      if (!state) return undefined
      const subscriber: Subscriber = { onFrame }
      state.subscribers.add(subscriber)
      // A re-subscribe inside the grace window CANCELS the stop; the producer never restarted.
      cancelGrace(state)
      state.desired = true
      reconcile(state)
      let released = false
      const release = (): void => {
        if (released) return
        released = true
        state.subscribers.delete(subscriber)
        // An unsubscribe counts as acked for every frame this viewer still owed.
        for (const [frameId, entry] of [...state.awaiting]) {
          if (!entry.outstanding.delete(subscriber)) continue
          if (entry.outstanding.size === 0) settleFrame(state, frameId)
        }
        if (state.subscribers.size === 0) scheduleStop(state)
      }
      return {
        ack(frameId: number): void {
          const entry = state.awaiting.get(frameId)
          if (!entry) return
          entry.outstanding.delete(subscriber)
          if (entry.outstanding.size === 0) settleFrame(state, frameId)
        },
        unsubscribe: release,
      }
    },

    capabilityOf(handle): LiveStreamDeclaration {
      const state = streams.get(handle)
      if (!state) return NONE
      return { kind: state.capability.kind }
    },

    async close(): Promise<void> {
      closed = true
      const pending: Promise<void>[] = []
      for (const [, state] of streams) {
        state.subscribers.clear()
        stopStream(state)
        pending.push(state.chain)
      }
      streams.clear()
      await Promise.all(pending)
    },
  }
}
