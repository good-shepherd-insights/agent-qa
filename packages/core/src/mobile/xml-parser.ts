import { XMLParser } from 'fast-xml-parser'
import type { InterimNode } from '@vostride/agent-qa-runner'
import type { ElementLabels, ElementState } from '@vostride/agent-qa-schema'
import type { ParsedMobileSource } from './types.js'
import { normalizeRole } from './role-map.js'

const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'textbox', 'checkbox', 'radio', 'combobox',
  'searchbox', 'slider', 'switch', 'tab', 'menuitem',
  // Additional interactive roles (matching expanded web set and mobile types)
  'spinbutton', 'option', 'menuitemradio', 'menuitemcheckbox',
  'gridcell', 'scrollbar', 'separator',
  'grid', 'menu', 'menubar', 'tree', 'treegrid', 'treeitem',
  'listbox', 'pickerwheel',
])

const CONTENT_ROLES = new Set([
  'text', 'heading', 'cell', 'listitem', 'image', 'navigation', 'alert',
  'progressbar',
])

// Only interactive/content roles become interim nodes; structural containers
// (group/window/application/scroll-area/...) are filtered — their children reparent to
// the nearest surviving ancestor. This preserves the v1 element set exactly (the same
// nodes that used to receive refs), now minted by the shared builder.
function shouldEmit(role: string): boolean {
  return INTERACTIVE_ROLES.has(role) || CONTENT_ROLES.has(role)
}

// fast-xml-parser leaves attribute values as strings (parseAttributeValue is off), so a
// real boolean signal is the literal "true" — coerce defensively per T-352-07.
function boolAttr(value: unknown): boolean {
  return value === true || value === 'true'
}

function parseAndroidBounds(boundsStr: string): { x: number; y: number; width: number; height: number } | undefined {
  const match = boundsStr.match(/^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/)
  if (!match) return undefined
  const x1 = parseInt(match[1], 10)
  const y1 = parseInt(match[2], 10)
  const x2 = parseInt(match[3], 10)
  const y2 = parseInt(match[4], 10)
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 }
}

function parseIosBounds(attrs: Record<string, any>): { x: number; y: number; width: number; height: number } | undefined {
  const x = parseFloat(attrs['@_x'])
  const y = parseFloat(attrs['@_y'])
  const width = parseFloat(attrs['@_width'])
  const height = parseFloat(attrs['@_height'])
  if (isNaN(x) || isNaN(y) || isNaN(width) || isNaN(height)) return undefined
  return { x, y, width, height }
}

function extractLabel(attrs: Record<string, any>, platform: 'android' | 'ios'): string | undefined {
  if (platform === 'android') {
    const contentDesc = attrs['@_content-desc']
    if (contentDesc) return contentDesc
    const text = attrs['@_text']
    if (text) return text
    return undefined
  }
  // iOS
  const label = attrs['@_label']
  if (label) return label
  const name = attrs['@_name']
  if (name) return name
  const value = attrs['@_value']
  if (value) return value
  return undefined
}

function extractValue(attrs: Record<string, any>, platform: 'android' | 'ios'): string | undefined {
  const value = platform === 'android' ? attrs['@_text'] : attrs['@_value']
  if (value === undefined || value === null || value === '') return undefined
  return String(value)
}

/**
 * D-08 attribute lift. Only signals the platform actually emitted populate `state` —
 * an absent attribute leaves the key typed-absent (the builder applies documented
 * defaults). No signal is ever fabricated.
 *
 * Attribute names verified against core/src/mobile/__tests__/xml-parser.test.ts
 * page-source fixtures (Assumption A1): Android UiAutomator2 uses hyphenated
 * `resource-id`/`content-desc` and literal `checkable`/`checked`/`selected`/`focused`/
 * `scrollable`/`enabled`/`displayed`; iOS XCUITest uses `value`/`selected`/`enabled`/
 * `visible`. `scrollable` is retained in the raw attribute bag (consumed by
 * deriveMobileScroll), not lifted onto state.
 */
function liftState(
  attrs: Record<string, any>,
  platform: 'android' | 'ios',
  bounds: { x: number; y: number; width: number; height: number } | undefined,
  viewport: { width: number; height: number } | undefined,
): Partial<ElementState> {
  const state: Partial<ElementState> = {}

  if (attrs['@_enabled'] !== undefined) {
    state.enabled = boolAttr(attrs['@_enabled'])
  }
  if (attrs['@_selected'] !== undefined) {
    state.selected = boolAttr(attrs['@_selected'])
  }

  if (platform === 'android') {
    // `checked` is only meaningful when the widget is `checkable` — otherwise typed-absent.
    if (boolAttr(attrs['@_checkable']) && attrs['@_checked'] !== undefined) {
      state.checked = boolAttr(attrs['@_checked'])
    }
    if (attrs['@_focused'] !== undefined) {
      state.focused = boolAttr(attrs['@_focused'])
    }
    // visible derivation (documented): explicit displayed=false, else bounds fully
    // outside the viewport ⇒ offscreen. Absent otherwise (builder defaults visible=true).
    if (attrs['@_displayed'] !== undefined && !boolAttr(attrs['@_displayed'])) {
      state.visible = false
    } else if (bounds && viewport && (bounds.y + bounds.height < 0 || bounds.y > viewport.height)) {
      state.visible = false
    }
  } else {
    // iOS: value/selected/enabled only — NO checked derivation from value strings
    // (fabrication banned per D-08).
    if (attrs['@_visible'] !== undefined && !boolAttr(attrs['@_visible'])) {
      state.visible = false
    } else if (bounds && viewport && (bounds.y + bounds.height < 0 || bounds.y > viewport.height)) {
      state.visible = false
    }
  }

  return state
}

