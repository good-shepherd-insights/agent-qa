// C438-REORDERED-ROWS (438 D-09, SC2): what happens when the rows the planner looked at change
// before its action reaches the page. Real headless Chromium through the real runner loop; pages
// are inline snippets. This file holds the navigated leg; 438-07, 438-08 and 438-09 add legs.

import { afterEach, describe, expect, it } from 'vitest'
import type { Action, ExecuteOptions, PlannerConfig } from '@vostride/agent-qa-runner'
import { readBindingOutcomeMeta } from '@vostride/agent-qa-schema'
import { WebPlatformAdapter } from '../adapter.js'
import {
  act,
  giveUp,
  refFor,
  runScriptedStep,
  scriptedPlanner,
  scriptedVerifier,
} from './fixtures/436-scripted-loop.js'

const LIMITS: PlannerConfig = { maxActions: 30, maxPlanningTurns: 30, previousStepCount: 0 }

const ROWS_PAGE = `<!doctype html><html><head><script>window.__clicks = []</script></head><body>
  <ul id="addresses">
    <li id="elm">
      <p><strong>Work</strong></p>
      <p>7 Elm Street, Springfield</p>
      <button type="button" onclick="window.__clicks.push('7 Elm Street, Springfield')">Edit label</button>
    </li>
    <li>
      <p><strong>Home</strong></p>
      <p>1 Home Street, Springfield</p>
      <button type="button" onclick="window.__clicks.push('1 Home Street, Springfield')">Edit label</button>
    </li>
    <li>
      <p><strong>Old</strong></p>
      <p>9 Oak Road, Springfield</p>
      <button type="button" onclick="window.__clicks.push('9 Oak Road, Springfield')">Edit label</button>
    </li>
  </ul>
</body></html>`

const ELM_TARGET = { role: 'button', name: 'Edit label', row: '7 Elm Street' }

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

async function pageClicks(web: WebPlatformAdapter): Promise<string[]> {
  return web.getPage()!.evaluate(() => (globalThis as unknown as { __clicks: string[] }).__clicks)
}

interface Navigating {
  adapter: WebPlatformAdapter
  /** The new document's `__clicks`, read right after the first dispatch returned. */
  clicksAfterFirst: () => string[] | undefined
}

// Loads a new document holding `html` once, right before the first dispatch reaches the adapter.
// `page.goto` is a real navigation; `page.setContent` would keep the document.
function navigatingBeforeDispatch(web: WebPlatformAdapter, html: string): Navigating {
  let navigated = false
  let clicksAfterFirst: string[] | undefined
  const proxy = new Proxy(web, {
    get(target, property) {
      if (property === 'execute') {
        return async (action: Action, options?: ExecuteOptions) => {
          if (navigated) return target.execute(action as never, options)
          navigated = true
          await target.getPage()!.goto('data:text/html,' + encodeURIComponent(html))
          const result = await target.execute(action as never, options)
          clicksAfterFirst = await pageClicks(target)
          return result
        }
      }
      const value: unknown = Reflect.get(target, property, target)
      return typeof value === 'function'
        ? (value as (...args: unknown[]) => unknown).bind(target)
        : value
    },
  })
  return { adapter: proxy, clicksAfterFirst: () => clicksAfterFirst }
}

const passes = scriptedVerifier(() => ({ pass: true, reason: 'the click landed' }))

describe('C438-REORDERED-ROWS', () => {
  it('navigated: stale-observation, nothing sent, never healed', async () => {
    const web = await open(ROWS_PAGE)
    const navigating = navigatingBeforeDispatch(web, ROWS_PAGE)
    const editElm = (screen: Parameters<typeof refFor>[0]) => act(
      { type: 'click', ref: refFor(screen, 'button', 'Edit label', 0), target: ELM_TARGET },
      true,
      'Edit the Elm Street label',
    )
    const planner = scriptedPlanner([
      editElm,
      editElm,
      () => giveUp('the Elm Street label could not be edited'),
    ])
    const run = await runScriptedStep({
      adapter: navigating.adapter,
      instruction: "Edit the label of the address '7 Elm Street'",
      planner,
      verifier: passes,
      plannerConfig: LIMITS,
    })

    const [first, second] = run.result.evidence!.subActions
    expect(first.result.success).toBe(false)
    expect(first.result.error).toMatch(/^stale-observation:/)
    expect(readBindingOutcomeMeta(first.result)).toEqual({
      outcome: 'stale-observation',
      ref: (first.plannedAction as { ref?: string }).ref,
      inputSent: false,
    })
    const stages = (first.grounding?.attempts ?? []).map((attempt) => attempt.stage)
    expect(stages).not.toContain('tree-search')
    expect(navigating.clicksAfterFirst()).toEqual([])

    expect(second.result.success).toBe(true)
    expect(await pageClicks(web)).toEqual(['7 Elm Street, Springfield'])
    expect(planner.calls).toBe(2)
    expect(run.executed).toHaveLength(2)
    expect(run.result.status).toBe('passed')
  }, 90_000)
})
