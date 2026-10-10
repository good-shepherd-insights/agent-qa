// C439-AUTO12 (439 D-16, D-18, SC2): the runner's own checks in real headless Chromium through the
// real loop. A dialog left open, a control short of the limit the screen reports, a narrowed
// re-check standing in for a failed one, and an app's own "Saved" claim each fail to prove their
// condition, while each twin passes. The verifier is written inline and returns the per-condition
// shape; pages are inline snippets, and the persistence pair is served by a loopback server here.

import { afterEach, describe, expect, it } from 'vitest'
import type {
  ConditionJudgment,
  DialogAccount,
  PlannerConfig,
  VerificationResult,
  Verifier,
  VerifyResult,
} from '@vostride/agent-qa-runner'
import type { CitationSource, ScreenState } from '@vostride/agent-qa-schema'
import { WebPlatformAdapter } from '../adapter.js'
import { act, giveUp, refFor, runScriptedStep, scriptedPlanner } from './fixtures/436-scripted-loop.js'
import type { ScriptedTurn } from './fixtures/436-scripted-loop.js'

const LIMITS: PlannerConfig = { maxActions: 30, maxPlanningTurns: 30, previousStepCount: 0 }
const SAVE_STEP = 'Click Save'

const DIALOG_PAGE = (onSave: string) => `<!doctype html><html><body><main>
  <h2 id="status">Draft</h2>
  <button type="button" onclick="document.getElementById('status').textContent = 'Saved'; ${onSave}">Save</button>
  <dialog id="unsaved" aria-label="Unsaved changes"><p>Discard?</p><button type="button">Discard</button></dialog>
</main></body></html>`
const DIALOG_LEFT_OPEN = DIALOG_PAGE("document.getElementById('unsaved').showModal()")
const DIALOG_CLOSED = DIALOG_PAGE(
  "const d = document.getElementById('unsaved'); d.showModal(); d.close()",
)
const COOKIE_PAGE = `<!doctype html><html><body><main>
  <h2 id="status">Draft</h2>
  <button type="button" onclick="document.getElementById('status').textContent = 'Saved'">Save</button>
</main>
<div role="dialog" aria-label="Cookies"><p>We use cookies</p></div>
</body></html>`

const BRIGHTNESS_STEP = 'Set the brightness to its maximum'
const SLIDER_PAGE = (value: number) => `<!doctype html><html><body><main>
  <div role="slider" aria-label="Brightness" aria-valuenow="${value}" aria-valuemin="0" aria-valuemax="65535" tabindex="0">${value}</div>
</main></body></html>`
const VOLUME_STEP = 'Set the volume to its maximum'
const NUMBER_PAGE = `<!doctype html><html><body><main>
  <input type="number" aria-label="Volume" value="50">
</main></body></html>`

let adapter: WebPlatformAdapter | undefined

afterEach(async () => {
  await adapter?.cleanup()
  adapter = undefined
}, 60_000)

async function open(html: string): Promise<WebPlatformAdapter> {
  const created = new WebPlatformAdapter()
  try {
    await created.setup({ platform: 'web', browser: { name: 'chromium', headless: true } })
  } catch (error) {
    throw new Error('Real Chromium required: run `pnpm exec playwright install chromium`', { cause: error })
  }
  adapter = created
  await created.getPage()!.setContent(html)
  return created
}

function condition(
  quote: string,
  citations: { source: CitationSource; quote: string }[],
  overrides: Partial<ConditionJudgment> = {},
): ConditionJudgment {
  return {
    quote,
    verdict: 'met',
    needs: 'none',
    controlRef: '',
    file: { name: '', match: 'none', text: '' },
    citations,
    reasoning: 'The record shows it',
    ...overrides,
  }
}

interface JudgingVerifier extends Verifier {
  readonly calls: number
}

/** A verifier whose per-condition output is computed from the settled final screen it is given. */
function judgingVerifier(judge: (after: ScreenState) => VerificationResult): JudgingVerifier {
  let calls = 0
  return {
    get calls() { return calls },
    async verify(_step, _before, after): Promise<VerifyResult> {
      calls++
      return { verification: judge(after) }
    },
  }
}

function verification(conditions: ConditionJudgment[], dialogs: DialogAccount[] = []): VerificationResult {
  return { conditions, dialogs, isAppError: false, reasoning: 'overall' }
}

const saveMet = (dialogs: DialogAccount[] = []) =>
  judgingVerifier(() => verification([condition(SAVE_STEP, [{ source: 'action', quote: '→ success' }])], dialogs))

const clickSave: ScriptedTurn = (screen) =>
  act({ type: 'click', ref: refFor(screen, 'button', 'Save') }, true, 'Saved the draft')

function thenGiveUp(first: ScriptedTurn, seen: { failureContext?: string }): ScriptedTurn[] {
  return [
    first,
    (_screen, context) => {
      seen.failureContext = context.failureContext
      return giveUp('The step could not be proven')
    },
  ]
}

