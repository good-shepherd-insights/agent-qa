import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { findDepReconciliationOffenders, findSetMismatchOffenders } from '../reconcile-deps.js'
import type { OwnershipContract } from '../../contract-types.js'
import type { SpecifierHit } from '../extract-specifiers.js'

function hit(specifier: string, line = 1): SpecifierHit {
  return { specifier, file: 'src/fixture.ts', line }
}

function fixtureContract(
  overrides: Partial<Pick<OwnershipContract, 'externalDependencies' | 'internalDependencies'>>,
): OwnershipContract {
  return {
    packageName: '@vostride/agent-qa-fixture',
    packageDir: 'packages/fixture',
    packageClasses: ['util'],
    allowedResponsibilities: [],
    forbiddenResponsibilities: [],
    externalDependencies: overrides.externalDependencies ?? [],
    internalDependencies: overrides.internalDependencies ?? [],
  }
}

function fixtureRepoRoot(dependencies: Record<string, string>): string {
  const repoRoot = mkdtempSync(join(tmpdir(), 'agent-qa-arch-reconcile-'))
  const packageRoot = join(repoRoot, 'packages', 'fixture')
  mkdirSync(packageRoot, { recursive: true })
  writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({ dependencies }))

  return repoRoot
}

describe('findSetMismatchOffenders', () => {
  it('reports missing and unexpected values in sorted order', () => {
    expect(findSetMismatchOffenders('fixture deps', ['zod', 'ai'], ['zod', 'yaml'])).toEqual([
      'fixture deps: missing yaml',
      'fixture deps: unexpected ai',
    ])
  })
})

describe('findDepReconciliationOffenders', () => {
  it('returns no offenders when source imports, contract deps, and package.json deps align', () => {
    const repoRoot = fixtureRepoRoot({ zod: '^4.0.0' })
    const contract = fixtureContract({
      externalDependencies: ['zod'],
      internalDependencies: ['@vostride/agent-qa-schema'],
    })

    expect(
      findDepReconciliationOffenders(
        contract,
        [hit('zod'), hit('@vostride/agent-qa-schema'), hit('./local.js')],
        repoRoot,
      ),
    ).toEqual([])
  })

  it('flags source imports that are missing from the contract', () => {
    const repoRoot = fixtureRepoRoot({ zod: '^4.0.0' })
    const contract = fixtureContract({ externalDependencies: ['zod'], internalDependencies: [] })

    expect(findDepReconciliationOffenders(contract, [hit('zod'), hit('left-pad')], repoRoot))
      .toContain('packages/fixture external deps: unexpected left-pad')
  })

  it('flags stale contract deps that are no longer imported', () => {
    const repoRoot = fixtureRepoRoot({ zod: '^4.0.0', yaml: '^2.0.0' })
    const contract = fixtureContract({
      externalDependencies: ['zod', 'yaml'],
      internalDependencies: ['@vostride/agent-qa-core'],
    })

    expect(findDepReconciliationOffenders(contract, [hit('zod')], repoRoot)).toEqual([
      'packages/fixture external deps: missing yaml',
      'packages/fixture internal deps: missing @vostride/agent-qa-core',
    ])
  })

  it('flags package.json dependencies absent from the contract', () => {
    const repoRoot = fixtureRepoRoot({ zod: '^4.0.0', sharp: '^1.0.0' })
    const contract = fixtureContract({ externalDependencies: ['zod'], internalDependencies: [] })

    expect(findDepReconciliationOffenders(contract, [hit('zod')], repoRoot)).toEqual([
      'packages/fixture package.json vs contract: unexpected sharp',
    ])
  })

  it('counts type-only imports as real imports because hits are source-derived', () => {
    const repoRoot = fixtureRepoRoot({ '@types/node': '^24.0.0' })
    const contract = fixtureContract({
      externalDependencies: ['@types/node'],
      internalDependencies: [],
    })

    expect(findDepReconciliationOffenders(contract, [hit('@types/node')], repoRoot)).toEqual([])
  })
})
