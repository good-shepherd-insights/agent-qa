// SCREEN-02 / D-15: the evidence boundary matrix. stateBefore is always the FULL
// ScreenState the sub-action was planned against; stateAfter lands ONLY at the three
// spec-locked boundaries (assert, verifier, self-heal) by reuse of an observation the
// loop already takes. Plus the redact-before-record security lock and the cache fold.
import { describe, it, expect } from 'vitest'
import type { LoopPorts } from '../ports.js'
import type { ActionPlanCache, CachedPlanValue } from '../../cache/port.js'
import type { Action } from '../../platform.js'
import type { Planner } from '../types.js'
import { executeStep } from '../index.js'
import { SecretRedactor, SecretStore } from '../secrets.js'
import { makeActionPlan, makeAdapter, makePlanner, makeStepContext, makeVerifier } from './loop-harness.js'
import { makeScreenState } from '../../testing/screen-fixtures.js'

function ports(overrides: Partial<LoopPorts> & Pick<LoopPorts, 'adapter' | 'planner'>): LoopPorts {
  return overrides
}

describe('loop evidence matrix (SCREEN-02 / D-15)', () => {
  it('(1) every recorded sub-action carries stateBefore with non-empty elements and refMap', async () => {
    const result = await executeStep('Click Log in', ports({ adapter: makeAdapter(), planner: makePlanner() }), makeStepContext())
    const sub = result.evidence!.subActions[0]
    expect(sub.stateBefore.elements.length).toBeGreaterThan(0)
    expect(Object.keys(sub.stateBefore.refMap).length).toBeGreaterThan(0)
  })

  it('(2) an assert sub-action gets stateAfter === its stateBefore (D-15a)', async () => {
    const planner = makePlanner([makeActionPlan({ action: { type: 'assert', condition: 'x', visual: false }, stepComplete: true })])
    const result = await executeStep('Assert x', ports({ adapter: makeAdapter(), planner }), makeStepContext())
    const sub = result.evidence!.subActions[0]
    expect(sub.stateAfter).toBeDefined()
    expect(sub.stateAfter).toEqual(sub.stateBefore)
  })

  it('(3) a verified sub-action gets the verifier re-observation as stateAfter (D-15b)', async () => {
    const before = makeScreenState({ url: 'https://example.test/before' })
    const after = makeScreenState({ url: 'https://example.test/after' })
    // The settle gate consumes two consecutive observations (identical screenIdentityHash —
    // url is not part of screen identity) before proceeding, so `before` is fed twice; the
    // verifier's own re-observation then yields `after` as stateAfter (D-15b).
    const result = await executeStep(
      'Click Log in',
      ports({ adapter: makeAdapter({ observeResults: [before, before, after] }), planner: makePlanner(), verifier: makeVerifier() }),
      makeStepContext(),
    )
    const sub = result.evidence!.subActions[0]
    expect(sub.stateAfter).toBeDefined()
    expect(sub.stateAfter?.url).toBe('https://example.test/after')
    expect(sub.stateBefore.url).toBe('https://example.test/before')
  })

  it('(4) a failed-then-recovered pair shares the boundary observation and records the contrastive selfHeal pair (D-15c)', async () => {
    const screen1 = makeScreenState({ url: 'https://example.test/1' })
    const screen2 = makeScreenState({ url: 'https://example.test/2' })
    const adapter = makeAdapter({
      observeResults: [screen1, screen2, screen2],
      executeResults: [{ success: false, error: 'not found' }, { success: true }],
    })
    const planner = makePlanner([
      makeActionPlan({ reasoning: 'wrong', action: { type: 'click', ref: 'e1' } }),
      makeActionPlan({ reasoning: 'right', action: { type: 'click', ref: 'e2' } }),
    ])
    const result = await executeStep('Click Log in', ports({ adapter, planner }), makeStepContext())
    expect(result.status).toBe('passed')
    const [failed, recovering] = result.evidence!.subActions
    // The single boundary observation is BOTH the failed sub-action's stateAfter and the
    // recovering sub-action's stateBefore (identical-state sharing, one capture).
    expect(failed.stateAfter).toEqual(recovering.stateBefore)
    expect(failed.stateAfter?.url).toBe('https://example.test/2')
    expect(result.evidence!.selfHeal).toBeDefined()
    expect(result.evidence!.selfHeal?.failedDecision.plannedAction.type).toBe('click')
    expect(result.evidence!.selfHeal?.recoveringDecision.plan).toBe('right')
  })

  it('(5) a sub-action at no boundary has no stateAfter', async () => {
    const adapter = makeAdapter({
      observeResults: [makeScreenState(), makeScreenState()],
      executeResults: [{ success: true }, { success: true }],
    })
    const planner = makePlanner([
      makeActionPlan({ action: { type: 'click', ref: 'e1' }, stepComplete: false }),
      makeActionPlan({ action: { type: 'click', ref: 'e2' }, stepComplete: true }),
    ])
    const result = await executeStep('Two steps', ports({ adapter, planner }), makeStepContext())
    expect(result.status).toBe('passed')
    expect(result.evidence!.subActions[0].stateAfter).toBeUndefined()
  })

  it('(6) a [secret:x]-bearing plan never reaches SubActionEvidence unredacted', async () => {
    const store = new SecretStore({ PASSWORD: 'hunter2' })
    const redactor = new SecretRedactor(store)
    const planner = makePlanner([makeActionPlan({ action: { type: 'fill', ref: 'e1', value: '{{secret:PASSWORD}}' }, stepComplete: true })])
    const result = await executeStep(
      'Fill the password',
      ports({ adapter: makeAdapter(), planner, secretStore: store, secretRedactor: redactor }),
      makeStepContext(),
    )
    const stored = result.evidence!.subActions[0].plannedAction as { value?: string }
    expect(stored.value).toBe('[secret:PASSWORD]')
    expect(JSON.stringify(result.evidence)).not.toContain('hunter2')
  })

  it('(7) a cache miss (the planner ran) folds to cacheStatus miss', async () => {
    const cache: ActionPlanCache = {
      async get() { return null },
      async set() {},
      async invalidate() {},
    }
    const planner = makePlanner([makeActionPlan({ action: { type: 'click', ref: 'e2' }, stepComplete: true })])
    const result = await executeStep(
      'One sub-action',
      ports({ adapter: makeAdapter(), planner, cache }),
      makeStepContext(),
    )
    expect(result.status).toBe('passed')
    expect(result.evidence!.cacheStatus).toBe('miss')
  })

  it('(7b) an exact-key hit re-grounds and replays — folds to cacheStatus hit, no planner', async () => {
    const cachedLogin: CachedPlanValue = {
      // Descriptor-only value: ref/coords stripped; grounding rides on the locator, which
      // re-grounds to the fresh `log in` button (e2) in the observation.
      plannedActions: [{ type: 'click' } as unknown as Action],
      groundedLocator: [{ role: 'button', nameNormalized: 'log in', ordinal: 0 }],
      verificationOutcome: 'passed',
    }
    const cache: ActionPlanCache = {
      async get() { return cachedLogin },
      async set() {},
      async invalidate() {},
    }
    const plannerSpy: Planner = { async plan() { throw new Error('planner must not be called on a hit run') } }
    const result = await executeStep('Click Log in', ports({ adapter: makeAdapter(), planner: plannerSpy, cache }), makeStepContext())
    expect(result.status).toBe('passed')
    expect(result.evidence!.cacheStatus).toBe('hit')
  })
})
