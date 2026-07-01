import { describe, expect, it } from 'vitest'

import { formatPlaceholder } from '../categories'
import { detectEmails } from '../detectors'

describe('masking leaf utilities', () => {
  it('formats typed placeholders with the exact category index literal', () => {
    expect(formatPlaceholder('SECRET', 0)).toBe('<SECRET_0>')
    expect(formatPlaceholder('EMAIL', 3)).toBe('<EMAIL_3>')
  })

  it('detects each distinct email once in first appearance order', () => {
    expect(detectEmails('mail a@b.com and again a@b.com plus c.d@e.co')).toEqual([
      'a@b.com',
      'c.d@e.co',
    ])
  })

  it('returns an empty list when no email address is present', () => {
    expect(detectEmails('no address here just text')).toEqual([])
  })

  it('does not match bare handles or hostless URLs', () => {
    expect(detectEmails('handle @nope and http://x.io/y')).toEqual([])
  })
})
