// The suite-fingerprint table: gate 3's comparison substrate (Phase 393, D-15 · WTST-06).
//
// A SIBLING of `run-outcomes.ts` inside the same derived-index discipline, not a new store. It
// lives in the gitignored index, is computed at the SAME post-run fold from the SAME handoff
// evidence, is keyed by the project-wide stable test identity (`filePath` + `testName`, never
// `testId`), and is reproduced byte-identically by the rebuild — which is why bumping
// `RUN_OUTCOMES_PROJECTION_VERSION` IS this table's migration (L12: derived state is disposable).
//
// WHAT A ROW IS. One `(product, filePath, testName, seq)` row per fingerprint element, where the
// element bytes are minted by schema's `actionAnchorElement` (D-13's v1 recipe). No element
// serialization exists in this package: a second spelling of "what is the same exercised surface"
// is exactly what the sibling-recipe design in `verdict/action-anchor-fingerprint.ts` exists to
// prevent, and gate 3 compares a draft's elements against these bytes.
//
// WHY THE ROWS CARRY `run_id` AND `build_ordinal`. "Latest evidence wins" has to mean something
// order-independent, or the incremental fold and the rebuild would disagree the moment two runs
// arrived in a different order than the rebuild scans them in (the rebuild sorts run dirs by
// name). The replacement rule is therefore a COMPARISON — a fold replaces an identity's rows only
// when its `(buildOrdinal, runId)` is strictly greater than what the table already holds — rather
// than a last-writer-wins overwrite. That makes the table CONVERGENT: any permutation of the same
// runs, and a full rebuild over them, land on the same rows. It is also why re-applying one run is
// a no-op without needing the applied-runs marker to make it one.
//
// THE EXCLUSION (WTST-06, Pitfall 8). A gate-run handoff must never seed the union it is later
// compared against — a draft would then be measured against its own evidence and every element
// would read as already covered. The production path enforces this WITHOUT a second read: the one
// `excludedFromOutcomes` read in `projectRunOutcomes` gates ONE member list, and both the outcome
// deltas and the fingerprint deltas are computed from that already-gated list. The standalone
// `foldSuiteFingerprints` door below takes the same decision as an argument for the same reason —
// this module does not re-decide a fact the fold already established.

import type { DatabaseSync } from 'node:sqlite'

import {
  actionAnchorElement,
  classifySubActionRoute,
  elementAnchor,
  resolvedElementEvidence,
} from '@vostride/agent-qa-schema'
import type {
  Anchor,
  CompletedRunHandoff,
  PerTestOutcome,
  StepEvidence,
  SubActionEvidence,
} from '@vostride/agent-qa-schema'

import { ensureRunOutcomeTables } from '../index-open.js'

/** The one table name, so the read port and every writer cannot spell it apart. */
export const SUITE_FINGERPRINTS_TABLE = 'suite_fingerprints'

/**
 * Which action types contribute an ASSERT element rather than an ACTION element (D-13).
 *
 * `kind` is the recipe's vocabulary discriminator: asserting a value on a field and typing into
 * it are different coverage facts about the same anchor, so they must key apart. The members are
 * the assert arms of `CommonAction` — the only action shapes whose purpose is a claim about the
 * app rather than a change to it. `extractAI` is deliberately absent: an extraction reads state
 * without asserting anything about it, so it covers surface the way an action does.
 *
 * Local rather than hoisted into schema on purpose: this is the FOLD's reading of the vocabulary,
 * and there is exactly one reader today. A second reader is the trigger to hoist it beside
 * `actionAnchorElement`, not before.
 */
const ASSERT_ACTION_TYPES: ReadonlySet<string> = new Set(['assertAI', 'assertValue'])

/** One test's ordered fingerprint elements, keyed by the stable identity. */
export interface SuiteFingerprintTestDelta {
  filePath: string
  testName: string
  /** `actionAnchorElement` bytes, in exercised order. Never empty — see `testFingerprint`. */
  elements: string[]
}

/** The row set one run contributes, plus the provenance the replacement rule compares on. */
export interface SuiteFingerprintsProjection {
  product: string
  runId: string
  buildOrdinal: number
  tests: SuiteFingerprintTestDelta[]
}

export interface FoldSuiteFingerprintsOptions {
  /**
   * The projection partition — `projectionPartition(handoff.scope).product`. Supplied by the
   * caller so this module never re-spells the partition law that `run-outcomes.ts` owns (and so
   * the two modules do not have to import each other).
   */
  product: string
  /**
   * The `excludedFromOutcomes` decision, CARRIED rather than re-read. See the exclusion note in
   * this module's header: a gate-run contributes no rows.
   */
  excluded: boolean
}

