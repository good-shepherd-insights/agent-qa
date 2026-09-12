import { describe, expect, it } from 'vitest'
import { generateAdversarialVariants, type AdversarialSeed } from '../generate'
import { buildProbeRequest, deriveProbeCassette } from '../probes'
import { FIXTURE_REFS, makeAdversarialSeedFixture } from './fixtures'

const paths = ['table', 'probe'] as const

function derive(seed: AdversarialSeed, path: typeof paths[number]) {
  if (path === 'table') {
    const result = generateAdversarialVariants({
      product: 'fixture', seeds: [seed], mutators: ['confusable'],
    })
    return { cassette: result.variants[0]?.cassette, refusal: result.outcomes[0] }
  }
  const request = buildProbeRequest({
    seed, kind: 'judge-targeted', authoringModel: { id: 'fixture', family: 'fixture' },
  })
  if (typeof request === 'string') throw new Error(request)
  const result = deriveProbeCassette({
    seed, request, response: { text: 'Proceed', usage: {} }, product: 'fixture',
  })
  return { cassette: result.outcome === 'derived' ? result.probe.cassette : undefined, refusal: result }
}

describe.each(paths)('CR-07 rendered identity through %s derivation', path => {
  it.each(['bare', 'quoted', 'wrapped'] as const)('preserves role, attributes and prose in %s trees', format => {
    const seed = makeAdversarialSeedFixture({ names: {
      [FIXTURE_REFS.goldButton]: 'button',
      [FIXTURE_REFS.siblingButton]: 'button extended',
      [FIXTURE_REFS.status]: 'button',
    } })
    const state = seed.cassette.input.stateBefore
    const render = (role: string, name: string) => format === 'bare'
      ? `  ${role} ${name}`
      : format === 'quoted'
        ? `  - ${role} "${name}" [disabled]: button prose`
        : `  - '${role} "${name}" [disabled]'`
    state.tree = state.elements.map(element => render(element.role, element.name)).join('\n')
    const result = derive(seed, path)
    expect(result.cassette).toBeDefined()
    const mutated = result.cassette!.input.stateBefore
    expect(mutated.tree).toBe(state.elements.map((element, index) =>
      render(element.role, mutated.elements[index]!.name),
    ).join('\n'))
    expect(mutated.elements.find(element => String(element.ref) === FIXTURE_REFS.siblingButton)!.name)
      .toBe('button extended')
  })

  it.each(['bare', 'quoted'] as const)('rewrites only the intended duplicate in %s trees', format => {
    const seed = makeAdversarialSeedFixture({ names: { [FIXTURE_REFS.siblingButton]: 'Continue' } })
    const state = seed.cassette.input.stateBefore
    const render = (role: string, name: string) => format === 'bare' ? `${role} ${name}` : `- ${role} "${name}"`
    state.tree = state.elements.map(element => render(element.role, element.name)).join('\n')
    const result = derive(seed, path)
    expect(result.cassette).toBeDefined()
    expect(result.cassette!.input.stateBefore.tree).toBe(state.elements.map((element, index) =>
      render(element.role, result.cassette!.input.stateBefore.elements[index]!.name),
    ).join('\n'))
  })

  it.each(['extra', 'missing'] as const)('refuses a mapping with %s name-bearing rows', mismatch => {
    const seed = makeAdversarialSeedFixture()
    seed.cassette.input.stateBefore.tree = mismatch === 'extra'
      ? '- button "Continue"\n- button "Continue"\n- button "Continue"'
      : 'A paragraph says Continue but contains no rendered control.'
    const result = derive(seed, path)
    expect(result.cassette).toBeUndefined()
    expect(result.refusal).toMatchObject({
      reason: path === 'table' ? 'tree-target-unresolved' : 'probe-tree-target-unresolved',
    })
  })

  it('checks rendered refs and preserves geometry and attributes', () => {
    const seed = makeAdversarialSeedFixture()
    const state = seed.cassette.input.stateBefore
    state.tree = state.elements.map(element =>
      `- ${element.role} "${element.name}" [ref=${element.ref}] @(1,2 3x4) [disabled]`,
    ).join('\n')
    const result = derive(seed, path)
    expect(result.cassette).toBeDefined()
    expect(result.cassette!.input.stateBefore.tree).toBe(result.cassette!.input.stateBefore.elements.map(element =>
      `- ${element.role} "${element.name}" [ref=${element.ref}] @(1,2 3x4) [disabled]`,
    ).join('\n'))
    state.tree = state.tree.replace(`[ref=${FIXTURE_REFS.goldButton}]`, '[ref=wrong-control]')
    expect(derive(seed, path).cassette).toBeUndefined()
  })
})
