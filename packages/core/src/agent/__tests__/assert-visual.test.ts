import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { formatAction } from '../prompts.js'
import type { Action } from '@vostride/agent-qa-runner'

// Get the assert schema from the registry
import { defaultRegistry } from '@vostride/agent-qa-runner'

function getAssertSchema(): z.ZodObject<any> {
  return defaultRegistry.getSchema('common_assertAI') as z.ZodObject<any>
}

describe('assert evidence field', () => {
  describe('schema parsing', () => {
    it('defaults to multimodal medium-effort assertions', () => {
      const schema = getAssertSchema()
      const result = schema.safeParse({ claim: 'banner visible' })
      expect(result.success).toBe(true)
      expect(result.data!.mode).toBe('multimodal')
      expect(result.data!.effort).toBe('medium')
      expect(result.data!.consensus).toBe(1)
    })

    it('accepts explicit visual assertion knobs', () => {
      const schema = getAssertSchema()
      const result = schema.safeParse({
        claim: 'x',
        mode: 'visual',
        effort: 'high',
        consensus: 3,
        video: true,
      })
      expect(result.success).toBe(true)
      expect(result.data!.mode).toBe('visual')
      expect(result.data!.effort).toBe('high')
      expect(result.data!.consensus).toBe(3)
      expect(result.data!.video).toBe(true)
    })

    it('rejects unknown assertion modes', () => {
      const schema = getAssertSchema()
      const result = schema.safeParse({ claim: 'x', mode: 'bogus' })
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
