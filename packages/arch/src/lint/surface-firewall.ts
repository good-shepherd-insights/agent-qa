import type { OwnershipContract } from '../contract-types.js'
import { classifySpecifier } from './extract-specifiers.js'
import type { SpecifierHit } from './extract-specifiers.js'
import { surfaceLedgerKey } from './surface-firewall-ledger.js'
import type { SurfaceLedgerEntry } from './surface-firewall-ledger.js'

/**
 * FUNC-02 (D-01, 2026-07-28): the surface packages whose internal imports the build
 * enforces in Phase 384. Deliberately NARROWER than the surface class itself: the two
 * dashboards also declare `surface`, but their rewiring is M5 work, so admitting them
 * here today would mean hundreds of un-ledgered entries for a migration nobody has
 * started. M5 adds `packages/dashboard-server` and `packages/dashboard-ui` to this list.
 *
 * Membership here — not the declared class — is what arms the firewall, so a package
 * cannot disarm its own enforcement by quietly dropping `surface`. That drift direction
 * is caught separately by findSurfaceClassGoldenSetOffenders (D-02).
 */
export const FIREWALLED_SURFACE_DIRS = ['packages/cli', 'packages/mcp'] as const

/**
 * The only internal packages a firewalled surface may name without a ledger entry:
 * the typed function layer it invokes capabilities through, and the shared contract
 * vocabulary its DTOs are typed against. Everything else is a private power (SC2).
 */
export const SURFACE_ALLOWED_INTERNAL_PACKAGES = [
  '@vostride/agent-qa-agent',
  '@vostride/agent-qa-schema',
] as const

/**
 * D-02 golden set: every package declaring the `surface` class, pinned exactly.
 * A fifth surface cannot land unpinned, and a pinned one cannot silently drop the
 * class. Names are the `packageName` strings the four ownership contracts declare —
 * note the CLI publishes as `agent-qa`, not `@vostride/agent-qa-cli`.
 */
export const EXPECTED_SURFACE_CLASS_PACKAGES = [
  '@vostride/agent-qa-dashboard',
  '@vostride/agent-qa-dashboard-ui',
  '@vostride/agent-qa-mcp',
  'agent-qa',
] as const

export interface SurfaceFirewallScan {
  packageDir: string
  hits: readonly SpecifierHit[]
}

function normalizeRepoPath(file: string): string {
  return file.replaceAll('\\', '/')
}

export function isFirewalledSurfaceDir(packageDir: string): boolean {
  return FIREWALLED_SURFACE_DIRS.includes(
    normalizeRepoPath(packageDir) as (typeof FIREWALLED_SURFACE_DIRS)[number],
  )
}

/**
 * Whole-specifier matching, never a substring test. `classifySpecifier` reduces a
 * specifier to its two-segment package name, so a subpath entry resolves to its own
 * package and a longer package name never collapses into a shorter one:
 * `agent-qa-safety-local` is not `agent-qa-safety`, and neither one is allow-listed
 * by the other. A `startsWith`/`includes` check would report both a false hit and —
 * far worse — a false PASS the moment the shorter name reappeared beside the longer.
 */
export function isForbiddenInternalSpecifier(specifier: string): boolean {
  const classified = classifySpecifier(specifier)
  if (classified.kind !== 'internal') {
    return false
  }

  return !SURFACE_ALLOWED_INTERNAL_PACKAGES.includes(
    classified.pkgName as (typeof SURFACE_ALLOWED_INTERNAL_PACKAGES)[number],
  )
}

function surfaceDirForFile(file: string): string {
  const normalized = normalizeRepoPath(file)
  return (
    FIREWALLED_SURFACE_DIRS.find(dir => normalized.startsWith(`${dir}/`)) ?? 'ledger'
  )
}

/**
 * The FUNC-02 firewall (D-01, D-03, D-04).
 *
 * Two directions, copied verbatim in spirit from the shipped transitional-core ledger:
 *   1. a forbidden internal specifier with no exact (file, specifier) ledger entry is an offender;
 *   2. a ledger entry whose leak is no longer present is a STALE offender.
 *
 * Direction 2 is what makes the ledger self-shrinking: the moment a phase clears a
 * file, its entries must be deleted or the build goes red.
 *
 * Granularity is the exact (file, specifier) PAIR — never a directory prefix, never a
 * whole-file exemption. A ledgered file that acquires a SECOND forbidden import still
 * fails, which is the deepening-violation catch D-03 exists for.
 *
 * `import type` needs no special handling: the shared specifier extractor makes no
 * type-only exemption, so a type-only leak is a leak (D-04).
 */
export function findSurfaceFirewallOffenders(
  hitsByPackage: readonly SurfaceFirewallScan[],
  ledger: readonly SurfaceLedgerEntry[],
): string[] {
  const offenders: string[] = []
  const ledgerKeys = new Set(ledger.map(surfaceLedgerKey))
  const coveredKeys = new Set<string>()

  for (const scan of hitsByPackage) {
    const packageDir = normalizeRepoPath(scan.packageDir)
    if (!isFirewalledSurfaceDir(packageDir)) {
      continue
    }

    for (const hit of scan.hits) {
      if (!isForbiddenInternalSpecifier(hit.specifier)) {
        continue
      }

      const file = normalizeRepoPath(hit.file)
      const key = surfaceLedgerKey({ file, specifier: hit.specifier })
      if (ledgerKeys.has(key)) {
        coveredKeys.add(key)
        continue
      }

      offenders.push(
        `${packageDir} | ${file}:${hit.line} | ${hit.specifier} | surface-firewall un-ledgered internal import`,
      )
    }
  }

  for (const entry of ledger) {
    const key = surfaceLedgerKey(entry)
    if (!coveredKeys.has(key)) {
      offenders.push(
        `${surfaceDirForFile(entry.file)} | ledger | ${key} | surface-firewall stale ledger entry`,
      )
    }
  }

  return offenders
}

/**
 * D-02: the surface class's member set is pinned, and both drift directions fail.
 * Unpinned arrival and silent departure are separate offenders with distinct wording,
 * so the failure message says which mistake was made.
 */
export function findSurfaceClassGoldenSetOffenders(
  contracts: readonly OwnershipContract[],
): string[] {
  const declared = new Set(
    contracts
      .filter(contract => contract.packageClasses.includes('surface'))
      .map(contract => contract.packageName),
  )
  const expected = new Set<string>(EXPECTED_SURFACE_CLASS_PACKAGES)
  const offenders: string[] = []

  for (const packageName of [...declared].sort()) {
    if (!expected.has(packageName)) {
      offenders.push(
        `surface-class-golden-set: ${packageName} declares surface but is absent the pinned set`,
      )
    }
  }

  for (const packageName of [...expected].sort()) {
    if (!declared.has(packageName)) {
      offenders.push(
        `surface-class-golden-set: ${packageName} is pinned as a surface but no longer declares the class`,
      )
    }
  }

  return offenders
}
