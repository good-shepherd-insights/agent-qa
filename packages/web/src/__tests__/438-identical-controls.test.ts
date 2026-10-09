// C438-IDENTICAL-CONTROLS (438 D-12, D-14, SC4): AUTO-15 on two identical 'Okay' buttons. A step
// that does not say which one clicks nothing and ends infeasible naming both; a step that names
// the second clicks the second, and keeps clicking it after the two swap places. Real headless
// Chromium through the real runner loop; the page is an inline snippet.

import { afterEach, describe, expect, it } from 'vitest'
import type { Action, ExecuteOptions, PlannerConfig } from '@vostride/agent-qa-runner'
import type { Ref, ScreenState } from '@vostride/agent-qa-schema'
import { WebPlatformAdapter } from '../adapter.js'
import {
  act,
  refFor,
  runScriptedStep,
  scriptedPlanner,
  scriptedVerifier,
} from './fixtures/436-scripted-loop.js'
import type { ScriptedTurn } from './fixtures/436-scripted-loop.js'

const LIMITS: PlannerConfig = { maxActions: 30, maxPlanningTurns: 30, previousStepCount: 0 }

const OKAY = { role: 'button', name: 'Okay' }

// Each button logs the position it was created at, so a click names the element, not the place.
const TWO_OKAY_PAGE = `<!doctype html><html><head><script>window.__clicks = []</script></head><body>
  <div id="actions">
    <button type="button" onclick="window.__clicks.push('first')">Okay</button>
    <button type="button" onclick="window.__clicks.push('second')">Okay</button>
  </div>
</body></html>`

const opened: WebPlatformAdapter[] = []

afterEach(async () => {
  for (const web of opened.splice(0)) await web.cleanup()
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
  opened.push(created)
  await created.getPage()!.setContent(html)
  return created
}

async function pageClicks(web: WebPlatformAdapter): Promise<string[]> {
  return web.getPage()!.evaluate(() => (globalThis as unknown as { __clicks: string[] }).__clicks)
}

type Page = NonNullable<ReturnType<WebPlatformAdapter['getPage']>>

// The second Okay moves in front of the first; both nodes are kept.
const swapOkays = (page: Page) => page.evaluate(() => {
  type Node = { parentElement: { insertBefore(node: Node, before: Node): void } }
  const doc = (globalThis as unknown as { document: { querySelectorAll(s: string): Node[] } }).document
  const [first, second] = doc.querySelectorAll('#actions > button')
  first.parentElement.insertBefore(second, first)
})

// Changes the page once, right before the first dispatch reaches the adapter.
function changingBeforeDispatch(web: WebPlatformAdapter, change: (page: Page) => Promise<void>) {
  let changed = false
  return new Proxy(web, {
    get(target, property) {
      if (property === 'execute') {
        return async (action: Action, options?: ExecuteOptions) => {
          if (!changed) {
            changed = true
            await change(target.getPage()!)
          }
          return target.execute(action as never, options)
        }
      }
      const value: unknown = Reflect.get(target, property, target)
      return typeof value === 'function'
        ? (value as (...args: unknown[]) => unknown).bind(target)
        : value
    },
  })
}

function okayRefs(screen: ScreenState): Ref[] {
  return screen.elements
    .filter((element) => element.role === OKAY.role && element.name === OKAY.name)
    .map((element) => element.ref)
}

const passes = scriptedVerifier(() => ({ pass: true, reason: 'the click landed' }))

const clickSecondOkay: ScriptedTurn = (screen) => act(
  { type: 'click', ref: refFor(screen, 'button', 'Okay', 1), target: OKAY },
  true,
  'Click the second Okay button',
)

describe('C438-IDENTICAL-CONTROLS', () => {
  it('descriptor path: an ambiguous step clicks nothing', async () => {
    const web = await open(TWO_OKAY_PAGE)
    const failureContexts: (string | undefined)[] = []
    const candidates: Ref[][] = []
    const planner = scriptedPlanner([
      () => act({ type: 'click', target: OKAY }, true, 'Click the Okay button'),
      (screen, context) => {
        failureContexts.push(context.failureContext)
        const refs = okayRefs(screen)
        candidates.push(refs)
        return {
          reasoning: 'Two identical Okay buttons; the step does not say which',
          action: { type: 'delay', ms: 0 },
          confidence: 0.9,
          stepComplete: false,
          stepFailed: true,
          failureKind: 'infeasible',
          failureReason: `The step does not say which Okay button: candidates ${refs.join(' and ')}`,
        }
      },
    ])
    const run = await runScriptedStep({
      adapter: web,
      instruction: 'Click the okay button',
      planner,
      verifier: passes,
      plannerConfig: LIMITS,
    })

    expect(run.executed).toEqual([])
    expect(await pageClicks(web)).toEqual([])
    expect(planner.calls).toBe(2)
    const [refused] = run.result.evidence!.subActions
    expect(refused.result.success).toBe(false)
    expect(refused.result.error).toMatch(/^2 elements match .*the descriptor is ambiguous/)
    expect(failureContexts[0]).toMatch(/2 elements match/)
    expect(candidates[0]).toHaveLength(2)
    const termination = run.result.evidence?.termination
    expect(termination?.kind).toBe('infeasible')
    for (const ref of candidates[0]) expect(termination?.reason).toContain(ref)
    expect(run.result.status).toBe('failed')
  }, 90_000)

  it('"the second okay button" clicks the second', async () => {
    const web = await open(TWO_OKAY_PAGE)
    const planner = scriptedPlanner([clickSecondOkay])
    const run = await runScriptedStep({
      adapter: web,
      instruction: 'Click the second okay button',
      planner,
      verifier: passes,
      plannerConfig: LIMITS,
    })

    expect(await pageClicks(web)).toEqual(['second'])
    expect(run.executed).toHaveLength(1)
    expect(planner.calls).toBe(1)
    expect(run.result.status).toBe('passed')
  }, 90_000)

  it('the second stays the second when they swap', async () => {
    const web = await open(TWO_OKAY_PAGE)
    const planner = scriptedPlanner([clickSecondOkay])
    const run = await runScriptedStep({
      adapter: changingBeforeDispatch(web, swapOkays),
      instruction: 'Click the second okay button',
      planner,
      verifier: passes,
      plannerConfig: LIMITS,
    })

    const order = await web.getPage()!.evaluate(() => {
      const doc = (globalThis as unknown as {
        document: { querySelectorAll(s: string): { getAttribute(name: string): string }[] }
      }).document
      return [...doc.querySelectorAll('#actions > button')].map((b) => b.getAttribute('onclick'))
    })
    expect(order[0]).toContain('second')
    expect(await pageClicks(web)).toEqual(['second'])
    expect(run.executed).toHaveLength(1)
    expect(run.result.status).toBe('passed')
  }, 90_000)
})
