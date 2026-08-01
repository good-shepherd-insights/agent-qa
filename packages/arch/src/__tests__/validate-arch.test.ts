import { existsSync, readFileSync } from 'node:fs'
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
  findKnowledgeWriterSingletonOffenders,
  findReaderCarveoutOffenders,
  KNOWLEDGE_READER_FILES,
  KNOWLEDGE_WRITER_ALLOWLIST,
  READER_CARVEOUT_SCANNED_DIRS,
} from '../lint/reader-carveout.js'
import {
  COMPOSITION_CARVEOUT_PACKAGE_DIR,
  findCompositionCarveoutOffenders,
  findCompositionCarveoutUnusedAllowances,
} from '../lint/composition-carveout.js'
import {
  RESUME_PATH_ENTRY_FILES,
  RESUME_PATH_PACKAGE_DIR,
  findResumePathModelFreeOffenders,
  resumePathModules,
} from '../lint/resume-path-model-free.js'
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
import {
  EVALUATE_PIN,
  findEvaluateAcquisitions,
  findEvaluatePinOffenders,
  type EvaluatePinSource,
} from '../lint/evaluate-pin.js'
import {
  AGENT_BARREL_FILE,
  EXPECTED_AGENT_BARREL_EXPORTS,
  EXPECTED_AGENT_BARREL_TYPE_EXPORTS,
  EXPECTED_AGENT_BARREL_VALUE_EXPORTS,
  findAgentBarrelOffenders,
  readAgentBarrelExports,
} from '../lint/agent-barrel.js'
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

/**
 * Source text for the evaluate() pin, keyed by repo-relative path.
 *
 * Routed through `sourceFilesFor` on purpose: it already drops `__tests__`, and FIVE test
 * files across three packages legitimately exercise the shipped gate. Scanning raw files
 * instead would turn every one of them into a pin offender.
 */
function pinSourcesFor(packageDir: string): EvaluatePinSource[] {
  return sourceFilesFor(packageDir, repoRoot).map(file => ({
    file: relative(repoRoot, file).replaceAll('\\', '/'),
    source: readFileSync(file, 'utf8'),
  }))
}

function readRepoFile(repoRelativePath: string): string {
  return readFileSync(join(repoRoot, repoRelativePath), 'utf8')
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
    const pinSources: EvaluatePinSource[] = []
    // "Exactly one importer" is a property of the workspace, not of any one package, so the
    // reader-scanned hits are accumulated and judged once after the loop.
    const readerScannedHits: SpecifierHit[] = []

    for (const contract of contracts) {
      pinSources.push(...pinSourcesFor(contract.packageDir))
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
      if (READER_CARVEOUT_SCANNED_DIRS.includes(
        contract.packageDir as (typeof READER_CARVEOUT_SCANNED_DIRS)[number],
      )) {
        offenders.push(...findReaderCarveoutOffenders(sourceHits))
        readerScannedHits.push(...sourceHits)
      }
      offenders.push(...findCompositionCarveoutOffenders(contract, sourceHits))
      offenders.push(...findCompositionCarveoutUnusedAllowances(contract, sourceHits))
      // D-11 layer 3. Handed whole MODULES rather than the flat hit list the rules above take,
      // because it walks an import closure and a file with no imports at all still has to be
      // resolvable — derived from hits alone, such a file would look like a hole in the graph.
      if (contract.packageDir === RESUME_PATH_PACKAGE_DIR) {
        offenders.push(
          ...findResumePathModelFreeOffenders(resumePathModules(contract.packageDir, repoRoot)),
        )
      }
      if (isFirewalledSurfaceDir(contract.packageDir)) {
        surfaceScans.push({ packageDir: contract.packageDir, hits: sourceHits })
      }
      offenders.push(...findKnowledgeLocalWallOffenders(contract, sourceHits))
    }

    offenders.push(...findKnowledgeWriterSingletonOffenders(readerScannedHits))
    offenders.push(...findSurfaceFirewallOffenders(surfaceScans, SURFACE_FIREWALL_LEDGER))
    offenders.push(...findSurfaceClassGoldenSetOffenders(contracts))
    offenders.push(...findEvaluatePinOffenders(pinSources))
    offenders.push(...findAgentBarrelOffenders(readRepoFile(AGENT_BARREL_FILE)))
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
    // Walks and scans every contract-bearing package in the workspace, so its cost tracks
    // workspace size rather than anything this case controls. ~1.5s on a developer machine,
    // over the 5s default on a 2-core CI runner (first automatic CI run, 2026-08-02).
  }, 30_000)
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
      // The schema-derived visibility walker (Plan 10). It reads the config schema as DATA
      // handed in at the composition root, so it names no internal package of its own —
      // pinned here so that stays true rather than being remembered.
      'packages/cli/src/composition/config-visibility.ts',
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

