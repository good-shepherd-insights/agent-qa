// RED scaffold (Wave 1, Phase 360 · EXEC-07 · D-05/D-06/D-07/D-08/D-09 · spec §9.6/§12.2).
// Pins the AI judge lane BEFORE Plan 09 wires it:
//   - assertAI routes through the verifier's injected model lane exactly ONCE per attempt
//     (D-05 single-model law) — never adapter.execute, never a second judgment.
//   - A true judgment yields success + a typed metadata.aiJudgment / StepEvidence.aiJudgment
//     block (verdict + rationale); deferred knobs (consensus>1 / video / effort) are recorded,
//     never an error (D-09).
//   - A false claim is success:false + a §7.1 self-correcting error (verdict + rationale +
//     re-observe/declare guidance) the planner mediates (D-06).
//   - extractAI scope:'run' returns fields AND writes run-scoped working memory
//     (kind extracted-value / provenance toolResult); scope:'global' degrades to the SAME
//     run-scoped write with a degraded-scope marker, never an error (D-07).
//   - Cache bypass (D-08): a completing plan containing assertAI/extractAI is never written
//     (set count 0) and finalizes cacheStatus 'bypass'; a control non-AI plan still writes.
//
// RED BY DESIGN: the fake verifier exposes judgeClaim/extractData the loop does not call yet
// (un-extended Verifier surface); readAiJudgmentMeta is added to compound/metadata.ts by Plan 09
// (missing export — undefined at runtime); the typed evidence blocks and cache-bypass write
// exclusion are un-wired loop behavior. The file collects (no missing-module import) so the
// non-AI control write stays green. Action shapes not yet in the runner union ride the loose
// ActionPlan.action; typecheck stays green.
import { describe, it, expect } from 'vitest'
import type { ScreenState, WorkingMemoryEntry } from '@vostride/agent-qa-schema'
import type { PlatformAdapter, Action, ActionResult } from '../../platform.js'
import type { LoopPorts, WorkingMemoryPort } from '../ports.js'
import type { Verifier, VerifyResult } from '../types.js'
import type { ActionPlanCache } from '../../cache/port.js'
import { executeStep } from '../index.js'
import { makeScreenState } from '../../testing/screen-fixtures.js'
import { makeStepContext, makePlanner, makeActionPlan } from './loop-harness.js'
// readAiJudgmentMeta landed in Plan 08 (compound/metadata.ts); the seam wiring it reads is Plan 09/10.
import { readAiJudgmentMeta } from '../../compound/metadata.js'

// ---------------------------------------------------------------------------
// Local harness helpers
// ---------------------------------------------------------------------------
function ports(overrides: Partial<LoopPorts> & Pick<LoopPorts, 'adapter' | 'planner'>): LoopPorts {
  return overrides
}

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
  result?: { success?: boolean; error?: string; metadata?: Record<string, unknown> }
}

function subs(result: Awaited<ReturnType<typeof executeStep>>): LooseSub[] {
  return (result.evidence as { subActions?: LooseSub[] } | undefined)?.subActions ?? []
}

interface CaptureCall {
  entries: readonly WorkingMemoryEntry[]
  ctx?: { test?: number; step?: number }
}

function recordingWorkingMemory(): WorkingMemoryPort & { calls: CaptureCall[] } {
  const calls: CaptureCall[] = []
  return {
    calls,
    capture(entries, ctx) {
      calls.push({ entries, ctx })
    },
    entries() {
      return []
    },
    dispose() {},
  }
}

interface JudgeScript {
  verdict: boolean
  rationale: string
}

interface FakeJudgeVerifier extends Verifier {
  judgeClaim(claim: string, screen: ScreenState, opts?: Record<string, unknown>): Promise<JudgeScript>
  extractData(query: string, screen: ScreenState, opts?: Record<string, unknown>): Promise<Record<string, unknown>>
  judgeClaimCalls: { claim: string; opts?: Record<string, unknown> }[]
  extractDataCalls: { query: string; opts?: Record<string, unknown> }[]
}

function makeJudgeVerifier(opts?: {
  judgment?: JudgeScript
  extracted?: Record<string, unknown>
  verify?: VerifyResult
}): FakeJudgeVerifier {
  const judgeClaimCalls: FakeJudgeVerifier['judgeClaimCalls'] = []
  const extractDataCalls: FakeJudgeVerifier['extractDataCalls'] = []
  return {
    judgeClaimCalls,
    extractDataCalls,
    async verify() {
      return opts?.verify ?? { verification: { success: true, reasoning: 'ok', isAppError: false } }
    },
    async judgeClaim(claim, _screen, o) {
      judgeClaimCalls.push({ claim, opts: o })
      return opts?.judgment ?? { verdict: true, rationale: 'looks right' }
    },
    async extractData(query, _screen, o) {
      extractDataCalls.push({ query, opts: o })
      return opts?.extracted ?? {}
    },
  }
}

