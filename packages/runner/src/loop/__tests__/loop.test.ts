// Ported v1 loop scenarios (core/src/agent/__tests__/{loop,trace,integration,capture-gate})
// re-run against the runner-owned executeStep. Scenarios that exercised deleted machinery
// (the consecutive-failure counter, memory ablation) are dropped (D-10). New locks: the
// cached-redacted-marker invalidation, hook-deny-before-execute, and trace===projectLegacyTrace.
import { describe, it, expect, vi } from 'vitest'
import type { ScreenState } from '@vostride/agent-qa-schema'
import type { PlatformAdapter, Action, ActionResult } from '../../platform.js'
import type { LoopPorts, ScreenshotCompressor } from '../ports.js'
import type { ActionPlanCache, CacheablePlannedAction, CachedPlanValue } from '../../cache/port.js'
import type { Planner, StepContext, Verifier } from '../types.js'
import { executeStep } from '../index.js'
import { projectLegacyTrace } from '../evidence.js'
import { createTimeoutAbortReason } from '../abort.js'
import { makeScreenState } from '../../testing/screen-fixtures.js'
import {
  makeActionPlan,
  makeAdapter,
  makePlanner,
  makeSafetyHooks,
  makeStepContext,
  makeVerifier,
} from './loop-harness.js'

function ports(overrides: Partial<LoopPorts> & Pick<LoopPorts, 'adapter' | 'planner'>): LoopPorts {
  return overrides
}

