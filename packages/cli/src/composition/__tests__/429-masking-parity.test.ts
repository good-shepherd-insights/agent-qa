// 2026-09-26, 429-03 D-08: the shared masking map against what `config show` masked before
// Phase 429 and against the schema-derived visibility oracle. Nothing masked before may become
// visible under the map except env-var names. 429-07 moved `config show` onto the map, so the
// snapshot cell now asserts the shipped masker's output over the pre-429 list.
import { AgentQaConfigSchema } from '@vostride/agent-qa-core'
import {
  CONFIG_MASK_PLACEHOLDER,
  CONFIG_SCHEMA_LEAVES,
  classifyConfigPath,
} from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'

import { buildConfigVisibilityOracle } from '../config-visibility.js'
import { buildMaskedResolvedConfig } from '../masked-config.js'

/**
 * Every leaf the pre-429 masker masked, measured on 2026-09-26 by running it over each leaf's
 * representative path. 2026-10-01 (432-22, D-12): the two token env-var names on this list (the only
 * leaves the map made visible, as env-var names) left the schema with their token lists; they are
 * kept in RETIRED_SINCE_429 and must now be masked again, as undeclared paths.
 */
const MASKED_BEFORE_429 = [
  'analytics.passRateScope.attributes.*',
  'analytics.passRateScope.attributes.*.regex',
  'registry.devices.*.match.*',
  'registry.llms[].providerHeaders.*',
  'registry.providers.*.*',
  'workspace.secretsFile',
]

const RETIRED_SINCE_429 = [
  'services.dashboard.runServiceTokens[].tokenEnvVar',
  'services.mcp.tokens[].tokenEnvVar',
]

const ENV_VAR_NAME_LEAVES: readonly string[] = []

const oracle = buildConfigVisibilityOracle(AgentQaConfigSchema)

function representativeSegments(pattern: string): (string | number)[] {
  const segments: (string | number)[] = []
  for (const token of pattern.split('.')) {
    if (token === '*') {
      segments.push('x')
    } else if (token.endsWith('[]')) {
      segments.push(token.slice(0, -2), 0)
    } else {
      segments.push(token)
    }
  }
  return segments
}

function representativePath(pattern: string): string {
  return representativeSegments(pattern).join('.')
}

/** Like representativeSegments, but with a record key unique to this pattern. */
function plantedSegments(pattern: string, index: number): (string | number)[] {
  return representativeSegments(pattern).map((segment) =>
    segment === 'x' ? `k${index}` : segment,
  )
}

function plantAt(
  root: Record<string, unknown>,
  segments: (string | number)[],
  value: string,
): void {
  let node: Record<string | number, unknown> = root
  segments.forEach((segment, depth) => {
    if (depth === segments.length - 1) {
      node[segment] = value
      return
    }
    const next = segments[depth + 1]
    node[segment] ??= typeof next === 'number' ? [] : {}
    node = node[segment] as Record<string | number, unknown>
  })
}

describe('429 masking parity', () => {
  it('MASKED-BEFORE-429-SNAPSHOT', () => {
    const resolved: Record<string, unknown> = {}
    const planted = MASKED_BEFORE_429.map((pattern, index) => {
      const segments = plantedSegments(pattern, index)
      const sentinel = `AGENT_QA_SENTINEL_${index}`
      plantAt(resolved, segments, sentinel)
      return { pattern, key: segments.join('.'), sentinel }
    })
    const leaves: readonly string[] = CONFIG_SCHEMA_LEAVES
    expect(planted.filter((leaf) => !leaves.includes(leaf.pattern))).toEqual([])

    const config = buildMaskedResolvedConfig({
      configPath: 'agent-qa.config.yaml',
      resolved,
      layers: [],
    })
    const byKey = new Map(config.entries.map((entry) => [entry.key, entry]))
    expect(config.entries).toHaveLength(MASKED_BEFORE_429.length)
    for (const { pattern, key, sentinel } of planted) {
      const expected = ENV_VAR_NAME_LEAVES.includes(pattern)
        ? { key, value: sentinel, source: 'default', masked: false }
        : { key, value: CONFIG_MASK_PLACEHOLDER, source: 'default', masked: true }
      expect(byKey.get(key), pattern).toEqual(expected)
    }
  })

  it('MASKING-PARITY-NOTHING-NEWLY-VISIBLE', () => {
    for (const pattern of RETIRED_SINCE_429) {
      expect(CONFIG_SCHEMA_LEAVES as readonly string[]).not.toContain(pattern)
      expect({ pattern, class: classifyConfigPath(representativeSegments(pattern)) }).toEqual({
        pattern,
        class: 'secret',
      })
    }
    for (const pattern of MASKED_BEFORE_429) {
      const expected = ENV_VAR_NAME_LEAVES.includes(pattern) ? 'env-var-name' : 'secret'
      expect({ pattern, class: classifyConfigPath(representativeSegments(pattern)) }).toEqual({
        pattern,
        class: expected,
      })
    }
  })

  it('ORACLE-OPAQUE-IMPLIES-SECRET', () => {
    const opaque = CONFIG_SCHEMA_LEAVES.filter((pattern) =>
      oracle.isOpaque(representativePath(pattern)),
    )
    expect(opaque.length).toBeGreaterThan(0)
    for (const pattern of opaque) {
      expect({ pattern, class: classifyConfigPath(representativeSegments(pattern)) }).toEqual({
        pattern,
        class: 'secret',
      })
    }
  })
})
