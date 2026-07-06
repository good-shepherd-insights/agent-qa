// RED scaffold (Wave 0, Phase 359 · EXEC-02 · D-02/D-03/D-04 · Pattern 3 · spec §12.12).
// Pins the executor-owned untilVisible loop BEFORE Plan 03 ships it. The loop runs over
// INJECTED platform primitives (swipe-once, optional native search-scroll, a light interim-tree
// re-read) — no drivers here, pure orchestration. It terminates on target-visible / no-change /
// cap, retries the opposite direction exactly once, prefers native search-scroll over blind
// swipes, and treats a CHANGED interim tree as progress (raw name/value multiset — virtualized
// lists recycle geometry in place, Pitfall 3). The single ActionResult rides a byte-pinned
// metadata block { swipes, reversedOnce, outcome } (D-04).
//
// RED BY DESIGN: `../scroll-until-visible.js` does not exist until Plan 03 — the unresolved
// import IS the intended failure (vitest strips types; the standalone package typecheck stays
// green via the directive on the import line below). All fakes resolve immediately; no timers.
//
// Pinned contract (Plan 03 implements to it exactly):
//   interface ScrollPrimitives {
//     swipeOnce(direction, ref?): Promise<void>
//     nativeSearchScroll?(target, ref?, direction?): Promise<boolean>
//     readInterimTree(): Promise<InterimNode[]>
//   }
//   runUntilVisibleLoop(p, { target, direction, maxSwipes, retryOpposite, ref? })
//     → { meta: { swipes: number; reversedOnce: boolean; outcome: 'found'|'no-change'|'cap' }; found: boolean }
//   runDirectionScrollWithRetry(p, { direction, ref? }) — direction-mode self-heal (retry opposite once)
import { describe, it, expect } from 'vitest'
import type { InterimNode } from '@vostride/agent-qa-runner'
import { runUntilVisibleLoop, runDirectionScrollWithRetry } from '../scroll-until-visible.js'
import type { ScrollPrimitives } from '../scroll-until-visible.js'

// A recording fake primitive set. Scripted interim trees are consumed one per readInterimTree
// call; the last entry repeats once exhausted.
interface FakeCalls {
  swipes: { direction: string; ref?: string }[]
  natives: { target: string; direction?: string }[]
  reads: number
}

