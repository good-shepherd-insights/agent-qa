// EXEC-01..04 requirement roll-call (Phase 359, Plan 09 close-out).
// A single durable regression anchor: each phase acceptance criterion maps to at least one
// GREEN assertion here over the SHIPPED runner compound surface — the pure comparators/loops
// (../../compound/{fill-verify,scroll-until-visible,app-resolution,idempotency}), the dispatch
// seam short-circuit (../index executeStep), and the frozen tool catalog (../../tools). This is
// NOT a re-implementation; the per-plan suites (compound/__tests__/*, loop/__tests__/idempotency,
// packages/{web,android,ios} compound.test.ts) own the exhaustive matrices. Do NOT weaken any
// assertion to force a pass; if a criterion cannot be proven green, the phase is not done.
// Mirrors the 356-07 / 357-08 / 358-09 roll-call idiom (one describe per requirement, direct
// assertions over the shipped surface, plus a delegate source-anchor for the three adapter legs).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

import type { ScreenState } from '@vostride/agent-qa-schema'

import type { PlatformAdapter, Action, ActionResult } from '../../platform.js'
import type { LoopPorts } from '../ports.js'

import { compareFillReread } from '../../compound/fill-verify.js'
import {
  runUntilVisibleLoop,
  type ScrollPrimitives,
  type Direction,
} from '../../compound/scroll-until-visible.js'
import type { InterimNode } from '../../screen-builder.js'
import { resolveAppName } from '../../compound/app-resolution.js'
import { executeStep } from '../index.js'
import { buildAgentScreenState } from './screen-fixtures.js'
import { makeActionPlan, makeStepContext, makeVerifier, makePlanner } from './loop-harness.js'
import { ToolRegistry } from '../../tools/registry.js'
import { registerAllActions } from '../../tools/actions/index.js'

const testFilePath = fileURLToPath(import.meta.url)
// __tests__ -> loop -> src -> runner -> packages
const packagesRoot = resolve(dirname(testFilePath), '..', '..', '..', '..')

function node(name: string, opts: Partial<InterimNode> = {}): InterimNode {
  return { role: 'text', name, ...opts }
}

function ports(overrides: Partial<LoopPorts> & Pick<LoopPorts, 'adapter' | 'planner'>): LoopPorts {
  return overrides
}

// -----------------------------------------------------------------------------
// EXEC-01 — atomic Fill with a verified re-read (clear→type→re-read→(Enter))
// -----------------------------------------------------------------------------
describe('EXEC-01 — Fill executes as one atomic compound producing a single ActionResult with a verified field re-read', () => {
  it('a genuine value-loss mismatch is an honest failure verdict with the byte-pinned fillReread shape and a §7.1 self-correcting error', () => {
    const miss = compareFillReread({ expected: 'hello', actual: 'helo', secure: false })
    expect(miss.ok).toBe(false)
    // The 358-pinned seam: metadata.fillReread = { expected, actual }, both strings, never nested.
    expect(miss.meta).toEqual({ expected: 'hello', actual: 'helo' })
    expect(Object.keys(miss.meta).sort()).toEqual(['actual', 'expected'])
    expect(miss.selfCorrectingError).toContain('re-observe and retry')
  })

  it('auto-formatting inputs pass on the normalized re-compare (a card number the field re-groups is not a loss)', () => {
    const formatted = compareFillReread({ expected: '4242424242424242', actual: '4242 4242 4242 4242', secure: false })
    expect(formatted.ok).toBe(true)
    expect(formatted.selfCorrectingError).toBeUndefined()
  })

  it('secure fields verify non-emptiness only and NEVER echo the raw value (T-359-02 masking)', () => {
    const secure = compareFillReread({ expected: 'topSecretPw', actual: 'topSecretPw', secure: true })
    expect(secure.ok).toBe(true)
    expect(secure.meta.expected).not.toContain('topSecret')
    expect(secure.meta.actual).not.toContain('topSecret')
    // An empty secure re-read (nothing landed) still fails honestly.
    expect(compareFillReread({ expected: 'topSecretPw', actual: '', secure: true }).ok).toBe(false)
  })

  it('the three adapter compound suites pin the clear→type→re-read→(Enter) order per platform (delegate source anchor, 358-09 WM-02 idiom)', () => {
    for (const pkg of ['web', 'android', 'ios']) {
      const suite = readFileSync(resolve(packagesRoot, pkg, 'src', '__tests__', 'compound.test.ts'), 'utf8')
      expect(suite).toContain('EXEC-01 fill compound')
      // Each adapter proves the re-read happens (web inputValue / android getText / ios getAttribute value).
      expect(suite).toMatch(/re-read/i)
    }
  })
})

