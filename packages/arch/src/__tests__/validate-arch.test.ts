import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  NATIVE_STORE_DENYLIST,
  PACKAGE_CLASS_RULES,
  PROVIDER_SDK_FORBIDDEN_PREFIX,
} from '../contract-types.js'
import { AGENT_QA_CORE_HOST_BASELINE } from '../core-host-baseline.js'
import type { OwnershipContract, PackageClass } from '../contract-types.js'
import { findClassRuleOffenders } from '../lint/classify-rule.js'
import {
  configFilesFor,
  extractSpecifiers,
  sourceFilesFor,
  specifiersInSource,
  type SpecifierHit,
} from '../lint/extract-specifiers.js'
import { applyLedger, transitionalLeaks } from '../lint/apply-ledger.js'
import { findDepReconciliationOffenders } from '../lint/reconcile-deps.js'
import { AGENT_QA_CORE_MIGRATION_LEDGER } from '../../../core/src/ownership-contract.js'
import { findCycleOffenders } from '../lint/walk-dag.js'
import { findDirectionOffenders } from '../lint/direction.js'
import {
  findKnowledgeWriteOffenders,
  WRITE_SURFACE_PACKAGES,
} from '../lint/knowledge-write.js'
import {
  findKnowledgeLocalWallOffenders,
  findReaderCarveoutOffenders,
} from '../lint/reader-carveout.js'
import {
  contractBearingDirs,
  findContractlessWorkspaceOffenders,
  workspaceMemberDirs,
} from '../lint/workspace-members.js'
import {
  EXPECTED_SURFACE_CLASS_PACKAGES,
  FIREWALLED_SURFACE_DIRS,
  findSurfaceClassGoldenSetOffenders,
  findSurfaceFirewallOffenders,
  isFirewalledSurfaceDir,
  SURFACE_ALLOWED_INTERNAL_PACKAGES,
  type SurfaceFirewallScan,
} from '../lint/surface-firewall.js'
import {
  SURFACE_FIREWALL_LEDGER,
  type SurfaceLedgerEntry,
} from '../lint/surface-firewall-ledger.js'
import { ARCH_MANIFEST } from '../manifest.js'

const testDir = dirname(fileURLToPath(import.meta.url))
const packagesRoot = join(testDir, '..', '..', '..')
const repoRoot = join(packagesRoot, '..')

function hitsFromFiles(files: readonly string[]): SpecifierHit[] {
  return files
    .flatMap(extractSpecifiers)
    .map(hit => ({
      ...hit,
      file: relative(repoRoot, hit.file),
    }))
}

function packageSourceHits(contract: OwnershipContract): SpecifierHit[] {
  return hitsFromFiles(sourceFilesFor(contract.packageDir, repoRoot))
}

function packageAllHits(contract: OwnershipContract): SpecifierHit[] {
  return hitsFromFiles([
    ...sourceFilesFor(contract.packageDir, repoRoot),
    ...configFilesFor(contract.packageDir, repoRoot),
  ])
}

function fixtureContract(overrides: Partial<OwnershipContract> = {}): OwnershipContract {
  return {
    packageName: '@vostride/agent-qa-fixture',
    packageDir: 'packages/fixture',
    packageClasses: ['providerNeutral'],
    allowedResponsibilities: [],
    forbiddenResponsibilities: [],
    externalDependencies: [],
    internalDependencies: [],
    ...overrides,
  }
}

function fixtureHit(specifier: string, overrides: Partial<SpecifierHit> = {}): SpecifierHit {
  return {
    specifier,
    file: 'fixture.ts',
    line: 1,
    ...overrides,
  }
}

function fixtureLedgerEntry(target: string) {
  return {
    rule: 'providerNeutral' as PackageClass,
    target,
    clearedBy: 'fixture',
    reason: 'fixture ledger entry',
  }
}

const FIXTURE_SURFACE_FILE = 'packages/cli/src/fixture.ts'

