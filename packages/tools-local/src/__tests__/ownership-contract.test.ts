import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  AGENT_QA_TOOLS_LOCAL_ALLOWED_RESPONSIBILITIES,
  AGENT_QA_TOOLS_LOCAL_EXTERNAL_DEPENDENCIES,
  AGENT_QA_TOOLS_LOCAL_FORBIDDEN_RESPONSIBILITIES,
  AGENT_QA_TOOLS_LOCAL_INTERNAL_DEPENDENCIES,
  AGENT_QA_TOOLS_LOCAL_OWNERSHIP_CONTRACT,
  AGENT_QA_TOOLS_LOCAL_PACKAGE_CLASSES,
  AGENT_QA_TOOLS_LOCAL_PACKAGE_DIR,
  AGENT_QA_TOOLS_LOCAL_PACKAGE_NAME,
} from '../ownership-contract'

const packageJson = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
  dependencies?: Record<string, string>
}

describe('tools-local ownership contract', () => {
  it('exposes the package metadata', () => {
    expect(AGENT_QA_TOOLS_LOCAL_PACKAGE_NAME).toBe('@vostride/agent-qa-tools-local')
    expect(AGENT_QA_TOOLS_LOCAL_PACKAGE_DIR).toBe('packages/tools-local')
    expect([...AGENT_QA_TOOLS_LOCAL_PACKAGE_CLASSES]).toEqual(['storageImplementation'])
    expect([...AGENT_QA_TOOLS_LOCAL_EXTERNAL_DEPENDENCIES]).toEqual([])
    expect([...AGENT_QA_TOOLS_LOCAL_INTERNAL_DEPENDENCIES]).toEqual(['@vostride/agent-qa-agent'])
  })

  it('declares exactly the runtime dependencies package.json carries', () => {
    const declared = Object.keys(packageJson.dependencies ?? {}).sort()
    const contracted = [
      ...AGENT_QA_TOOLS_LOCAL_INTERNAL_DEPENDENCIES,
      ...AGENT_QA_TOOLS_LOCAL_EXTERNAL_DEPENDENCIES,
    ].sort()
    expect(declared).toEqual(contracted)
  })

  it('keeps ownership responsibilities explicit', () => {
    expect(AGENT_QA_TOOLS_LOCAL_ALLOWED_RESPONSIBILITIES.length).toBeGreaterThan(0)
    expect(AGENT_QA_TOOLS_LOCAL_FORBIDDEN_RESPONSIBILITIES.length).toBeGreaterThan(0)
    expect(AGENT_QA_TOOLS_LOCAL_OWNERSHIP_CONTRACT).toMatchObject({
      packageName: '@vostride/agent-qa-tools-local',
      packageDir: 'packages/tools-local',
    })
  })
})