describe('executeStep — ported v1 scenarios', () => {
  it('happy path: observe → plan → execute → verify → passed', async () => {
    const result = await executeStep(
      'Click the Log in button',
      ports({ adapter: makeAdapter(), planner: makePlanner(), verifier: makeVerifier() }),
      makeStepContext(),
    )
    expect(result.status).toBe('passed')
    expect(result.name).toBe('Click the Log in button')
    expect(result.action).toEqual({ type: 'click', ref: 'e2' })
  })

  it('no verifier: uses ActionResult.success directly (trust the planner)', async () => {
    const result = await executeStep(
      'Click the Log in button',
      ports({ adapter: makeAdapter({ executeResult: { success: true } }), planner: makePlanner() }),
      makeStepContext(),
    )
    expect(result.status).toBe('passed')
  })

  it('duration tracking: StepResult.duration >= 0', async () => {
    const result = await executeStep('Test step', ports({ adapter: makeAdapter(), planner: makePlanner() }), makeStepContext())
    expect(result.duration).toBeGreaterThanOrEqual(0)
  })

  it('step context is passed to the planner', async () => {
    const plannerSpy = vi.fn().mockResolvedValue({ plan: makeActionPlan() })
    const planner: Planner = { plan: plannerSpy }
    const context = makeStepContext({
      testContext: 'This is a banking app',
      previousSteps: [{ instruction: 'Navigate to login', outcome: 'navigated' }],
    })
    await executeStep('Click the Log in button', ports({ adapter: makeAdapter(), planner }), context)
    expect(plannerSpy).toHaveBeenCalledOnce()
    const [step, , passed] = plannerSpy.mock.calls[0]
    expect(step).toBe('Click the Log in button')
    expect((passed as StepContext).testContext).toBe('This is a banking app')
  })

  it('routes context and tool_result through safety hooks; the async gate executes the ORIGINAL action (SEAM-03)', async () => {
    const executed: Action[] = []
    let plannerContext: string | undefined

    // Post-SEAM-03: the sync runToolCall dispatch call is superseded by the async gate, which
    // operates on the descriptor and NEVER swaps the executed action (Pitfall 4). runContext and
    // runToolResult are unchanged. The gate returns allow carrying the descriptor — ignored.
    const safetyHooks = makeSafetyHooks({
      runContext: (context) => ({ context: { ...(context as StepContext), testContext: 'rewritten by safety' } as typeof context }),
      runToolResult: (result) => ({ result: { ...(result as ActionResult), data: { rewrittenBySafety: true } } as typeof result }),
    })

    const adapter = makeAdapter()
    adapter.execute = async (action: Action) => { executed.push(action); return { success: true } }

    const planner: Planner = {
      async plan(_step, _screen, context) {
        plannerContext = context.testContext
        return { plan: makeActionPlan({ action: { type: 'click', ref: 'e2' } }) }
      },
    }

    const result = await executeStep('Click the Log in button', ports({ adapter, planner, safetyHooks }), makeStepContext())

    expect(result.status).toBe('passed')
    expect(plannerContext).toBe('rewritten by safety')
    expect(executed).toEqual([{ type: 'click', ref: 'e2' }])
    expect(result.trace?.subActions?.[0]?.data).toEqual({ rewrittenBySafety: true })
  })

  it('blocks a denied tool_call before adapter execution (async gate, D-09 terminal)', async () => {
    const execute = vi.fn((_a: Action): Promise<ActionResult> => Promise.resolve({ success: true }))
    const adapter = makeAdapter()
    adapter.execute = execute
    const safetyHooks = makeSafetyHooks({ runToolCallAsync: async () => ({ action: 'deny', reason: 'restricted action blocked' }) })

    const result = await executeStep(
      'Click the Log in button',
      ports({ adapter, planner: makePlanner([makeActionPlan({ stepComplete: false })]), safetyHooks }),
      makeStepContext(),
    )

    expect(result.status).toBe('failed')
    expect(execute).not.toHaveBeenCalled()
  })

  it('execution failure → replan with a different action → succeed (no counter)', async () => {
    const adapter = makeAdapter({
      observeResults: [makeScreenState(), makeScreenState(), makeScreenState()],
      executeResults: [{ success: false, error: 'Element not found' }, { success: true }],
    })
    const planner = makePlanner([
      makeActionPlan({ action: { type: 'click', ref: 'e1' } }),
      makeActionPlan({ action: { type: 'click', ref: 'e2' } }),
    ])
    const result = await executeStep('Click the Log in button', ports({ adapter, planner }), makeStepContext())
    expect(result.status).toBe('passed')
  })

  it('verifier detects an app error: fails hard without replanning', async () => {
    const plannerSpy = vi.fn().mockResolvedValue({ plan: makeActionPlan() })
    const verifier = makeVerifier([{ success: false, reasoning: 'HTTP 500 error page detected', isAppError: true }])
    const result = await executeStep(
      'Click the Log in button',
      ports({ adapter: makeAdapter({ observeResults: [makeScreenState(), makeScreenState()] }), planner: { plan: plannerSpy }, verifier }),
      makeStepContext(),
    )
    expect(result.status).toBe('failed')
    expect(result.error).toContain('500')
    expect(plannerSpy).toHaveBeenCalledTimes(1)
  })

  it('verify failure (non-app) → replan → succeed', async () => {
    const adapter = makeAdapter({
      observeResults: [makeScreenState(), makeScreenState(), makeScreenState(), makeScreenState()],
      executeResults: [{ success: true }, { success: true }],
    })
    const verifier = makeVerifier([
      { success: false, reasoning: 'Button not clicked successfully', isAppError: false },
      { success: true, reasoning: 'Step completed after replanning', isAppError: false },
    ])
    const planner = makePlanner([
      makeActionPlan({ action: { type: 'click', ref: 'e1' } }),
      makeActionPlan({ action: { type: 'click', ref: 'e2' } }),
    ])
    const result = await executeStep('Click the Log in button', ports({ adapter, planner, verifier }), makeStepContext())
    expect(result.status).toBe('passed')
  })

  describe('stepFailed agentic signaling', () => {
    it('stepFailed on the first action → fails immediately, no execution', async () => {
      const executeSpy = vi.fn().mockResolvedValue({ success: true })
      const adapter = makeAdapter()
      adapter.execute = executeSpy
      const planner = makePlanner([makeActionPlan({ action: { type: 'click', ref: 'e2' }, stepComplete: false, stepFailed: true })])
      const result = await executeStep('Verify button is blue', ports({ adapter, planner }), makeStepContext())
      expect(result.status).toBe('failed')
      expect(executeSpy).not.toHaveBeenCalled()
    })

    it('stepFailed after 2 successful actions → fails on the 3rd, first 2 executed', async () => {
      let executeCount = 0
      const adapter = makeAdapter()
      adapter.execute = async () => { executeCount++; return { success: true } }
      const planner = makePlanner([
        makeActionPlan({ stepComplete: false, action: { type: 'click', ref: 'e2' } }),
        makeActionPlan({ stepComplete: false, action: { type: 'fill', ref: 'e1', value: 'x' } }),
        makeActionPlan({ reasoning: 'Form is disabled', action: { type: 'click', ref: 'e2' }, stepComplete: false, stepFailed: true }),
      ])
      const result = await executeStep('Fill and submit', ports({ adapter, planner }), makeStepContext())
      expect(result.status).toBe('failed')
      expect(executeCount).toBe(2)
    })

    it('stepFailed message includes the planner reasoning', async () => {
      const planner = makePlanner([makeActionPlan({ reasoning: 'The checkout button does not exist on this page', action: { type: 'click', ref: 'e2' }, stepComplete: false, stepFailed: true })])
      const result = await executeStep('Click checkout', ports({ adapter: makeAdapter(), planner }), makeStepContext())
      expect(result.status).toBe('failed')
      expect(result.error).toContain('The checkout button does not exist on this page')
    })
  })

  describe('completion calls the verifier', () => {
    // D-19 (Phase 360): the retired non-visual-`assert` verifier-bypass short-circuit was
    // deleted. Its deterministic-verdict replacement (an assertValue outcome short-circuiting
    // the per-step verifier, D-11) is pinned RED in assert-value.test.ts (Plan 10) — NOT
    // duplicated here. This suite now only holds the neutral completion invariant: a normal
    // completing action reaches the verifier.
    it('a completing action + stepComplete calls the verifier', async () => {
      const verifySpy = vi.fn().mockResolvedValue({ verification: { success: true, reasoning: 'confirmed', isAppError: false } })
      const verifier: Verifier = { verify: verifySpy }
      const planner = makePlanner([makeActionPlan({ action: { type: 'click', ref: 'e2' }, stepComplete: true })])
      const result = await executeStep('Verify button', ports({ adapter: makeAdapter({ observeResults: [makeScreenState(), makeScreenState()] }), planner, verifier }), makeStepContext())
      expect(result.status).toBe('passed')
      expect(verifySpy).toHaveBeenCalled()
    })
  })
})