function makeCountingCache(): ActionPlanCache & { setCalls: number } {
  const cache = {
    setCalls: 0,
    async get() {
      return null
    },
    async set() {
      cache.setCalls++
    },
    async invalidate() {},
  }
  return cache
}

const cfg = { maxSubActions: 4, previousStepCount: 0 }

// ---------------------------------------------------------------------------
// assertAI — the single-model judge lane (D-05/D-06/D-09)
// ---------------------------------------------------------------------------
describe('assertAI executes through the verifier model lane — one judgment, never the adapter (D-05)', () => {
  it('routes through ports.verifier.judgeClaim exactly once and never calls adapter.execute (single-model law)', async () => {
    const calls: Action[] = []
    const adapter = recordingAdapter(makeScreenState(), calls)
    const verifier = makeJudgeVerifier({ judgment: { verdict: true, rationale: 'the banner reads Welcome' } })
    const plan = makeActionPlan({
      action: { type: 'assertAI', claim: 'the welcome banner is visible', mode: 'multimodal', effort: 'medium', consensus: 1 },
      stepComplete: true,
    })

    await executeStep(
      'Assert the welcome banner',
      ports({ adapter, planner: makePlanner([plan]), verifier, plannerConfig: cfg }),
      makeStepContext(),
    )

    expect(verifier.judgeClaimCalls.length).toBe(1)
    expect(calls.length).toBe(0)
  })

  it('a true judgment yields success with a metadata.aiJudgment block and StepEvidence.aiJudgment carrying verdict + rationale (D-05)', async () => {
    const calls: Action[] = []
    const adapter = recordingAdapter(makeScreenState(), calls)
    const verifier = makeJudgeVerifier({ judgment: { verdict: true, rationale: 'the banner reads Welcome' } })
    const plan = makeActionPlan({
      action: { type: 'assertAI', claim: 'the welcome banner is visible', mode: 'multimodal', effort: 'medium', consensus: 1 },
      stepComplete: true,
    })

    const result = await executeStep(
      'Assert the welcome banner',
      ports({ adapter, planner: makePlanner([plan]), verifier, plannerConfig: cfg }),
      makeStepContext(),
    )

    expect(result.status).toBe('passed')
    const meta = readAiJudgmentMeta(subs(result)[0]?.result) as { verdict?: boolean } | undefined
    expect(meta).toBeDefined()
    const judgment = (result.evidence as { aiJudgment?: { verdict?: boolean; rationale?: string } }).aiJudgment
    expect(judgment?.verdict).toBe(true)
    expect(judgment?.rationale ?? '').toContain('Welcome')
  })

  it('deferred knobs (consensus>1, video, effort) are recorded in the judgment evidence and never error (D-09)', async () => {
    const calls: Action[] = []
    const adapter = recordingAdapter(makeScreenState(), calls)
    const verifier = makeJudgeVerifier({ judgment: { verdict: true, rationale: 'ok' } })
    const plan = makeActionPlan({
      action: { type: 'assertAI', claim: 'x', mode: 'multimodal', effort: 'high', consensus: 3, video: true },
      stepComplete: true,
    })

    const result = await executeStep(
      'Assert with deferred knobs',
      ports({ adapter, planner: makePlanner([plan]), verifier, plannerConfig: cfg }),
      makeStepContext(),
    )

    // Deferred knobs execute single-model in M1 — never an error.
    expect(result.status).toBe('passed')
    const judgment = (result.evidence as { aiJudgment?: { requested?: Record<string, unknown> } }).aiJudgment
    expect(judgment?.requested).toMatchObject({ consensus: 3, video: true, effort: 'high' })
  })

  it('a false claim is success:false with a §7.1 self-correcting error carrying the model rationale (D-06 planner mediation)', async () => {
    const calls: Action[] = []
    const adapter = recordingAdapter(makeScreenState(), calls)
    const verifier = makeJudgeVerifier({ judgment: { verdict: false, rationale: 'no banner is present' } })
    const assertTurn = makeActionPlan({
      action: { type: 'assertAI', claim: 'the welcome banner is visible', mode: 'multimodal', effort: 'medium', consensus: 1 },
      stepComplete: true,
    })
    const bailTurn = makeActionPlan({ action: { type: 'reportValue', value: 'n/a' }, stepComplete: false, stepFailed: true })

    const result = await executeStep(
      'Assert the welcome banner',
      ports({ adapter, planner: makePlanner([assertTurn, bailTurn]), verifier, plannerConfig: cfg }),
      makeStepContext(),
    )

    const sub = subs(result)[0]
    expect(sub?.result?.success).toBe(false)
    const err = sub?.result?.error ?? ''
    expect(err).toContain('no banner is present')
    expect(err.toLowerCase()).toMatch(/re-observe|step failed|declare/)
  })
})

