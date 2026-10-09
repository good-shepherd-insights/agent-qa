// C438-STATED-TARGET (438 D-01, D-03, D-04, D-05, SC1): model-free acceptance of the stated-target
// check through the real runner loop and a real headless Chromium. A scripted planner sends a ref
// plus the element it means; the loop dispatches it when the two agree and refuses it, sending
// nothing and substituting nothing, when they clearly contradict. Pages are inline snippets.

import { afterEach, describe, expect, it } from 'vitest'
import type { PlannerConfig } from '@vostride/agent-qa-runner'
import { WebPlatformAdapter } from '../adapter.js'
import {
  act,
  giveUp,
  refFor,
  runScriptedStep,
  scriptedPlanner,
  scriptedVerifier,
} from './fixtures/436-scripted-loop.js'
import type { ScriptedStepRun } from './fixtures/436-scripted-loop.js'

const LIMITS: PlannerConfig = { maxActions: 30, maxPlanningTurns: 30, previousStepCount: 0 }

const EVENT_LOG = `<script>
  window.__events = []
  for (const el of document.querySelectorAll('button, input, a')) {
    for (const type of ['click', 'focus']) {
      el.addEventListener(type, () => window.__events.push({ id: el.id, type }))
    }
  }
</script>`

const SUBMIT_PAGE = `<!doctype html><html><body>
  <form onsubmit="return false">
    <input id="field" type="text">
    <button id="submit" type="button">Submit</button>
  </form>
  ${EVENT_LOG}
</body></html>`

const INVOICES_PAGE = `<!doctype html><html><body>
  <ul>
    <li><a id="inv946" href="#invoice-946">Invoice 946</a></li>
    <li><a id="inv947" href="#invoice-947">Invoice 947</a></li>
  </ul>
  ${EVENT_LOG}
</body></html>`

const SIGN_IN_PAGE = `<!doctype html><html><body>
  <button id="signin" type="button">Sign in</button>
  ${EVENT_LOG}
</body></html>`

interface PageEvent {
  id: string
  type: string
}

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
    throw new Error('Real Chromium required: run `pnpm exec playwright install chromium`', {
      cause: error,
    })
  }
  adapter = created
  await created.getPage()!.setContent(html)
  return created
}

async function events(web: WebPlatformAdapter): Promise<PageEvent[]> {
  return web.getPage()!.evaluate(() => (globalThis as unknown as { __events: PageEvent[] }).__events)
}

function clicks(log: readonly PageEvent[]): PageEvent[] {
  return log.filter((entry) => entry.type === 'click')
}

function refusalOf(run: ScriptedStepRun): Record<string, unknown> | undefined {
  const first = run.result.evidence!.subActions[0]
  return first.result.metadata?.['targetRefusal'] as Record<string, unknown> | undefined
}

const passes = scriptedVerifier(() => ({ pass: true, reason: 'the click landed' }))

describe('C438-STATED-TARGET', () => {
  it('a stated target that agrees with its ref is clicked', async () => {
    const web = await open(SUBMIT_PAGE)
    const planner = scriptedPlanner([
      (screen) => act(
        {
          type: 'click',
          ref: refFor(screen, 'button', 'Submit'),
          target: { role: 'button', name: 'Submit' },
        },
        true,
        'Submit the form',
      ),
    ])
    const run = await runScriptedStep({
      adapter: web,
      instruction: 'Click Submit',
      planner,
      verifier: passes,
      plannerConfig: LIMITS,
    })

    expect(run.result.status).toBe('passed')
    expect(run.executed).toHaveLength(1)
    expect(clicks(await events(web))).toEqual([{ id: 'submit', type: 'click' }])
    expect(refusalOf(run)).toBeUndefined()
  }, 60_000)

  it('the MiniWoB shape is refused: Submit stated, an empty textbox ref', async () => {
    const web = await open(SUBMIT_PAGE)
    const planner = scriptedPlanner([
      (screen) => act(
        {
          type: 'click',
          ref: refFor(screen, 'textbox', ''),
          target: { role: 'button', name: 'Submit' },
        },
        true,
        'Submit the form',
      ),
      () => giveUp('The Submit button could not be clicked'),
    ])
    const run = await runScriptedStep({
      adapter: web,
      instruction: 'Click Submit',
      planner,
      verifier: passes,
      plannerConfig: LIMITS,
    })

    expect(run.executed).toHaveLength(0)
    expect(await events(web)).toEqual([])
    const first = run.result.evidence!.subActions[0]
    expect(first.result.success).toBe(false)
    expect(first.result.error).toMatch(/^target-mismatch: /)
    const refusal = refusalOf(run)
    expect(refusal).toMatchObject({
      kind: 'target-mismatch',
      lane: 'ref',
      path: 'live',
      stated: { role: 'button', name: 'Submit' },
      observed: { role: 'textbox', name: '' },
      inputSent: false,
    })
    expect(refusal?.['reasons']).toContain('role-kind')
    expect(planner.calls).toBe(2)
  }, 60_000)

  it('"Invoice 947" stated against "Invoice 946" is refused', async () => {
    const web = await open(INVOICES_PAGE)
    const planner = scriptedPlanner([
      (screen) => act(
        {
          type: 'click',
          ref: refFor(screen, 'link', 'Invoice 946'),
          target: { role: 'link', name: 'Invoice 947' },
        },
        true,
        'Open invoice 947',
      ),
      () => giveUp('Invoice 947 could not be opened'),
    ])
    const run = await runScriptedStep({
      adapter: web,
      instruction: 'Open invoice 947',
      planner,
      verifier: passes,
      plannerConfig: LIMITS,
    })

    expect(run.executed).toHaveLength(0)
    expect(clicks(await events(web))).toEqual([])
    const refusal = refusalOf(run)
    expect(refusal).toMatchObject({
      kind: 'target-mismatch',
      stated: { role: 'link', name: 'Invoice 947' },
      observed: { role: 'link', name: 'Invoice 946' },
      inputSent: false,
    })
    expect(refusal?.['reasons']).toContain('name-number')
  }, 60_000)

  it('a paraphrase is not a contradiction', async () => {
    const web = await open(SIGN_IN_PAGE)
    const planner = scriptedPlanner([
      (screen) => act(
        {
          type: 'click',
          ref: refFor(screen, 'button', 'Sign in'),
          target: { role: 'button', name: 'Log in' },
        },
        true,
        'Log in',
      ),
    ])
    const run = await runScriptedStep({
      adapter: web,
      instruction: 'Log in',
      planner,
      verifier: passes,
      plannerConfig: LIMITS,
    })

    expect(run.result.status).toBe('passed')
    expect(run.executed).toHaveLength(1)
    expect(clicks(await events(web))).toEqual([{ id: 'signin', type: 'click' }])
    expect(refusalOf(run)).toBeUndefined()
  }, 60_000)

  it('a ref-only action is dispatched as before', async () => {
    const web = await open(SUBMIT_PAGE)
    const planner = scriptedPlanner([
      (screen) =>
        act({ type: 'click', ref: refFor(screen, 'button', 'Submit') }, true, 'Submit the form'),
    ])
    const run = await runScriptedStep({
      adapter: web,
      instruction: 'Click Submit',
      planner,
      verifier: passes,
      plannerConfig: LIMITS,
    })

    expect(run.result.status).toBe('passed')
    expect(run.executed).toHaveLength(1)
    expect(clicks(await events(web))).toEqual([{ id: 'submit', type: 'click' }])
    expect(refusalOf(run)).toBeUndefined()
  }, 60_000)
})
