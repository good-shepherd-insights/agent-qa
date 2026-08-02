// The dual-posture entity-resolution corpus (Phase 387, D-08 / ENTY-01's validation clause).
//
// WHAT IS REAL HERE AND WHAT IS NOT
//
// Real: the addressing ledger (its own sqlite file), the entity index projection, `lexicalLeg`
// over FTS5, `denseLeg` over stored vectors, `fuseWeightedRrf`, and `resolveEntityRef` — the
// same entry every surface calls. Nothing is stubbed between the query and the answer.
//
// Not real: the embedding model. It is replaced by the fixture's authored geometry, because
// D-08 requires the corpus to run in CI with no live stores and a floor host has no model at
// all. See the fixture's header for how a cosine is computed by hand there.
//
// THE TWO POSTURES, AND WHY NEITHER SETS A FLAG
//
// `hybrid.ts` has no posture switch by design: `hasDenseCandidates` skips the dense leg when
// nothing is embedded, and an absent leg contributes nothing to the fusion. So the floor
// posture here is built by NOT embedding — which is what a host without a model actually looks
// like — rather than by telling the resolver which rung to run. A posture the test selects is a
// posture the test can get wrong; a posture that falls out of the data cannot.

import { randomUUID } from 'node:crypto'
import { readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  DEFAULT_EMBEDDING_PROFILE,
  formatEntityUri,
  formatOrdinalShortId,
  formatSlugShortId,
  isSlugAddressedKind,
  type EntityKind,
  type EntityResolution,
} from '@vostride/agent-qa-schema'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { openAddressingLedger, type AddressingLedger } from '../../addressing/ledger.js'
import type { EmbedderPort } from '../../embedder-port.js'
import {
  embedPendingEntities,
  openEntityIndex,
  type EntityIndexHandle,
} from '../../entity-index/entity-index.js'
import { renderEntityForEmbedding } from '../../entity-index/renderings.js'
import {
  resolveEntityRef,
  type EntitySighting,
  type EntitySightingSource,
  type ResolveEntityRefDeps,
} from '../resolve.js'
import {
  CORPUS_CASES,
  CORPUS_CATEGORIES,
  CORPUS_ENTITIES,
  CORPUS_RESERVED_BUG_MACHINE_IDS,
  corpusVector,
  entityAxes,
  type CorpusCase,
  type CorpusEntity,
} from './fixtures/entity-corpus.js'
import {
  CORPUS_POSTURES,
  corpusReportPath,
  reportShapeProblems,
  writeCorpusReport,
  type CorpusCaseRow,
  type CorpusPosture,
  type CorpusReport,
} from './corpus-report.js'
import { C_RRF } from '../../retrieval/constants.js'
import {
  RESOLVER_CANDIDATE_K,
  RESOLVER_FUSED_SCORE_NORMALIZER,
  RESOLVER_LEG_WEIGHT_DENSE,
  RESOLVER_LEG_WEIGHT_LEXICAL,
  RESOLVER_LEXICAL_MIN_BM25,
  RESOLVER_STRONG_HIT_MARGIN,
  RESOLVER_STRONG_HIT_MIN_SCORE,
} from '../constants.js'

const DIM = DEFAULT_EMBEDDING_PROFILE.dim

/** The pinned rule the report's rows were decided under, logged beside them. */
function corpusConstants(): Record<string, number> {
  return {
    RESOLVER_STRONG_HIT_MIN_SCORE,
    RESOLVER_STRONG_HIT_MARGIN,
    RESOLVER_FUSED_SCORE_NORMALIZER,
    RESOLVER_LEG_WEIGHT_LEXICAL,
    RESOLVER_LEG_WEIGHT_DENSE,
    RESOLVER_LEXICAL_MIN_BM25,
    RESOLVER_CANDIDATE_K,
    C_RRF,
    tau_dense: DEFAULT_EMBEDDING_PROFILE.tau_dense,
  }
}

// ---------------------------------------------------------------------------------------------
// The fixture, turned into the three things the resolver needs: sighting sources, an index, and
// an embedder. Everything below is derived from the fixture and nothing is hand-maintained
// beside it.
// ---------------------------------------------------------------------------------------------

/** The short-ID the ledger will mint, derived from this array's order. */
function expectedShortId(machineId: string): string {
  const target = entityOf(machineId)
  if (isSlugAddressedKind(target.kind)) return formatSlugShortId(target.kind, target.machineId)

  let ordinal = 0
  for (const entity of CORPUS_ENTITIES) {
    if (entity.kind !== target.kind) continue
    ordinal += 1
    if (entity.machineId === machineId) return formatOrdinalShortId(target.kind, ordinal)
  }
  throw new Error(`the corpus never reaches ${JSON.stringify(machineId)}`)
}

