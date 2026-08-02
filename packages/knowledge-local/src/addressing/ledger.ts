// The addressing ledger (Phase 387, ENTY-01 / D-01 / D-02 / D-03 / D-04).
//
// The one DURABLE, never-rebuilt store this phase mints. Everything else 387 builds is a
// projection that a rebuild heals; this file is not, and the difference is the whole reason
// it lives in its own database beside `agent-jobs.db` rather than as a table inside the
// knowledge index. Index tables are rebuildable by law, and rebuilding an ordinal ledger
// would REASSIGN published addresses — `MEM-001` in a CI log from last month would start
// pointing at a different memory (D-02).
//
// Three laws, and each is enforced by the database rather than by discipline:
//
//   append-only    BEFORE DELETE and BEFORE UPDATE triggers on `addresses` abort. Not a
//                  convention about which functions this module exports — a rule that holds
//                  against a future call site, an older binary, and someone at a sqlite3
//                  prompt. The exported surface is open/mint/lookup, and the triggers are
//                  what make that surface's narrowness a property of the data (D-04).
//   never-reuse    ordinals come from `MAX(ordinal) + 1` per kind, and since nothing is ever
//                  deleted that sequence is strictly increasing forever. `UNIQUE(kind,
//                  ordinal)` means a second row could not claim a spent one even if some
//                  future code computed the wrong next value.
//   lost race      mint is one `BEGIN IMMEDIATE` transaction ending in `ON CONFLICT DO
//                  NOTHING` followed by a read-back, so two processes minting the same
//                  (kind, machine-id) simultaneously BOTH return the winner's ordinal and
//                  neither sees a constraint error (the 385 D-02 idiom).
//
// Lease-free, deliberately (D-02). Addressing metadata is not learned knowledge, and the CLI
// has to be able to mint with no daemon running. Nothing here reads the writer lease, and
// nothing on a run/test/bundle CREATION path calls it — minting happens only when something
// SIGHTS an entity (D-01).

import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import {
  formatOrdinalShortId,
  formatSlugShortId,
  isSlugAddressedKind,
} from '@vostride/agent-qa-schema'
import type { EntityKind } from '@vostride/agent-qa-schema'

/**
 * Stamped into `PRAGMA user_version` at creation and checked on every open.
 *
 * Stamp and hard-fail, never migrate — the 385 D-04 convention. The milestone ships nothing
 * between its releases, so a ledger written by another build is a development artifact, and
 * migration machinery for it would be code with no user that everything afterwards has to
 * keep working. Note what this does NOT license: the ROWS are permanent regardless. A version
 * refusal tells an operator to move a stale development file aside; it never rewrites one.
 */
export const ADDRESSING_LEDGER_USER_VERSION = 1

/**
 * Busy timeout for every connection.
 *
 * D-02's story is "any process mints, sqlite arbitrates", which only works if a writer
 * waiting on the write lock retries rather than failing immediately. Matched to the job
 * store's window because the transactions are the same shape and size: retune from observed
 * contention, not from a guess about how many hosts there are.
 */
export const ADDRESSING_LEDGER_BUSY_TIMEOUT_MS = 2000

/** The ledger's own file name under the agent-qa root, beside `agent-jobs.db` (D-02). */
export const ADDRESSING_LEDGER_DB_FILE = 'entity-addresses.db'

/**
 * `BUG-` is RESERVED, not fake (D-03).
 *
 * The kind is in the union, the URI scheme addresses it, and tier (a) parses `BUG-7` as a
 * well-formed reference. What does not exist yet is the issue store behind it, so minting
 * refuses BY NAME rather than handing out an ordinal for a row nothing will ever back. A
 * silently-minted `BUG-001` would be a published address that resolves to nothing, which is
 * the one thing D-04 promises can never happen.
 */
export class BugAddressingNotAvailableError extends Error {
  constructor(readonly machineId: string) {
    super(
      'BUG- addressing is reserved until the issue engine lands (387 D-03). The kind stays '
      + 'in the entity union and the URI scheme so references parse and refuse honestly, '
      + `but no address is minted for ${machineId}.`,
    )
    this.name = 'BugAddressingNotAvailableError'
  }
}

