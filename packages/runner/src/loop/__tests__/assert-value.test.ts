// RED scaffold (Wave 1, Phase 360 · EXEC-07 · D-10/D-11 · spec §7.2/§12.2).
// Pins the structured assertValue split BEFORE Plan 10 wires it:
//   Block A — the pure runner comparator `compareAssertValue` (D-10 "runner judges"): one
//     deterministic case per closed op in the registered assertValue schema
//     (isNull/isDefined/equals/notEquals/gt/lt/contains); a mismatch carries both values; the
//     outcome shape matches AssertValueEvidence with sorted keys.
//   Block B — orchestration + the D-11 verifier short-circuit: the adapter reads the source and
//     the runner comparator mints (D-10 division); a passing assertValue on a completing step
//     yields a deterministic verdict with ZERO verifier.verify calls and verdictSource
//     'assert-value'; a passing assertAI does not close a step by itself — the step verifier,
//     with the author's context, decides (one verify, verdictSource 'verifier-model'; quick
//     261004-0hc); a false assertAI and an extractAI conclusion never call verify; a completing
//     step with no assertion outcome still verifies once
//     (verdictSource 'verifier-model'); a failing assertValue and a platform-unavailable source
//     are honest §7.1 failures the planner mediates; registered secrets arrive masked in evidence.
//
// RED BY DESIGN: Block A imports the not-yet-existing compound/assert-value.js
// (compareAssertValue) — the whole file fails at collection until Plan 10 lands the module, then
// the Block B un-wired-behavior pins take over (verdictSource / short-circuit / comparator mint).
// readAssertValueOutcomeMeta is added to compound/metadata.ts by Plan 10. Typecheck stays green
// via @ts-expect-error; action shapes not yet in the runner union ride the loose ActionPlan.action.
import { describe, it, expect } from 'vitest'
import type { ScreenState } from '@vostride/agent-qa-schema'
import type { PlatformAdapter, Action, ActionResult } from '../../platform.js'
import type { LoopPorts } from '../ports.js'
import type { Verifier } from '../types.js'
import { executeStep } from '../index.js'
import { makeScreenState } from '../../testing/screen-fixtures.js'
import { makeStepContext, makePlanner, makeActionPlan } from './loop-harness.js'
import { SecretStore, SecretRedactor } from '../secrets.js'
// compareAssertValue landed in Plan 08 (compound/assert-value.js) — Block A goes green here.
import { compareAssertValue } from '../../compound/assert-value.js'
// readAssertValueOutcomeMeta landed in Plan 08 (compound/metadata.ts); the seam it reads is Plan 10.
import { readAssertValueOutcomeMeta } from '../../compound/metadata.js'

// ---------------------------------------------------------------------------
// Local harness helpers
// ---------------------------------------------------------------------------
function ports(overrides: Partial<LoopPorts> & Pick<LoopPorts, 'adapter' | 'planner'>): LoopPorts {
  return overrides
}

function readingAdapter(observation: ScreenState, read: ActionResult): PlatformAdapter {
  return {
    platform: 'web',
    async setup() {},
    async cleanup() {},
    async observe() {
      return observation
    },
    async execute(): Promise<ActionResult> {
      return read
    },
  }
}

interface LooseSub {
  result?: { success?: boolean; error?: string; metadata?: Record<string, unknown> }
}

function subs(result: Awaited<ReturnType<typeof executeStep>>): LooseSub[] {
  return (result.evidence as { subActions?: LooseSub[] } | undefined)?.subActions ?? []
}

interface ShortCircuitVerifier extends Verifier {
  verifyCalls: number
  judgeClaim(claim: string, screen: ScreenState, opts?: Record<string, unknown>): Promise<{ verdict: boolean; rationale: string }>
}

function makeShortCircuitVerifier(judgment: { verdict: boolean; rationale: string } = { verdict: true, rationale: 'ok' }): ShortCircuitVerifier {
  const v: ShortCircuitVerifier = {
    verifyCalls: 0,
    async verify() {
      v.verifyCalls++
      return { verification: { success: true, reasoning: 'ok', isAppError: false } }
    },
    async judgeClaim() {
      return judgment
    },
  }
  return v
}

interface ScriptedVerifier extends Verifier {
  verifyArgs: unknown[][]
  judgeClaimCalls: number
  judgeClaim(claim: string, screen: ScreenState, opts?: Record<string, unknown>): Promise<{ verdict: boolean; rationale: string }>
  extractData(query: string, screen: ScreenState, opts?: Record<string, unknown>): Promise<Record<string, unknown>>
}

