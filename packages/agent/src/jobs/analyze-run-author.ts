// The whole-run analyze-run author (Phase 389, plan 04 — D-01/D-02/D-03, ANLZ-02).
//
// ONE `model.generate` call authors every unknown-verdict failure together (D-01): the
// author sees the cross-test pattern ("40 reds, one cause") that clustering and the
// discriminator feed on, matches the once-per-run heartbeat unit, and never fans out
// per test or adds a second LLM stage inside the one-checkpoint schedule.
//
// The model's answer is UNTRUSTED. It is parsed with the curator's deterministic repair
// idiom (fence strip, trailing-comma removal — COPIED from `cli/src/curation/
// curator-author.ts`, never imported: agent→cli is a banned direction), shaped by zod, and
// then validated cross-document by schema's `validateAnalysisAgainstHandoff`. Rejects feed
// exactly ONE repair round-trip (D-03) whose feedback names each failing test and reason;
// whatever still fails degrades to the deterministic unknown floor member for THAT test
// only — valid siblings persist, and job-level retries stay reserved for transport
// failures, which propagate out of this function uncaught.
//
// The merge law lives here and nowhere else: a floor verdict is replaced iff its class is
// `unknown` AND a validated author verdict exists for its perTest; everything else passes
// through byte-identical. `producer: 'analyze-run'` is forced code-side — model output
// never chooses producer.
//
// D-02's screenshot channel rides the same single request: when the capability advertises
// `vision` and a blob reader is bound and the post-compaction packs still carry
// screenshotRefs, the failing steps' decision-screenshot bytes attach as the request's
// optional `images`; every other posture is the L9 text-only degradation — a request
// structurally identical to the pre-widening text request. The repair round-trip reuses
// the same image set, never a re-fetch.
//
// The model arrives ONLY as the `JobModelCapability` argument the `recordLlmAuthorship`
// callback hands its author — this module never imports a provider SDK.

import type {
  AnalysisValidationOptions,
  ArtifactRef,
  CompletedRunHandoff,
  MisdirectionEvidence,
  MisdirectionRecordResult,
  MisdirectionRootPosture,
  PerTestOutcome,
  StepEvidence,
  Verdict,
  VerdictGroundingQuote,
  VerdictSentenceParts,
} from '@vostride/agent-qa-schema'
import {
  canonicalJson,
  CURRENT_ANALYSIS_SCHEMA_VERSION,
  deriveMemoryOnPath,
  deriveMemoryOnPathSites,
  failingStepOf,
  QUOTE_SEARCHED_STEP_FIELDS,
  validateAnalysisAgainstHandoff,
} from '@vostride/agent-qa-schema'
import { z } from 'zod'

import { buildTieredPrompt } from '../prompt/tiered-prompt-builder.js'
import type { PromptTierBlock } from '../prompt/tiered-prompt-builder.js'
import { compactEvidencePacks } from './evidence-diet.js'
import type {
  CompactedEvidence,
  EvidenceHistoryLookup,
  EvidencePack,
} from './evidence-diet.js'
import type { JobModelCapability, JobModelRequest } from './record-llm-authorship.js'

/**
 * The single in-attempt repair round-trip (D-03).
 *
 * Pinned, not config (386 D-15); retune from operational evidence: raise only if real
 * transcripts show a second repair regularly rescuing tests the first one could not —
 * every extra round-trip is a model call inside a job attempt whose transport failures
 * already carry their own 3-attempt bound.
 */
export const AUTHOR_REPAIR_CAP = 1

/**
 * The cap on decision-screenshot image parts attached to the one request (D-02).
 *
 * Pinned, not config (386 D-15); retune from operational evidence: raise if real
 * multi-failure transcripts show discriminating screenshots being cut at this cap, lower
 * if image payloads dominate request cost without moving verdict quality.
 */
export const MAX_AUTHOR_IMAGES = 6

// ---------------------------------------------------------------------------------------
// 422 D-17..D-20: the code-owned circularity stamp, applied BEFORE validation.
//
// The evidence a no-trust-change verdict rests on is produced by the pre-enqueue arbiter
// (422-14) and travels on the run's own handoff. It reaches a verdict through THIS function and
// through no other route: whatever the model answered about `memoryOnPath` or
// `misdirectionRuledOut` is overwritten, so an authored copy can never become authority.
//
// It lives beside the validator call it precedes rather than in the handler, because the
// ordering is the contract — a stamp applied after `validateAnalysisAgainstHandoff` would leave
// the gate deciding about a verdict that carries no evidence while the persisted artifact ends
// up carrying some, which is the one shape that looks right afterwards and was wrong at the
// instant it mattered.
// ---------------------------------------------------------------------------------------