describe('validate:arch composition carve-out (385-08 / D-13) registration and scope', () => {
  // The carve-out's own behaviour is unit-tested beside the rule. What can only be checked here is
  // that the aggregate actually CALLS it: a rule nobody invokes passes every build, and its unit
  // tests keep passing too, so nothing anywhere goes red. Source-anchored on this file, the
  // wm-flush delegate-anchor convention.
  it('the aggregate invokes both directions of the carve-out', () => {
    const aggregateSource = readFileSync(fileURLToPath(import.meta.url), 'utf8')
    const aggregate = aggregateSource.slice(
      aggregateSource.indexOf('every contract-bearing package satisfies'),
      aggregateSource.indexOf('expect(offenders).toEqual([])'),
    )

    expect(aggregate).toContain('findCompositionCarveoutOffenders(contract, sourceHits)')
    expect(aggregate).toContain('findCompositionCarveoutUnusedAllowances(contract, sourceHits)')
    expect(aggregate).toContain('findReaderCarveoutOffenders(sourceHits)')
    expect(aggregate).toContain('findKnowledgeWriterSingletonOffenders(readerScannedHits)')
    expect(aggregate).toContain(
      'findResumePathModelFreeOffenders(resumePathModules(contract.packageDir, repoRoot))',
    )
  })

  it('guards a package that is actually contract-bearing and scanned', () => {
    const guarded = ARCH_MANIFEST.packages.find(
      contract => contract.packageDir === COMPOSITION_CARVEOUT_PACKAGE_DIR,
    )
    expect(guarded).toBeDefined()
    expect(sourceFilesFor(COMPOSITION_CARVEOUT_PACKAGE_DIR, repoRoot).length).toBeGreaterThan(0)
  })

  // A path-keyed pin whose path has moved matches nothing and reports nothing. Both reader files
  // must exist, and the scanned-dirs list must actually contain the package each one lives in, or
  // the reader carve-out is silently covering fewer files than it claims.
  // D-14/SC5. The allow-list is a directory PREFIX, so the shipped value alone permits any number
  // of importers under it; what makes "the single place" true is the singleton rule, and what makes
  // the singleton rule reach the right subtree is that the prefix names a directory that exists
  // inside a scanned package. Both halves are asserted, because either one alone is satisfiable by
  // a wrong implementation.
  it('the writer allowance is one entry, and it points inside a scanned package that exists', () => {
    expect([...KNOWLEDGE_WRITER_ALLOWLIST]).toEqual(['packages/agent-local/src/composition/'])

    for (const entry of KNOWLEDGE_WRITER_ALLOWLIST) {
      expect(existsSync(join(repoRoot, entry))).toBe(true)
      expect(
        READER_CARVEOUT_SCANNED_DIRS.some(dir => entry.startsWith(`${dir}/`)),
      ).toBe(true)
    }
  })

  // D-11 layer 3, and the same relocation hazard one rule over: the resume-path rule is keyed on
  // an exact file path, so a pin left pointing at a moved file would match nothing, report nothing
  // and still read like proof. The rule reports that case itself; this asserts the pin is right on
  // the real tree, and that the package it names is one the aggregate actually walks.
  it('the resume-path pin points at files that exist inside a contract-bearing package', () => {
    expect([...RESUME_PATH_ENTRY_FILES]).toEqual([
      'packages/agent-local/src/composition/compose-job-recovery.ts',
    ])
    const walked = ARCH_MANIFEST.packages.find(
      (contract) => contract.packageDir === RESUME_PATH_PACKAGE_DIR,
    )
    expect(walked).toBeDefined()
    for (const entry of RESUME_PATH_ENTRY_FILES) {
      expect(existsSync(join(repoRoot, entry))).toBe(true)
      expect(entry.startsWith(`${RESUME_PATH_PACKAGE_DIR}/`)).toBe(true)
    }
    // The scanned set the aggregate hands the rule is non-empty and contains the pinned entry —
    // the check that separates "no offender" from "nothing was read".
    const scanned = resumePathModules(RESUME_PATH_PACKAGE_DIR, repoRoot).map(
      (module) => module.file,
    )
    expect(scanned.length).toBeGreaterThan(0)
    for (const entry of RESUME_PATH_ENTRY_FILES) expect(scanned).toContain(entry)
  })

  it('every pinned reader file exists and sits inside a scanned package', () => {
    for (const file of KNOWLEDGE_READER_FILES) {
      expect(existsSync(join(repoRoot, file))).toBe(true)
      expect(
        READER_CARVEOUT_SCANNED_DIRS.some(dir => file.startsWith(`${dir}/`)),
      ).toBe(true)
    }
  })

  // D-13/D-15 widened the firewall allow-list by exactly one entry. Pinned by equality so a fourth
  // private power cannot join by looking like it belongs.
  it('the surface allow-list is exactly the function layer, the vocabulary and the composition root', () => {
    expect([...SURFACE_ALLOWED_INTERNAL_PACKAGES]).toEqual([
      '@vostride/agent-qa-agent',
      '@vostride/agent-qa-agent-local',
      '@vostride/agent-qa-schema',
    ])
  })
})

