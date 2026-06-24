import { describe, it, expect, beforeEach } from 'vitest'
import { z } from 'zod'
import { ToolRegistry, EXPOSURE } from '../registry.js'
import { registerAllActions } from '../actions/index.js'
import { NON_EXPOSED } from '../actions/surface-map.js'
import { toolCallToActionPlan } from '../builder.js'
import type { ToolDefinition } from '../types.js'
import type { Platform } from '@vostride/agent-qa-schema'

const platforms: Platform[] = ['web', 'android', 'ios']

function schemaShapes(schema: z.ZodType): Array<Record<string, z.ZodType>> {
  if (schema instanceof z.ZodDiscriminatedUnion) {
    return schema.options.map(option => (option as z.ZodObject<any>).shape as Record<string, z.ZodType>)
  }
  if (schema instanceof z.ZodUnion) {
    return schema.options.map(option => (option as z.ZodObject<any>).shape as Record<string, z.ZodType>)
  }
  return [(schema as z.ZodObject<any>).shape as Record<string, z.ZodType>]
}

function typesFor(registry: ToolRegistry, platform: Platform): string[] {
  return registry.getForPlatform(platform).map(def => def.type)
}

function idsFor(registry: ToolRegistry, platform: Platform): string[] {
  return registry.getForPlatform(platform).map(def => def.id)
}

function expectedSliceCount(registry: ToolRegistry, platform: Platform): number {
  const surfaces = EXPOSURE[platform]
  return registry.getAll().filter(def => def.exposed !== false && surfaces.has(def.surface)).length
}

