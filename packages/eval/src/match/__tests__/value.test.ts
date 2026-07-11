import { describe, expect, it } from 'vitest'
import { tokenizeValue, tokenSetF1 } from '../value'

describe('tokenizeValue', () => {
  it('shares identity normalization for casing and whitespace noise', () => {
    expect(tokenizeValue('  Hello   WORLD  ')).toEqual(['hello', 'world'])
  })

  it('splits punctuation on one non-alphanumeric character class', () => {
    expect(tokenizeValue('foo-bar,baz')).toEqual(['foo', 'bar', 'baz'])
  })
})

describe('tokenSetF1', () => {
  it('scores identical, reordered, and casing or whitespace-noisy values as 1', () => {
    expect(tokenSetF1('hello world', 'hello world')).toBe(1)
    expect(tokenSetF1('hello world', 'world hello')).toBe(1)
    expect(tokenSetF1('  Hello   World  ', 'world hello')).toBe(1)
  })

  it('scores completely disjoint values as 0', () => {
    expect(tokenSetF1('hello world', 'goodbye moon')).toBe(0)
  })

  it('counts duplicate-token multiplicity in partial overlap', () => {
    const score = tokenSetF1('a a b', 'a b')

    expect(score).toBeCloseTo(0.8)
    expect(score).toBeGreaterThan(0)
    expect(score).toBeLessThan(1)
  })

  it('scores two empty token sets as 1 and exactly one empty set as 0', () => {
    expect(tokenSetF1('   ', '\t\n')).toBe(1)
    expect(tokenSetF1('', 'value')).toBe(0)
    expect(tokenSetF1('value', '')).toBe(0)
  })
})
