import { describe, it, expect, beforeEach } from 'vitest'
import { z } from 'zod'
import { ToolRegistry } from '../registry.js'
import { registerAllActions } from '../actions/index.js'
import { buildTools, toolCallToActionPlan, ToolValidationError } from '../builder.js'

describe('buildTools', () => {
  let registry: ToolRegistry

  beforeEach(() => {
    registry = new ToolRegistry()
    registerAllActions(registry)
  })

  it('returns Record of AI SDK tool objects for web platform', () => {
    const tools = buildTools(registry, { platform: 'web' })
    expect(tools).toHaveProperty('web_click')
    expect(tools).toHaveProperty('web_hover')
    expect(tools).not.toHaveProperty('mobile_nativeSelect')
    expect(tools).not.toHaveProperty('mobile_tap')
    expect(tools).not.toHaveProperty('mobile_swipe')
    expect(tools).not.toHaveProperty('mobile_pinch')
    expect(tools).not.toHaveProperty('mobile_multiTap')
  })

  it('excludes web-only actions for android platform', () => {
    const tools = buildTools(registry, { platform: 'android' })
    expect(tools).not.toHaveProperty('web_hover')
    expect(tools).toHaveProperty('mobile_tap')
    expect(tools).not.toHaveProperty('web_click')
    expect(tools).toHaveProperty('mobile_nativeSelect')
  })

  it('includes nativeSelect for iOS platform', () => {
    const tools = buildTools(registry, { platform: 'ios' })
    expect(tools).toHaveProperty('mobile_nativeSelect')
  })

  it('each built tool includes plan metadata fields merged with action fields', () => {
    const tools = buildTools(registry, { platform: 'web' })
    const clickTool = tools['web_click'] as any
    // AI SDK tool objects store the Zod schema under inputSchema or parameters
    const schema = (clickTool.inputSchema ?? clickTool.parameters) as z.ZodObject<any>
    const shape = schema.shape
    // Plan metadata fields
    expect(shape).toHaveProperty('reasoning')
    expect(shape).toHaveProperty('confidence')
    expect(shape).toHaveProperty('stepComplete')
    expect(shape).toHaveProperty('stepFailed')
    // Action-specific fields
    expect(shape).toHaveProperty('ref')
  })

  it('built tool has matching description', () => {
    const tools = buildTools(registry, { platform: 'web' })
    const clickTool = tools['web_click'] as any
    expect(clickTool.description).toBe('Click an element')
  })
})

describe('toolCallToActionPlan', () => {
  let registry: ToolRegistry

  beforeEach(() => {
    registry = new ToolRegistry()
    registerAllActions(registry)
  })

  it('extracts plan metadata and returns structured action plan', () => {
    const result = toolCallToActionPlan('web_click', {
      reasoning: 'Click the submit button',
      confidence: 0.9,
      stepComplete: false,
      ref: 'e1',
    }, registry)

    expect(result).toEqual({
      reasoning: 'Click the submit button',
      confidence: 0.9,
      stepComplete: false,
      stepFailed: false,
      action: { type: 'click', ref: 'e1' },
    })
  })

  it('validates action fields against registry schema', () => {
    const result = toolCallToActionPlan('web_fill', {
      reasoning: 'Fill the email field',
      confidence: 0.8,
      stepComplete: false,
      ref: 'e2',
      value: 'test@example.com',
    }, registry)

    expect(result.action).toEqual({
      type: 'fill',
      ref: 'e2',
      value: 'test@example.com',
    })
  })

  it('throws ToolValidationError on invalid args', () => {
    expect(() => toolCallToActionPlan('web_fill', {
      reasoning: 'Fill something',
      confidence: 0.5,
      stepComplete: false,
      ref: 'e1',
      // missing required 'value' field
    }, registry)).toThrow(ToolValidationError)
  })

  it('ToolValidationError has toolName and zodError', () => {
    try {
      toolCallToActionPlan('web_fill', {
        reasoning: 'test',
        confidence: 0.5,
        stepComplete: false,
        ref: 'e1',
      }, registry)
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(ToolValidationError)
      const err = e as ToolValidationError
      expect(err.toolName).toBe('web_fill')
      expect(err.zodError).toBeDefined()
    }
  })

  it('extracts stepFailed=true from args', () => {
    const result = toolCallToActionPlan('web_click', {
      reasoning: 'Button is not on screen',
      confidence: 1.0,
      stepComplete: false,
      stepFailed: true,
      ref: 'e1',
    }, registry)

    expect(result.stepFailed).toBe(true)
  })

  it('defaults stepFailed to false when undefined', () => {
    const result = toolCallToActionPlan('web_click', {
      reasoning: 'Click the submit button',
      confidence: 0.9,
      stepComplete: false,
      ref: 'e1',
    }, registry)

    expect(result.stepFailed).toBe(false)
  })

  it('handles scroll action with scrollType and value', () => {
    const result = toolCallToActionPlan('common_scroll', {
      reasoning: 'Scroll down to find the button',
      confidence: 0.9,
      stepComplete: false,
      scrollType: 'vertical',
      value: 500,
    }, registry)

    expect(result.action).toEqual({
      type: 'scroll',
      scrollType: 'vertical',
      value: 500,
    })
  })

  it('handles actions with no required fields (like refresh)', () => {
    const result = toolCallToActionPlan('web_refresh', {
      reasoning: 'Refresh page',
      confidence: 1.0,
      stepComplete: true,
    }, registry)

    expect(result.action).toEqual({ type: 'refresh' })
  })

  it('converts nativeSelect tool calls into action plans', () => {
    const result = toolCallToActionPlan('mobile_nativeSelect', {
      reasoning: 'Pick month',
      confidence: 0.9,
      stepComplete: true,
      ref: 'e3',
      value: 'March',
    }, registry)

    expect(result).toMatchObject({
      reasoning: 'Pick month',
      confidence: 0.9,
      stepComplete: true,
      stepFailed: false,
      action: { type: 'nativeSelect', ref: 'e3', value: 'March' },
    })
  })
})
