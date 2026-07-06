// CYCLE-01..03 + WM-01/02 requirement roll-call (Phase 358, Plan 09 close-out).
// A single durable regression anchor: each phase acceptance criterion maps to at least one
// GREEN assertion here over the SHIPPED runner progress + working-memory surface — the pure
// oracle/classifier/tree/revisitation machinery (../progress), the run-scoped
// WorkingMemoryStore (../working-memory), the executeStep composition (../index), and the
// planner ban gate (../planner) — the same surfaces the per-plan suites exercise
// (progress-oracle, stagnation-tree, stagnation-classifier, revisitation, stagnation-ban,
// working-memory, working-memory-loop, cycle-detection, plan-fields, cli/wm-flush). This is
// NOT a re-implementation. Do NOT weaken any assertion to force a pass; if a criterion cannot
// be proven green, the phase is not done. Mirrors the 356-07 / 357-08 roll-call idiom (one
// describe per requirement, direct assertions, a delegate anchor for the CLI-composed leg).
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

import type { ScreenState, WorkingMemoryEntry, MaskingContext } from '@vostride/agent-qa-schema'
import type { ModelMessage } from 'ai'

import type { PlatformAdapter, Action, ActionResult } from '../../platform.js'
import type { LoopPorts } from '../ports.js'
import type { Planner, PlanResult, StepContext } from '../types.js'

import { executeStep } from '../index.js'
import { evaluateLocalEffect } from '../progress/oracle.js'
import {
  classifyStagnation,
  StagnationTree,
  buildAnchorKey,
  RevisitationWindow,
  DEFAULT_STAGNATION_ANCHOR_BOUND,
  DEFAULT_REVISITATION_WINDOW,
} from '../progress/index.js'
import { WorkingMemoryStore } from '../working-memory/store.js'
import { composeTurnMessages } from '../prompts.js'
import { LLMPlanner } from '../planner.js'
import { makeScreenState } from '../../testing/screen-fixtures.js'
import { buildAgentScreenState, type LooseElement } from './screen-fixtures.js'
import { makeActionPlan, makeStepContext, makeVerifier, makeFakeTokenAccounting } from './loop-harness.js'
import { ToolRegistry } from '../../tools/registry.js'
import { registerAllActions } from '../../tools/actions/index.js'
import { toolCallToActionPlan } from '../../tools/builder.js'

// ai.generateText is mocked so the CYCLE-02 longpress-ban bounce drives the real planner gate
// with scripted tool calls (mirrors stagnation-ban.test.ts). The pure oracle/tree/store tests
// never touch 'ai', so the mock is inert for them.
vi.mock('ai', async (importActual) => {
  const actual = await importActual<typeof import('ai')>()
  return { ...actual, generateText: vi.fn() }
})

const testFilePath = fileURLToPath(import.meta.url)
// __tests__ -> loop -> src -> runner -> packages
const packagesRoot = resolve(dirname(testFilePath), '..', '..', '..', '..')

function ports(overrides: Partial<LoopPorts> & Pick<LoopPorts, 'adapter' | 'planner'>): LoopPorts {
  return overrides
}

function renderTurn(messages: ModelMessage[]): string {
  return messages
    .map((m) =>
      typeof m.content === 'string'
        ? m.content
        : m.content.map((p) => ('text' in p && typeof p.text === 'string' ? p.text : '')).join(''),
    )
    .join('\n')
}

function wmContext(entries: WorkingMemoryEntry[]): StepContext {
  return {
    stepInstruction: 'Enter the OTP',
    testName: 'wm roll-call',
    previousSteps: [],
    plannerModel: {} as never,
    verifierModel: {} as never,
    workingMemory: entries,
  } as unknown as StepContext
}