// ---------------------------------------------------------------------------
// extractAI — run-scoped writes + scope:global degradation (D-07)
// ---------------------------------------------------------------------------
describe('extractAI extracts through the judge lane and captures run-scoped working memory (D-07)', () => {
  it('scope:run puts extracted fields in the result AND writes working memory (kind extracted-value / provenance toolResult)', async () => {
    const calls: Action[] = []
    const adapter = recordingAdapter(makeScreenState(), calls)
    const wm = recordingWorkingMemory()
    const verifier = makeJudgeVerifier({ extracted: { orderId: 'ORD-9' } })
    const plan = makeActionPlan({
      action: {
        type: 'extractAI',
        query: 'extract the order id',
        schema: [{ name: 'orderId', type: 'string', description: 'the order id shown on the receipt' }],
        scope: 'run',
      },
      stepComplete: true,
    })

    const result = await executeStep(
      'Extract the order id',
      ports({ adapter, planner: makePlanner([plan]), verifier, workingMemory: wm, plannerConfig: cfg }),
      makeStepContext(),
    )

    expect(result.status).toBe('passed')
    expect(verifier.extractDataCalls.length).toBe(1)
    expect(wm.calls.length).toBe(1)
    const entry = wm.calls[0]?.entries[0]
    expect(entry?.kind).toBe('extracted-value')
    expect(entry?.provenance).toBe('toolResult')
  })

  it('scope:global degrades to the SAME run-scoped write with a degraded-scope marker in evidence, never an error', async () => {
    const calls: Action[] = []
    const adapter = recordingAdapter(makeScreenState(), calls)
    const wm = recordingWorkingMemory()
    const verifier = makeJudgeVerifier({ extracted: { token: 'abc' } })
    const plan = makeActionPlan({
      action: {
        type: 'extractAI',
        query: 'extract the session token',
        schema: [{ name: 'token', type: 'string', description: 'the session token' }],
        scope: 'global',
      },
      stepComplete: true,
    })

    const result = await executeStep(
      'Extract the token globally',
      ports({ adapter, planner: makePlanner([plan]), verifier, workingMemory: wm, plannerConfig: cfg }),
      makeStepContext(),
    )

    expect(result.status).toBe('passed')
    expect(wm.calls.length).toBe(1)
    const judgment = (result.evidence as { aiJudgment?: { degradedScope?: boolean } }).aiJudgment
    expect(judgment?.degradedScope).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Cache bypass (D-08)
// ---------------------------------------------------------------------------
describe('AI assertions are cache-bypassed at the write side (D-08)', () => {
  it('a completing plan containing assertAI is never written (set count 0) and finalizes cacheStatus bypass; a control non-AI plan still writes', async () => {
    // AI-assertion completing plan — never written.
    const aiCache = makeCountingCache()
    const aiVerifier = makeJudgeVerifier({ judgment: { verdict: true, rationale: 'ok' } })
    const aiPlan = makeActionPlan({
      action: { type: 'assertAI', claim: 'ok', mode: 'multimodal', effort: 'medium', consensus: 1 },
      stepComplete: true,
    })
    const aiResult = await executeStep(
      'Assert then complete',
      ports({ adapter: recordingAdapter(makeScreenState(), []), planner: makePlanner([aiPlan]), verifier: aiVerifier, cache: aiCache, plannerConfig: cfg }),
      makeStepContext(),
    )
    expect(aiCache.setCalls).toBe(0)
    expect((aiResult.evidence as { cacheStatus?: string }).cacheStatus).toBe('bypass')

    // Control — a completing non-AI plan writes (the baseline the bypass is measured against).
    const ctlCache = makeCountingCache()
    const ctlPlan = makeActionPlan({ action: { type: 'click', ref: 'e2' }, stepComplete: true })
    await executeStep(
      'Click submit',
      ports({ adapter: recordingAdapter(makeScreenState(), []), planner: makePlanner([ctlPlan]), cache: ctlCache, plannerConfig: cfg }),
      makeStepContext(),
    )
    expect(ctlCache.setCalls).toBeGreaterThanOrEqual(1)
  })
})
