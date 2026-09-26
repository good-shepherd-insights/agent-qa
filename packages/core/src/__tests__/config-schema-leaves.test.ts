// 2026-09-26, 429-03 D-06/D-08: the published config schema's leaves, walked structurally and
// pinned against the masking map's keys, so a new schema leaf reds here until it is classified.
import { CONFIG_SCHEMA_LEAVES } from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'

import { AgentQaConfigSchema } from '../schema/config-schema.js'

interface NodeDef {
  type: string
  innerType?: unknown
  getter?: () => unknown
  out?: unknown
  shape?: Record<string, unknown>
  valueType?: unknown
  element?: unknown
  options?: readonly unknown[]
  left?: unknown
  right?: unknown
}

const WRAPPERS = new Set([
  'optional',
  'nullable',
  'nonoptional',
  'default',
  'prefault',
  'catch',
  'readonly',
])

function defOf(node: unknown): NodeDef {
  return (node as { def: NodeDef }).def
}

function unwrap(node: unknown): unknown {
  let current = node
  for (;;) {
    const def = defOf(current)
    if (WRAPPERS.has(def.type)) current = def.innerType
    else if (def.type === 'lazy') current = def.getter!()
    else if (def.type === 'pipe') current = def.out
    else return current
  }
}

function walk(node: unknown, keys: readonly string[], leaves: Set<string>): void {
  const def = defOf(unwrap(node))
  switch (def.type) {
    case 'object':
      for (const [key, child] of Object.entries(def.shape!)) walk(child, [...keys, key], leaves)
      return
    case 'record':
      walk(def.valueType, [...keys, '*'], leaves)
      return
    case 'array':
      walk(def.element, [...keys.slice(0, -1), `${keys.at(-1)}[]`], leaves)
      return
    case 'union':
      for (const option of def.options!) walk(option, keys, leaves)
      return
    case 'intersection':
      walk(def.left, keys, leaves)
      walk(def.right, keys, leaves)
      return
    default:
      leaves.add(keys.join('.'))
  }
}

function schemaLeaves(): string[] {
  const leaves = new Set<string>()
  walk(AgentQaConfigSchema, [], leaves)
  return [...leaves].sort()
}

describe('config schema leaves', () => {
  it('CONFIG-SCHEMA-LEAVES-PINNED', () => {
    const walked = schemaLeaves()
    expect(walked).toEqual([...CONFIG_SCHEMA_LEAVES])
    for (const witness of [
      'use.timeout.step',
      'registry.llms[].name',
      'services.mcp.tokens[].tokenEnvVar',
      'plugins.auth[].package',
    ]) {
      expect(walked).toContain(witness)
    }
  })
})
