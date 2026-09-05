/**
 * 414 D-05/D-06/D-07 partition manifest — the committed document that makes a
 * product's split assignment reproducible.
 *
 * `assignSplit` is pure, but its answer depends entirely on three parameters:
 * the salt, the held-out fraction and the private fraction. Committing them as
 * a document per product is what turns "which split is this cassette in" from
 * a fact about whoever ran the seeder into a fact anyone can re-derive from
 * the repository alone. A change to any of the three is a named migration of
 * a committed corpus, never a silent re-partition.
 *
 * The salt arrives as DATA. It is minted once per product from 32 random
 * bytes by the seed verb in eval-local/cli — never here (eval core has no
 * randomness), never derived from the product slug (a derived salt is a
 * public salt, and a public salt lets a proposer compute the held-out set),
 * and never operator-supplied.
 *
 * The fractions also arrive as data, from the operator's REQUIRED
 * first-partition flags. D-07 is standing law: a threshold is chosen only
 * after the floor is measured, so no default fraction is authored in this
 * file or anywhere else in src. Every fraction literal in this phase lives in
 * `__tests__` as a vector input.
 *
 * STRICT BY CONSTRUCTION (T-414-14). The manifest is hand-editable committed
 * JSON, so every object is `.strict()`. The salt is pinned to EXACTLY 64
 * lowercase hex characters, which is what keeps the `salt ‖ cassetteId`
 * concatenation `assignSplit` hashes injective — a variable-length salt would
 * let two different (salt, id) pairs concatenate to the same string. The
 * fractions are pinned strictly inside (0, 1): a partition that holds out
 * nothing, or everything, is not a partition.
 *
 * Pure: no IO, no clock, no randomness.
 */
import { z } from 'zod'

import { PARTITION_VERSION, type PartitionParams } from './split-assignment'

/** Single version gate for the partition manifest document (D-05). */
export const PARTITION_MANIFEST_SCHEMA_VERSION = 1 as const

/**
 * One product's committed partition parameters. `partitionVersion` names the
 * ASSIGNMENT ALGORITHM the salt and fractions were used under, so a recipe
 * bump refuses old manifests rather than re-reading them under new rules.
 */
export interface PartitionManifest {
  schemaVersion: typeof PARTITION_MANIFEST_SCHEMA_VERSION
  partitionVersion: typeof PARTITION_VERSION
  product: string
  /** 32 minted bytes as exactly 64 lowercase hex characters. */
  salt: string
  /** Share of the product's cassettes leaving `natural`. Strictly inside (0, 1). */
  heldOutFraction: number
  /** Share OF the held-out portion that is `private`. Strictly inside (0, 1). */
  privateFraction: number
}

const LOWER_HEX_64 = /^[0-9a-f]{64}$/
const saltSchema = z
  .string()
  .regex(LOWER_HEX_64, 'must be exactly 64 lowercase hexadecimal characters')

/** A share of a whole, endpoints excluded — neither 0 nor 1 partitions anything. */
const fractionSchema = z.number().gt(0).lt(1)

export const partitionManifestSchema = z
  .object({
    schemaVersion: z.literal(PARTITION_MANIFEST_SCHEMA_VERSION),
    partitionVersion: z.literal(PARTITION_VERSION),
    product: z.string().min(1),
    salt: saltSchema,
    heldOutFraction: fractionSchema,
    privateFraction: fractionSchema,
  })
  .strict()

function issuePath(path: PropertyKey[]): string {
  return path.length === 0 ? '<root>' : path.map(String).join('.')
}

/** Parse committed manifest bytes into the closed shape, or throw with every issue named. */
export function guardPartitionManifest(value: unknown): PartitionManifest {
  const parsed = partitionManifestSchema.safeParse(value)

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map(issue => `${issuePath(issue.path)}: ${issue.message}`)
      .join('; ')
    throw new TypeError(`partition manifest rejected: ${issues}`)
  }

  return parsed.data
}

/** The four facts a caller must supply; everything else this module stamps. */
export interface ProjectPartitionManifestInput {
  product: string
  /** Minted by the seed verb, handed here as data. */
  saltHex: string
  heldOutFraction: number
  privateFraction: number
}

/**
 * Build the committed document and run it through the guard before returning
 * it, so a projection can never emit bytes the reader would refuse.
 */
export function projectPartitionManifest(
  input: ProjectPartitionManifestInput,
): PartitionManifest {
  return guardPartitionManifest({
    schemaVersion: PARTITION_MANIFEST_SCHEMA_VERSION,
    partitionVersion: PARTITION_VERSION,
    product: input.product,
    salt: input.saltHex,
    heldOutFraction: input.heldOutFraction,
    privateFraction: input.privateFraction,
  })
}

/** Project the manifest into exactly what `assignSplit` takes (one spelling). */
export function partitionParamsOf(manifest: PartitionManifest): PartitionParams {
  return {
    saltHex: manifest.salt,
    heldOutFraction: manifest.heldOutFraction,
    privateFraction: manifest.privateFraction,
  }
}