describe('C439-AUTO12', () => {
  it('a confirmation dialog left open after Save never passes', async () => {
    const web = await open(DIALOG_LEFT_OPEN)
    const seen: { failureContext?: string } = {}

    const run = await runScriptedStep({
      adapter: web, instruction: SAVE_STEP, planner: scriptedPlanner(thenGiveUp(clickSave, seen)), verifier: saveMet(), plannerConfig: LIMITS,
    })

    expect(run.result.status).toBe('failed')
    expect(seen.failureContext).toContain('open dialog "Unsaved changes" was not accounted for')
    const block = run.result.evidence!.conditionVerdicts!
    expect(block.conditions[0].verdict).toBe('met')
    expect(block.openDialogs).toEqual([{ name: 'Unsaved changes', account: 'unaccounted' }])
  }, 60_000)

  it('the same step passes when the dialog is closed', async () => {
    const web = await open(DIALOG_CLOSED)

    const run = await runScriptedStep({
      adapter: web, instruction: SAVE_STEP, planner: scriptedPlanner([clickSave]), verifier: saveMet(), plannerConfig: LIMITS,
    })

    expect(run.result.status).toBe('passed')
    expect(run.result.evidence!.conditionVerdicts!.openDialogs).toBeUndefined()
  }, 60_000)

  it('a cookie banner accounted as unrelated does not block', async () => {
    const web = await open(COOKIE_PAGE)
    const verifier = saveMet([{ name: 'Cookies', account: 'unrelated', reasoning: 'A cookie banner' }])

    const run = await runScriptedStep({
      adapter: web, instruction: SAVE_STEP, planner: scriptedPlanner([clickSave]), verifier, plannerConfig: LIMITS,
    })

    expect(run.result.status).toBe('passed')
    expect(run.result.evidence!.conditionVerdicts!.openDialogs).toEqual([
      { name: 'Cookies', account: 'unrelated' },
    ])
  }, 60_000)

  it('a dialog that bears on a condition blocks', async () => {
    const web = await open(DIALOG_LEFT_OPEN)
    const verifier = saveMet([
      { name: 'Unsaved changes', account: 'bears-on-condition', reasoning: 'The save is not confirmed' },
    ])
    const seen: { failureContext?: string } = {}

    const run = await runScriptedStep({
      adapter: web, instruction: SAVE_STEP, planner: scriptedPlanner(thenGiveUp(clickSave, seen)), verifier, plannerConfig: LIMITS,
    })

    expect(run.result.status).toBe('failed')
    expect(seen.failureContext).toContain('Not met: open dialog "Unsaved changes" bears on a condition')
    expect(run.result.evidence!.conditionVerdicts!.openDialogs).toEqual([
      { name: 'Unsaved changes', account: 'bears-on-condition' },
    ])
  }, 60_000)

  it('a slider short of its maximum is not at its limit', async () => {
    const brightnessMet = judgingVerifier((after) => verification([
      condition(BRIGHTNESS_STEP, [{ source: 'final-screen', quote: 'slider "Brightness"' }], {
        needs: 'limit-max',
        controlRef: refFor(after, 'slider', 'Brightness'),
      }),
    ]))
    const focusSlider: ScriptedTurn = (screen) =>
      act({ type: 'focus', ref: refFor(screen, 'slider', 'Brightness') }, true, 'The brightness is at its maximum')

    const web = await open(SLIDER_PAGE(65272))
    const seen: { failureContext?: string } = {}
    const short = await runScriptedStep({
      adapter: web, instruction: BRIGHTNESS_STEP, planner: scriptedPlanner(thenGiveUp(focusSlider, seen)), verifier: brightnessMet, plannerConfig: LIMITS,
    })
    expect(short.result.status).toBe('failed')
    expect(seen.failureContext).toContain('65272 of 65535')
    expect(short.result.evidence!.conditionVerdicts!.conditions[0]).toMatchObject({
      verdict: 'not-met',
      judged: 'met',
      guard: 'limit',
      reason: '65272 of 65535',
    })

    await web.getPage()!.setContent(SLIDER_PAGE(65535))
    const atMax = await runScriptedStep({
      adapter: web, instruction: BRIGHTNESS_STEP, planner: scriptedPlanner([focusSlider]), verifier: brightnessMet, plannerConfig: LIMITS,
    })
    expect(atMax.result.status).toBe('passed')
    expect(atMax.result.evidence!.conditionVerdicts!.conditions[0].verdict).toBe('met')
  }, 60_000)

  it('a range input reports its value and the default limits', async () => {
    const web = await open('<!doctype html><html><body><input type="range" aria-label="Volume" value="100"></body></html>')
    const screen = await web.observe()
    const range = screen.elements.find((element) => element.ref === refFor(screen, 'slider', 'Volume'))!
    expect(range.attributes).toMatchObject({ valuenow: '100', valuemin: '0', valuemax: '100' })
    expect(screen.tree).not.toContain('valuemax')
  }, 60_000)

  it('a control that reports no limit leaves the condition unverified', async () => {
    const volumeMet = judgingVerifier((after) => verification([
      condition(VOLUME_STEP, [{ source: 'final-screen', quote: 'spinbutton "Volume"' }], {
        needs: 'limit-max',
        controlRef: refFor(after, 'spinbutton', 'Volume'),
      }),
    ]))
    const focusVolume: ScriptedTurn = (screen) =>
      act({ type: 'focus', ref: refFor(screen, 'spinbutton', 'Volume') }, true, 'The volume is at its maximum')

    const web = await open(NUMBER_PAGE)
    const run = await runScriptedStep({
      adapter: web, instruction: VOLUME_STEP, planner: scriptedPlanner(thenGiveUp(focusVolume, {})), verifier: volumeMet, plannerConfig: LIMITS,
    })

    expect(run.result.status).toBe('failed')
    expect(run.result.evidence!.conditionVerdicts!.conditions[0]).toMatchObject({
      verdict: 'unverified',
      judged: 'met',
      guard: 'limit',
    })
  }, 60_000)
})
