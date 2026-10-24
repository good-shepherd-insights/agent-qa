import { actionWireSchema, type Action } from '@vostride/agent-qa-schema'
import type { LeafCassette } from '../cassette/cassette'
import { projectActionSidecar } from '../extract/sidecar-leg'
import type { StandaloneLabelRecord } from './label-record'

export type EffectiveGold =
  | { kind: 'eligible'; cassette: LeafCassette }
  | { kind: 'refused'; reason: 'missing-executable-correction' | 'invalid-executable-correction' | 'label-identity-mismatch' }

/** A scoring-only view. Never pass its corrected sidecar to a replay planner or persist it. */
export function effectiveGold(cassette: LeafCassette, record?: StandaloneLabelRecord): EffectiveGold {
  if (record === undefined) return { kind: 'eligible', cassette }
  if (record.cassetteId !== cassette.id) return { kind: 'refused', reason: 'label-identity-mismatch' }
  const labeled = { ...cassette, label: record.label }
  if (record.correction === undefined) return { kind: 'eligible', cassette: labeled }
  if (record.correction.correctedAction === undefined) return { kind: 'refused', reason: 'missing-executable-correction' }
  const parsed = actionWireSchema.safeParse(record.correction.correctedAction)
  if (!parsed.success) return { kind: 'refused', reason: 'invalid-executable-correction' }
  const { leg, anchorUnresolved } = projectActionSidecar(parsed.data as Action, cassette.input.stateBefore,
    cassette.sidecar.annotation)
  if (anchorUnresolved) return { kind: 'refused', reason: 'invalid-executable-correction' }
  return { kind: 'eligible', cassette: { ...labeled, sidecar: leg } }
}