function makeScriptedVerifier(script: {
  judgment?: { verdict: boolean; rationale: string }
  verification?: { success: boolean; reasoning: string; isAppError: boolean }
  extracted?: Record<string, unknown>
}): ScriptedVerifier {
  const v: ScriptedVerifier = {
    verifyArgs: [],
    judgeClaimCalls: 0,
    async verify(...args: unknown[]) {
      v.verifyArgs.push(args)
      return { verification: script.verification ?? { success: true, reasoning: 'ok', isAppError: false } }
    },
    async judgeClaim() {
      v.judgeClaimCalls++
      return script.judgment ?? { verdict: true, rationale: 'ok' }
    },
    async extractData() {
      return script.extracted ?? {}
    },
  }
  return v
}

interface EvidenceView {
  verdictSource?: string
  aiJudgment?: { verdict?: boolean }
  verifierVerdict?: { reasoning?: string }
}

const cfg = { maxSubActions: 4, previousStepCount: 0 }

// ---------------------------------------------------------------------------
// Block A — the pure comparator (D-10 "runner judges")
// ---------------------------------------------------------------------------
describe('Block A — compareAssertValue: one deterministic case per closed op (D-10)', () => {
  it('equals / notEquals', () => {
    expect(compareAssertValue({ source: 'url', op: 'equals', expected: 'https://x.test/home', actual: 'https://x.test/home' }).passed).toBe(true)
    expect(compareAssertValue({ source: 'url', op: 'notEquals', expected: 'https://x.test/home', actual: 'https://x.test/login' }).passed).toBe(true)
  })

  it('contains', () => {
    expect(compareAssertValue({ source: 'url', op: 'contains', expected: 'home', actual: 'https://x.test/home' }).passed).toBe(true)
  })

  it('gt / lt (numeric)', () => {
    expect(compareAssertValue({ source: 'expr-result', op: 'gt', expected: '10', actual: '11' }).passed).toBe(true)
    expect(compareAssertValue({ source: 'expr-result', op: 'lt', expected: '10', actual: '9' }).passed).toBe(true)
  })

  it('isNull / isDefined (no expected)', () => {
    expect(compareAssertValue({ source: 'storage', op: 'isNull', actual: null }).passed).toBe(true)
    expect(compareAssertValue({ source: 'storage', op: 'isDefined', actual: 'present' }).passed).toBe(true)
  })

  it('a mismatch is not-ok and carries both values; the outcome shape matches AssertValueEvidence sorted keys', () => {
    const r = compareAssertValue({ source: 'url', op: 'equals', expected: 'a', actual: 'b' })
    expect(r.passed).toBe(false)
    expect(r.expected).toBe('a')
    expect(r.actual).toBe('b')
    expect(Object.keys(r).sort()).toEqual(['actual', 'expected', 'op', 'passed', 'source'])
  })
})