export interface MisdirectionStampInput {
  readonly verdict: Verdict
  /** The verdict's sentence parts, when they exist — the grounding quote joins the path. */
  readonly parts: VerdictSentenceParts | undefined
  readonly test: PerTestOutcome | undefined
  /**
   * The run-level ledger the arbiter published, or ABSENT when it never ran. Absent is not
   * empty: a run with no member is a pre-422 run and nothing is stamped onto it at all.
   */
  readonly evidence: readonly MisdirectionRecordResult[] | undefined
  readonly rootPosture: MisdirectionRootPosture
}

/**
 * The steps a verdict's evidence touches — cited steps, the grounding quote's step, and the
 * run's ACTUAL failing step.
 *
 * The TWIN of `pathStepsOf` inside `schema/src/verdict/validate-analysis.ts`, which is module
 * private there. The two must agree: the stamp writes a `memoryOnPath` DECLARATION and the
 * validator recomputes membership over its own path, so a rule that drifted here would make
 * every stamped verdict disagree with its own recomputation. `misdirection-analysis.test.ts`
 * measures the agreement against the real validator — including the case where the author cites
 * a clean neighbour and never mentions the step that failed — rather than restating the rule.
 */
export function misdirectionPathSteps(
  verdict: Verdict,
  parts: VerdictSentenceParts | undefined,
  test: PerTestOutcome,
): StepEvidence[] {
  const indexes = new Set<number>(verdict.evidence.citedSteps)
  if (parts !== undefined && 'stepIndex' in parts.groundingQuote) {
    indexes.add(parts.groundingQuote.stepIndex)
  }
  const failing = failingStepOf(test)
  if (failing !== undefined) indexes.add(failing.stepIndex)
  return test.steps.filter((step) => indexes.has(step.stepIndex))
}

/**
 * The validator posture this run is entitled to (422-11's two fail-closed options).
 *
 * ABSENT evidence keeps the historical surface byte-for-byte: `{}` is what every caller passed
 * before 422 and what `validateAnalysisAgainstHandoff` defaults to, so a run whose arbiter never
 * ran is validated exactly as it was. A PRESENT ledger — even an empty one — means the arbiter
 * ran and said something, which is what makes this run's producer a current gated one.
 */
export function misdirectionValidationOptions(
  evidence: readonly MisdirectionRecordResult[] | undefined,
  rootPosture: MisdirectionRootPosture,
): AnalysisValidationOptions {
  return evidence === undefined ? {} : { gatedProducerEvidence: true, rootPosture }
}

/** One exposure's key: the (step, record) pair, never the record alone. */
function exposureKey(stepIndex: number, recordId: string): string {
  return `${String(stepIndex)}\u001f${recordId}`
}

/**
 * The block's one-word summary, in precedence order: a flip outranks everything, an explicitly
 * inconclusive row outranks an incomplete ledger, and `held` requires EVERY exposure covered by a
 * held row. An uncovered exposure reads `not-run` here and stays individually visible in
 * `results` — and the aggregate the validator computes reads the ROWS, never this word, so a
 * summary can never be the thing that exonerates a verdict.
 */
function summarizeCrossCheck(
  rows: readonly MisdirectionRecordResult[],
  sites: readonly { readonly stepIndex: number; readonly recordId: string }[],
): MisdirectionEvidence['crossCheck'] {
  if (rows.some((row) => row.crossCheck === 'flipped')) return 'flipped'
  if (rows.some((row) => row.crossCheck === 'inconclusive')) return 'inconclusive'
  const covered = new Set(rows.map((row) => exposureKey(row.stepIndex, String(row.recordId))))
  const complete = sites.every((site) =>
    covered.has(exposureKey(site.stepIndex, String(site.recordId))),
  )
  return complete && rows.every((row) => row.crossCheck === 'held') ? 'held' : 'not-run'
}

/** Why an empty ledger is empty — D-19's two postures do not mean the same thing. */
function postureReason(posture: MisdirectionRootPosture): string | undefined {
  if (posture === 'no-eval-root') {
    return 'no evaluation root existed, so no record on this path could be cross-checked'
  }
  if (posture === 'broken-eval-root') {
    return 'the evaluation root could not be consulted, so no record on this path was cross-checked'
  }
  return undefined
}

