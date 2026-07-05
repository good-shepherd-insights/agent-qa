// RED scaffold (Wave 0, GROUND-01/02/03 · D-12/D-13/D-06). Pins the ratified matcher
// precedence ladder BEFORE any matcher body exists. Imports `matchDescriptor` /
// `MatchResult` / `DescriptorMatchInput` from ../matcher — the module is created by
// Plan 03, so this file fails at import until then; that failure IS the intended RED.
//
// Contract pinned here (spec §12.17 / 357-RESEARCH Pattern 2):
//   precedence: role+nameNormalized exact → nameNormalized exact → normalized-substring;
//   ordinal is an intra-result-set tiebreak ONLY (an ordinal beyond the set is a
//   no-match, never a clamp); ≥2 survivors after the ladder+ordinal ⇒ ambiguous, never
//   a pick (the never-pick security property, T-357-01a); name-less ⇒ rejected
//   'name-missing' (D-13); a `near`-bearing descriptor ⇒ rejected 'near-unsupported'
//   (D-06 defensive backstop); raw `name` is normalized exactly once (Pitfall 6) while a
//   pre-normalized `nameNormalized` is passed through untouched; prior-ElementInfo
//   hierarchy disambiguation resolves an otherwise-ambiguous set by structural parent
//   chain (role+nameNormalized), never raw parentRef equality (Pattern 4).
import { describe, expect, it } from 'vitest'

import { asRef } from '@vostride/agent-qa-schema'
import type { ElementInfo, Ref } from '@vostride/agent-qa-schema'

import { matchDescriptor } from '../matcher.js'
import type { DescriptorMatchInput, MatchResult } from '../matcher.js'

interface ElementOverrides {
  name?: string
  nameNormalized?: string
  parentRef?: string
}

function element(ref: string, role: string, nameNormalized: string, overrides: ElementOverrides = {}): ElementInfo {
  const el: ElementInfo = {
    ref: asRef(ref),
    role,
    name: overrides.name ?? nameNormalized,
    nameNormalized: overrides.nameNormalized ?? nameNormalized,
    state: { enabled: true, focused: false, visible: true },
    labels: {},
    attributes: {},
  }
  if (overrides.parentRef !== undefined) el.hierarchy = { parentRef: asRef(overrides.parentRef) }
  return el
}

function match(input: DescriptorMatchInput): MatchResult {
  return matchDescriptor(input)
}

describe('matchDescriptor — precedence ladder (D-12)', () => {
  it('rung 1: role+nameNormalized exact wins over a nameNormalized-only match and a substring match', () => {
    const elements = [
      element('e1', 'link', 'save changes'), // nameNormalized-only (role differs)
      element('e2', 'button', 'save changes now'), // substring only
      element('e3', 'button', 'save changes'), // exact role+nameNormalized — the winner
    ]

    const result = match({ descriptor: { role: 'button', nameNormalized: 'save changes' }, elements })

    expect(result).toEqual<MatchResult>({ kind: 'resolved', ref: elements[2].ref })
  })

  it('rung 2: nameNormalized exact (role differs) rescues a role-drifted element when rung 1 is empty', () => {
    const elements = [
      element('e1', 'link', 'checkout'), // role drifted from the stored 'button'
      element('e2', 'button', 'help'),
    ]

    const result = match({ descriptor: { role: 'button', nameNormalized: 'checkout' }, elements })

    expect(result).toEqual<MatchResult>({ kind: 'resolved', ref: elements[0].ref })
  })

  it('rung 3: normalized-substring rescues benign name drift when rungs 1-2 are empty', () => {
    const elements = [
      element('e1', 'button', 'save changes'), // live name drifted longer than the stored 'save'
      element('e2', 'link', 'help'),
    ]

    const result = match({ descriptor: { role: 'button', nameNormalized: 'save' }, elements })

    expect(result).toEqual<MatchResult>({ kind: 'resolved', ref: elements[0].ref })
  })
})

