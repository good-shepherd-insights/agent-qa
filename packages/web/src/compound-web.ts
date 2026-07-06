// Web execute() compound behaviors shared by both web execute surfaces (adapter.ts +
// farm-adapter.ts). Phase 359 · EXEC-01/02/03 · D-05..D-09. The runner owns the pure verdict
// machine (compareFillReread) and loop discipline (runUntilVisibleLoop / runDirectionScrollWithRetry
// over injected ScrollPrimitives); this module supplies the Playwright primitives and stitches
// them into ONE ActionResult per compound. Extracted here (inside packages/web/src) so the two
// adapter classes reuse one implementation instead of copy-pasting the compound.

import type { Locator, Page } from 'playwright-core'
import type { ActionResult } from '@vostride/agent-qa-runner'
import {
  compareFillReread,
  runUntilVisibleLoop,
  runDirectionScrollWithRetry,
  interimTreeIdentity,
  type ScrollPrimitives,
  type ScrollUntilVisibleMeta,
  type Direction,
} from '@vostride/agent-qa-runner'
import type { Fill, Scroll, Ref } from '@vostride/agent-qa-schema'
import { parseAriaSnapshot } from './observer.js'
import { scrollWithRef } from './scroll-helper.js'
import type { RefMap } from './types.js'

type BoundingBox = { x: number; y: number; width: number; height: number }

// A value read of the SAME live handle. inputValue() throws for non-input/textarea/select
// targets (Pitfall 8) — fall back to an element value/textContent evaluate; if nothing is
// readable, return undefined so the caller degrades honestly (signal-presence law: never
// fabricate a re-read pair).
export async function safeInputValue(locator: Locator): Promise<string | undefined> {
  try {
    return await locator.inputValue()
  } catch {
    try {
      const value = await locator.evaluate((el) => (el as HTMLInputElement).value ?? el.textContent)
      return typeof value === 'string' ? value : undefined
    } catch {
      return undefined
    }
  }
}

// EXEC-01: clear→type→RE-READ→(Enter) as one compound (D-05/D-06/D-07/D-08).
export async function runWebFillCompound(
  locator: Locator,
  boundingBox: BoundingBox | undefined,
  action: Pick<Fill, 'text' | 'clearMode' | 'submit'>,
): Promise<ActionResult> {
  const isAppend = action.clearMode === 'append'
  // Prior value FIRST (append expects prior + typed, D-07) — before any typing or type probe.
  const prior = isAppend ? (await safeInputValue(locator)) ?? '' : ''
  // Secure detection is web-live: the ARIA snapshot carries no input type (Pitfall 6).
  const secure = (await locator.getAttribute('type')) === 'password'

  if (isAppend) {
    await locator.click()
    await locator.press('End')
    await locator.pressSequentially(action.text)
  } else {
    await locator.fill(action.text)
  }

  const expected = isAppend ? prior + action.text : action.text
  const actual = await safeInputValue(locator)
  const box = boundingBox ? { boundingBox } : {}

  // Unreadable value ⇒ honest success with NO fillReread block (never fabricate, Pitfall 8).
  if (actual === undefined) {
    return { success: true, ...box }
  }

  const verdict = compareFillReread({ expected, actual, secure })
  // Enter AFTER the re-read, only when the text landed (D-07).
  if (verdict.ok && action.submit) {
    await locator.press('Enter')
  }
  return verdict.ok
    ? { success: true, ...box, metadata: { fillReread: verdict.meta } }
    : { success: false, error: verdict.selfCorrectingError, ...box, metadata: { fillReread: verdict.meta } }
}

function deltaFor(direction: Direction, magnitude: number): { dx: number; dy: number; axis: 'horizontal' | 'vertical' } {
  switch (direction) {
    case 'down':
      return { dx: 0, dy: magnitude, axis: 'vertical' }
    case 'up':
      return { dx: 0, dy: -magnitude, axis: 'vertical' }
    case 'right':
      return { dx: magnitude, dy: 0, axis: 'horizontal' }
    case 'left':
      return { dx: -magnitude, dy: 0, axis: 'horizontal' }
  }
}

