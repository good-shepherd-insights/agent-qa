import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  NATIVE_STORE_DENYLIST,
  PACKAGE_CLASS_RULES,
  PROVIDER_SDK_FORBIDDEN_PREFIX,
} from '../contract-types.js'
import { AGENT_QA_CORE_HOST_BASELINE } from '../core-host-baseline.js'
import { HOST_EXTERNALS, matchesDenylistEntry } from '../lint/denylist.js'
import { ARCH_MANIFEST } from '../manifest.js'
import type { LedgerEntry, OwnershipContract } from '../contract-types.js'

const testDir = dirname(fileURLToPath(import.meta.url))
const packagesRoot = join(testDir, '..', '..', '..')
const repoRoot = join(packagesRoot, '..')
const legalPackageClasses = new Set(Object.keys(PACKAGE_CLASS_RULES))

const expectedPackageDirs = [
  'packages/arch',
  'packages/agent',
  'packages/agent-local',
  'packages/schema',
  'packages/model',
  'packages/runner',
  'packages/knowledge-local',
  'packages/core',
  'packages/ids',
  'packages/web',
  'packages/android',
  'packages/ios',
  'packages/mcp',
  'packages/cli',
  'packages/tools-local',
  'packages/dashboard-server',
  'packages/dashboard-ui',
] as const

const stalePrototypeDirs = [] as const

function packageDirsFromManifest(): string[] {
  return ARCH_MANIFEST.packages.map(contract => contract.packageDir)
}