/**
 * Stamp ONE verdict with the code-owned membership and the code-owned ledger.
 *
 * Three postures, and each is a different fact:
 *
 *   - the arbiter never ran (`evidence === undefined`): the verdict is returned byte-identical,
 *     because a run nobody measured is not a run this job may make new claims about;
 *   - it ran and this verdict's path carries no low-trust record: nothing is stamped, and a
 *     declaration the verdict arrived with is REMOVED rather than carried — there is no claim
 *     here to back, so a block would be an answer to a question nobody asked;
 *   - it ran and the path carries exposures: both members are replaced with values derived from
 *     the run's own served briefs and the published rows, filtered to THIS member and to THIS
 *     verdict's own exposures.
 *
 * The filter matters twice over. Rows for another member would be refused by the aggregate's key
 * integrity, and rows for an exposure this verdict's path does not contain would be refused as
 * "an exposure no served brief recorded on this path" — both correct refusals, and both avoidable
 * by handing the gate exactly the rows it is entitled to.
 */
export function stampVerdictMisdirectionEvidence(input: MisdirectionStampInput): Verdict {
  const { verdict, parts, test, evidence, rootPosture } = input
  if (evidence === undefined || test === undefined) return verdict

  const steps = misdirectionPathSteps(verdict, parts, test)
  const sites = deriveMemoryOnPathSites(steps)
  if (sites.length === 0) {
    if (verdict.memoryOnPath === undefined && verdict.misdirectionRuledOut === undefined) {
      return verdict
    }
    const bare = { ...verdict } as Record<string, unknown>
    delete bare.memoryOnPath
    delete bare.misdirectionRuledOut
    return bare as unknown as Verdict
  }

  const keys = new Set(sites.map((site) => exposureKey(site.stepIndex, String(site.recordId))))
  const rows = evidence.filter(
    (row) =>
      row.perTest === verdict.perTest && keys.has(exposureKey(row.stepIndex, String(row.recordId))),
  )
  const reason = postureReason(rootPosture)
  const block: MisdirectionEvidence = {
    crossCheck: summarizeCrossCheck(rows, sites),
    results: rows,
    ...(reason === undefined ? {} : { reason }),
    // D-19: the ONE exemption is ABSENCE, and only absence. A broken root publishes the same
    // empty ledger and earns nothing. The `rows.length === 0` clause is not belt-and-braces: the
    // validator answers on the backing BEFORE it reads the rows, so a marker beside a real ledger
    // would skip the ledger entirely.
    ...(rootPosture === 'no-eval-root' && rows.length === 0
      ? { backing: 'declared-only' as const }
      : {}),
  }
  return {
    ...verdict,
    memoryOnPath: deriveMemoryOnPath(steps),
    misdirectionRuledOut: block,
  } as Verdict
}

/** The flipped records a stamped block names — the only records harm may be attributed to. */
export function flippedRecordsOf(verdict: Verdict): string[] {
  const rows = verdict.misdirectionRuledOut?.results ?? []
  const records: string[] = []
  for (const row of rows) {
    if (row.crossCheck !== 'flipped') continue
    if (!records.includes(String(row.recordId))) records.push(String(row.recordId))
  }
  return records
}

export interface AuthorTokenBudget {
  readonly estimate: (text: string) => number
  readonly inputBudget: number
}

export interface AuthorRunAnalysisInput {
  readonly handoff: CompletedRunHandoff
  /** The deterministic floor exactly as the handler projects it — the merge base. */
  readonly floor: readonly Verdict[]
  /** One evidence pack per unknown member (plan 03's diet), pre-compaction. */
  readonly packs: readonly EvidencePack[]
  /** Per-test failure history for the context tier (D-08's input-for-reasoning). */
  readonly history: EvidenceHistoryLookup
  /**
   * D-01's TokenAccounting substrate entering as data. Absent → no compaction ladder
   * (rung 0, packs whole) — a host without accounting still authors, it just cannot
   * pre-shrink.
   */
  readonly tokenBudget?: AuthorTokenBudget
  /**
   * D-02's capability-gated screenshot bytes, sha-addressed. Absent ⇒ text-only per L9.
   */
  readonly readEvidenceBlob?: (sha: string) => Uint8Array | undefined
  /** The §1.4 `agent_context` parameter; defaults to the analyze-run provenance line. */
  readonly agentContext?: string
  /**
   * 422 D-17/D-20: the run-level circularity ledger the pre-enqueue arbiter published, exactly
   * as it reached the analysed handoff bytes.
   *
   * It enters the request as DATA — one context-tier block per analyzed member — and it enters
   * the gate as AUTHORITY, through {@link stampVerdictMisdirectionEvidence}, which overwrites
   * whatever the model answered about it. The author is still asked for
   * `memoryMisdirectionRuledOut`: the boolean is the author's own claim and the ledger is what
   * decides whether that claim is worth anything.
   *
   * ABSENT means the arbiter never ran, and absence is the whole of the transition guarantee —
   * the validator is then called with the historical options and no verdict is stamped at all.
   */
  readonly misdirectionEvidence?: readonly MisdirectionRecordResult[]
  /** D-19's posture; read only when a ledger is present. Fail-closed default: `'eval-root'`. */
  readonly rootPosture?: MisdirectionRootPosture
}