/** Android maps `resource-id -> labels.testId` and `content-desc -> labels.ariaLabel`
 * (empty strings stay absent). iOS carries no dedicated label attributes here. */
function liftLabels(attrs: Record<string, any>, platform: 'android' | 'ios'): ElementLabels {
  const labels: ElementLabels = {}
  if (platform === 'android') {
    const resourceId = attrs['@_resource-id']
    if (resourceId) labels.testId = String(resourceId)
    const contentDesc = attrs['@_content-desc']
    if (contentDesc) labels.ariaLabel = String(contentDesc)
  }
  return labels
}

interface WalkContext {
  platform: 'android' | 'ios'
  nodes: InterimNode[]
  viewport?: { width: number; height: number }
}

function walkNode(node: any, tagName: string, parentIndex: number | undefined, ctx: WalkContext): void {
  const attrs: Record<string, any> = {}
  // fast-xml-parser puts attributes with @_ prefix at the node level
  for (const key of Object.keys(node)) {
    if (key.startsWith('@_')) {
      attrs[key] = node[key]
    }
  }

  const role = normalizeRole(tagName, ctx.platform)
  const emit = shouldEmit(role)

  // The index children reparent to: this node's own index if it is emitted, else the
  // nearest surviving ancestor passed down.
  let childParentIndex = parentIndex

  if (emit) {
    const label = extractLabel(attrs, ctx.platform)
    const value = extractValue(attrs, ctx.platform)

    let bounds: { x: number; y: number; width: number; height: number } | undefined
    if (ctx.platform === 'android' && attrs['@_bounds']) {
      bounds = parseAndroidBounds(attrs['@_bounds'])
    } else if (ctx.platform === 'ios') {
      bounds = parseIosBounds(attrs)
    }

    const state = liftState(attrs, ctx.platform, bounds, ctx.viewport)
    const labels = liftLabels(attrs, ctx.platform)

    // Retain the raw platform attribute bag (prefix stripped, values stringified).
    const attributes: Record<string, string> = {}
    for (const key of Object.keys(attrs)) {
      attributes[key.slice(2)] = String(attrs[key])
    }

    const interim: InterimNode = {
      role,
      ...(label !== undefined ? { name: label } : {}),
      ...(value !== undefined ? { value } : {}),
      ...(parentIndex !== undefined ? { parentIndex } : {}),
      ...(bounds !== undefined ? { bounds } : {}),
      ...(Object.keys(state).length > 0 ? { state } : {}),
      ...(Object.keys(labels).length > 0 ? { labels } : {}),
      attributes,
      nativeType: tagName,
    }

    childParentIndex = ctx.nodes.length
    ctx.nodes.push(interim)
  }

  // Walk children
  for (const childKey of Object.keys(node)) {
    if (childKey.startsWith('@_') || childKey === '#text') continue
    const childVal = node[childKey]
    const children = Array.isArray(childVal) ? childVal : [childVal]
    for (const child of children) {
      if (child && typeof child === 'object') {
        walkNode(child, childKey, childParentIndex, ctx)
      }
    }
  }
}

export function parseMobileSource(
  xml: string,
  platform: 'android' | 'ios',
  viewport?: { width: number; height: number },
): ParsedMobileSource {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    allowBooleanAttributes: true,
    preserveOrder: false,
  })

  const parsed = parser.parse(xml)

  const ctx: WalkContext = {
    platform,
    nodes: [],
    viewport,
  }

  // Find root element(s) to walk
  // Android: <hierarchy>...</hierarchy>
  // iOS: <AppiumAUT>...</AppiumAUT>
  const rootKeys = Object.keys(parsed).filter(k => !k.startsWith('?'))
  for (const rootKey of rootKeys) {
    const rootVal = parsed[rootKey]
    if (rootVal && typeof rootVal === 'object') {
      // Walk children of root container (hierarchy or AppiumAUT)
      for (const childKey of Object.keys(rootVal)) {
        if (childKey.startsWith('@_') || childKey === '#text') continue
        const childVal = rootVal[childKey]
        const children = Array.isArray(childVal) ? childVal : [childVal]
        for (const child of children) {
          if (child && typeof child === 'object') {
            walkNode(child, childKey, undefined, ctx)
          }
        }
      }
    }
  }

  return { nodes: ctx.nodes }
}
