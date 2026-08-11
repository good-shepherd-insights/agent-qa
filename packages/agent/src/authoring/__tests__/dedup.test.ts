// Stage 2 — the frozen dedup denominator (Phase 394, D-04/D-16 · WTST-01).
//
// Nine rows, each the SOLE CATCHER for one property, and each one's rationale in
// `fixtures/dedup-corpus/expectations.json` says which. The table is frozen: a row that stops
// catching what it claims is a finding about the lane, never a reason to move the row.
//
// THE INTENT IS PRODUCED, NOT WRITTEN HERE. Every row's intent is read at test time out of a
// house-style YAML document under `fixtures/dedup-corpus/intents/` and projected the way the loop
// projects one — the document's name followed by its ordered steps. A corpus assembled as a
// TypeScript literal can pin an input no producer is able to emit, and a mutation differential
// then reds only impossible fixtures, which cannot tell a vacuous corpus apart from a real
// closure. The suite side is read the same way.
//
// THE SUBJECT IS IMPORTED LAZILY, INSIDE EACH CELL, and that is the RED-first mechanism rather
// than a style choice. A top-level import of a module that does not exist yet fails the whole FILE
// to load, and vitest reports that identically to a corpus that was never written at all
// (`No test files found` and a load error are the same exit code). Imported per cell, the
// pre-implementation RED is N NAMED ROWS each failing on module resolution, which is a recording
// of the denominator rather than of the harness.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'

import { textSimilarity } from '../adds-value.js'
import type { SuiteTextCorpusEntryLike } from '../ports.js'

const CORPUS_DIR = join(import.meta.dirname, 'fixtures', 'dedup-corpus')

interface SuiteMemberSpec {
  readonly identityPath: string
  readonly document: string
}

interface CorpusRow {
  readonly id: string
  readonly intent: string | null
  readonly suite: readonly string[] | null
  readonly expected: 'duplicate' | 'no-duplicate'
  readonly matched: string | null
  readonly score: number | null
  readonly sharedTokens: number | null
  readonly comparedTests: number
  readonly rationale: string
  readonly measured: string
}

interface Expectations {
  readonly $comment: readonly string[]
  readonly schemaVersion: number
  readonly frozenAt: string
  readonly threshold: number
  readonly thresholdComparison: string
  readonly suiteMembers: Readonly<Record<string, SuiteMemberSpec>>
  readonly the393Suite: readonly string[]
  readonly rows: readonly CorpusRow[]
}

const EXPECTATIONS = JSON.parse(
  readFileSync(join(CORPUS_DIR, 'expectations.json'), 'utf8'),
) as Expectations

/** A house-style test document, reduced to the fields a text projection reads. */
interface HouseDocument {
  readonly name: string
  readonly steps: readonly string[]
  readonly 'test-id': string
  readonly target: string
}

function readDocument(relativePath: string): HouseDocument {
  return parse(readFileSync(join(CORPUS_DIR, relativePath), 'utf8')) as HouseDocument
}

/**
 * The text projection of a document, exactly as the loop projects an intent.
 *
 * One string, because that is what an intent IS at stage 2 — there is no draft yet, which is the
 * whole reason the screen is worth doing. `textSimilarity` tokenizes over a set, so joining the
 * name and the steps yields the same token set the document's parts would.
 */
function intentTextOf(relativePath: string): string {
  const document = readDocument(relativePath)
  return [document.name, ...document.steps].join(' ')
}

function suiteEntry(key: string): SuiteTextCorpusEntryLike {
  const member = EXPECTATIONS.suiteMembers[key]
  if (member === undefined) throw new Error(`no suite member named ${key}`)
  const document = readDocument(member.document)
  return { filePath: member.identityPath, testName: document.name, stepsText: document.steps }
}

/** The degenerate row's corpus entry: an empty name and no steps. No document produces this. */
const EMPTY_TEXT_ENTRY: SuiteTextCorpusEntryLike = {
  filePath: 'demo/init/tests/dedup-empty-text.yaml',
  testName: '',
  stepsText: [],
}

function inputsFor(row: CorpusRow): {
  readonly intent: string
  readonly corpus: readonly SuiteTextCorpusEntryLike[]
} {
  if (row.intent === null || row.suite === null) {
    return { intent: '', corpus: [EMPTY_TEXT_ENTRY] }
  }
  return { intent: intentTextOf(row.intent), corpus: row.suite.map(suiteEntry) }
}

function rowNamed(id: string): CorpusRow {
  const row = EXPECTATIONS.rows.find((candidate) => candidate.id === id)
  if (row === undefined) throw new Error(`no frozen row named ${id}`)
  return row
}

async function loadDedup() {
  return await import('../dedup.js')
}

