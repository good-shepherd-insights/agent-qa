import type { OwnershipContract, PackageClass } from '../contract-types.js'

const NEUTRAL_CLASSES: readonly PackageClass[] = ['providerNeutral', 'storageNeutral']

export const WRITE_SURFACE_PACKAGES = ['@vostride/agent-qa-agent'] as const

export function findKnowledgeWriteOffenders(contracts: readonly OwnershipContract[]): string[] {
  const offenders: string[] = []

  for (const contract of contracts) {
    const neutralClass = contract.packageClasses.find(packageClass =>
      NEUTRAL_CLASSES.includes(packageClass),
    )
    if (!neutralClass) {
      continue
    }

    for (const dependency of contract.internalDependencies) {
      if (WRITE_SURFACE_PACKAGES.includes(dependency as (typeof WRITE_SURFACE_PACKAGES)[number])) {
        offenders.push(
          `knowledge-write: ${contract.packageName} (${neutralClass}) ⇏ ${dependency} (write surface)`,
        )
      }
    }
  }

  return offenders
}
