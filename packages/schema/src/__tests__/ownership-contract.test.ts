import { describe, expect, it } from 'vitest'
import {
  AGENT_QA_SCHEMA_ALLOWED_RESPONSIBILITIES,
  AGENT_QA_SCHEMA_DEPENDENCIES,
  AGENT_QA_SCHEMA_FORBIDDEN_RESPONSIBILITIES,
  AGENT_QA_SCHEMA_OWNERSHIP_CONTRACT,
  AGENT_QA_SCHEMA_PACKAGE_CLASSES,
  AGENT_QA_SCHEMA_PACKAGE_DIR,
  AGENT_QA_SCHEMA_PACKAGE_NAME,
} from '../ownership-contract'

describe('schema ownership contract', () => {
  it('exposes the package metadata', () => {
    expect(AGENT_QA_SCHEMA_PACKAGE_NAME).toBe('@vostride/agent-qa-schema')
    expect(AGENT_QA_SCHEMA_PACKAGE_DIR).toBe('packages/schema')
    expect([...AGENT_QA_SCHEMA_PACKAGE_CLASSES]).toEqual([
      'browserSafe',
      'providerNeutral',
      'storageNeutral',
    ])
    expect([...AGENT_QA_SCHEMA_DEPENDENCIES]).toEqual(['@vostride/agent-qa-ids'])
  })

  it('keeps ownership responsibilities explicit', () => {
    expect(AGENT_QA_SCHEMA_ALLOWED_RESPONSIBILITIES.length).toBeGreaterThan(0)
    expect(AGENT_QA_SCHEMA_FORBIDDEN_RESPONSIBILITIES.length).toBeGreaterThan(0)
    expect(AGENT_QA_SCHEMA_OWNERSHIP_CONTRACT).toMatchObject({
      packageName: '@vostride/agent-qa-schema',
      packageDir: 'packages/schema',
    })
  })
})
