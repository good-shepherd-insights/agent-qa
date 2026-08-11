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

import { CURRENT_AUTHORING_PROPOSAL_SCHEMA_VERSION } from '@vostride/agent-qa-schema'
import type {
  AuthoringBrief,
  CompletedRunHandoff,
  DraftDisposition,
  DraftReceipt,
  DraftRef,
  FindingProposalV1,
  ScopeKey,
  TestDraftProposalV1,
} from '@vostride/agent-qa-schema'

import { dedupBeforeAuthor } from './dedup.js'
import type { DedupScreening } from './dedup.js'
import type {
  AuthoringReadPortLike,
  DraftRunPortLike,
  DraftShelfPortLike,
  ParsedDraftLike,
} from './ports.js'
import { repairDraft } from './repair.js'
import type { RepairOutcome } from './repair.js'
import { AuthoringRouterUnroutableError, routeRepairOrFinding } from './router.js'
import type { FindingRoute } from './router.js'
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
 * How one loop invocation ended.
 *
 * Discriminated on the CLOSED schema vocabulary, and all four arms are declared here in the
 * tracer even though only `drafted` is reachable from it. See the vocabulary's own doc block: a
 * union that grew an arm per plan would make plans 04-06 changes to the shape every consumer
 * branches on rather than new cases behind a discriminant they already read.
 */
export type AuthoringLoopOutcome =
  | {
      readonly kind: 'drafted'
      readonly draftRef: DraftRef
      readonly receipt: DraftReceipt
      readonly proposal: TestDraftProposalV1
    }
  | { readonly kind: 'refused'; readonly draftRef?: DraftRef; readonly receipt?: DraftReceipt }
  | {
      readonly kind: 'repaired'
      readonly draftRef: DraftRef
      readonly receipt: DraftReceipt
      readonly proposal: TestDraftProposalV1
    }
  | {
      readonly kind: 'finding'
      readonly draftRef: DraftRef
      readonly receipt: DraftReceipt
      readonly proposal: FindingProposalV1
    }

export interface AuthoringLoopInput {
  readonly intent: string
  readonly scope: ScopeKey
  /** Handed straight through to stage 4. See the op's input contract for what it costs. */
  readonly draftMode?: true
}

export interface AuthoringLoopDeps {
  readonly read: AuthoringReadPortLike
  /**
   * The compile half, plus stage 5's run reader (394-06).
   *
   * The run capability rides this bundle rather than arriving as a third dep: see the port's own
   * `runs` doc. What it buys the loop is that "can this host author" stays ONE question with one
   * answer, which is the property D-01's composition rests on.
   */
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
  /** Which named side counters this invocation incremented. See the vocabulary's doc block. */
  readonly sideCounters: readonly AuthoringLoopSideCounter[]
}

/**
 * Facts about an invocation that are counted BESIDE the funnel, never as a stage of it (D-15).
 *
 * A dedup refusal is the first member, and the distinction is the whole reason the vocabulary
 * exists. Plan 07 projects the loop as a funnel — how many intents reached compile, verify, a
 * keep-eligible receipt — and a refusal that was folded into a funnel stage would read as an
 * invocation the pipeline FILTERED. It is not: it is an invocation the pipeline never entered,
 * refused for a working-as-intended reason before any cost was incurred. Counting it inside the
 * funnel would inflate the filter rate with successes and break comparison against the reference
 * distribution, which is exactly the number the funnel exists to be compared against.
 */
export const AUTHORING_LOOP_SIDE_COUNTERS = ['dedup-refused'] as const

export type AuthoringLoopSideCounter = (typeof AUTHORING_LOOP_SIDE_COUNTERS)[number]

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
 * The router could not place a rejected receipt's evidence.
 *
 * The honest answer for the one case stage 5 genuinely cannot decide: the gates said no, and the
 * run record the receipt names is not readable, or holds no member with this draft's identity. That
 * is a broken precondition rather than an ambiguous signal — filing an evidence-less finding would
 * report an application bug nobody observed, which is the cardinal error pointed the other way.
 */
export class AuthoringLoopUnroutableEvidenceError extends Error {
  constructor(readonly disposition: DraftDisposition, readonly cause: Error) {
    super(
      `authoring.draft.write: a ${disposition} receipt could not be routed — ${cause.message}`,
    )
    this.name = 'AuthoringLoopUnroutableEvidenceError'
  }
}