function entityOf(machineId: string): CorpusEntity {
  const found = CORPUS_ENTITIES.find((entity) => entity.machineId === machineId)
  if (found === undefined) {
    throw new Error(`the corpus holds no entity with machine id ${JSON.stringify(machineId)}`)
  }
  return found
}

function sightingSources(): EntitySightingSource[] {
  const kinds = [...new Set(CORPUS_ENTITIES.map((entity) => entity.kind))]
  const sources = kinds.map((kind): EntitySightingSource => {
    const own = new Map(
      CORPUS_ENTITIES
        .filter((entity) => entity.kind === kind)
        .map((entity): [string, EntitySighting] => [entity.machineId, {
          machineId: entity.machineId,
          title: entity.title,
          statusSource: entity.statusSource ?? 'active',
        }]),
    )
    const sight = (machineId: string): EntitySighting | undefined => own.get(machineId)
    return { kind, sight, hydrate: sight }
  })

  // The reserved family, which SIGHTS but never mints (D-03). Registered like any other source
  // so the refusal is produced by the resolver's own ladder rather than by this test's absence.
  const bugs = new Map(CORPUS_RESERVED_BUG_MACHINE_IDS.map((machineId): [string, EntitySighting] => [
    machineId,
    { machineId, title: `reserved issue ${machineId}`, statusSource: 'reserved' },
  ]))
  const sightBug = (machineId: string): EntitySighting | undefined => bugs.get(machineId)
  sources.push({ kind: 'BUG', sight: sightBug, hydrate: sightBug })
  return sources
}

/** Rendering text and query text to the fixture's authored vectors. Unknown text is loud. */
function corpusEmbedder(): EmbedderPort {
  const vectors = new Map<string, Float32Array>()
  for (const entity of CORPUS_ENTITIES) {
    vectors.set(
      renderEntityForEmbedding({
        kind: entity.kind,
        shortId: expectedShortId(entity.machineId),
        uri: formatEntityUri(entity.kind, expectedShortId(entity.machineId)),
        machineId: entity.machineId,
        title: entity.title,
        statusSource: entity.statusSource ?? 'active',
      }),
      corpusVector(entityAxes(entity), DIM),
    )
  }
  for (const testCase of CORPUS_CASES) {
    if (testCase.axes === undefined) continue
    vectors.set(queryOf(testCase), corpusVector(testCase.axes, DIM))
  }
  const lookup = async (text: string): Promise<Float32Array> => {
    const found = vectors.get(text)
    // A missing vector is a fixture defect, not a resolver outcome. Answering with zeros would
    // turn an unauthored case into a silently plausible one.
    if (found === undefined) throw new Error(`the corpus authored no vector for ${JSON.stringify(text)}`)
    return found
  }
  return { embedDocument: lookup, embedQuery: lookup }
}

/** The reference as it is actually put to the resolver. */
function queryOf(testCase: CorpusCase): string {
  const { ref } = testCase
  switch (ref.form) {
    case 'text':
    case 'literal':
      return ref.text
    case 'short-id':
      return expectedShortId(ref.entity)
    case 'uri':
      return formatEntityUri(entityOf(ref.entity).kind, expectedShortId(ref.entity))
    case 'machine-id':
      return ref.entity
  }
}

interface Posture {
  readonly name: CorpusPosture
  readonly deps: ResolveEntityRefDeps
  readonly index: EntityIndexHandle
  close(): void
}

/**
 * Seed one posture: mint every address by sighting, project, and embed only for `full`.
 *
 * Sighting is what mints AND projects (D-01/D-06), so the corpus is built the way a running
 * system builds one — no direct writes to the ledger or the index anywhere in this file.
 */
async function seedPosture(root: string, name: CorpusPosture): Promise<Posture> {
  const ledger = openAddressingLedger({ path: join(root, `${name}-addresses.db`) })
  const index: EntityIndexHandle = openEntityIndex({ path: join(root, `${name}-index.db`) })
  const embedder = corpusEmbedder()
  const deps: ResolveEntityRefDeps = {
    ledger,
    sources: sightingSources(),
    entityIndex: index,
    ...(name === 'full' ? { embedder } : {}),
  }

  for (const entity of CORPUS_ENTITIES) {
    const outcome = await resolveEntityRef(entity.machineId, deps)
    if (outcome.kind !== 'resolved') {
      throw new Error(`seeding ${entity.machineId} did not mint: ${JSON.stringify(outcome)}`)
    }
  }
  if (name === 'full') await embedPendingEntities(index, embedder)

  return {
    name,
    deps,
    index,
    close(): void {
      index.close()
      ledger.close()
    },
  }
}