function surfaceLedgerFixture(specifier: string, file = FIXTURE_SURFACE_FILE): SurfaceLedgerEntry {
  return { file, specifier, clearedBy: 'fixture', reason: 'fixture surface ledger entry' }
}

function surfaceScan(
  hits: readonly SpecifierHit[],
  packageDir = 'packages/cli',
): SurfaceFirewallScan[] {
  return [{ packageDir, hits }]
}

function surfaceHit(specifier: string, line = 1, file = FIXTURE_SURFACE_FILE): SpecifierHit {
  return { specifier, file, line }
}

function surfaceClassContracts(packageNames: readonly string[]): OwnershipContract[] {
  return packageNames.map(packageName =>
    fixtureContract({
      packageName,
      packageDir: `packages/${packageName.replace('@vostride/', '')}`,
      packageClasses: ['surface'],
    }),
  )
}

describe('validate:arch (LINT-01..05)', () => {
  it('every contract-bearing package satisfies its class rules and dep contract', () => {
    const offenders: string[] = []
    const contracts: readonly OwnershipContract[] = ARCH_MANIFEST.packages
    const surfaceScans: SurfaceFirewallScan[] = []

    for (const contract of contracts) {
      const sourceHits = packageSourceHits(contract)
      const allHits = packageAllHits(contract)

      if (contract.packageClasses.includes('transitional')) {
        offenders.push(
          ...applyLedger(
            transitionalLeaks(allHits),
            contract.ledger ?? [],
            new Set(AGENT_QA_CORE_HOST_BASELINE),
          ),
        )
      } else {
        offenders.push(...findClassRuleOffenders(contract, allHits))
      }

      offenders.push(...findDepReconciliationOffenders(contract, sourceHits, repoRoot))
      if (contract.packageDir === 'packages/cli') {
        offenders.push(...findReaderCarveoutOffenders(sourceHits))
      }
      if (isFirewalledSurfaceDir(contract.packageDir)) {
        surfaceScans.push({ packageDir: contract.packageDir, hits: sourceHits })
      }
      offenders.push(...findKnowledgeLocalWallOffenders(contract, sourceHits))
    }

    offenders.push(...findSurfaceFirewallOffenders(surfaceScans, SURFACE_FIREWALL_LEDGER))
    offenders.push(...findSurfaceClassGoldenSetOffenders(contracts))
    offenders.push(...findCycleOffenders(contracts))
    offenders.push(...findDirectionOffenders(contracts))
    offenders.push(...findKnowledgeWriteOffenders(contracts))
    offenders.push(
      ...findContractlessWorkspaceOffenders(
        workspaceMemberDirs(repoRoot),
        contractBearingDirs(repoRoot),
      ),
    )

    expect(offenders).toEqual([])
  })
})