// -----------------------------------------------------------------------------
// EXEC-02 — scroll-until-visible: executor-owned loop with a real progress signal
// -----------------------------------------------------------------------------
function scrollPrimitives(trees: () => InterimNode[], swipeLog?: Direction[]): ScrollPrimitives {
  return {
    async swipeOnce(direction: Direction) {
      swipeLog?.push(direction)
    },
    async readInterimTree() {
      return trees()
    },
  }
}

describe('EXEC-02 — untilVisible re-observes between ≤maxSwipes swipes and terminates on target-visible / no-change / cap', () => {
  it('terminates found the moment the target appears in the re-read tree', async () => {
    let call = 0
    const prims = scrollPrimitives(() => {
      call += 1
      return call === 1 ? [node('Row A'), node('Row B')] : [node('Row A'), node('Settings')]
    })
    const r = await runUntilVisibleLoop(prims, { target: 'Settings', direction: 'down', maxSwipes: 5, retryOpposite: false })
    expect(r.found).toBe(true)
    expect(r.meta.outcome).toBe('found')
    expect(r.meta.swipes).toBe(1)
    // D-04 meta key set is exactly the ScrollUntilVisibleMeta contract.
    expect(Object.keys(r.meta).sort()).toEqual(['outcome', 'reversedOnce', 'swipes'])
  })

  it('an unchanging tree with no target terminates no-change at the swipe budget (never progressed)', async () => {
    const SAME = [node('Row A'), node('Row B')]
    const r = await runUntilVisibleLoop(scrollPrimitives(() => SAME), {
      target: 'Nope',
      direction: 'down',
      maxSwipes: 3,
      retryOpposite: false,
    })
    expect(r.found).toBe(false)
    expect(r.meta.outcome).toBe('no-change')
    expect(r.meta.swipes).toBe(3)
    expect(r.meta.reversedOnce).toBe(false)
  })

  it('a progressing-but-never-found scroll terminates cap (progressed, hit the budget)', async () => {
    let n = 0
    const r = await runUntilVisibleLoop(scrollPrimitives(() => { n += 1; return [node(`Row ${n}`)] }), {
      target: 'Nope',
      direction: 'down',
      maxSwipes: 3,
      retryOpposite: false,
    })
    expect(r.found).toBe(false)
    expect(r.meta.outcome).toBe('cap')
    expect(r.meta.swipes).toBe(3)
  })

  it('a stall with retryOpposite flips direction exactly once (single reversal self-heal)', async () => {
    const SAME = [node('Row A')]
    const dirs: Direction[] = []
    const r = await runUntilVisibleLoop(scrollPrimitives(() => SAME, dirs), {
      target: 'Nope',
      direction: 'down',
      maxSwipes: 4,
      retryOpposite: true,
    })
    expect(r.meta.reversedOnce).toBe(true)
    expect(dirs[0]).toBe('down')
    expect(dirs).toContain('up') // flipped after the first no-progress swipe
  })
})