/**
 * The dispositions stage 5 answers `drafted` for — the gates did not say no.
 *
 * `unverified` joins the two that were here in the tracer, and the reason is D-05 rather than
 * convenience: it is what a DRAFT-MODE evaluation is forced to (rule 1 of the disposition table),
 * and a draft-mode run is a caller deliberately asking for one cheap run. Such a draft is not a
 * finding — no run said the application is wrong — and it is not repairable — no mechanics evidence
 * exists to repair against. It is a draft nobody has verified, which is exactly what the test-draft
 * arm's `disposition` field says out loud, so it proposes and a human decides. `rejected` is the
 * only disposition that routes, because it is the only one a gate actually refused.
 */
const DRAFTED_DISPOSITIONS: readonly DraftDisposition[] = [
  'keep-eligible',
  'proposal-only',
  'unverified',
]

/** The draft's identity as the receipt and both envelope arms spell it. */
function draftRefOf(draft: ParsedDraftLike): DraftRef {
  return {
    filePath: draft.filePath,
    testId: draft.testId,
    testName: draft.testName,
    contentDigest: draft.contentDigest,
  }
}

/**
 * The test-draft envelope arm for a draft that reached a receipt (D-05).
 *
 * `actualRuns` is read off the receipt's OWN `gateRuns` plus whatever repair spent — never a
 * predicted figure. WTST-08's honesty half is that the preview promises a bound before dispatch and
 * the receipt reports what was actually consumed; a number derived from the bound would make the
 * two agree by construction and measure nothing.
 */
function testDraftProposal(
  draftRef: DraftRef,
  receipt: DraftReceipt,
  repairIterations: number,
): TestDraftProposalV1 {
  return {
    schemaVersion: CURRENT_AUTHORING_PROPOSAL_SCHEMA_VERSION,
    draftRef,
    disposition: receipt.disposition,
    actualRuns: receipt.gateRuns.length + repairIterations,
    repairIterations,
    summaryLine: `${draftRef.testName} — ${receipt.disposition}`,
  }
}

/**
 * The finding envelope arm (D-11), built from the ROUTE and from nothing a model wrote.
 *
 * `explanation` is left empty here and filled by the model downstream, once the branch is already
 * chosen. That ordering is the whole of "the LLM writes the finding's evidence-linked explanation;
 * it never makes the routing decision" — a prose field populated before the arm is picked would be
 * a channel through which model output could reach a branch it may not influence.
 */