function candidatesOf(resolution: EntityResolution): CorpusCaseRow['topScores'] {
  if (resolution.kind === 'resolved') {
    return [{
      shortId: resolution.descriptor.shortId,
      machineId: resolution.descriptor.machineId,
      score: resolution.score,
    }]
  }
  if (resolution.kind === 'ambiguous') {
    return resolution.candidates.map(({ descriptor, score }) => ({
      shortId: descriptor.shortId,
      machineId: descriptor.machineId,
      score,
    }))
  }
  return []
}

function rowFor(
  testCase: CorpusCase,
  posture: CorpusPosture,
  resolution: EntityResolution,
): CorpusCaseRow {
  return {
    caseId: testCase.id,
    category: testCase.category,
    posture,
    query: queryOf(testCase),
    outcome: resolution.kind,
    ...(resolution.kind === 'none' ? { reason: resolution.reason } : {}),
    ...(resolution.kind === 'resolved' ? { resolved: resolution.descriptor.machineId } : {}),
    topScores: candidatesOf(resolution),
  }
}

// ---------------------------------------------------------------------------------------------
// One execution of the whole corpus, shared by every assertion below. Running it once and
// asserting many times is what keeps the two postures comparable: every claim is about the same
// outcomes, not about two independent runs that happened to agree.
// ---------------------------------------------------------------------------------------------

interface CorpusRun {
  readonly outcomes: ReadonlyMap<string, EntityResolution>
  readonly rows: readonly CorpusCaseRow[]
}

function key(caseId: string, posture: CorpusPosture): string {
  return `${posture}:${caseId}`
}

async function runCorpus(postures: readonly Posture[]): Promise<CorpusRun> {
  const outcomes = new Map<string, EntityResolution>()
  const rows: CorpusCaseRow[] = []
  for (const posture of postures) {
    for (const testCase of CORPUS_CASES) {
      const resolution = await resolveEntityRef(queryOf(testCase), posture.deps)
      outcomes.set(key(testCase.id, posture.name), resolution)
      rows.push(rowFor(testCase, posture.name, resolution))
    }
  }
  return { outcomes, rows }
}

let root: string
let postures: Posture[]
let run: CorpusRun
let report: CorpusReport

beforeAll(async () => {
  root = join(tmpdir(), `entity-corpus-${randomUUID()}`)
  postures = []
  for (const name of CORPUS_POSTURES) postures.push(await seedPosture(root, name))
  run = await runCorpus(postures)
  report = {
    report: 'entity-resolution-corpus',
    schemaVersion: 1,
    entityCount: CORPUS_ENTITIES.length,
    caseCount: CORPUS_CASES.length,
    postures: CORPUS_POSTURES,
    constants: corpusConstants(),
    cases: run.rows,
  }
  writeCorpusReport(report)
}, 120_000)

afterAll(() => {
  for (const posture of postures) posture.close()
  rmSync(root, { recursive: true, force: true })
})

function outcome(caseId: string, posture: CorpusPosture): EntityResolution {
  const found = run.outcomes.get(key(caseId, posture))
  if (found === undefined) throw new Error(`the corpus run holds no ${posture} outcome for ${caseId}`)
  return found
}

