import { describe, expect, it } from 'vitest'
import { ToolRegistry } from '../registry.js'
import { registerAllActions } from '../actions/index.js'
import { toolCallToActionPlan } from '../builder.js'
import { GroundingError, groundingError } from '../errors.js'

function buildRegistry(): ToolRegistry {
  const registry = new ToolRegistry()
  registerAllActions(registry)
  return registry
}

describe('GroundingError', () => {
  it('wraps invalid registry args with a schema_invalid code and correction hint', () => {
    const registry = buildRegistry()

    try {
      toolCallToActionPlan('web_fill', {
        reasoning: 'Fill the field',
        confidence: 0.8,
        stepComplete: false,
        ref: 'e1',
      }, registry)
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(GroundingError)
      const err = error as GroundingError
      expect(err.code).toBe('schema_invalid')
      expect(err.toolName).toBe('web_fill')
      expect(err.hint).toEqual(expect.any(String))
      expect(err.hint.length).toBeGreaterThan(0)
      expect(err.zodError).toBeDefined()
    }
  })

  it('builds a ref_not_in_snapshot error with a re-observe hint and ref message', () => {
    const err = groundingError.refNotInSnapshot('web_click', 'e42')

    expect(err).toBeInstanceOf(GroundingError)
    expect(err.code).toBe('ref_not_in_snapshot')
    expect(err.toolName).toBe('web_click')
    expect(err.message).toContain('e42')
    expect(err.hint.toLowerCase()).toContain('re-observe')
  })

  it('builds a coords_out_of_bounds error with a scroll hint and bounds message', () => {
    const err = groundingError.coordsOutOfBounds('common_tapCoordinate', 10, 20, 390, 844)

    expect(err).toBeInstanceOf(GroundingError)
    expect(err.code).toBe('coords_out_of_bounds')
    expect(err.toolName).toBe('common_tapCoordinate')
    expect(err.message).toContain('10')
    expect(err.message).toContain('20')
    expect(err.message).toContain('390')
    expect(err.message).toContain('844')
    expect(err.hint.toLowerCase()).toContain('scroll')
  })
})
