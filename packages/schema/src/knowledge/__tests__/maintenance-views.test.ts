import { describe, expect, it } from 'vitest'

import * as knowledge from '../index.js'

type Schema<T> = {
  parse(value: unknown): T
}

type MaintenanceViewsModule = {
  RecordChangeSchema: Schema<unknown>
  InspectFilterSchema: Schema<unknown>
  guardInspectRecordView(value: unknown): unknown
}

function maintenanceViews(): MaintenanceViewsModule {
  const exports = knowledge as unknown as Partial<MaintenanceViewsModule>

  expect(exports.RecordChangeSchema, 'RecordChangeSchema export').toBeDefined()
  expect(exports.InspectFilterSchema, 'InspectFilterSchema export').toBeDefined()
  expect(exports.guardInspectRecordView, 'guardInspectRecordView export').toBeDefined()

  return exports as MaintenanceViewsModule
}

describe('maintenance view contracts', () => {
  it.each([
    'added',
    'confirmed',
    'superseded',
    'deprecated',
    'promoted',
    'purged',
  ] as const)('accepts the %s record-change kind', (change) => {
    const { RecordChangeSchema } = maintenanceViews()

    expect(RecordChangeSchema.parse({
      schemaVersion: 1,
      recordId: 'record-1',
      change,
      atOrdinal: 42,
      ...(change === 'superseded' ? { byRecordId: 'record-2' } : {}),
    })).toMatchObject({ change })
  })

  it('rejects an unknown record-change kind', () => {
    const { RecordChangeSchema } = maintenanceViews()

    expect(() => RecordChangeSchema.parse({
      schemaVersion: 1,
      recordId: 'record-1',
      change: 'mutated',
      atOrdinal: 42,
    })).toThrow()
  })

  it('accepts an empty inspect filter and rejects unknown dimensions', () => {
    const { InspectFilterSchema } = maintenanceViews()

    expect(InspectFilterSchema.parse({})).toEqual({})
    expect(() => InspectFilterSchema.parse({ query: 'free text' })).toThrow()
  })

  it('round-trips a valid inspect view and rejects a wrong schema version', () => {
    const { guardInspectRecordView } = maintenanceViews()
    const view = {
      schemaVersion: 1,
      recordId: 'record-1',
      product: 'shop',
      scope: 'product:shop',
      kind: 'fact',
      status: 'active',
      confirmations: 2,
      contradictions: 1,
      evidenceTokens: ['evidence-1'],
      lastEventOrdinal: 42,
      openedAtOrdinal: 10,
      closedAtOrdinal: 50,
      anchors: ['page:/checkout'],
      trustNarrative: 'Observed twice during checkout.',
    }

    expect(guardInspectRecordView(view)).toEqual(view)
    expect(() => guardInspectRecordView({ ...view, schemaVersion: 2 })).toThrow()
  })
})