describe('D-08 the corpus is a committed population, not a handful of examples', () => {
  it('holds at least a hundred entities spanning the five mintable kinds', () => {
    expect(CORPUS_ENTITIES.length).toBeGreaterThanOrEqual(100)

    const byKind = new Map<EntityKind, number>()
    for (const entity of CORPUS_ENTITIES) {
      byKind.set(entity.kind, (byKind.get(entity.kind) ?? 0) + 1)
    }
    expect([...byKind.keys()].sort()).toEqual(['MEM', 'POL', 'RUN', 'TGT', 'TST'])
    for (const [kind, count] of byKind) {
      expect({ kind, atLeastFive: count >= 5 }).toEqual({ kind, atLeastFive: true })
    }
    // The reserved family is present as REFERENCES and absent as entities: a build that cannot
    // mint a BUG address cannot have produced a BUG entity either (D-03).
    expect(CORPUS_ENTITIES.some((entity) => entity.kind === 'BUG')).toBe(false)
    expect(CORPUS_RESERVED_BUG_MACHINE_IDS.length).toBeGreaterThan(0)
  })

  it('holds at least a hundred query cases with five or more in every category', () => {
    expect(CORPUS_CASES.length).toBeGreaterThanOrEqual(100)

    for (const category of CORPUS_CATEGORIES) {
      const count = CORPUS_CASES.filter((testCase) => testCase.category === category).length
      expect({ category, atLeastFive: count >= 5 }).toEqual({ category, atLeastFive: true })
    }
    expect(new Set(CORPUS_CASES.map((testCase) => testCase.id)).size).toBe(CORPUS_CASES.length)
  })

  it('never seeds through anything but the sighting path', async () => {
    // The corpus is built by resolving each machine id, which is the mint-and-project seam
    // itself. Re-resolving one address must answer identically rather than mint a second.
    const first = await resolveEntityRef('checkout-happy-path', postures[0]!.deps)
    const second = await resolveEntityRef('checkout-happy-path', postures[0]!.deps)
    expect(second).toEqual(first)
    expect(first.kind === 'resolved' && first.descriptor.shortId).toBe(
      expectedShortId('checkout-happy-path'),
    )
  })
})

describe('D-08 every case is scored in both postures and the log says so', () => {
  it('logs one row per case per posture, in score order, on the reported scale', () => {
    expect(reportShapeProblems(report, CORPUS_CASES.map((testCase) => testCase.id))).toEqual([])
    expect(report.cases.length).toBe(CORPUS_CASES.length * CORPUS_POSTURES.length)
    expect(report.cases.length).toBeGreaterThanOrEqual(200)
  })

  it('would flag a report that lost a posture, a row, or its ordering', () => {
    // Positive controls. A shape check that has never rejected anything is not a check.
    const ids = CORPUS_CASES.map((testCase) => testCase.id)
    const withoutFloor: CorpusReport = {
      ...report,
      postures: ['full'],
      cases: report.cases.filter((row) => row.posture !== 'floor'),
    }
    expect(reportShapeProblems(withoutFloor, ids).length).toBeGreaterThan(0)
    expect(reportShapeProblems(withoutFloor, ids)[0]).toContain('posture')

    const withoutOneRow: CorpusReport = { ...report, cases: report.cases.slice(1) }
    expect(reportShapeProblems(withoutOneRow, ids).length).toBeGreaterThan(0)

    const ambiguous = report.cases.find((row) => row.topScores.length >= 2)
    expect(ambiguous).toBeDefined()
    const misordered: CorpusReport = {
      ...report,
      cases: report.cases.map((row) => (
        row === ambiguous ? { ...row, topScores: [...row.topScores].reverse() } : row
      )),
    }
    expect(reportShapeProblems(misordered, ids).some((problem) => problem.includes('score order')))
      .toBe(true)

    const lying: CorpusReport = {
      ...report,
      cases: report.cases.map((row) => (
        row.outcome === 'resolved' ? { ...row, resolved: undefined } : row
      )),
    }
    expect(lying.cases.some((row) => row.outcome === 'resolved')).toBe(true)
    expect(reportShapeProblems(lying, ids).some((problem) => problem.includes('without naming')))
      .toBe(true)
  })

  it('writes an artifact a later retune can read back', () => {
    const written = JSON.parse(readFileSync(corpusReportPath(), 'utf8')) as CorpusReport
    expect(written.cases.length).toBe(report.cases.length)
    expect(written.constants).toEqual(corpusConstants())
    expect(reportShapeProblems(written, CORPUS_CASES.map((testCase) => testCase.id))).toEqual([])
  })
})

describe('D-08 the corpus is deterministic', () => {
  it('answers a second full execution identically, outcome for outcome', async () => {
    const second = await runCorpus(postures)
    expect(second.rows).toEqual(run.rows)
  }, 120_000)

  it('mints the same addresses into a freshly seeded pair of postures', async () => {
    const otherRoot = join(tmpdir(), `entity-corpus-repeat-${randomUUID()}`)
    const other = await seedPosture(otherRoot, 'full')
    try {
      const sample = ['checkout-happy-path', 'r_visual_diff_review', 'pol_no_silent_skip', 'mobile-ios']
      for (const machineId of sample) {
        const resolution = await resolveEntityRef(machineId, other.deps)
        expect(resolution.kind === 'resolved' && resolution.descriptor.shortId)
          .toBe(expectedShortId(machineId))
      }
    } finally {
      other.close()
      rmSync(otherRoot, { recursive: true, force: true })
    }
  }, 120_000)
})
