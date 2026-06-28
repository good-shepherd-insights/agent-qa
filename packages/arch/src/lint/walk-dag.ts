import type { OwnershipContract } from '../contract-types.js'

type VisitState = 'visiting' | 'done'

export function findCycleOffenders(contracts: readonly OwnershipContract[]): string[] {
  const graph = new Map(
    contracts.map(contract => [contract.packageName, contract.internalDependencies]),
  )
  const state = new Map<string, VisitState>()
  const offenders: string[] = []
  const stack: string[] = []

  function dfs(node: string): void {
    const currentState = state.get(node)
    if (currentState === 'done') {
      return
    }

    if (currentState === 'visiting') {
      const cycleFrom = stack.indexOf(node)
      if (cycleFrom !== -1) {
        offenders.push(`cycle: ${[...stack.slice(cycleFrom), node].join(' -> ')}`)
      }
      return
    }

    state.set(node, 'visiting')
    stack.push(node)

    for (const dependency of graph.get(node) ?? []) {
      if (graph.has(dependency)) {
        dfs(dependency)
      }
    }

    stack.pop()
    state.set(node, 'done')
  }

  for (const contract of contracts) {
    dfs(contract.packageName)
  }

  return [...new Set(offenders)]
}