// rAF settle between gestures — reuses the pre-flip scroll settle discipline.
async function settle(page: Page): Promise<void> {
  await page.evaluate(`new Promise(resolve => {
    const t = setTimeout(() => resolve('timeout'), 500);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      clearTimeout(t);
      resolve('raf');
    }));
  })`)
}

// D-03 light probe + swipe/native primitives. readInterimTree re-runs ONLY the aria-snapshot
// harvest → parseAriaSnapshot(text).nodes — NO buildScreenState, NO refMap mint, NO screenshot;
// lastRefs stays bound to the pre-compound observation.
function buildScrollPrimitives(page: Page, lastRefs: RefMap, magnitude: number): ScrollPrimitives {
  return {
    async swipeOnce(direction: Direction, ref?: Ref): Promise<void> {
      const refData = ref ? lastRefs[ref] : undefined
      const { dx, dy, axis } = deltaFor(direction, magnitude)
      if (refData) {
        await scrollWithRef(page, refData, dx, dy, axis)
      } else {
        await page.mouse.wheel(dx, dy)
      }
      await settle(page)
    },
    async nativeSearchScroll(target: string): Promise<boolean> {
      try {
        await page.getByText(target).first().scrollIntoViewIfNeeded()
        return true
      } catch {
        return false
      }
    },
    async readInterimTree() {
      const tree = await page.locator(':root').ariaSnapshot({ mode: 'ai' })
      return parseAriaSnapshot(tree).nodes
    },
  }
}

const MAX_TO_END_SWIPES = 20

// 'toEnd' termination (RESEARCH Open Q4): swipe until the interim tree stops changing (or cap).
async function scrollToEnd(primitives: ScrollPrimitives, direction: Direction, ref?: Ref): Promise<ScrollUntilVisibleMeta> {
  let swipes = 0
  let anyProgress = false
  let prev = interimTreeIdentity(await primitives.readInterimTree())
  while (swipes < MAX_TO_END_SWIPES) {
    await primitives.swipeOnce(direction, ref)
    swipes += 1
    const current = interimTreeIdentity(await primitives.readInterimTree())
    if (current === prev) break
    anyProgress = true
    prev = current
  }
  return { swipes, reversedOnce: false, outcome: anyProgress ? 'cap' : 'no-change' }
}

// EXEC-02: both schema Scroll modes over the shared loop (D-02/D-03). ONE ActionResult carrying
// metadata.scrollUntilVisible; the gesture itself succeeds — the outcome (found/no-change/cap)
// rides the metadata for the 358 oracle's signal-presence read, not the success flag.
export async function runWebScrollCompound(page: Page, lastRefs: RefMap, action: Scroll): Promise<ActionResult> {
  const viewport = page.viewportSize() ?? { width: 1280, height: 720 }
  const horizontal = action.direction === 'left' || action.direction === 'right'

  if (action.mode === 'untilVisible') {
    const magnitude = horizontal ? viewport.width : viewport.height
    const primitives = buildScrollPrimitives(page, lastRefs, magnitude)
    const { meta } = await runUntilVisibleLoop(primitives, {
      target: action.text,
      direction: action.direction,
      maxSwipes: action.maxSwipes,
      retryOpposite: action.retryOpposite,
      ...(action.ref ? { ref: action.ref } : {}),
    })
    return { success: true, metadata: { scrollUntilVisible: meta } }
  }

  const factor = action.amount === 'halfPage' ? 0.5 : 1
  const magnitude = Math.round((horizontal ? viewport.width : viewport.height) * factor)
  const primitives = buildScrollPrimitives(page, lastRefs, magnitude)

  if (action.amount === 'toEnd') {
    const meta = await scrollToEnd(primitives, action.direction, action.ref)
    return { success: true, metadata: { scrollUntilVisible: meta } }
  }

  const { meta } = await runDirectionScrollWithRetry(primitives, {
    direction: action.direction,
    retryOpposite: action.retryOpposite,
    ...(action.ref ? { ref: action.ref } : {}),
  })
  return { success: true, metadata: { scrollUntilVisible: meta } }
}

// EXEC-03 web lane (D-09): openApp is not executable on web — self-correct to navigate(url).
export function webOpenAppError(): ActionResult {
  return {
    success: false,
    error: 'openApp is not executable on web — use navigate(url) with the target app\'s web address instead.',
  }
}
