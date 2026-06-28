import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { AGENT_QA_CORE_MIGRATION_LEDGER } from '../../../../core/src/ownership-contract.js'
import { applyLedger, transitionalLeaks } from '../apply-ledger.js'
import { extractSpecifiers, sourceFilesFor } from '../extract-specifiers.js'
import type { LedgerEntry } from '../../contract-types.js'
import type { SpecifierHit } from '../extract-specifiers.js'

const testDir = dirname(fileURLToPath(import.meta.url))
const packagesRoot = join(testDir, '..', '..', '..', '..')
const repoRoot = join(packagesRoot, '..')

function hit(specifier: string, line = 1): SpecifierHit {
  return { specifier, file: 'packages/core/src/fixture.ts', line }
}

function ledger(targets: readonly string[]): LedgerEntry[] {
  return targets.map(target => ({
    rule: target.startsWith('@ai-sdk/') ? 'modelOwner' : 'storageImplementation',
    target,
    clearedBy: 'test',
    reason: 'fixture',
  }))
}

describe('transitionalLeaks', () => {
  it('keeps provider SDK and native-store external hits while excluding node builtins', () => {
    expect(
      transitionalLeaks([
        hit('@ai-sdk/openai'),
        hit('better-sqlite3', 2),
        hit('sharp', 3),
        hit('node:fs', 4),
        hit('fs', 5),
        hit('zod', 6),
        hit('@vostride/agent-qa-schema', 7),
        hit('./local.js', 8),
      ]).map(leak => leak.specifier),
    ).toEqual(['@ai-sdk/openai', 'better-sqlite3', 'sharp'])
  })
})

describe('applyLedger', () => {
  it('waives core source leaks covered by the on-disk five-row migration ledger', () => {
    const coreHits = sourceFilesFor('packages/core', repoRoot).flatMap(extractSpecifiers)

    expect(applyLedger(transitionalLeaks(coreHits), AGENT_QA_CORE_MIGRATION_LEDGER)).toEqual([])
  })

  it('flags an uncovered transitional leak', () => {
    expect(applyLedger([hit('@ai-sdk/mistral')], ledger(['@ai-sdk/openai']))).toEqual([
      'packages/core | packages/core/src/fixture.ts:1 | @ai-sdk/mistral | unwaived transitional leak',
      'packages/core | ledger | @ai-sdk/openai | stale ledger entry',
    ])
  })

  it('flags stale ledger rows that do not match current leaks', () => {
    expect(applyLedger([hit('@ai-sdk/openai')], ledger(['@ai-sdk/openai', 'sharp']))).toEqual([
      'packages/core | ledger | sharp | stale ledger entry',
    ])
  })

  it('matches scoped provider targets and exact native-store targets', () => {
    expect(
      applyLedger(
        [
          hit('@ai-sdk/openai/provider'),
          hit('better-sqlite3'),
          hit('sharp'),
        ],
        ledger(['@ai-sdk/openai', 'better-sqlite3', 'sharp']),
      ),
    ).toEqual([])
  })
})
