import type { Page } from 'playwright-core'
import type { ScreenState } from '@vostride/agent-qa-schema'
import { buildScreenState, type InterimNode } from '@vostride/agent-qa-runner'
import { extractDom } from './dom-extractor.js'

const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'textbox', 'checkbox', 'radio', 'combobox', 'listbox',
  'menuitem', 'menuitemradio', 'menuitemcheckbox', 'option',
  'searchbox', 'slider', 'spinbutton', 'switch', 'tab', 'treeitem',
  // WAI-ARIA 1.2 standalone widget roles
  'gridcell', 'scrollbar', 'separator',
  // WAI-ARIA 1.2 composite widget roles (interactive containers)
  'grid', 'menu', 'menubar', 'tree', 'treegrid',
])

const CONTENT_ROLES = new Set([
  'heading', 'cell', 'listitem', 'article', 'region', 'navigation',
  'progressbar', 'tabpanel',
])

const LINE_PATTERN = /^(\s*-\s*)(\w+)(?:\s+"([^"]*)")?(.*)$/
// Playwright wraps ARIA entries in single quotes when element names contain
// colons or other characters that are ambiguous in its snapshot format.
// e.g. - 'button "Spoken Language: Any"'
const QUOTED_LINE_PATTERN = /^(\s*-\s*)'(\w+)(?:\s+"([^"]*)")?(.*)'\s*$/
// Playwright's ai-mode snapshot annotates each element with a native reference,
// e.g. `- button "Login" [ref=e5]`. These refs are adapter-PRIVATE handles for
// aria-ref locators; they are NEVER copied into the node identity (D-03).
const REF_ANNOTATION = /\[ref=([A-Za-z0-9_-]+)\]/
const BRACKET_ATTR = /\[(\w+)(?:=([^\]]*))?\]/g

/**
 * Parse a Playwright ARIA snapshot into platform-neutral runner interim nodes.
 *
 * Emits nodes in document order with role/name/attributes and a `parentIndex`
 * derived from indentation depth (nearest SURVIVING ancestor — RESEARCH Pitfall
 * #7). Playwright ai-mode `[ref=eN]` annotations are captured into an
 * index-aligned `nativeRefs` array (adapter-private native handles) and are never
 * written into the node. Accepts both ai-mode (annotated) and default-mode
 * (unannotated) snapshot text.
 *
 * No ref minting and no tree rendering happen here — the shared runner builder
 * owns both (D-01/D-02/D-03).
 */
export function parseAriaSnapshot(ariaTree: string): {
  nodes: InterimNode[]
  nativeRefs: (string | undefined)[]
} {
  const lines = ariaTree.split('\n')
  const nodes: InterimNode[] = []
  const nativeRefs: (string | undefined)[] = []
  // Stack of surviving ancestors: { depth, index in the FILTERED nodes array }.
  const ancestors: Array<{ depth: number; index: number }> = []

  for (const line of lines) {
    const match = line.match(LINE_PATTERN) || line.match(QUOTED_LINE_PATTERN)
    if (!match) continue

    const [, , role, name, suffix] = match
    const roleLower = role.toLowerCase()
    if (!INTERACTIVE_ROLES.has(roleLower) && !CONTENT_ROLES.has(roleLower)) continue

    // Indentation depth: Playwright indents snapshot children by 2 spaces per level.
    const leadingSpaces = line.length - line.trimStart().length
    const depth = Math.floor(leadingSpaces / 2)

    // parentIndex points at the nearest SURVIVING ancestor (strictly shallower
    // depth); skipped structural rows collapse away.
    while (ancestors.length > 0 && ancestors[ancestors.length - 1].depth >= depth) {
      ancestors.pop()
    }
    const parentIndex = ancestors.length > 0 ? ancestors[ancestors.length - 1].index : undefined

    // Capture the adapter-private native ref (ai-mode) — never copied into the node.
    const refMatch = suffix?.match(REF_ANNOTATION)
    const nativeRef = refMatch ? refMatch[1] : undefined

    // Remaining bracket annotations become the raw attribute bag (ref excluded).
    const attributes: Record<string, string> = {}
    if (suffix) {
      for (const am of suffix.matchAll(BRACKET_ATTR)) {
        if (am[1] === 'ref') continue
        attributes[am[1]] = am[2] ?? 'true'
      }
    }

    const node: InterimNode = { role: roleLower }
    if (name) node.name = name
    if (parentIndex !== undefined) node.parentIndex = parentIndex
    if (Object.keys(attributes).length > 0) node.attributes = attributes
    // Only signals actually present in the snapshot text populate state; the
    // builder derives all defaults. A [disabled] annotation is the only state
    // signal the default snapshot text carries.
    if ('disabled' in attributes) node.state = { enabled: false }

    const index = nodes.length
    nodes.push(node)
    nativeRefs.push(nativeRef)
    ancestors.push({ depth, index })
  }

  return { nodes, nativeRefs }
}

