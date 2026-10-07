// Scroll loops over injected primitives (EXEC-02; 436-02 · D-24/D-25 · spec §12.12). Every fake
// swipe reports a scripted SwipeSignal and every interim-tree read returns a scripted tree, so the
// cells can hold movement evidence and visible content apart: the tree decides target visibility
// only, never movement, end, reversal or retry. All fakes resolve immediately; no timers.
import { describe, it, expect } from 'vitest'
import type { InterimNode } from '@vostride/agent-qa-runner'
import {
  runUntilVisibleLoop,
  runDirectionScroll,
  runToEndScroll,
  swipeSignalFromOffsets,
} from '../scroll-until-visible.js'
import type { ScrollPrimitives, SwipeSignal, Direction } from '../scroll-until-visible.js'

interface FakeCalls {
  swipes: Direction[]
  natives: { target: string; direction?: string }[]
  reads: number
}

// Trees are consumed one per read (the first read is the initial probe); signals one per swipe.
// The last entry of each repeats once exhausted.
function makeFakePrimitives(opts: {
  trees: InterimNode[][]
  signals?: SwipeSignal[]
  native?: (target: string) => boolean
}): { p: ScrollPrimitives; calls: FakeCalls } {
  const calls: FakeCalls = { swipes: [], natives: [], reads: 0 }
  const signals = opts.signals ?? ['moved']
  const p: ScrollPrimitives = {
    async swipeOnce(direction: Direction): Promise<SwipeSignal> {
      const signal = signals[Math.min(calls.swipes.length, signals.length - 1)]
      calls.swipes.push(direction)
      return signal
    },
    ...(opts.native
      ? {
          async nativeSearchScroll(target: string, _ref?: string, direction?: Direction): Promise<boolean> {
            calls.natives.push({ target, direction })
            return opts.native!(target)
          },
        }
      : {}),
    async readInterimTree(): Promise<InterimNode[]> {
      const idx = Math.min(calls.reads, opts.trees.length - 1)
      calls.reads += 1
      return opts.trees[idx]
    },
  }
  return { p, calls }
}

const node = (role: string, name: string, extra: Partial<InterimNode> = {}): InterimNode => ({
  role,
  name,
  ...extra,
})

const TARGET = 'Save changes'
const withTarget: InterimNode[] = [node('button', 'Save changes')]
const SAME: InterimNode[] = [node('text', 'Row A'), node('text', 'Row B')]

