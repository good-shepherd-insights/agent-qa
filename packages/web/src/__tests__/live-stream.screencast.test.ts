// THE CHANGE-DRIVEN PROPERTY, ON A REAL HEADLESS CHROMIUM (403-02 Task 3 · LIVE-01 · D-05).
//
// THE DISCRIMINATOR THIS FILE EXISTS FOR. "Frames arrived" is satisfied by
// `setInterval(() => page.screenshot())` just as well as by `Page.startScreencast`, and the two
// are different products: a poller costs a browser a full rasterise several times a second on
// every run forever, and it cannot tell a page that is changing from a page that is not. The
// property that separates them has a NEGATIVE ARM — a page that is not moving must produce
// (almost) nothing — so this file measures both arms, and the negative one is the one with teeth.
//
// K=5, ZERO TOLERATED FAILURES ON THE POSITIVE ARM. One green run is roughly 60% likely to hide a
// 40% flake (WINDOWS: "live gate k=1 hides flakes"), and the claim here is about a timing-shaped
// behaviour of a real compositor. Each iteration is a fresh `start`/`stop` on the same adapter and
// reports its own index on failure, so a flaky arm names the iteration rather than the suite.
//
// A MISSING CHROMIUM IS A RED, NEVER A SKIP. `dashboard-dom.test.ts`'s rule: a cell that skips
// itself when the browser is absent is a cell that is green on every machine that cannot run it.
//
// THIS FILE MUST NOT MOCK THE BROWSER DRIVER. `adapter.test.ts` mocks it at module scope, and a
// module mock is process-wide within a file — which is why this is a SEPARATE file rather than a
// describe block over there. There is nothing to measure about a screencast produced by a mock,
// and the absence of that mock here is itself an acceptance criterion of this plan.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { LiveFrame } from '@vostride/agent-qa-schema'

import { WebPlatformAdapter } from '../adapter.js'
import { startLiveStreamFixturePage } from './fixtures/live-stream-fixture-page.js'
import type { LiveStreamFixturePage } from './fixtures/live-stream-fixture-page.js'

const BROWSER_INSTALL_INSTRUCTION =
  'a real Chromium is required for the change-driven screencast cells: run '
  + '`pnpm exec playwright install chromium`. This is a RED, not a skip — a cell that skips itself '
  + 'when the browser is absent is green on every machine that cannot run it.'

/**
 * k = 5, and it is not negotiable downward. The loops below spell the literal rather than reading a
 * constant, so what a reader greps for and what the loop runs cannot drift apart; each arm asserts
 * its own count at the end, which is what stops a hand-edited bound from quietly shrinking k.
 */
const EXPECTED_ITERATIONS = 5
/** The positive arm's window and floor. */
const ANIMATED_WINDOW_MS = 3_000
const ANIMATED_MIN_FRAMES = 3
/**
 * The negative arm's window and ceiling.
 *
 * ONE frame is tolerated, and exactly one: CDP delivers an initial frame when a screencast starts,
 * which is the current paint rather than a change. Anything above that is a producer emitting
 * without the page having moved — i.e. polling. The measured counts for all five iterations are
 * printed by the cell, and this ceiling is NOT to be raised without a dated note saying what was
 * measured and why (403-02, plan decision A2).
 */
const STATIC_WINDOW_MS = 4_000
const STATIC_MAX_FRAMES = 1

let page: LiveStreamFixturePage | undefined

beforeAll(async () => {
  page = await startLiveStreamFixturePage()
}, 60_000)

afterAll(async () => {
  await page?.close().catch(() => undefined)
  page = undefined
})

const fixture = (): LiveStreamFixturePage => {
  expect(page, 'the fixture page never started').toBeDefined()
  return page as LiveStreamFixturePage
}

