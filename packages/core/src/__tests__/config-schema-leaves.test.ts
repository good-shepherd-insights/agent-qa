// 2026-09-26, 429-03 D-06/D-08: the published config schema's leaves, walked structurally and
// pinned against the masking map's keys, so a new schema leaf reds here until it is classified.
import { CONFIG_MASKING_MAP, CONFIG_SCHEMA_LEAVES, classifyConfigPath } from '@vostride/agent-qa-schema'
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
    // 2026-10-01 (432-22): the env-var-name witness (`services.mcp.tokens[].tokenEnvVar`) left with
    // the token list; `workspace.secretsFile` keeps a classified non-plain witness in the set.
    for (const witness of [
      'use.timeout.step',
      'registry.llms[].name',
      'workspace.secretsFile',
      'plugins.auth[].package',
    ]) {
      expect(walked).toContain(witness)
    }
  })

  // 432-02 added allowProduction (101 leaves, interim); 432-22 removes the nine retired leaves.
  it('C432-PRODUCTION-CONFIG: allowProduction is one plain top-level leaf of the walked schema', () => {
    const walked = schemaLeaves()
    expect(walked).toContain('allowProduction')
    expect(walked).toContain('registry.targets.*.environment')
    expect(walked.filter((leaf) => leaf.split('.')[0] === 'allowProduction')).toEqual(['allowProduction'])
    expect(CONFIG_MASKING_MAP.allowProduction).toBe('plain')
    expect(classifyConfigPath(['allowProduction'])).toBe('plain')
  })

  // 432-22 (D-12/D-18/D-22): the final strict leaf set. The count and the removed set are spelled
  // by hand; the map/schema equality above is what makes a leaf without a masking class red here.
  // 2026-10-07 (436-07, D-02): the two per-step planner limits add two leaves (92 to 94); the cell
  // name no longer carries the count, so a later leaf change moves only the number.
  it('C432-CONFIG-LEAVES: exactly the strict leaves, each classified, none of them retired', () => {
    const walked = schemaLeaves()
    expect(walked).toHaveLength(94)
    expect(CONFIG_SCHEMA_LEAVES).toHaveLength(94)
    expect(walked.filter((leaf) => leaf.startsWith('use.planner.max'))).toEqual(
      expect.arrayContaining(['use.planner.maxActions', 'use.planner.maxPlanningTurns']),
    )
    expect(CONFIG_MASKING_MAP['use.planner.maxActions']).toBe('plain')
    expect(CONFIG_MASKING_MAP['use.planner.maxPlanningTurns']).toBe('plain')
    expect(Object.keys(CONFIG_MASKING_MAP).sort()).toEqual(walked)
    for (const leaf of walked) {
      expect(CONFIG_MASKING_MAP[leaf as keyof typeof CONFIG_MASKING_MAP], leaf).toBeDefined()
    }
    const retired = [
      'safety.trustMode',
      'services.dashboard.runServiceTokens[].name',
      'services.dashboard.runServiceTokens[].tokenEnvVar',
      'services.dashboard.runServiceTokens[].trustScope.org',
      'services.dashboard.runServiceTokens[].trustScope.project',
      'services.mcp.stdio.grantConfigWrite',
      'services.mcp.tokens[].name',
      'services.mcp.tokens[].scopes[]',
      'services.mcp.tokens[].tokenEnvVar',
    ]
    expect(retired.filter(leaf => walked.includes(leaf))).toEqual([])
    expect(retired.filter(leaf => leaf in CONFIG_MASKING_MAP)).toEqual([])
    expect(walked.filter(leaf => leaf.split('.')[0] === 'safety')).toEqual([])
    expect(walked.filter(leaf => /^services\.(mcp|dashboard)\./.test(leaf)).sort()).toEqual([
      'services.dashboard.artifactsDir',
      'services.dashboard.baseUrl',
      'services.dashboard.dbPath',
      'services.dashboard.host',
      'services.dashboard.port',
      'services.dashboard.workspace',
      'services.mcp.enabled',
      'services.mcp.host',
      'services.mcp.path',
      'services.mcp.port',
      'services.mcp.transport',
    ])
    expect(walked.filter(leaf => leaf.split('.')[0] === 'plugins')).toEqual([
      'plugins.auth[].package',
      'plugins.auth[].path',
      'plugins.providers[].package',
      'plugins.providers[].path',
    ])
  })
})