function findingProposal(draftRef: DraftRef, route: FindingRoute): FindingProposalV1 {
  return {
    schemaVersion: CURRENT_AUTHORING_PROPOSAL_SCHEMA_VERSION,
    draftRef,
    signalClass: route.signalClass,
    failurePoint: route.failurePoint === null
      ? null
      : {
          runId: route.failurePoint.runId,
          stepIndex: route.failurePoint.stepIndex,
          stepText: route.failurePoint.stepText,
          reasoning: route.failurePoint.reasoning,
          ...(route.failurePoint.verdictSource === undefined
            ? {}
            : { verdictSource: String(route.failurePoint.verdictSource) }),
        },
    evidenceRefs: route.evidenceRefs,
    explanation: '',
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
 * The run whose evidence stage 5 routes on: the LAST gate run the receipt names.
 *
 * ONE ANSWER TO A QUESTION THE DERIVATION DELIBERATELY DOES NOT OWN. `routeRepairOrFinding` takes
 * a single run document because a routing rule that also chose its own evidence would be two rules
 * in one function. Which of an evaluation's several runs supplies that document is a fact about
 * the EVALUATION, and it is answered here: the last one taken, because gate 2 early-stops on a
 * verdict flip (D-17) and the run that stopped it is the one carrying the failure the gates
 * ultimately reported. An absent record yields `undefined`, which the router refuses BY NAME
 * rather than routing on.
 */
async function routingHandoff(
  receipt: DraftReceipt,
  runs: DraftRunPortLike,
): Promise<CompletedRunHandoff | undefined> {
  const lastRun = receipt.gateRuns.at(-1)
  return lastRun === undefined ? undefined : await runs.get(lastRun.runId)
}

/**
 * Stage 5 — the receipt becomes an outcome, and both terminal outcomes carry their envelope arm.
 *
 * TWO DERIVATIONS, ASKED IN ORDER, NEITHER RE-IMPLEMENTED HERE. The first is
 * `computeDraftDisposition`'s, already stored on the receipt: did the gates say no. The second is
 * `routeRepairOrFinding`'s, over the run's own evidence: is a rejection the DRAFT's problem or the
 * APPLICATION's. This function asks them; it answers neither. The two are separate functions
 * rather than one because they read different things — a disposition reads four booleans and two
 * counts, a route reads per-step execution evidence — and a single function taking both would be
 * a parameter list through which a gate verdict could influence the branch.
 *
 * THE REPAIR ARM IS ENTERED ONLY THROUGH A `RepairRoute`. `repairDraft` cannot be handed the
 * finding arm — the two route types are mutually non-assignable — so the app-broken branch is
 * structurally unable to reach repair rather than merely not wired to it (SC-2, T-394-22).
 *
 * A REPAIR THAT DID NOT SUCCEED BECOMES A FINDING, not a silent failure. The draft failed, repair
 * was allowed K attempts and none produced a passing probe, and the honest thing to hand a person
 * is the evidence plus what was tried. The route's own evidence refs are what the finding carries,
 * so an exhausted repair and a first-pass finding are the same artifact class differing only in
 * how much was spent before it was filed.
 */
export async function routeAfterVerify(
  draft: ParsedDraftLike,
  receipt: DraftReceipt,
  deps: AuthoringLoopDeps,
): Promise<AuthoringLoopOutcome> {
  const draftRef = draftRefOf(draft)
  if (DRAFTED_DISPOSITIONS.includes(receipt.disposition)) {
    return {
      kind: 'drafted',
      draftRef,
      receipt,
      proposal: testDraftProposal(draftRef, receipt, 0),
    }
  }

  const handoff = await routingHandoff(receipt, deps.shelf.runs)
  let route
  try {
    route = routeRepairOrFinding(draftRef, handoff)
  } catch (error) {
    if (!(error instanceof AuthoringRouterUnroutableError)) throw error
    throw new AuthoringLoopUnroutableEvidenceError(receipt.disposition, error)
  }

  if (route.kind === 'finding') {
    return { kind: 'finding', draftRef, receipt, proposal: findingProposal(draftRef, route) }
  }

  // `handoff` is defined here: the router refuses `no-run-evidence` by name, and that refusal was
  // already converted above — so reaching a repair arm at all means a run document was read.
  const repaired: RepairOutcome = await repairDraft(route, {
    draft,
    handoff: handoff as CompletedRunHandoff,
    shelf: deps.shelf,
    runs: deps.shelf.runs,
  })

  if (repaired.kind === 'repaired') {
    const repairedRef = draftRefOf(repaired.draft)
    return {
      kind: 'repaired',
      draftRef: repairedRef,
      receipt: repaired.receipt,
      proposal: testDraftProposal(repairedRef, repaired.receipt, repaired.iterations),
    }
  }

  const exhaustedRoute: FindingRoute = {
    kind: 'finding',
    signalClass: 'indefinitive-failure',
    failurePoint: null,
    evidenceRefs: [],
  }
  return {
    kind: 'finding',
    draftRef,
    receipt,
    proposal: {
      ...findingProposal(draftRef, exhaustedRoute),
      signalClass: `repair-${repaired.abandonment.kind}`,
      explanation: repaired.abandonment.error.message,
    },
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

  // THE INVOCATION ENDS HERE, and it ends BEFORE `compileDraft` — which is the only place a model
  // is reached. D-04: the refusal is a typed op result, fail-closed and stateless. There is no
  // suspended-op state and no in-turn "continue anyway": chat renders the refusal with its link
  // and its two continuations, and the user re-invokes deliberately. An in-turn continue would
  // need a suspended op to resume into, which is machinery this phase does not build and which
  // would turn a refusal a user must read into one they can dismiss.
  //
  // `stages` stops at `dedup`, so the trace says WHERE this invocation ended rather than claiming
  // six stages ran. The `refused` arm carries neither a `draftRef` nor a `receipt` because there
  // is no draft and no gate-run to have produced one; the evidence lives on `dedup`, which is a
  // fact about the SCREENING rather than about the outcome.
  if (dedup.kind === 'duplicate') {
    return {
      outcome: { kind: 'refused' },
      stages,
      dedup,
      sideCounters: ['dedup-refused'],
    }
  }

  stages.push('compile')
  const draft = await compileDraft(input, brief, deps.shelf)

  stages.push('verify')
  const receipt = await deps.shelf.verifyDraft({
    draftPath: draft.filePath,
    ...(input.draftMode === undefined ? {} : { draftMode: input.draftMode }),
  })

  stages.push('route')
  const outcome = await routeAfterVerify(draft, receipt, deps)

  stages.push('compound')

  return { outcome, stages, dedup, sideCounters: [] }
}
