import type { OwnershipContract, PackageClass } from '../contract-types.js'

const NEUTRAL_CLASSES: readonly PackageClass[] = ['providerNeutral', 'storageNeutral']

export function findDirectionOffenders(contracts: readonly OwnershipContract[]): string[] {
  const classesByName = new Map<string, readonly PackageClass[]>()
  const offenders: string[] = []

  for (const contract of contracts) {
    classesByName.set(contract.packageName, contract.packageClasses)
  }

  for (const contract of contracts) {
    const neutralClass = contract.packageClasses.find(packageClass =>
      NEUTRAL_CLASSES.includes(packageClass),
    )
    if (!neutralClass) {
      continue
    }

    for (const dependency of contract.internalDependencies) {
      if (classesByName.get(dependency)?.includes('storageImplementation')) {
        offenders.push(
          `direction: ${contract.packageName} (${neutralClass}) ⇏ ${dependency} (storageImplementation)`,
        )
      }
    }
  }

  return offenders
}