export interface AuthorRunAnalysisResult {
  /** The merged array: floor order, unknown members upgraded, all else byte-identical. */
  readonly verdicts: Verdict[]
  /** LLM sentence parts for the UPGRADED members only, joined by perTest (D-06). */
  readonly authoredParts: VerdictSentenceParts[]
  /** The D-01 ladder outcome, surfaced — `overBudget` is never swallowed. */
  readonly compaction: {
    readonly rung: CompactedEvidence['rung']
    readonly overBudget: boolean
    readonly estimatedTokens: number
  }
  /** Analyzed tests that failed validation after the single repair and kept their floor. */
  readonly degradedTests: number[]
  /**
   * For each degraded member, the cited steps of the LAST candidate the author built for it.
   *
   * The floor a refused member falls back to cites nothing, which is correct for a verdict that
   * asserts nothing — but the circularity disclosure is computed over the verdict's PATH, so a
   * floor with no citation discloses only the failing step's exposures. A claim refused because a
   * record on a cited step flipped would then land as an `unknown` beside a HELD ledger, having
   * forgotten the record that caused it. The handler unions these back in (422-15).
   */
  readonly degradedPaths: readonly {
    readonly perTest: number
    readonly citedSteps: readonly number[]
  }[]
  /**
   * What this authorship SPENT, recorded once (422 D-20).
   *
   * Once, because `recordLlmAuthorship` memoizes: a resumed job reads the recorded value and
   * never reaches this function, so the calls below can happen exactly one time across every
   * attempt of one job. Capped, because the loop runs at most `1 + AUTHOR_REPAIR_CAP` times
   * however persistent the answer is — the evidence-informed repair is the SAME budget the
   * parse-repair round-trip already had, never a second one bought by the ledger.
   */
  readonly usage: {
    readonly modelCalls: number
    readonly repairCalls: number
    /** The compaction ladder's estimate; `0` when no accounting substrate was injected. */
    readonly estimatedTokens: number
  }
}

// ---------------------------------------------------------------------------------------
// The wire contract: what the model is asked to return, and the zod shape that reads it.
// `class` and `confidence` are deliberately loose here — the closed union and the exact
// [0,1] bound are enforced per-test by `validateAnalysisAgainstHandoff`, so a wrong value
// becomes a NAMED per-test reject feeding the repair message instead of an opaque
// whole-output parse failure.
// ---------------------------------------------------------------------------------------

const GroundingQuoteWire = z.union([
  z.object({ stepIndex: z.number(), quote: z.string() }),
  z.object({ source: z.literal('test-outcome'), quote: z.string() }),
])

const AuthoredTestWire = z.object({
  testIndex: z.number(),
  class: z.string(),
  confidence: z.number(),
  memoryMisdirectionRuledOut: z.boolean(),
  citedSteps: z.array(z.number()),
  citedArtifacts: z.array(z.object({ id: z.string(), sha: z.string() })).default([]),
  rationale: z.string(),
  groundingQuote: GroundingQuoteWire,
  discriminator: z.string(),
  nextAction: z.string(),
  links: z.array(z.string()).default([]),
})

const AuthorOutputWire = z.object({
  tests: z.array(AuthoredTestWire),
  patternNote: z.string().optional(),
})

type AuthoredTestEntry = z.infer<typeof AuthoredTestWire>

/** One restatement of the output contract — the stable tier and the repair message share it. */
const OUTPUT_CONTRACT =
  'Return exactly ONE JSON object, no markdown fences, shaped {"tests": [...]} with one ' +
  'entry per analyzed test. Each entry carries: testIndex (number, copied from the ' +
  'evidence), class (one of test_bug, app_bug, environment, flake, config_error, ' +
  'llm_error, unknown, timeout — unknown is an honest abstention), confidence (a number ' +
  'inside [0, 1]), memoryMisdirectionRuledOut (boolean), citedSteps (array of stepIndex ' +
  'numbers you actually relied on), citedArtifacts (array of {id, sha} artifact refs, [] ' +
  'when none), rationale (your reasoning trace — advisory, never shown as the sentence), ' +
  'groundingQuote ({"stepIndex": n, "quote": s} quoting captured evidence VERBATIM, or ' +
  '{"source": "test-outcome", "quote": s} for a test with zero captured steps), ' +
  'discriminator (what distinguishes THIS failure), nextAction (the one concrete next ' +
  'step), and links (agentqa:// entity URIs, [] when none). An optional top-level ' +
  '"patternNote" string may describe a cross-test pattern.'

