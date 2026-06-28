import { describe, expect, it } from 'vitest'
import { ARCH_MANIFEST } from '../../manifest.js'
import { findCycleOffenders } from '../walk-dag.js'
import type { OwnershipContract } from '../../contract-types.js'

function contract(
  packageName: string,
  internalDependencies: readonly string[] = [],
): OwnershipContract {
  return {
    packageName,
    packageDir: `packages/${packageName.split('/').at(-1) ?? 'fixture'}`,
    packageClasses: ['util'],
    allowedResponsibilities: [],
    forbiddenResponsibilities: [],
    externalDependencies: [],
    internalDependencies,
  }
}

describe('findCycleOffenders', () => {
  it('proves the live architecture manifest has no declared internal dependency cycles', () => {
    expect(findCycleOffenders(ARCH_MANIFEST.packages)).toEqual([])
  })

  it('reports a synthetic two-node cycle', () => {
    expect(
      findCycleOffenders([
        contract('@vostride/agent-qa-a', ['@vostride/agent-qa-b']),
        contract('@vostride/agent-qa-b', ['@vostride/agent-qa-a']),
      ]),
    ).toEqual(['cycle: @vostride/agent-qa-a -> @vostride/agent-qa-b -> @vostride/agent-qa-a'])
  })

  it('reports a self-edge cycle', () => {
    expect(
      findCycleOffenders([contract('@vostride/agent-qa-a', ['@vostride/agent-qa-a'])]),
    ).toEqual(['cycle: @vostride/agent-qa-a -> @vostride/agent-qa-a'])
  })

  it('ignores edges to packages outside the contract set', () => {
    expect(
      findCycleOffenders([
        contract('@vostride/agent-qa-a', ['@vostride/agent-qa-missing']),
      ]),
    ).toEqual([])
  })
})
