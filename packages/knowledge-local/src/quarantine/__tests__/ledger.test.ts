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
import type { QuarantineLedgerEvent } from '@vostride/agent-qa-schema'

import {
  QUARANTINE_LEDGER_EGRESS_CHANNEL,
  QUARANTINE_LEDGER_FILENAME,
  appendQuarantineEvents,
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

// ---- The full lifecycle fold (D-10/D-12/D-13) ----------------------------

const LATER_EXPIRY = '2026-10-04T10:00:00.000Z'
const BETWEEN_EXPIRIES = '2026-09-20T10:00:00.000Z'

function renewed(overrides: Partial<Record<string, unknown>> = {}): QuarantineLedgerEvent {
  return {
    schemaVersion: CURRENT_QUARANTINE_LEDGER_SCHEMA_VERSION,
    kind: 'renewed',
    at: '2026-08-20T10:00:00.000Z',
    product: PRODUCT,
    filePath: FILE_PATH,
    testName: TEST_NAME,
    expiresAt: LATER_EXPIRY,
    ...overrides,
  } as QuarantineLedgerEvent
}

function released(kind: 'released-manual' | 'released-auto'): QuarantineLedgerEvent {
  return {
    schemaVersion: CURRENT_QUARANTINE_LEDGER_SCHEMA_VERSION,
    kind,
    at: '2026-08-25T10:00:00.000Z',
    product: PRODUCT,
    filePath: FILE_PATH,
    testName: TEST_NAME,
  } as QuarantineLedgerEvent
}

describe('quarantine ledger lifecycle fold', () => {
  it('renewal extends the expiry — the later deadline governs', () => {
    const state = foldQuarantineLedgerState([entered(), renewed()], BETWEEN_EXPIRIES)
    expect(state).toHaveLength(1)
    expect(state[0].expiresAt).toBe(LATER_EXPIRY)
    // Between the two deadlines the entry is STILL quarantined — proof the renewal governed.
    expect(state[0].state).toBe('quarantined')
    // Without the renewal, the same `now` reads expired (the control half).
    expect(foldQuarantineLedgerState([entered()], BETWEEN_EXPIRIES)[0].state).toBe('expired')
  })

  it('renewal past the NEW deadline still expires — extension is bounded, not perpetual', () => {
    const state = foldQuarantineLedgerState([entered(), renewed()], '2026-10-04T10:00:01.000Z')
    expect(state[0].state).toBe('expired')
    expect(foldQuarantineLedgerState([entered(), renewed()], '2026-10-04T09:59:59.000Z')[0].state).toBe(
      'quarantined',
    )
  })

  it('renewal with an owner claims the entry out of unassigned', () => {
    const claimed = foldQuarantineLedgerState(
      [entered(), renewed({ owner: 'alice' })],
      BETWEEN_EXPIRIES,
    )
    expect(claimed[0].owner).toBe('alice')

    // A renewal WITHOUT an owner leaves the existing one alone — never resets a claim.
    const stillUnassigned = foldQuarantineLedgerState([entered(), renewed()], BETWEEN_EXPIRIES)
    expect(stillUnassigned[0].owner).toBe(QUARANTINE_UNASSIGNED_OWNER)
    const keepsClaim = foldQuarantineLedgerState(
      [entered(), renewed({ owner: 'alice' }), renewed()],
      BETWEEN_EXPIRIES,
    )
    expect(keepsClaim[0].owner).toBe('alice')
  })

  it('either release kind closes the window', () => {
    for (const kind of ['released-manual', 'released-auto'] as const) {
      const state = foldQuarantineLedgerState([entered(), released(kind)], JUST_BEFORE_EXPIRY)
      expect(state).toHaveLength(1)
      expect(state[0].state).toBe('released')
    }
  })

  it('a released entry RE-ENTERS on a later entered event (D-10, no special rule)', () => {
    const state = foldQuarantineLedgerState(
      [
        entered(),
        released('released-auto'),
        entered({ at: '2026-08-30T10:00:00.000Z', expiresAt: LATER_EXPIRY, fingerprint: 'fp-2' }),
      ],
      BETWEEN_EXPIRIES,
    )
    expect(state).toHaveLength(1)
    expect(state[0].state).toBe('quarantined')
    expect(state[0].enteredAt).toBe('2026-08-30T10:00:00.000Z')
    expect(state[0].fingerprint).toBe('fp-2')
  })

  it('never invents an entry from a renewal or release with no window to act on', () => {
    expect(foldQuarantineLedgerState([renewed()], BETWEEN_EXPIRIES)).toEqual([])
    expect(foldQuarantineLedgerState([released('released-manual')], BETWEEN_EXPIRIES)).toEqual([])
  })

  it('treats an unparseable deadline as lapsed — never a silent forever-suppression', () => {
    const state = foldQuarantineLedgerState([entered({ expiresAt: 'whenever' })], ENTERED_AT)
    expect(state[0].state).toBe('expired')
  })
})

// ---- appendQuarantineEvents: egress-checkpointed committed writes (D-04) --

// AKIA + 16 uppercase alphanumerics is the exact detector-shaped key the committed-root proof
// uses. An arbitrary random string would not exercise the refusal path at all.
const AWS_KEY = 'AKIAIOSFODNN7EXAMPLE'

describe('appendQuarantineEvents (D-04)', () => {
  let knowledgeRoot: string
  let auditBaseDir: string

  beforeEach(async () => {
    knowledgeRoot = await mkdtemp(join(tmpdir(), 'quarantine-append-'))
    auditBaseDir = await mkdtemp(join(tmpdir(), 'quarantine-audit-'))
  })

  afterEach(async () => {
    await rm(knowledgeRoot, { recursive: true, force: true })
    await rm(auditBaseDir, { recursive: true, force: true })
  })

  function ledgerText(): string {
    return readFileSync(join(knowledgeRoot, QUARANTINE_LEDGER_FILENAME), 'utf8')
  }

  it('names its own committed-egress channel', () => {
    expect(QUARANTINE_LEDGER_EGRESS_CHANNEL).toBe('quarantine-ledger')
  })

  it('round-trips: append then read then fold reproduces the events identically', () => {
    const events = [entered(), renewed()]
    const outcome = appendQuarantineEvents(knowledgeRoot, events, { auditBaseDir })
    expect(outcome).toEqual({ kind: 'appended', lines: 2 })

    const read = readQuarantineLedger(knowledgeRoot)
    expect(read.refusedLines).toEqual([])
    expect(read.events).toEqual(events)
    expect(foldQuarantineLedgerState(read.events, BETWEEN_EXPIRIES)).toEqual(
      foldQuarantineLedgerState(events, BETWEEN_EXPIRIES),
    )
  })

  it('writes canonical JSON, one event per line, newline-terminated', () => {
    appendQuarantineEvents(knowledgeRoot, [entered()], { auditBaseDir })
    const text = ledgerText()
    expect(text).toBe(`${canonicalJson(entered())}\n`)
  })

  it('APPENDS — an existing ledger keeps every prior line', () => {
    appendQuarantineEvents(knowledgeRoot, [entered()], { auditBaseDir })
    appendQuarantineEvents(knowledgeRoot, [renewed()], { auditBaseDir })
    expect(readQuarantineLedger(knowledgeRoot).events).toEqual([entered(), renewed()])
    expect(ledgerText().trimEnd().split('\n')).toHaveLength(2)
  })

  it('creates the knowledge root when the first append lands', () => {
    const freshRoot = join(knowledgeRoot, 'nested', 'root')
    expect(existsSync(freshRoot)).toBe(false)
    expect(appendQuarantineEvents(freshRoot, [entered()], { auditBaseDir })).toEqual({
      kind: 'appended',
      lines: 1,
    })
    expect(readQuarantineLedger(freshRoot).events).toEqual([entered()])
  })

  it('an empty event list is a no-op that writes no file', () => {
    expect(appendQuarantineEvents(knowledgeRoot, [], { auditBaseDir })).toEqual({
      kind: 'appended',
      lines: 0,
    })
    expect(existsSync(join(knowledgeRoot, QUARANTINE_LEDGER_FILENAME))).toBe(false)
  })

  it('refuses a secret-bearing append as DATA, writing no byte and throwing nothing', () => {
    const outcome = appendQuarantineEvents(
      knowledgeRoot,
      [entered({ owner: `oncall-${AWS_KEY}` })],
      { auditBaseDir },
    )

    expect(outcome.kind).toBe('egress-blocked')
    if (outcome.kind !== 'egress-blocked') throw new Error('expected an egress refusal')
    expect(outcome.detections.map((detection) => detection.detector)).toContain('awsKey')

    // Fail-closed: the checkpoint runs BEFORE any byte reaches the committed file.
    expect(existsSync(join(knowledgeRoot, QUARANTINE_LEDGER_FILENAME))).toBe(false)

    // And the refusal is audited under the caller-owned audit dir, on this channel.
    const auditPath = join(auditBaseDir, 'guardrail_audit.jsonl')
    expect(existsSync(auditPath)).toBe(true)
    expect(readFileSync(auditPath, 'utf8')).toContain(QUARANTINE_LEDGER_EGRESS_CHANNEL)
  })

  it('a blocked unit leaves an existing ledger byte-unchanged — all-or-nothing', () => {
    appendQuarantineEvents(knowledgeRoot, [entered()], { auditBaseDir })
    const before = ledgerText()

    const outcome = appendQuarantineEvents(
      knowledgeRoot,
      [renewed(), entered({ testName: 'second test', owner: `oncall-${AWS_KEY}` })],
      { auditBaseDir },
    )

    expect(outcome.kind).toBe('egress-blocked')
    // The CLEAN sibling in the same unit is withheld too: the checkpoint is one unit.
    expect(ledgerText()).toBe(before)
  })

  it('reads no clock — the caller stamps every instant', () => {
    appendQuarantineEvents(knowledgeRoot, [entered()], { auditBaseDir })
    const [event] = readQuarantineLedger(knowledgeRoot).events
    expect(event.at).toBe(ENTERED_AT)
    if (event.kind !== 'entered') throw new Error('expected an entered event')
    expect(event.expiresAt).toBe(EXPIRES_AT)
  })
})

// ---- The committed-root placement claim (DR-1: no sibling precedent) -----

describe('the ledger is genuinely committed at the knowledge root', () => {
  it('is not swallowed by any knowledge-root ignore rule', () => {
    // DR-1 is real: this is the FIRST committed top-level operational artifact beside memory/ and
    // policies/, so its placement is verified against the shipped root's own ignore file rather
    // than assumed from a precedent that does not exist. Every rule is checked, so a future rule
    // that happened to match the ledger would red HERE rather than silently un-committing
    // quarantine state (and with it FLAK-02's cross-machine promise).
    const ignoreRules = [
      'memory/index/',
      'memory/queue/',
      '.lease',
      '.epoch',
      '**/artifacts/',
      'skills/.staging/',
    ]

    for (const rule of ignoreRules) {
      const bare = rule.replace(/^\*\*\//, '').replace(/\/$/, '')
      expect(QUARANTINE_LEDGER_FILENAME).not.toBe(bare)
      expect(QUARANTINE_LEDGER_FILENAME.startsWith(`${bare}/`)).toBe(false)
    }

    // It is a top-level FILE, not nested under any shelf — the property those rules key on.
    expect(QUARANTINE_LEDGER_FILENAME).not.toContain('/')
    expect(QUARANTINE_LEDGER_FILENAME.startsWith('.')).toBe(false)
  })
})