/** A ledger file this build cannot read. Refused before a single schema statement runs. */
export class AddressingLedgerSchemaVersionError extends Error {
  constructor(
    readonly path: string,
    readonly expected: number,
    readonly found: number,
  ) {
    super(
      `The addressing ledger at ${path} is stamped schema version ${String(found)}, but this `
      + `build reads version ${String(expected)}. The ledger is never migrated and never `
      + 'rebuilt (D-02/D-04); move the file aside if it is a development artifact.',
    )
    this.name = 'AddressingLedgerSchemaVersionError'
  }
}

/** A minted address: the durable mapping plus the short-ID it renders as. */
export interface EntityAddress {
  readonly kind: EntityKind
  readonly machineId: string
  /** Present for ordinal-addressed kinds; absent for slug-addressed ones (D-03). */
  readonly ordinal?: number
  readonly shortId: string
  readonly mintedAt: string
}

export interface AddressingLedger {
  /**
   * Assign this machine id its permanent address, or return the one it already has.
   *
   * Idempotent by construction rather than by a caller-side check: the unique index decides,
   * so two processes calling this at the same instant agree, and a caller that forgot to look
   * first cannot create a second address.
   */
  mint(kind: EntityKind, machineId: string): EntityAddress
  /** The address for a machine id, or `undefined` when it has never been sighted. */
  lookup(kind: EntityKind, machineId: string): EntityAddress | undefined
  /** The address a published short-ID names, or `undefined`. Tier (a)'s whole job. */
  lookupByShortId(shortId: string): EntityAddress | undefined
  close(): void
}

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS addresses (
     kind        TEXT    NOT NULL,
     machine_id  TEXT    NOT NULL,
     -- NULL exactly for slug-addressed kinds. sqlite treats NULLs as distinct in a unique
     -- index, so the (kind, ordinal) constraint below still holds for every ordinal kind
     -- while imposing nothing on TGT rows.
     ordinal     INTEGER,
     short_id    TEXT    NOT NULL,
     minted_at   TEXT    NOT NULL,
     UNIQUE (kind, machine_id),
     UNIQUE (kind, ordinal),
     UNIQUE (short_id)
   )`,
  // The append-only law, as a database rule rather than as an exported-surface convention.
  // A source assertion about which functions this module exports is only as strong as the
  // next module that opens the same file; these two are not.
  `CREATE TRIGGER IF NOT EXISTS addresses_are_append_only
     BEFORE DELETE ON addresses
     BEGIN
       SELECT RAISE(ABORT, 'the addressing ledger never deletes an address (387 D-04)');
     END`,
  `CREATE TRIGGER IF NOT EXISTS addresses_are_immutable
     BEFORE UPDATE ON addresses
     BEGIN
       SELECT RAISE(ABORT, 'a minted address never changes (387 D-04)');
     END`,
] as const

export interface OpenAddressingLedgerOptions {
  /** Absolute path to the ledger file, typically `<agentQaRoot>/entity-addresses.db`. */
  readonly path: string
  /** ISO-8601 stamp source. Injected so mint times are deterministic under test. */
  readonly now?: () => string
  readonly timeoutMs?: number
}

function toNumber(value: unknown): number {
  return typeof value === 'bigint' ? Number(value) : Number(value)
}

function rowToAddress(row: Record<string, unknown>): EntityAddress {
  const ordinal = row.ordinal
  return {
    kind: String(row.kind) as EntityKind,
    machineId: String(row.machine_id),
    ...(ordinal === null || ordinal === undefined ? {} : { ordinal: toNumber(ordinal) }),
    shortId: String(row.short_id),
    mintedAt: String(row.minted_at),
  }
}

export function openAddressingLedger(options: OpenAddressingLedgerOptions): AddressingLedger {
  const now = options.now ?? (() => new Date().toISOString())

  mkdirSync(dirname(options.path), { recursive: true })
  const db = new DatabaseSync(options.path, {
    timeout: options.timeoutMs ?? ADDRESSING_LEDGER_BUSY_TIMEOUT_MS,
  })
  db.exec('PRAGMA journal_mode=WAL')

  // Read BEFORE any schema statement runs, so a file this build cannot read is not touched on
  // its way to being refused. A hard fail that had already created a table would be a
  // migration nobody wrote — against the one store in the system that must never be rewritten.
  const stamped = toNumber(db.prepare('PRAGMA user_version').get()?.user_version)
  if (stamped !== 0 && stamped !== ADDRESSING_LEDGER_USER_VERSION) {
    db.close()
    throw new AddressingLedgerSchemaVersionError(
      options.path,
      ADDRESSING_LEDGER_USER_VERSION,
      stamped,
    )
  }
  for (const statement of SCHEMA_STATEMENTS) db.exec(statement)
  if (stamped === 0) {
    db.exec(`PRAGMA user_version=${String(ADDRESSING_LEDGER_USER_VERSION)}`)
  }

  // Every statement is parameterized. No SQL in this file is built by concatenating a caller's
  // string, and the two `PRAGMA` statements above are the only interpolations — both of pinned
  // integer constants declared in this module (T-387-01-01).
  const insertAddress = db.prepare(
    `INSERT INTO addresses (kind, machine_id, ordinal, short_id, minted_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (kind, machine_id) DO NOTHING`,
  )
  const selectByKey = db.prepare(
    'SELECT * FROM addresses WHERE kind = ? AND machine_id = ?',
  )
  const selectByShortId = db.prepare('SELECT * FROM addresses WHERE short_id = ?')
  const selectNextOrdinal = db.prepare(
    'SELECT COALESCE(MAX(ordinal), 0) + 1 AS next FROM addresses WHERE kind = ?',
  )

  function inTransaction<T>(body: () => T): T {
    db.exec('BEGIN IMMEDIATE')
    try {
      const result = body()
      db.exec('COMMIT')
      return result
    } catch (error) {
      if (db.isTransaction) db.exec('ROLLBACK')
      throw error
    }
  }

  function readBack(kind: EntityKind, machineId: string): EntityAddress {
    const row = selectByKey.get(kind, machineId)
    if (row === undefined) {
      // Unreachable through the insert-then-read sequence below, and stated as a refusal
      // rather than a non-null assertion because the alternative is a silent `undefined`
      // travelling out as an address.
      throw new Error(`the addressing ledger lost the row it just wrote: ${kind} ${machineId}`)
    }
    return rowToAddress(row)
  }

  return {
    close() {
      db.close()
    },

    mint(kind, machineId) {
      if (kind === 'BUG') throw new BugAddressingNotAvailableError(machineId)
      if (machineId.trim() === '') {
        throw new TypeError(`an empty machine id has no ${kind} address`)
      }

      if (isSlugAddressedKind(kind)) {
        // No ordinal to compute, so no read-modify-write and nothing to serialise: the unique
        // index alone makes this idempotent and race-safe.
        insertAddress.run(kind, machineId, null, formatSlugShortId(kind, machineId), now())
        return readBack(kind, machineId)
      }

      return inTransaction(() => {
        // Inside the transaction, and `BEGIN IMMEDIATE` rather than a deferred begin: the next
        // ordinal is read and then written, and a second writer allowed in between would
        // compute the same number. The write lock is taken at BEGIN, so it cannot be.
        const existing = selectByKey.get(kind, machineId)
        if (existing !== undefined) return rowToAddress(existing)

        const next = toNumber(selectNextOrdinal.get(kind)?.next)
        insertAddress.run(kind, machineId, next, formatOrdinalShortId(kind, next), now())
        // Read back rather than returning what was computed: on the losing side of a
        // cross-process race the insert affected no rows, and the answer is the WINNER's
        // ordinal, not this process's candidate.
        return readBack(kind, machineId)
      })
    },

    lookup(kind, machineId) {
      const row = selectByKey.get(kind, machineId)
      return row === undefined ? undefined : rowToAddress(row)
    },

    lookupByShortId(shortId) {
      const row = selectByShortId.get(shortId)
      return row === undefined ? undefined : rowToAddress(row)
    },
  }
}
