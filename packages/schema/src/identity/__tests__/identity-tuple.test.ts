import { describe, expect, it } from 'vitest'
import { identityTupleKey } from '../identity-tuple'

describe('identityTupleKey', () => {
  it('keeps the delimiter-embedding counterexample distinct', () => {
    expect(identityTupleKey(['a::b', 'c'])).not.toBe(identityTupleKey(['a', 'b::c']))
  })

  it('keeps quote, backslash, and newline parts injective', () => {
    const adversarial: readonly (readonly string[])[] = [
      ['a"b', 'c'],
      ['a', '"b,c'],
      ['a\\', 'b'],
      ['a', '\\b'],
      ['a\nb', 'c'],
      ['a', 'b\nc'],
      ['a\\"b', 'c'],
      ['a', '\\"b,c'],
    ]
    const keys = adversarial.map((parts) => identityTupleKey(parts))
    expect(new Set(keys).size).toBe(adversarial.length)
  })

  it('distinguishes empty parts and arity', () => {
    const keys = [
      identityTupleKey(['a', '']),
      identityTupleKey(['a']),
      identityTupleKey(['', 'a']),
    ]
    expect(new Set(keys).size).toBe(3)
  })

  it('keeps NFC and NFD spellings of the same visible name distinct', () => {
    const nfc = '\u00e9clair.spec.ts'
    const nfd = 'e\u0301clair.spec.ts'
    expect(nfc.normalize('NFC')).toBe(nfd.normalize('NFC'))
    expect(nfc).not.toBe(nfd)
    expect(identityTupleKey([nfc, 'test'])).not.toBe(identityTupleKey([nfd, 'test']))
  })

  it('is deterministic for equal parts', () => {
    const parts = ['tests/checkout.yaml', 'guest checkout with "promo" \\ edge']
    expect(identityTupleKey(parts)).toBe(identityTupleKey([...parts]))
    expect(identityTupleKey(parts)).toBe(identityTupleKey(parts))
  })
})
