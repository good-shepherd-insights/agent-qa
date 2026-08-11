// The six-stage authoring loop (Phase 394, D-01/D-02 · WTST-01).
//
// ONE function takes a plain-English intent to a verified draft with a real receipt. The six
// stages are evaluated in THIS order, once each, and the order is the contract rather than an
// implementation detail — D-01 puts the whole loop inside one registered op precisely so that no
// caller, including the chat planner that binds every registered op 1:1, can reorder a stage, skip
// one, or reach a later one without the earlier ones having happened.
//
//   1. brief     Read what this project already knows about the intent's scope. Stage 3 compiles
//                from this and from nothing else the host had lying around; an absent brief is a
//                refusal at the op, never an empty one served silently.
//   2. dedup     Screen the intent against the authored suite BEFORE a byte is authored. Being
//                first is the whole of "dedup-before-author": there is exactly one call site and
//                it is here, so the property is structural rather than a habit of this code.
//   3. compile   ONE model call emits a WHOLE document (D-02: creation is not an edit — a new
//                file has no untouched lines to preserve, so WTST-07's letter holds). What it
//                emitted is parsed before it becomes bytes; an unparsable draft is a named
//                refusal and leaves nothing on disk.
//   4. verify    The staged draft is judged by `authoring.draft.verify`, dispatched as the
//                REGISTERED op. No gate is re-implemented here and no disposition is re-derived
//                here — `computeDraftDisposition` is the one site, and the receipt already
//                carries what it decided.
//   5. route     Turn the receipt into an outcome. Deterministic by contract (D-08): a clean
//                definitive assertion-fail must never reach repair, because "repairing" one means
//                rewriting the expectation to match what the app shows, which is oracle capture.
//   6. compound  NO CODE, AND THAT IS THE POINT. `projectProcedureTargets` already fires for every
//                verified-PASS multi-step trajectory on every drain, and a gate-run reaches it
//                because `runs.start` spawns a full child `agent-qa run` (C8: gate-runs curate).
//                D-07's induction therefore needs no write path from here, and adding one would be
//                a SECOND Curator write path for a fact the existing one already records. The
//                stage is entered and recorded so the loop's own trace states the six, and so a
//                later reader finds this paragraph instead of an apparent gap.
//
// WHAT THIS TRACER IMPLEMENTS AND WHAT IT DOES NOT. Stage 2 walks the corpus and reports the
// closest match; the REFUSING arm and its pinned threshold land in plan 04, RED-first against a
// frozen corpus, so no constant is minted here for a later plan to re-litigate. Stage 5 answers
// `drafted` for a receipt the gates were able to judge and refuses BY NAME for the dispositions
// plans 05 and 06 own — a named refusal that a later plan replaces with a branch, never a wrong
// answer returned in the meantime. {@link AuthoringLoopOutcome} declares all four arms today so
// those plans add a case behind a discriminant every consumer already reads.

import type {
  AuthoringBrief,
  DraftDisposition,
  DraftReceipt,
  DraftRef,
  ScopeKey,
} from '@vostride/agent-qa-schema'

import { textSimilarity } from './adds-value.js'
import type {
  AuthoringReadPortLike,
  DraftShelfPortLike,
  ParsedDraftLike,
  SuiteTextCorpusEntryLike,
} from './ports.js'
import { buildTieredPrompt } from '../prompt/tiered-prompt-builder.js'

/**
 * The stage vocabulary, closed and ordered.
 *
 * The DECLARATION ORDER is the execution order, and `loop-ordering.test.ts` asserts the observed
 * trace equals this array — sequence equality over the whole run rather than a set of per-stage
 * "was it called" checks, because what has to be pinned is that nothing ran out of order and
 * nothing was skipped, which a call count cannot say.
 */
export const AUTHORING_LOOP_STAGES = [
  'brief',
  'dedup',
  'compile',
  'verify',
  'route',
  'compound',
] as const

export type AuthoringLoopStage = (typeof AUTHORING_LOOP_STAGES)[number]

/**
 * The `agent_context` every compile call carries into the ONE tiered prompt builder (389 D-04).
 *
 * A pinned string rather than a computed one: it lands in the stable tier, which is the byte
 * prefix provider prompt caches key on, so a per-invocation value would defeat the caching the
 * tier law exists to enable.
 */
export const AUTHORING_COMPILE_AGENT_CONTEXT =
  'authoring.draft.write — compile a whole test document from an intent and a brief'

/**
 * How stage 2 read the suite, and the arm it took.
 *
 * `closest` is present whenever the corpus was non-empty, and it is what plan 04's refusing arm
 * will compare against its pinned threshold. Reporting it from the tracer means the walk is
 * observable now rather than a call whose only evidence is that it did not throw.
 */
