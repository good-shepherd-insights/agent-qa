import { describe, expect, it } from 'vitest'

import { truncateText } from '../display-text'

describe('truncateText', () => {
  it('returns its input byte-identical at or under the budget', () => {
    const text = '  Log in   with [secret:PW]\n now  '
    expect(truncateText(text, 6)).toEqual({ text, isTruncated: false })
    expect(truncateText(text, 5)).toEqual({ text, isTruncated: false })
  })

  it('keeps the first words of the budget and marks the cut', () => {
    expect(truncateText('one two  three\tfour five', 3)).toEqual({
      text: 'one two three...',
      isTruncated: true,
    })
  })

  it('counts a stored [secret:<name>] as the word it is written as', () => {
    expect(truncateText('use [secret:PW] then submit', 2)).toEqual({
      text: 'use [secret:PW]...',
      isTruncated: true,
    })
  })

  it('treats an empty string as within any budget', () => {
    expect(truncateText('', 0)).toEqual({ text: '', isTruncated: false })
  })
})
