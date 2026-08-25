import { describe, it, expect } from 'vitest'
import type { LiveFrame } from '@vostride/agent-qa-schema'
import type { LiveStreamCapability } from '../../platform.js'
import {
  createLiveStreamHub,
  LIVE_STREAM_ACK_BOUND_MS,
  LIVE_STREAM_STOP_GRACE_MS,
} from '../live-stream-hub.js'
import type { RunTimerPort } from '../ports.js'

/**
 * A MULTI-SLOT fake timer. The `run-cancel.test.ts` fake holds ONE pending callback, which is
 * enough for the run budget but not here: the hub arms an ack bound per in-flight frame AND a stop
 * grace, so a single-slot fake would silently drop whichever was armed first and the cells would be
 * measuring the fake, not the hub. Callbacks are keyed by the delay they were scheduled with, so a
 * cell fires exactly the timer it means (`fire(LIVE_STREAM_STOP_GRACE_MS)`), never "the latest".
 */
interface FakeTimer extends RunTimerPort {
  fire(delayMs: number): number
  pending(delayMs: number): number
}

function makeFakeTimer(): FakeTimer {
  let nextId = 1
  const scheduled = new Map<number, { delayMs: number; fn: () => void }>()
  return {
    schedule(delayMs: number, fn: () => void) {
      const id = nextId++
      scheduled.set(id, { delayMs, fn })
      return () => {
        scheduled.delete(id)
      }
    },
    now: () => 1_700_000_000_000,
    fire(delayMs: number): number {
      const due = [...scheduled.entries()].filter(([, entry]) => entry.delayMs === delayMs)
      for (const [id, entry] of due) {
        scheduled.delete(id)
        entry.fn()
      }
      return due.length
    },
    pending(delayMs: number): number {
      return [...scheduled.values()].filter((entry) => entry.delayMs === delayMs).length
    },
  }
}

interface FakeCapability extends LiveStreamCapability {
  readonly calls: string[]
  readonly acked: number[]
  emit(frame: LiveFrame): void
}

function makeFakeCapability(): FakeCapability {
  const calls: string[] = []
  const acked: number[] = []
  let sink: ((frame: LiveFrame) => void) | undefined
  return {
    kind: 'cdp-screencast',
    calls,
    acked,
    async start(onFrame) {
      calls.push('start')
      sink = onFrame
    },
    async ack(frameId) {
      calls.push(`ack:${frameId}`)
      acked.push(frameId)
    },
    async stop() {
      calls.push('stop')
      sink = undefined
    },
    emit(frame) {
      sink?.(frame)
    },
  }
}

function frame(id: number): LiveFrame {
  return { id, bytes: new Uint8Array([id, 0xff, 0xd8]), metadata: { width: 320, height: 240 } }
}

