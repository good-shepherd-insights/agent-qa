// RED-first pins for the three quarantine verbs' implementation (Phase 390, D-11/D-12/D-13).
//
// `createQuarantineOperations` is where FLAK-03's list/release/add stop being contracts and start
// being behaviour over the committed ledger. Four properties carry the weight here:
//
//  1. THE TRIAGE ORDER IS THE VERB'S LAW (D-12). Unassigned entries first — they are the queue a
//     human works — then `enteredAt` ascending, ties broken on identity bytes. The corpus below is
//     built so that a naive implementation differs at EVERY level: the fold's own iteration order
//     is `C, A, E, D, B, F` and the answer is `A, D, E, B, F, C`. Dropping unassigned-first, or
//     sorting on the FIRST entered event instead of the folded entry, or losing the identity
//     tie-break each produce a different sequence.
//  2. RE-ENTRY IS THE INTENDED RECORD, NOT DUPLICATION (390-05). An entry that was released and
//     crossed again carries several `entered` events; the fold answers ONE row whose `enteredAt` is
//     the latest one, and the ordering reads that row.
//  3. WALL-CLOCK PURITY BY ARGUMENT (390-01, extended to serving by 390-03). `now` is REQUIRED and
//     injected; this module reads no clock, asserted by a source scan, and each verb reads the
//     injected clock exactly ONCE so two reads can never straddle one deadline.
//  4. COMMITTED-TRUTH READ POSTURE. An unreadable ledger PROPAGATES its typed error from every
//     verb. Healing it to "nothing is quarantined" would silently un-quarantine every entry in the
//     file, which is the one silent flip this phase exists to prevent.
//  5. SERIALIZATION IS THIS MODULE'S, NOT ITS CALLER'S (390-09 / CR-03). The write verbs run their
//     whole read-fold-decide-append cycle inside the MRSW writer lease they take themselves, or
//     inside a handed-in `writerAuthority` when this process already holds it (the daemon). The
//     pins below drive BOTH directions — a verb that acquires leaves the epoch bumped and no lease
//     residue, and a verb meeting a lease somebody else holds refuses typed with the ledger BYTE
//     for byte unchanged. The refusing direction is the load-bearing one: the same call appends a
//     line two tests above, so zero bytes is a measurement rather than an absence.

import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  CURRENT_QUARANTINE_LEDGER_SCHEMA_VERSION,
  QUARANTINE_UNASSIGNED_OWNER,
  QuarantineLedgerVersionError,
  canonicalJson,
} from '@vostride/agent-qa-schema'
import type { QuarantineEntryState, QuarantineLedgerEvent } from '@vostride/agent-qa-schema'

import {
  EPOCH_FILE,
  LEASE_FILE,
  acquireWriterLease,
  releaseLease,
} from '../../lease/writer-lease.js'
import { QUARANTINE_LEDGER_FILENAME } from '../ledger.js'
import {
  QUARANTINE_MANUAL_ENTRY_CLASS,
  QUARANTINE_MANUAL_ENTRY_FINGERPRINT,
  QuarantineWriteBlockedError,
  createQuarantineOperations,
} from '../operations.js'

const PRODUCT = 'example-web'
const NOW = '2026-05-01T00:00:00.000Z'
/** `now` + QUARANTINE_DEFAULT_EXPIRY_DAYS (30), the pinned default lifetime. */
const DEFAULT_EXPIRY = '2026-05-31T00:00:00.000Z'
/** Far enough past `now` that every corpus entry folds to `quarantined`. */
const FAR_FUTURE = '2026-12-01T00:00:00.000Z'

/** A live guardrail detector's own fixture shape — an AWS key the checkpoint must catch. */
const AWS_KEY = 'AKIAIOSFODNN7EXAMPLE'

function identity(letter: string, name: string): {
  product: string
  filePath: string
  testName: string
} {
  return { product: PRODUCT, filePath: `tests/${letter}.yaml`, testName: name }
}