// ---------------------------------------------------------------------------------------
// Deterministic JSON repair — the curator-author idiom, copied (agent may not import cli).
// Fence strip, first-object extraction, trailing-comma removal; anything still unreadable
// throws and becomes a whole-output reject for every pending test.
// ---------------------------------------------------------------------------------------

function removeTrailingCommas(json: string): string {
  let output = ''
  let inString = false
  let escaped = false
  for (let index = 0; index < json.length; index += 1) {
    const char = json[index]!
    if (inString) {
      output += char
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') {
      inString = true
      output += char
      continue
    }
    if (char === ',') {
      let lookahead = index + 1
      while (/\s/.test(json[lookahead] ?? '')) lookahead += 1
      if (json[lookahead] === '}' || json[lookahead] === ']') continue
    }
    output += char
  }
  return output
}

function parseJsonWithRepair(text: string): unknown {
  const fenced = /```(?:json)?[ \t]*\r?\n?([\s\S]*?)```/i.exec(text)
  const source = (fenced?.[1] ?? text).trim()
  const objectStart = source.indexOf('{')
  if (objectStart < 0) throw new Error('no JSON object found in the output')

  const expectedClosers: Array<'}' | ']'> = []
  let inString = false
  let escaped = false
  let objectEnd = -1
  for (let index = objectStart; index < source.length; index += 1) {
    const char = source[index]!
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{') expectedClosers.push('}')
    else if (char === '[') expectedClosers.push(']')
    else if (char === '}' || char === ']') {
      const expected = expectedClosers.pop()
      if (expected !== char) throw new Error(`mismatched JSON delimiter ${char}`)
      if (expectedClosers.length === 0) {
        objectEnd = index
        break
      }
    }
  }
  if (inString) throw new Error('unterminated JSON string in the output')

  const candidate =
    objectEnd >= 0
      ? source.slice(objectStart, objectEnd + 1)
      : `${source.slice(objectStart)}${[...expectedClosers].reverse().join('')}`

  try {
    return JSON.parse(removeTrailingCommas(candidate))
  } catch {
    throw new Error('JSON parse failed after deterministic repair')
  }
}

// ---------------------------------------------------------------------------------------
// Prompt composition: plan 03's stages, composed — never reimplemented.
// ---------------------------------------------------------------------------------------

function stableTier(): PromptTierBlock[] {
  return [
    {
      title: 'Role',
      body:
        'You are the analyze-run verdict author. A test run has finished with failed ' +
        'member tests whose deterministic classifier found no signal; you classify each ' +
        'one from its captured evidence and author the typed parts of one honest sentence ' +
        'a QA engineer can act on. Never invent an observation: every groundingQuote must ' +
        'be a verbatim contiguous substring of the captured evidence you cite ' +
        `(searched fields: ${QUOTE_SEARCHED_STEP_FIELDS.join(', ')}).`,
    },
    { title: 'Output contract', body: OUTPUT_CONTRACT },
    {
      title: 'The four obligations',
      body:
        'For every analyzed test: (a) ground the sentence in a QUOTED observation from ' +
        'captured evidence; (b) state a discriminator — what distinguishes this failure ' +
        'from its neighbours, e.g. whether the same step passed on the previous build; ' +
        '(c) recurrence context is rendered LIVE by the product from recorded history — ' +
        'never bake counts into your prose; (d) recommend the one concrete next action.',
    },
    {
      title: 'Memory misdirection',
      body:
        'Each failing step shows the memory brief that was served to it. Before answering ' +
        'a class that moves no trust (app_bug, flake, environment, config_error) while ' +
        'candidate or low-trust memory was on the failing path, you must have explicitly ' +
        'ruled out that the served memory misdirected the run — set ' +
        'memoryMisdirectionRuledOut true only when the evidence supports it; otherwise ' +
        'answer unknown or a trust-moving class.',
    },
    {
      title: 'Cross-test patterns',
      body:
        'You see the WHOLE run at once on purpose. Look for one cause behind many reds — ' +
        'a shared failing element, route or infrastructure signal across tests — and let ' +
        'it inform each verdict and discriminator; note it in patternNote when present.',
    },
  ]
}

function historyLine(pack: EvidencePack, history: EvidenceHistoryLookup): string {
  const record = history({ filePath: pack.filePath, testName: pack.testName })
  if (record === undefined) {
    return `- test ${pack.testIndex} (${pack.testName}): no recorded history`
  }
  const window = record.lastOutcomes
    .map((entry) => `build ${entry.buildOrdinal}: ${entry.passed ? 'passed' : 'failed'}`)
    .join(', ')
  return (
    `- test ${pack.testIndex} (${pack.testName}): ${record.passes} passes, ` +
    `${record.failures} failures, ${record.heals} heals, flakeCount ${record.flakeCount}` +
    (window === '' ? '' : `; recent: ${window}`)
  )
}

