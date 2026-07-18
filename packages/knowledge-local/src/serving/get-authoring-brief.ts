/**
 * Screenless authoring-brief assembly (ABRF-01/ABRF-02, D-13/D-15/D-16).
 *
 * The 4th serving channel: facts/cautions/procedures from already-hydrated store entries plus
 * projection-ranked exemplar TEST REFERENCES — no ScreenState anywhere in the signature. The
 * assembly is pure (snapshot inputs only, no wall-clock, no file reads) and deterministic on the
 * zero-embedder lexical floor: intent tokens drive the lexical relevance leg, `page:`/`flow:`
 * target anchors drive the anchor leg, and dense scores join only as an optional additive term.
 *
 * Locked tight-budget precedence (Pitfall 8 — deliberately NOT the run brief's L0-L2 tiers):
 * caution > procedure > exemplar > fact. Buckets admit in that order against one shared
 * admission ledger; once a bucket sheds anything, every lower-precedence bucket is shed whole,
 * so an exemplar can never be dropped before a fact at the same budget.
 */
import {
  asRecordId,
  canonicalJson,
  createServingAdmissionState,
  normalizeAnchor,
  servingRecordMetadata,
  tryAdmitServingRecord,
  type Anchor,
  type AuthoringBrief,
  type BriefLine,
  type CautionLine,
  type ExemplarTest,
  type IndexEntry,
  type ProcedureMatch,
  type ScopeKey,
  type ServingRecordMetadata,
} from '@vostride/agent-qa-schema'

import { applyDiversityCaps, type RerankEntry } from '../retrieval/rerank.js'
import {
  estimateRenderedServingCost,
  renderBriefLine,
  renderCautionLine,
} from './brief-render.js'
import { matchProcedure, type ProcedureMatchCandidate } from './get-procedure.js'

/**
 * PROVISIONAL exemplar cap (D-15's "~3-5"). Internal constitution value in the
 * retrieval/constants.ts style — never a config key; M3 owns calibration.
 */
export const AUTHORING_EXEMPLAR_CAP = 4

/** PROVISIONAL top-N procedures served to the authoring consumer (D-15). */
export const AUTHORING_PROCEDURE_CAP = 5

/**
 * PROVISIONAL bounded-excerpt budget in UTF-16 code units (D-16). The excerpt is title +
 * outcome outline composed from projection-known metadata — never test file content.
 */
export const AUTHORING_EXCERPT_CHAR_BUDGET = 240

/**
 * PROVISIONAL discount for never-run exemplars (D-15's ratified degraded posture): flagged
 * `unverifiedOutcomes`, discounted below any observed pass-rate signal, never dropped.
 */
const AUTHORING_UNVERIFIED_OUTCOMES_DISCOUNT = 0.25

/**
 * PROVISIONAL MMR diversity weight: each selection round penalizes a candidate by this factor
 * times its best anchor-key overlap share with already-selected exemplars.
 */
const AUTHORING_MMR_WEIGHT = 0.5

/**
 * Weight of the intent-text lexical signal inside relevance (PROVISIONAL). Anchor overlap is
 * the primary signal; the lexical leg is secondary and additive on the zero-embedder floor.
 */
const AUTHORING_LEXICAL_WEIGHT = 0.5

/**
 * Weight of the optional dense-leg contribution (PROVISIONAL). Absent scores contribute
 * exactly zero so the lexical floor stays deterministic.
 */
const AUTHORING_DENSE_WEIGHT = 0.25

/** Hydrated store entry: `LoadedBundle`-backed entries satisfy this structurally. */
export type AuthoringEntryCandidate = ProcedureMatchCandidate

/** One run-outcome projection row (381-05 tables), read through the index reader connection. */
export interface AuthoringExemplarRow {
  filePath: string
  testName: string
  passes: number
  failures: number
  heals: number
  flakeCount: number
  quarantined: boolean
  /** Last-N window entries — ordinals only, wall-clock never. */
  lastOutcomes: readonly { buildOrdinal: number; passed: boolean }[]
  /** canonicalJson(normalizeAnchor(...)) keys — the ABRF-02 byte-deterministic encoding. */
  anchorKeys: readonly string[]
}

/** A test reference in the caller-supplied discovery universe (refs only, never content). */
export interface AuthoringTestRef {
  filePath: string
  testName: string
}