export interface DedupScreening {
  readonly kind: 'no-duplicate'
  readonly comparedTests: number
  readonly closest?: {
    readonly filePath: string
    readonly testName: string
    readonly similarity: number
  }
}

/**
 * How one loop invocation ended.
 *
 * Discriminated on the CLOSED schema vocabulary, and all four arms are declared here in the
 * tracer even though only `drafted` is reachable from it. See the vocabulary's own doc block: a
 * union that grew an arm per plan would make plans 04-06 changes to the shape every consumer
 * branches on rather than new cases behind a discriminant they already read.
 */
export type AuthoringLoopOutcome =
  | { readonly kind: 'drafted'; readonly draftRef: DraftRef; readonly receipt: DraftReceipt }
  | { readonly kind: 'refused'; readonly draftRef?: DraftRef; readonly receipt?: DraftReceipt }
  | { readonly kind: 'repaired'; readonly draftRef: DraftRef; readonly receipt: DraftReceipt }
  | { readonly kind: 'finding'; readonly draftRef: DraftRef; readonly receipt: DraftReceipt }

export interface AuthoringLoopInput {
  readonly intent: string
  readonly scope: ScopeKey
  /** Handed straight through to stage 4. See the op's input contract for what it costs. */
  readonly draftMode?: true
}

export interface AuthoringLoopDeps {
  readonly read: AuthoringReadPortLike
  readonly shelf: DraftShelfPortLike
}

/**
 * What one invocation produced, and the stages it actually entered.
 *
 * `stages` is DATA the loop answers with, not a test hook. Plan 04's refusal ends an invocation
 * at stage 2 and plan 05's repair re-enters stages 3-4, so "where did this stop" and "how many
 * times did it iterate" are questions about a real invocation that a caller — and the funnel's
 * side counters (D-15) — has to be able to ask. It is also what makes the ordering claim
 * checkable at all: the trace is pushed by each stage as it is entered, so a reordered loop
 * reports a reordered trace.
 */
export interface AuthoringLoopResult {
  readonly outcome: AuthoringLoopOutcome
  readonly stages: readonly AuthoringLoopStage[]
  readonly dedup: DedupScreening
}

/**
 * The model emitted something that is not a parsable test document.
 *
 * A NAMED refusal and not a retry: this tracer takes one model call by design, and a second
 * attempt hidden inside the first would make the fan-out preview (D-03) a number that does not
 * describe what happens. The bytes were never written — the shelf parses before it writes — so
 * there is no partial draft to clean up either (T-394-06).
 */
export class AuthoringDraftUnparsableError extends Error {
  constructor(readonly reason: string) {
    super(
      'authoring.draft.write: the compiled draft is not a parsable test document, '
        + `so nothing was written to the shelf: ${reason}`,
    )
    this.name = 'AuthoringDraftUnparsableError'
  }
}

/**
 * The receipt's disposition has no route in this build.
 *
 * The honest answer for a tracer that implements one arm of a four-arm union. `rejected` routes
 * to repair or to a finding by D-08's deterministic rule, which plan 05 lands, and `unverified`
 * is what a draft-mode evaluation is forced to (D-18) — neither is a `drafted`, and returning one
 * anyway would be a wrong answer wearing a correct one's clothes, at the exact seam where the
 * cardinal error (a mis-routed app bug iterated into passing) lives. Plans 05 and 06 replace this
 * throw with the `repaired` and `finding` branches.
 */
export class AuthoringLoopUnroutedDispositionError extends Error {
  constructor(readonly disposition: DraftDisposition) {
    super(
      `authoring.draft.write: no route is implemented for a ${disposition} receipt; `
        + 'the repair and finding branches land in plans 05 and 06',
    )
    this.name = 'AuthoringLoopUnroutedDispositionError'
  }
}

/** The dispositions stage 5 answers `drafted` for — the gates judged the draft and did not say no. */
const DRAFTED_DISPOSITIONS: readonly DraftDisposition[] = ['keep-eligible', 'proposal-only']

/**
 * Stage 2 — screen the intent against the authored suite, BEFORE anything is authored.
 *
 * Reuses `textSimilarity`, the shipped comparison gate 3's degraded lane already screens with
 * (393 D-16), rather than a second recipe: two notions of "how alike are these two tests" would
 * let the pre-authoring screen and the post-run gate disagree about the same pair.
 *
 * The intent stands in for the draft's text because at this point there IS no draft — that is
 * what makes the screen worth doing. An intent has no execution fingerprint, so the anchor-level
 * recipe cannot fire here, and no LLM judges duplication (D-16).
 */
export function dedupBeforeAuthor(
  intent: string,
  corpus: readonly SuiteTextCorpusEntryLike[],
): DedupScreening {
  let closest: DedupScreening['closest']
  for (const entry of corpus) {
    const similarity = textSimilarity({ testName: intent, steps: [] }, entry)
    if (closest === undefined || similarity > closest.similarity) {
      closest = { filePath: entry.filePath, testName: entry.testName, similarity }
    }
  }
  return {
    kind: 'no-duplicate',
    comparedTests: corpus.length,
    ...(closest === undefined ? {} : { closest }),
  }
}