const PIN_GATE_HOOK = 'packages/safety/src/policy/gate-hook.ts'
const PIN_SAFETY_BARREL = 'packages/safety/src/index.ts'
const PIN_INVOKE = 'packages/agent/src/functions/invoke.ts'

/**
 * Synthetic stand-ins for the three pinned files, each carrying the acquisition form the
 * real file uses. Every fixture scan starts here so the pin's stale direction stays quiet
 * and the case under test is the only thing that can speak.
 */
function pinnedFixtureSources(): EvaluatePinSource[] {
  return [
    { file: PIN_GATE_HOOK, source: 'import { evaluate, type GateTrust } from "./gate"' },
    { file: PIN_SAFETY_BARREL, source: 'export { evaluate } from "./policy/gate"' },
    { file: PIN_INVOKE, source: 'import { evaluate } from "@vostride/agent-qa-safety"' },
  ]
}

function pinScan(...extra: readonly EvaluatePinSource[]): string[] {
  return findEvaluatePinOffenders([...pinnedFixtureSources(), ...extra])
}

describe('validate:arch evaluate() pin (FUNC-02 / D-12) held-out fixtures', () => {
  it('pins exactly three production files, each with a dated rationale', () => {
    expect(Object.keys(EVALUATE_PIN).sort()).toEqual(
      [PIN_INVOKE, PIN_SAFETY_BARREL, PIN_GATE_HOOK].sort(),
    )
    for (const [file, rationale] of Object.entries(EVALUATE_PIN)) {
      expect(rationale.trim()).not.toEqual('')
      expect(file).toMatch(/^packages\/[a-z-]+\/src\/.+\.ts$/)
    }
  })

  it('fires on all THREE real acquisition forms, one of which is not an import at all', () => {
    const acquisitions = [PIN_GATE_HOOK, PIN_SAFETY_BARREL, PIN_INVOKE].flatMap(file =>
      findEvaluateAcquisitions(readRepoFile(file), file),
    )

    expect(
      acquisitions.map(({ file, keyword, specifier, form }) => ({
        file,
        keyword,
        specifier,
        form,
      })),
    ).toEqual([
      // relative import of the gate module, from inside safety
      { file: PIN_GATE_HOOK, keyword: 'import', specifier: './gate', form: 'named' },
      // export-re-export: syntactically NOT an import, and the form a detector keyed on
      // import statements alone silently misses — reporting this file as a stale pin entry
      { file: PIN_SAFETY_BARREL, keyword: 'export', specifier: './policy/gate', form: 'named' },
      // package-specifier named import of the barrel symbol
      {
        file: PIN_INVOKE,
        keyword: 'import',
        specifier: '@vostride/agent-qa-safety',
        form: 'named',
      },
    ])
    for (const acquisition of acquisitions) {
      expect(acquisition.line).toBeGreaterThan(0)
    }

    expect(
      findEvaluatePinOffenders(
        [PIN_GATE_HOOK, PIN_SAFETY_BARREL, PIN_INVOKE].map(file => ({
          file,
          source: readRepoFile(file),
        })),
      ),
    ).toEqual([])
  })

  it('reports a FOURTH importer, whatever name it binds the symbol to', () => {
    const fourth = 'packages/runner/src/loop/second-gate.ts'

    expect(
      pinScan({ file: fourth, source: 'import { evaluate } from "@vostride/agent-qa-safety"' }),
    ).toEqual([
      `evaluate-pin: ${fourth}:1 ⇏ @vostride/agent-qa-safety (un-pinned gate acquisition)`,
    ])

    expect(
      pinScan({
        file: fourth,
        source: 'import { evaluate as runGate } from "@vostride/agent-qa-safety"',
      }),
    ).toEqual([
      `evaluate-pin: ${fourth}:1 ⇏ @vostride/agent-qa-safety (un-pinned gate acquisition)`,
    ])

    expect(
      pinScan({
        file: fourth,
        source: 'import * as safety from "@vostride/agent-qa-safety"',
      }),
    ).toEqual([
      `evaluate-pin: ${fourth}:1 ⇏ @vostride/agent-qa-safety (un-pinned gate acquisition)`,
    ])
  })

  it('reports a relative gate-module acquisition from a NEW safety file', () => {
    const secondHook = 'packages/safety/src/policy/second-hook.ts'
    expect(
      pinScan({ file: secondHook, source: 'import { evaluate } from "./gate"' }),
    ).toEqual([
      `evaluate-pin: ${secondHook}:1 ⇏ ./gate (un-pinned gate acquisition)`,
    ])

    // Any VALUE the gate module publishes is gate power, so a factory or helper added
    // there cannot be used to dodge the pin under a different name.
    const deepFile = 'packages/safety/src/hooks/second-registrar.ts'
    expect(
      pinScan({ file: deepFile, source: 'import { resolveAsk } from "../policy/gate"' }),
    ).toEqual([
      `evaluate-pin: ${deepFile}:1 ⇏ ../policy/gate (un-pinned gate acquisition)`,
    ])
  })

  it('leaves a TYPE-ONLY gate-module import alone, but not an inline value beside a type', () => {
    // The shape `hooks/first-party.ts` carries today. A type acquires nothing at runtime,
    // so treating it as an acquisition would make the pin four entries and would say a
    // file that cannot call the gate is a gate call-site.
    expect(
      pinScan({
        file: 'packages/safety/src/hooks/first-party.ts',
        source: 'import type { GateTrust } from "../policy/gate"',
      }),
    ).toEqual([])

    expect(
      pinScan({
        file: 'packages/safety/src/hooks/first-party.ts',
        source: 'export type { GateDeps, GateTrust } from "../policy/gate"',
      }),
    ).toEqual([])

    const inlineMix = 'packages/safety/src/hooks/mixed.ts'
    expect(
      pinScan({
        file: inlineMix,
        source: 'import { type GateTrust, evaluate } from "../policy/gate"',
      }),
    ).toEqual([
      `evaluate-pin: ${inlineMix}:1 ⇏ ../policy/gate (un-pinned gate acquisition)`,
    ])
  })

  it('keys on import and export STATEMENTS, never on call tokens (Pitfall 3)', () => {
    const noisy = [
      'import { Page } from "playwright"',
      'import { classifyRisk } from "@vostride/agent-qa-safety"',
      'const text = await page.evaluate(() => document.title)',
      'const verdict = asserter.evaluate(candidate)',
      '// evaluate() is called by the gate hook, never here',
      'export function evaluate(input: string) { return input }',
    ].join('\n')

    expect(findEvaluateAcquisitions(noisy, 'packages/web/src/probe.ts')).toEqual([])
    expect(pinScan({ file: 'packages/web/src/probe.ts', source: noisy })).toEqual([])
  })

  it('reads a multi-line clause and a commented-out acquisition correctly', () => {
    const continuation = 'packages/mcp/src/server/tools.ts'
    const source = [
      'import {',
      '  classifyRisk,',
      '  evaluate,',
      '} from "@vostride/agent-qa-safety"',
    ].join('\n')

    expect(pinScan({ file: continuation, source })).toEqual([
      `evaluate-pin: ${continuation}:1 ⇏ @vostride/agent-qa-safety (un-pinned gate acquisition)`,
    ])

    expect(
      pinScan({
        file: continuation,
        source: '// import { evaluate } from "@vostride/agent-qa-safety"',
      }),
    ).toEqual([])
  })

  it('reports a pin entry that no longer acquires the gate as stale (self-shrinking)', () => {
    expect(
      findEvaluatePinOffenders(
        pinnedFixtureSources().filter(entry => entry.file !== PIN_INVOKE),
      ),
    ).toEqual([
      `evaluate-pin: ${PIN_INVOKE} ⇏ pin entry no longer acquires the gate (stale)`,
    ])
  })
})