export interface AssembleAuthoringBriefInput {
  /** Already-hydrated entries; the reader's SQL scope ladder has applied the scope walls. */
  entries: readonly AuthoringEntryCandidate[]
  /** Per-test outcome counters + exercised-anchor sets from the run-outcome projection. */
  projectionRows: readonly AuthoringExemplarRow[]
  /**
   * D-15 never-run discovery universe: test references the CALLER knows about (the consumer
   * owns the filesystem; M4 passes its authored shelf, the M2 reader passes projection-known
   * identities). Refs absent from the projection surface flagged `unverifiedOutcomes`,
   * discounted, never dropped — and still work against an EMPTY projection.
   */
  knownTests?: readonly AuthoringTestRef[]
  intent: string
  scope: ScopeKey
  /** `page:`/`flow:` anchors derived from scope + intent by the caller — never a ScreenState. */
  targetAnchors: readonly Anchor[]
  budget: number
  /** Optional additive dense-leg scores keyed by record id, present only when an embedder is up. */
  denseScoreByRecordId?: ReadonlyMap<string, number>
}

function normalizedAnchorKey(anchor: Anchor): string {
  return canonicalJson(normalizeAnchor(anchor))
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function intentTokens(intent: string): string[] {
  return intent.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
}

/** Matched share of intent tokens against the candidate text on the lexical floor. */
function lexicalRelevance(tokens: readonly string[], text: string): number {
  if (tokens.length === 0) return 0
  const haystack = text.toLowerCase()
  return tokens.filter((token) => haystack.includes(token)).length / tokens.length
}

/** Matched share of the requested target anchors under normalized-key equality. */
function anchorOverlapShare(
  candidateKeys: ReadonlySet<string>,
  targetKeys: ReadonlySet<string>,
): number {
  if (targetKeys.size === 0) return 0
  let matched = 0
  for (const key of targetKeys) {
    if (candidateKeys.has(key)) matched += 1
  }
  return matched / targetKeys.size
}

/** Brief-eligible learned entries: active, or vetted candidates already annotated upstream. */
function isServableEntry(entry: IndexEntry, kind: 'fact' | 'caution'): boolean {
  if (entry.kind !== kind) return false
  if (entry.status === 'active') return true
  return entry.status === 'candidate' && entry.unverified === true
}

interface ScoredEntry {
  entry: IndexEntry
  score: number
}

function scoreEntries(
  input: AssembleAuthoringBriefInput,
  kind: 'fact' | 'caution',
  targetKeys: ReadonlySet<string>,
  tokens: readonly string[],
): ScoredEntry[] {
  return input.entries
    .flatMap(({ entry }): ScoredEntry[] => {
      if (!isServableEntry(entry, kind)) return []
      const candidateKeys = new Set(entry.anchors.map(normalizedAnchorKey))
      const dense = input.denseScoreByRecordId?.get(String(entry.id)) ?? 0
      const relevance = Math.min(
        1,
        anchorOverlapShare(candidateKeys, targetKeys)
          + AUTHORING_LEXICAL_WEIGHT * lexicalRelevance(tokens, `${entry.title}\n${entry.summary}`)
          + AUTHORING_DENSE_WEIGHT * dense,
      )
      if (relevance === 0) return []
      const trust = Number.isFinite(entry.trust) ? Math.max(0, entry.trust) : 0
      return [{ entry, score: trust * relevance }]
    })
    .sort((left, right) => (
      right.score - left.score
      || compareText(String(left.entry.id), String(right.entry.id))
    ))
}

/**
 * Top-N procedures through matchProcedure's own kind-aware admission and tier x confirmations x
 * fillability fold. Matches serve as hint-shaped entries — replay eligibility is irrelevant to
 * authoring — and the screenless call passes no binding names.
 */
function topProcedures(
  input: AssembleAuthoringBriefInput,
): ProcedureMatch[] {
  const matches: ProcedureMatch[] = []
  let remaining = [...input.entries]
  while (matches.length < AUTHORING_PROCEDURE_CAP) {
    const match = matchProcedure({
      entries: remaining,
      intent: input.intent,
      anchors: input.targetAnchors,
      bindingNames: [],
      ...(input.denseScoreByRecordId === undefined
        ? {}
        : { denseScoreByRecordId: input.denseScoreByRecordId }),
    })
    if (match === undefined) break
    matches.push(match)
    remaining = remaining.filter(({ entry }) => String(entry.id) !== String(match.id))
  }
  return matches
}

interface ExemplarCandidate {
  identity: string
  exemplar: ExemplarTest
  anchorKeys: ReadonlySet<string>
  score: number
}

function anchorDisplayText(anchor: Anchor): string {
  switch (anchor.t) {
    case 'page':
      return anchor.route
    case 'flow':
      return anchor.name
    default:
      return canonicalJson(anchor)
  }
}

function boundedExcerpt(parts: readonly string[]): string {
  return parts.filter((part) => part !== '').join(' — ').slice(0, AUTHORING_EXCERPT_CHAR_BUDGET)
}

function verifiedExemplarCandidate(
  row: AuthoringExemplarRow,
  targetKeys: ReadonlySet<string>,
  tokens: readonly string[],
): ExemplarCandidate[] {
  // D-15 hard excludes fire on OBSERVED negative signal only: the quarantine flake flag and a
  // last-N window with zero passes. (Store-status candidate/deprecated exclusion is vacuous in
  // M2 — tests are never memidex records; the clause activates if that ever changes.)
  if (row.quarantined) return []
  const windowPasses = row.lastOutcomes.filter(({ passed }) => passed).length
  if (row.lastOutcomes.length > 0 && windowPasses === 0) return []

  const rowKeys = new Set(row.anchorKeys)
  const relevance = Math.min(
    1,
    anchorOverlapShare(rowKeys, targetKeys)
      + AUTHORING_LEXICAL_WEIGHT * lexicalRelevance(tokens, `${row.testName} ${row.filePath}`),
  )
  if (relevance === 0) return []

  const recentPassRate = row.lastOutcomes.length > 0
    ? windowPasses / row.lastOutcomes.length
    : (row.passes + row.failures > 0 ? row.passes / (row.passes + row.failures) : 1)
  const matchedKeys = [...rowKeys].filter((key) => targetKeys.has(key)).sort()
  const matchedAnchors = matchedKeys.map((key) => JSON.parse(key) as Anchor)
  const total = row.passes + row.failures

  return [{
    identity: `${row.filePath}::${row.testName}`,
    anchorKeys: new Set(matchedKeys),
    // D-15 fold: trust (neutral 1 for projection-verified rows) x recent-pass-rate x relevance.
    score: recentPassRate * relevance,
    exemplar: {
      filePath: row.filePath,
      testName: row.testName,
      matchedAnchors,
      ...(total > 0 ? { passRate: row.passes / total } : {}),
      recentOutcomes: row.lastOutcomes.map(({ buildOrdinal, passed }) => (
        { buildOrdinal, passed }
      )),
      unverifiedOutcomes: false,
      excerpt: boundedExcerpt([
        row.testName,
        `outcomes ${row.passes} pass / ${row.failures} fail${
          row.heals > 0 ? ` (${row.heals} heals)` : ''}`,
        matchedAnchors.length > 0
          ? `anchors: ${matchedAnchors.map(anchorDisplayText).join(', ')}`
          : '',
      ]),
    },
  }]
}

function neverRunExemplarCandidate(
  ref: AuthoringTestRef,
  tokens: readonly string[],
): ExemplarCandidate[] {
  const relevance = lexicalRelevance(tokens, `${ref.testName} ${ref.filePath}`)
  if (relevance === 0) return []

  return [{
    identity: `${ref.filePath}::${ref.testName}`,
    anchorKeys: new Set<string>(),
    // Neutral trust, no observed pass-rate: discounted below verified rows, never dropped.
    score: AUTHORING_UNVERIFIED_OUTCOMES_DISCOUNT * relevance,
    exemplar: {
      filePath: ref.filePath,
      testName: ref.testName,
      matchedAnchors: [],
      unverifiedOutcomes: true,
      excerpt: boundedExcerpt([
        ref.testName,
        'unverified-outcomes: no completed-run evidence yet',
      ]),
    },
  }]
}

function exemplarRerankEntry(
  candidate: ExemplarCandidate,
  scope: ScopeKey,
): RerankEntry & { candidate: ExemplarCandidate } {
  return {
    candidate,
    bundleId: candidate.identity,
    validityClass: 'current',
    trust: candidate.score,
    scope,
    recencyOrdinal: 0,
    createdAtOrdinal: 0,
    originClass: 'agent',
    anchors: candidate.exemplar.matchedAnchors,
    subtype: null,
    lastConfirmedOrdinal: 0,
  }
}

function mmrOverlapPenalty(
  candidate: ExemplarCandidate,
  selected: readonly ExemplarCandidate[],
): number {
  if (candidate.anchorKeys.size === 0) return 0
  let best = 0
  for (const other of selected) {
    let matched = 0
    for (const key of candidate.anchorKeys) {
      if (other.anchorKeys.has(key)) matched += 1
    }
    best = Math.max(best, matched / candidate.anchorKeys.size)
  }
  return best
}

/**
 * The no-analog exemplar bucket composed from parts: anchor-overlap scoring on the projection's
 * normalized keys, per-anchor diversity via applyDiversityCaps, then greedy MMR selection.
 */
function selectExemplars(
  input: AssembleAuthoringBriefInput,
  targetKeys: ReadonlySet<string>,
  tokens: readonly string[],
): ExemplarTest[] {
  const projectionIdentities = new Set(
    input.projectionRows.map((row) => `${row.filePath}::${row.testName}`),
  )
  const candidates = [
    ...input.projectionRows.flatMap((row) =>
      verifiedExemplarCandidate(row, targetKeys, tokens)),
    ...(input.knownTests ?? []).flatMap((ref) =>
      projectionIdentities.has(`${ref.filePath}::${ref.testName}`)
        ? []
        : neverRunExemplarCandidate(ref, tokens)),
  ].sort((left, right) => (
    right.score - left.score || compareText(left.identity, right.identity)
  ))

  const diverse = applyDiversityCaps(
    candidates.map((candidate) => exemplarRerankEntry(candidate, input.scope)),
  ).map(({ candidate }) => candidate)

  const selected: ExemplarCandidate[] = []
  const pool = [...diverse]
  while (selected.length < AUTHORING_EXEMPLAR_CAP && pool.length > 0) {
    let bestIndex = 0
    let bestValue = Number.NEGATIVE_INFINITY
    for (const [index, candidate] of pool.entries()) {
      const value = candidate.score
        - AUTHORING_MMR_WEIGHT * mmrOverlapPenalty(candidate, selected)
      if (
        value > bestValue
        || (value === bestValue
          && compareText(candidate.identity, pool[bestIndex]!.identity) < 0)
      ) {
        bestIndex = index
        bestValue = value
      }
    }
    selected.push(...pool.splice(bestIndex, 1))
  }
  return selected.map(({ exemplar }) => exemplar)
}

function exemplarRecordId(exemplar: ExemplarTest): string {
  return `exemplar:${exemplar.filePath}::${exemplar.testName}`
}

interface ServableItem {
  metadata: ServingRecordMetadata
  serve: () => void
}

/**
 * Pure screenless assembly over already-loaded snapshot inputs. Retrieval SQL, hydration,
 * budgets-as-plain-numbers, and the projection read all live at the composition boundary
 * (`createAuthoringReader`); nothing here touches a connection, the clock, or the filesystem.
 */
export function assembleAuthoringBrief(input: AssembleAuthoringBriefInput): AuthoringBrief {
  const targetKeys = new Set(input.targetAnchors.map(normalizedAnchorKey))
  const tokens = intentTokens(input.intent)

  const cautions: CautionLine[] = []
  const cautionItems: ServableItem[] = scoreEntries(input, 'caution', targetKeys, tokens)
    .map(({ entry }) => {
      const rendered = renderCautionLine(entry)
      return {
        metadata: servingRecordMetadata({
          id: entry.id,
          anchors: entry.anchors,
          renderedCost: rendered.cost,
        }),
        serve: () => cautions.push({
          id: entry.id,
          anchors: entry.anchors,
          summary: rendered.summary,
        }),
      }
    })

  const procedures: ProcedureMatch[] = []
  const procedureItems: ServableItem[] = topProcedures(input).map((match) => ({
    metadata: servingRecordMetadata({
      id: match.id,
      anchors: [match.flowAnchor],
      renderedCost: estimateRenderedServingCost(canonicalJson(match)),
    }),
    serve: () => procedures.push(match),
  }))

  const exemplars: ExemplarTest[] = []
  const exemplarItems: ServableItem[] = selectExemplars(input, targetKeys, tokens)
    .map((exemplar) => ({
      metadata: servingRecordMetadata({
        id: asRecordId(exemplarRecordId(exemplar)),
        anchors: exemplar.matchedAnchors,
        renderedCost: estimateRenderedServingCost(canonicalJson(exemplar)),
      }),
      serve: () => exemplars.push(exemplar),
    }))

  const facts: BriefLine[] = []
  const factItems: ServableItem[] = scoreEntries(input, 'fact', targetKeys, tokens)
    .map(({ entry }) => {
      const rendered = renderBriefLine(entry)
      return {
        metadata: servingRecordMetadata({
          id: entry.id,
          anchors: entry.anchors,
          renderedCost: rendered.cost,
        }),
        serve: () => facts.push(rendered.briefLine),
      }
    })

  // Locked shed order: admit caution -> procedure -> exemplar -> fact against ONE ledger; a shed
  // in any bucket closes every lower-precedence bucket so facts always drop first.
  const admission = createServingAdmissionState()
  const admissions: ServingRecordMetadata[] = []
  let eligible = 0
  let served = 0
  let closed = false
  for (const bucket of [cautionItems, procedureItems, exemplarItems, factItems]) {
    eligible += bucket.length
    if (closed) continue
    let bucketShed = false
    for (const item of bucket) {
      if (!tryAdmitServingRecord({
        record: item.metadata,
        budget: input.budget,
        recordCap: Number.POSITIVE_INFINITY,
      }, admission).admitted) {
        bucketShed = true
        continue
      }
      item.serve()
      admissions.push(item.metadata)
      served += 1
    }
    if (bucketShed) closed = true
  }

  return {
    exemplars,
    procedures,
    facts,
    cautions,
    coverage: {},
    truncation: served < eligible ? `truncated ${served} of ${eligible}` : '',
    admissions,
  }
}