// -----------------------------------------------------------------------------
// CYCLE-01 — differential-observation intended-effect oracle
// -----------------------------------------------------------------------------
describe('CYCLE-01 — after each action the local intended effect is verified via differential observation (never flagged on repetition)', () => {
  it('a byte-identical repeated action with a confirmed local effect is achieved — judged only on its own before→current diff, no action history', () => {
    const before = makeScreenState({ url: 'https://x.test/a' })
    const after = makeScreenState({ url: 'https://x.test/b' })
    // The SAME navigate emitted twice: the oracle takes NO history — each is judged on its
    // own differential inputs (previous + current state only), so a genuine url change reads
    // as progress both times.
    const action = { type: 'navigate', url: 'https://x.test/b' }
    const first = evaluateLocalEffect({ action, stateBefore: before, stateAfter: after, prevHash: 'H1', currentHash: 'H2' })
    const second = evaluateLocalEffect({ action, stateBefore: before, stateAfter: after, prevHash: 'H1', currentHash: 'H2' })
    expect(first).toEqual({ verbClass: 'navigate', oracle: 'navigate', achieved: true })
    expect(second.achieved).toBe(true)

    // A checkable tap whose toggle state flips is progress via the tap row (the §12.16(a)
    // checkable-target signal), byte-identical repetition notwithstanding.
    const anchor = { role: 'checkbox', nameNormalized: 'remember me', ordinal: 0 }
    const unchecked = makeScreenState({
      elements: [{ ref: 'e1' as never, role: 'checkbox', name: 'Remember me', nameNormalized: 'remember me', state: { enabled: true, focused: false, visible: true, checked: false }, labels: {}, attributes: {} }],
    })
    const checked = makeScreenState({
      elements: [{ ref: 'e1' as never, role: 'checkbox', name: 'Remember me', nameNormalized: 'remember me', state: { enabled: true, focused: false, visible: true, checked: true }, labels: {}, attributes: {} }],
    })
    const tap = evaluateLocalEffect({ action: { type: 'tap' }, anchor, stateBefore: unchecked, stateAfter: checked, prevHash: 'H', currentHash: 'H' })
    expect(tap).toEqual({ verbClass: 'tap', oracle: 'tap', achieved: true })

    // The differential contract, negatively: an identical before===after diff is absent —
    // proving the verdict is purely differential, not a repetition heuristic and not
    // carried across calls.
    const noEffect = evaluateLocalEffect({ action, stateBefore: after, stateAfter: after, prevHash: 'H2', currentHash: 'H2' })
    expect(noEffect.achieved).toBe(false)
  })
})

// -----------------------------------------------------------------------------
// CYCLE-02 — identity-keyed bounded stagnation tree + banned anti-patterns
// -----------------------------------------------------------------------------
const BAN_ENVELOPE = { reasoning: 'act', confidence: 0.9, stepComplete: true, doesActionAdvanceUsTowardsGoal: true }
const BANNED_LOGIN = { stagnation: { bannedSubstitutions: [{ anchorKey: 'button|log in|0', banned: 'longpress', required: 'tap' }] } }

function banContext(): StepContext {
  return {
    stepInstruction: 'Interact with Log in',
    testName: 'ban roll-call',
    previousSteps: [],
    plannerModel: {} as never,
    verifierModel: {} as never,
    ...BANNED_LOGIN,
  } as unknown as StepContext
}

