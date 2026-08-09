// The conjunction grammar's behavioural pin (Phase 392, D-09 / RESEARCH Pitfall 5).
//
// Every case here is a claim about what a person typed and what the turn engine is therefore
// obliged to route. The quoted-conjunction cases are the load-bearing ones: a regex `split()` on
// the same token set passes every other test in this file and fails those two, which is exactly
// why the implementation is a character scan with an explicit quote state.

import { describe, expect, it } from 'vitest'

import { CONJUNCTION_TOKENS, splitClauses } from '../clause-split.js'

/** The assertion most cases want: just the texts, in order. */
function texts(utterance: string): string[] {
  return splitClauses(utterance).map((clause) => clause.text)
}

describe('CONJUNCTION_TOKENS', () => {
  it('is the pinned closed set, in the order the scanner tries it', () => {
    expect(CONJUNCTION_TOKENS).toEqual([' and ', ' then ', ';', ','])
  })
})

describe('splitClauses — the conjunction grammar', () => {
  it('splits a two-clause utterance on " and "', () => {
    expect(texts('run test 42 and show me the digest')).toEqual([
      'run test 42',
      'show me the digest',
    ])
  })

  it('splits on every pinned separator in one utterance', () => {
    expect(texts('check login, then run test 7; digest RUN-9')).toEqual([
      'check login',
      'run test 7',
      'digest RUN-9',
    ])
  })

  it('matches the word tokens case-insensitively', () => {
    expect(texts('digest RUN-1 AND status')).toEqual(['digest RUN-1', 'status'])
    expect(texts('status Then proposals')).toEqual(['status', 'proposals'])
  })

  it('numbers clauses contiguously from zero in utterance order', () => {
    expect(splitClauses('status; proposals; digest RUN-2')).toEqual([
      { text: 'status', index: 0 },
      { text: 'proposals', index: 1 },
      { text: 'digest RUN-2', index: 2 },
    ])
  })

  it('trims each clause to the text a refusal has to be able to name', () => {
    expect(texts('   status   ,   proposals   ')).toEqual(['status', 'proposals'])
  })
})

describe('splitClauses — quote protection (RESEARCH Pitfall 5)', () => {
  it('does not split a conjunction inside a double-quoted span', () => {
    expect(texts('write a test for "add and remove items"')).toEqual([
      'write a test for "add and remove items"',
    ])
  })

  it('does not split a conjunction inside a single-quoted span', () => {
    expect(texts("write a test for 'add and remove items'")).toEqual([
      "write a test for 'add and remove items'",
    ])
  })

  it('protects every pinned separator inside quotes, not just the word ones', () => {
    expect(texts('write a test for "a, b; c then d and e"')).toEqual([
      'write a test for "a, b; c then d and e"',
    ])
  })

  it('still splits on a separator OUTSIDE a quoted span in the same utterance', () => {
    expect(texts('write a test for "add and remove items" and run it')).toEqual([
      'write a test for "add and remove items"',
      'run it',
    ])
  })

  it('tolerates an unterminated quote by protecting to end-of-utterance, never throwing', () => {
    expect(() => splitClauses('write a test for "add and remove')).not.toThrow()
    expect(texts('write a test for "add and remove')).toEqual([
      'write a test for "add and remove',
    ])
  })

  it('treats an apostrophe as a quote opener, which is the safe direction', () => {
    // "don't split this and that" — the apostrophe opens a span that never closes, so the
    // whole tail is protected. Over-protection costs a clause that could have been split;
    // under-protection manufactures a phantom clause and a spurious refusal. Pitfall 5 says
    // which way to be wrong.
    expect(texts("don't split this and that")).toEqual(["don't split this and that"])
  })
})

describe('splitClauses — word boundaries and empty pieces', () => {
  it('never splits on a token embedded in a word', () => {
    expect(texts('run sandbox tests')).toEqual(['run sandbox tests'])
    expect(texts('explain the then-clause')).toEqual(['explain the then-clause'])
    expect(texts('android and ios')).toEqual(['android', 'ios'])
  })

  it('splits a bare word followed by a real separator', () => {
    expect(texts('sand and then, band')).toEqual(['sand', 'then', 'band'])
  })

  it('elides empty clauses from duplicate and trailing separators', () => {
    expect(texts('status,,proposals')).toEqual(['status', 'proposals'])
    expect(texts('status; ')).toEqual(['status'])
    expect(texts(', status')).toEqual(['status'])
    expect(texts('status, and proposals')).toEqual(['status', 'proposals'])
  })

  it('returns no clauses at all for an utterance made only of separators', () => {
    expect(texts(' ; , ')).toEqual([])
    expect(texts('   ')).toEqual([])
  })

  it('returns the whole utterance as one clause when nothing separates it', () => {
    expect(texts('proposals')).toEqual(['proposals'])
  })
})
