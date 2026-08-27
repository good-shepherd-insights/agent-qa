// ONE SPELLING FOR THE MASKED MARKER (405-06 Task 3 · DETL-02, D-10).
//
// Two things in different packages have to agree on this vocabulary EXACTLY: the dashboard host's
// display-unmask seam (405-10), which rewrites a placeholder it cannot restore into a marker, and
// the dashboard-ui chip parser (405-11), which splits that marker back out of a text run and paints
// a chip. They are written in different waves by different plans, and if their two spellings ever
// drift the failure is silent in the worst possible direction — a raw `<SECRET_1>` rendered to a
// person, or a marker the parser did not recognise passed through as literal text.
//
// So the spelling lives HERE, in the browser-safe kernel both sides already depend on, and the
// cells below pin the three properties a shared vocabulary has to have: an exact form, a pattern
// that matches ONLY that form, and a placeholder pattern that mirrors safety's `formatPlaceholder`
// without schema importing safety (which it must not — schema is the kernel, safety is downstream).

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import {
  MASKED_MARKER_DELIMITER,
  MASKED_MARKER_PATTERN,
  PLACEHOLDER_PATTERN,
  maskedMarker,
  type MaskedCategory,
} from '../run/masked-marker'
import * as markerModule from '../run/masked-marker'

describe('maskedMarker', () => {
  it('mints the exact marker both consumers agree on', () => {
    expect(maskedMarker('secret')).toBe('␟masked:secret␟')
    expect(maskedMarker('email')).toBe('␟masked:email␟')
  })

  it('always delimits both ends with the unit separator', () => {
    const categories: readonly MaskedCategory[] = ['secret', 'email']
    for (const category of categories) {
      const marker = maskedMarker(category)
      expect(marker.startsWith(MASKED_MARKER_DELIMITER)).toBe(true)
      expect(marker.endsWith(MASKED_MARKER_DELIMITER)).toBe(true)
      // U+241F is a PICTURE of a control character, not one: it survives JSON, SQLite and a DOM
      // text node intact, which a real 0x1F would not.
      expect(MASKED_MARKER_DELIMITER).toHaveLength(1)
    }
  })
})

describe('MASKED_MARKER_PATTERN', () => {
  it('finds every marker in a text run, in order, capturing the category', () => {
    const text = `a ${maskedMarker('secret')} b ${maskedMarker('email')}`
    MASKED_MARKER_PATTERN.lastIndex = 0
    const matches = [...text.matchAll(MASKED_MARKER_PATTERN)]

    expect(matches).toHaveLength(2)
    expect(matches[0]?.[1]).toBe('secret')
    expect(matches[1]?.[1]).toBe('email')
    expect(matches[0]?.[0]).toBe(maskedMarker('secret'))
  })

  it('matches nothing for a stray delimiter or an unknown body', () => {
    for (const text of [
      '␟masked:other␟',
      '␟',
      'masked:secret',
      '␟masked:secret',
      'masked:secret␟',
      '␟masked:SECRET␟',
    ]) {
      MASKED_MARKER_PATTERN.lastIndex = 0
      expect(MASKED_MARKER_PATTERN.test(text), text).toBe(false)
    }
  })
})

describe('PLACEHOLDER_PATTERN', () => {
  it('captures the category and the index of a well-formed placeholder', () => {
    PLACEHOLDER_PATTERN.lastIndex = 0
    const matches = [...'here <SECRET_0> and <EMAIL_12>'.matchAll(PLACEHOLDER_PATTERN)]

    expect(matches).toHaveLength(2)
    expect(matches[0]?.[1]).toBe('SECRET')
    expect(matches[0]?.[2]).toBe('0')
    expect(matches[1]?.[1]).toBe('EMAIL')
    expect(matches[1]?.[2]).toBe('12')
  })

  it('refuses a malformed, unbracketed or lower-cased placeholder', () => {
    for (const text of ['<SECRET_>', 'SECRET_1', '<secret_1>', '<OTHER_1>', '<SECRET1>']) {
      PLACEHOLDER_PATTERN.lastIndex = 0
      expect(PLACEHOLDER_PATTERN.test(text), text).toBe(false)
    }
  })

  it('both patterns are global and reusable after lastIndex is reset', () => {
    for (const pattern of [MASKED_MARKER_PATTERN, PLACEHOLDER_PATTERN]) {
      expect(pattern.global).toBe(true)
    }
    const text = `${maskedMarker('secret')} <SECRET_0>`
    for (const pass of [0, 1]) {
      void pass
      MASKED_MARKER_PATTERN.lastIndex = 0
      PLACEHOLDER_PATTERN.lastIndex = 0
      expect([...text.matchAll(MASKED_MARKER_PATTERN)]).toHaveLength(1)
      expect([...text.matchAll(PLACEHOLDER_PATTERN)]).toHaveLength(1)
    }
  })
})

describe('the browser-safe pin', () => {
  it('exports only strings, RegExps and functions, and imports no host module', () => {
    for (const [name, value] of Object.entries(markerModule)) {
      const kind = value instanceof RegExp ? 'regexp' : typeof value
      expect(kind, name).toMatch(/^(string|function|regexp)$/)
    }

    const source = readFileSync(fileURLToPath(new URL('../run/masked-marker.ts', import.meta.url)), 'utf8')
    // Schema is the browser-safe kernel: no node builtins, and NOT an import of safety, whose
    // placeholder spelling this file deliberately mirrors rather than depends on.
    expect(source).not.toMatch(/from '[^']*node:/)
    expect(source).not.toMatch(/from '[^']*agent-qa-safety/)
    expect(source).not.toMatch(/^import /m)
  })
})