describe('CYCLE-02 — absent local effect increments a per-element, identity-keyed bounded stagnation tree with banned anti-patterns', () => {
  it('a no-effect sequence walks one anchor to its bound while a sibling anchor stays untouched and a confirmed effect resets it (the LOOP-02 distinction)', () => {
    const tree = new StagnationTree()
    const A = buildAnchorKey({ role: 'button', nameNormalized: 'delete', ordinal: 0 })
    const B = buildAnchorKey({ role: 'button', nameNormalized: 'delete', ordinal: 1 }) // a sibling row

    // Classification is a pure typed-signal function; a fresh dialog subtree ⇒ obstruction.
    const withDialog = makeScreenState({
      elements: [{ ref: 'e9' as never, role: 'dialog', name: 'Confirm', nameNormalized: 'confirm', state: { enabled: true, focused: false, visible: true }, labels: {}, attributes: {} }],
    })
    expect(classifyStagnation({ stateBefore: makeScreenState(), stateAfter: withDialog })).toBe('obstruction')

    // Walk anchor A to its per-anchor terminal bound (4); the sibling B is unaffected.
    let terminal = false
    for (let i = 0; i < DEFAULT_STAGNATION_ANCHOR_BOUND; i++) {
      terminal = tree.recordNoEffect(A, i < 2 ? 'off-screen' : 'obstruction').terminal
    }
    expect(terminal).toBe(true)
    const sibling = tree.recordNoEffect(B, 'off-screen')
    expect(sibling.totalCount).toBe(1)
    expect(sibling.terminal).toBe(false)

    // A confirmed local effect resets A's counts — a legitimately-retried control is never
    // penalized for earlier no-ops (reset-on-progress, NOT a blanket step counter).
    tree.reset(A)
    const afterReset = tree.recordNoEffect(A, 'off-screen')
    expect(afterReset.classCount).toBe(1)
    expect(afterReset.totalCount).toBe(1)
    expect(afterReset.terminal).toBe(false)
  })

  it('the longpress-for-tap substitution on a stagnating anchor bounces to a §7.1 structured is_error and the corrected tap lands in the same turn', async () => {
    const { generateText } = await import('ai')
    const mock = vi.mocked(generateText)
    mock.mockResolvedValueOnce({ toolCalls: [{ toolName: 'mobile_longpress', input: { ref: 'e2', ...BAN_ENVELOPE } }], usage: { inputTokens: 10, outputTokens: 2 } } as never)
    mock.mockResolvedValueOnce({ toolCalls: [{ toolName: 'mobile_tap', input: { ref: 'e2', ...BAN_ENVELOPE } }], usage: { inputTokens: 10, outputTokens: 2 } } as never)

    const planner = new LLMPlanner({} as never, 'ios', undefined, undefined, makeFakeTokenAccounting())
    const result = await planner.plan('Interact with Log in', makeScreenState(), banContext())

    expect(mock).toHaveBeenCalledTimes(2) // the ban bounced the longpress in the same turn (§7.1 self-correction)
    expect(result.plan.action.type).toBe('tap')
  })
})

// -----------------------------------------------------------------------------
// CYCLE-03 — true-cycle detection (combined rule) + bulk-loop budget refresh
// -----------------------------------------------------------------------------
function listScreen(count: number): ScreenState {
  const rows: LooseElement[] = []
  for (let i = 0; i < count; i++) {
    rows.push({ role: 'button', name: `Delete row ${i}`, bounds: { x: 20, y: 80 + i * 44, width: 300, height: 40 } })
  }
  return buildAgentScreenState({ url: 'https://x.test/list', elements: rows, metadata: { coordSpace: 'viewport', viewportWidth: 390, viewportHeight: 844 } })
}

// A screen is stable across the settle gate's polls within one iteration and only changes
// after an action lands: the observation index advances on EXECUTE, so one confirmed local
// effect (one row gone) is visible per iteration — the realistic settle-gate model.
function countingAdapter(observeResults: ScreenState[], onExecute: () => void): PlatformAdapter {
  let step = 0
  return {
    platform: 'web',
    async setup() {},
    async cleanup() {},
    async observe() {
      return observeResults[Math.min(step, observeResults.length - 1)]
    },
    async execute(_action: Action): Promise<ActionResult> {
      onExecute()
      step++
      return { success: true }
    },
  }
}

