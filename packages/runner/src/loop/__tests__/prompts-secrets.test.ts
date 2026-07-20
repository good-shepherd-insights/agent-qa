// G-381-5 (Phase 381, Plan 44): the planner secret-fill contract.
//
// Live evidence: in 3 of 7 attempts (UAT runs 3/5/8) the planner declared a
// secret-bearing step infeasible ("the requested value is a secret placeholder
// whose concrete value is not provided") even though the secret store had the
// name bound every time. Root cause: the shipped system prompt contained NO
// mention of secret placeholders at all — the contract was never taught.
//
// These tests pin the taught contract's five elements. The mechanism half (that
// the contract is true of the shipped code) is pinned in secrets.test.ts.
import { describe, it, expect } from 'vitest'
import { buildSystemPrompt } from '../prompts.js'

const PLATFORMS = ['web', 'android', 'ios', undefined] as const

describe('secret placeholder prompt contract (G-381-5)', () => {
  for (const platform of PLATFORMS) {
    const label = platform ?? 'undefined (platform-neutral)'

    describe(`platform: ${label}`, () => {
      const prompt = buildSystemPrompt(platform)

      it('carries a numbered SECRET PLACEHOLDER rule', () => {
        expect(prompt).toContain('SECRET PLACEHOLDER')
        expect(prompt).toMatch(/\d+\. SECRET PLACEHOLDERS/)
      })

      // Contract element 1: what the two placeholder forms look like in step text.
      it('names both placeholder forms — template and redacted display marker', () => {
        expect(prompt).toContain('{{secret:NAME}}')
        expect(prompt).toContain('[secret:NAME]')
      })

      // Contract element 2: the value exists and is bound — hidden, not missing.
      it('states the value exists and is deliberately hidden, not missing', () => {
        expect(prompt).toContain('EXISTS')
        expect(prompt).toContain('NOT missing')
      })

      // Contract element 3: emit the template verbatim; harness substitutes at dispatch.
      it('states the harness substitutes the value at dispatch', () => {
        expect(prompt).toContain('VERBATIM')
        expect(prompt).toContain('substitutes the real value at dispatch')
      })

      // Contract element 4: never declare infeasible for a hidden literal; the
      // infeasible terminal stays reserved for genuinely impossible objectives.
      it('forbids declaring infeasible because the literal is not visible', () => {
        expect(prompt).toContain('NEVER declare the step infeasible')
        expect(prompt).toContain('a hidden secret is not an impossible objective')
        expect(prompt).toContain('reserved for genuinely impossible objectives')
      })

      // Contract element 5: names-not-values discipline (T-381-106).
      it('forbids reading, printing, or verifying the concrete value', () => {
        expect(prompt).toMatch(/NEVER attempt to read, print, echo, assert on/)
      })

      // T-381-106: the rule teaches the mechanism, never a value. No fixture
      // secret literal may leak into the prompt via the rule prose.
      it('does not disclose or request any concrete secret value', () => {
        expect(prompt).not.toMatch(/secret value is\s+\S/i)
        expect(prompt).not.toContain('ask the user for the secret')
      })
    })
  }

  it('cross-references the existing infeasible terminal rather than redefining it', () => {
    const prompt = buildSystemPrompt('web')
    // Rule 12's IMPOSSIBLE OBJECTIVE arm owns failureKind "infeasible"; the new
    // rule narrows it, it does not introduce a second terminal.
    expect(prompt).toContain('failureKind "infeasible"')
    expect(prompt).toContain('Rule 12')
  })
})
