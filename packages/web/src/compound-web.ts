// Web execute() compound behaviors shared by both web execute surfaces (adapter.ts +
// farm-adapter.ts). Phase 359 · EXEC-01/02/03 · D-05..D-09. The runner owns the pure verdict
// machine (compareFillReread) and loop discipline (runUntilVisibleLoop / runDirectionScroll /
// runToEndScroll over injected ScrollPrimitives); this module supplies the Playwright primitives
// and stitches them into ONE ActionResult per compound. Extracted here (inside packages/web/src)
// so the two adapter classes reuse one implementation instead of copy-pasting the compound.

import type { Frame, JSHandle, Locator, Page } from 'playwright-core'
import type { ActionResult } from '@vostride/agent-qa-runner'
import {
  compareFillReread,
  runUntilVisibleLoop,
  runDirectionScroll,
  runToEndScroll,
  swipeSignalFromOffsets,
  scrollerSetSwipeSignal,
  type DocumentScrollOffsets,
  type ScrollPrimitives,
  type SwipeSignal,
  type Direction,
  type TargetVisibility,
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

type Axis = 'horizontal' | 'vertical'
type PointerChain = { before: DocumentScrollOffsets[]; after: DocumentScrollOffsets[] }

// In-page, before the wheel: every element that can scroll on the swiped axis (range above 0 and
// a scrolling overflow) plus the document scroller, mapped to its offsets, and a once-only passive
// wheel listener on window that records the event target. The state is returned as a handle only;
// nothing is written to window or the DOM.
function snapshotScrollers(axis: Axis): unknown {
  type El = {
    scrollLeft: number
    scrollTop: number
    scrollWidth: number
    scrollHeight: number
    clientWidth: number
    clientHeight: number
  }
  const g = globalThis as unknown as {
    document: {
      scrollingElement: El | null
      documentElement: El
      body: El | null
      querySelectorAll(selector: string): ArrayLike<El>
    }
    getComputedStyle(el: El): { overflowX: string; overflowY: string }
    addEventListener(type: string, listener: (event: { target: unknown }) => void, options: object): void
  }
  const doc = g.document
  const root = doc.scrollingElement ?? doc.documentElement
  const read = (el: El) => ({
    x: el.scrollLeft,
    y: el.scrollTop,
    maxX: el.scrollWidth - el.clientWidth,
    maxY: el.scrollHeight - el.clientHeight,
  })
  const scrolls = (value: string): boolean => value === 'auto' || value === 'scroll' || value === 'overlay'
  const rootStyle = g.getComputedStyle(doc.documentElement)
  const bodyPropagates = rootStyle.overflowX === 'visible' && rootStyle.overflowY === 'visible'
  const offsets = new Map<El, ReturnType<typeof read>>()
  offsets.set(root, read(root))
  const all = doc.querySelectorAll('*')
  for (let i = 0; i < all.length; i += 1) {
    const el = all[i]
    if (el === root || el === doc.documentElement) continue
    if (el === doc.body && bodyPropagates) continue
    const o = read(el)
    if (!((axis === 'vertical' ? o.maxY : o.maxX) > 0)) continue
    const style = g.getComputedStyle(el)
    if (!scrolls(axis === 'vertical' ? style.overflowY : style.overflowX)) continue
    offsets.set(el, o)
  }
  const state: { offsets: typeof offsets; target: unknown; listener: (event: { target: unknown }) => void } = {
    offsets,
    target: null,
    listener: () => undefined,
  }
  state.listener = (event) => {
    state.target = event.target
  }
  g.addEventListener('wheel', state.listener, { capture: true, once: true, passive: true })
  return state
}

// In-page, after the wheel: the chain is the recorded target and its ancestors that were
// snapshotted, in order, then the document scroller. Returns the aligned before/after offsets, or
// nothing (and removes the listener) when no wheel event was observed.
function readPointerChain(state: unknown): unknown {
  type El = {
    scrollLeft: number
    scrollTop: number
    scrollWidth: number
    scrollHeight: number
    clientWidth: number
    clientHeight: number
    parentElement: El | null
  }
  const g = globalThis as unknown as {
    document: { scrollingElement: El | null; documentElement: El }
    removeEventListener(type: string, listener: unknown, options: object): void
  }
  const s = state as { offsets: Map<El, unknown>; target: El | null; listener: unknown }
  if (!s.target) {
    g.removeEventListener('wheel', s.listener, { capture: true })
    return undefined
  }
  const root = g.document.scrollingElement ?? g.document.documentElement
  const chain: El[] = []
  for (let el: El | null = s.target; el; el = el.parentElement) {
    if (s.offsets.has(el) && !chain.includes(el)) chain.push(el)
  }
  if (!chain.includes(root)) chain.push(root)
  return {
    before: chain.map((el) => s.offsets.get(el)),
    after: chain.map((el) => ({
      x: el.scrollLeft,
      y: el.scrollTop,
      maxX: el.scrollWidth - el.clientWidth,
      maxY: el.scrollHeight - el.clientHeight,
    })),
  }
}

// The no-ref wheel lands on whatever is under the pointer, so it is judged by the scrollers under
// it: the wheel event's target up to the document scroller (436-18 · D-25, review CR-02). The
// pointer position is not readable through Playwright and a passive listener runs after the
// compositor has scrolled, so the "before" offsets are a snapshot taken before the wheel and the
// listener only names the chain. No snapshot or no observed wheel event is unknown.
async function wheelPointerChain(page: Page, dx: number, dy: number, axis: Axis): Promise<PointerChain | undefined> {
  let handle: JSHandle | undefined
  try {
    handle = await page.evaluateHandle(snapshotScrollers, axis)
  } catch {
    handle = undefined
  }
  await page.mouse.wheel(dx, dy)
  await settle(page)
  if (!handle) return undefined
  try {
    const chain = (await handle.evaluate(readPointerChain)) as Partial<PointerChain> | undefined
    if (!chain || typeof chain !== 'object' || !Array.isArray(chain.before) || !Array.isArray(chain.after)) {
      return undefined
    }
    return { before: chain.before, after: chain.after }
  } catch {
    return undefined
  } finally {
    await handle.dispose().catch(() => undefined)
  }
}

type ProbeBox = { left: number; top: number; right: number; bottom: number }
type Judged = { state: TargetVisibility; rect?: ProbeBox }

// In-page judge for every candidate of one frame, in that frame's own viewport. Hidden: computed
// visibility other than `visible`, or a box outside the viewport. Unknown: a box that a clipping
// ancestor (a nested scroller the search may not have moved) empties. Visible: the clipped box.
// Ancestors are walked over the flat tree (assigned slot, parent element, shadow host), skipping a
// body whose overflow propagates to the viewport. Self-contained: Playwright serializes it.
function judgeCandidates(elements: unknown[]): unknown {
  const g = globalThis as any
  const doc = g.document
  const root = doc.documentElement
  const rootStyle = g.getComputedStyle(root)
  const bodyPropagates = rootStyle.overflowX === 'visible' && rootStyle.overflowY === 'visible'
  const parentOf = (node: any): any => node.assignedSlot ?? node.parentElement ?? node.parentNode?.host ?? null
  const clips = (node: any): boolean => {
    const style = g.getComputedStyle(node)
    return style.overflowX !== 'visible' || style.overflowY !== 'visible'
  }
  const judge = (el: any): unknown => {
    if (g.getComputedStyle(el).visibility !== 'visible') return { state: 'hidden' }
    const r = el.getBoundingClientRect()
    let left = Math.max(r.left, 0)
    let top = Math.max(r.top, 0)
    let right = Math.min(r.right, g.innerWidth)
    let bottom = Math.min(r.bottom, g.innerHeight)
    if (!(right > left && bottom > top)) return { state: 'hidden' }
    for (let a = parentOf(el); a && a !== root; a = parentOf(a)) {
      if (a === doc.body && bodyPropagates) continue
      if (!clips(a)) continue
      const b = a.getBoundingClientRect()
      const cl = b.left + a.clientLeft
      const ct = b.top + a.clientTop
      left = Math.max(left, cl)
      top = Math.max(top, ct)
      right = Math.min(right, cl + a.clientWidth)
      bottom = Math.min(bottom, ct + a.clientHeight)
      if (!(right > left && bottom > top)) return { state: 'unknown' }
    }
    return { state: 'visible', rect: { left, top, right, bottom } }
  }
  return elements.map(judge)
}

// In-page, in the parent frame: projects a box from a child frame's viewport through its frame
// element into the parent's viewport, or null when it cannot be judged: a transform or zoom on the
// frame element or a flat-tree ancestor, an empty result after the content box, clipping ancestors
// and the viewport, or a hit test at its centre that lands on anything but the frame element.
// Its flat-tree walk and clip rules are a copy of judgeCandidates'.
function projectThroughFrame(frameElement: unknown, box: ProbeBox): unknown {
  const g = globalThis as any
  const doc = g.document
  const root = doc.documentElement
  const el = frameElement as any
  const rootStyle = g.getComputedStyle(root)
  const bodyPropagates = rootStyle.overflowX === 'visible' && rootStyle.overflowY === 'visible'
  const parentOf = (node: any): any => node.assignedSlot ?? node.parentElement ?? node.parentNode?.host ?? null
  const clips = (node: any): boolean => {
    const style = g.getComputedStyle(node)
    return style.overflowX !== 'visible' || style.overflowY !== 'visible'
  }
  for (let n = el; n; n = parentOf(n)) {
    const style = g.getComputedStyle(n)
    if (style.transform !== 'none') return null
    const zoom = Number.parseFloat(style.zoom)
    if (Number.isFinite(zoom) && zoom !== 1) return null
  }
  const style = g.getComputedStyle(el)
  const padLeft = Number.parseFloat(style.paddingLeft) || 0
  const padTop = Number.parseFloat(style.paddingTop) || 0
  const padRight = Number.parseFloat(style.paddingRight) || 0
  const padBottom = Number.parseFloat(style.paddingBottom) || 0
  const r = el.getBoundingClientRect()
  const ox = r.left + el.clientLeft + padLeft
  const oy = r.top + el.clientTop + padTop
  let left = Math.max(box.left + ox, ox, 0)
  let top = Math.max(box.top + oy, oy, 0)
  let right = Math.min(box.right + ox, ox + el.clientWidth - padLeft - padRight, g.innerWidth)
  let bottom = Math.min(box.bottom + oy, oy + el.clientHeight - padTop - padBottom, g.innerHeight)
  if (!(right > left && bottom > top)) return null
  for (let a = parentOf(el); a && a !== root; a = parentOf(a)) {
    if (a === doc.body && bodyPropagates) continue
    if (!clips(a)) continue
    const b = a.getBoundingClientRect()
    const cl = b.left + a.clientLeft
    const ct = b.top + a.clientTop
    left = Math.max(left, cl)
    top = Math.max(top, ct)
    right = Math.min(right, cl + a.clientWidth)
    bottom = Math.min(bottom, ct + a.clientHeight)
    if (!(right > left && bottom > top)) return null
  }
  const hit = el.getRootNode().elementFromPoint((left + right) / 2, (top + bottom) / 2)
  if (hit !== el) return null
  return { left, top, right, bottom }
}

function candidatesIn(scope: Page | Frame, target: string): Locator {
  return scope
    .getByText(target)
    .or(scope.getByLabel(target))
    .or(scope.getByAltText(target))
    .or(scope.getByTitle(target))
}

async function judgeIn(scope: Page | Frame, target: string): Promise<Judged[]> {
  const judged = await candidatesIn(scope, target).evaluateAll(judgeCandidates)
  if (!Array.isArray(judged)) throw new Error('probe answered no list')
  return judged.map((candidate: Partial<Judged> | null) => {
    const state = candidate?.state
    if (state === 'visible' && candidate?.rect) return { state, rect: candidate.rect }
    return { state: state === 'hidden' ? 'hidden' : 'unknown' }
  })
}

function combine(states: readonly TargetVisibility[]): TargetVisibility {
  if (states.includes('visible')) return 'visible'
  if (states.includes('unknown')) return 'unknown'
  return 'hidden'
}

// A child frame's box, projected through each ancestor frame element up to the main frame.
async function projectToMainFrame(frame: Frame, box: ProbeBox): Promise<boolean> {
  let current = frame
  let projected = box
  for (let parent = current.parentFrame(); parent; parent = current.parentFrame()) {
    const handle = await current.frameElement()
    try {
      const next = (await handle.evaluate(projectThroughFrame, projected)) as ProbeBox | null
      if (!next || typeof next !== 'object') return false
      projected = next
    } finally {
      await handle.dispose().catch(() => undefined)
    }
    current = parent
  }
  return true
}

// A candidate that is not visible inside its own frame may sit where the page search cannot move
// it, so it is unknown, never hidden; so is one the projection cannot follow to the main frame.
async function probeChildFrame(frame: Frame, target: string): Promise<TargetVisibility> {
  try {
    const states: TargetVisibility[] = []
    for (const candidate of await judgeIn(frame, target)) {
      if (candidate.state === 'visible' && candidate.rect && (await projectToMainFrame(frame, candidate.rect))) {
        return 'visible'
      }
      states.push('unknown')
    }
    return combine(states)
  } catch {
    return 'unknown'
  }
}

// Is any element carrying `target` (text, label, alt or title; Playwright's case-insensitive,
// whitespace-normalized substring match) on screen now, in the main frame or any child frame?
// Any visible candidate is visible; else any unknown is unknown; else hidden. evaluateAll never
// waits. An error on the main frame answers unknown, and on a child frame makes that frame unknown
// (436-17 · D-24/D-25).
// 2026-10-08 (436-22): tri-state over every frame, each child frame's candidates projected through
// its frame elements; a nested-scroller clip, a frame target not on screen inside its frame, a
// transformed or zoomed frame and a covered frame are unknown (review CR-07).
async function probeOnScreen(page: Page, target: string): Promise<TargetVisibility> {
  let states: TargetVisibility[]
  try {
    states = (await judgeIn(page, target)).map((candidate) => candidate.state)
  } catch {
    return 'unknown'
  }
  if (combine(states) === 'visible') return 'visible'
  try {
    const main = page.mainFrame()
    for (const frame of page.frames()) {
      if (frame === main || frame.isDetached()) continue
      const answer = await probeChildFrame(frame, target)
      if (answer === 'visible') return 'visible'
      states.push(answer)
    }
  } catch {
    states.push('unknown')
  }
  return combine(states)
}

// Light probe + swipe/native primitives. readInterimTree re-runs ONLY the aria-snapshot harvest
// → parseAriaSnapshot(text).nodes — NO buildScreenState, NO refMap mint, NO screenshot; lastRefs
// stays bound to the pre-compound observation. probeTargetVisible decides target visibility for
// the loop: page-wide, every frame, and it ignores the container ref. swipeOnce reports what the
// offsets proved; the no-ref wheel measures the scrollers under the pointer before and after.
// 2026-10-08 (436-22): probeTargetVisible answers visible, hidden or unknown.
export function buildScrollPrimitives(page: Page, lastRefs: RefMap, magnitude: number): ScrollPrimitives {
  return {
    async swipeOnce(direction: Direction, ref?: Ref): Promise<SwipeSignal> {
      const { dx, dy, axis } = deltaFor(direction, magnitude)
      if (ref) {
        // A ref that does not resolve moves nothing and carries no offsets: the signal is unknown.
        const scrolled = await scrollWithRef(page, lastRefs, ref, dx, dy, axis)
        if (scrolled.scrolledContainer !== 'notFound') await settle(page)
        return swipeSignalFromOffsets(direction, scrolled.offsets)
      }
      const chain = await wheelPointerChain(page, dx, dy, axis)
      return scrollerSetSwipeSignal(direction, chain?.before, chain?.after)
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
    async probeTargetVisible(target: string): Promise<TargetVisibility> {
      return probeOnScreen(page, target)
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
