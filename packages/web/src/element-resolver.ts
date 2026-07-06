import type { Page, Locator } from 'playwright-core'
import type { Action, InterimNode, RefBinding } from '@vostride/agent-qa-runner'
import type { Ref } from '@vostride/agent-qa-schema'
import type { RefMap } from './types.js'

const ACTIONS_WITHOUT_REF = new Set(['navigate', 'waitFor', 'delay', 'waitForUrl', 'assertValue'])

/**
 * Re-feed the adapter-private execute-time RefMap from the buildScreenState binding.
 *
 * The builder never crosses the port (observe() returns only the ScreenState), so the
 * adapter reconstructs its ref -> live-locator record here: role/name come from the
 * interim node at binding[ref].index, nth is the builder's same-screen ordinal, and
 * bounds pass through when enrichment resolved them. resolve() rebuilds a live
 * getByRole/nth locator from this record — robust across the observe/execute gap.
 */
export function buildRefMap(
  binding: Record<Ref, RefBinding>,
  nodes: InterimNode[],
): RefMap {
  const refs: RefMap = {}
  for (const [ref, bind] of Object.entries(binding)) {
    const node = nodes[bind.index]
    if (!node) continue
    const entry: RefMap[string] = { role: node.role, nth: bind.nth }
    if (node.name !== undefined) entry.name = node.name
    if (node.bounds !== undefined) entry.bounds = node.bounds
    refs[ref] = entry
  }
  return refs
}

export class ElementResolver {
  constructor(
    private page: Page,
    private refs: RefMap,
  ) {}

  resolve(ref: string): Locator {
    const data = this.refs[ref]
    if (!data) {
      throw new Error(`Unknown ref "${ref}". Available refs: ${Object.keys(this.refs).join(', ') || 'none'}`)
    }

    let locator: Locator
    if (data.name) {
      locator = this.page.getByRole(data.role as any, { name: data.name, exact: true })
    } else {
      locator = this.page.getByRole(data.role as any)
    }

    if (data.nth !== undefined) {
      locator = locator.nth(data.nth)
    }

    return locator
  }

  resolveAction(action: Action): Locator | null {
    if (ACTIONS_WITHOUT_REF.has(action.type)) {
      return null
    }

    if ('ref' in action && typeof action.ref === 'string') {
      return this.resolve(action.ref)
    }

    return null
  }

  async getBoundingBox(ref: string): Promise<{ x: number; y: number; width: number; height: number } | null> {
    try {
      const locator = this.resolve(ref)
      return await locator.boundingBox()
    } catch {
      return null
    }
  }
}