// ---------------------------------------------------------------------------
// Block B — orchestration + the D-11 verifier short-circuit
// ---------------------------------------------------------------------------
describe('Block B — assertValue orchestration and the deterministic verifier short-circuit (D-10/D-11)', () => {
  it('a passing assertValue on a completing step mints a deterministic verdict with ZERO verifier.verify calls and verdictSource assert-value (D-10 adapter reads / runner judges, D-11)', async () => {
    const adapter = readingAdapter(makeScreenState(), { success: true, data: 'https://x.test/home' })
    const verifier = makeShortCircuitVerifier()
    const plan = makeActionPlan({ action: { type: 'assertValue', source: 'url', op: 'contains', expected: 'home' }, stepComplete: true })

    const result = await executeStep(
      'Assert the url contains home',
      ports({ adapter, planner: makePlanner([plan]), verifier, plannerConfig: cfg }),
      makeStepContext(),
    )

    expect(verifier.verifyCalls).toBe(0)
    expect((result.evidence as { verdictSource?: string }).verdictSource).toBe('assert-value')
  })

  it('a passing assertAI does not close the step by itself — the step verifier runs once and decides, verdictSource verifier-model (quick 261004-0hc)', async () => {
    const adapter = readingAdapter(makeScreenState(), { success: true })
    const verifier = makeShortCircuitVerifier({ verdict: true, rationale: 'the header is present' })
    const plan = makeActionPlan({
      action: { type: 'assertAI', claim: 'the header is present', mode: 'multimodal', effort: 'medium', consensus: 1 },
      stepComplete: true,
    })

    const result = await executeStep(
      'Assert the header via AI',
      ports({ adapter, planner: makePlanner([plan]), verifier, plannerConfig: cfg }),
      makeStepContext(),
    )

    expect(verifier.verifyCalls).toBe(1)
    expect(result.status).toBe('passed')
    expect((result.evidence as { verdictSource?: string }).verdictSource).toBe('verifier-model')
  })

  it('bsky-16 tracer: the verifier, given the author context, rejects a passing-assertAI conclusion and the step does not pass', async () => {
    const adapter = readingAdapter(makeScreenState(), { success: true })
    const verifier = makeScriptedVerifier({
      judgment: { verdict: true, rationale: 'the page shows the #caturday hashtag' },
      verification: { success: false, reasoning: 'The final screen is Safari, not Bluesky', isAppError: false },
    })
    const assertTurn = makeActionPlan({
      action: {
        type: 'assertAI',
        claim: 'The current screen is the dedicated #caturday hashtag page, although this browser session is logged out',
        mode: 'multimodal',
        effort: 'medium',
        consensus: 1,
      },
      stepComplete: true,
    })
    const bail = makeActionPlan({ action: { type: 'reportValue', value: 'n/a' }, stepComplete: false, stepFailed: true })

    const result = await executeStep(
      'Open the #caturday hashtag page',
      ports({ adapter, planner: makePlanner([assertTurn, bail]), verifier, plannerConfig: cfg }),
      makeStepContext({ testContext: 'Only the final screen is graded.' }),
    )

    expect(result.status).toBe('failed')
    expect(verifier.verifyArgs).toHaveLength(1)
    expect((verifier.verifyArgs[0][3] as { type?: string }).type).toBe('assertAI')
    expect(verifier.verifyArgs[0][8]).toEqual({ testContext: 'Only the final screen is graded.' })
    expect(verifier.judgeClaimCalls).toBe(1)
    const evidence = result.evidence as EvidenceView
    expect(evidence.verdictSource).toBe('verifier-model')
    expect(evidence.aiJudgment?.verdict).toBe(true)
    expect(evidence.verifierVerdict?.reasoning).not.toBe('Step verified deterministically from the assertion outcome')
  })

  it('the verifier accepts a passing-assertAI conclusion: the step passes on the verifier reasoning', async () => {
    const adapter = readingAdapter(makeScreenState(), { success: true })
    const verifier = makeScriptedVerifier({
      judgment: { verdict: true, rationale: 'the page shows the #caturday hashtag' },
      verification: { success: true, reasoning: 'Bluesky shows the #caturday results', isAppError: false },
    })
    const plan = makeActionPlan({
      action: { type: 'assertAI', claim: 'Bluesky shows the #caturday results', mode: 'multimodal', effort: 'medium', consensus: 1 },
      stepComplete: true,
    })

    const result = await executeStep(
      'Open the #caturday hashtag page',
      ports({ adapter, planner: makePlanner([plan]), verifier, plannerConfig: cfg }),
      makeStepContext(),
    )

    expect(result.status).toBe('passed')
    expect(verifier.verifyArgs).toHaveLength(1)
    expect(verifier.judgeClaimCalls).toBe(1)
    const evidence = result.evidence as EvidenceView
    expect(evidence.verdictSource).toBe('verifier-model')
    expect(evidence.verifierVerdict?.reasoning).toBe('Bluesky shows the #caturday results')
  })

  it('unchanged: a false assertAI never calls verify and never passes the step (self-correcting judged-false error)', async () => {
    const adapter = readingAdapter(makeScreenState(), { success: true })
    const verifier = makeScriptedVerifier({ judgment: { verdict: false, rationale: 'no hashtag page is visible' } })
    const assertTurn = makeActionPlan({
      action: { type: 'assertAI', claim: 'the #caturday hashtag page is visible', mode: 'multimodal', effort: 'medium', consensus: 1 },
      stepComplete: true,
    })
    const bail = makeActionPlan({ action: { type: 'reportValue', value: 'n/a' }, stepComplete: false, stepFailed: true })

    const result = await executeStep(
      'Open the #caturday hashtag page',
      ports({ adapter, planner: makePlanner([assertTurn, bail]), verifier, plannerConfig: cfg }),
      makeStepContext(),
    )

    expect(verifier.verifyArgs).toHaveLength(0)
    expect(result.status).toBe('failed')
    expect(subs(result)[0]?.result?.success).toBe(false)
    expect(subs(result)[0]?.result?.error).toContain('judged false')
  })

  it('unchanged: an extractAI-concluded step never calls verify and keeps verdictSource assert-ai', async () => {
    const adapter = readingAdapter(makeScreenState(), { success: true })
    const verifier = makeScriptedVerifier({ extracted: { title: 'Home' } })
    const plan = makeActionPlan({
      action: { type: 'extractAI', query: 'the page title' },
      stepComplete: true,
    })

    const result = await executeStep(
      'Read the page title',
      ports({ adapter, planner: makePlanner([plan]), verifier, plannerConfig: cfg }),
      makeStepContext(),
    )

    expect(verifier.verifyArgs).toHaveLength(0)
    expect(result.status).toBe('passed')
    expect((result.evidence as EvidenceView).verdictSource).toBe('assert-ai')
  })

  it('control: a completing step without any assertion outcome verifies exactly once with verdictSource verifier-model', async () => {
    const adapter = readingAdapter(makeScreenState(), { success: true })
    const verifier = makeShortCircuitVerifier()
    const plan = makeActionPlan({ action: { type: 'click', ref: 'e2' }, stepComplete: true })

    const result = await executeStep(
      'Click submit',
      ports({ adapter, planner: makePlanner([plan]), verifier, plannerConfig: cfg }),
      makeStepContext(),
    )

    expect(verifier.verifyCalls).toBe(1)
    expect((result.evidence as { verdictSource?: string }).verdictSource).toBe('verifier-model')
  })

  it('a failing assertValue is an honest §7.1 failure the planner mediates (D-10)', async () => {
    const adapter = readingAdapter(makeScreenState(), { success: true, data: 'https://x.test/login' })
    const verifier = makeShortCircuitVerifier()
    const assertTurn = makeActionPlan({ action: { type: 'assertValue', source: 'url', op: 'contains', expected: 'home' }, stepComplete: true })
    const bail = makeActionPlan({ action: { type: 'reportValue', value: 'n/a' }, stepComplete: false, stepFailed: true })

    const result = await executeStep(
      'Assert the url is home',
      ports({ adapter, planner: makePlanner([assertTurn, bail]), verifier, plannerConfig: cfg }),
      makeStepContext(),
    )

    expect(subs(result)[0]?.result?.success).toBe(false)
  })

  it('a source unavailable on the platform surfaces a §7.1 error, never a crash (D-10)', async () => {
    const adapter = readingAdapter(makeScreenState(), { success: false, error: 'storage source unavailable on this platform' })
    const verifier = makeShortCircuitVerifier()
    const assertTurn = makeActionPlan({ action: { type: 'assertValue', source: 'storage', op: 'isDefined' }, stepComplete: true })
    const bail = makeActionPlan({ action: { type: 'reportValue', value: 'n/a' }, stepComplete: false, stepFailed: true })

    const result = await executeStep(
      'Assert a storage value',
      ports({ adapter, planner: makePlanner([assertTurn, bail]), verifier, plannerConfig: cfg }),
      makeStepContext(),
    )

    expect(result.status).toBe('failed')
  })

  it('registered-secret assertValue expected/actual values arrive masked in evidence (masked-before-record, T-360-01)', async () => {
    const store = new SecretStore({ TOKEN: 'sk-live-supersecret' })
    const redactor = new SecretRedactor(store)
    const adapter = readingAdapter(makeScreenState(), { success: true, data: 'sk-live-supersecret' })
    const verifier = makeShortCircuitVerifier()
    const plan = makeActionPlan({ action: { type: 'assertValue', source: 'storage', op: 'equals', expected: '{{secret:TOKEN}}' }, stepComplete: true })

    const result = await executeStep(
      'Assert the stored token',
      ports({ adapter, planner: makePlanner([plan]), verifier, secretStore: store, secretRedactor: redactor, plannerConfig: cfg }),
      makeStepContext(),
    )

    expect(JSON.stringify(result.evidence)).not.toContain('supersecret')
    const outcome = readAssertValueOutcomeMeta(subs(result)[0]?.result) as { passed?: boolean } | undefined
    expect(outcome).toBeDefined()
  })
})
