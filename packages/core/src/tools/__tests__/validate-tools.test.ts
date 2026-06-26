import { z } from 'zod'
import type { Surface } from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'
import { ToolRegistry } from '../registry.js'
import { registerAllActions } from '../actions/index.js'
import { NON_EXPOSED, VERB_SURFACE } from '../actions/surface-map.js'
import type { ToolDefinition } from '../types.js'

const legalSurfaces = new Set<Surface>(['web', 'mobile', 'android', 'ios', 'common'])
const platforms = ['web', 'android', 'ios'] as const

const registry = new ToolRegistry()
registerAllActions(registry)
const defs = registry.getAll()

function fixtureTool(overrides: Record<string, unknown> = {}): ToolDefinition {
  return {
    id: 'mobile_tap',
    type: 'tap',
    surface: 'mobile',
    exposed: true,
    description: 'fixture tool',
    category: 'action',
    schema: z.object({}).strict(),
    ...overrides,
  } as ToolDefinition
}

function findSurfaceIdOffenders(toolDefs: readonly ToolDefinition[]): string[] {
  const offenders: string[] = []

  for (const def of toolDefs) {
    const surface = def.surface as string
    if (!surface || !legalSurfaces.has(surface as Surface)) {
      offenders.push(`${def.id}: invalid surface "${surface}"`)
      continue
    }

    const expectedId = `${surface}_${def.type}`
    if (def.id !== expectedId) {
      offenders.push(`${def.id}: expected id "${expectedId}" for ${surface}/${def.type}`)
    }
  }

  return offenders
}

function findVerbSurfaceBijectionOffenders(
  toolDefs: readonly ToolDefinition[],
  verbSurface: Record<string, string>,
): string[] {
  const offenders: string[] = []
  const registeredTypes = new Set(toolDefs.map(def => def.type))
  const mappedTypes = new Set(Object.keys(verbSurface))

  for (const type of registeredTypes) {
    if (!mappedTypes.has(type)) {
      offenders.push(`${type}: registered type missing from VERB_SURFACE`)
    }
  }

  for (const type of mappedTypes) {
    if (!registeredTypes.has(type)) {
      offenders.push(`${type}: VERB_SURFACE key missing from registry`)
    }
  }

  for (const [type, surface] of Object.entries(verbSurface)) {
    if (!legalSurfaces.has(surface as Surface)) {
      offenders.push(`${type}: illegal surface "${surface}"`)
    }
  }

  return offenders
}

const allowedToolKeys = new Set([
  'id',
  'type',
  'surface',
  'exposed',
  'description',
  'category',
  'schema',
  'destructive',
  'readOnly',
])

function findForbiddenKeyOffenders(toolDefs: readonly ToolDefinition[]): string[] {
  const offenders: string[] = []

  for (const def of toolDefs) {
    for (const key of Object.keys(def)) {
      if (!allowedToolKeys.has(key)) {
        offenders.push(`${def.id}: forbidden ToolDefinition key "${key}"`)
      }
    }
  }

  return offenders
}

function findNonExposedOffenders(nonExposed: ReadonlySet<string>): string[] {
  return [...nonExposed].map(type => `${type}: NON_EXPOSED must stay empty`)
}

function findHiddenPlannerToolOffenders(
  toolDefs: readonly ToolDefinition[],
  platformToolDefs: readonly (readonly ToolDefinition[])[],
): string[] {
  const exposedIds = new Set(
    toolDefs
      .filter(def => def.exposed !== false)
      .map(def => def.id),
  )
  const platformIds = new Set(
    platformToolDefs
      .flat()
      .map(def => def.id),
  )
  const offenders: string[] = []

  for (const id of exposedIds) {
    if (!platformIds.has(id)) {
      offenders.push(`${id}: exposed tool missing from every platform slice`)
    }
  }

  for (const id of platformIds) {
    if (!exposedIds.has(id)) {
      offenders.push(`${id}: platform slice exposes a non-exposed tool`)
    }
  }

  return offenders
}

describe('LINT-02', () => {
  it('requires every tool id to match its declared surface and type', () => {
    expect(findSurfaceIdOffenders(defs)).toEqual([])
  })

  it('rejects held-out surface/id mismatches and accepts clean ids', () => {
    expect(findSurfaceIdOffenders([
      fixtureTool({ id: 'web_click', surface: 'mobile', type: 'click' }),
    ])).toEqual([
      'web_click: expected id "mobile_click" for mobile/click',
    ])

    expect(findSurfaceIdOffenders([
      fixtureTool({ id: 'mobile_tap', surface: 'mobile', type: 'tap' }),
    ])).toEqual([])
  })
})

describe('LINT-03', () => {
  it('keeps registered tool types in bijection with VERB_SURFACE keys', () => {
    expect(findVerbSurfaceBijectionOffenders(defs, VERB_SURFACE)).toEqual([])
  })

  it('rejects held-out missing verbs and illegal surface tiers while accepting clean maps', () => {
    const cleanDefs = [fixtureTool({ id: 'mobile_tap', type: 'tap', surface: 'mobile' })]

    expect(findVerbSurfaceBijectionOffenders(cleanDefs, { tap: 'mobile' })).toEqual([])
    expect(findVerbSurfaceBijectionOffenders(cleanDefs, {})).toEqual([
      'tap: registered type missing from VERB_SURFACE',
    ])
    expect(findVerbSurfaceBijectionOffenders(cleanDefs, { tap: 'desktop' })).toEqual([
      'tap: illegal surface "desktop"',
    ])
  })
})

describe('LINT-07', () => {
  it('keeps ToolDefinition metadata on the allowed key set', () => {
    expect(findForbiddenKeyOffenders(defs)).toEqual([])
  })

  it('keeps NON_EXPOSED empty and every exposed tool present in a platform slice', () => {
    expect(findNonExposedOffenders(NON_EXPOSED)).toEqual([])
    expect(findHiddenPlannerToolOffenders(
      defs,
      platforms.map(platform => registry.getForPlatform(platform)),
    )).toEqual([])
  })

  it('rejects held-out hidden planner metadata and accepts clean exposed tools', () => {
    const cleanDef = fixtureTool({ id: 'mobile_tap', type: 'tap', surface: 'mobile' })

    expect(findForbiddenKeyOffenders([cleanDef])).toEqual([])
    expect(findForbiddenKeyOffenders([
      fixtureTool({ id: 'mobile_tap', type: 'tap', surface: 'mobile', tier: 'fast' }),
    ])).toEqual([
      'mobile_tap: forbidden ToolDefinition key "tier"',
    ])

    expect(findNonExposedOffenders(new Set())).toEqual([])
    expect(findNonExposedOffenders(new Set(['launchApp']))).toEqual([
      'launchApp: NON_EXPOSED must stay empty',
    ])

    expect(findHiddenPlannerToolOffenders([cleanDef], [[cleanDef]])).toEqual([])
    expect(findHiddenPlannerToolOffenders([cleanDef], [[]])).toEqual([
      'mobile_tap: exposed tool missing from every platform slice',
    ])
  })
})
