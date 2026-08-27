// THE CHIP PARSER'S CELLS (405-11 Task 1 · DETL-02, D-10).
//
// The marker vocabulary is schema's; this file asserts the SPLIT, not the spelling. Every fixture
// below builds its markers with `maskedMarker` rather than typing the delimiter, so a change to the
// spelling moves these cells with it instead of leaving them green against a form nobody emits.

import { describe, expect, it } from 'vitest'

import { maskedMarker } from '@vostride/agent-qa-schema'

import { splitMaskedText } from '../masked-text'

const SECRET = maskedMarker('secret')
const EMAIL = maskedMarker('email')

describe('splitMaskedText', () => {
  it('splits a run into its text and its markers, in order', () => {
    expect(splitMaskedText(`user ${SECRET} at ${EMAIL}!`)).toEqual([
      { kind: 'text', text: 'user ' },
      { kind: 'masked', category: 'secret' },
      { kind: 'text', text: ' at ' },
      { kind: 'masked', category: 'email' },
      { kind: 'text', text: '!' },
    ])
  })

  it('hands back one text segment for a run with nothing masked', () => {
    expect(splitMaskedText('nothing to hide here')).toEqual([
      { kind: 'text', text: 'nothing to hide here' },
    ])
  })

  it('hands back no segments at all for an empty run', () => {
    expect(splitMaskedText('')).toEqual([])
  })

  it('emits no empty text segment when a marker sits at either end', () => {
    expect(splitMaskedText(`${SECRET}${EMAIL}`)).toEqual([
      { kind: 'masked', category: 'secret' },
      { kind: 'masked', category: 'email' },
    ])
  })

  // A delimiter that fences nothing is TEXT. Swallowing it into a chip would claim a redaction the
  // seam never made, and dropping it would edit the producer's own sentence.
  it('passes a stray delimiter through as the literal text it is', () => {
    const stray = '␟ not a marker ␟'
    expect(splitMaskedText(stray)).toEqual([{ kind: 'text', text: stray }])
  })

  it('passes an unknown category through as text rather than inventing a chip for it', () => {
    const unknown = '␟masked:other␟'
    expect(splitMaskedText(unknown)).toEqual([{ kind: 'text', text: unknown }])
  })

  // The pattern is `global`; a shared RegExp carries `lastIndex` between calls. A parser that did
  // not reset it would split the first string correctly and miss the marker in the second.
  it('splits the same marker again on a second call', () => {
    const once = splitMaskedText(`a ${SECRET} b`)
    expect(splitMaskedText(`a ${SECRET} b`)).toEqual(once)
  })
})
