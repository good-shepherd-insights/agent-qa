// Web execute() compound behaviors shared by both web execute surfaces (adapter.ts +
// farm-adapter.ts). Phase 359 · EXEC-01/02/03 · D-05..D-09. The runner owns the pure verdict
// machine (compareFillReread) and loop discipline (runUntilVisibleLoop / runDirectionScroll /
// runToEndScroll over injected ScrollPrimitives); this module supplies the Playwright primitives
// and stitches them into ONE ActionResult per compound. Extracted here (inside packages/web/src)
// so the two adapter classes reuse one implementation instead of copy-pasting the compound.

import type { Locator, Page } from 'playwright-core'
import type { ActionResult } from '@vostride/agent-qa-runner'
import {
  compareFillReread,
  runUntilVisibleLoop,
  runDirectionScroll,
  runToEndScroll,
  swipeSignalFromOffsets,
  documentSwipeSignal,
  type DocumentScrollOffsets,
  type ScrollPrimitives,
  type SwipeSignal,
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
      const value = await locator.evaluate((el) => {
        const node = el as unknown as { value?: unknown; textContent?: unknown }
        return (node.value ?? node.textContent) as unknown
      })
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

async function readDocumentOffsets(page: Page): Promise<DocumentScrollOffsets | undefined> {
  try {
    const raw = (await page.evaluate(() => {
      const doc = (globalThis as unknown as {
        document: { scrollingElement: unknown; documentElement: unknown }
      }).document
      const el = (doc.scrollingElement ?? doc.documentElement) as {
        scrollLeft: number
        scrollTop: number
        scrollWidth: number
        scrollHeight: number
        clientWidth: number
        clientHeight: number
      }
      return {
        x: el.scrollLeft,
        y: el.scrollTop,
        maxX: el.scrollWidth - el.clientWidth,
        maxY: el.scrollHeight - el.clientHeight,
      }
    })) as DocumentScrollOffsets | undefined
    return raw && typeof raw === 'object' ? raw : undefined
  } catch {
    return undefined
  }
}

// Light probe + swipe/native primitives. readInterimTree re-runs ONLY the aria-snapshot harvest
// → parseAriaSnapshot(text).nodes — NO buildScreenState, NO refMap mint, NO screenshot; lastRefs
// stays bound to the pre-compound observation. swipeOnce reports what the offsets proved; the
// no-ref wheel measures the document scroller before and after.
export function buildScrollPrimitives(page: Page, lastRefs: RefMap, magnitude: number): ScrollPrimitives {
  return {
    async swipeOnce(direction: Direction, ref?: Ref): Promise<SwipeSignal> {
      const refData = ref ? lastRefs[ref] : undefined
      const { dx, dy, axis } = deltaFor(direction, magnitude)
      if (refData) {
        const scrolled = await scrollWithRef(page, refData, dx, dy, axis)
        await settle(page)
        return swipeSignalFromOffsets(direction, scrolled?.offsets)
      }
      const before = await readDocumentOffsets(page)
      await page.mouse.wheel(dx, dy)
      await settle(page)
      const after = await readDocumentOffsets(page)
      return documentSwipeSignal(direction, before, after)
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

// EXEC-02: both schema Scroll modes over the shared loops. ONE ActionResult carrying
// metadata.scrollUntilVisible; the gesture itself succeeds — the outcome and what ended it ride
// the metadata, not the success flag.
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
    const { meta } = await runToEndScroll(primitives, action.direction, action.ref)
    return { success: true, metadata: { scrollUntilVisible: meta } }
  }

  const { meta } = await runDirectionScroll(primitives, {
    direction: action.direction,
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