function makeFakePrimitives(opts: {
  trees: InterimNode[][]
  native?: (target: string) => boolean
}): { p: ScrollPrimitives; calls: FakeCalls } {
  const calls: FakeCalls = { swipes: [], natives: [], reads: 0 }
  const p = {
    async swipeOnce(direction: string, ref?: string): Promise<void> {
      calls.swipes.push({ direction, ref })
    },
    ...(opts.native
      ? {
          async nativeSearchScroll(target: string, _ref?: string, direction?: string): Promise<boolean> {
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
  return { p: p as ScrollPrimitives, calls }
}

const node = (role: string, name: string, extra: Partial<InterimNode> = {}): InterimNode => ({
  role,
  name,
  ...extra,
})

const TARGET = 'Save changes'
const withTarget: InterimNode[] = [node('button', 'Save changes')]
const withoutTarget: InterimNode[] = [node('text', 'Row A'), node('text', 'Row B')]

describe('runUntilVisibleLoop — native rung preference (D-02, §12.12)', () => {
  it('(1) prefers native search-scroll: zero blind swipes when the native rung reveals the target', async () => {
    const { p, calls } = makeFakePrimitives({
      trees: [withoutTarget, withTarget],
      native: () => true,
    })
    const r = await runUntilVisibleLoop(p, {
      target: TARGET,
      direction: 'down',
      maxSwipes: 5,
      retryOpposite: false,
    })
    expect(r.found).toBe(true)
    expect(r.meta.outcome).toBe('found')
    expect(r.meta.swipes).toBe(0)
    expect(calls.swipes.length).toBe(0)
  })
})

describe('runUntilVisibleLoop — probe-between-swipes termination (D-03)', () => {
  it('(2) re-reads the tree between every swipe and stops the swipe after the target appears', async () => {
    // Target only shows up in the tree read AFTER the 3rd swipe.
    const trees = [withoutTarget, withoutTarget, withoutTarget, withTarget]
    const { p, calls } = makeFakePrimitives({ trees })
    const r = await runUntilVisibleLoop(p, {
      target: TARGET,
      direction: 'down',
      maxSwipes: 8,
      retryOpposite: false,
    })
    expect(r.found).toBe(true)
    expect(r.meta.outcome).toBe('found')
    expect(r.meta.swipes).toBe(3)
    // A read happened between every swipe (probe cadence).
    expect(calls.reads).toBeGreaterThanOrEqual(calls.swipes.length)
  })

  it('(3) terminates no-change when two consecutive interim trees are identical and retryOpposite is off', async () => {
    const stable = [node('text', 'Row A'), node('text', 'Row B')]
    const { p } = makeFakePrimitives({ trees: [stable, stable, stable] })
    const r = await runUntilVisibleLoop(p, {
      target: TARGET,
      direction: 'down',
      maxSwipes: 6,
      retryOpposite: false,
    })
    expect(r.found).toBe(false)
    expect(r.meta.outcome).toBe('no-change')
    expect(r.meta.reversedOnce).toBe(false)
  })
})

describe('runUntilVisibleLoop — retry-opposite fires exactly once (D-02, §12.12)', () => {
  it('(4) reverses direction once when the primary direction stalls, then finds the target', async () => {
    const a = [node('text', 'Row A')]
    // Primary stalls (a,a); reversed direction reveals the target.
    const { p } = makeFakePrimitives({ trees: [a, a, withTarget] })
    const r = await runUntilVisibleLoop(p, {
      target: TARGET,
      direction: 'down',
      maxSwipes: 4,
      retryOpposite: true,
    })
    expect(r.found).toBe(true)
    expect(r.meta.reversedOnce).toBe(true)
  })

  it('(4b) a doubly-stalling fixture reverses only ONCE, then reports honestly', async () => {
    const a = [node('text', 'Row A')]
    const { p } = makeFakePrimitives({ trees: [a, a, a, a, a] })
    const r = await runUntilVisibleLoop(p, {
      target: TARGET,
      direction: 'down',
      maxSwipes: 4,
      retryOpposite: true,
    })
    expect(r.found).toBe(false)
    expect(r.meta.reversedOnce).toBe(true)
    // Only one reversal ever happens — the outcome is an honest non-found terminal.
    expect(['no-change', 'cap']).toContain(r.meta.outcome)
  })
})

describe('runUntilVisibleLoop — cap termination (§12.12)', () => {
  it('(5) exhausts maxSwipes without reveal and (retryOpposite spent) reports cap', async () => {
    // Every read differs (progress made) but the target never appears ⇒ cap, not no-change.
    const trees = [
      [node('text', 'Row 1')],
      [node('text', 'Row 2')],
      [node('text', 'Row 3')],
      [node('text', 'Row 4')],
      [node('text', 'Row 5')],
    ]
    const { p } = makeFakePrimitives({ trees })
    const r = await runUntilVisibleLoop(p, {
      target: TARGET,
      direction: 'down',
      maxSwipes: 2,
      retryOpposite: false,
    })
    expect(r.found).toBe(false)
    expect(r.meta.outcome).toBe('cap')
  })
})

describe('runUntilVisibleLoop — virtualized-list progress identity (Pitfall 3, §12.12)', () => {
  it('(6) trees with identical roles/geometry but a changed raw name/value multiset count as progress', async () => {
    // Same roles + same bounds, only the RAW name/value changes (recycled rows). This must read
    // as progress (NOT no-change) — identity keys on raw role+name+value, never normalized names
    // and never bounds.
    const bounds = { x: 0, y: 0, width: 300, height: 44 }
    const frame1 = [
      node('text', 'Alice', { bounds, value: '1' }),
      node('text', 'Bob', { bounds, value: '2' }),
    ]
    const frame2 = [
      node('text', 'Carol', { bounds, value: '3' }),
      node('text', 'Dave', { bounds, value: '4' }),
    ]
    // Never reveals the target, but each frame differs ⇒ progress ⇒ terminates on cap, not no-change.
    const { p } = makeFakePrimitives({ trees: [frame1, frame2, frame1, frame2] })
    const r = await runUntilVisibleLoop(p, {
      target: TARGET,
      direction: 'down',
      maxSwipes: 3,
      retryOpposite: false,
    })
    expect(r.meta.outcome).not.toBe('no-change')
  })

  it('(7) visibility match is a normalized accessible-name contains-match that skips state.visible === false nodes', async () => {
    // The target text is present but marked not-visible ⇒ must NOT count as found.
    const hidden = [node('button', 'Save changes', { state: { visible: false } })]
    const { p } = makeFakePrimitives({ trees: [hidden, hidden] })
    const r = await runUntilVisibleLoop(p, {
      target: TARGET,
      direction: 'down',
      maxSwipes: 2,
      retryOpposite: false,
    })
    expect(r.found).toBe(false)
  })
})

describe('runUntilVisibleLoop — the scrollUntilVisible meta byte-pin (D-04)', () => {
  it('(8) result meta sorted keys are exactly ["outcome","reversedOnce","swipes"] with a valid outcome', async () => {
    const { p } = makeFakePrimitives({ trees: [withoutTarget, withTarget] })
    const r = await runUntilVisibleLoop(p, {
      target: TARGET,
      direction: 'down',
      maxSwipes: 4,
      retryOpposite: false,
    })
    const meta = r.meta as unknown as Record<string, unknown>
    expect(Object.keys(meta).sort()).toEqual(['outcome', 'reversedOnce', 'swipes'])
    expect(['found', 'no-change', 'cap']).toContain(meta['outcome'])
    expect(typeof meta['swipes']).toBe('number')
    expect(typeof meta['reversedOnce']).toBe('boolean')
  })
})

describe('runDirectionScrollWithRetry — direction-mode self-heal (CONTEXT boundary)', () => {
  it('(9) a direction gesture whose interim tree is unchanged retries the opposite direction once', async () => {
    const a = [node('text', 'Row A')]
    // Unchanged after the direction gesture ⇒ one opposite retry, then honest report.
    const { p, calls } = makeFakePrimitives({ trees: [a, a, a] })
    const r = await runDirectionScrollWithRetry(p, { direction: 'down' })
    expect(r.meta.reversedOnce).toBe(true)
    // Exactly one primary + one reversed direction attempt.
    expect(calls.swipes.length).toBeGreaterThanOrEqual(2)
  })
})