/** The brief's exemplars, as the context block a compile reads them from. */
function exemplarBlockBody(brief: AuthoringBrief): string {
  if (brief.exemplars.length === 0) {
    return 'No exemplar tests were served for this scope. Follow the house YAML test style.'
  }
  return brief.exemplars
    .map((exemplar) => `- ${exemplar.filePath} · ${exemplar.testName}\n${exemplar.excerpt}`)
    .join('\n')
}

/** The brief's facts and cautions, in the precedence the brief itself locked (ABRF-01). */
function knowledgeBlockBody(brief: AuthoringBrief): string {
  const lines = [
    ...brief.cautions.map((caution) => `CAUTION: ${caution.summary}`),
    // The flow anchor's own vocabulary, rendered from the arm it is: `Anchor` is a union and
    // only some arms carry a role/name pair, so reading those fields off it directly would
    // compile against one arm and be wrong about the rest.
    ...brief.procedures.map(
      (procedure) => `PROCEDURE: ${procedure.flowAnchor.t === 'flow'
        ? procedure.flowAnchor.name
        : JSON.stringify(procedure.flowAnchor)}`,
    ),
    ...brief.facts.map((fact) => `FACT: ${fact.summary}`),
  ]
  return lines.length === 0 ? 'This scope has no served knowledge yet.' : lines.join('\n')
}

/**
 * Stage 3 — ONE model call, one whole document, parsed before it is written.
 *
 * The prompt extends the ONE tiered builder through `agent_context` (389 D-04's law); there is no
 * second renderer and no persona fork here. What the model returns is handed to the shelf, which
 * parses it and answers `unparsable` without writing when it is not a test.
 */
async function compileDraft(
  input: AuthoringLoopInput,
  brief: AuthoringBrief,
  shelf: DraftShelfPortLike,
): Promise<ParsedDraftLike> {
  const request = buildTieredPrompt({
    agent_context: AUTHORING_COMPILE_AGENT_CONTEXT,
    stable: [
      {
        title: 'Role',
        body: 'You author agent-qa test documents. Emit ONE complete YAML test document and '
          + 'nothing else — no prose, no fences, no partial edit. Steps are natural language, one '
          + 'per line, and at least one of them must assert concrete expected content.',
      },
    ],
    context: [
      { title: 'Intent', body: input.intent },
      { title: 'Scope', body: `${input.scope.tier}:${input.scope.key}` },
      { title: 'What this project knows', body: knowledgeBlockBody(brief) },
    ],
    volatile: [{ title: 'Exemplar tests', body: exemplarBlockBody(brief) }],
  })

  const model = await shelf.model()
  const emitted = await model.generate(request)
  const staged = await shelf.write(emitted.text)
  if (staged.kind === 'unparsable') throw new AuthoringDraftUnparsableError(staged.reason)
  return staged.draft
}

/**
 * Stage 5 — the receipt becomes an outcome.
 *
 * Reads `receipt.disposition`, the value `computeDraftDisposition` produced, and derives nothing
 * of its own: 393 D-18 put that rule in one place expressly so 394 would be structurally unable
 * to grow a second reading of it.
 */
export function routeAfterVerify(draft: ParsedDraftLike, receipt: DraftReceipt): AuthoringLoopOutcome {
  if (!DRAFTED_DISPOSITIONS.includes(receipt.disposition)) {
    throw new AuthoringLoopUnroutedDispositionError(receipt.disposition)
  }
  return {
    kind: 'drafted',
    draftRef: {
      filePath: draft.filePath,
      testId: draft.testId,
      testName: draft.testName,
      contentDigest: draft.contentDigest,
    },
    receipt,
  }
}

export async function runAuthoringLoop(
  input: AuthoringLoopInput,
  deps: AuthoringLoopDeps,
): Promise<AuthoringLoopResult> {
  const stages: AuthoringLoopStage[] = []

  stages.push('brief')
  const brief = await deps.read.getAuthoringBrief(input.intent, input.scope)

  stages.push('dedup')
  const dedup = dedupBeforeAuthor(input.intent, await deps.read.suiteTextCorpus())

  stages.push('compile')
  const draft = await compileDraft(input, brief, deps.shelf)

  stages.push('verify')
  const receipt = await deps.shelf.verifyDraft({
    draftPath: draft.filePath,
    ...(input.draftMode === undefined ? {} : { draftMode: input.draftMode }),
  })

  stages.push('route')
  const outcome = routeAfterVerify(draft, receipt)

  stages.push('compound')

  return { outcome, stages, dedup }
}
