import { describe, expect, it } from 'vitest'
import { compileForbiddenEntry, findClassRuleOffenders } from '../classify-rule.js'
import type { PackageClass, OwnershipContract } from '../../contract-types.js'
import type { SpecifierHit } from '../extract-specifiers.js'

function hit(specifier: string, line = 1): SpecifierHit {
  return { specifier, file: 'fixture.ts', line }
}

function fixtureContract(packageClasses: readonly PackageClass[]): OwnershipContract {
  return {
    packageName: '@vostride/agent-qa-fixture',
    packageDir: 'packages/fixture',
    packageClasses,
    allowedResponsibilities: [],
    forbiddenResponsibilities: [],
    externalDependencies: [],
    internalDependencies: [],
  }
}

describe('compileForbiddenEntry', () => {
  it('skips prose entries that contain spaces', () => {
    for (const entry of [
      'host access',
      'storage access through ports only',
      'importable from dashboard UI',
      'any class-rule violation not listed on the package ledger',
    ]) {
      expect(compileForbiddenEntry(entry)).toBeNull()
    }
  })

  it('matches node:* against Node builtin specifiers only', () => {
    const matcher = compileForbiddenEntry('node:*')

    expect(matcher?.(hit('node:fs'))).toBe(true)
    expect(matcher?.(hit('fs'))).toBe(true)
    expect(matcher?.(hit('@ai-sdk/openai'))).toBe(false)
  })

  it('matches provider SDK wildcard prefixes and leaves orchestration ai alone', () => {
    const matcher = compileForbiddenEntry('@ai-sdk/*')

    expect(matcher?.(hit('@ai-sdk/openai'))).toBe(true)
    expect(matcher?.(hit('@ai-sdk/openai/provider'))).toBe(true)
    expect(matcher?.(hit('ai'))).toBe(false)
  })

  it('matches knowledge-write firewall entries by dotted or path substring', () => {
    const addMatcher = compileForbiddenEntry('knowledge.add')
    const promotionMatcher = compileForbiddenEntry('promotion')

    expect(addMatcher?.(hit('@vostride/agent-qa-knowledge/src/knowledge.add.js'))).toBe(true)
    expect(addMatcher?.(hit('@vostride/agent-qa-knowledge/src/knowledge/add.js'))).toBe(true)
    expect(addMatcher?.(hit('@vostride/agent-qa-knowledge/src/knowledge/read.js'))).toBe(false)
    expect(promotionMatcher?.(hit('@vostride/agent-qa-knowledge/src/promotion.js'))).toBe(true)
  })

  it('matches exact external packages and builtins', () => {
    const sqliteMatcher = compileForbiddenEntry('better-sqlite3')
    const fsMatcher = compileForbiddenEntry('node:fs')

    expect(sqliteMatcher?.(hit('better-sqlite3'))).toBe(true)
    expect(sqliteMatcher?.(hit('better-sqlite3/helpers'))).toBe(true)
    expect(sqliteMatcher?.(hit('sharp'))).toBe(false)
    expect(fsMatcher?.(hit('node:fs'))).toBe(true)
    expect(fsMatcher?.(hit('fs'))).toBe(true)
  })
})

describe('findClassRuleOffenders', () => {
  it('flags provider SDK imports in providerNeutral packages but allows ai', () => {
    expect(
      findClassRuleOffenders(fixtureContract(['providerNeutral']), [
        hit('@ai-sdk/openai'),
      ]),
    ).toEqual([
      'packages/fixture | fixture.ts:1 | @ai-sdk/openai | providerNeutral forbids @ai-sdk/*',
    ])

    expect(findClassRuleOffenders(fixtureContract(['providerNeutral']), [hit('ai')])).toEqual([])
  })

  it('flags browserSafe Node and native-store imports', () => {
    expect(
      findClassRuleOffenders(fixtureContract(['browserSafe']), [
        hit('node:fs'),
        hit('better-sqlite3', 2),
      ]),
    ).toEqual([
      'packages/fixture | fixture.ts:1 | node:fs | browserSafe forbids node:*',
      'packages/fixture | fixture.ts:2 | better-sqlite3 | browserSafe forbids better-sqlite3',
    ])
  })

  it('flags storageNeutral Node fs and native-store imports', () => {
    expect(
      findClassRuleOffenders(fixtureContract(['storageNeutral']), [
        hit('fs'),
        hit('sharp', 2),
      ]),
    ).toEqual([
      'packages/fixture | fixture.ts:1 | fs | storageNeutral forbids fs',
      'packages/fixture | fixture.ts:2 | sharp | storageNeutral forbids sharp',
    ])
  })

  it('flags adapter knowledge-write imports and accepts read imports', () => {
    expect(
      findClassRuleOffenders(fixtureContract(['adapter']), [
        hit('@vostride/agent-qa-knowledge/src/knowledge.add.js'),
        hit('@vostride/agent-qa-knowledge/src/knowledge/read.js', 2),
      ]),
    ).toEqual([
      'packages/fixture | fixture.ts:1 | @vostride/agent-qa-knowledge/src/knowledge.add.js | adapter forbids knowledge.add',
    ])
  })

  it('does not enforce prose-only util entries or empty-forbidden classes', () => {
    expect(findClassRuleOffenders(fixtureContract(['util']), [hit('sharp')])).toEqual([])
    expect(findClassRuleOffenders(fixtureContract(['surface']), [hit('node:fs')])).toEqual([])
    expect(findClassRuleOffenders(fixtureContract(['modelOwner']), [hit('@ai-sdk/openai')])).toEqual(
      [],
    )
    expect(
      findClassRuleOffenders(fixtureContract(['storageImplementation']), [hit('better-sqlite3')]),
    ).toEqual([])
  })

  it('skips transitional packages because ledger reconciliation owns those leaks', () => {
    expect(
      findClassRuleOffenders(fixtureContract(['transitional', 'providerNeutral']), [
        hit('@ai-sdk/openai'),
      ]),
    ).toEqual([])
  })
})
