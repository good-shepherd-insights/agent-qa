// Concrete per-product buildOrdinal counter (Phase 361, D-18 / SESSION-05).
//
// A storageImplementation home for node:fs + node:path (the FsActionCache / FsStorageStateStore
// boundary) — this project-local counter fs write lives here, never in the runner. On-disk layout:
//
//   <root>/build-ordinals.json   ({ [product]: number })
//
// D-18 derivation (spec/v2/eval-and-core-types.md §A8): buildOrdinal is a per-product run counter
// incremented at run start. Read → increment the product key → write-temp → atomic same-dir rename.
// The rename is the ONE deliberate step up from a plain writeFile (a reader never observes a
// half-written map); there is NO lockfile / flock machinery. Best-effort semantics: a corrupt or
// missing state file restarts the product at 1 without throwing (D-18). Concurrent same-product
// runs may read the same prior value and share an ordinal. D-15 ratifies that as correct semantics:
// ordinals identify builds, not runs; conflicting observations at one ordinal route to MintUnknown
// through the strictly-greater supersession rule.

import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** The project-local state file holding the per-product ordinal map. */
export const BUILD_ORDINALS_FILE = 'build-ordinals.json'

export interface NextBuildOrdinalOptions {
  /** Runtime root (e.g. DEFAULT_AGENT_QA_DIR = '.agent-qa'). */
  root: string
  /** The product whose counter to advance. */
  product: string
}

export interface BuildOrdinalReservation {
  /** Canonical, sorted, duplicate-free product axes advanced by the reservation. */
  products: readonly string[]
  /** One ordinal strictly later than every affected product's current counter. */
  ordinal: number
}

export type BuildOrdinalReservationErrorCode =
  | 'invalid-state'
  | 'missing-counter'
  | 'invalid-counter'
  | 'counter-exhausted'

/** Typed pre-persistence refusal for an unsafe maintenance ordinal reservation. */
export class BuildOrdinalReservationError extends Error {
  readonly name = 'BuildOrdinalReservationError'

  constructor(
    readonly code: BuildOrdinalReservationErrorCode,
    readonly product: string,
    readonly value?: unknown,
  ) {
    const message =
      code === 'invalid-state'
        ? `${BUILD_ORDINALS_FILE} must contain a JSON object`
        : code === 'missing-counter'
          ? `Missing build ordinal counter for product ${JSON.stringify(product)}`
          : code === 'invalid-counter'
            ? `Build ordinal counter for product ${JSON.stringify(product)} must be a non-negative safe integer`
            : `Build ordinal counter for product ${JSON.stringify(product)} is exhausted`
    super(message)
  }
}

export interface ReserveBuildOrdinalForProductsOptions {
  /** Runtime root containing build-ordinals.json. */
  root: string
  /** Product axes whose counters must advance together. Duplicates and order are ignored. */
  products: Iterable<string>
  /**
   * Synchronous authority fence invoked after the complete temp file is prepared and immediately
   * before the atomic rename. Throwing refuses persistence and removes the temp file.
   */
  beforePersist?: (reservation: BuildOrdinalReservation) => void
}

/** Undefined is the explicit no-op result for an empty affected-product set. */
export type ReserveBuildOrdinalForProductsResult = number | undefined

export async function nextBuildOrdinal(opts: NextBuildOrdinalOptions): Promise<number> {
  const file = join(opts.root, BUILD_ORDINALS_FILE)
  const map = readOrdinals(file)

  const next = (map[opts.product] ?? 0) + 1
  map[opts.product] = next

  // Write-temp then atomic same-dir rename — a reader never sees a partial map (D-18).
  const tmp = `${file}.tmp`
  writeFileSync(tmp, `${JSON.stringify(map)}\n`, 'utf-8')
  renameSync(tmp, file)

  return next
}

/**
 * Reserve one strictly-later maintenance ordinal across every affected product axis.
 *
 * Unlike the best-effort run-start counter above, maintenance reservation is fail-closed: every
 * required counter must already exist and be a non-negative safe integer. The complete map is
 * persisted with one same-directory atomic replacement only after all validation succeeds.
 */
export async function reserveBuildOrdinalForProducts(
  opts: ReserveBuildOrdinalForProductsOptions,
): Promise<ReserveBuildOrdinalForProductsResult> {
  const products = Object.freeze([...new Set(opts.products)].sort())
  if (products.length === 0) return undefined

  const file = join(opts.root, BUILD_ORDINALS_FILE)
  const map = readReservationOrdinals(file, products[0])
  let maximum = 0

  for (const product of products) {
    if (!Object.prototype.hasOwnProperty.call(map, product)) {
      throw new BuildOrdinalReservationError('missing-counter', product)
    }

    const current = map[product]
    if (typeof current !== 'number' || !Number.isSafeInteger(current) || current < 0) {
      throw new BuildOrdinalReservationError('invalid-counter', product, current)
    }
    if (current === Number.MAX_SAFE_INTEGER) {
      throw new BuildOrdinalReservationError('counter-exhausted', product, current)
    }
    maximum = Math.max(maximum, current)
  }

  const ordinal = maximum + 1
  const nextMap: Record<string, unknown> = { ...map }
  for (const product of products) nextMap[product] = ordinal

  const reservation = Object.freeze({ products, ordinal })
  const tmp = `${file}.tmp`
  try {
    writeFileSync(tmp, `${JSON.stringify(nextMap)}\n`, 'utf-8')
    opts.beforePersist?.(reservation)
    renameSync(tmp, file)
  } catch (error) {
    try {
      rmSync(tmp, { force: true })
    } catch {
      // Preserve the persistence/fence refusal as the authority-bearing failure.
    }
    throw error
  }

  return ordinal
}

function readOrdinals(file: string): Record<string, number> {
  let raw: string
  try {
    raw = readFileSync(file, 'utf-8')
  } catch {
    // Missing state ⇒ start fresh (best-effort, D-18).
    return {}
  }
  try {
    const parsed = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object') return {}
    return parsed as Record<string, number>
  } catch {
    // A corrupt/partial state file restarts every product at 1 rather than crashing (D-18).
    return {}
  }
}

function readReservationOrdinals(file: string, firstProduct: string): Record<string, unknown> {
  let raw: string
  try {
    raw = readFileSync(file, 'utf-8')
  } catch {
    throw new BuildOrdinalReservationError('missing-counter', firstProduct)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new BuildOrdinalReservationError('invalid-state', firstProduct)
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new BuildOrdinalReservationError('invalid-state', firstProduct, parsed)
  }
  return parsed as Record<string, unknown>
}