/**
 * One cross-check row, rendered for the prompt (422 D-20).
 *
 * The row's identity digests are deliberately NOT rendered: they are integrity material for the
 * gate, they cost tokens, and an author cannot act on them. What an author can act on is which
 * record was checked, on which step, and what removing it did.
 */
function crossCheckLine(row: MisdirectionRecordResult): string {
  const samples = row.samples === undefined ? '' : `; k=${String(row.samples.k)}`
  const reason = row.reason === undefined ? '' : `; ${row.reason}`
  return (
    `- test ${String(row.perTest)}, step ${String(row.stepIndex)}, record ` +
    `${String(row.recordId)}: ${row.crossCheck}${reason}${samples}`
  )
}

/**
 * The arbiter's own answer about this run, as reasoning input (422 D-20).
 *
 * DATA, not an instruction. The block tells the author what the deterministic removal cross-check
 * measured for the records this run served on its failing paths; the author still answers
 * `memoryMisdirectionRuledOut` for itself, and the code still decides — after the author has
 * spoken — whether the ledger supports the class the author chose. Omitted entirely when the
 * arbiter never ran, so a pre-422 run's request is byte-identical to what it always was.
 */
function crossCheckTier(
  packs: readonly EvidencePack[],
  evidence: readonly MisdirectionRecordResult[] | undefined,
): PromptTierBlock[] {
  if (evidence === undefined) return []
  const analyzed = new Set(packs.map((pack) => pack.testIndex))
  const rows = evidence.filter((row) => analyzed.has(row.perTest))
  return [
    {
      title: 'Memory misdirection cross-check (reasoning input)',
      body:
        'The deterministic removal cross-check already ran for the low-trust records this run ' +
        'served on the failing paths below. `flipped` means removing the record changed the ' +
        'outcome — the served memory is implicated. `held` means it did not. `inconclusive` ' +
        'and `not-run` mean nothing was established:\n' +
        (rows.length === 0
          ? '- no record on an analyzed test\u2019s failing path was cross-checked'
          : rows.map(crossCheckLine).join('\n')),
    },
  ]
}

function contextTier(
  handoff: CompletedRunHandoff,
  packs: readonly EvidencePack[],
  history: EvidenceHistoryLookup,
  evidence: readonly MisdirectionRecordResult[] | undefined,
): PromptTierBlock[] {
  return [
    {
      title: 'Run facts',
      body:
        `Run ${String(handoff.runId)} on product scope ${handoff.scope.key} ` +
        `(build ${handoff.buildOrdinal}, ${handoff.executionContext}); aggregate verdict ` +
        `${handoff.aggregateVerdict}; ${handoff.tests.length} member tests, ` +
        `${packs.length} analyzed here (the unknown-verdict failures).`,
    },
    {
      title: 'Failure history (reasoning input)',
      body:
        'Recorded outcome history per analyzed test — evidence for flake-vs-app_bug ' +
        'reasoning, not prose to restate:\n' +
        packs.map((pack) => historyLine(pack, history)).join('\n'),
    },
    ...crossCheckTier(packs, evidence),
  ]
}

function volatileTier(packs: readonly EvidencePack[]): PromptTierBlock[] {
  return packs.map((pack) => ({
    title: `Test ${pack.testIndex}: ${pack.testName}`,
    body: canonicalJson(pack),
  }))
}

// ---------------------------------------------------------------------------------------
// The D-02 request gate: images attach iff vision + reader + surviving refs.
// ---------------------------------------------------------------------------------------

function collectImages(
  packs: readonly EvidencePack[],
  readEvidenceBlob: ((sha: string) => Uint8Array | undefined) | undefined,
  vision: boolean,
): Uint8Array[] {
  if (!vision || readEvidenceBlob === undefined) return []
  const seen = new Set<string>()
  const images: Uint8Array[] = []
  for (const pack of packs) {
    for (const ref of pack.screenshotRefs) {
      if (images.length >= MAX_AUTHOR_IMAGES) return images
      if (seen.has(ref.sha)) continue
      seen.add(ref.sha)
      const bytes = readEvidenceBlob(ref.sha)
      if (bytes === undefined) continue
      images.push(bytes)
    }
  }
  return images
}

// ---------------------------------------------------------------------------------------
// Candidate assembly and the merge law.
// ---------------------------------------------------------------------------------------

interface CandidatePair {
  readonly verdict: Verdict
  readonly parts: VerdictSentenceParts
}