/** Let the hub's internal `start()` promise settle before asserting on `calls`. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe('createLiveStreamHub (403 D-05/D-07)', () => {
  it('(a) never starts the producer while nobody is watching', async () => {
    const timer = makeFakeTimer()
    const capability = makeFakeCapability()
    const hub = createLiveStreamHub({ timer })
    hub.register(0, capability)
    await settle()
    expect(capability.calls, 'a registered-but-unwatched stream is real work nobody asked for')
      .toEqual([])
    expect(hub.capabilityOf(0)).toEqual({ kind: 'cdp-screencast' })
  })

  it('(b) starts exactly once for the first viewer and never again for later ones', async () => {
    const timer = makeFakeTimer()
    const capability = makeFakeCapability()
    const hub = createLiveStreamHub({ timer })
    hub.register(0, capability)
    const first = hub.subscribe(0, () => {})
    await settle()
    expect(capability.calls.filter((c) => c === 'start')).toHaveLength(1)
    const second = hub.subscribe(0, () => {})
    await settle()
    expect(
      capability.calls.filter((c) => c === 'start'),
      'ONE screencast per handle — a per-viewer start is the defect this cell exists for',
    ).toHaveLength(1)
    expect(first).toBeDefined()
    expect(second).toBeDefined()
  })

  it('(c) delivers each frame to every current subscriber with identical id and bytes', async () => {
    const timer = makeFakeTimer()
    const capability = makeFakeCapability()
    const hub = createLiveStreamHub({ timer })
    hub.register(0, capability)
    const a: LiveFrame[] = []
    const b: LiveFrame[] = []
    hub.subscribe(0, (f) => a.push(f))
    hub.subscribe(0, (f) => b.push(f))
    await settle()
    capability.emit(frame(7))
    expect(a).toHaveLength(1)
    expect(b).toHaveLength(1)
    expect(a[0].id).toBe(7)
    expect(b[0].id).toBe(7)
    expect([...a[0].bytes]).toEqual([...b[0].bytes])
  })

  it('(d) acks the producer exactly once, after every subscriber has acked', async () => {
    const timer = makeFakeTimer()
    const capability = makeFakeCapability()
    const hub = createLiveStreamHub({ timer })
    hub.register(0, capability)
    const first = hub.subscribe(0, () => {})
    const second = hub.subscribe(0, () => {})
    await settle()
    capability.emit(frame(1))
    expect(capability.acked).toEqual([])
    first?.ack(1)
    expect(capability.acked, 'one viewer acking is not every viewer acking').toEqual([])
    second?.ack(1)
    expect(capability.acked).toEqual([1])
    first?.ack(1)
    second?.ack(1)
    expect(capability.acked, 'the producer is acked ONCE per frame').toEqual([1])
  })

  it('(e) acks after the bound when one subscriber never acks', async () => {
    const timer = makeFakeTimer()
    const capability = makeFakeCapability()
    const hub = createLiveStreamHub({ timer })
    hub.register(0, capability)
    const first = hub.subscribe(0, () => {})
    hub.subscribe(0, () => {})
    await settle()
    capability.emit(frame(4))
    first?.ack(4)
    expect(capability.acked).toEqual([])
    expect(timer.pending(LIVE_STREAM_ACK_BOUND_MS)).toBe(1)
    timer.fire(LIVE_STREAM_ACK_BOUND_MS)
    expect(capability.acked, 'ONE wedged viewer must not freeze the stream for the others')
      .toEqual([4])
  })

  it('(f) stops only after the grace, and a re-subscribe inside it cancels the stop', async () => {
    const timer = makeFakeTimer()
    const capability = makeFakeCapability()
    const hub = createLiveStreamHub({ timer })
    hub.register(0, capability)
    const only = hub.subscribe(0, () => {})
    await settle()
    only?.unsubscribe()
    await settle()
    expect(capability.calls, 'the last detach schedules the stop, it does not perform it')
      .not.toContain('stop')
    expect(timer.pending(LIVE_STREAM_STOP_GRACE_MS)).toBe(1)

    // A re-attach inside the grace: no stop, and no SECOND start.
    const reattached = hub.subscribe(0, () => {})
    await settle()
    expect(timer.pending(LIVE_STREAM_STOP_GRACE_MS), 'a re-subscribe CANCELS the pending stop')
      .toBe(0)
    expect(capability.calls.filter((c) => c === 'start')).toHaveLength(1)
    expect(capability.calls).not.toContain('stop')
    reattached?.unsubscribe()
  })

  it('(f2) the grace elapsing with nobody attached stops the producer', async () => {
    const timer = makeFakeTimer()
    const capability = makeFakeCapability()
    const hub = createLiveStreamHub({ timer })
    hub.register(0, capability)
    const only = hub.subscribe(0, () => {})
    await settle()
    only?.unsubscribe()
    expect(timer.fire(LIVE_STREAM_STOP_GRACE_MS)).toBe(1)
    await settle()
    expect(capability.calls).toContain('stop')
  })

  it('(g) withdrawing the capability mid-stream stops it and declares none', async () => {
    const timer = makeFakeTimer()
    const capability = makeFakeCapability()
    const hub = createLiveStreamHub({ timer })
    hub.register(0, capability)
    hub.subscribe(0, () => {})
    await settle()
    expect(capability.calls).toContain('start')
    hub.register(0, undefined)
    await settle()
    expect(capability.calls, 'a finished member takes its screencast down with it').toContain('stop')
    expect(hub.capabilityOf(0)).toEqual({ kind: 'none' })
    expect(hub.subscribe(0, () => {}), 'a withdrawn handle has nothing to subscribe to')
      .toBeUndefined()
  })

  it('(h) close() stops every started stream', async () => {
    const timer = makeFakeTimer()
    const one = makeFakeCapability()
    const two = makeFakeCapability()
    const three = makeFakeCapability()
    const hub = createLiveStreamHub({ timer })
    hub.register(0, one)
    hub.register(1, two)
    hub.register(2, three)
    hub.subscribe(0, () => {})
    hub.subscribe(1, () => {})
    await settle()
    await hub.close()
    expect(one.calls).toContain('stop')
    expect(two.calls).toContain('stop')
    expect(three.calls, 'a stream that never started has nothing to stop').not.toContain('stop')
    expect(hub.capabilityOf(0)).toEqual({ kind: 'none' })
  })

  it('an unregistered handle declares none and cannot be subscribed to', () => {
    const hub = createLiveStreamHub({ timer: makeFakeTimer() })
    expect(hub.capabilityOf(9)).toEqual({ kind: 'none' })
    expect(hub.subscribe(9, () => {})).toBeUndefined()
  })

  it('detaches a subscriber that throws and warns by code, leaving the others attached', async () => {
    const timer = makeFakeTimer()
    const capability = makeFakeCapability()
    const warnings: string[] = []
    const hub = createLiveStreamHub({ timer, onWarning: (code) => warnings.push(code) })
    hub.register(0, capability)
    const good: number[] = []
    hub.subscribe(0, () => {
      throw new Error('viewer exploded')
    })
    hub.subscribe(0, (f) => good.push(f.id))
    await settle()
    capability.emit(frame(2))
    expect(warnings).toContain('live-stream-subscriber-detached')
    expect(good).toEqual([2])
    capability.emit(frame(3))
    expect(good).toEqual([2, 3])
  })
})

// ---- 403-02 Task 1: THE N-VIEWER INVARIANT ------------------------------------------------------
//
// WHY A PROPERTY CELL AND NOT MORE EXAMPLES. Everything above is an EXAMPLE: one hand-picked order
// of attach/detach/frame/ack. D-07 and D-16 are not statements about an order — they are statements
// about ANY order ("N viewers attach and detach in any interleaving"), and a suite of hand-picked
// orders certifies exactly the orders somebody thought of. 403-01's own masking blocker was found
// only because that cell was parameterised over binder ORDER and the defect appeared in BOTH
// directions, each with a passing sibling assertion. So the interleaving is a real parameter here.
//
// THE MODEL IS THE SPEC, WRITTEN AS CODE. Every operation updates a tiny reference model — is the
// stream watched, which viewers are attached, which frames are owed by whom — and the cell asserts
// the hub's OBSERVED producer calls against it. A model this thin cannot drift into agreeing with
// the implementation by construction: it is written from D-07's sentence, and it says nothing about
// how the hub is built.

/** mulberry32 — a 32-bit PRNG in five lines. Seeded, so a failing interleaving is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Flush the microtask queue. The hub's start/stop reconciliation is a promise chain, so an
 * assertion made before it drains is an assertion about a half-applied operation. `setImmediate`
 * runs after ALL pending microtasks, which is what "the operation has landed" means here — and it
 * costs microseconds, which is what makes 200 interleavings a cell rather than a coffee break.
 */
