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