/** Build the candidate pair for one wire entry — producer FORCED code-side (never the model). */
function candidateOf(entry: AuthoredTestEntry): CandidatePair {
  const citedArtifacts: ArtifactRef[] = entry.citedArtifacts.map((ref) => ({
    id: ref.id,
    sha: ref.sha,
  }))
  const verdict = {
    class: entry.class,
    producer: 'analyze-run',
    confidence: entry.confidence,
    evidence: {
      citedSteps: [...entry.citedSteps],
      citedAnchors: [],
      citedArtifacts,
      rationale: entry.rationale,
    },
    memoryMisdirectionRuledOut: entry.memoryMisdirectionRuledOut,
    perTest: entry.testIndex,
  } as Verdict
  const parts: VerdictSentenceParts = {
    perTest: entry.testIndex,
    groundingQuote: entry.groundingQuote as VerdictGroundingQuote,
    discriminator: entry.discriminator,
    nextAction: entry.nextAction,
    links: [...entry.links],
  }
  return { verdict, parts }
}

interface AttemptOutcome {
  readonly accepted: Map<number, CandidatePair>
  readonly rejects: { perTest: number; reason: string }[]
  /**
   * The cited steps of the candidate built for each pending test — accepted or refused.
   *
   * Kept because a REFUSED claim's citation is the only record of which steps the analysis was
   * actually about, and the floor it degrades to cites nothing. The circularity disclosure is
   * computed over a verdict's path, so a floor that forgot the citation would also forget every
   * exposure outside the failing step — including, in the worst case, the record that flipped.
   */
  readonly citedByTest: Map<number, readonly number[]>
}

/**
 * Parse one model answer and validate the candidates for the still-pending tests.
 * A whole-output parse failure rejects every pending test with one named reason; a
 * per-test validation failure rejects that test alone.
 */
function evaluateAttempt(
  text: string,
  pending: ReadonlySet<number>,
  input: AuthorRunAnalysisInput,
): AttemptOutcome {
  const handoff = input.handoff
  let entries: AuthoredTestEntry[]
  try {
    const wire = AuthorOutputWire.parse(parseJsonWithRepair(text))
    entries = wire.tests
  } catch (error) {
    const reason =
      'the output was not one parseable JSON object matching the contract: ' +
      (error instanceof Error ? error.message : String(error))
    return {
      accepted: new Map(),
      rejects: [...pending].map((perTest) => ({ perTest, reason })),
      citedByTest: new Map(),
    }
  }

  // First entry per testIndex wins; entries for tests outside the pending analyzed set are
  // discarded — the author upgrades unknown floor members ONLY, so a re-classing of a
  // deterministic member is not even a candidate.
  const byTest = new Map<number, AuthoredTestEntry>()
  for (const entry of entries) {
    if (!pending.has(entry.testIndex) || byTest.has(entry.testIndex)) continue
    byTest.set(entry.testIndex, entry)
  }

  const rejects: { perTest: number; reason: string }[] = []
  const candidates = new Map<number, CandidatePair>()
  const citedByTest = new Map<number, readonly number[]>()
  const testsByIndex = new Map(handoff.tests.map((test) => [test.testIndex, test]))
  const rootPosture = input.rootPosture ?? 'eval-root'
  for (const perTest of pending) {
    const entry = byTest.get(perTest)
    if (entry === undefined) {
      rejects.push({ perTest, reason: `the output carries no entry for testIndex ${perTest}` })
      continue
    }
    const pair = candidateOf(entry)
    citedByTest.set(perTest, [...pair.verdict.evidence.citedSteps])
    // THE STAMP GOES ON BEFORE THE GATE SEES THE CANDIDATE (422 D-17/D-18). Stamping after
    // validation would hand the gate a verdict carrying no evidence — which it would refuse for
    // the wrong reason, spending the one repair on a message the author cannot act on — and then
    // decorate the refused verdict afterwards. The evidence is code-owned either way; what the
    // ordering decides is whether the gate got to USE it.
    candidates.set(perTest, {
      ...pair,
      verdict: stampVerdictMisdirectionEvidence({
        verdict: pair.verdict,
        parts: pair.parts,
        test: testsByIndex.get(perTest),
        evidence: input.misdirectionEvidence,
        rootPosture,
      }),
    })
  }

  if (candidates.size > 0) {
    const ordered = [...candidates.values()]
    const validation = validateAnalysisAgainstHandoff(
      {
        schemaVersion: CURRENT_ANALYSIS_SCHEMA_VERSION,
        runId: String(handoff.runId),
        verdicts: ordered.map((pair) => pair.verdict),
        parts: ordered.map((pair) => pair.parts),
      },
      handoff,
      misdirectionValidationOptions(input.misdirectionEvidence, rootPosture),
    )
    if (!validation.ok) {
      const rejectedTests = new Set(validation.rejects.map((reject) => reject.perTest))
      rejects.push(...validation.rejects)
      for (const perTest of rejectedTests) candidates.delete(perTest)
    }
  }

  return { accepted: candidates, rejects, citedByTest }
}

