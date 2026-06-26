import { describe, expect, it } from 'vitest'

import { extractJsonStrategy } from '../middleware/extract-json.js'

describe('extractJsonStrategy', () => {
  it('extracts JSON from a json fenced block', () => {
    expect(extractJsonStrategy('```json\n{"a":1}\n```')).toBe('{"a":1}')
  })

  it('extracts the first JSON object from prose', () => {
    expect(extractJsonStrategy('Here is the result: {"a":1} thanks')).toBe('{"a":1}')
  })

  it('returns already clean JSON unchanged', () => {
    expect(extractJsonStrategy('{"a":1}')).toBe('{"a":1}')
  })

  it('returns trimmed non-JSON text when nothing can be extracted', () => {
    expect(extractJsonStrategy('  no json here  ')).toBe('no json here')
  })
})