describe('matchDescriptor — ordinal is a tiebreak only (D-12)', () => {
  it('ordinal selects within the surviving result set', () => {
    const elements = [
      element('e1', 'button', 'add'),
      element('e2', 'button', 'add'),
      element('e3', 'button', 'add'),
    ]

    expect(match({ descriptor: { role: 'button', nameNormalized: 'add', ordinal: 0 }, elements }))
      .toEqual<MatchResult>({ kind: 'resolved', ref: elements[0].ref })
    expect(match({ descriptor: { role: 'button', nameNormalized: 'add', ordinal: 2 }, elements }))
      .toEqual<MatchResult>({ kind: 'resolved', ref: elements[2].ref })
  })

  it('an ordinal beyond the surviving set is a no-match, never a clamp to the last element', () => {
    const elements = [
      element('e1', 'button', 'add'),
      element('e2', 'button', 'add'),
    ]

    const result = match({ descriptor: { role: 'button', nameNormalized: 'add', ordinal: 5 }, elements })

    expect(result).toEqual<MatchResult>({ kind: 'no-match' })
  })
})

describe('matchDescriptor — ambiguity never picks (D-12, security property T-357-01a)', () => {
  it('two survivors after the ladder and no ordinal ⇒ ambiguous with candidate refs, never a pick', () => {
    const elements = [
      element('e1', 'button', 'add'),
      element('e2', 'button', 'add'),
    ]

    const result = match({ descriptor: { role: 'button', nameNormalized: 'add' }, elements })

    expect(result.kind).toBe('ambiguous')
    if (result.kind !== 'ambiguous') throw new Error('expected ambiguous')
    expect(result.candidates).toEqual<Ref[]>([elements[0].ref, elements[1].ref])
  })
})

describe('matchDescriptor — descriptor rejections (D-13, D-06)', () => {
  it('a descriptor with no name is rejected with reason name-missing (D-13)', () => {
    const elements = [element('e1', 'button', 'save')]

    const result = match({ descriptor: { role: 'button' }, elements })

    expect(result).toEqual<MatchResult>({ kind: 'rejected', reason: 'name-missing' })
  })

  it('a descriptor carrying `near` is rejected with reason near-unsupported (D-06 backstop)', () => {
    const elements = [element('e1', 'button', 'save')]

    const result = match({
      descriptor: { role: 'button', nameNormalized: 'save', near: { nameNormalized: 'email' } },
      elements,
    })

    expect(result).toEqual<MatchResult>({ kind: 'rejected', reason: 'near-unsupported' })
  })
})

describe('matchDescriptor — normalize exactly once (Pitfall 6)', () => {
  it('normalizes a raw `name` once and passes a pre-normalized `nameNormalized` through untouched', () => {
    // Raw name normalizes (whitespace-collapse + casefold) to 'save'.
    const savers = [element('e1', 'button', 'save')]
    expect(match({ descriptor: { role: 'button', name: '  Save  ' }, elements: savers }))
      .toEqual<MatchResult>({ kind: 'resolved', ref: savers[0].ref })

    // A pre-normalized nameNormalized that legitimately retains a trailing digit must NOT
    // be re-normalized (which would strip ' 2' → 'page' and fail to match the element).
    const pages = [
      element('e2', 'link', 'page 2', { name: 'Page 2' }),
      element('e3', 'link', 'page'),
    ]
    expect(match({ descriptor: { role: 'link', nameNormalized: 'page 2' }, elements: pages }))
      .toEqual<MatchResult>({ kind: 'resolved', ref: pages[0].ref })
  })
})

describe('matchDescriptor — prior-ElementInfo hierarchy disambiguation (Pattern 4)', () => {
  it('resolves an otherwise-ambiguous set by structural parent chain, not raw parentRef equality', () => {
    // Fresh observation: two identical 'submit' buttons under structurally-different forms.
    const freshParentCheckout = element('e20', 'form', 'checkout')
    const freshParentNewsletter = element('e21', 'form', 'newsletter')
    const elements = [
      freshParentCheckout,
      freshParentNewsletter,
      element('e10', 'button', 'submit', { parentRef: 'e20' }), // under checkout
      element('e11', 'button', 'submit', { parentRef: 'e21' }), // under newsletter
    ]

    // Prior observation: the failed target sat under a form 'checkout' — refs differ
    // across observations (e2/e5), so only structural role+nameNormalized can match.
    const priorTarget = element('e5', 'button', 'submit', { parentRef: 'e2' })
    const priorElements = [element('e2', 'form', 'checkout'), priorTarget]

    const result = match({
      descriptor: { role: 'button', nameNormalized: 'submit' },
      elements,
      prior: { target: priorTarget, elements: priorElements },
    })

    expect(result).toEqual<MatchResult>({ kind: 'resolved', ref: asRef('e10') })
  })
})
