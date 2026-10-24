import { describe, it, expect } from 'vitest'
import { KnowledgeConfigSchema } from '../knowledge-schema.js'
import { AgentQaConfigSchema } from '../config-schema.js'

const minimalConfig = {
  workspace: {
    testMatch: ['tests/**/*.yaml'],
    suiteMatch: ['suites/**/*.suite.yaml'],
    hooksFile: 'hooks.yaml',
    envFile: '.env',
    secretsFile: '.env.secrets.local',
  },
  use: {
    mobile: { appState: 'preserve' },
  },
}

describe('KnowledgeConfigSchema — defaults (D-08, D-09)', () => {
  it('materializes knowledge defaults on a minimal config parse', () => {
    const result = AgentQaConfigSchema.safeParse(minimalConfig)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.knowledge.dir).toBe('agent-qa-knowledge')
      expect(result.data.knowledge.commitArtifacts).toBe('none')
      expect(result.data.knowledge.contextBudgetTokens).toBeUndefined()
    }
  })

  it('parses an empty knowledge object to full defaults', () => {
    const result = KnowledgeConfigSchema.parse({})
    expect(result.dir).toBe('agent-qa-knowledge')
    expect(result.commitArtifacts).toBe('none')
    expect(result.contextBudgetTokens).toBeUndefined()
  })
})

describe('KnowledgeConfigSchema — dir repo-relative predicate (D-10)', () => {
  it.each(['/abs/path', 'C:\\x', '../escape'])('rejects %s with the repo-relative message', (dir) => {
    const result = KnowledgeConfigSchema.safeParse({ dir })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some(i => i.message.includes('knowledge.dir must be repo-relative'))).toBe(true)
    }
  })

  it('accepts a repo-relative dir', () => {
    const result = KnowledgeConfigSchema.safeParse({ dir: 'docs/knowledge' })
    expect(result.success).toBe(true)
  })

  it('rejects an empty dir', () => {
    const result = KnowledgeConfigSchema.safeParse({ dir: '' })
    expect(result.success).toBe(false)
  })
})

describe('KnowledgeConfigSchema — contextBudgetTokens (D-09)', () => {
  it('rejects zero and negative caps', () => {
    expect(KnowledgeConfigSchema.safeParse({ contextBudgetTokens: 0 }).success).toBe(false)
    expect(KnowledgeConfigSchema.safeParse({ contextBudgetTokens: -5 }).success).toBe(false)
  })

  it('accepts a positive integer cap', () => {
    const result = KnowledgeConfigSchema.safeParse({ contextBudgetTokens: 1 })
    expect(result.success).toBe(true)
  })
})

describe('KnowledgeConfigSchema — commitArtifacts closed enum (D-08)', () => {
  it("rejects 'full' — no full mode exists", () => {
    const result = KnowledgeConfigSchema.safeParse({ commitArtifacts: 'full' })
    expect(result.success).toBe(false)
  })

  it("accepts 'thumbnails'", () => {
    const result = KnowledgeConfigSchema.safeParse({ commitArtifacts: 'thumbnails' })
    expect(result.success).toBe(true)
  })
})

describe('KnowledgeConfigSchema — strict backstop', () => {
  it('rejects unknown keys inside knowledge', () => {
    const result = KnowledgeConfigSchema.safeParse({ unknownKey: true })
    expect(result.success).toBe(false)
  })
})
