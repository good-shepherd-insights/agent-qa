import {
  NATIVE_STORE_DENYLIST,
  PROVIDER_SDK_FORBIDDEN_PREFIX,
} from '../contract-types.js'
import { classifySpecifier } from './extract-specifiers.js'
import type { LedgerEntry } from '../contract-types.js'
import type { SpecifierHit } from './extract-specifiers.js'

const nativeStoreTargets = new Set<string>(NATIVE_STORE_DENYLIST)

export function transitionalLeaks(hits: readonly SpecifierHit[]): SpecifierHit[] {
  return hits.filter(hit => {
    const classified = classifySpecifier(hit.specifier)
    return (
      classified.kind === 'external' &&
      (classified.pkgName.startsWith(PROVIDER_SDK_FORBIDDEN_PREFIX) ||
        nativeStoreTargets.has(classified.pkgName))
    )
  })
}

export function applyLedger(
  leaks: readonly SpecifierHit[],
  ledger: readonly LedgerEntry[],
): string[] {
  const offenders: string[] = []
  const ledgerTargets = new Set(ledger.map(entry => entry.target))
  const hitTargets = new Set<string>()

  for (const leak of leaks) {
    const target = targetForLeak(leak)
    if (ledgerTargets.has(target)) {
      hitTargets.add(target)
      continue
    }

    offenders.push(
      `packages/core | ${leak.file}:${leak.line} | ${leak.specifier} | unwaived transitional leak`,
    )
  }

  for (const entry of ledger) {
    if (!hitTargets.has(entry.target)) {
      offenders.push(`packages/core | ledger | ${entry.target} | stale ledger entry`)
    }
  }

  return offenders
}

function targetForLeak(leak: SpecifierHit): string {
  const classified = classifySpecifier(leak.specifier)
  if (classified.kind === 'external') {
    return classified.pkgName
  }

  return leak.specifier
}
