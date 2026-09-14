import { CurationSnapshotSchema, type CurationSnapshot, type CurationSnapshotChange } from '@vostride/agent-qa-schema'

export interface ReadCurationEffectsOptions {
  knowledgeRoot: string
  sourceRunId: string
  observationIds?: readonly string[]
}

// Structural bootstrap for assertion-based RED; classification is not implemented yet.
export function readCurationEffects(_options: ReadCurationEffectsOptions): CurationSnapshotChange[] {
  return []
}

export function foldCurationSnapshot(_effects: readonly CurationSnapshotChange[]): CurationSnapshot {
  return CurationSnapshotSchema.parse({ schemaVersion: 1, rows: [],
    breakdown: { added: 0, confirmed: 0, superseded: 0, deprecated: 0, proposed: 0 } })
}