describe('CYCLE-03 — a cycle is flagged only on revisitation AND no task progress; bulk loops complete with a refreshed budget', () => {
  it('the combined rule flags a revisit with zero in-window progress where repetition alone (or a revisit with progress) never does', () => {
    expect(DEFAULT_REVISITATION_WINDOW).toBe(5)

    // Revisited key + zero confirmed progress across the window ⇒ flagged.
    const flagging = new RevisitationWindow()
    let flagged = false
    for (const step of [
      { key: 'A', progress: false },
      { key: 'B', progress: false },
      { key: 'A', progress: false },
    ]) {
      if (flagging.record(step).flagged) flagged = true
    }
    expect(flagged).toBe(true)

    // Repetition alone never flags: a revisit that carries confirmed progress in-window is
    // never flagged (the "delete all" pagination that hash-collides but keeps progressing).
    const progressing = new RevisitationWindow()
    let flaggedWithProgress = false
    for (const step of [
      { key: 'A', progress: false },
      { key: 'B', progress: true },
      { key: 'A', progress: false },
    ]) {
      if (progressing.record(step).flagged) flaggedWithProgress = true
    }
    expect(flaggedWithProgress).toBe(false)
  })

  it('a bulk "delete all 10 items" sequence completes past the initial budget (D-10 refresh) with no cycle flag', async () => {
    const INITIAL_BUDGET = 4
    // 11 shrinking observations (10 → 0), a confirmed delete visible between each.
    const observes: ScreenState[] = []
    for (let n = 10; n >= 0; n--) observes.push(listScreen(n))

    let executeCount = 0
    // Byte-IDENTICAL delete every turn (CYCLE-01: repetition that IS the task), then complete.
    const plans = Array.from({ length: 10 }, () => makeActionPlan({ action: { type: 'click', ref: 'e1' }, stepComplete: false }))
    plans.push(makeActionPlan({ action: { type: 'click', ref: 'e1' }, stepComplete: true }))
    let call = 0
    const planner: Planner = {
      async plan(): Promise<PlanResult> {
        const p = plans[Math.min(call, plans.length - 1)]
        call++
        return { plan: p }
      },
    }

    const result = await executeStep(
      'Delete all rows',
      ports({
        adapter: countingAdapter(observes, () => { executeCount++ }),
        planner,
        verifier: makeVerifier(),
        plannerConfig: { maxSubActions: INITIAL_BUDGET, previousStepCount: 0 },
      }),
      makeStepContext(),
    )

    expect(result.status).toBe('passed')
    // The refresh proves itself: more successful iterations ran than the initial budget, with
    // no cycle terminal — the bulk loop is not a flat cap.
    expect(executeCount).toBeGreaterThan(INITIAL_BUDGET)
    expect((result.evidence as { cycle?: unknown } | undefined)?.cycle).toBeUndefined()
  })
})

// -----------------------------------------------------------------------------
// WM-01 — run-scoped working memory: builder → store → verbatim turn → masked snapshot
// -----------------------------------------------------------------------------
const OTP: WorkingMemoryEntry = { key: 'otp', value: '4821', kind: 'extracted-value', provenance: 'observation' }

