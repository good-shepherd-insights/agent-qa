import { describe, expect, it } from 'vitest'

import type { GoldAnchorDescriptor } from '../../cassette/sidecar-leg'
import { anchorsEqual, classifyAnchorLadder } from '../ladder'

const goldAnchor = {
  role: 'button',
  nameNormalized: 'submit',
  ordinal: 0,
  ref: 'gold-ref',
} satisfies GoldAnchorDescriptor

describe('anchorsEqual', () => {
  it('matches role, normalized name, and same-screen ordinal while ignoring ref evidence', () => {
    expect(
      anchorsEqual(
        { role: 'button', nameNormalized: 'submit', ordinal: 0 },
        { ...goldAnchor, ref: 'replacement-ref' },
      ),
    ).toBe(true)
  })
})

describe('classifyAnchorLadder', () => {
  it('classifies an exact gold-anchor identity as full', () => {
    expect(
      classifyAnchorLadder(
        { role: 'button', nameNormalized: 'submit', ordinal: 0 },
        goldAnchor,
        [],
      ),
    ).toBe('full')
  })

  it('classifies a ref-changed gold-equivalence member as full', () => {
    const equivalenceMember = {
      role: 'link',
      nameNormalized: 'submit',
      ordinal: 1,
      ref: 'wrapper-ref-that-differs-from-gold',
    } satisfies GoldAnchorDescriptor

    expect(
      classifyAnchorLadder(
        { role: 'link', nameNormalized: 'submit', ordinal: 1 },
        goldAnchor,
        [equivalenceMember],
      ),
    ).toBe('full')
  })

  it('gives partial credit when only the same-screen ordinal differs', () => {
    expect(
      classifyAnchorLadder(
        { role: 'button', nameNormalized: 'submit', ordinal: 4 },
        goldAnchor,
        [],
      ),
    ).toBe('ordinal-only-differs')
  })

  it('names role-only, name-only, and complete identity misses discretely', () => {
    expect(
      classifyAnchorLadder(
        { role: 'button', nameNormalized: 'cancel', ordinal: 0 },
        goldAnchor,
        [],
      ),
    ).toBe('role-matches-name-differs')
    expect(
      classifyAnchorLadder(
        { role: 'link', nameNormalized: 'submit', ordinal: 0 },
        goldAnchor,
        [],
      ),
    ).toBe('name-matches-role-differs')
    expect(
      classifyAnchorLadder(
        { role: 'link', nameNormalized: 'cancel', ordinal: 0 },
        goldAnchor,
        [],
      ),
    ).toBe('miss')
  })

  it('uses equivalence members only for full membership and computes partials against gold', () => {
    const equivalenceMember = {
      role: 'link',
      nameNormalized: 'wrapper',
      ordinal: 0,
      ref: 'wrapper-ref',
    } satisfies GoldAnchorDescriptor

    expect(
      classifyAnchorLadder(
        { role: 'link', nameNormalized: 'different', ordinal: 0 },
        goldAnchor,
        [equivalenceMember],
      ),
    ).toBe('miss')
    expect(
      classifyAnchorLadder(
        { role: 'button', nameNormalized: 'wrapper', ordinal: 0 },
        goldAnchor,
        [equivalenceMember],
      ),
    ).toBe('role-matches-name-differs')
  })
})
