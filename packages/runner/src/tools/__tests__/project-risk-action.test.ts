// SEAM-03 / D-08: the runner-side pure projection from a resolved Action to the schema-owned
// RiskActionDescriptor the static risk classifier consumes. The projection reads ONLY the tool
// registry's advisory readOnly?/destructive? metadata plus the static verb identity — no
// action-payload field feeds any classifier signal (T-362-11). Roll-call Test 5 iterates the
// REAL ACTION_DEFINITIONS table (not a hand-copied list) so a future verb addition is
// automatically covered and can never silently fork projection from the registry.
import { describe, it, expect } from 'vitest'
import { classifyRisk } from '@vostride/agent-qa-safety'
import { projectRiskAction } from '../project-risk-action.js'
import { ACTION_DEFINITIONS } from '../actions/index.js'

describe('projectRiskAction — Action → RiskActionDescriptor', () => {
  it('Test 1: a registered readOnly verb projects recognized:true + readOnly:true → read-only', () => {
    for (const verb of ['waitFor', 'assertValue', 'inspect']) {
      const descriptor = projectRiskAction({ type: verb })
      expect(descriptor.recognized).toBe(true)
      expect(descriptor.readOnly).toBe(true)
      expect(classifyRisk(descriptor).riskTier).toBe('read-only')
    }
  })

  it('Test 2: a registered non-readOnly verb projects recognized:true without readOnly → mutating-local', () => {
    for (const verb of ['click', 'fill', 'tap', 'navigate']) {
      const descriptor = projectRiskAction({ type: verb })
      expect(descriptor.recognized).toBe(true)
      expect(descriptor.readOnly).toBeUndefined()
      expect(classifyRisk(descriptor).riskTier).toBe('mutating-local')
    }
  })

  it('Test 3: an unknown verb projects recognized:false → restricted (fail-safe)', () => {
    const descriptor = projectRiskAction({ type: 'definitelyNotARegisteredVerb' })
    expect(descriptor.recognized).toBe(false)
    expect(descriptor.name).toBe('definitelyNotARegisteredVerb')
    expect(classifyRisk(descriptor).riskTier).toBe('restricted')
  })

  it('Test 4: setVariable projects { name: "setVariable", recognized: true } → mutating-local', () => {
    const descriptor = projectRiskAction({ type: 'setVariable' })
    expect(descriptor.name).toBe('setVariable')
    expect(descriptor.recognized).toBe(true)
    expect(descriptor.readOnly).toBeUndefined()
    expect(classifyRisk(descriptor).riskTier).toBe('mutating-local')
  })

  it('Test 5 (roll-call): EVERY definition-table verb projects recognized:true and classifies to an allow tier (read-only | mutating-local) — none reaches ask/deny (spec §2.1)', () => {
    const verbs = new Set(ACTION_DEFINITIONS.map((def) => def.type))
    expect(verbs.size).toBeGreaterThan(0)
    for (const verb of verbs) {
      const descriptor = projectRiskAction({ type: verb })
      expect(descriptor.recognized, `${verb} must be recognized`).toBe(true)
      const tier = classifyRisk(descriptor).riskTier
      expect(['read-only', 'mutating-local'], `${verb} classified ${tier}`).toContain(tier)
    }
  })

  it('Test 6: a verb registered on multiple surfaces merges deterministically (readOnly iff ALL, destructive iff ANY, surface omitted when ambiguous)', () => {
    // fill is registered on web (destructive) AND mobile (destructive) — ambiguous surface,
    // destructive from both, readOnly from neither.
    const fillDefs = ACTION_DEFINITIONS.filter((def) => def.type === 'fill')
    expect(fillDefs.length).toBeGreaterThan(1)
    const fill = projectRiskAction({ type: 'fill' })
    expect(fill.recognized).toBe(true)
    expect(fill.surface).toBeUndefined()
    expect(fill.destructive).toBe(true)
    expect(fill.readOnly).toBeUndefined()

    // A single-surface verb carries its surface unambiguously.
    const click = projectRiskAction({ type: 'click' })
    expect(click.surface).toBe('web')
  })
})
