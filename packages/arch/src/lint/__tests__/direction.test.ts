import { describe, expect, it } from 'vitest'
import { ARCH_MANIFEST } from '../../manifest.js'
import type { OwnershipContract, PackageClass } from '../../contract-types.js'
import { findDirectionOffenders } from '../direction.js'

function contract(
  packageName: string,
  packageClasses: readonly PackageClass[],
  internalDependencies: readonly string[] = [],
): OwnershipContract {
  return {
    packageName,
    packageDir: `packages/${packageName.split('/').at(-1) ?? 'fixture'}`,
    packageClasses,
    allowedResponsibilities: [],
    forbiddenResponsibilities: [],
    externalDependencies: [],
    internalDependencies,
  }
}

describe('findDirectionOffenders', () => {
  it('proves the live architecture manifest has no neutral to storageImplementation edges', () => {
    expect(findDirectionOffenders(ARCH_MANIFEST.packages)).toEqual([])
  })

  it('reports a synthetic neutral package depending on a storage implementation', () => {
    expect(
      findDirectionOffenders([
        contract(
          '@vostride/agent-qa-neutral',
          ['storageNeutral'],
          ['@vostride/agent-qa-local'],
        ),
        contract('@vostride/agent-qa-local', ['storageImplementation']),
      ]),
    ).toEqual([
      'direction: @vostride/agent-qa-neutral (storageNeutral) ⇏ @vostride/agent-qa-local (storageImplementation)',
    ])
  })

  it('accepts a storage implementation depending on a neutral port package', () => {
    expect(
      findDirectionOffenders([
        contract(
          '@vostride/agent-qa-local',
          ['storageImplementation'],
          ['@vostride/agent-qa-neutral'],
        ),
        contract('@vostride/agent-qa-neutral', ['storageNeutral']),
      ]),
    ).toEqual([])
  })
})