describe('validate:arch agent barrel export set (FUNC-01 / SC1) held-out fixtures', () => {
  it('pins the real barrel export set by exact equality, values and types apart', () => {
    expect(readAgentBarrelExports(readRepoFile(AGENT_BARREL_FILE))).toEqual({
      values: [...EXPECTED_AGENT_BARREL_VALUE_EXPORTS],
      types: [...EXPECTED_AGENT_BARREL_TYPE_EXPORTS],
    })
    expect(EXPECTED_AGENT_BARREL_EXPORTS).toEqual(
      [...EXPECTED_AGENT_BARREL_VALUE_EXPORTS, ...EXPECTED_AGENT_BARREL_TYPE_EXPORTS].sort(),
    )
  })

  it('exports no spec-level dispatch symbol — invokeFunction is the only way in', () => {
    expect(EXPECTED_AGENT_BARREL_VALUE_EXPORTS).toContain('invokeFunction')
    for (const forbidden of [
      'FunctionSpec',
      'FunctionStreamSpec',
      'invoke',
      'createRegistryFromSpecs',
      'registryInternals',
    ]) {
      expect(EXPECTED_AGENT_BARREL_EXPORTS).not.toContain(forbidden)
    }
    // No `*Spec` value of any name: a spec carries its own implementation, so exporting
    // one hands a surface a dispatch path that never reaches the gate (T-384-20).
    expect(EXPECTED_AGENT_BARREL_EXPORTS.filter(name => name.endsWith('Spec'))).toEqual([])
  })

  it('fires when the barrel gains an export the pin does not carry', () => {
    const withExtra = [
      readRepoFile(AGENT_BARREL_FILE),
      'export { createRegistryFromSpecs } from "./functions/registry.js"',
    ].join('\n')

    expect(findAgentBarrelOffenders(withExtra)).toEqual([
      'agent-barrel: unexpected value export createRegistryFromSpecs',
    ])
  })

  it('fires when the barrel loses an export the pin carries', () => {
    const withoutInvoke = readRepoFile(AGENT_BARREL_FILE).replace('  invokeFunction,\n', '')

    expect(findAgentBarrelOffenders(withoutInvoke)).toEqual([
      'agent-barrel: missing value export invokeFunction',
    ])
  })

  it('fires when a pinned TYPE export is promoted to a value export', () => {
    const promoted = readRepoFile(AGENT_BARREL_FILE).replace(
      'export type { CreateFunctionRegistryOptions, FunctionRegistry }',
      'export { CreateFunctionRegistryOptions, FunctionRegistry }',
    )

    expect(findAgentBarrelOffenders(promoted)).toEqual([
      'agent-barrel: unexpected value export CreateFunctionRegistryOptions',
      'agent-barrel: unexpected value export FunctionRegistry',
      'agent-barrel: missing type export CreateFunctionRegistryOptions',
      'agent-barrel: missing type export FunctionRegistry',
    ])
  })
})
