import { describe, expect, it } from 'vitest'

import { luhnValid } from '../luhn'

describe('luhnValid', () => {
  it('accepts canonical Luhn-valid card numbers', () => {
    expect(luhnValid('4242424242424242')).toBe(true)
    expect(luhnValid('79927398713')).toBe(true)
  })

  it('rejects card-like numbers that fail the checksum', () => {
    expect(luhnValid('4242424242424241')).toBe(false)
    expect(luhnValid('1234567890123456')).toBe(false)
  })

  it('rejects lengths outside the credit-card candidate range', () => {
    expect(luhnValid('123')).toBe(false)
    expect(luhnValid('12345678901234567890')).toBe(false)
  })

  it('rejects non-digit characters', () => {
    expect(luhnValid('4242abcd42424242')).toBe(false)
  })
})
