// C438-NATIVE-BINDING (438 D-06, D-07, SC2, SC3): the web adapter keeps the element the planner
// observed through Playwright's native aria-ref and re-checks it before dispatch. A row moved
// between observation and dispatch is followed, never substituted by the row now at its old
// position, and an exact name beside a near-twin resolves. Real headless Chromium through the real
// loop; pages are inline snippets.

import { afterEach, describe, expect, it } from 'vitest'
import type { Action, ExecuteOptions, PlannerConfig } from '@vostride/agent-qa-runner'
import { asRef } from '@vostride/agent-qa-runner'
import { WebPlatformAdapter } from '../adapter.js'
import type { RefMap } from '../types.js'
import {
  act,
  giveUp,
  refFor,
  runScriptedStep,
  scriptedPlanner,
  scriptedVerifier,
} from './fixtures/436-scripted-loop.js'

const LIMITS: PlannerConfig = { maxActions: 30, maxPlanningTurns: 30, previousStepCount: 0 }

const ADDRESSES_PAGE = `<!doctype html><html><head><script>window.__clicks = []</script></head><body>
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

const INVOICES_PAGE = `<!doctype html><html><head><script>window.__clicks = []</script></head><body>
  <a href="#invoice-947" onclick="window.__clicks.push('Invoice 947')">Invoice 947</a>
  <a href="#invoice-946" onclick="window.__clicks.push('Invoice 946')">Invoice 946</a>
</body></html>`

// The Elm row's own li moves to the end of its list: the same nodes, a new position.
const MOVE_ELM_TO_BOTTOM = `(() => {
  const elm = document.getElementById('elm')
  elm.parentElement.appendChild(elm)
})()`

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

function refMapOf(web: WebPlatformAdapter): RefMap {
  return (web as unknown as { lastRefs: RefMap }).lastRefs
}

// Runs a page script once, right before the first dispatch reaches the adapter.
function changingBeforeDispatch(web: WebPlatformAdapter, script: string): WebPlatformAdapter {
  let changed = false
  return new Proxy(web, {
    get(target, property) {
      if (property === 'execute') {
        return async (action: Action, options?: ExecuteOptions) => {
          if (!changed) {
            changed = true
            await target.getPage()!.evaluate(script)
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

const passes = scriptedVerifier(() => ({ pass: true, reason: 'the click landed' }))

describe('C438-NATIVE-BINDING', () => {
  it('a moved row is followed, never the row now at its old position', async () => {
    const web = await open(ADDRESSES_PAGE)
    const planner = scriptedPlanner([
      (screen) => act(
        {
          type: 'click',
          ref: refFor(screen, 'button', 'Edit label', 0),
          target: { role: 'button', name: 'Edit label', row: '7 Elm Street' },
        },
        true,
        'Edit the Elm Street label',
      ),
      () => giveUp('the Elm Street label could not be edited'),
    ])
    const run = await runScriptedStep({
      adapter: changingBeforeDispatch(web, MOVE_ELM_TO_BOTTOM),
      instruction: "Edit the label of the address '7 Elm Street'",
      planner,
      verifier: passes,
      plannerConfig: LIMITS,
    })

    expect(await pageClicks(web)).toEqual(['7 Elm Street, Springfield'])
    expect(planner.calls).toBe(1)
    expect(run.executed).toHaveLength(1)
    expect(run.result.status).toBe('passed')
  }, 90_000)

  it('the resolver defect: Invoice 946 beside Invoice 947 is clicked', async () => {
    const web = await open(INVOICES_PAGE)
    const planner = scriptedPlanner([
      (screen) => act(
        {
          type: 'click',
          ref: refFor(screen, 'link', 'Invoice 946'),
          target: { role: 'link', name: 'Invoice 946' },
        },
        true,
        'Open invoice 946',
      ),
      () => giveUp('invoice 946 could not be opened'),
    ])
    const run = await runScriptedStep({
      adapter: web,
      instruction: 'Open Invoice 946',
      planner,
      verifier: passes,
      plannerConfig: LIMITS,
    })

    expect(await pageClicks(web)).toEqual(['Invoice 946'])
    expect(run.executed).toHaveLength(1)
    expect(run.result.status).toBe('passed')
  }, 90_000)

  it('an unchanged page dispatches through aria-ref', async () => {
    const web = await open(ADDRESSES_PAGE)
    const state = await web.observe()
    const ref = refFor(state, 'button', 'Edit label', 0)
    const entry = refMapOf(web)[ref] as Record<string, unknown> | undefined

    expect(entry).toBeDefined()
    expect(entry!['nativeRef']).toMatch(/^e\d+$/)
    expect(entry!['role']).toBe('button')
    expect(entry!['name']).toBe('Edit label')
    expect(entry!['rowText']).toBe('Work 7 Elm Street, Springfield Edit label')

    const result = await web.execute({ type: 'click', ref: asRef(ref) } as never)

    expect(result.success).toBe(true)
    expect(await pageClicks(web)).toEqual(['7 Elm Street, Springfield'])
  }, 60_000)
})