// -----------------------------------------------------------------------------
// EXEC-03 — openApp name→bundle resolution: never a silent wrong-app launch
// -----------------------------------------------------------------------------
describe('EXEC-03 — resolveAppName climbs exact → fuzzy(+margin) → ambiguous/unknown, never a coin-flip launch', () => {
  const REGISTRY = [
    { id: 'com.google.android.calendar' },
    { id: 'com.spotify.music' },
    { id: 'com.android.chrome' },
  ]

  it('an id segment resolves exact', () => {
    const r = resolveAppName('calendar', REGISTRY)
    expect(r).toEqual({ kind: 'exact', id: 'com.google.android.calendar' })
  })

  it('a clear misspelling that leads the field by the margin resolves fuzzy to a single id', () => {
    const r = resolveAppName('calender', REGISTRY)
    expect(r.kind).toBe('fuzzy')
    expect(r).toMatchObject({ id: 'com.google.android.calendar' })
  })

  it('a near-tie yields ambiguous candidates, NOT a winner (never a coin-flip)', () => {
    const r = resolveAppName('mial', [{ id: 'com.foo.mail' }, { id: 'com.bar.mail' }])
    expect(r.kind).toBe('ambiguous')
    expect(r).not.toHaveProperty('id')
    if (r.kind === 'ambiguous') expect(r.candidates.length).toBeGreaterThanOrEqual(2)
  })

  it('an unknown name yields structured unknown candidates, never a silent launch', () => {
    const r = resolveAppName('zzzzzzzz', REGISTRY)
    expect(r.kind).toBe('unknown')
    expect(r).not.toHaveProperty('id')
    if (r.kind === 'unknown') expect(Array.isArray(r.candidates)).toBe(true)
  })
})

// -----------------------------------------------------------------------------
// EXEC-04 — toggle/picker idempotency at the dispatch seam
// -----------------------------------------------------------------------------
function recordingAdapter(observation: ScreenState, calls: Action[]): PlatformAdapter {
  return {
    platform: 'web',
    async setup() {},
    async cleanup() {},
    async observe() {
      return observation
    },
    async execute(action: Action): Promise<ActionResult> {
      calls.push(action)
      return { success: true }
    },
  }
}

interface LooseSub {
  result?: { metadata?: Record<string, unknown> }
  localEffect?: { achieved?: boolean }
}

describe('EXEC-04 — a satisfied desiredState no-ops at the dispatch seam without calling adapter.execute', () => {
  it('a checked toggle with desiredState=checked mints success + idempotentNoop and the tap oracle reads it as effect-achieved', async () => {
    const observation = buildAgentScreenState({
      url: 'https://x.test/settings',
      elements: [{ ref: 'e1', role: 'checkbox', name: 'Wi-Fi', state: { checked: true }, bounds: { x: 20, y: 80, width: 300, height: 44 } }],
      metadata: { coordSpace: 'viewport', viewportWidth: 390, viewportHeight: 844 },
    })
    const calls: Action[] = []
    const adapter = recordingAdapter(observation, calls)
    const plans = [makeActionPlan({ action: { type: 'tap', ref: 'e1', desiredState: 'checked' }, stepComplete: true })]

    const result = await executeStep(
      'Ensure Wi-Fi is on',
      ports({ adapter, planner: makePlanner(plans), verifier: makeVerifier(), plannerConfig: { maxSubActions: 4, previousStepCount: 0 } }),
      makeStepContext(),
    )

    expect(result.status).toBe('passed')
    // D-14: the check runs at the ONE chokepoint before adapter.execute ⇒ zero adapter calls.
    expect(calls.length).toBe(0)
    // D-16: the minted no-op carries metadata.idempotentNoop.currentState ...
    const sub = (result.evidence as { subActions?: LooseSub[] } | undefined)?.subActions?.[0]
    const noop = sub?.result?.metadata?.['idempotentNoop'] as { currentState?: unknown } | undefined
    expect(noop).toBeDefined()
    expect(noop?.currentState).toBeDefined()
    // ... and the tap oracle reads it as effect-achieved (no stagnation increment).
    expect(sub?.localEffect?.achieved).toBe(true)
  })
})

// -----------------------------------------------------------------------------
// Frozen catalog — the phase's desiredState is a PARAM on an existing tool (counts unchanged)
// -----------------------------------------------------------------------------
describe('frozen tool catalog — EXEC compounds register no tools', () => {
  it('keeps 56 registered / web 33 / android 30 / ios 27', () => {
    const registry = new ToolRegistry()
    registerAllActions(registry)
    expect(registry.getAll()).toHaveLength(56)
    expect(registry.getForPlatform('web')).toHaveLength(33)
    expect(registry.getForPlatform('android')).toHaveLength(30)
    expect(registry.getForPlatform('ios')).toHaveLength(27)
  })
})
