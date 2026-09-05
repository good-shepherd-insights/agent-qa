/**
 * Deterministic corpus split assignment (414 D-05/D-07/D-08) — the ONE
 * primitive that decides which split a cassette belongs to.
 *
 * The recipe, versioned as PARTITION_VERSION 1:
 *   bucket = parseInt(sha256hex(saltHex ‖ cassetteId).slice(0, 13), 16)
 * read as a 52-bit integer, compared against INTEGER thresholds derived
 * once from the manifest's fractions:
 *   heldOutThreshold = Math.round(heldOutFraction * 2 ** 52)
 *   privateThreshold = Math.round(heldOutFraction * privateFraction * 2 ** 52)
 * `bucket >= heldOutThreshold` is natural; otherwise held-out, private iff
 * `bucket < privateThreshold`.
 *
 * Integer thresholds rather than float comparison of `bucket / 2 ** 52`
 * because a partition must be reproducible: an integer comparison has one
 * answer on every platform, and a boundary case is testable exactly.
 *
 * Changing ANY of that — the digest, the prefix width, the nesting of the
 * private threshold — is a change of PARTITION_VERSION and therefore a
 * named migration of a committed corpus, never a silent re-partition.
 *
 * Purity law: no clock, no randomness, no node digest module. The digest
 * comes from the schema package's pure-JS `sha256hex` (the
 * `silver-sampling.ts` precedent), which is what eval core's module
 * discipline leaves available to it.
 *
 * D-07 (standing law: a threshold is chosen only after the floor is
 * measured): there is NO default fraction in this file and there must never
 * be one. Fractions arrive as DATA — from a committed partition manifest, or
 * from the operator's required first-partition flags. The only fraction
 * literals in this phase live in __tests__ as vector inputs.
 *
 * D-08: a self-heal pair member is the recovery signal the proposer learns
 * from, so it is exempt from bucketing and stays natural regardless of its
 * hash. The exemption is named here, checked before the hash is even read,
 * and pinned by its own cell against the counterfactual.
 */
import { sha256hex } from '@vostride/agent-qa-schema'
import type { SplitAssignment } from './corpus-entry'

/**
 * Version of the assignment ALGORITHM (not of any manifest document). A
 * bump means every previously assigned split must be re-derived by a
 * reviewed migration.
 */
export const PARTITION_VERSION = 1 as const

/** Width of the bucket space: the first 13 hex characters of the digest. */
export const BUCKET_BITS = 52

const LOWER_HEX_64 = /^[0-9a-f]{64}$/

/** The committed partition parameters, supplied as data (D-05/D-07). */
export interface PartitionParams {
  /** 32 random bytes, lowercase hex, minted once per product and committed. */
  saltHex: string
  /** Share of a product's cassettes leaving `natural`. Strictly inside (0, 1). */
  heldOutFraction: number
  /** Share OF the held-out portion that is `private`. Strictly inside (0, 1). */
  privateFraction: number
}

export interface AssignSplitInput extends PartitionParams {
  cassetteId: string
  /** D-08: a self-heal pair member is never bucketed. */
  isPairMember: boolean
}

/** The 52-bit bucket for one cassette under one salt (PARTITION_VERSION 1). */
export function bucketOf(saltHex: string, cassetteId: string): number {
  return Number.parseInt(sha256hex(saltHex + cassetteId).slice(0, 13), 16)
}

function requireSalt(saltHex: string): void {
  if (!LOWER_HEX_64.test(saltHex)) {
    throw new TypeError(
      `partition salt must be 64 lowercase hex characters (got ${saltHex.length} chars)`,
    )
  }
}

function requireFraction(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0 || value >= 1) {
    throw new TypeError(`${name} must be a finite number strictly inside (0, 1) (got ${value})`)
  }
}

/**
 * Assign one cassette to its split. Never returns `adversarial` — generated
 * entries are minted by 422's generators with their own provenance, not
 * bucketed out of the natural population.
 *
 * Throws `TypeError` on a malformed salt or an out-of-range fraction: by the
 * time a value reaches this function it came from a guarded manifest or from
 * validated flags, so a violation here is a CALLER bug, not untrusted data.
 * The data gate for a manifest document lives in `partition-manifest.ts`.
 */
export function assignSplit(
  input: AssignSplitInput,
): Extract<SplitAssignment, { split: 'natural' } | { split: 'held-out' }> {
  requireSalt(input.saltHex)
  requireFraction('heldOutFraction', input.heldOutFraction)
  requireFraction('privateFraction', input.privateFraction)

  if (input.isPairMember) return { split: 'natural' }

  const bucket = bucketOf(input.saltHex, input.cassetteId)
  const heldOutThreshold = Math.round(input.heldOutFraction * 2 ** BUCKET_BITS)
  if (bucket >= heldOutThreshold) return { split: 'natural' }

  const privateThreshold = Math.round(
    input.heldOutFraction * input.privateFraction * 2 ** BUCKET_BITS,
  )
  return {
    split: 'held-out',
    heldOutVisibility: bucket < privateThreshold ? 'private' : 'shared',
  }
}
