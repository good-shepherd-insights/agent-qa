// 2026-09-26, 429-03 D-08: the shared masking map against today's `config show` masker and the
// schema-derived visibility oracle. Nothing today's masker hides may become visible under the
// map except env-var names. Plan 07 replaces the masker and re-targets the snapshot cell.
import { AgentQaConfigSchema } from '@vostride/agent-qa-core'
import { CONFIG_SCHEMA_LEAVES, classifyConfigPath } from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'

import { buildConfigVisibilityOracle } from '../config-visibility.js'
import { isMaskedConfigPath } from '../masked-config.js'

/** Every leaf today's masker masks, measured on 2026-09-26 with the computation below. */
const MASKED_BEFORE_429 = [
  'analytics.passRateScope.attributes.*',
  'analytics.passRateScope.attributes.*.regex',
  'registry.devices.*.match.*',
  'registry.llms[].providerHeaders.*',
  'registry.providers.*.*',
  'services.dashboard.runServiceTokens[].tokenEnvVar',
  'services.mcp.tokens[].tokenEnvVar',
  'workspace.secretsFile',
]

const ENV_VAR_NAME_LEAVES = [
  'services.dashboard.runServiceTokens[].tokenEnvVar',
  'services.mcp.tokens[].tokenEnvVar',
]

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

describe('429 masking parity', () => {
  it('MASKED-BEFORE-429-SNAPSHOT', () => {
    const live = CONFIG_SCHEMA_LEAVES.filter((pattern) =>
      isMaskedConfigPath(representativePath(pattern), oracle),
    )
    expect([...live].sort()).toEqual(MASKED_BEFORE_429)
  })

  it('MASKING-PARITY-NOTHING-NEWLY-VISIBLE', () => {
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