/**
 * The anchor one sub-action exercised, or `undefined` when it exercised nothing nameable.
 *
 * Both arms route through schema's own shipped walk rather than re-deriving element resolution:
 * `resolvedElementEvidence` is the ONE implementation of "which element did this ref resolve to
 * on the pre-action screen" (389 D-13's promotion), and it is reached here by handing it a step
 * narrowed to a single sub-action, which is the same reach-the-contract-through-its-public-door
 * idiom the fingerprint recipe uses for route normalization.
 *
 * Falling back to the page anchor is what lets an assertion with no element target — `assertValue`
 * over the URL, the canonical case — still contribute coverage. A sub-action with neither an
 * element nor a route contributes nothing, which is the evidence-less case D-16's text lane
 * catches at the consumer.
 */
function subActionAnchor(step: StepEvidence, subAction: SubActionEvidence): Anchor | undefined {
  const [resolved] = resolvedElementEvidence({ ...step, subActions: [subAction] })
  if (resolved !== undefined) return elementAnchor(resolved)
  const { route } = classifySubActionRoute(subAction)
  return route === undefined ? undefined : { t: 'page', route }
}

/**
 * The ordered elements one test exercised, or `[]` when its evidence yields none.
 *
 * ONLY SUCCEEDED SUB-ACTIONS COUNT. `result.success !== true` means the planned action did not
 * run to an accepted result, and a surface an action failed to reach is not surface the test
 * covers. The draft's own fingerprint is computed by this same function at the consumer, so both
 * sides of gate 3's comparison filter identically — the risk of an asymmetric filter (a draft
 * measured generously against a suite measured strictly) is what makes single-sourcing this rule
 * matter more than which way it is tuned.
 *
 * A route is attached as CONTEXT only to element anchors. A page anchor already IS its route, so
 * repeating it would mint two spellings of one fact.
 */
export function testFingerprintElements(test: PerTestOutcome): string[] {
  const elements: string[] = []
  for (const step of test.steps ?? []) {
    for (const subAction of step.subActions ?? []) {
      if (subAction.result?.success !== true) continue
      const anchor = subActionAnchor(step, subAction)
      if (anchor === undefined) continue
      const type = subAction.plannedAction.type
      const { route } = classifySubActionRoute(subAction)
      elements.push(actionAnchorElement({
        kind: ASSERT_ACTION_TYPES.has(type) ? 'assert' : 'action',
        type,
        anchor,
        ...(anchor.t === 'el' && route !== undefined ? { route } : {}),
      }))
    }
  }
  return elements
}

/**
 * The per-identity deltas for a member list (pure).
 *
 * Takes MEMBERS rather than a handoff because the production caller has already applied the one
 * exclusion gate to them — see the exclusion note in the header. A test contributing zero
 * elements yields no delta at all, which is what stops an evidence-less run from ERASING an
 * identity's accumulated coverage: the union only ever moves through evidence.
 */
export function suiteFingerprintDeltas(
  members: readonly PerTestOutcome[],
): SuiteFingerprintTestDelta[] {
  const byIdentity = new Map<string, SuiteFingerprintTestDelta>()
  for (const member of members) {
    const elements = testFingerprintElements(member)
    if (elements.length === 0) continue
    // Within ONE run the same identity can appear more than once (a retried member). Later
    // evidence inside a single handoff wins, matching the cross-run rule below.
    byIdentity.set(`${member.filePath}\u0000${member.testName}`, {
      filePath: member.filePath,
      testName: member.testName,
      elements,
    })
  }
  return [...byIdentity.values()]
}

interface ExistingProvenance {
  build_ordinal: number
  run_id: string
}

/**
 * Whether incoming evidence supersedes what the table holds for one identity.
 *
 * Strictly greater, with `runId` as the tiebreak inside one build ordinal, so the answer does not
 * depend on which run folded first. Equality is deliberately NOT a supersession: re-applying the
 * same run rewrites nothing.
 */
function supersedes(
  incoming: { buildOrdinal: number; runId: string },
  existing: ExistingProvenance | undefined,
): boolean {
  if (existing === undefined) return true
  if (incoming.buildOrdinal !== existing.build_ordinal) {
    return incoming.buildOrdinal > existing.build_ordinal
  }
  return incoming.runId > existing.run_id
}

/**
 * Writer against the one index connection.
 *
 * Deliberately opens NO transaction of its own. On the production path it runs inside
 * `applyRunOutcomes`'s `BEGIN IMMEDIATE`, so the fingerprint rows and the outcome counters commit
 * or roll back together and the two tables can never describe different runs; SQLite has no
 * nested transactions, so a second `BEGIN IMMEDIATE` here would fail exactly on that path. Called
 * standalone it rides autocommit, which is sound because the replacement rule is convergent.
 */