describe('WM-01 — remember[] round-trips builder → store → verbatim turn content → masked StepEvidence snapshot with exact-key latest-wins recall', () => {
  it('a remember[] plan-field survives the v45 PLAN_FIELDS merge onto the returned plan (never leaking into plan.action)', () => {
    const registry = new ToolRegistry()
    registerAllActions(registry)
    const result = toolCallToActionPlan(
      'web_click',
      { reasoning: 'act', confidence: 0.9, stepComplete: false, ref: 'e1', remember: [OTP] },
      registry,
    ) as Record<string, unknown>
    expect(result.remember).toEqual([OTP])
    expect(result.action).toEqual({ type: 'click', ref: 'e1' })
    expect(result.action).not.toHaveProperty('remember')
  })

  it('the store keeps one current value per key (latest-wins) and serves it verbatim as structured turn content', () => {
    const store = new WorkingMemoryStore()
    store.capture([OTP], { step: 0 })
    store.capture([{ ...OTP, value: '9999' }], { step: 1 }) // OTP resend — latest wins (D-12)
    const otpEntries = store.entries().filter((e) => e.key === 'otp')
    expect(otpEntries).toHaveLength(1)
    expect(otpEntries[0].value).toBe('9999')

    const turn = renderTurn(composeTurnMessages(wmContext(store.entries()), makeScreenState()))
    expect(turn).toContain('otp')
    expect(turn).toContain('9999')
    expect(turn).toContain('extracted-value')
    expect(turn).toContain('observation')
  })

  it('executeStep captures remember[] and snapshots the served set into StepEvidence.workingMemory with masked values (beside servedBrief)', async () => {
    const store = new WorkingMemoryStore()
    const fakeMasking = { mask: (t: string) => `MASKED(${t})`, unmask: (t: string) => t } as unknown as MaskingContext
    const planner: Planner = {
      async plan(): Promise<PlanResult> {
        return { plan: makeActionPlan({ action: { type: 'click', ref: 'e2' }, remember: [OTP], stepComplete: true } as never) }
      },
    }
    const result = await executeStep(
      'Capture the OTP then finish',
      ports({
        adapter: countingAdapter([makeScreenState(), makeScreenState()], () => {}),
        planner,
        verifier: makeVerifier(),
        workingMemory: store,
        masking: fakeMasking,
      } as never),
      makeStepContext(),
    )
    expect(result.status).toBe('passed')
    const snapshot = (result.evidence as { workingMemory?: { value: string }[] } | undefined)?.workingMemory
    expect(Array.isArray(snapshot)).toBe(true)
    expect(snapshot?.some((e) => e.value === 'MASKED(4821)')).toBe(true) // masked, never verbatim
  })
})

// -----------------------------------------------------------------------------
// WM-02 — disposal + redacted flush into the run artifact (delegate anchor, 357-08 precedent)
// -----------------------------------------------------------------------------
describe('WM-02 — working memory is disposed at run end and flushed redacted through the masking/guardrail layer into the run artifact', () => {
  // The flush is a CLI-composed leg (node:fs artifact write + assertCommittedEgressSafe): its
  // behavioural proof lives in the cli/wm-flush suite (masked values, PEM blocked-entry
  // fingerprint, store.dispose(), never-throws). Here we anchor the criterion two ways —
  // pointer over the shipped contract suite + a grep-style source assertion that the helper is
  // wired at BOTH CLI composition roots — the same delegate pattern the 357-08 LOOP-04 leg used.
  it('the flush contract suite exists and pins the masked/blocked/dispose contract (pointer anchor)', () => {
    const suite = readFileSync(resolve(packagesRoot, 'cli', 'src', '__tests__', 'wm-flush.test.ts'), 'utf8')
    expect(suite).toContain('flushWorkingMemory')
    expect(suite).toContain('assertCommittedEgressSafe')
    expect(suite).toMatch(/dispose/)
    expect(suite).toMatch(/MASKED\(4821\)/)
  })

  it('flushWorkingMemory is wired at both CLI composition paths (suite-run + single-run) (grep-style source anchor)', () => {
    const runSource = readFileSync(resolve(packagesRoot, 'cli', 'src', 'commands', 'run.ts'), 'utf8')
    expect(runSource).toContain("import { flushWorkingMemory } from '../wm-flush.js'")
    const callSites = runSource.split('flushWorkingMemory(').length - 1
    expect(callSites).toBeGreaterThanOrEqual(2) // both the multi-test suite path and the single-test path flush + dispose
  })
})

// -----------------------------------------------------------------------------
// Frozen catalog — the phase's new plan-fields register NO tools (counts unchanged)
// -----------------------------------------------------------------------------
describe('frozen tool catalog — CYCLE/WM plan-fields register no tools', () => {
  it('keeps 56 registered / web 33 / android 30 / ios 27', () => {
    const registry = new ToolRegistry()
    registerAllActions(registry)
    expect(registry.getAll()).toHaveLength(56)
    expect(registry.getForPlatform('web')).toHaveLength(33)
    expect(registry.getForPlatform('android')).toHaveLength(30)
    expect(registry.getForPlatform('ios')).toHaveLength(27)
  })
})