const A = identity('a', 'alpha')
const B = identity('b', 'beta')
const C = identity('c', 'gamma')
const D = identity('d', 'delta')
const E = identity('e', 'epsilon')
const F = identity('f', 'zeta')

function entered(
  who: ReturnType<typeof identity>,
  at: string,
  overrides: Partial<Record<string, unknown>> = {},
): QuarantineLedgerEvent {
  return {
    schemaVersion: CURRENT_QUARANTINE_LEDGER_SCHEMA_VERSION,
    kind: 'entered',
    at,
    ...who,
    fingerprint: 'fp-corpus',
    verdictClass: 'flake',
    owner: QUARANTINE_UNASSIGNED_OWNER,
    expiresAt: FAR_FUTURE,
    ...overrides,
  } as QuarantineLedgerEvent
}

function released(who: ReturnType<typeof identity>, at: string): QuarantineLedgerEvent {
  return {
    schemaVersion: CURRENT_QUARANTINE_LEDGER_SCHEMA_VERSION,
    kind: 'released-auto',
    at,
    ...who,
  } as QuarantineLedgerEvent
}

describe('createQuarantineOperations (D-12/D-13)', () => {
  let knowledgeRoot: string
  let auditBaseDir: string
  let clockReads: number

  function operations(
    now: string = NOW,
    resolveWriterAuthority?: () => { leaseId: string; epoch: number } | undefined,
  ) {
    return createQuarantineOperations({
      resolveKnowledgeRoot: () => knowledgeRoot,
      auditBaseDir,
      now: () => {
        clockReads += 1
        return now
      },
      ...(resolveWriterAuthority === undefined ? {} : { resolveWriterAuthority }),
    })
  }

  async function plant(events: readonly QuarantineLedgerEvent[]): Promise<void> {
    await writeFile(
      join(knowledgeRoot, QUARANTINE_LEDGER_FILENAME),
      `${events.map((event) => canonicalJson(event)).join('\n')}\n`,
      'utf8',
    )
  }

  function ledgerLines(): Record<string, unknown>[] {
    const path = join(knowledgeRoot, QUARANTINE_LEDGER_FILENAME)
    if (!existsSync(path)) return []
    return readFileSync(path, 'utf8')
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as Record<string, unknown>)
  }

  function shape(entries: readonly QuarantineEntryState[]): string[] {
    return entries.map((entry) => `${entry.filePath}:${entry.owner}:${entry.enteredAt}`)
  }

  beforeEach(async () => {
    knowledgeRoot = await mkdtemp(join(tmpdir(), 'quarantine-ops-'))
    auditBaseDir = await mkdtemp(join(tmpdir(), 'quarantine-ops-audit-'))
    clockReads = 0
  })

  afterEach(async () => {
    await rm(knowledgeRoot, { recursive: true, force: true })
    await rm(auditBaseDir, { recursive: true, force: true })
  })

  // ---- list -------------------------------------------------------------------------------

  it('lists [] for a ledger that was never created — the FLAK-03 empty edge', async () => {
    expect(await operations().list()).toEqual([])
  })

  it('lists [] for an empty ledger file, identically to an absent one', async () => {
    await writeFile(join(knowledgeRoot, QUARANTINE_LEDGER_FILENAME), '', 'utf8')

    expect(await operations().list()).toEqual([])
  })

  it('orders unassigned first, then enteredAt ascending, ties on identity bytes (D-12)', async () => {
    // File order — and therefore the fold's Map iteration order — is C, A, E, D, B, F.
    await plant([
      entered(C, '2026-03-01T00:00:00.000Z', { owner: 'alice' }),
      entered(A, '2026-01-01T00:00:00.000Z'),
      entered(E, '2026-02-01T00:00:00.000Z'),
      entered(D, '2026-02-01T00:00:00.000Z'),
      // B: released, then crossed AGAIN. The intended record (390-05), not duplication — one
      // folded row whose enteredAt is the LATEST entry, which is what the ordering reads.
      entered(B, '2025-12-01T00:00:00.000Z'),
      released(B, '2025-12-15T00:00:00.000Z'),
      entered(B, '2026-04-01T00:00:00.000Z'),
      entered(F, '2025-12-01T00:00:00.000Z', { owner: 'bob' }),
    ])

    const entries = await operations().list()

    expect(shape(entries)).toEqual([
      // Unassigned first — the triage queue. F is the EARLIEST entry of all and still sorts
      // after them, which is what makes the owner partition load-bearing.
      `tests/a.yaml:${QUARANTINE_UNASSIGNED_OWNER}:2026-01-01T00:00:00.000Z`,
      // d before e at an IDENTICAL enteredAt, though the file lists e first: the identity
      // tie-break, and the only level of the rule this pair exercises.
      `tests/d.yaml:${QUARANTINE_UNASSIGNED_OWNER}:2026-02-01T00:00:00.000Z`,
      `tests/e.yaml:${QUARANTINE_UNASSIGNED_OWNER}:2026-02-01T00:00:00.000Z`,
      // b last among the unassigned on its RE-ENTRY instant, not its first one.
      `tests/b.yaml:${QUARANTINE_UNASSIGNED_OWNER}:2026-04-01T00:00:00.000Z`,
      'tests/f.yaml:bob:2025-12-01T00:00:00.000Z',
      'tests/c.yaml:alice:2026-03-01T00:00:00.000Z',
    ])
    // The fold's own order, stated, so the pin above is visibly not the identity function.
    expect(shape(entries)).not.toEqual([
      'tests/c.yaml:alice:2026-03-01T00:00:00.000Z',
      `tests/a.yaml:${QUARANTINE_UNASSIGNED_OWNER}:2026-01-01T00:00:00.000Z`,
      `tests/e.yaml:${QUARANTINE_UNASSIGNED_OWNER}:2026-02-01T00:00:00.000Z`,
      `tests/d.yaml:${QUARANTINE_UNASSIGNED_OWNER}:2026-02-01T00:00:00.000Z`,
      `tests/b.yaml:${QUARANTINE_UNASSIGNED_OWNER}:2026-04-01T00:00:00.000Z`,
      'tests/f.yaml:bob:2025-12-01T00:00:00.000Z',
    ])
  })

  it('enumerates every state — released and expired entries are listed, never filtered', async () => {
    await plant([
      entered(A, '2026-01-01T00:00:00.000Z'),
      released(A, '2026-01-02T00:00:00.000Z'),
      entered(B, '2026-01-01T00:00:00.000Z', { expiresAt: '2026-02-01T00:00:00.000Z' }),
      entered(C, '2026-01-01T00:00:00.000Z'),
    ])

    const entries = await operations().list()

    expect(entries.map((entry) => [entry.filePath, entry.state])).toEqual([
      ['tests/a.yaml', 'released'],
      ['tests/b.yaml', 'expired'],
      ['tests/c.yaml', 'quarantined'],
    ])
  })

  it('reads the injected clock exactly ONCE per call — two reads could straddle a deadline', async () => {
    await plant([entered(A, '2026-01-01T00:00:00.000Z')])

    await operations().list()

    expect(clockReads).toBe(1)
  })

  // ---- add --------------------------------------------------------------------------------

  it('enters a new identity with the unassigned owner and the pinned default lifetime', async () => {
    const answer = await operations().add(A)

    expect(answer).toEqual({
      kind: 'entered',
      entry: {
        ...A,
        fingerprint: QUARANTINE_MANUAL_ENTRY_FINGERPRINT,
        verdictClass: QUARANTINE_MANUAL_ENTRY_CLASS,
        owner: QUARANTINE_UNASSIGNED_OWNER,
        enteredAt: NOW,
        expiresAt: DEFAULT_EXPIRY,
        state: 'quarantined',
      },
    })
    expect(ledgerLines()).toEqual([{
      schemaVersion: CURRENT_QUARANTINE_LEDGER_SCHEMA_VERSION,
      kind: 'entered',
      at: NOW,
      ...A,
      fingerprint: QUARANTINE_MANUAL_ENTRY_FINGERPRINT,
      verdictClass: QUARANTINE_MANUAL_ENTRY_CLASS,
      owner: QUARANTINE_UNASSIGNED_OWNER,
      expiresAt: DEFAULT_EXPIRY,
    }])
  })

  it('honours an explicit owner and expiry rather than stamping the defaults over them', async () => {
    const answer = await operations().add({
      ...A,
      owner: 'alice',
      expiresAt: '2026-07-04T00:00:00.000Z',
    })

    expect(answer.entry).toMatchObject({
      owner: 'alice',
      expiresAt: '2026-07-04T00:00:00.000Z',
    })
  })

  it('renews an already-quarantined identity and claims the owner, carrying the new entry', async () => {
    await plant([entered(A, '2026-01-01T00:00:00.000Z', { expiresAt: FAR_FUTURE })])

    const answer = await operations().add({ ...A, owner: 'alice' })

    expect(answer.kind).toBe('renewed')
    expect(answer.entry).toMatchObject({
      owner: 'alice',
      expiresAt: DEFAULT_EXPIRY,
      // The window it renewed — never a fresh one, so the history the event log keeps is intact.
      enteredAt: '2026-01-01T00:00:00.000Z',
      fingerprint: 'fp-corpus',
      state: 'quarantined',
    })
    expect(ledgerLines()[1]).toEqual({
      schemaVersion: CURRENT_QUARANTINE_LEDGER_SCHEMA_VERSION,
      kind: 'renewed',
      at: NOW,
      ...A,
      owner: 'alice',
      expiresAt: DEFAULT_EXPIRY,
    })
  })

  it('renews WITHOUT an owner and leaves the existing claim alone — no silent unassignment', async () => {
    await plant([entered(A, '2026-01-01T00:00:00.000Z', { owner: 'alice' })])

    const answer = await operations().add(A)

    expect(answer.kind).toBe('renewed')
    expect(answer.entry.owner).toBe('alice')
    expect(ledgerLines()[1]).not.toHaveProperty('owner')
  })

  it('renews an EXPIRED entry back into suppression (D-11 keeps it renewable)', async () => {
    await plant([entered(A, '2026-01-01T00:00:00.000Z', { expiresAt: '2026-02-01T00:00:00.000Z' })])

    const answer = await operations().add(A)

    expect(answer.kind).toBe('renewed')
    expect(answer.entry).toMatchObject({ state: 'quarantined', expiresAt: DEFAULT_EXPIRY })
  })

  it('opens a FRESH window on a released identity — D-10 re-entry needs no special rule', async () => {
    await plant([
      entered(A, '2026-01-01T00:00:00.000Z'),
      released(A, '2026-01-02T00:00:00.000Z'),
    ])

    const answer = await operations().add(A)

    expect(answer.kind).toBe('entered')
    expect(answer.entry).toMatchObject({ enteredAt: NOW, state: 'quarantined' })
    expect(ledgerLines()).toHaveLength(3)
  })

  it('reads the injected clock exactly ONCE per add', async () => {
    await operations().add(A)

    expect(clockReads).toBe(1)
  })

  // ---- release ----------------------------------------------------------------------------

  it('releases an open window and answers the entry it closed', async () => {
    await plant([entered(A, '2026-01-01T00:00:00.000Z')])

    const answer = await operations().release(A)

    expect(answer).toEqual({
      kind: 'released',
      entry: {
        ...A,
        fingerprint: 'fp-corpus',
        verdictClass: 'flake',
        owner: QUARANTINE_UNASSIGNED_OWNER,
        enteredAt: '2026-01-01T00:00:00.000Z',
        expiresAt: FAR_FUTURE,
        state: 'released',
      },
    })
    expect(ledgerLines()[1]).toEqual({
      schemaVersion: CURRENT_QUARANTINE_LEDGER_SCHEMA_VERSION,
      kind: 'released-manual',
      at: NOW,
      ...A,
    })
  })

  it('releases an EXPIRED entry — its window is still open, it just stopped suppressing (D-11)', async () => {
    await plant([entered(A, '2026-01-01T00:00:00.000Z', { expiresAt: '2026-02-01T00:00:00.000Z' })])

    const answer = await operations().release(A)

    expect(answer.kind).toBe('released')
    expect(await operations().list()).toEqual([expect.objectContaining({ state: 'released' })])
  })

  it('answers no-entry for a test nothing ever quarantined, appending NO event', async () => {
    await plant([entered(B, '2026-01-01T00:00:00.000Z')])
    const before = readFileSync(join(knowledgeRoot, QUARANTINE_LEDGER_FILENAME), 'utf8')

    expect(await operations().release(A)).toEqual({ kind: 'no-entry' })
    expect(readFileSync(join(knowledgeRoot, QUARANTINE_LEDGER_FILENAME), 'utf8')).toBe(before)
  })

  it('answers no-entry for an ALREADY-released window — the auto-exit that beat the human', async () => {
    await plant([
      entered(A, '2026-01-01T00:00:00.000Z'),
      released(A, '2026-01-02T00:00:00.000Z'),
    ])

    expect(await operations().release(A)).toEqual({ kind: 'no-entry' })
    expect(ledgerLines()).toHaveLength(2)
  })

  it('answers no-entry against an absent ledger without creating the file', async () => {
    expect(await operations().release(A)).toEqual({ kind: 'no-entry' })
    expect(existsSync(join(knowledgeRoot, QUARANTINE_LEDGER_FILENAME))).toBe(false)
  })

  // ---- write discipline -------------------------------------------------------------------

  it('routes every write through the egress checkpoint: a blocked add throws typed, writes nothing', async () => {
    const blocked = operations().add({ ...A, owner: `oncall-${AWS_KEY}` })

    await expect(blocked).rejects.toBeInstanceOf(QuarantineWriteBlockedError)
    await expect(blocked).rejects.toMatchObject({ name: 'QuarantineWriteBlockedError' })
    // Fail-closed: the refusal comes back from the append as DATA and is re-raised here because
    // this port's own contract has no blocked arm — a silent `entered` answer would tell an
    // operator a test is quarantined while the ledger says nothing of the kind.
    expect(existsSync(join(knowledgeRoot, QUARANTINE_LEDGER_FILENAME))).toBe(false)
    expect(readFileSync(join(auditBaseDir, 'guardrail_audit.jsonl'), 'utf8'))
      .toContain('quarantine-ledger')
  })

  // ---- the product partition (390-09 / WR-01) ---------------------------------------------

  /** A product spelling a human types and every reader re-partitions: `slugBranch` rewrites it. */
  const RAW_PRODUCT = 'My Product'
  const SLUGGED_PRODUCT = 'My-Product'

  function human(fields: { product: string }): {
    product: string
    filePath: string
    testName: string
  } {
    return { ...fields, filePath: 'tests/checkout.yaml', testName: 'checkout completes' }
  }

  it('records the SLUGGED product in the entered line — the partition every reader compares', async () => {
    await operations().add(human({ product: RAW_PRODUCT }))

    // Asserted verbatim rather than against `slugBranch(RAW_PRODUCT)`: a pin written as a relation
    // among the code's own functions cannot see both halves agreeing on the wrong bytes.
    expect(ledgerLines()[0]).toMatchObject({ kind: 'entered', product: SLUGGED_PRODUCT })
    expect(JSON.stringify(ledgerLines()[0])).not.toContain(RAW_PRODUCT)
  })

  it('answers the caller with the normalized identity it actually stored, not the spelling it was given', async () => {
    const answer = await operations().add(human({ product: RAW_PRODUCT }))

    expect(answer.entry).toMatchObject({ product: SLUGGED_PRODUCT, state: 'quarantined' })
  })

  it('RENEWS a second add under the same unslugged spelling — the lookup joins through the slug', async () => {
    await operations().add(human({ product: RAW_PRODUCT }))

    const answer = await operations().add(human({ product: RAW_PRODUCT }))

    // Reds when only the WRITE half slugs: `entryFor` would look for `My Product`, miss the
    // `My-Product` row it just wrote, and open a second window over the same test.
    expect(answer.kind).toBe('renewed')
    expect(ledgerLines().map((line) => line.kind)).toEqual(['entered', 'renewed'])
  })

  it('RELEASES the window an unslugged add opened — both write verbs join on the same bytes', async () => {
    await operations().add(human({ product: RAW_PRODUCT }))

    const answer = await operations().release(human({ product: RAW_PRODUCT }))

    expect(answer.kind).toBe('released')
    expect(ledgerLines()[1]).toMatchObject({
      kind: 'released-manual',
      product: SLUGGED_PRODUCT,
    })
    expect(await operations().list()).toEqual([expect.objectContaining({ state: 'released' })])
  })

  it('round-trips an ALREADY-slugged product byte-identically — the idempotence control', async () => {
    // The conditional half of WR-01: a product already in slug form was never broken, which is
    // exactly why no existing fixture caught the defect. It must not move now.
    await operations().add(human({ product: PRODUCT }))

    expect(ledgerLines()[0]).toMatchObject({ product: PRODUCT })
    expect((await operations().list())[0]).toMatchObject({ product: PRODUCT })
  })

  // ---- writer-lease serialization (390-09 / CR-03 / D-04) ---------------------------------

  function leaseFile(): string {
    return join(knowledgeRoot, LEASE_FILE)
  }

  function ledgerBytes(): string {
    return readFileSync(join(knowledgeRoot, QUARANTINE_LEDGER_FILENAME), 'utf8')
  }

  /** The fixture takes the lease FIRST, so the verb under test meets a writer that is not it. */
  function foreignHolder(): { leaseId: string; epoch: number } {
    const acquired = acquireWriterLease(knowledgeRoot)
    if (acquired.kind !== 'acquired') {
      throw new Error(`the fixture could not take the lease it needs: ${acquired.kind}`)
    }
    return { leaseId: acquired.leaseId, epoch: acquired.epoch }
  }

  function currentLeaseId(): string | undefined {
    if (!existsSync(leaseFile())) return undefined
    return (JSON.parse(readFileSync(leaseFile(), 'utf8')) as { leaseId: string }).leaseId
  }

  it('ACQUIRES the writer lease for an add and gives back exactly what it took', async () => {
    // Nothing in this fixture writes the monotonic epoch except an acquisition, so the epoch is
    // the acquisition's own footprint — this is the leg that reds for a verb holding no lock.
    expect(existsSync(join(knowledgeRoot, EPOCH_FILE))).toBe(false)

    await operations().add(A)

    expect(ledgerLines()).toHaveLength(1)
    expect(readFileSync(join(knowledgeRoot, EPOCH_FILE), 'utf8')).toBe('1\n')
    // And no residue: a verb that returned must not leave the next writer locked out.
    expect(existsSync(leaseFile())).toBe(false)
  })

  it('ACQUIRES the writer lease for a release and gives back exactly what it took', async () => {
    await plant([entered(A, '2026-01-01T00:00:00.000Z')])

    await operations().release(A)

    expect(ledgerLines()).toHaveLength(2)
    expect(readFileSync(join(knowledgeRoot, EPOCH_FILE), 'utf8')).toBe('1\n')
    expect(existsSync(leaseFile())).toBe(false)
  })

  it('REFUSES an add while another writer holds the lease — typed, and the ledger is byte-unchanged', async () => {
    await plant([entered(B, '2026-01-01T00:00:00.000Z')])
    const before = ledgerBytes()
    const holder = foreignHolder()

    await expect(operations().add(A)).rejects.toMatchObject({
      name: 'QuarantineLeaseHeldError',
      holder: { leaseId: holder.leaseId, epoch: holder.epoch },
    })

    // Load-bearing BECAUSE the same call writes: `add(A)` against a ledger holding only B appends
    // an `entered` line in the accept-direction test above. Zero appended bytes is a measurement.
    expect(ledgerBytes()).toBe(before)
    // The refusal took nothing from the holder either — no reclaim, no silent steal.
    expect(currentLeaseId()).toBe(holder.leaseId)

    releaseLease({ knowledgeRoot, leaseId: holder.leaseId })
  })

  it('REFUSES a release while another writer holds the lease — typed, and the ledger is byte-unchanged', async () => {
    await plant([entered(A, '2026-01-01T00:00:00.000Z')])
    const before = ledgerBytes()
    const holder = foreignHolder()

    await expect(operations().release(A)).rejects.toMatchObject({
      name: 'QuarantineLeaseHeldError',
      holder: { leaseId: holder.leaseId, epoch: holder.epoch },
    })

    // Same shape, same reason: `release(A)` on this exact ledger appends `released-manual` when the
    // lease is free (the release test above), so an unchanged file is the guard's own doing.
    expect(ledgerBytes()).toBe(before)
    expect(currentLeaseId()).toBe(holder.leaseId)

    releaseLease({ knowledgeRoot, leaseId: holder.leaseId })
  })

  it('rides a HANDED-IN writer authority — the daemon arm: it appends while the lease is held, and never releases it', async () => {
    // The daemon acquires at startup and holds for its lifetime (cli/src/daemon/host.ts:642), then
    // hands the same two fields to the composition (host.ts:1839). A holder that called
    // `acquireWriterLease` would be told `held` by itself, so this arm must not acquire at all.
    const authority = foreignHolder()

    const answer = await operations(NOW, () => authority).add(A)

    expect(answer.kind).toBe('entered')
    expect(ledgerLines()).toHaveLength(1)
    // Still the SAME lease, still present: the verb neither took a second one nor released an
    // authority it does not own — releasing it would unlock the daemon's whole process.
    expect(currentLeaseId()).toBe(authority.leaseId)

    releaseLease({ knowledgeRoot, leaseId: authority.leaseId })
  })

  it('leaves the READ verb acquisition-free — list answers while a foreign writer holds the lease', async () => {
    await plant([entered(A, '2026-01-01T00:00:00.000Z')])
    const holder = foreignHolder()

    const entries = await operations().list()

    expect(entries).toHaveLength(1)
    // A reader that took the lease would serialize enumeration behind every drain in progress.
    expect(currentLeaseId()).toBe(holder.leaseId)

    releaseLease({ knowledgeRoot, leaseId: holder.leaseId })
  })

  // ---- committed-truth read posture -------------------------------------------------------

  it('PROPAGATES an unreadable ledger from every verb — never heals to "nothing is quarantined"', async () => {
    await writeFile(
      join(knowledgeRoot, QUARANTINE_LEDGER_FILENAME),
      `${JSON.stringify({
        ...entered(A, '2026-01-01T00:00:00.000Z'),
        schemaVersion: CURRENT_QUARANTINE_LEDGER_SCHEMA_VERSION + 1,
      })}\n`,
      'utf8',
    )

    await expect(operations().list()).rejects.toBeInstanceOf(QuarantineLedgerVersionError)
    await expect(operations().release(A)).rejects.toBeInstanceOf(QuarantineLedgerVersionError)
    await expect(operations().add(A)).rejects.toBeInstanceOf(QuarantineLedgerVersionError)
    // And the refusal cost the file nothing: a verb that could not read did not write either.
    expect(readFileSync(join(knowledgeRoot, QUARANTINE_LEDGER_FILENAME), 'utf8'))
      .toContain(`"schemaVersion":${CURRENT_QUARANTINE_LEDGER_SCHEMA_VERSION + 1}`)
  })

  it('reads NO clock of its own — wall-clock purity by argument, asserted on the source', () => {
    const source = readFileSync(new URL('../operations.ts', import.meta.url), 'utf8')
      // Comments may legitimately discuss the clock; only executable bytes are scanned.
      .replaceAll(/\/\*[\s\S]*?\*\//g, '')
      .replaceAll(/\/\/.*$/gm, '')

    expect(source).not.toContain('Date.now')
    expect(source).not.toContain('new Date()')
  })
})
