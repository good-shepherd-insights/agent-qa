// RED-first pins for the committed quarantine ledger's read + fold half (Phase 390, D-01/D-03/D-11).
//
// The ledger is the FIRST committed top-level operational artifact beside memory/ and policies/.
// Two postures are load-bearing and pinned here:
//
//  1. Refusal-as-data on malformed lines — a mangled line surfaces in `refusedLines` while its
//     neighbours still fold. Healing to absence would silently UN-quarantine a test (red builds),
//     the exact silent flip this phase exists to prevent.
//  2. A NEWER schemaVersion is a typed hard failure (committed truth), not a skipped line.
//
// The fold is PURE: `now` arrives as an argument, so expiry boundaries are pinned one second
// either side with zero wall-clock reads.

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  CURRENT_QUARANTINE_LEDGER_SCHEMA_VERSION,
  QUARANTINE_UNASSIGNED_OWNER,
  QuarantineLedgerVersionError,
} from '@vostride/agent-qa-schema'
import type { QuarantineLedgerEvent } from '@vostride/agent-qa-schema'

import {
  QUARANTINE_LEDGER_FILENAME,
  foldQuarantineLedgerState,
  readQuarantineLedger,
} from '../ledger.js'

const PRODUCT = 'example-web'
const FILE_PATH = 'tests/checkout.test.yaml'
const TEST_NAME = 'checkout completes'
const ENTERED_AT = '2026-08-05T10:00:00.000Z'
const EXPIRES_AT = '2026-09-04T10:00:00.000Z'

/** One second either side of the expiry boundary — the two pins the fold must separate. */
const JUST_BEFORE_EXPIRY = '2026-09-04T09:59:59.000Z'
const JUST_AFTER_EXPIRY = '2026-09-04T10:00:01.000Z'

function entered(overrides: Partial<Record<string, unknown>> = {}): QuarantineLedgerEvent {
  return {
    schemaVersion: CURRENT_QUARANTINE_LEDGER_SCHEMA_VERSION,
    kind: 'entered',
    at: ENTERED_AT,
    product: PRODUCT,
    filePath: FILE_PATH,
    testName: TEST_NAME,
    fingerprint: 'fp-1',
    verdictClass: 'flake',
    owner: QUARANTINE_UNASSIGNED_OWNER,
    expiresAt: EXPIRES_AT,
    ...overrides,
  } as QuarantineLedgerEvent
}

