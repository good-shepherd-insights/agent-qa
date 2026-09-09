import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { canonicalJson, guardTrustPriorTable, ORIGIN_PRIORS, type TrustPriorTable } from '@vostride/agent-qa-schema'

/** Neutral fold identity: omitted origins have exactly the provisional meaning. */
export function effectivePriorDigest(priors?: TrustPriorTable): string {
  const table = priors === undefined ? undefined : guardTrustPriorTable(priors)
  return createHash('sha256').update(canonicalJson({ ...ORIGIN_PRIORS, ...table })).digest('hex')
}

/** Call inside the same read transaction as the numerical index selection. */
export function indexTrustEpochMatches(db: DatabaseSync, digest: string): boolean {
  return db.prepare("SELECT v FROM meta WHERE k = 'trust_prior_digest'").get()?.v === digest
    && db.prepare('SELECT 1 FROM records WHERE trust_prior_digest != ? LIMIT 1').get(digest) === undefined
}

export class TrustPriorEpochMismatch extends Error {
  constructor() { super('index trust epoch differs from the host snapshot') }
}
