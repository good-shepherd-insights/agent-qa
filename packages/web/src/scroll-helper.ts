// Container scroll for a ref (436-17 · D-25, review CR-03). The ref resolves through
// ElementResolver, the role locator every other web action uses. A ref that does not resolve
// performs no gesture and reports no offsets, so the swipe reads `unknown`; offsets always belong
// to the container that was actually scrolled, and the document reports them only when it has
// scroll range on the swiped axis.

import type { Page } from 'playwright-core'
import type { Ref } from '@vostride/agent-qa-schema'
import { ElementResolver } from './element-resolver.js'
import type { RefMap } from './types.js'

export interface ScrollResult {
  bounds: { x: number; y: number; width: number; height: number } | null
  scrolledContainer: 'element' | 'ancestor' | 'documentElement' | 'notFound'
  scrolled: boolean
  /** The scrolled container's offset on the swiped axis before and after, and its largest offset. */
  offsets?: { before: number; after: number; max: number }
}

const NOT_FOUND: ScrollResult = { bounds: null, scrolledContainer: 'notFound', scrolled: false }

// Bounds the evaluate's own wait if the element detaches between count() and evaluate().
const EVALUATE_TIMEOUT_MS = 1_000

export async function scrollWithRef(
  page: Page,
  lastRefs: RefMap,
  ref: Ref,
  deltaX: number,
  deltaY: number,
  scrollAxis: 'horizontal' | 'vertical',
): Promise<ScrollResult> {
  try {
    const locator = new ElementResolver(page, lastRefs).resolve(ref)
    if ((await locator.count()) === 0) return NOT_FOUND
    const scrolled = await locator.evaluate(
      (target: unknown, args: [number, number, string]) => {
        const [dx, dy, axis] = args
        const win = globalThis as any
        const doc = win.document
        const el = target as any

        const prop = axis === 'horizontal' ? 'scrollLeft' : 'scrollTop'
        const maxOf = (node: any): number => axis === 'horizontal'
          ? node.scrollWidth - node.clientWidth
          : node.scrollHeight - node.clientHeight
        const boundsOf = () => {
          const rect = el.getBoundingClientRect()
          return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
        }
        const scrollable = (node: any): boolean => {
          const style = win.getComputedStyle(node)
          const overflow = axis === 'horizontal' ? style.overflowX : style.overflowY
          return (overflow === 'auto' || overflow === 'scroll' || overflow === 'hidden') && maxOf(node) > 0
        }

        // The element itself, then its nearest scrollable ancestor.
        if (scrollable(el)) {
          const before = el[prop]
          el.scrollBy(dx, dy)
          const after = el[prop]
          return { bounds: boundsOf(), scrolledContainer: 'element', scrolled: before !== after, offsets: { before, after, max: maxOf(el) } }
        }
        for (let parent = el.parentElement; parent && parent !== doc.documentElement; parent = parent.parentElement) {
          if (!scrollable(parent)) continue
          const before = parent[prop]
          parent.scrollBy(dx, dy)
          const after = parent[prop]
          return { bounds: boundsOf(), scrolledContainer: 'ancestor', scrolled: before !== after, offsets: { before, after, max: maxOf(parent) } }
        }

        // The document, whose offsets prove something only when it has range on this axis.
        const root = doc.documentElement
        const before = root[prop]
        root.scrollBy(dx, dy)
        const after = root[prop]
        const max = maxOf(root)
        return {
          bounds: boundsOf(),
          scrolledContainer: 'documentElement',
          scrolled: before !== after,
          ...(max > 0 ? { offsets: { before, after, max } } : {}),
        }
      },
      [deltaX, deltaY, scrollAxis] as [number, number, string],
      { timeout: EVALUATE_TIMEOUT_MS },
    )
    return scrolled && typeof scrolled === 'object' ? (scrolled as ScrollResult) : NOT_FOUND
  } catch {
    return NOT_FOUND
  }
}