describe('ToolRegistry', () => {
  let registry: ToolRegistry

  beforeEach(() => {
    registry = new ToolRegistry()
  })

  describe('register and get', () => {
    it('stores a ToolDefinition and retrieves it by id', () => {
      const def: ToolDefinition = {
        id: 'web_click',
        type: 'click',
        surface: 'web',
        description: 'Click an element',
        category: 'action',
        schema: z.object({ ref: z.string() }),
      }
      registry.register(def)
      expect(registry.get('web_click')).toBe(def)
    })

    it('returns undefined for unknown tool', () => {
      expect(registry.get('nonexistent')).toBeUndefined()
    })
  })

  describe('getAll', () => {
    it('returns all registered tools', () => {
      registry.register({
        id: 'web_a',
        type: 'a',
        surface: 'web',
        description: 'A',
        category: 'action',
        schema: z.object({}),
      })
      registry.register({
        id: 'common_b',
        type: 'b',
        surface: 'common',
        description: 'B',
        category: 'file',
        schema: z.object({}),
      })
      expect(registry.getAll()).toHaveLength(2)
    })
  })

  describe('getForPlatform', () => {
    it('returns the web slice with click and without tap', () => {
      registerAllActions(registry)
      const types = typesFor(registry, 'web')
      const ids = idsFor(registry, 'web')

      for (const type of [
        'click',
        'doubleClick',
        'rightClick',
        'hover',
        'paste',
        'keyDown',
        'keyUp',
        'refresh',
        'navigateHistory',
        'readConsoleLogs',
        'readNetworkLogs',
        'readCookies',
        'setCookies',
        'readLocalStorage',
        'setLocalStorage',
        'newTab',
        'switchTab',
        'assert',
        'waitFor',
        'delay',
        'scroll',
        'clearText',
        'keypress',
        'setVariable',
      ]) {
        expect(types).toContain(type)
      }

      expect(ids).toContain('web_fill')
      expect(ids).not.toContain('mobile_fill')

      for (const type of [
        'tap',
        'doubleTap',
        'multiTap',
        'tapCoordinate',
        'swipe',
        'longpress',
        'pinch',
        'drag',
        'nativeSelect',
        'hideKeyboard',
        'setOrientation',
      ]) {
        expect(types).not.toContain(type)
      }
    })

    it('returns the android slice with tap and without click', () => {
      registerAllActions(registry)
      const types = typesFor(registry, 'android')
      const ids = idsFor(registry, 'android')

      for (const type of ['tap', 'doubleTap', 'nativeSelect', 'keypress']) {
        expect(types).toContain(type)
      }

      expect(ids).toContain('mobile_fill')
      expect(ids).not.toContain('web_fill')

      for (const type of [
        'click',
        'doubleClick',
        'rightClick',
        'hover',
        'readConsoleLogs',
        'readNetworkLogs',
        'readCookies',
        'setCookies',
        'readLocalStorage',
        'setLocalStorage',
      ]) {
        expect(types).not.toContain(type)
      }
    })

    it('returns the ios slice with tap and without click', () => {
      registerAllActions(registry)
      const types = typesFor(registry, 'ios')
      const ids = idsFor(registry, 'ios')

      for (const type of ['tap', 'doubleTap', 'nativeSelect', 'keypress']) {
        expect(types).toContain(type)
      }

      expect(ids).toContain('mobile_fill')
      expect(ids).not.toContain('web_fill')

      for (const type of [
        'click',
        'doubleClick',
        'rightClick',
        'hover',
        'readConsoleLogs',
        'readNetworkLogs',
        'readCookies',
        'setCookies',
        'readLocalStorage',
        'setLocalStorage',
      ]) {
        expect(types).not.toContain(type)
      }
    })

    it('omits non-exposed escape-hatch verbs from every platform slice', () => {
      registerAllActions(registry)

      for (const platform of platforms) {
        const types = typesFor(registry, platform)
        for (const type of NON_EXPOSED) {
          expect(types).not.toContain(type)
        }
      }
    })

    it('keeps nativeSelect out of web and present on mobile platforms', () => {
      registerAllActions(registry)

      expect(typesFor(registry, 'web')).not.toContain('nativeSelect')
      expect(typesFor(registry, 'android')).toContain('nativeSelect')
      expect(typesFor(registry, 'ios')).toContain('nativeSelect')
    })

    it('matches the exposed surface count for each platform', () => {
      registerAllActions(registry)

      for (const platform of platforms) {
        expect(registry.getForPlatform(platform)).toHaveLength(expectedSliceCount(registry, platform))
      }
    })
  })

  describe('getSchema', () => {
    it('returns the schema for a registered tool id', () => {
      registerAllActions(registry)
      const schema = registry.getSchema('web_click')
      expect(schema).toBeDefined()
      const result = schema.safeParse({ ref: 'e1' })
      expect(result.success).toBe(true)
    })

    it('throws for unknown tool', () => {
      expect(() => registry.getSchema('nonexistent')).toThrow()
    })
  })

  describe('keypress schema shape (phase 137)', () => {
    it('accepts { keys: ["Enter"] } with default convertPlatformKeys=true', () => {
      registerAllActions(registry)
      const schema = registry.getSchema('common_keypress')
      const result = schema.safeParse({ keys: ['Enter'] })
      expect(result.success).toBe(true)
      if (result.success) {
        const data = result.data as { keys: string[]; convertPlatformKeys: boolean }
        expect(data.keys).toEqual(['Enter'])
        expect(data.convertPlatformKeys).toBe(true)
      }
    })

    it('accepts combo strings with "+" separators', () => {
      registerAllActions(registry)
      const schema = registry.getSchema('common_keypress')
      const result = schema.safeParse({ keys: ['Meta+k', 'Control+Shift+T'] })
      expect(result.success).toBe(true)
    })

    it('accepts explicit convertPlatformKeys=false', () => {
      registerAllActions(registry)
      const schema = registry.getSchema('common_keypress')
      const result = schema.safeParse({ keys: ['Meta+k'], convertPlatformKeys: false })
      expect(result.success).toBe(true)
      if (result.success) {
        const data = result.data as { convertPlatformKeys: boolean }
        expect(data.convertPlatformKeys).toBe(false)
      }
    })

    it('REJECTS empty keys array (min 1)', () => {
      registerAllActions(registry)
      const schema = registry.getSchema('common_keypress')
      const result = schema.safeParse({ keys: [] })
      expect(result.success).toBe(false)
    })

    it('REJECTS old { key: "Enter" } shape (breaking change)', () => {
      registerAllActions(registry)
      const schema = registry.getSchema('common_keypress')
      const result = schema.safeParse({ key: 'Enter' })
      expect(result.success).toBe(false)
    })
  })

  describe('generateDocs', () => {
    it('produces web docs from the web slice', () => {
      registerAllActions(registry)
      const docs = registry.generateDocs('web')
      expect(docs).toMatch(/^- web_click:/m)
      expect(docs).toMatch(/^- web_hover:/m)
      expect(docs).toMatch(/^- web_readConsoleLogs:/m)
      expect(docs).toMatch(/^- common_keypress:/m)
      expect(docs).not.toMatch(/^- mobile_tap:/m)
      expect(docs).not.toMatch(/^- mobile_swipe:/m)
      expect(docs).not.toMatch(/^- common_executeScript:/m)
    })

    it('returns all 43 registered actions when no platform is specified', () => {
      registerAllActions(registry)
      const docs = registry.generateDocs()
      const lines = docs.split('\n').filter(l => l.startsWith('- '))
      expect(lines).toHaveLength(43)
    })

    it('keeps generated docs platform availability aligned for nativeSelect', () => {
      registerAllActions(registry)
      const webLines = registry.generateDocs('web').split('\n').filter(l => l.startsWith('- '))
      const androidLines = registry.generateDocs('android').split('\n').filter(l => l.startsWith('- '))
      const iosLines = registry.generateDocs('ios').split('\n').filter(l => l.startsWith('- '))

      expect(webLines).toHaveLength(expectedSliceCount(registry, 'web'))
      expect(androidLines).toHaveLength(expectedSliceCount(registry, 'android'))
      expect(iosLines).toHaveLength(expectedSliceCount(registry, 'ios'))
      expect(registry.generateDocs('web')).not.toMatch(/^- mobile_nativeSelect:/m)
      expect(registry.generateDocs('android')).toMatch(/^- mobile_nativeSelect:/m)
      expect(registry.generateDocs('ios')).toMatch(/^- mobile_nativeSelect:/m)
    })

    it('includes param descriptions', () => {
      registerAllActions(registry)
      const docs = registry.generateDocs()
      expect(docs).toContain('Params:')
      expect(docs).toContain('ref')
    })
  })
})

