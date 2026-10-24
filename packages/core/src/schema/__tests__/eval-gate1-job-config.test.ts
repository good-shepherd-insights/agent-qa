// 422-08-T2 — `eval.gate1.maxPerJob`, the proposal stage's per-job Gate-1 call bound.
//
// A THIRD cap on the same block as `maxScreens`, and deliberately not the same axis: `maxScreens`
// bounds how much ONE Gate-1 call may look at, while `maxPerJob` bounds how many calls one
// proposal job may make at all. An operator can legitimately want a generous screen budget and a
// tight call budget, so collapsing them would be collapsing "how careful is each screening" with
// "how many screenings does a run's tail buy".
//
// Held to the same strictness every other eval cap is — positive integer or absent, never zero,
// never negative, never fractional, never a numeric-looking string, never a nonfinite value that
// defeats a naive `> 0` check — and for a sharper version of the usual reason: a cap that fell
// back to the recorded default because the operator typed `0` would buy replay work they refused.
// There is NO CLI flag for it (D-14): the bound is charged durably per job and read back by a
// resumed attempt, so a per-invocation flag would be a bound that changed between the attempt
// that spent it and the attempt that reads it back.
import { describe, expect, it } from 'vitest'
import { AgentQaConfigSchema } from '../config-schema.js'

const minimalConfig = {
  workspace: {
    testMatch: ['tests/**/*.yaml'],
    suiteMatch: ['suites/**/*.suite.yaml'],
    hooksFile: 'hooks.yaml',
    envFile: '.env',
    secretsFile: '.env.secrets.local',
  },
  use: { mobile: { appState: 'preserve' } },
}

describe('eval.gate1 per-job call cap', () => {
  it.each([{ maxPerJob: 4 }, { maxPerJob: 1 }, { maxPerJob: 64 }, {}])(
    'round-trips the optional positive integer bound %j',
    (gate1) => {
      expect(AgentQaConfigSchema.parse({ ...minimalConfig, eval: { gate1 } }).eval?.gate1).toEqual(
        gate1,
      )
    },
  )

  it('refuses zero, negative, fractional, string and nonfinite bounds', () => {
    for (const value of [0, -1, -4, 1.5, '4', null, Infinity, -Infinity, Number.NaN]) {
      const parsed = AgentQaConfigSchema.safeParse({
        ...minimalConfig,
        eval: { gate1: { maxPerJob: value } },
      })
      expect(parsed.success, `maxPerJob=${String(value)}`).toBe(false)
    }
  })

  it('keeps the screen cap and the call cap independent, and refuses a near-miss spelling', () => {
    // Two axes on one block: either alone, both together, and neither.
    expect(
      AgentQaConfigSchema.parse({
        ...minimalConfig,
        eval: { gate1: { maxScreens: 128, maxPerJob: 2 } },
      }).eval?.gate1,
    ).toEqual({ maxScreens: 128, maxPerJob: 2 })
    expect(
      AgentQaConfigSchema.parse({ ...minimalConfig, eval: { gate1: { maxScreens: 128 } } }).eval
        ?.gate1,
    ).toEqual({ maxScreens: 128 })
    // …and the block stays strict, so a typo is a loud parse failure rather than a setting the
    // operator believes is in force while the recorded default quietly buys the calls.
    for (const key of ['maxPerjob', 'maxPerJobs', 'max_per_job', 'maxCallsPerJob']) {
      expect(
        AgentQaConfigSchema.safeParse({ ...minimalConfig, eval: { gate1: { [key]: 2 } } }).success,
        key,
      ).toBe(false)
    }
  })

  it('leaves the other eval caps untouched when the call cap is set', () => {
    // The three budget blocks are independent: a per-job Gate-1 bound says nothing about the
    // Gate-2 ablation cap or the adversarial seed/probe budgets beside it.
    const parsed = AgentQaConfigSchema.parse({
      ...minimalConfig,
      eval: {
        gate1: { maxPerJob: 3 },
        gate2: { maxAblations: 5 },
        adversarial: { maxSeedsPerRefresh: 8, maxProbeCalls: 4 },
      },
    })
    expect(parsed.eval).toEqual({
      gate1: { maxPerJob: 3 },
      gate2: { maxAblations: 5 },
      adversarial: { maxSeedsPerRefresh: 8, maxProbeCalls: 4 },
    })
  })
})