describe('executeStep — trace projection', () => {
  it('successful step trace carries observation, reasoning, action, screenStateBefore/After', async () => {
    const before = makeScreenState()
    const after = makeScreenState({ url: 'https://example.test/dashboard' })
    const result = await executeStep(
      'Click Log in',
      ports({ adapter: makeAdapter({ observeResults: [before, after] }), planner: makePlanner([makeActionPlan({ reasoning: 'Clicking Log in to authenticate' })]), verifier: makeVerifier() }),
      makeStepContext(),
    )
    expect(result.status).toBe('passed')
    expect(result.trace?.observation).toBeDefined()
    expect(result.trace?.reasoning).toBe('Clicking Log in to authenticate')
    expect(result.trace?.plannedAction).toEqual({ type: 'click', ref: 'e2' })
    expect(result.trace?.result).toBe('success')
    expect(result.trace?.screenStateBefore).toBeDefined()
    expect(result.trace?.screenStateAfter).toBeDefined()
  })

  it('StepResult.trace.subActions equals projectLegacyTrace(StepResult.evidence)', async () => {
    const result = await executeStep('Click Log in', ports({ adapter: makeAdapter(), planner: makePlanner(), verifier: makeVerifier() }), makeStepContext())
    expect(result.evidence).toBeDefined()
    expect(result.trace?.subActions).toEqual(projectLegacyTrace(result.evidence!))
  })
})

describe('executeStep — cache (redesigned per-key port + hit ladder)', () => {
  const cachedLogin: CachedPlanValue = {
    // Descriptor-only value (D-12): ref/coords stripped; the locator re-grounds to the
    // fresh `log in` button (e2) against the observation at replay time.
    plannedActions: [{ type: 'click' } as unknown as CacheablePlannedAction],
    groundedLocator: [{ role: 'button', nameNormalized: 'log in', ordinal: 0 }],
    verificationOutcome: 'passed',
  }

  it('exact-key hit re-grounds the descriptor and replays without calling the planner', async () => {
    const plannerSpy = vi.fn()
    const cache: ActionPlanCache = {
      async get() { return cachedLogin },
      async set() {},
      async invalidate() {},
    }
    const result = await executeStep('Click Log in', ports({ adapter: makeAdapter(), planner: { plan: plannerSpy } as unknown as Planner, cache }), makeStepContext())
    expect(result.status).toBe('passed')
    expect(plannerSpy).not.toHaveBeenCalled()
    expect(result.evidence?.cacheStatus).toBe('hit')
  })

  it('a hit whose descriptor no longer resolves invalidates the key and replans (D-13)', async () => {
    let invalidateCalls = 0
    const staleHit: CachedPlanValue = {
      plannedActions: [{ type: 'click' } as unknown as CacheablePlannedAction],
      groundedLocator: [{ role: 'button', nameNormalized: 'gone', ordinal: 0 }],
      verificationOutcome: 'passed',
    }
    const cache: ActionPlanCache = {
      async get() { return staleHit },
      async set() {},
      async invalidate() { invalidateCalls++ },
    }
    const plannerSpy = vi.fn().mockResolvedValue({ plan: makeActionPlan() })
    const result = await executeStep('Click Log in', ports({ adapter: makeAdapter(), planner: { plan: plannerSpy }, cache }), makeStepContext())
    expect(result.status).toBe('passed')
    expect(invalidateCalls).toBe(1)
    expect(plannerSpy).toHaveBeenCalledTimes(1) // unmatched descriptor → replan
  })

  it('a secret-templated step bypasses the cache entirely — no get/set, cacheStatus bypass', async () => {
    let gets = 0
    let sets = 0
    const cache: ActionPlanCache = {
      async get() { gets++; return null },
      async set() { sets++ },
      async invalidate() {},
    }
    const plannerSpy = vi.fn().mockResolvedValue({ plan: makeActionPlan() })
    const result = await executeStep(
      'Type {{secret:TOKEN}} into the field',
      ports({ adapter: makeAdapter(), planner: { plan: plannerSpy }, cache }),
      makeStepContext(),
    )
    expect(result.status).toBe('passed')
    expect(result.evidence?.cacheStatus).toBe('bypass')
    expect(gets).toBe(0)
    expect(sets).toBe(0)
  })
})

