import { describe, expect, it } from 'vitest'
import { canonicalJson, canonicalValue, committedFileText } from '../canonical-json'

describe('canonical JSON', () => {
  it('sorts object keys recursively', () => {
    expect(canonicalValue({ z: 1, a: { d: 4, c: 3 } })).toEqual({
      a: { c: 3, d: 4 },
      z: 1,
    })
    expect(canonicalJson({ z: 1, a: { d: 4, c: 3 } })).toBe(
      '{"a":{"c":3,"d":4},"z":1}',
    )
  })

  it('preserves array order while canonicalizing nested objects', () => {
    expect(canonicalValue([{ b: 2, a: 1 }, 3, 1, 2])).toEqual([
      { a: 1, b: 2 },
      3,
      1,
      2,
    ])
  })

  it.each([null, true, false, 'value', 42])('passes scalar %j through unchanged', (value) => {
    expect(canonicalValue(value)).toBe(value)
  })

  it('pretty-prints committed files with exactly one trailing newline', () => {
    const text = committedFileText({ b: 2, a: { d: 4, c: 3 } })

    expect(text).toBe('{\n  "a": {\n    "c": 3,\n    "d": 4\n  },\n  "b": 2\n}\n')
    expect(text.endsWith('\n')).toBe(true)
    expect(text.endsWith('\n\n')).toBe(false)
  })

  it('matches the documented committed-file byte convention', () => {
    const value = { outer: { z: [3, { b: 2, a: 1 }], a: null } }

    expect(committedFileText(value)).toBe(`${JSON.stringify(canonicalValue(value), null, 2)}\n`)
  })
})
