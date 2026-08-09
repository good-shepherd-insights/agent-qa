// The conjunction grammar's behavioural pin (Phase 392, D-09 / RESEARCH Pitfall 5).
//
// Every case here is a claim about what a person typed and what the turn engine is therefore
// obliged to route. The quoted-conjunction cases are the load-bearing ones: a regex `split()` on
// the same token set passes every other test in this file and fails those two, which is exactly
// why the implementation is a character scan with an explicit quote state.

import { describe, expect, it } from 'vitest'

import { CONJUNCTION_TOKENS, STYLE_MODIFIER_PHRASES, splitClauses } from '../clause-split.js'

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

/**
 * The seven phrases, written HERE as literals rather than imported from the module under test.
 *
 * A case that reads its expectation out of the code it measures cannot fail when both move
 * together (392-15's own recorded lesson). The import-side pin that asserts the constant IS this
 * list lives in its own case above; these literals are the independent statement of what a person
 * may type and still be understood.
 */
const PINNED_MODIFIERS = [
  'briefly',
  'concisely',
  'in a sentence',
  'in brief',
  'in one sentence',
  'in short',
  'in two sentences',
] as const

describe('STYLE_MODIFIER_PHRASES', () => {
  it('is the pinned closed set — seven phrases, and adding one is a decision, not a tweak', () => {
    expect(STYLE_MODIFIER_PHRASES).toEqual([
      'briefly',
      'concisely',
      'in a sentence',
      'in brief',
      'in one sentence',
      'in short',
      'in two sentences',
    ])
  })
})

describe('splitClauses — a style modifier is not a request (392-16, G-392-1)', () => {
  it('routes the G-392-1 utterance as the single question it is', () => {
    // The measured gap, at its own seam. `in one sentence` instructs the FORM of the answer and
    // names nothing this build has; split off as its own clause it is a phantom the model has to
    // claim back byte-for-byte, and missing it refuses the whole turn.
    expect(splitClauses('in one sentence, what does it mean to call a test flaky?')).toEqual([
      { text: 'what does it mean to call a test flaky?', index: 0 },
    ])
  })

  it('recognises a modifier whatever its case, as the separator scan already does', () => {
    expect(splitClauses('In One Sentence, what does it mean to call a test flaky?')).toEqual([
      { text: 'what does it mean to call a test flaky?', index: 0 },
    ])
  })

  it('elides a TRAILING modifier too — membership is the rule, not position', () => {
    expect(texts('what is a flake, briefly')).toEqual(['what is a flake'])
  })

  it.each(PINNED_MODIFIERS.map((phrase) => [phrase] as const))(
    'elides the pinned modifier %s',
    (phrase) => {
      expect(texts(`${phrase}, status`)).toEqual(['status'])
    },
  )

  it('keeps a modifier that is the only thing the person typed', () => {
    // The fail-safe floor. Zero clauses is not an outcome this splitter may produce: refusing
    // something a person typed is recoverable, dropping it silently is not (Pitfall 5's asymmetry).
    expect(texts('briefly')).toEqual(['briefly'])
  })

  it('keeps every modifier when the utterance is nothing but modifiers', () => {
    expect(texts('briefly, in short')).toEqual(['briefly', 'in short'])
  })

  it('does not touch a compound of two real requests', () => {
    expect(texts('run test 42, then summarise the last failure')).toEqual([
      'run test 42',
      'summarise the last failure',
    ])
  })

  it('does not treat a QUOTED modifier as a member — the quote characters are part of the text', () => {
    expect(texts('write a test for "briefly" and run it')).toEqual([
      'write a test for "briefly"',
      'run it',
    ])
    expect(texts('"briefly", status')).toEqual(['"briefly"', 'status'])
  })

  it('does not reach past the whole piece into a request that BEGINS with a modifier', () => {
    expect(texts('briefly explain the flake, status')).toEqual([
      'briefly explain the flake',
      'status',
    ])
    expect(texts('explain briefly what a flake is')).toEqual(['explain briefly what a flake is'])
  })
})