describe('executeStep — vision gate (D-11 / SCREEN-03)', () => {
  function makeCompressor(): ScreenshotCompressor {
    return {
      compress: vi.fn(async () => ({ buffer: Buffer.from('compressed'), imageWidth: 800, imageHeight: 600 })),
      dimensions: vi.fn(async () => ({ width: 1280, height: 720 })),
    }
  }

  function visionState(): ScreenState {
    return makeScreenState({ metadata: { captureMode: 'textOnly', coordSpace: 'viewport', viewportWidth: 1280, viewportHeight: 720, scroll: { offsetX: 0, offsetY: 0, contentWidth: 1280, contentHeight: 720 } } })
  }

  it('full gate: compression runs, state re-stamped full with real dims, image attached', async () => {
    const captured: { captureMode: string; hadScreenshot: boolean; promptNote?: string } = { captureMode: '', hadScreenshot: false }
    const planner: Planner = {
      async plan(_step, screen, context) {
        captured.captureMode = screen.metadata.captureMode
        captured.hadScreenshot = context.screenshot !== undefined
        captured.promptNote = context.promptNote
        return { plan: makeActionPlan() }
      },
    }
    const compressor = makeCompressor()
    const result = await executeStep('Click Log in', ports({
      adapter: makeAdapter({ observeResults: [visionState()], screenshot: async () => Buffer.from('raw') }),
      planner,
      compressor,
      vision: { effectiveResolution: 1024, screenshotSize: 100_000 },
      visionGate: { attachImage: true, captureMode: 'full', promptNote: '' },
    }), makeStepContext())
    expect(result.status).toBe('passed')
    expect(compressor.compress).toHaveBeenCalledTimes(1)
    expect(captured.captureMode).toBe('full')
    expect(captured.hadScreenshot).toBe(true)
  })

  it('text-only gate: no compression, captureMode textOnly, promptNote injected, screenshot still captured', async () => {
    const captured: { captureMode: string; hadScreenshot: boolean; promptNote?: string } = { captureMode: '', hadScreenshot: false }
    const planner: Planner = {
      async plan(_step, screen, context) {
        captured.captureMode = screen.metadata.captureMode
        captured.hadScreenshot = context.screenshot !== undefined
        captured.promptNote = context.promptNote
        return { plan: makeActionPlan() }
      },
    }
    const shotSpy = vi.fn(async () => Buffer.from('raw'))
    const compressor = makeCompressor()
    const result = await executeStep('Click Log in', ports({
      adapter: makeAdapter({ observeResults: [visionState()], screenshot: shotSpy }),
      planner,
      compressor,
      vision: { effectiveResolution: 1024, screenshotSize: 100_000 },
      visionGate: { attachImage: false, captureMode: 'textOnly', promptNote: 'Rely on the accessibility tree.' },
    }), makeStepContext())
    expect(result.status).toBe('passed')
    expect(compressor.compress).not.toHaveBeenCalled()
    expect(captured.captureMode).toBe('textOnly')
    expect(captured.hadScreenshot).toBe(false)
    expect(captured.promptNote).toBe('Rely on the accessibility tree.')
    expect(shotSpy).toHaveBeenCalled()
  })
})
