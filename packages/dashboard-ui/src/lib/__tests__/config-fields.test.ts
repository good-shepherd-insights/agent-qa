// THE FIELD HELPERS (429-17 Task 1 · research A1, Pitfall 1 · 424 note 27).
//
// Five schema blocks require every sibling (plus use.browser.viewport, whose width and height are
// both required once it exists). A leaf-only write into one of them while it is absent would
// always fail validation, so the write carries the required siblings at the defaults the fields
// show as placeholders, and nothing optional.

import type { ConfigChange } from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'

import { DURATION_INPUT_ERROR } from '../config-copy'
import {
  REQUIRED_SIBLING_BLOCKS,
  completeRequiredSiblings,
  listToText,
  parseDurationInput,
  textToList,
} from '../config-fields'

// Verified against core/src/schema/primitives.ts (TimeoutConfigSchema, BrowserConfigSchema and its
// viewport, PlannerConfigSchema, LogCaptureConfigSchema) and core/src/schema/services-schema.ts
// (CacheConfigSchema). dashboard-ui cannot import core, so the required keys are pinned here.
const SCHEMA_REQUIRED_KEYS: Record<string, readonly string[]> = {
  'use.timeout': ['step', 'test', 'navigation'],
  'use.planner': ['maxSubActions', 'previousStepCount'],
  'use.logCapture': ['console', 'network'],
  'use.browser': ['name', 'headless'],
  'use.browser.viewport': ['width', 'height'],
  'services.cache': ['dir', 'ttl'],
}

const BLOCKS: Readonly<Record<string, Readonly<Record<string, unknown>>>> = REQUIRED_SIBLING_BLOCKS

const SCHEMA_OPTIONAL_KEYS: Record<string, readonly string[]> = {
  'use.browser': ['viewport'],
}

function set(path: string[], value: unknown): ConfigChange {
  return { op: 'set', path, value }
}

function added(changes: readonly ConfigChange[], result: readonly ConfigChange[]) {
  return result.slice(changes.length)
}

describe('completeRequiredSiblings', () => {
  it('SIBLING-COMPLETION: a set into an absent use.timeout carries test and navigation at their shown defaults', () => {
    const changes = [set(['use', 'timeout', 'step'], '45s')]
    const result = completeRequiredSiblings(changes, { use: { browser: { name: 'chromium', headless: true } } })

    expect(result.slice(0, 1)).toEqual(changes)
    expect(added(changes, result)).toEqual([
      set(['use', 'timeout', 'test'], '10m'),
      set(['use', 'timeout', 'navigation'], '10s'),
    ])
  })

  it('SIBLING-COMPLETION: a present block, an unset, or a sibling already in the write adds nothing more', () => {
    const present = [set(['use', 'timeout', 'step'], '45s')]
    expect(completeRequiredSiblings(present, { use: { timeout: { step: '30s' } } })).toEqual(present)

    const unset: ConfigChange[] = [{ op: 'unset', path: ['use', 'timeout', 'step'] }]
    expect(completeRequiredSiblings(unset, {})).toEqual(unset)

    const both = [set(['use', 'timeout', 'step'], '45s'), set(['use', 'timeout', 'test'], '20m')]
    expect(added(both, completeRequiredSiblings(both, {}))).toEqual([set(['use', 'timeout', 'navigation'], '10s')])

    const outside = [set(['workspace', 'envFile'], '.env')]
    expect(completeRequiredSiblings(outside, {})).toEqual(outside)
  })

  it('SIBLING-COMPLETION: a viewport leaf in an absent browser block completes both blocks, never the whole viewport', () => {
    const changes = [set(['use', 'browser', 'viewport', 'width'], 1440)]
    expect(added(changes, completeRequiredSiblings(changes, {}))).toEqual([
      set(['use', 'browser', 'name'], 'chromium'),
      set(['use', 'browser', 'headless'], true),
      set(['use', 'browser', 'viewport', 'height'], 720),
    ])
  })

  it('OPTIONAL-SIBLINGS-OMITTED: every block adds exactly the schema\'s required keys and never an optional one', () => {
    expect(Object.keys(REQUIRED_SIBLING_BLOCKS).sort()).toEqual(Object.keys(SCHEMA_REQUIRED_KEYS).sort())

    for (const [block, required] of Object.entries(SCHEMA_REQUIRED_KEYS)) {
      expect(Object.keys(BLOCKS[block]!), block).toEqual([...required])
      const blockPath = block.split('.')
      for (const key of required) {
        const changes = [set([...blockPath, key], BLOCKS[block]![key])]
        const extra = added(changes, completeRequiredSiblings(changes, {}))
        const inBlock = extra
          .filter((change) => change.path.length === blockPath.length + 1)
          .filter((change) => blockPath.every((segment, index) => change.path[index] === segment))
        expect(inBlock.map((change) => change.path.at(-1)), `${block}.${key}`).toEqual(
          required.filter((other) => other !== key),
        )
        for (const optional of SCHEMA_OPTIONAL_KEYS[block] ?? []) {
          expect(extra.some((change) => change.path.includes(optional)), `${block}.${optional}`).toBe(false)
        }
      }
    }
  })
})

describe('parseDurationInput', () => {
  it('DURATION-PARSE: 30s, 5m and 1h parse; 30 seconds and 123 refuse with the field\'s reason', () => {
    expect(parseDurationInput('30s')).toEqual({ valid: true, value: '30s' })
    expect(parseDurationInput('5m')).toEqual({ valid: true, value: '5m' })
    expect(parseDurationInput('1h')).toEqual({ valid: true, value: '1h' })
    expect(parseDurationInput(' 7d ')).toEqual({ valid: true, value: '7d' })
    expect(parseDurationInput('30 seconds')).toEqual({ valid: false, error: DURATION_INPUT_ERROR })
    expect(parseDurationInput('123')).toEqual({ valid: false, error: DURATION_INPUT_ERROR })
    expect(parseDurationInput('-5s')).toEqual({ valid: false, error: DURATION_INPUT_ERROR })
  })
})

describe('listToText and textToList', () => {
  it('LIST-TEXT: a list reads one item per line, and blank lines are dropped on the way back', () => {
    expect(listToText(['tests/**/*.yaml', 'e2e/**/*.yaml'])).toBe('tests/**/*.yaml\ne2e/**/*.yaml')
    expect(listToText(undefined)).toBe('')
    expect(textToList('tests/**/*.yaml\n\n  e2e/**/*.yaml  \n')).toEqual(['tests/**/*.yaml', 'e2e/**/*.yaml'])
    expect(textToList('\n \n')).toEqual([])
  })
})
