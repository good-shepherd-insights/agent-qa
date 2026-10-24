import { describe, expect, it } from 'vitest'
import { TimeoutConfigSchema } from '../primitives.js'

describe('TimeoutConfigSchema', () => {
  it('parses the scaffold timeout defaults', () => {
    expect(TimeoutConfigSchema.parse({
      step: '20m',
      test: '90m',
      navigation: '2m',
    })).toEqual({
      step: 1200000,
      test: 5400000,
      navigation: 120000,
    })
  })

  it('does not impose an upper bound on duration values', () => {
    const config = {
      step: '999h',
      test: '999h',
      navigation: '999h',
    }

    expect(() => TimeoutConfigSchema.parse(config)).not.toThrow()
    expect(TimeoutConfigSchema.parse(config).step).toBe(999 * 60 * 60 * 1000)
  })
})
