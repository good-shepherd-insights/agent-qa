import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { classifySpecifier } from './extract-specifiers.js'
import type { OwnershipContract } from '../contract-types.js'
import type { SpecifierHit } from './extract-specifiers.js'

export function findSetMismatchOffenders(
  label: string,
  actualValues: readonly string[],
  expectedValues: readonly string[],
): string[] {
  const actual = new Set(actualValues)
  const expected = new Set(expectedValues)
  const offenders: string[] = []

  for (const expectedValue of expected) {
    if (!actual.has(expectedValue)) {
      offenders.push(`${label}: missing ${expectedValue}`)
    }
  }

  for (const actualValue of actual) {
    if (!expected.has(actualValue)) {
      offenders.push(`${label}: unexpected ${actualValue}`)
    }
  }

  return offenders.sort()
}

export function findDepReconciliationOffenders(
  contract: OwnershipContract,
  hits: readonly SpecifierHit[],
  repoRoot: string,
): string[] {
  const realExternal = new Set<string>()
  const realInternal = new Set<string>()

  for (const hit of hits) {
    const classified = classifySpecifier(hit.specifier)
    if (classified.kind === 'external') {
      realExternal.add(classified.pkgName)
    } else if (classified.kind === 'internal') {
      realInternal.add(classified.pkgName)
    }
  }

  const packageJsonDeps = readPackageJsonDependencies(repoRoot, contract.packageDir)

  return [
    ...findSetMismatchOffenders(
      `${contract.packageDir} external deps`,
      [...realExternal].sort(),
      [...contract.externalDependencies].sort(),
    ),
    ...findSetMismatchOffenders(
      `${contract.packageDir} internal deps`,
      [...realInternal].sort(),
      [...contract.internalDependencies].sort(),
    ),
    ...findSetMismatchOffenders(
      `${contract.packageDir} package.json vs contract`,
      packageJsonDeps,
      [...contract.externalDependencies].sort(),
    ),
  ]
}

function readPackageJsonDependencies(repoRoot: string, packageDir: string): string[] {
  const packageJson = JSON.parse(
    readFileSync(join(repoRoot, packageDir, 'package.json'), 'utf8'),
  ) as { dependencies?: Record<string, string> }

  return Object.keys(packageJson.dependencies ?? {})
    .filter(dependency => !dependency.startsWith('@vostride/agent-qa-'))
    .sort()
}
