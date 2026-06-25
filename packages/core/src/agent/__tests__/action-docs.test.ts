import { describe, it, expect } from 'vitest'
import type { Platform } from '@vostride/agent-qa-schema'
import { defaultRegistry } from '../../tools/index.js'
import { EXPOSURE } from '../../tools/registry.js'

function actionLines(docs: string): string[] {
  return docs.split('\n').filter((line: string) => line.startsWith('- '))
}

function expectedLineCount(platform: Platform): number {
  const surfaces = EXPOSURE[platform]
  return defaultRegistry.getAll().filter(def => def.exposed !== false && surfaces.has(def.surface)).length
}

describe('defaultRegistry.generateDocs', () => {
  describe('no platform filter (all actions)', () => {
    it('returns a string containing all registered action ids', () => {
      const result = defaultRegistry.generateDocs()

      for (const { id } of defaultRegistry.getAll()) {
        expect(result).toMatch(new RegExp(`^- ${id}:`, 'm'))
      }
    })

    it('contains exactly 35 action lines', () => {
      const result = defaultRegistry.generateDocs()
      expect(actionLines(result)).toHaveLength(35)
    })
  })

  describe('web platform', () => {
    it('includes click and excludes tap', () => {
      const result = defaultRegistry.generateDocs('web')

      expect(result).toMatch(/^- web_click:/m)
      expect(result).not.toMatch(/^- mobile_tap:/m)
    })

    it('includes folded web ids and excludes folded-away ids', () => {
      const result = defaultRegistry.generateDocs('web')

      expect(result).toMatch(/^- web_web_inspect:/m)
      expect(result).toMatch(/^- web_navigate:/m)
      expect(result).toMatch(/^- web_tab:/m)

      for (const id of [
        'web_keyDown',
        'web_keyUp',
        'web_navigateHistory',
        'web_newTab',
        'web_readConsoleLogs',
        'web_readCookies',
        'web_readLocalStorage',
        'web_readNetworkLogs',
        'web_refresh',
        'web_switchTab',
      ]) {
        expect(result).not.toMatch(new RegExp(`^- ${id}:`, 'm'))
      }
    })

    it('excludes mobile interaction ids from the web docs', () => {
      const result = defaultRegistry.generateDocs('web')

      for (const id of [
        'mobile_tap',
        'mobile_doubleTap',
        'mobile_multiTap',
        'mobile_tapCoordinate',
        'mobile_swipe',
        'mobile_longpress',
        'mobile_pinch',
        'mobile_drag',
        'mobile_nativeSelect',
        'mobile_fill',
        'mobile_hideKeyboard',
        'mobile_setOrientation',
      ]) {
        expect(result).not.toMatch(new RegExp(`^- ${id}:`, 'm'))
      }
    })

    it('contains the expected exposed web slice line count', () => {
      const result = defaultRegistry.generateDocs('web')

      expect(expectedLineCount('web')).toBe(22)
      expect(actionLines(result)).toHaveLength(expectedLineCount('web'))
    })
  })

  describe('android platform', () => {
    it('includes tap and excludes click', () => {
      const result = defaultRegistry.generateDocs('android')

      expect(result).toMatch(/^- mobile_tap:/m)
      expect(result).not.toMatch(/^- web_click:/m)
    })

    it('includes mobile and common ids without browser-only ids', () => {
      const result = defaultRegistry.generateDocs('android')

      expect(result).toMatch(/^- mobile_nativeSelect:/m)
      expect(result).toMatch(/^- mobile_fill:/m)
      expect(result).toMatch(/^- common_keypress:/m)
      expect(result).not.toMatch(/^- web_doubleClick:/m)
      expect(result).not.toMatch(/^- web_web_inspect:/m)
      expect(result).not.toMatch(/^- common_executeScript:/m)
    })

    it('contains the expected exposed android slice line count', () => {
      const result = defaultRegistry.generateDocs('android')

      expect(expectedLineCount('android')).toBe(19)
      expect(actionLines(result)).toHaveLength(expectedLineCount('android'))
    })
  })

  describe('ios platform', () => {
    it('includes tap and excludes click', () => {
      const result = defaultRegistry.generateDocs('ios')

      expect(result).toMatch(/^- mobile_tap:/m)
      expect(result).not.toMatch(/^- web_click:/m)
    })

    it('includes mobile and common ids without browser-only ids', () => {
      const result = defaultRegistry.generateDocs('ios')

      expect(result).toMatch(/^- mobile_nativeSelect:/m)
      expect(result).toMatch(/^- mobile_fill:/m)
      expect(result).toMatch(/^- common_keypress:/m)
      expect(result).not.toMatch(/^- web_doubleClick:/m)
      expect(result).not.toMatch(/^- web_web_inspect:/m)
      expect(result).not.toMatch(/^- common_executeScript:/m)
    })

    it('contains the expected exposed ios slice line count', () => {
      const result = defaultRegistry.generateDocs('ios')

      expect(expectedLineCount('ios')).toBe(19)
      expect(actionLines(result)).toHaveLength(expectedLineCount('ios'))
    })
  })

  describe('action line format', () => {
    it('each line contains id, description, and params', () => {
      const result = defaultRegistry.generateDocs()
      expect(result).toMatch(/^- web_fill: .+\. Params: .+/m)
      expect(result).toMatch(/^- mobile_fill: .+\. Params: .+/m)
    })

    it('click action includes ref parameter', () => {
      const result = defaultRegistry.generateDocs()
      expect(result).toMatch(/^- web_click: Click an element\. Params: ref/m)
    })

    it('fill actions include ref and text parameters', () => {
      const result = defaultRegistry.generateDocs()
      expect(result).toMatch(/^- web_fill: .+\. Params: .*ref.*text/m)
      expect(result).toMatch(/^- mobile_fill: .+\. Params: .*ref.*text/m)
    })

    it('nativeSelect action uses its mobile-prefixed line', () => {
      const result = defaultRegistry.generateDocs('android')
      expect(result).toMatch(/^- mobile_nativeSelect: .+\. Params: .*ref.*value/m)
    })

    it('navigate action shows the to param', () => {
      const result = defaultRegistry.generateDocs()
      const line = result.split('\n').find((l: string) => l.startsWith('- web_navigate:'))
      expect(line).toBeDefined()
      expect(line).toContain('Params:')
      expect(line).toContain('to')
    })

    it('scroll action shows mode and ref params', () => {
      const result = defaultRegistry.generateDocs()
      expect(result).toMatch(/^- common_scroll: .+\. Params: .*mode.*ref/m)
    })

    it('doubleClick docs discourage default top-left offsets and no-op delay', () => {
      const result = defaultRegistry.generateDocs('web')
      const line = result.split('\n').find((l: string) => l.startsWith('- web_doubleClick:'))

      expect(line).toBeDefined()
      expect(line).toContain('Do not use { x: 0, y: 0 }')
      expect(line).toContain('Omit when there is no requested delay')
    })
  })
})