describe('toolCallToActionPlan', () => {
  it('emits the bare action type for a web tool id', () => {
    const registry = new ToolRegistry()
    registerAllActions(registry)

    const result = toolCallToActionPlan('web_click', {
      ref: 'e1',
      reasoning: 'x',
      confidence: 1,
      stepComplete: true,
    }, registry)

    expect(result.action.type).toBe('click')
  })

  it('emits the bare action type for a mobile tool id', () => {
    const registry = new ToolRegistry()
    registerAllActions(registry)

    const result = toolCallToActionPlan('mobile_tap', {
      ref: 'e1',
      reasoning: 'x',
      confidence: 1,
      stepComplete: true,
    }, registry)

    expect(result.action.type).toBe('tap')
  })
})

describe('surface + id integrity', () => {
  it('registers exactly 46 action tools', () => {
    const registry = new ToolRegistry()
    registerAllActions(registry)
    const all = registry.getAll()
    expect(all).toHaveLength(46)
  })

  it('every action has category "action"', () => {
    const registry = new ToolRegistry()
    registerAllActions(registry)
    const all = registry.getAll()
    expect(all.every(t => t.category === 'action')).toBe(true)
  })

  it('every registered definition has a surface and matching id', () => {
    const registry = new ToolRegistry()
    registerAllActions(registry)
    const all = registry.getAll()

    expect(all.every(d => d.surface)).toBe(true)
    expect(all.every(d => d.id === `${d.surface}_${d.type}`)).toBe(true)
  })

  it('each action schema keeps plan metadata out of registry args', () => {
    const registry = new ToolRegistry()
    registerAllActions(registry)
    for (const def of registry.getAll()) {
      for (const shape of schemaShapes(def.schema)) {
        if (def.id === 'mobile_swipe') {
          expect(shape).toHaveProperty('type')
        } else {
          expect(shape).not.toHaveProperty('type')
        }
        expect(shape).not.toHaveProperty('reasoning')
        expect(shape).not.toHaveProperty('confidence')
        expect(shape).not.toHaveProperty('stepComplete')
        expect(shape).not.toHaveProperty('visualCheck')
      }
    }
  })

  it('click schema has ref field', () => {
    const registry = new ToolRegistry()
    registerAllActions(registry)
    const clickSchema = registry.getSchema('web_click') as z.ZodObject<any>
    expect(clickSchema.shape).toHaveProperty('ref')
  })

  it('fill schemas have ref, text, clearMode, and submit fields', () => {
    const registry = new ToolRegistry()
    registerAllActions(registry)
    const webFillSchema = registry.getSchema('web_fill') as z.ZodObject<any>
    const mobileFillSchema = registry.getSchema('mobile_fill') as z.ZodObject<any>
    expect(webFillSchema).toBe(mobileFillSchema)
    expect(webFillSchema.shape).toHaveProperty('ref')
    expect(webFillSchema.shape).toHaveProperty('text')
    expect(webFillSchema.shape).toHaveProperty('clearMode')
    expect(webFillSchema.shape).toHaveProperty('submit')
    expect(webFillSchema.shape).not.toHaveProperty('value')
    expect(mobileFillSchema.shape).toHaveProperty('ref')
    expect(mobileFillSchema.shape).toHaveProperty('text')
    expect(mobileFillSchema.shape).toHaveProperty('clearMode')
    expect(mobileFillSchema.shape).toHaveProperty('submit')
    expect(mobileFillSchema.shape).not.toHaveProperty('value')
  })

  it('scroll schema validates discriminated mode variants', () => {
    const registry = new ToolRegistry()
    registerAllActions(registry)
    const scrollSchema = registry.getSchema('common_scroll') as z.ZodType
    expect(scrollSchema.safeParse({ mode: 'direction', direction: 'down' }).success).toBe(true)
    expect(scrollSchema.safeParse({ mode: 'untilVisible', target: 'Submit' }).success).toBe(true)
    expect(scrollSchema.safeParse({ scrollType: 'vertical', value: 500 }).success).toBe(false)
  })

  it('pinch schema has scale, optional x, y, ref', () => {
    const registry = new ToolRegistry()
    registerAllActions(registry)
    const pinchSchema = registry.getSchema('mobile_pinch') as z.ZodObject<any>
    expect(pinchSchema.shape).toHaveProperty('scale')
    expect(pinchSchema.shape).toHaveProperty('x')
    expect(pinchSchema.shape).toHaveProperty('y')
    expect(pinchSchema.shape).toHaveProperty('ref')
  })

  it('executeScript is not registered as a planner-facing tool', () => {
    const registry = new ToolRegistry()
    registerAllActions(registry)
    expect(registry.get('common_executeScript')).toBeUndefined()
  })
})