describe('the frozen dedup corpus is intact', () => {
  it('carries the treadmill warning and nine sole-catcher rows', () => {
    expect(EXPECTATIONS.$comment.join(' ')).toContain('MUST NOT mint new members')
    expect(EXPECTATIONS.rows).toHaveLength(9)
    for (const row of EXPECTATIONS.rows) {
      expect(row.rationale, `${row.id} states the property it is the sole catcher for`)
        .toContain('SOLE CATCHER for')
      expect(row.measured.length, `${row.id} records what was measured`).toBeGreaterThan(40)
    }
    expect(new Set(EXPECTATIONS.rows.map((row) => row.id)).size).toBe(9)
  })

  it('is a boundary TRIPLE: one row exactly on the pin, one below, one above', () => {
    const at = rowNamed('at-threshold')
    const below = rowNamed('below-threshold')
    const above = rowNamed('above-threshold')

    expect(at.score).toBe(EXPECTATIONS.threshold)
    expect(below.score).toBeLessThan(EXPECTATIONS.threshold)
    expect(above.score).toBeGreaterThan(EXPECTATIONS.threshold)
    // The triple pins a POINT, not a region: the two flanking rows sit within a hundredth of
    // the pin, so a lane that rounded or compared at reduced precision reds here.
    expect(EXPECTATIONS.threshold - (below.score ?? 0)).toBeLessThan(0.01)
    expect((above.score ?? 0) - EXPECTATIONS.threshold).toBeLessThan(0.01)
    expect(at.expected).toBe('duplicate')
    expect(below.expected).toBe('no-duplicate')
    expect(above.expected).toBe('duplicate')
  })

  it('has an ADMITTING leg beside every refusing one', () => {
    const admits = EXPECTATIONS.rows.filter((row) => row.expected === 'no-duplicate')
    const refuses = EXPECTATIONS.rows.filter((row) => row.expected === 'duplicate')
    // A threshold that refused everything would pass a refuse-only corpus.
    expect(admits.length).toBeGreaterThanOrEqual(3)
    expect(refuses.length).toBeGreaterThanOrEqual(3)
    // And the closest admitting row is a genuine near-miss rather than a stranger.
    const control = rowNamed('accept-control')
    expect(EXPECTATIONS.threshold - (control.score ?? 0)).toBeLessThan(0.05)
  })
})

describe('every corpus document is a parsable house-style test', () => {
  // The producer check. `parseTestFile` itself lives in `@vostride/agent-qa-core`, which the
  // FUNC-02 firewall forbids this package to import, so the acceptance asserted here is that the
  // document parses as YAML and carries the four fields the house format requires. The REAL
  // `parseTestFile` acceptance of these same files is asserted in `agent-local`, which may import
  // it -- see `authoring-loop.e2e.test.ts`.
  const documents = [
    ...Object.values(EXPECTATIONS.suiteMembers).map((member) => member.document),
    ...EXPECTATIONS.rows.map((row) => row.intent).filter((path) => path !== null),
  ]

  it.each([...new Set(documents)])('%s parses and carries the house fields', (relativePath) => {
    const document = readDocument(relativePath)
    expect(typeof document.name).toBe('string')
    expect(document.name.length).toBeGreaterThan(0)
    expect(document['test-id']).toMatch(/^t_[a-z0-9-]+$/u)
    expect(document.target).toBe('local-form')
    expect(Array.isArray(document.steps)).toBe(true)
    expect(document.steps.length).toBeGreaterThan(0)
    for (const step of document.steps) expect(typeof step).toBe('string')
  })

  it('copies the 393 suite VERBATIM, so the two denominators describe one world', () => {
    // 393's corpus scores against these three documents. If a copy drifts, the claim that stage 2
    // and gate 3 screen the same world is silently false, and no other cell would notice.
    const localForm = suiteEntry('uat-381-local-form')
    expect(localForm.testName).toBe('Sign in on the local account form')
    expect(localForm.stepsText).toEqual([
      'Type "{{env:PROBE_USER}}" into the Username field',
      'Type "{{secret:PROBE_TOKEN}}" into the Password field',
      'Click the Submit button',
      'Verify the page says "Received!"',
    ])
    expect(EXPECTATIONS.the393Suite).toEqual([
      'uat-381-local-form',
      'uat-381-ladder',
      'uat-381-ladder-current-target',
    ])
  })
})