describe('C436-SCROLL — no identity-driven reversal, end or retry (D-24/D-25)', () => {
  it('a same-hash scroll keeps going forward', async () => {
    const { p, calls } = makeFakePrimitives({ trees: [SAME], signals: ['moved'] })
    const r = await runUntilVisibleLoop(p, { target: TARGET, direction: 'down', maxSwipes: 5, retryOpposite: false })
    expect(r.found).toBe(false)
    expect(r.meta).toEqual({ swipes: 5, reversedOnce: false, outcome: 'unresolved', endedBy: 'max-swipes' })
    expect(calls.swipes).toEqual(['down', 'down', 'down', 'down', 'down'])
  })

  it('an unrelated update is not movement', async () => {
    let tick = 0
    const calls: Direction[] = []
    const p: ScrollPrimitives = {
      async swipeOnce(direction) {
        calls.push(direction)
        return 'unknown'
      },
      async readInterimTree() {
        tick += 1
        return [node('timer', `12:00:0${tick}`), node('text', 'Row A')]
      },
    }
    const r = await runUntilVisibleLoop(p, { target: TARGET, direction: 'down', maxSwipes: 4, retryOpposite: false })
    expect(r.found).toBe(false)
    expect(r.meta).toEqual({ swipes: 4, reversedOnce: false, outcome: 'unresolved', endedBy: 'max-swipes' })
    expect(calls).toEqual(['down', 'down', 'down', 'down'])
  })

  it('retryOpposite reverses once after maxSwipes without the target', async () => {
    const { p, calls } = makeFakePrimitives({ trees: [SAME], signals: ['moved'] })
    const r = await runUntilVisibleLoop(p, { target: TARGET, direction: 'down', maxSwipes: 3, retryOpposite: true })
    expect(r.found).toBe(false)
    expect(calls.swipes).toEqual(['down', 'down', 'down', 'up', 'up', 'up'])
    expect(r.meta).toEqual({ swipes: 6, reversedOnce: true, outcome: 'unresolved', endedBy: 'max-swipes' })
  })

  it('retryOpposite reverses once on an at-boundary signal', async () => {
    const reverseReveals = [SAME, SAME, SAME, withTarget]
    const { p, calls } = makeFakePrimitives({ trees: reverseReveals, signals: ['moved', 'at-boundary', 'moved'] })
    const r = await runUntilVisibleLoop(p, { target: TARGET, direction: 'down', maxSwipes: 5, retryOpposite: true })
    expect(calls.swipes).toEqual(['down', 'down', 'up'])
    expect(r.found).toBe(true)
    expect(r.meta).toEqual({ swipes: 3, reversedOnce: true, outcome: 'found', endedBy: 'target-visible' })
  })

  it('two boundaries without the target end not-found', async () => {
    const { p, calls } = makeFakePrimitives({ trees: [SAME], signals: ['moved', 'at-boundary', 'moved', 'at-boundary'] })
    const r = await runUntilVisibleLoop(p, { target: TARGET, direction: 'down', maxSwipes: 5, retryOpposite: true })
    expect(calls.swipes).toEqual(['down', 'down', 'up', 'up'])
    expect(r.meta).toEqual({ swipes: 4, reversedOnce: true, outcome: 'not-found', endedBy: 'boundary' })
  })

  it('one boundary and one exhausted budget stay unresolved', async () => {
    const { p } = makeFakePrimitives({ trees: [SAME], signals: ['at-boundary', 'unknown'] })
    const r = await runUntilVisibleLoop(p, { target: TARGET, direction: 'down', maxSwipes: 2, retryOpposite: true })
    expect(r.meta).toEqual({ swipes: 3, reversedOnce: true, outcome: 'unresolved', endedBy: 'max-swipes' })
  })

  it('a boundary without retryOpposite ends not-found without reversing', async () => {
    const { p, calls } = makeFakePrimitives({ trees: [SAME], signals: ['at-boundary'] })
    const r = await runUntilVisibleLoop(p, { target: TARGET, direction: 'down', maxSwipes: 5, retryOpposite: false })
    expect(calls.swipes).toEqual(['down'])
    expect(r.meta).toEqual({ swipes: 1, reversedOnce: false, outcome: 'not-found', endedBy: 'boundary' })
  })

  it('the target becoming visible ends the search found with endedBy target-visible', async () => {
    const { p, calls } = makeFakePrimitives({ trees: [SAME, SAME, SAME, withTarget], signals: ['unknown'] })
    const r = await runUntilVisibleLoop(p, { target: TARGET, direction: 'down', maxSwipes: 8, retryOpposite: true })
    expect(r.found).toBe(true)
    expect(r.meta).toEqual({ swipes: 3, reversedOnce: false, outcome: 'found', endedBy: 'target-visible' })
    expect(calls.reads).toBe(4)
  })

  it('direction mode is one gesture', async () => {
    for (const signal of ['moved', 'at-boundary', 'unknown'] as const) {
      const { p, calls } = makeFakePrimitives({ trees: [SAME], signals: [signal] })
      const r = await runDirectionScroll(p, { direction: 'down' })
      expect(calls.swipes).toEqual(['down'])
      expect(calls.reads).toBe(0)
      expect(r.meta).toEqual({
        swipes: 1,
        reversedOnce: false,
        outcome: 'unresolved',
        endedBy: signal === 'at-boundary' ? 'boundary' : 'max-swipes',
      })
    }
    // A planner call that still carries retryOpposite reaches the same single gesture.
    const { p, calls } = makeFakePrimitives({ trees: [SAME], signals: ['unknown'] })
    await runDirectionScroll(p, { direction: 'up', retryOpposite: true } as Parameters<typeof runDirectionScroll>[1])
    expect(calls.swipes).toEqual(['up'])
  })

  it('runToEndScroll stops on at-boundary, otherwise at the cap as unresolved', async () => {
    const atEnd = makeFakePrimitives({ trees: [SAME], signals: ['moved', 'moved', 'at-boundary'] })
    const ended = await runToEndScroll(atEnd.p, 'down')
    expect(atEnd.calls.swipes).toHaveLength(3)
    expect(atEnd.calls.reads).toBe(0)
    expect(ended.meta).toEqual({ swipes: 3, reversedOnce: false, outcome: 'found', endedBy: 'boundary' })

    const noSignal = makeFakePrimitives({ trees: [SAME], signals: ['unknown'] })
    const capped = await runToEndScroll(noSignal.p, 'down')
    expect(noSignal.calls.swipes).toHaveLength(20)
    expect(capped.meta).toEqual({ swipes: 20, reversedOnce: false, outcome: 'unresolved', endedBy: 'max-swipes' })

    const moving = makeFakePrimitives({ trees: [SAME], signals: ['moved'] })
    const short = await runToEndScroll(moving.p, 'up', undefined, 4)
    expect(short.meta).toEqual({ swipes: 4, reversedOnce: false, outcome: 'unresolved', endedBy: 'max-swipes' })
  })
})