function workspaceMemberDirs(): string[] {
  const workspaceYaml = readFileSync(join(repoRoot, 'pnpm-workspace.yaml'), 'utf8')
  const workspaceGlobs = workspaceYaml
    .split(/\r?\n/u)
    .map(line => line.trim())
    .map(line => line.match(/^-\s*["']?(packages\/\*)["']?\s*$/u)?.[1])
    .filter((glob): glob is 'packages/*' => glob === 'packages/*')

  if (workspaceGlobs.length === 0) {
    throw new Error('pnpm-workspace.yaml must declare the packages/* workspace member glob')
  }

  const workspaceMembers = new Set<string>()
  for (const glob of workspaceGlobs) {
    if (glob !== 'packages/*') {
      continue
    }

    for (const entry of readdirSync(packagesRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue
      }

      const packageDir = join(packagesRoot, entry.name)
      if (existsSync(join(packageDir, 'package.json'))) {
        workspaceMembers.add(`packages/${entry.name}`)
      }
    }
  }

  return [...workspaceMembers].sort()
}

function contractBearingDirs(): string[] {
  return readdirSync(packagesRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .filter(name => {
      const packageDir = join(packagesRoot, name)
      return (
        existsSync(join(packageDir, 'package.json')) &&
        existsSync(join(packageDir, 'src', 'ownership-contract.ts'))
      )
    })
    .map(name => `packages/${name}`)
    .sort()
}

function findSetMismatchOffenders(
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

function findContractlessWorkspaceOffenders(
  memberDirs: readonly string[],
  contractDirs: readonly string[],
): string[] {
  const contractDirSet = new Set(contractDirs)
  return memberDirs
    .filter(memberDir => !contractDirSet.has(memberDir))
    .map(memberDir => `${memberDir}: workspace package missing src/ownership-contract.ts`)
    .sort()
}

function findDuplicatePackageDirOffenders(packageDirs: readonly string[]): string[] {
  const seen = new Set<string>()
  const duplicates = new Set<string>()

  for (const packageDir of packageDirs) {
    if (seen.has(packageDir)) {
      duplicates.add(packageDir)
    }
    seen.add(packageDir)
  }

  return [...duplicates].sort().map(packageDir => `${packageDir}: duplicate packageDir`)
}

function findStalePrototypeOffenders(packageDirs: readonly string[]): string[] {
  const manifestDirs = new Set(packageDirs)
  return stalePrototypeDirs
    .filter(packageDir => manifestDirs.has(packageDir))
    .map(packageDir => `${packageDir}: stale prototype dir must not be declared`)
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

function findContractShapeOffenders(contracts: readonly unknown[]): string[] {
  const offenders: string[] = []

  contracts.forEach((contract, index) => {
    const candidate = contract as Record<string, unknown>
    const label =
      typeof candidate.packageDir === 'string' && candidate.packageDir.length > 0
        ? candidate.packageDir
        : `contract[${index}]`

    if (typeof candidate.packageName !== 'string' || candidate.packageName.length === 0) {
      offenders.push(`${label}: packageName must be a non-empty string`)
    }

    if (typeof candidate.packageDir !== 'string' || candidate.packageDir.length === 0) {
      offenders.push(`${label}: packageDir must be a non-empty string`)
    }

    if (!isStringArray(candidate.packageClasses) || candidate.packageClasses.length === 0) {
      offenders.push(`${label}: packageClasses must be a non-empty string array`)
    } else {
      for (const packageClass of candidate.packageClasses) {
        if (!legalPackageClasses.has(packageClass)) {
          offenders.push(`${label}: illegal package class ${packageClass}`)
        }
      }
    }

    for (const field of [
      'allowedResponsibilities',
      'forbiddenResponsibilities',
      'externalDependencies',
      'internalDependencies',
    ]) {
      if (!isStringArray(candidate[field])) {
        offenders.push(`${label}: ${field} must be a string array`)
      }
    }
  })

  return offenders
}

function readCoreDependencies(): Set<string> {
  const packageJson = JSON.parse(
    readFileSync(join(repoRoot, 'packages', 'core', 'package.json'), 'utf8'),
  ) as { dependencies?: Record<string, string> }

  return new Set(Object.keys(packageJson.dependencies ?? {}))
}

function findCoreLedgerOffenders(
  coreContract: OwnershipContract | undefined,
  coreDependencies: ReadonlySet<string>,
): string[] {
  if (!coreContract) {
    return ['packages/core: missing from manifest']
  }

  const offenders: string[] = []
  const ledger = coreContract.ledger ?? []
  const ledgerTargets = new Set(ledger.map(entry => entry.target))
  const baselineTargets = new Set(AGENT_QA_CORE_HOST_BASELINE)
  const leakingDependencies = [...coreDependencies]
    .filter(isCoreLeakingDependency)
    .sort()

  for (const dependency of leakingDependencies) {
    if (!ledgerTargets.has(dependency) && !baselineTargets.has(dependency)) {
      offenders.push(`packages/core: missing ledger or baseline entry for ${dependency}`)
    }
  }

  for (const entry of ledger) {
    if (!coreDependencies.has(entry.target)) {
      offenders.push(`packages/core: ledger target ${entry.target} is not a real dependency`)
    }

    for (const field of ['rule', 'target', 'clearedBy', 'reason'] satisfies Array<
      keyof LedgerEntry
    >) {
      if (typeof entry[field] !== 'string' || entry[field].length === 0) {
        offenders.push(`packages/core: ledger entry for ${entry.target} has empty ${field}`)
      }
    }
  }

  return offenders
}

function isCoreLeakingDependency(dependency: string): boolean {
  return (
    dependency.startsWith(PROVIDER_SDK_FORBIDDEN_PREFIX) ||
    HOST_EXTERNALS.has(dependency) ||
    NATIVE_STORE_DENYLIST.some(entry => matchesDenylistEntry(dependency, entry))
  )
}

describe('ARCH_MANIFEST enumeration', () => {
  it('matches the on-disk set of contract-bearing packages', () => {
    expect(
      findSetMismatchOffenders(
        'manifest vs on-disk contracts',
        packageDirsFromManifest(),
        contractBearingDirs(),
      ),
    ).toEqual([])
  })

  it('requires every workspace package to declare an ownership contract', () => {
    expect(findContractlessWorkspaceOffenders(workspaceMemberDirs(), contractBearingDirs())).toEqual([])
  })

  it('reports a contract-less workspace member in a held-out fixture', () => {
    expect(
      findContractlessWorkspaceOffenders(['packages/a', 'packages/b'], ['packages/a']),
    ).toContain('packages/b: workspace package missing src/ownership-contract.ts')
  })

  it('declares exactly the expected Phase 335 package set', () => {
    const packageDirs = packageDirsFromManifest()

    expect(
      findSetMismatchOffenders('manifest vs Phase 335 expected package set', packageDirs, [
        ...expectedPackageDirs,
      ]),
    ).toEqual([])
    expect(findStalePrototypeOffenders(packageDirs)).toEqual([])
    expect(findDuplicatePackageDirOffenders(packageDirs)).toEqual([])
  })
})

describe('ARCH_MANIFEST contract shape', () => {
  it('contains only legal package classes and required array fields', () => {
    expect(findContractShapeOffenders(ARCH_MANIFEST.packages)).toEqual([])
  })

  it('reports an illegal class in a held-out fixture', () => {
    expect(
      findContractShapeOffenders([
        {
          packageName: '@vostride/agent-qa-fixture',
          packageDir: 'packages/fixture',
          packageClasses: ['notAClass'],
          allowedResponsibilities: [],
          forbiddenResponsibilities: [],
          externalDependencies: [],
          internalDependencies: [],
        },
      ]),
    ).toContain('packages/fixture: illegal package class notAClass')
  })
})

describe('ARCH_MANIFEST core transitional ledger', () => {
  it('covers current core npm-dependency-level provider/native-store debt and has no stray entries', () => {
    expect(
      findCoreLedgerOffenders(
        ARCH_MANIFEST.packages.find(contract => contract.packageDir === 'packages/core'),
        readCoreDependencies(),
      ),
    ).toEqual([])
  })
})