describe('validate:arch held-out fixtures', () => {
  it('held-out workspace-member contract check rejects a contract-less member', () => {
    expect(
      findContractlessWorkspaceOffenders(
        ['packages/with-contract', 'packages/without-contract'],
        ['packages/with-contract'],
      ),
    ).toEqual([
      'packages/without-contract: workspace package missing src/ownership-contract.ts',
    ])
  })

  it('held-out provider firewall rejects provider SDKs and accepts the ai substrate', () => {
    expect(PACKAGE_CLASS_RULES.providerNeutral.allowed).toContain('ai')

    expect(
      findClassRuleOffenders(
        fixtureContract({ packageClasses: ['providerNeutral'] }),
        [fixtureHit(`${PROVIDER_SDK_FORBIDDEN_PREFIX}openai`)],
      ),
    ).toEqual([
      `packages/fixture | fixture.ts:1 | ${PROVIDER_SDK_FORBIDDEN_PREFIX}openai | providerNeutral forbids @ai-sdk/*`,
    ])

    expect(
      findClassRuleOffenders(
        fixtureContract({ packageClasses: ['providerNeutral'] }),
        [fixtureHit('ai')],
      ),
    ).toEqual([])
  })

  it('held-out knowledge-write firewall rejects neutral packages that depend on the agent write surface', () => {
    const neutralContract = fixtureContract({
      packageName: '@vostride/agent-qa-neutral',
      packageDir: 'packages/neutral',
      packageClasses: ['providerNeutral', 'storageNeutral'],
      internalDependencies: [WRITE_SURFACE_PACKAGES[0]],
    })

    expect(findKnowledgeWriteOffenders([neutralContract])).toEqual([
      `knowledge-write: @vostride/agent-qa-neutral (providerNeutral) ⇏ ${WRITE_SURFACE_PACKAGES[0]} (write surface)`,
    ])
  })

  it('held-out knowledge-write firewall accepts the schema-only runner shape', () => {
    const runnerContract = fixtureContract({
      packageName: '@vostride/agent-qa-runner',
      packageDir: 'packages/runner',
      packageClasses: ['providerNeutral', 'storageNeutral'],
      internalDependencies: ['@vostride/agent-qa-schema'],
    })

    expect(findKnowledgeWriteOffenders([runnerContract])).toEqual([])
  })

  it('held-out storage seam rejects native store packages and Node filesystem imports', () => {
    expect(NATIVE_STORE_DENYLIST).toContain('better-sqlite3')

    expect(
      findClassRuleOffenders(
        fixtureContract({ packageClasses: ['storageNeutral'] }),
        [fixtureHit('better-sqlite3'), fixtureHit('node:fs', { line: 2 })],
      ),
    ).toEqual([
      'packages/fixture | fixture.ts:1 | better-sqlite3 | storageNeutral forbids better-sqlite3',
      'packages/fixture | fixture.ts:2 | node:fs | storageNeutral forbids node:fs',
    ])
  })

  it('held-out safety class set rejects provider SDKs and direct filesystem imports', () => {
    expect(PACKAGE_CLASS_RULES.providerNeutral.allowed).toContain('ai')

    const safetyContract = fixtureContract({
      packageClasses: ['providerNeutral', 'storageNeutral'],
    })

    expect(
      findClassRuleOffenders(safetyContract, [
        fixtureHit(`${PROVIDER_SDK_FORBIDDEN_PREFIX}openai`),
        fixtureHit('node:fs', { line: 2 }),
      ]),
    ).toEqual([
      `packages/fixture | fixture.ts:1 | ${PROVIDER_SDK_FORBIDDEN_PREFIX}openai | providerNeutral forbids ${PROVIDER_SDK_FORBIDDEN_PREFIX}*`,
      'packages/fixture | fixture.ts:2 | node:fs | storageNeutral forbids node:fs',
    ])

    expect(findClassRuleOffenders(safetyContract, [fixtureHit('ai')])).toEqual([])
  })

  it('held-out browserSafe seam rejects Node imports while schema real scan stays clean', () => {
    expect(
      findClassRuleOffenders(
        fixtureContract({ packageClasses: ['browserSafe'] }),
        [fixtureHit('node:path')],
      ),
    ).toEqual([
      'packages/fixture | fixture.ts:1 | node:path | browserSafe forbids node:*',
    ])

    const schemaContract = ARCH_MANIFEST.packages.find(
      contract => contract.packageDir === 'packages/schema',
    )
    expect(schemaContract).toBeDefined()
    expect(findClassRuleOffenders(schemaContract!, packageAllHits(schemaContract!))).toEqual([])
  })

  it('held-out dep reconciliation reports missing and unexpected dependency drift', () => {
    expect(
      findDepReconciliationOffenders(
        fixtureContract({
          packageDir: 'packages/arch',
          externalDependencies: ['declared-only'],
        }),
        [fixtureHit('runtime-only')],
        repoRoot,
      ),
    ).toEqual([
      'packages/arch external deps: missing declared-only',
      'packages/arch external deps: unexpected runtime-only',
      'packages/arch package.json vs contract: missing declared-only',
    ])
  })

  it('held-out config hits feed class rules without becoming runtime dep drift', () => {
    const configAwareContract = fixtureContract({
      packageDir: 'packages/arch',
      packageClasses: ['browserSafe'],
      externalDependencies: [],
    })
    const configHits = [
      fixtureHit('node:fs', { file: 'packages/arch/vitest.config.ts' }),
      fixtureHit('tsup', { file: 'packages/arch/tsup.config.ts', line: 2 }),
      fixtureHit('vitest/config', { file: 'packages/arch/vitest.config.ts', line: 3 }),
    ]

    expect(findClassRuleOffenders(configAwareContract, configHits)).toEqual([
      'packages/arch | packages/arch/vitest.config.ts:1 | node:fs | browserSafe forbids node:*',
    ])
    expect(findDepReconciliationOffenders(configAwareContract, [], repoRoot)).toEqual([])
  })

  it('held-out DAG walk reports synthetic cycles and accepts acyclic contracts', () => {
    const packageA = fixtureContract({
      packageName: '@vostride/agent-qa-a',
      packageDir: 'packages/a',
      internalDependencies: ['@vostride/agent-qa-b'],
    })
    const packageB = fixtureContract({
      packageName: '@vostride/agent-qa-b',
      packageDir: 'packages/b',
      internalDependencies: ['@vostride/agent-qa-a'],
    })

    expect(findCycleOffenders([packageA, packageB])).toEqual([
      'cycle: @vostride/agent-qa-a -> @vostride/agent-qa-b -> @vostride/agent-qa-a',
    ])
    expect(findCycleOffenders([packageA, fixtureContract({
      packageName: '@vostride/agent-qa-b',
      packageDir: 'packages/b',
    })])).toEqual([])
  })

  it('held-out direction firewall rejects neutral to storageImplementation and accepts adapter to port', () => {
    const neutral = fixtureContract({
      packageName: '@vostride/agent-qa-neutral',
      packageDir: 'packages/neutral',
      packageClasses: ['storageNeutral'],
      internalDependencies: ['@vostride/agent-qa-local'],
    })
    const local = fixtureContract({
      packageName: '@vostride/agent-qa-local',
      packageDir: 'packages/local',
      packageClasses: ['storageImplementation'],
      internalDependencies: ['@vostride/agent-qa-neutral'],
    })

    expect(findDirectionOffenders([neutral, local])).toEqual([
      'direction: @vostride/agent-qa-neutral (storageNeutral) ⇏ @vostride/agent-qa-local (storageImplementation)',
    ])
    expect(findDirectionOffenders([local])).toEqual([])
  })

  it('held-out core ledger reports uncovered and stale entries while accepting covered leaks', () => {
    expect(
      applyLedger(
        transitionalLeaks([fixtureHit(`${PROVIDER_SDK_FORBIDDEN_PREFIX}openai`)]),
        [],
      ),
    ).toEqual([
      `packages/core | fixture.ts:1 | ${PROVIDER_SDK_FORBIDDEN_PREFIX}openai | unwaived transitional leak`,
    ])

    expect(applyLedger([], [fixtureLedgerEntry('sharp')])).toEqual([
      'packages/core | ledger | sharp | stale ledger entry',
    ])

    expect(
      applyLedger(
        transitionalLeaks([fixtureHit(`${PROVIDER_SDK_FORBIDDEN_PREFIX}openai`)]),
        [fixtureLedgerEntry(`${PROVIDER_SDK_FORBIDDEN_PREFIX}openai`)],
      ),
    ).toEqual([])
  })

  it('held-out core ratchet rejects new off-baseline node and native-store imports', () => {
    expect(
      applyLedger(
        transitionalLeaks([
          fixtureHit('node:dgram'),
          fixtureHit('better-sqlite3', { line: 2 }),
        ]),
        AGENT_QA_CORE_MIGRATION_LEDGER,
        new Set(AGENT_QA_CORE_HOST_BASELINE),
      ),
    ).toEqual([
      'packages/core | fixture.ts:1 | node:dgram | unwaived transitional leak',
      'packages/core | fixture.ts:2 | better-sqlite3 | unwaived transitional leak',
    ])
  })
})

