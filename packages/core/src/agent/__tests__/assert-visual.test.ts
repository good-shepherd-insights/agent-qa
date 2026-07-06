import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import type { Action } from '@vostride/agent-qa-runner'

// Get the assert schema from the registry
import { defaultRegistry, formatAction } from '@vostride/agent-qa-runner'

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
    // Phase 360 D-19: the retired `assert` verb rendering is gone; formatAction now renders the
    // §12.2 assertion split verbs (assertValue / assertAI) and the reportValue answer channel.
    it('renders assertValue with its source, op and expected', () => {
      const action: Action = { type: 'assertValue', source: 'url', op: 'equals', expected: '42' }
      expect(formatAction(action)).toBe('assertValue url equals "42"')
    })

    it('renders assertAI with its claim and mode', () => {
      const action: Action = { type: 'assertAI', claim: 'button says Submit', mode: 'visual', effort: 'low', consensus: 1 }
      expect(formatAction(action)).toBe('assertAI "button says Submit" (visual)')
    })

    it('renders reportValue with its value', () => {
      const action: Action = { type: 'reportValue', value: 'title is Dashboard' }
      expect(formatAction(action)).toBe('reportValue "title is Dashboard"')
    })
  })
})
