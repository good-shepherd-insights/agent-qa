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

/** One handle's stream state. `started` flips once; `pendingStop` is the live grace handle. */
interface StreamState {
  capability: LiveStreamCapability
  subscribers: Set<Subscriber>
  started: boolean
  starting?: Promise<void>
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

  function deliver(state: StreamState, frame: LiveFrame): void {
    // Snapshot so a mid-delivery detach (or a subscriber that unsubscribes from its own callback)
    // cannot disturb the walk — the `bus.ts:125-139` shape.
    const receivers = [...state.subscribers]
    const outstanding = new Set<Subscriber>()
    for (const subscriber of receivers) {
      if (!state.subscribers.has(subscriber)) continue
      try {
        subscriber.onFrame(frame)
        if (state.subscribers.has(subscriber)) outstanding.add(subscriber)
      } catch {
        state.subscribers.delete(subscriber)
        warn('live-stream-subscriber-detached', 'live-frame subscriber threw during delivery and was detached')
      }
    }
    if (outstanding.size === 0) {
      // Nobody is left to ack — keep the producer moving rather than stalling on an empty set.
      void state.capability.ack(frame.id).catch(() => {})
      return
    }
    const cancel = timer.schedule(ackBoundMs, () => {
      // THE ACK BOUND: one wedged viewer must not freeze the stream for the others.
      settleFrame(state, frame.id)
    })
    state.awaiting.set(frame.id, { outstanding, cancel })
  }

  function startIfNeeded(state: StreamState): void {
    if (state.pendingStop) {
      // A re-subscribe inside the grace window CANCELS the stop; the producer never restarted.
      state.pendingStop()
      state.pendingStop = undefined
    }
    if (state.started || state.starting) return
    state.starting = state.capability
      .start((frame) => deliver(state, frame))
      .then(() => {
        state.started = true
        state.starting = undefined
      })
      .catch((error: unknown) => {
        state.starting = undefined
        warn(
          'live-stream-start-failed',
          `live stream failed to start: ${error instanceof Error ? error.message : String(error)}`,
        )
      })
  }

  function stopNow(state: StreamState): Promise<void> {
    state.pendingStop = undefined
    for (const [, entry] of state.awaiting) entry.cancel()
    state.awaiting.clear()
    if (!state.started && !state.starting) return Promise.resolve()
    const pending = state.starting ?? Promise.resolve()
    state.started = false
    return pending
      .then(() => state.capability.stop())
      .catch((error: unknown) => {
        warn(
          'live-stream-stop-failed',
          `live stream failed to stop: ${error instanceof Error ? error.message : String(error)}`,
        )
      })
  }

  function scheduleStop(state: StreamState): void {
    state.pendingStop?.()
    const cancel = timer.schedule(graceMs, () => {
      state.pendingStop = undefined
      if (state.subscribers.size > 0) return
      void stopNow(state)
    })
    state.pendingStop = cancel
  }

  return {
    register(handle, capability): void {
      const existing = streams.get(handle)
      if (capability === undefined) {
        // The member finished (or declares nothing): stop whatever was running and declare `none`.
        streams.delete(handle)
        if (existing) void stopNow(existing)
        return
      }
      if (existing && existing.capability === capability) return
      if (existing) void stopNow(existing)
      streams.set(handle, {
        capability,
        subscribers: new Set<Subscriber>(),
        started: false,
        awaiting: new Map(),
      })
    },

    subscribe(handle, onFrame): LiveFrameSubscription | undefined {
      if (closed) return undefined
      const state = streams.get(handle)
      if (!state) return undefined
      const subscriber: Subscriber = { onFrame }
      state.subscribers.add(subscriber)
      startIfNeeded(state)
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
        pending.push(stopNow(state))
      }
      streams.clear()
      await Promise.all(pending)
    },
  }
}