export function applySuiteFingerprints(
  db: DatabaseSync,
  projection: SuiteFingerprintsProjection,
): number {
  const readProvenance = db.prepare(`
    SELECT build_ordinal, run_id
    FROM ${SUITE_FINGERPRINTS_TABLE}
    WHERE product = ? AND file_path = ? AND test_name = ?
    LIMIT 1
  `)
  const clearIdentity = db.prepare(`
    DELETE FROM ${SUITE_FINGERPRINTS_TABLE}
    WHERE product = ? AND file_path = ? AND test_name = ?
  `)
  const insertElement = db.prepare(`
    INSERT INTO ${SUITE_FINGERPRINTS_TABLE} (
      product, file_path, test_name, seq, element, run_id, build_ordinal
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `)

  let written = 0
  for (const test of projection.tests) {
    const existing = readProvenance.get(projection.product, test.filePath, test.testName) as
      | ExistingProvenance
      | undefined
    if (!supersedes(projection, existing)) continue
    clearIdentity.run(projection.product, test.filePath, test.testName)
    for (const [seq, element] of test.elements.entries()) {
      insertElement.run(
        projection.product,
        test.filePath,
        test.testName,
        seq,
        element,
        projection.runId,
        projection.buildOrdinal,
      )
      written += 1
    }
  }
  return written
}

/**
 * The standalone fold door: project one handoff's fingerprints and write them.
 *
 * The production path does NOT come through here — it folds both projections in one pass through
 * `projectRunOutcomes`/`applyRunOutcomes` so a single transaction and a single applied-runs marker
 * cover both tables. This entry exists for callers that hold a handoff and want only the
 * fingerprint half (the gate evaluator's own harness, and this module's corpus).
 */
export function foldSuiteFingerprints(
  db: DatabaseSync,
  handoff: CompletedRunHandoff,
  opts: FoldSuiteFingerprintsOptions,
): SuiteFingerprintsProjection {
  ensureRunOutcomeTables(db)
  const projection: SuiteFingerprintsProjection = {
    product: opts.product,
    runId: String(handoff.runId),
    buildOrdinal: handoff.buildOrdinal,
    tests: suiteFingerprintDeltas(opts.excluded ? [] : (handoff.tests ?? [])),
  }
  applySuiteFingerprints(db, projection)
  return projection
}

/**
 * The read port gate 3 consumes through composition (D-15).
 *
 * MINIMAL BY DESIGN. Conservatism lives in the normalizer (D-14), not here: this port answers
 * what the table holds and nothing more, so a later retune of "near-same elements normalize
 * equal" moves in exactly one place. There is no similarity verb here because there is no
 * similarity threshold to defend — gate 3's value test is set membership, spec §6.3 verbatim.
 */
export interface SuiteFingerprintIndex {
  /** The union D-14's novel-element test compares against. Empty table, empty union. */
  elementUnion(): Set<string>
  /**
   * The identities that HAVE fingerprint rows, sorted. The consumer subtracts these from the
   * authored-test universe to derive the evidence-less set that rides D-16's text lane — which is
   * why this port reports coverage rather than trying to enumerate the suite, a fact it does not
   * own and could only guess at.
   */
  coveredTests(): Array<{ filePath: string; testName: string }>
  /** One identity's elements in exercised order; `[]` for an identity with no rows. */
  elementsForTest(filePath: string, testName: string): string[]
}

export interface SuiteFingerprintIndexOptions {
  /**
   * The partition to read. REQUIRED rather than optional: an unscoped union would compare a draft
   * against another product's suite, and "everything in the table" is never the question gate 3 is
   * asking.
   */
  product: string
}

export function createSuiteFingerprintIndex(
  db: DatabaseSync,
  opts: SuiteFingerprintIndexOptions,
): SuiteFingerprintIndex {
  return {
    elementUnion() {
      const rows = db.prepare(`
        SELECT DISTINCT element FROM ${SUITE_FINGERPRINTS_TABLE} WHERE product = ?
      `).all(opts.product) as unknown as Array<{ element: string }>
      return new Set(rows.map((row) => row.element))
    },
    coveredTests() {
      const rows = db.prepare(`
        SELECT DISTINCT file_path, test_name FROM ${SUITE_FINGERPRINTS_TABLE}
        WHERE product = ?
        ORDER BY file_path, test_name
      `).all(opts.product) as unknown as Array<{ file_path: string; test_name: string }>
      return rows.map((row) => ({ filePath: row.file_path, testName: row.test_name }))
    },
    elementsForTest(filePath: string, testName: string) {
      const rows = db.prepare(`
        SELECT element FROM ${SUITE_FINGERPRINTS_TABLE}
        WHERE product = ? AND file_path = ? AND test_name = ?
        ORDER BY seq
      `).all(opts.product, filePath, testName) as unknown as Array<{ element: string }>
      return rows.map((row) => row.element)
    },
  }
}
