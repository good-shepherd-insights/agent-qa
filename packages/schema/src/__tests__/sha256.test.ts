import { describe, expect, it } from 'vitest'
import { sha256hex, sha256hex16 } from '../index'

describe('sha256hex', () => {
  it('matches NIST known-answer vectors', () => {
    expect(sha256hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(sha256hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  it('encodes multibyte and astral UTF-8 input deterministically', () => {
    const digest = sha256hex('\u{1f680}\u65e5\u672c')

    expect(digest).toBe('3f2774c58f2595a4ed05a1e746dbf17d412ad8b3a08e2e2c9a400f71dd38dbd0')
    expect(digest).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is deterministic for repeated inputs', () => {
    const digest = sha256hex('x')

    expect(sha256hex('x')).toBe(digest)
    expect(sha256hex(digest)).toBe(sha256hex(digest))
  })

  it('returns the v1-compatible 16-hex truncation', () => {
    expect(sha256hex16('screen')).toBe(sha256hex('screen').slice(0, 16))
  })
})
