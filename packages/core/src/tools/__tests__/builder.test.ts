import { describe, it, expect, beforeEach } from 'vitest'
import { z } from 'zod'
import { ToolRegistry } from '../registry.js'
import { registerAllActions } from '../actions/index.js'
import { buildTools, toolCallToActionPlan } from '../builder.js'
import { GroundingError } from '../errors.js'

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
      text: 'test@example.com',
    }, registry)

    expect(result.action).toEqual({
      type: 'fill',
      ref: 'e2',
      text: 'test@example.com',
      clearMode: 'replace',
      submit: false,
    })
  })

  it('throws GroundingError on invalid args', () => {
    expect(() => toolCallToActionPlan('web_fill', {
      reasoning: 'Fill something',
      confidence: 0.5,
      stepComplete: false,
      ref: 'e1',
      // missing required 'text' field
    }, registry)).toThrow(GroundingError)
  })

  it('GroundingError has schema code, toolName, zodError, and hint', () => {
    try {
      toolCallToActionPlan('web_fill', {
        reasoning: 'test',
        confidence: 0.5,
        stepComplete: false,
        ref: 'e1',
      }, registry)
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(GroundingError)
      const err = e as GroundingError
      expect(err.code).toBe('schema_invalid')
      expect(err.toolName).toBe('web_fill')
      expect(err.zodError).toBeDefined()
      expect(err.hint).toEqual(expect.any(String))
      expect(err.hint.length).toBeGreaterThan(0)
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

  it('handles scroll action with mode and direction', () => {
    const result = toolCallToActionPlan('common_scroll', {
      reasoning: 'Scroll down to find the button',
      confidence: 0.9,
      stepComplete: false,
      mode: 'direction',
      direction: 'down',
    }, registry)

    expect(result.action).toEqual({
      type: 'scroll',
      mode: 'direction',
      direction: 'down',
      amount: 'page',
      retryOpposite: true,
    })
  })

  it('handles folded navigate variants with no required fields', () => {
    const result = toolCallToActionPlan('web_navigate', {
      reasoning: 'Refresh page',
      confidence: 1.0,
      stepComplete: true,
      to: 'reload',
    }, registry)

    expect(result.action).toEqual({ type: 'navigate', to: 'reload' })
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

describe('buildTools discriminated-union merge', () => {
  function buildDiscriminatedTools() {
    const registry = new ToolRegistry()
    registry.register({
      id: 'common_discriminatedProbe',
      type: 'discriminatedProbe',
      surface: 'common',
      description: 'Probe discriminated tool schema handling',
      category: 'action',
      schema: z.discriminatedUnion('mode', [
        z.object({
          mode: z.literal('direction'),
          direction: z.enum(['up', 'down']),
        }),
        z.object({
          mode: z.literal('untilVisible'),
          target: z.string(),
        }),
      ]),
    })

    return buildTools(registry, { platform: 'web' })
  }

  function getInputSchema(toolDef: unknown): z.ZodType {
    const builtTool = toolDef as { inputSchema?: z.ZodType, parameters?: z.ZodType }
    const schema = builtTool.inputSchema ?? builtTool.parameters
    expect(schema).toBeDefined()
    return schema as z.ZodType
  }

  it('merges plan fields into the direction variant', () => {
    const tools = buildDiscriminatedTools()
    const schema = getInputSchema(tools['common_discriminatedProbe'])

    const parsed = schema.safeParse({
      reasoning: 'Scroll down to find the button',
      confidence: 0.9,
      stepComplete: false,
      mode: 'direction',
      direction: 'down',
    })

    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    expect(parsed.data).toMatchObject({
      reasoning: 'Scroll down to find the button',
      confidence: 0.9,
      stepComplete: false,
      mode: 'direction',
      direction: 'down',
    })
  })

  it('merges plan fields into the untilVisible variant', () => {
    const tools = buildDiscriminatedTools()
    const schema = getInputSchema(tools['common_discriminatedProbe'])

    const parsed = schema.safeParse({
      reasoning: 'Scroll until Sign in appears',
      confidence: 0.8,
      stepComplete: true,
      mode: 'untilVisible',
      target: 'Sign in',
    })

    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    expect(parsed.data).toMatchObject({
      reasoning: 'Scroll until Sign in appears',
      confidence: 0.8,
      stepComplete: true,
      mode: 'untilVisible',
      target: 'Sign in',
    })
  })

  it('preserves plain object tool schema merging', () => {
    const registry = new ToolRegistry()
    registerAllActions(registry)
    const tools = buildTools(registry, { platform: 'web' })
    const schema = getInputSchema(tools['web_click'])

    const parsed = schema.safeParse({
      reasoning: 'Click the submit button',
      confidence: 0.9,
      stepComplete: false,
      ref: 'e1',
    })

    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    expect(parsed.data).toMatchObject({
      reasoning: 'Click the submit button',
      confidence: 0.9,
      stepComplete: false,
      ref: 'e1',
    })
  })
})