describe('dedupBeforeAuthor against the frozen corpus', () => {
  it('pins the threshold and the comparison direction the table was frozen against', async () => {
    const { DEDUP_REFUSE_SIMILARITY_THRESHOLD } = await loadDedup()
    expect(DEDUP_REFUSE_SIMILARITY_THRESHOLD).toBe(EXPECTATIONS.threshold)
    expect(EXPECTATIONS.thresholdComparison).toBe('>=')
    // Deliberately BELOW gate 3's, which is the whole retune argument in one assertion: a pre-run
    // screen that over-flags costs one refused invocation, an under-flagging one costs a duplicate
    // test in the suite forever.
    const { TEXT_FALLBACK_SIMILARITY_THRESHOLD } = await import('../adds-value.js')
    expect(DEDUP_REFUSE_SIMILARITY_THRESHOLD).toBeLessThan(TEXT_FALLBACK_SIMILARITY_THRESHOLD)
  })

  it.each(EXPECTATIONS.rows.map((row) => [row.id, row] as const))(
    'row %s reproduces its frozen vector',
    async (_id, row) => {
      const { dedupBeforeAuthor } = await loadDedup()
      const { intent, corpus } = inputsFor(row)
      const screening = dedupBeforeAuthor(intent, corpus)

      expect(screening.kind, row.rationale).toBe(row.expected)
      expect(screening.comparedTests).toBe(row.comparedTests)

      if (row.expected === 'no-duplicate') {
        if (row.comparedTests === 0) expect(screening.closest).toBeUndefined()
        else expect(screening.closest?.similarity).toBeCloseTo(row.score ?? 0, 10)
        return
      }

      // The refusal NAMES ITS EVIDENCE. Asserting only that a refusal occurred passes for a
      // refusal that named the wrong test, which is the failure this block exists to exclude.
      if (screening.kind !== 'duplicate') throw new Error('unreachable: arm checked above')
      const expectedMember = EXPECTATIONS.suiteMembers[row.matched ?? '']
      expect(expectedMember).toBeDefined()
      const expectedDocument = readDocument(expectedMember?.document ?? '')

      expect(screening.evidence.matched.filePath).toBe(expectedMember?.identityPath)
      expect(screening.evidence.matched.testName).toBe(expectedDocument.name)
      expect(screening.evidence.matchedRef)
        .toBe(`${expectedMember?.identityPath}::${expectedDocument.name}`)
      expect(screening.evidence.score).toBeCloseTo(row.score ?? 0, 10)
      expect(screening.evidence.sharedTokens).toBe(row.sharedTokens)
      expect(screening.evidence.threshold).toBe(EXPECTATIONS.threshold)
    },
  )

  it('names BOTH continuations on every refusal, out of one closed vocabulary', async () => {
    const { dedupBeforeAuthor, DEDUP_CONTINUATIONS } = await loadDedup()
    const row = rowNamed('obvious-duplicate')
    const { intent, corpus } = inputsFor(row)
    const screening = dedupBeforeAuthor(intent, corpus)

    if (screening.kind !== 'duplicate') throw new Error('the obvious duplicate must refuse')
    // D-04: refuse-and-link carries the two named continuations. Two, not "at least one" -- a
    // refusal offering only "extend that test" cannot be acted on by an author whose draft is a
    // different assertion about the same flow.
    expect(DEDUP_CONTINUATIONS).toHaveLength(2)
    expect(screening.continuations).toEqual([...DEDUP_CONTINUATIONS])
    expect(DEDUP_CONTINUATIONS.join(' ')).toContain('extend')
    expect(DEDUP_CONTINUATIONS.join(' ')).toContain('assertion')
  })

  it('refuses through a NAMED error class carrying the same evidence', async () => {
    const { dedupBeforeAuthor, NearDuplicateRefusedError } = await loadDedup()
    const row = rowNamed('obvious-duplicate')
    const { intent, corpus } = inputsFor(row)
    const screening = dedupBeforeAuthor(intent, corpus)
    if (screening.kind !== 'duplicate') throw new Error('the obvious duplicate must refuse')

    const error = new NearDuplicateRefusedError(screening.evidence, screening.continuations)
    expect(error.name).toBe('NearDuplicateRefusedError')
    expect(error).toBeInstanceOf(Error)
    // The message NAMES the match rather than reporting that something matched.
    expect(error.message).toContain('demo/init/tests/uat-381-local-form.yaml')
    expect(error.message).toContain('Sign in on the local account form')
    expect(error.message).toContain('0.5')
    expect(error.evidence).toEqual(screening.evidence)
  })
})

describe('one scorer, not two', () => {
  it('reports the score adds-value.ts produces for the same pair, not a copy of it', async () => {
    const { dedupBeforeAuthor } = await loadDedup()
    // The shared vector: the obvious duplicate against the member it duplicates. If dedup.ts ever
    // grows its own tokenizer or its own Jaccard, the two readings drift and this cell is what
    // notices -- the key link is an import, and an import is what this asserts the behaviour of.
    const entry = suiteEntry('uat-381-local-form')
    const intent = intentTextOf('intents/duplicate.yaml')
    const direct = textSimilarity({ testName: intent, steps: [] }, entry)

    const screening = dedupBeforeAuthor(intent, [entry])
    if (screening.kind !== 'duplicate') throw new Error('the obvious duplicate must refuse')
    expect(screening.evidence.score).toBe(direct)
  })

  it('inherits the two-empty-texts rule rather than re-deriving it', async () => {
    const { dedupBeforeAuthor } = await loadDedup()
    const empty = textSimilarity({ testName: '', steps: [] }, EMPTY_TEXT_ENTRY)
    expect(empty).toBe(0)
    const screening = dedupBeforeAuthor('', [EMPTY_TEXT_ENTRY])
    expect(screening.kind).toBe('no-duplicate')
    expect(screening.closest?.similarity).toBe(0)
  })
})