const flush = (): Promise<void> => new Promise<void>((resolve) => { setImmediate(resolve) })

type HubOp =
  | { readonly kind: 'subscribe'; readonly viewer: number }
  | { readonly kind: 'unsubscribe'; readonly viewer: number }
  | { readonly kind: 'frame' }
  | { readonly kind: 'ack'; readonly viewer: number }
  | { readonly kind: 'grace' }
  | { readonly kind: 'ackBound' }

function randomOps(next: () => number, viewerCount: number, length: number): HubOp[] {
  const ops: HubOp[] = []
  for (let i = 0; i < length; i++) {
    const roll = next()
    const viewer = Math.floor(next() * viewerCount)
    if (roll < 0.28) ops.push({ kind: 'subscribe', viewer })
    else if (roll < 0.48) ops.push({ kind: 'unsubscribe', viewer })
    else if (roll < 0.72) ops.push({ kind: 'frame' })
    else if (roll < 0.88) ops.push({ kind: 'ack', viewer })
    else if (roll < 0.95) ops.push({ kind: 'grace' })
    else ops.push({ kind: 'ackBound' })
  }
  return ops
}

describe('the N-viewer invariant (403-02 · D-07/D-16 · LIVE-01)', () => {
  it('(i) 200 seeded interleavings over up to 6 viewers: one start and one stop per watched interval', async () => {
    // COVERAGE COUNTERS, asserted at the bottom. 200 green iterations prove nothing if every one of
    // them was a single viewer attaching once: a property cell whose generator never reaches the
    // interesting shapes is green at rest. These count the shapes the claim is ABOUT.
    let iterationsWithConcurrentViewers = 0
    let iterationsWithTwoIntervals = 0
    let framesSharedByTwoOrMore = 0

    for (let seed = 1; seed <= 200; seed++) {
      const next = mulberry32(seed)
      const viewerCount = 1 + Math.floor(next() * 6)
      const ops = randomOps(next, viewerCount, 14)

      const timer = makeFakeTimer()
      const capability = makeFakeCapability()
      const hub = createLiveStreamHub({ timer })
      hub.register(0, capability)

      // --- the reference model, written from D-07's sentence ---
      const attached = new Map<number, ReturnType<typeof hub.subscribe>>()
      const seenBy = new Map<number, number[]>()
      /** What the MODEL says each viewer must have seen — the frames emitted while it watched. */
      const expectedSeenBy = new Map<number, number[]>()
      /** frameId -> the viewers that still owe an ack. */
      const inFlight = new Map<number, Set<number>>()
      const expectedAcked: number[] = []
      let watched = false
      let expectedStarts = 0
      let expectedStops = 0
      let nextFrameId = 1
      let peakConcurrent = 0

      /** The grace elapsing with nobody attached ENDS the watched interval (D-07). */
      const endInterval = (): void => {
        watched = false
        expectedStops += 1
        // A stop drops every frame still in flight WITHOUT acking it — there is no producer left
        // to ack to. (The hub clears its ack bounds on the same reasoning.)
        inFlight.clear()
      }

      for (const op of ops) {
        if (op.kind === 'subscribe') {
          if (!attached.has(op.viewer)) {
            const viewer = op.viewer
            const subscription = hub.subscribe(0, (received) => {
              const log = seenBy.get(viewer) ?? []
              log.push(received.id)
              seenBy.set(viewer, log)
            })
            expect(subscription, `seed ${String(seed)}: a registered handle must be subscribable`)
              .toBeDefined()
            attached.set(viewer, subscription)
            peakConcurrent = Math.max(peakConcurrent, attached.size)
            if (!watched) { watched = true; expectedStarts += 1 }
          }
        } else if (op.kind === 'unsubscribe') {
          const subscription = attached.get(op.viewer)
          if (subscription !== undefined) {
            attached.delete(op.viewer)
            subscription.unsubscribe()
            // A detach counts as an ack for everything this viewer still owed.
            for (const [frameId, owing] of [...inFlight]) {
              if (!owing.delete(op.viewer)) continue
              if (owing.size === 0) { expectedAcked.push(frameId); inFlight.delete(frameId) }
            }
          }
        } else if (op.kind === 'frame') {
          const frameId = nextFrameId++
          capability.emit(frame(frameId))
          if (watched) {
            // EVERY viewer attached AT EMIT TIME sees this frame, and they all see the same id.
            const receivers = [...attached.keys()]
            for (const viewer of receivers) {
              const log = expectedSeenBy.get(viewer) ?? []
              log.push(frameId)
              expectedSeenBy.set(viewer, log)
            }
            if (receivers.length >= 2) framesSharedByTwoOrMore += 1
            if (receivers.length === 0) expectedAcked.push(frameId)
            else inFlight.set(frameId, new Set(receivers))
          }
        } else if (op.kind === 'ack') {
          const subscription = attached.get(op.viewer)
          if (subscription !== undefined) {
            const owed = [...inFlight.entries()].find(([, owing]) => owing.has(op.viewer))
            if (owed !== undefined) {
              const [frameId, owing] = owed
              subscription.ack(frameId)
              owing.delete(op.viewer)
              if (owing.size === 0) { expectedAcked.push(frameId); inFlight.delete(frameId) }
            }
          }
        } else if (op.kind === 'grace') {
          const fired = timer.fire(LIVE_STREAM_STOP_GRACE_MS)
          if (fired > 0 && attached.size === 0 && watched) endInterval()
        } else {
          const fired = timer.fire(LIVE_STREAM_ACK_BOUND_MS)
          if (fired > 0) {
            for (const [frameId] of [...inFlight]) expectedAcked.push(frameId)
            inFlight.clear()
          }
        }
        await flush()
      }

      // Settle: everyone leaves, the ack bound and the grace both elapse.
      for (const [viewer, subscription] of [...attached]) {
        attached.delete(viewer)
        subscription?.unsubscribe()
        for (const [frameId, owing] of [...inFlight]) {
          if (!owing.delete(viewer)) continue
          if (owing.size === 0) { expectedAcked.push(frameId); inFlight.delete(frameId) }
        }
      }
      await flush()
      if (timer.fire(LIVE_STREAM_ACK_BOUND_MS) > 0) {
        for (const [frameId] of [...inFlight]) expectedAcked.push(frameId)
        inFlight.clear()
      }
      await flush()
      if (timer.fire(LIVE_STREAM_STOP_GRACE_MS) > 0 && watched) endInterval()
      await flush()

      if (peakConcurrent >= 2) iterationsWithConcurrentViewers += 1
      if (expectedStarts >= 2) iterationsWithTwoIntervals += 1

      const label = `seed ${String(seed)} · viewers ${String(viewerCount)} · ${ops.map((o) => o.kind).join(',')}`
      expect(
        capability.calls.filter((call) => call === 'start').length,
        `${label}: ONE Page.startScreencast per watched interval — a per-viewer start is the defect`,
      ).toBe(expectedStarts)
      expect(
        capability.calls.filter((call) => call === 'stop').length,
        `${label}: ONE stop per watched interval, after the grace`,
      ).toBe(expectedStops)
      expect(capability.acked, `${label}: the producer is acked exactly once per delivered frame`)
        .toEqual(expectedAcked)
      // THE FAN-OUT: every viewer that was attached for a frame saw it, with the same id, in the
      // same order — "one stream, N viewers" in its observable form. A per-viewer screencast would
      // give each of them an independent id sequence and satisfy every count above.
      const viewers = [...new Set([...seenBy.keys(), ...expectedSeenBy.keys()])].sort()
      for (const viewer of viewers) {
        expect(
          seenBy.get(viewer) ?? [],
          `${label}: viewer ${String(viewer)} did not observe the stream's own frame sequence`,
        ).toEqual(expectedSeenBy.get(viewer) ?? [])
      }
    }

    // THE ANTI-VACUITY GUARD. If the generator stopped producing concurrent viewers, re-attachments
    // or shared frames, the 200 iterations above would still be green while measuring nothing that
    // D-07 is about.
    expect(iterationsWithConcurrentViewers, 'the generator never put two viewers on one handle')
      .toBeGreaterThan(20)
    expect(iterationsWithTwoIntervals, 'the generator never closed and re-opened a watched interval')
      .toBeGreaterThan(5)
    expect(framesSharedByTwoOrMore, 'no frame was ever fanned out to two viewers at once')
      .toBeGreaterThan(20)
  }, 60_000)


  it('(j) two handles: two starts, two stops, and frames never cross handles', async () => {
    const timer = makeFakeTimer()
    const zero = makeFakeCapability()
    const one = makeFakeCapability()
    const hub = createLiveStreamHub({ timer })
    hub.register(0, zero)
    hub.register(1, one)
    const seenZero: number[] = []
    const seenOne: number[] = []
    const a = hub.subscribe(0, (f) => seenZero.push(f.id))
    const b = hub.subscribe(0, (f) => seenZero.push(f.id))
    const c = hub.subscribe(1, (f) => seenOne.push(f.id))
    await flush()
    expect(zero.calls.filter((call) => call === 'start')).toHaveLength(1)
    expect(one.calls.filter((call) => call === 'start')).toHaveLength(1)

    zero.emit(frame(11))
    one.emit(frame(22))
    expect(seenZero, 'handle 0 sees handle 0 frames, twice — once per viewer').toEqual([11, 11])
    expect(seenOne, 'a handle-1 viewer must never see a handle-0 frame').toEqual([22])

    a?.unsubscribe(); b?.unsubscribe(); c?.unsubscribe()
    await flush()
    expect(timer.fire(LIVE_STREAM_STOP_GRACE_MS)).toBe(2)
    await flush()
    expect(zero.calls.filter((call) => call === 'stop')).toHaveLength(1)
    expect(one.calls.filter((call) => call === 'stop')).toHaveLength(1)
  })

  it('(k) a stop that lands while the START is still in flight leaves the hub honest', async () => {
    // THE RACE THE INVARIANT FOUND. `subscribe` kicks the producer off and returns before the
    // adapter's `start()` promise settles; a detach plus an elapsed grace inside that window asks
    // for a stop while the start is mid-air. If the two are not serialised, the start's own
    // continuation flips the hub's "running" bit back on AFTER the stop landed — and every viewer
    // that attaches later gets a hub that believes a stopped screencast is running, i.e. a live
    // view that is permanently blank with nothing anywhere reporting an error.
    const timer = makeFakeTimer()
    const capability = makeFakeCapability()
    const hub = createLiveStreamHub({ timer })
    hub.register(0, capability)

    const first = hub.subscribe(0, () => {})
    first?.unsubscribe()
    expect(timer.fire(LIVE_STREAM_STOP_GRACE_MS)).toBe(1)
    await flush()
    // An interval that opens and closes before the producer was ever asked is ELIDED — the
    // reconciler sees `desired === running === false` and makes no call at all. That is D-07 in its
    // strongest form (a screencast nobody watched is never started), and the one thing it must
    // never be is HALF applied: a start with no stop leaves a screencast running for nobody.
    expect(
      capability.calls.filter((call) => call === 'start').length,
      'at most one start for an interval that closed before the producer was asked',
    ).toBeLessThanOrEqual(1)
    expect(
      capability.calls.filter((call) => call === 'stop').length,
      'a start that happened must have been stopped — never a screencast left running for nobody',
    ).toBe(capability.calls.filter((call) => call === 'start').length)

    const seen: number[] = []
    const second = hub.subscribe(0, (f) => seen.push(f.id))
    await flush()
    expect(
      capability.calls.filter((call) => call === 'start').length,
      'the NEXT viewer opens a new watched interval — a hub that thinks the stopped producer is '
      + 'still running never restarts it and serves a blank preview forever',
    ).toBeGreaterThanOrEqual(1)
    expect(
      capability.calls[capability.calls.length - 1],
      'and the producer is left RUNNING for that viewer, not stopped',
    ).toBe('start')
    capability.emit(frame(5))
    expect(seen, 'and that viewer actually receives frames').toEqual([5])
    second?.unsubscribe()
  })

  it('(l) when the LAST viewer is detached by throwing, the producer does not keep running for nobody', async () => {
    // D-07's zero-cost claim has a back door: a viewer removed by `deliver`'s throw path never
    // calls `unsubscribe`, so nothing schedules the stop. An unwatched screencast is exactly the
    // work D-07 exists to refuse.
    const timer = makeFakeTimer()
    const capability = makeFakeCapability()
    const warnings: string[] = []
    const hub = createLiveStreamHub({ timer, onWarning: (code) => warnings.push(code) })
    hub.register(0, capability)
    hub.subscribe(0, () => { throw new Error('the only viewer exploded') })
    await flush()
    capability.emit(frame(1))
    expect(warnings).toContain('live-stream-subscriber-detached')
    expect(
      timer.pending(LIVE_STREAM_STOP_GRACE_MS),
      'the throw path emptied the subscriber set, so the stop must be scheduled like any other '
      + 'last detach — otherwise the browser encodes JPEGs for nobody until the run ends',
    ).toBe(1)
    expect(timer.fire(LIVE_STREAM_STOP_GRACE_MS)).toBe(1)
    await flush()
    expect(capability.calls).toContain('stop')
  })

  it('(m) a throwing viewer counts as ACKED for the frame it threw on', async () => {
    const timer = makeFakeTimer()
    const capability = makeFakeCapability()
    const hub = createLiveStreamHub({ timer })
    hub.register(0, capability)
    hub.subscribe(0, () => { throw new Error('viewer exploded') })
    const good = hub.subscribe(0, () => {})
    await flush()
    capability.emit(frame(9))
    expect(capability.acked, 'the survivor has not acked yet').toEqual([])
    good?.ack(9)
    expect(
      capability.acked,
      'a detached viewer cannot ack, so it must not be counted as owing one — otherwise the '
      + 'producer waits out the whole ack bound on every frame',
    ).toEqual([9])
    expect(timer.pending(LIVE_STREAM_ACK_BOUND_MS), 'and the bound timer is cancelled, not left armed')
      .toBe(0)
  })

  it('(n) the ack bound is cancelled the moment the last viewer acks — never a second ack', async () => {
    const timer = makeFakeTimer()
    const capability = makeFakeCapability()
    const hub = createLiveStreamHub({ timer })
    hub.register(0, capability)
    const a = hub.subscribe(0, () => {})
    const b = hub.subscribe(0, () => {})
    const c = hub.subscribe(0, () => {})
    await flush()
    capability.emit(frame(3))
    expect(timer.pending(LIVE_STREAM_ACK_BOUND_MS)).toBe(1)
    a?.ack(3); b?.ack(3)
    expect(capability.acked).toEqual([])
    c?.ack(3)
    expect(capability.acked, 'the third ack completes the quorum immediately').toEqual([3])
    expect(timer.pending(LIVE_STREAM_ACK_BOUND_MS), 'the bound timer is cancelled by the quorum')
      .toBe(0)
    expect(timer.fire(LIVE_STREAM_ACK_BOUND_MS)).toBe(0)
    expect(capability.acked, 'and no second ack can arrive from a timer nobody cancelled')
      .toEqual([3])
  })

  it('(o) close() while a grace timer is pending stops once, clears it, and refuses later subscribers', async () => {
    const timer = makeFakeTimer()
    const capability = makeFakeCapability()
    const hub = createLiveStreamHub({ timer })
    hub.register(0, capability)
    const only = hub.subscribe(0, () => {})
    await flush()
    only?.unsubscribe()
    expect(timer.pending(LIVE_STREAM_STOP_GRACE_MS)).toBe(1)
    await hub.close()
    expect(capability.calls.filter((call) => call === 'stop'), 'exactly one stop, not two')
      .toHaveLength(1)
    expect(
      timer.pending(LIVE_STREAM_STOP_GRACE_MS),
      'a grace timer left armed past close() is a callback holding a closed hub',
    ).toBe(0)
    expect(hub.subscribe(0, () => {}), 'a closed hub hands out no subscriptions').toBeUndefined()
    expect(timer.fire(LIVE_STREAM_STOP_GRACE_MS)).toBe(0)
    expect(capability.calls.filter((call) => call === 'stop')).toHaveLength(1)
  })

  it('(p) register() twice for one handle replaces the capability and stops the started one', async () => {
    const timer = makeFakeTimer()
    const first = makeFakeCapability()
    const second = makeFakeCapability()
    const hub = createLiveStreamHub({ timer })
    hub.register(0, first)
    hub.subscribe(0, () => {})
    await flush()
    expect(first.calls).toContain('start')

    hub.register(0, second)
    await flush()
    expect(first.calls, 'the replaced capability is stopped — a re-registered handle leaves no '
      + 'orphan screencast running in the browser').toContain('stop')
    expect(second.calls, 'and the replacement is not started until somebody watches it').toEqual([])
    expect(hub.capabilityOf(0)).toEqual({ kind: 'cdp-screencast' })

    const viewer = hub.subscribe(0, () => {})
    await flush()
    expect(second.calls.filter((call) => call === 'start')).toHaveLength(1)
    viewer?.unsubscribe()
  })

  it('(q) registering the SAME capability object again is a no-op, not a restart', async () => {
    const timer = makeFakeTimer()
    const capability = makeFakeCapability()
    const hub = createLiveStreamHub({ timer })
    hub.register(0, capability)
    hub.subscribe(0, () => {})
    await flush()
    hub.register(0, capability)
    await flush()
    expect(capability.calls.filter((call) => call === 'start')).toHaveLength(1)
    expect(capability.calls, 'an idempotent re-register must not tear a live stream down')
      .not.toContain('stop')
  })
})