// Browser-context functions use (globalThis as any) to access document
// because the Node tsconfig has no DOM lib — these functions serialize and run in browser
function hideAgentQaElements() {
  const doc = (globalThis as any).document
  doc.querySelectorAll('[data-agent-qa-internal]').forEach((el: any) => {
    el.style.display = 'none'
    el.setAttribute('aria-hidden', 'true')
  })
}

function restoreAgentQaElements() {
  const doc = (globalThis as any).document
  doc.querySelectorAll('[data-agent-qa-internal]').forEach((el: any) => {
    el.style.display = ''
    el.removeAttribute('aria-hidden')
  })
}

export async function observePage(
  page: Page,
  options?: { filterSelector?: string; extractDom?: boolean },
): Promise<ScreenState> {
  const viewport = page.viewportSize() ?? { width: 0, height: 0 }
  const locator = options?.filterSelector
    ? page.locator(options.filterSelector)
    : page.locator(':root')

  // Hide framework-injected elements from ARIA snapshot
  await page.evaluate(hideAgentQaElements)

  let ariaTree: string
  try {
    ariaTree = await locator.ariaSnapshot()
  } finally {
    // Restore framework-injected elements (always, even if snapshot fails)
    await page.evaluate(restoreAgentQaElements)
  }

  const timestamp = Date.now()
  const url = page.url()

  // Web scroll is EXACT (D-10, Pitfall #2): read real window offsets and document
  // content size — never hardcoded zeros.
  let scroll = { offsetX: 0, offsetY: 0, contentWidth: 0, contentHeight: 0 }
  let capturedViewport = viewport
  try {
    const raw = await page.evaluate(() => {
      const w = globalThis as any
      const docEl = w.document.documentElement
      return {
        width: w.innerWidth,
        height: w.innerHeight,
        offsetX: w.scrollX,
        offsetY: w.scrollY,
        contentWidth: docEl.scrollWidth,
        contentHeight: docEl.scrollHeight,
      }
    })
    if (raw && typeof raw === 'object') {
      capturedViewport = {
        width: numberOr(raw.width, viewport.width),
        height: numberOr(raw.height, viewport.height),
      }
      scroll = {
        offsetX: numberOr(raw.offsetX, 0),
        offsetY: numberOr(raw.offsetY, 0),
        contentWidth: numberOr(raw.contentWidth, 0),
        contentHeight: numberOr(raw.contentHeight, 0),
      }
    }
  } catch {
    // Scroll capture is best-effort — never block observation.
  }

  let domContext: string | undefined
  if (options?.extractDom) {
    try {
      domContext = await extractDom(page)
    } catch {
      // DOM extraction is best-effort
    }
  }

  const { nodes } = ariaTree ? parseAriaSnapshot(ariaTree) : { nodes: [] as InterimNode[] }

  const { state } = buildScreenState({
    platform: 'web',
    nodes,
    viewport: capturedViewport,
    scroll,
    coordSpace: 'viewport',
    timestamp,
    url,
    ...(domContext ? { domContext } : {}),
  })

  return state
}

/** Coerce an untrusted value to a finite number, falling back when malformed. */
function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}