function repairFeedback(rejects: readonly { perTest: number; reason: string }[]): string {
  return [
    '## Validation feedback',
    '',
    'Your previous output failed validation for the tests below. Return ONE corrected ' +
      'JSON object with an entry for EVERY analyzed test, correcting each named failure:',
    ...rejects.map((reject) => `- test ${reject.perTest}: ${reject.reason}`),
    '',
    OUTPUT_CONTRACT,
  ].join('\n')
}

/**
 * The author: compose plan 03's stages around ONE `model.generate` call, repair once,
 * degrade per test, merge upgrade-only-unknown. Transport failures propagate uncaught —
 * the job's declared bound adjudicates those, never this function.
 */
export async function authorRunAnalysis(
  model: JobModelCapability,
  input: AuthorRunAnalysisInput,
): Promise<AuthorRunAnalysisResult> {
  // The ladder runs iff the accounting substrate was injected; a host without it authors
  // over the packs whole (rung 0) — doc'd on `tokenBudget`.
  const compacted: CompactedEvidence =
    input.tokenBudget === undefined
      ? {
          packs: input.packs,
          rung: 0,
          overBudget: false,
          estimatedTokens: 0,
        }
      : compactEvidencePacks(input.packs, input.tokenBudget.estimate, input.tokenBudget.inputBudget)

  const unknownFloor = new Set(
    input.floor.filter((verdict) => verdict.class === 'unknown').map((verdict) => verdict.perTest),
  )
  // POST-compaction packs on purpose: rung 1 stripping the refs IS the ladder's text-only
  // degradation, so the vision gate must never re-read refs from the uncompacted packs.
  const analyzed = compacted.packs
    .map((pack) => pack.testIndex)
    .filter((testIndex) => unknownFloor.has(testIndex))

  const baseRequest = buildTieredPrompt({
    agent_context:
      input.agentContext ??
      'analyze-run: authoring root-cause verdicts and sentence parts for one completed run',
    stable: stableTier(),
    context: contextTier(input.handoff, compacted.packs, input.history, input.misdirectionEvidence),
    volatile: volatileTier(compacted.packs),
  })
  const images = collectImages(compacted.packs, input.readEvidenceBlob, model.vision === true)
  const request: JobModelRequest =
    images.length === 0 ? baseRequest : { ...baseRequest, images }

  const accepted = new Map<number, CandidatePair>()
  let pending = new Set(analyzed)
  let lastRejects: readonly { perTest: number; reason: string }[] = []
  const lastCited = new Map<number, readonly number[]>()
  let modelCalls = 0

  for (let attempt = 0; attempt <= AUTHOR_REPAIR_CAP && pending.size > 0; attempt += 1) {
    const attemptRequest: JobModelRequest =
      attempt === 0
        ? request
        : { ...request, prompt: `${request.prompt}\n\n${repairFeedback(lastRejects)}` }
    const output = await model.generate(attemptRequest)
    modelCalls += 1
    const outcome = evaluateAttempt(output.text, pending, input)
    for (const [perTest, cited] of outcome.citedByTest) lastCited.set(perTest, cited)
    for (const [perTest, pair] of outcome.accepted) accepted.set(perTest, pair)
    pending = new Set([...pending].filter((perTest) => !accepted.has(perTest)))
    lastRejects = outcome.rejects
  }

  // The merge law, in one place: replace iff the floor member is `unknown` AND a validated
  // candidate exists; every other member passes through byte-identical.
  const verdicts = input.floor.map((floorVerdict) => {
    if (floorVerdict.class !== 'unknown') return floorVerdict
    return accepted.get(floorVerdict.perTest)?.verdict ?? floorVerdict
  })
  const authoredParts = analyzed
    .filter((testIndex) => accepted.has(testIndex))
    .map((testIndex) => (accepted.get(testIndex) as CandidatePair).parts)

  return {
    verdicts,
    authoredParts,
    compaction: {
      rung: compacted.rung,
      overBudget: compacted.overBudget,
      estimatedTokens: compacted.estimatedTokens,
    },
    degradedTests: analyzed.filter((testIndex) => !accepted.has(testIndex)),
    degradedPaths: analyzed
      .filter((testIndex) => !accepted.has(testIndex))
      .map((perTest) => ({ perTest, citedSteps: lastCited.get(perTest) ?? [] })),
    usage: {
      modelCalls,
      repairCalls: Math.max(0, modelCalls - 1),
      estimatedTokens: compacted.estimatedTokens,
    },
  }
}