describe('validate:arch surface firewall (FUNC-02) held-out fixtures', () => {
  it('held-out firewall reports an un-ledgered internal import and accepts the allow-list', () => {
    expect(
      findSurfaceFirewallOffenders(
        surfaceScan([surfaceHit('@vostride/agent-qa-runner-local', 7)]),
        [],
      ),
    ).toEqual([
      `packages/cli | ${FIXTURE_SURFACE_FILE}:7 | @vostride/agent-qa-runner-local | surface-firewall un-ledgered internal import`,
    ])

    expect(
      findSurfaceFirewallOffenders(
        surfaceScan(SURFACE_ALLOWED_INTERNAL_PACKAGES.map(specifier => surfaceHit(specifier))),
        [],
      ),
    ).toEqual([])
  })

  it('held-out firewall leaves non-firewalled surfaces alone until M5 admits them', () => {
    expect(FIREWALLED_SURFACE_DIRS).toEqual(['packages/cli', 'packages/mcp'])
    expect(EXPECTED_SURFACE_CLASS_PACKAGES).toContain('@vostride/agent-qa-dashboard')

    expect(
      findSurfaceFirewallOffenders(
        surfaceScan(
          [surfaceHit('@vostride/agent-qa-runner-local', 3, 'packages/dashboard-server/src/x.ts')],
          'packages/dashboard-server',
        ),
        [],
      ),
    ).toEqual([])
  })

  it('held-out firewall exempts only the ledgered pair, never the whole file (D-03)', () => {
    const ledger = [surfaceLedgerFixture('@vostride/agent-qa-runner-local')]
    const ledgeredHit = surfaceHit('@vostride/agent-qa-runner-local', 7)

    expect(findSurfaceFirewallOffenders(surfaceScan([ledgeredHit]), ledger)).toEqual([])

    expect(
      findSurfaceFirewallOffenders(
        surfaceScan([ledgeredHit, surfaceHit('@vostride/agent-qa-core', 9)]),
        ledger,
      ),
    ).toEqual([
      `packages/cli | ${FIXTURE_SURFACE_FILE}:9 | @vostride/agent-qa-core | surface-firewall un-ledgered internal import`,
    ])
  })

  it('held-out firewall reports a ledger entry whose leak is gone as stale (self-shrinking)', () => {
    expect(
      findSurfaceFirewallOffenders(
        surfaceScan([surfaceHit('@vostride/agent-qa-core', 4)]),
        [
          surfaceLedgerFixture('@vostride/agent-qa-core'),
          surfaceLedgerFixture('@vostride/agent-qa-runner-local'),
        ],
      ),
    ).toEqual([
      `packages/cli | ledger | ${FIXTURE_SURFACE_FILE} :: @vostride/agent-qa-runner-local | surface-firewall stale ledger entry`,
    ])
  })

  it('held-out firewall matches whole specifiers, never substrings', () => {
    const safetyLocalLedger = [surfaceLedgerFixture('@vostride/agent-qa-safety-local')]
    expect(
      findSurfaceFirewallOffenders(
        surfaceScan([
          surfaceHit('@vostride/agent-qa-safety-local', 5),
          surfaceHit('@vostride/agent-qa-safety', 6),
        ]),
        safetyLocalLedger,
      ),
    ).toEqual([
      `packages/cli | ${FIXTURE_SURFACE_FILE}:6 | @vostride/agent-qa-safety | surface-firewall un-ledgered internal import`,
    ])

    const readerLedger = [surfaceLedgerFixture('@vostride/agent-qa-knowledge-local/reader')]
    expect(
      findSurfaceFirewallOffenders(
        surfaceScan([
          surfaceHit('@vostride/agent-qa-knowledge-local/reader', 5),
          surfaceHit('@vostride/agent-qa-knowledge-local', 6),
        ]),
        readerLedger,
      ),
    ).toEqual([
      `packages/cli | ${FIXTURE_SURFACE_FILE}:6 | @vostride/agent-qa-knowledge-local | surface-firewall un-ledgered internal import`,
    ])

    const mainLedger = [surfaceLedgerFixture('@vostride/agent-qa-knowledge-local')]
    expect(
      findSurfaceFirewallOffenders(
        surfaceScan([
          surfaceHit('@vostride/agent-qa-knowledge-local', 5),
          surfaceHit('@vostride/agent-qa-knowledge-local/reader', 6),
        ]),
        mainLedger,
      ),
    ).toEqual([
      `packages/cli | ${FIXTURE_SURFACE_FILE}:6 | @vostride/agent-qa-knowledge-local/reader | surface-firewall un-ledgered internal import`,
    ])
  })

  it('held-out firewall counts a type-only import as a violation (D-04)', () => {
    const source = [
      'import { Command } from "commander"',
      'import type { AuditSink } from "@vostride/agent-qa-safety"',
      '// a comment naming @vostride/agent-qa-runner is not an import',
    ].join('\n')
    const hits = specifiersInSource(source, FIXTURE_SURFACE_FILE)

    expect(hits.map(hit => hit.specifier)).toEqual(['commander', '@vostride/agent-qa-safety'])
    expect(findSurfaceFirewallOffenders(surfaceScan(hits), [])).toEqual([
      `packages/cli | ${FIXTURE_SURFACE_FILE}:2 | @vostride/agent-qa-safety | surface-firewall un-ledgered internal import`,
    ])
  })

  it('held-out golden surface set fails in both drift directions (D-02)', () => {
    expect(
      findSurfaceClassGoldenSetOffenders(surfaceClassContracts(EXPECTED_SURFACE_CLASS_PACKAGES)),
    ).toEqual([])

    expect(
      findSurfaceClassGoldenSetOffenders(
        surfaceClassContracts([...EXPECTED_SURFACE_CLASS_PACKAGES, '@vostride/agent-qa-chat']),
      ),
    ).toEqual([
      'surface-class-golden-set: @vostride/agent-qa-chat declares surface but is absent the pinned set',
    ])

    expect(
      findSurfaceClassGoldenSetOffenders(
        surfaceClassContracts(
          EXPECTED_SURFACE_CLASS_PACKAGES.filter(name => name !== '@vostride/agent-qa-mcp'),
        ),
      ),
    ).toEqual([
      'surface-class-golden-set: @vostride/agent-qa-mcp is pinned as a surface but no longer declares the class',
    ])
  })

  it('the shipped ledger stays exact, dated, and closed to new-in-384 surface code (D-01)', () => {
    const newInPhase384 = [
      'packages/cli/src/commands/fn.ts',
      'packages/cli/src/composition/masked-config.ts',
    ]

    for (const entry of SURFACE_FIREWALL_LEDGER) {
      expect(entry.clearedBy.trim()).not.toEqual('')
      expect(entry.reason.trim()).not.toEqual('')
      expect(entry.file.endsWith('/')).toBe(false)
      expect(entry.file).toMatch(/\.(ts|tsx|js|mjs|cjs|css)$/)
      expect(FIREWALLED_SURFACE_DIRS.some(dir => entry.file.startsWith(`${dir}/`))).toBe(true)
      expect(newInPhase384).not.toContain(entry.file)
    }

    const keys = SURFACE_FIREWALL_LEDGER.map(entry => `${entry.file} :: ${entry.specifier}`)
    expect(new Set(keys).size).toEqual(keys.length)
  })
})