/** Bring up a real headless Chromium on the fixture page. A launch failure is reported as one. */
async function adapterOn(url: string): Promise<WebPlatformAdapter> {
  const adapter = new WebPlatformAdapter()
  try {
    await adapter.setup({ platform: 'web', browser: { name: 'chromium', headless: true } })
  } catch (error) {
    throw new Error(
      `${BROWSER_INSTALL_INSTRUCTION} underlying error: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  await adapter.execute({ type: 'navigate', to: 'url', url })
  return adapter
}

/** Collect frames for `windowMs`, acking each immediately — the change-driven contract's own ack. */
async function collect(
  capability: NonNullable<WebPlatformAdapter['liveStream']>,
  windowMs: number,
): Promise<LiveFrame[]> {
  const frames: LiveFrame[] = []
  await capability.start((frame) => {
    frames.push(frame)
    void capability.ack(frame.id)
  })
  await new Promise((resolve) => setTimeout(resolve, windowMs))
  await capability.stop()
  return frames
}

describe('WebPlatformAdapter.liveStream is CHANGE-DRIVEN, not polled (LIVE-01)', () => {
  it('POSITIVE ARM: an animating page produces frames, k=5, zero tolerated failures', async () => {
    const adapter = await adapterOn(`${fixture().url}?animate=1`)
    const counts: number[] = []
    try {
      const capability = adapter.liveStream
      expect(capability, 'a live Chromium adapter declares a screencast capability').toBeDefined()
      expect(capability?.kind).toBe('cdp-screencast')

      for (let k = 0; k < 5; k++) {
        const frames = await collect(capability as NonNullable<typeof capability>, ANIMATED_WINDOW_MS)
        counts.push(frames.length)
        expect(
          frames.length,
          `iteration ${String(k)}/5: an animating page produced ${String(frames.length)} frame(s) in `
          + `${String(ANIMATED_WINDOW_MS)} ms. counts so far = [${counts.join(', ')}]`,
        ).toBeGreaterThanOrEqual(ANIMATED_MIN_FRAMES)
        for (const [index, frame] of frames.entries()) {
          expect(
            [frame.bytes[0], frame.bytes[1]],
            `iteration ${String(k)} frame ${String(index)}: every frame is a JPEG (SOI FF D8)`,
          ).toEqual([0xFF, 0xD8])
          expect(frame.metadata.width, 'a frame carries the page\'s own geometry').toBeGreaterThan(0)
          expect(frame.metadata.height).toBeGreaterThan(0)
        }
        // FRAME IDS ARE THE ACK CORRELATION KEY — for the hub's `awaiting` map, for the wire's
        // `frame.id`/`ack.id` pair, and for the embed page's pending header. Two frames sharing an
        // id is not a cosmetic wart: the hub's second `awaiting.set(id, …)` overwrites the first,
        // orphaning its bound timer and dropping the outstanding set, so an ack lands on the wrong
        // frame and one frame is never acked at all.
        const ids = frames.map((frame) => frame.id)
        expect(
          new Set(ids).size,
          `iteration ${String(k)}: frame ids must be DISTINCT — they are the ack correlation key. `
          + `saw ${String(new Set(ids).size)} distinct id(s) across ${String(ids.length)} frames, `
          + `first few = [${ids.slice(0, 5).join(', ')}]`,
        ).toBe(ids.length)
        expect(
          ids,
          `iteration ${String(k)}: and they are monotonic, so a later frame is never mistaken for `
          + 'an earlier one',
        ).toEqual([...ids].sort((left, right) => left - right))
      }
      expect(counts, 'both arms run k=5 — a shrunken loop is a weaker claim, silently')
        .toHaveLength(EXPECTED_ITERATIONS)
      // eslint-disable-next-line no-console -- the A2 evidence the SUMMARY records
      console.log(`[403-02 A2] animated-arm frame counts over 5 iterations: ${counts.join(', ')}`)
    } finally {
      await adapter.cleanup().catch(() => undefined)
    }
  }, 180_000)

  it('NEGATIVE ARM: a STATIC page produces at most one frame, k=5 — the polling discriminator', async () => {
    // RED under `setInterval(page.screenshot)`: a poller keeps producing whether or not the page
    // has moved, so it would deliver ~20 frames into this window on every iteration.
    const adapter = await adapterOn(fixture().url)
    const counts: number[] = []
    try {
      const capability = adapter.liveStream
      expect(capability).toBeDefined()

      // Let the first paint settle so the window measures a page that is already static.
      await new Promise((resolve) => setTimeout(resolve, 1_000))

      for (let k = 0; k < 5; k++) {
        const frames = await collect(capability as NonNullable<typeof capability>, STATIC_WINDOW_MS)
        counts.push(frames.length)
        expect(
          frames.length,
          `iteration ${String(k)}/5: a page that is NOT MOVING produced ${String(frames.length)} `
          + `frame(s) in ${String(STATIC_WINDOW_MS)} ms. counts so far = [${counts.join(', ')}]. `
          + 'A producer that emits while nothing changes is a poller, which is the implementation '
          + 'LIVE-01 retires — do not raise this ceiling without a dated note saying what was '
          + 'measured and why.',
        ).toBeLessThanOrEqual(STATIC_MAX_FRAMES)
      }
      expect(counts, 'both arms run k=5 — a shrunken loop is a weaker claim, silently')
        .toHaveLength(EXPECTED_ITERATIONS)
      // eslint-disable-next-line no-console -- the A2 evidence the SUMMARY records
      console.log(`[403-02 A2] static-arm frame counts over 5 iterations: ${counts.join(', ')}`)
    } finally {
      await adapter.cleanup().catch(() => undefined)
    }
  }, 180_000)

  it('THE ACK IS THE THROTTLE: a viewer that never acks stops receiving frames (D-05/D-07)', async () => {
    // The change-driven contract has TWO halves and the arms above measure only one. This is the
    // other: CDP will not produce frame N+1 until N is acked, which is what makes the ack a real
    // backpressure signal rather than a formality — and what makes the hub's ack bound and the
    // proxy's slow-viewer drop mean something. Measured, because "the ack throttles" is exactly the
    // kind of claim that is true of the protocol and false of an implementation that forgot to send
    // one. A screenshot poller has no such half at all: it produces on a timer regardless.
    const adapter = await adapterOn(`${fixture().url}?animate=1`)
    try {
      const capability = adapter.liveStream as NonNullable<WebPlatformAdapter['liveStream']>

      const unacked: LiveFrame[] = []
      await capability.start((frame) => { unacked.push(frame) })
      await new Promise((resolve) => setTimeout(resolve, 3_000))
      await capability.stop()

      const acked: LiveFrame[] = []
      await capability.start((frame) => { acked.push(frame); void capability.ack(frame.id) })
      await new Promise((resolve) => setTimeout(resolve, 3_000))
      await capability.stop()

      expect(
        unacked.length,
        `a viewer that never acks received ${String(unacked.length)} frames in 3 s — the producer `
        + 'is meant to stall on the unacked frame, not keep encoding',
      ).toBeLessThan(10)
      expect(
        acked.length,
        `the same page with acks produced ${String(acked.length)} frames; without them `
        + `${String(unacked.length)}. If those are close, the ack is not the throttle and the `
        + 'backpressure the hub and the frame proxy are built on does not exist.',
      ).toBeGreaterThan(unacked.length * 5)
      // eslint-disable-next-line no-console -- the backpressure evidence the SUMMARY records
      console.log(`[403-02] ack backpressure: unacked=${String(unacked.length)} acked=${String(acked.length)} frames / 3 s`)
    } finally {
      await adapter.cleanup().catch(() => undefined)
    }
  }, 180_000)

  it('the capability getter\'s TWO gates are both measured: no page, and a non-chromium browser', async () => {
    // Gate 1: an adapter that has not been `setup()` has no page, so there is nothing to stream.
    const fresh = new WebPlatformAdapter()
    expect(
      fresh.liveStream,
      'a screencast needs a page; an adapter before setup() has none, and says so by absence',
    ).toBeUndefined()

    // Gate 2: the browser-name gate. Requested honestly: if a Firefox binary is present the gate is
    // measured on a REAL non-chromium adapter; if it is not, the cell still measures the other gate
    // rather than skipping — and NEVER pretends the browser was there.
    let firefox: WebPlatformAdapter | undefined
    try {
      const candidate = new WebPlatformAdapter()
      await candidate.setup({ platform: 'web', browser: { name: 'firefox', headless: true } })
      firefox = candidate
    } catch {
      firefox = undefined
    }
    if (firefox !== undefined) {
      try {
        expect(
          firefox.liveStream,
          'Page.startScreencast is a CDP call; a non-chromium target declares no stream rather '
          + 'than falling back to screenshots (D-08\'s honest absence)',
        ).toBeUndefined()
      } finally {
        await firefox.cleanup().catch(() => undefined)
      }
    }

    // And the positive half of gate 1: after a chromium setup, the capability is there.
    const chromium = await adapterOn(fixture().url)
    try {
      expect(chromium.liveStream, 'a set-up chromium adapter declares the screencast').toBeDefined()
      expect(chromium.liveStream?.kind).toBe('cdp-screencast')
    } finally {
      await chromium.cleanup().catch(() => undefined)
    }
  }, 180_000)

  it('cleanup() after start() stops the screencast — no later frames, no unhandled rejection', async () => {
    const rejections: unknown[] = []
    const probe = (reason: unknown): void => { rejections.push(reason) }
    process.on('unhandledRejection', probe)
    const adapter = await adapterOn(`${fixture().url}?animate=1`)
    const frames: LiveFrame[] = []
    try {
      const capability = adapter.liveStream as NonNullable<WebPlatformAdapter['liveStream']>
      await capability.start((frame) => {
        frames.push(frame)
        void capability.ack(frame.id)
      })
      await new Promise((resolve) => setTimeout(resolve, 1_500))
      expect(frames.length, 'the stream was running before cleanup').toBeGreaterThan(0)

      await adapter.cleanup()
      const seenAtCleanup = frames.length
      await new Promise((resolve) => setTimeout(resolve, 500))
      expect(
        frames.length,
        'the CDP session is detached with the browser, so no frame can arrive after cleanup',
      ).toBe(seenAtCleanup)
      // Acking after the stream is gone is expected traffic, not an error — and must not become an
      // unhandled rejection, which would take a whole run down long after the live view closed.
      await capability.ack(seenAtCleanup + 999)
      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(rejections, 'a stopped screencast must not leave a rejection nobody handles').toEqual([])
    } finally {
      process.off('unhandledRejection', probe)
      await adapter.cleanup().catch(() => undefined)
    }
  }, 180_000)
})
