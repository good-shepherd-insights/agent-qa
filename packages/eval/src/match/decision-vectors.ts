import { z } from 'zod'
import type { DecisionCorrectnessVector } from '../stats/decision-vector'
import type { ScoredBatchEntry } from './metrics'

export function decisionCorrectnessVectors(
  _entries: readonly ScoredBatchEntry[],
  _partitionsById?: ReadonlyMap<string, string>,
): DecisionCorrectnessVector[] {
  throw new Error('RED: decision vectors are not implemented')
}

export const DECISION_VECTORS_SCHEMA_VERSION = 1 as const

export interface DecisionVectorsDocument {
  schemaVersion: 1
  batchKey: string
  matcherVersion: number
  vectors: readonly DecisionCorrectnessVector[]
}

export const decisionVectorsDocumentSchema = z.never()

export function guardDecisionVectorsDocument(
  _value: unknown,
): { kind: 'ok'; document: DecisionVectorsDocument } | { kind: 'rejected'; reason: string } {
  throw new Error('RED: decision document guard is not implemented')
}

export function projectDecisionVectorsDocument(input: {
  batchKey: string
  matcherVersion: number
  vectors: readonly DecisionCorrectnessVector[]
}): DecisionVectorsDocument {
  throw new Error('RED: decision document projection is not implemented')
}
