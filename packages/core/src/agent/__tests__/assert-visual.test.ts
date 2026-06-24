import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { formatAction } from '../prompts.js'
import type { Action } from '../../types/platform.js'

// Get the assert schema from the registry
import { defaultRegistry } from '../../tools/index.js'

function getAssertSchema(): z.ZodObject<any> {
  const tools = (defaultRegistry as any).tools as Map<string, any>
  const assertTool = tools.get('common_assert')
  return assertTool.schema
}

describe('assert evidence field', () => {
  describe('schema parsing', () => {
    it('defaults to visible screen-backed assertions', () => {
      const schema = getAssertSchema()
      const result = schema.safeParse({ claim: 'banner visible' })
      expect(result.success).toBe(true)
      expect(result.data!.kind).toBe('visible')
      expect(result.data!.evidence).toBe('screen')
    })

    it('accepts explicit text assertions backed by DOM evidence', () => {
      const schema = getAssertSchema()
      const result = schema.safeParse({
        claim: 'x',
        kind: 'text',
        expected: 'Done',
        evidence: 'dom',
      })
      expect(result.success).toBe(true)
      expect(result.data!.kind).toBe('text')
      expect(result.data!.expected).toBe('Done')
      expect(result.data!.evidence).toBe('dom')
    })

    it('rejects unknown evidence modes', () => {
      const schema = getAssertSchema()
      const result = schema.safeParse({ claim: 'x', evidence: 'bogus' })
      expect(result.success).toBe(false)
    })
  })

  describe('formatAction', () => {
    it('includes [non-visual] suffix when visual is false', () => {
      const action: Action = { type: 'assert', condition: '42 equals 42', visual: false }
      expect(formatAction(action)).toBe('assert "42 equals 42" [non-visual]')
    })

    it('has no suffix when visual is true', () => {
      const action: Action = { type: 'assert', condition: 'button says Submit', visual: true }
      expect(formatAction(action)).toBe('assert "button says Submit"')
    })

    it('has no suffix when visual is undefined', () => {
      const action: Action = { type: 'assert', condition: 'title is Dashboard' }
      expect(formatAction(action)).toBe('assert "title is Dashboard"')
    })
  })
})