describe('runUntilVisibleLoop — native rung and visibility probe', () => {
  it('prefers native search-scroll: zero blind swipes when the native rung reveals the target', async () => {
    const { p, calls } = makeFakePrimitives({ trees: [SAME, withTarget], native: () => true })
    const r = await runUntilVisibleLoop(p, { target: TARGET, direction: 'down', maxSwipes: 5, retryOpposite: false })
    expect(r.found).toBe(true)
    expect(r.meta).toEqual({ swipes: 0, reversedOnce: false, outcome: 'found', endedBy: 'target-visible' })
    expect(calls.swipes.length).toBe(0)
    expect(calls.natives).toEqual([{ target: TARGET, direction: 'down' }])
  })

  it('a native rung that reports true without the target visible is not trusted', async () => {
    const { p, calls } = makeFakePrimitives({ trees: [SAME], signals: ['moved'], native: () => true })
    const r = await runUntilVisibleLoop(p, { target: TARGET, direction: 'down', maxSwipes: 2, retryOpposite: false })
    expect(r.found).toBe(false)
    expect(calls.swipes).toEqual(['down', 'down'])
    expect(r.meta.outcome).toBe('unresolved')
  })

  it('visibility is a normalized accessible-name contains-match that skips state.visible === false nodes', async () => {
    const hidden = [node('button', 'Save changes', { state: { visible: false } })]
    const { p } = makeFakePrimitives({ trees: [hidden] })
    const r = await runUntilVisibleLoop(p, { target: TARGET, direction: 'down', maxSwipes: 2, retryOpposite: false })
    expect(r.found).toBe(false)

    const spaced = [node('button', '  SAVE   changes now')]
    const found = await runUntilVisibleLoop(makeFakePrimitives({ trees: [spaced] }).p, {
      target: TARGET,
      direction: 'down',
      maxSwipes: 2,
      retryOpposite: false,
    })
    expect(found.meta).toEqual({ swipes: 0, reversedOnce: false, outcome: 'found', endedBy: 'target-visible' })
  })
})

describe('swipeSignalFromOffsets — the offset rule', () => {
  it('a changed offset is moved', () => {
    expect(swipeSignalFromOffsets('down', { before: 0, after: 720, max: 3000 })).toBe('moved')
    expect(swipeSignalFromOffsets('up', { before: 720, after: 0, max: 3000 })).toBe('moved')
  })

  it('an unchanged offset at the extent in the swiped direction is at-boundary', () => {
    expect(swipeSignalFromOffsets('down', { before: 3000, after: 3000, max: 3000 })).toBe('at-boundary')
    expect(swipeSignalFromOffsets('right', { before: 499.5, after: 499.5, max: 500 })).toBe('at-boundary')
    expect(swipeSignalFromOffsets('up', { before: 0, after: 0, max: 3000 })).toBe('at-boundary')
    expect(swipeSignalFromOffsets('left', { before: 0, after: 0, max: 0 })).toBe('at-boundary')
  })

  it('an unchanged offset away from the extent, or no offsets, is unknown', () => {
    expect(swipeSignalFromOffsets('down', { before: 0, after: 0, max: 3000 })).toBe('unknown')
    expect(swipeSignalFromOffsets('up', { before: 3000, after: 3000, max: 3000 })).toBe('unknown')
    expect(swipeSignalFromOffsets('down', undefined)).toBe('unknown')
    expect(swipeSignalFromOffsets('down', { before: Number.NaN, after: 0, max: 10 })).toBe('unknown')
  })
})