describe('quarantine ledger read/fold', () => {
  let knowledgeRoot: string

  beforeEach(async () => {
    knowledgeRoot = await mkdtemp(join(tmpdir(), 'quarantine-ledger-'))
  })

  afterEach(async () => {
    await rm(knowledgeRoot, { recursive: true, force: true })
  })

  async function writeLedger(lines: readonly string[]): Promise<void> {
    await writeFile(join(knowledgeRoot, QUARANTINE_LEDGER_FILENAME), lines.join('\n') + '\n', 'utf8')
  }

  it('names the ledger as its own top-level artifact under the committed knowledge root', () => {
    expect(QUARANTINE_LEDGER_FILENAME).toBe('quarantine.jsonl')
  })

  it('folds a missing ledger to empty state — byte-identical pre-390 run behavior', async () => {
    const read = readQuarantineLedger(knowledgeRoot)
    expect(read).toEqual({ events: [], refusedLines: [] })
    expect(foldQuarantineLedgerState(read.events, ENTERED_AT)).toEqual([])
  })

  it('folds an empty ledger file to empty state', async () => {
    await writeFile(join(knowledgeRoot, QUARANTINE_LEDGER_FILENAME), '', 'utf8')
    const read = readQuarantineLedger(knowledgeRoot)
    expect(read).toEqual({ events: [], refusedLines: [] })
  })

  it('answers the one entered event a fixture ledger carries', async () => {
    await writeLedger([JSON.stringify(entered())])
    const read = readQuarantineLedger(knowledgeRoot)
    expect(read.refusedLines).toEqual([])
    expect(read.events).toEqual([entered()])
  })

  it('folds an unexpired entry to state quarantined, carrying every listed field', async () => {
    await writeLedger([JSON.stringify(entered())])
    const { events } = readQuarantineLedger(knowledgeRoot)
    const state = foldQuarantineLedgerState(events, JUST_BEFORE_EXPIRY)
    expect(state).toEqual([
      {
        product: PRODUCT,
        filePath: FILE_PATH,
        testName: TEST_NAME,
        fingerprint: 'fp-1',
        verdictClass: 'flake',
        owner: QUARANTINE_UNASSIGNED_OWNER,
        enteredAt: ENTERED_AT,
        expiresAt: EXPIRES_AT,
        state: 'quarantined',
      },
    ])
  })

  it('folds a lapsed entry to state expired — never a silent forever-suppression (D-11)', async () => {
    await writeLedger([JSON.stringify(entered())])
    const { events } = readQuarantineLedger(knowledgeRoot)
    const state = foldQuarantineLedgerState(events, JUST_AFTER_EXPIRY)
    expect(state).toHaveLength(1)
    expect(state[0].state).toBe('expired')
    // The entry stays LISTED with its identity and expiry intact — renewable and releasable.
    expect(state[0].expiresAt).toBe(EXPIRES_AT)
    expect(state[0].testName).toBe(TEST_NAME)
  })

  it('is pure — the same (events, now) pair answers identically on repeat calls', async () => {
    await writeLedger([JSON.stringify(entered())])
    const { events } = readQuarantineLedger(knowledgeRoot)
    expect(foldQuarantineLedgerState(events, JUST_BEFORE_EXPIRY)).toEqual(
      foldQuarantineLedgerState(events, JUST_BEFORE_EXPIRY),
    )
    expect(foldQuarantineLedgerState(events, JUST_BEFORE_EXPIRY)[0].state).not.toBe(
      foldQuarantineLedgerState(events, JUST_AFTER_EXPIRY)[0].state,
    )
  })

  it('keys entries by (product, filePath, testName), never a per-run id', async () => {
    await writeLedger([
      JSON.stringify(entered()),
      JSON.stringify(entered({ product: 'other-web' })),
      JSON.stringify(entered({ testName: 'a different test' })),
    ])
    const { events } = readQuarantineLedger(knowledgeRoot)
    const state = foldQuarantineLedgerState(events, JUST_BEFORE_EXPIRY)
    expect(state).toHaveLength(3)
    expect(state.map((entry) => `${entry.product}::${entry.filePath}::${entry.testName}`).sort()).toEqual(
      [
        `${PRODUCT}::${FILE_PATH}::${TEST_NAME}`,
        `${PRODUCT}::${FILE_PATH}::a different test`,
        `other-web::${FILE_PATH}::${TEST_NAME}`,
      ].sort(),
    )
  })

  it('refuses a malformed line as DATA while its neighbours still fold', async () => {
    await writeLedger([
      JSON.stringify(entered()),
      '{ this is not json',
      JSON.stringify(entered({ testName: 'a second test' })),
    ])
    const read = readQuarantineLedger(knowledgeRoot)
    expect(read.events).toHaveLength(2)
    expect(read.refusedLines).toHaveLength(1)
    expect(read.refusedLines[0].lineNumber).toBe(2)
    expect(read.refusedLines[0].reason).toMatch(/.+/)
    // The refusal never heals to absence: both healthy entries stay quarantined.
    expect(foldQuarantineLedgerState(read.events, JUST_BEFORE_EXPIRY)).toHaveLength(2)
  })

  it('refuses a structurally broken line as DATA, never healing it away', async () => {
    const broken = { ...(entered() as unknown as Record<string, unknown>) }
    delete broken.testName
    await writeLedger([JSON.stringify(broken), JSON.stringify(entered())])
    const read = readQuarantineLedger(knowledgeRoot)
    expect(read.events).toHaveLength(1)
    expect(read.refusedLines).toEqual([
      { lineNumber: 1, reason: expect.stringMatching(/.+/) as unknown as string },
    ])
  })

  it('hard-fails typed when a line declares a NEWER schemaVersion', async () => {
    await writeLedger([JSON.stringify(entered({ schemaVersion: 2 }))])
    expect(() => readQuarantineLedger(knowledgeRoot)).toThrow(QuarantineLedgerVersionError)
  })

  it('ignores blank lines without reporting them as refusals', async () => {
    await writeLedger([JSON.stringify(entered()), '', '   '])
    const read = readQuarantineLedger(knowledgeRoot)
    expect(read.events).toHaveLength(1)
    expect(read.refusedLines).toEqual([])
  })
})
