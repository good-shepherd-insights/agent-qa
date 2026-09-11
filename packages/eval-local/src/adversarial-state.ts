// 422-03-T1 (RED): the durable adversarial refresh-state surface, declared and not yet
// implemented. Every function below returns an inert value so the cells in
// `__tests__/adversarial-recovery.test.ts` fail on the behaviour they name rather than on a
// module that cannot load.

import { createHash } from 'node:crypto'

import { canonicalJson, type AdversarialMutator } from '@vostride/agent-qa-eval'
import type { GuardrailPolicy } from '@vostride/agent-qa-schema'

/** Durable refresh state lives beside the staging tree, never inside it. */
export const ADVERSARIAL_STATE_SUBDIR = 'eval/adversarial-state'

export const ADVERSARIAL_STATE_SCHEMA_VERSION = 1

/** What a completed `(seed, mutator)` tuple resolved to. */
export type AdversarialTupleOutcome = 'derived' | 'refused' | 'inapplicable'

export interface AdversarialRefreshTuple {
  seedCassetteId: string
  mutator: AdversarialMutator
  cassetteId: string
  outcome: AdversarialTupleOutcome
  detail?: string
}

export interface AdversarialSeedCap {
  value: number
  source: 'flag' | 'config' | 'default'
}

export interface AdversarialRefreshRecord {
  schemaVersion: 1
  product: string
  tableVersion: number
  policyDigest: string
  sourceDigest: string
  cap: AdversarialSeedCap
  eligibleSeeds: number
  excessSeeds: number
  seedIds: readonly string[]
  tuples: readonly AdversarialRefreshTuple[]
}

export function computeAdversarialPolicyDigest(policy: GuardrailPolicy): string {
  return createHash('sha256').update(canonicalJson(policy), 'utf8').digest('hex')
}

export function adversarialRefreshRecordDigest(record: AdversarialRefreshRecord): string {
  return createHash('sha256').update(canonicalJson(record), 'utf8').digest('hex')
}

export function resolveAdversarialSeedCap(input: {
  value?: number
  source?: 'flag' | 'config'
}): AdversarialSeedCap {
  void input
  return { value: 25, source: 'default' }
}

export function readAdversarialRefreshRecords(input: {
  agentQaRoot: string
  product: string
}): AdversarialRefreshRecord[] {
  void input
  return []
}

export function publishAdversarialRefreshRecord(input: {
  agentQaRoot: string
  record: AdversarialRefreshRecord
}): 'published' | 'unchanged' {
  void input
  return 'published'
}

export function settledAdversarialTuples(
  records: readonly AdversarialRefreshRecord[],
  scope: { tableVersion: number; policyDigest: string },
): ReadonlySet<string> {
  void records
  void scope
  return new Set<string>()
}

export function derivedAdversarialCassetteIds(
  records: readonly AdversarialRefreshRecord[],
): ReadonlySet<string> {
  void records
  return new Set<string>()
}
