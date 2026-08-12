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

import {
  defaultGuardrailPolicyInput,
  loadGuardrailPolicy,
  scan,
} from '@vostride/agent-qa-safety'
import {
  CURRENT_AUTHORING_PROPOSAL_SCHEMA_VERSION,
  DRAFT_STABILITY_RUNS_N,
  authoredSuiteTargetPath,
  NO_RUNS_FAN_OUT_BOUND,
  buildFanOutReport,
  computeFanOutBound,
} from '@vostride/agent-qa-schema'
import type {
  AuthoringBrief,
  CompletedRunHandoff,
  ConsumedRun,
  DraftDisposition,
  DraftReceipt,
  DraftRef,
  FanOutBound,
  FanOutReport,
  FindingProposalV1,
  ScopeKey,
  TestDraftProposalV1,
} from '@vostride/agent-qa-schema'

import {
  PROCEDURE_BY_REFERENCE_INSTRUCTION,
  exemplarBlockBody,
  knowledgeBlockBody,
} from './brief-blocks.js'
import { dedupBeforeAuthor } from './dedup.js'
import type { DedupScreening } from './dedup.js'
import type {
  AuthoringReadPortLike,
  DraftRunPortLike,
  DraftShelfPortLike,
  ParsedDraftLike,
} from './ports.js'
import { refineDraft } from './refine.js'
import type { RefinementOutcome } from './refine.js'
import { REPAIR_ITERATION_CAP, repairDraft } from './repair.js'
import type { RepairOutcome } from './repair.js'
import {
  AuthoringRouterUnroutableError,
  findingRouteForAbandonedRepair,
  routeRepairOrFinding,
} from './router.js'
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
  /**
   * The invoking session, threaded to EVERY receipt this invocation mints (394-17, D-12).
   *
   * Both of them: stage 4's own evaluation and the final stability gate a repaired candidate goes
   * through. A thread that stopped at the first would attribute first-try drafts and silently
   * unattribute every draft that needed repairing — the population a keep rate most needs.
   */
  readonly sessionRef?: string
}

/**
 * The fan-out ONE invocation of this loop can cost, in child `agent-qa run` processes (D-03/D-10).
 *
 * THE SINGLE PLACE THE THREE TERMS ARE ASSEMBLED, and the only caller of `computeFanOutBound` in
 * this package. The dispatch confirm renders what this returns and the finished proposal reports
 * against it, so the number a person consents on and the number they are shown afterwards are the
 * same function of the same input rather than two agreeing arithmetics. A surface recomputing
 * `N + K + N` for itself would be free to drift the moment either constant moved — which is what
 * mutation I in `scripts/394-fan-out-mutation.sh` demonstrates rather than asserts.
 *
 * DRAFT MODE IS THE CASE WHERE THE TWO N TERMS DIFFER. A draft-mode caller asks for ONE cheap gate
 * run (rule 1 of the disposition table), but the FINAL stability gate still runs the pinned N on
 * the repaired candidate — `repairDraft` deliberately drops the draft-mode marker for it. So the
 * bound is `1 + K + N`, not `2 * 1 + K`, and it is the configuration the schema cells use to prove
 * the two terms stay separate: with the shipped constants they are both 3, and a collapse would be
 * invisible under default values.
 */
export function authoringFanOutBound(input: { readonly draftMode?: true }): FanOutBound {
  return computeFanOutBound({
    initialN: input.draftMode === true ? 1 : DRAFT_STABILITY_RUNS_N,
    probeK: REPAIR_ITERATION_CAP,
    finalN: DRAFT_STABILITY_RUNS_N,
  })
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
  /**
   * What was previewed at dispatch, beside the runs this invocation actually spent (WTST-08).
   *
   * ON THE RESULT AND NOT ONLY ON THE PROPOSAL ARM, because a stage-2 refusal has no arm — D-04
   * ends it with no draft, no receipt and no envelope — and "this invocation cost nothing" is a
   * fact a caller is entitled to for every outcome, not only the ones that produced something.
   */
  readonly fanOut: FanOutReport
  /**
   * What stage 3's one refinement round did (D-18).
   *
   * ABSENT exactly when stage 3 was never entered — a stage-2 refusal — and present on every
   * invocation that compiled anything, including the ones where the round changed nothing. The
   * distinction the field exists to keep is between a round that found nothing (`no-op`) and one
   * whose emission could not be used (`not-applied`): both leave the draft alone, and only one of
   * them is the loop working as designed.
   */
  readonly refinement?: RefinementOutcome
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
/**
 * THE CREDENTIAL FAMILIES A DRAFT MAY NOT CARRY (394-10, T-394-43 · WTST-01).
 *
 * A SUBSET of the egress guardrail's OWN detector families, read off `scan`'s `fired[]`, so the
 * write path and the egress path cannot answer "is this a secret" differently. A second detector
 * here would be a second answer to one question, and the first time the two disagreed the weaker
 * one would be the one running on the path that writes a file into somebody's repository.
 *
 * SPELLED AS A POSITIVE SET rather than as a negation, because a negation is only readable if you
 * already know the whole family list — and because the two families it leaves out are DECISIONS
 * rather than omissions:
 *
 *   `email` is out because a login test legitimately types `user@example.com`, and refusing it
 *   would make this gate reject the most ordinary test the product authors. The safety policy
 *   dispositions it `redact` on egress, which is the right answer for a prompt leaving the process
 *   and the wrong one for a fixture value a test needs verbatim.
 *
 *   `injectionShape` is out because it is a SOFT ROUTING SIGNAL by construction — its own header in
 *   `packages/safety/src/guardrail/detectors.ts` says a match costs Curator review rather than a
 *   deterministic rejection, and the policy schema defaults it to `route`. Promoting it to a hard
 *   write-path refusal would re-decide a safety posture this module does not own, and would do it
 *   silently, with every other gate still green.
 *
 * BOTH EXCLUSIONS ARE ASSERTED ON THIS VALUE ITSELF in `__tests__/secret-guardrail.test.ts`, not
 * inferred from a draft that happened to be accepted — so a later edge-case fix that GROWS this set
 * fails a cell by name even when no behavioural case notices. Mutation P proves the set cannot
 * shrink unnoticed and mutation Q proves it cannot grow; growth is the dangerous direction here,
 * and only the pair covers both.
 */
export const CREDENTIAL_DETECTOR_FAMILIES = [
  'awsKey',
  'creditCard',
  'pemKey',
  'bearer',
  'apiKey',
] as const

export type CredentialDetectorFamily = (typeof CREDENTIAL_DETECTOR_FAMILIES)[number]

function isCredentialFamily(detector: string): detector is CredentialDetectorFamily {
  return (CREDENTIAL_DETECTOR_FAMILIES as readonly string[]).includes(detector)
}

/**
 * A draft carries a raw credential literal, so it never becomes a proposal.
 *
 * IT NAMES THE FAMILY, THE PLACE AND THE FINGERPRINT, AND NEVER THE VALUE. A refusal that quoted
 * the credential back would copy it into a proposal record, a log line and a terminal scrollback —
 * which is the disclosure the guardrail exists to prevent, performed by the guardrail. The scan
 * already computes a `redactedFingerprint` (`sha256hex16` of the match) for exactly this purpose:
 * a name for the match that is not the match, so a refusal can be specific without being
 * disclosive. Minting a second hash here would be a second answer to "which match was it".
 */
export class DraftSecretRefusedError extends Error {
  constructor(
    readonly family: CredentialDetectorFamily,
    readonly location: string,
    readonly redactedFingerprint: string,
    /** Absent when the match is in the test's NAME rather than in a step. */
    readonly stepIndex?: number,
  ) {
    super(
      `authoring: refusing to propose this draft — the ${family} detector fired at ${location} `
        + `(fingerprint ${redactedFingerprint}). The matched value is deliberately not repeated `
        + 'here. Reference the credential by name through the supported interpolation form instead '
        + 'of pasting it into a test.',
    )
    this.name = 'DraftSecretRefusedError'
  }
}

/**
 * Refuse a draft whose content carries a raw credential literal — BEFORE it is verified, and
 * therefore long before an envelope exists (T-394-43).
 *
 * WHY HERE RATHER THAN AT `testDraftProposal`, which is where the plan's word "proposal
 * construction" points. Measured: `DraftReceipt.stepTable[].stepText` is verbatim step text and the
 * receipt is PERSISTED (`.agent-qa/draft-receipts/<digest>.json`), and stage 4 spends
 * `DRAFT_STABILITY_RUNS_N` real child runs typing that text into a real browser. A scan performed
 * after stage 4 would therefore fire only once the credential had already been written to a durable
 * file on disk and driven through a live application. The requirement is that no human is ever
 * asked to accept such a draft; screening here satisfies it AND closes the two earlier exposures a
 * later screen cannot.
 *
 * IT SCANS THE DRAFT AS PARSED, not the model's raw emission, and it scans THREE LOCATIONS: the
 * test name, the `context` block, and every step. Those are the three `EDITABLE_POINTER_ROOTS`, so
 * no root a patch is allowed to write is outside the scan.
 *
 * TWO CALL SITES, TWO SCOPES, AND NEITHER COVERS THE OTHER. `runAuthoringLoop` calls it once per
 * invocation, after D-18's refinement round and before stage 4 — so the compile's own emission and
 * the refinement round's patches are screened there. `repairDraft` calls it once per iteration, on
 * the draft the patches were applied to, before that iteration's probe starts. A repair patch is
 * screened at the repair site and nowhere else.
 *
 * ONE POLICY PER CALL, built from `defaultGuardrailPolicyInput` — the same input
 * `createGuardrailProviderRequestHook` composes its policy from.
 */
export function screenDraftForCredentials(draft: {
  readonly testName: string
  readonly steps: readonly string[]
  readonly context?: string
}): void {
  const policy = loadGuardrailPolicy(defaultGuardrailPolicyInput)
  const locations: readonly { text: string; label: string; stepIndex?: number }[] = [
    { text: draft.testName, label: 'the test name' },
    // No `stepIndex`: the context is not a step, and a location that borrowed a step's index would
    // point a reader at a line that holds nothing.
    ...(draft.context === undefined ? [] : [{ text: draft.context, label: 'the test context' }]),
    ...draft.steps.map((text, index) => ({
      text,
      label: `step ${index + 1}`,
      stepIndex: index,
    })),
  ]

  for (const location of locations) {
    // `fired` is ordered by `DETECTOR_PRECEDENCE`, so the family reported is the highest-precedence
    // one that matched rather than whichever the iteration happened to reach first.
    const hit = scan(location.text, policy).fired.find((entry) => isCredentialFamily(entry.detector))
    if (hit === undefined) continue
    throw new DraftSecretRefusedError(
      hit.detector as CredentialDetectorFamily,
      location.label,
      hit.redactedFingerprint,
      location.stepIndex,
    )
  }
}

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
 * `runsConsumed` is read off the REPORT — the distinct run ids this invocation actually started —
 * and never off the bound. WTST-08's honesty half is that the preview promises a number before
 * dispatch and the proposal reports what was spent; a figure derived from the bound would make the
 * two agree by construction and measure nothing. `runsPreviewed` is the bound itself, carried
 * beside it so the comparison is available to whoever reads the arm rather than to nobody.
 */
function testDraftProposal(
  draftRef: DraftRef,
  receipt: DraftReceipt,
  repairIterations: number,
  fanOut: FanOutReport,
): TestDraftProposalV1 {
  return {
    schemaVersion: CURRENT_AUTHORING_PROPOSAL_SCHEMA_VERSION,
    draftRef,
    // WHERE ACCEPTING WILL WRITE IT, derived from where the DRAFT already sits (394-10, D-06).
    // There is deliberately no `sourceDigest` beside it: a loop-authored draft is a NEW file
    // (D-02 — creation is not an edit), and an absent digest is what the apply re-checks as the
    // claim that the target still does not exist. That is the collision guard for two drafts
    // whose names slug the same way, and it fails toward a refusal rather than an overwrite.
    targetPath: authoredSuiteTargetPath(draftRef.filePath, draftRef.testName),
    disposition: receipt.disposition,
    runsPreviewed: fanOut.previewed.total,
    runsConsumed: fanOut.consumedTotal,
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
 *
 * `abandonment` is a PARAMETER rather than something a caller spreads over the result (394-21,
 * WR-09). The exhausted route used to be assembled by spreading `{ signalClass, explanation }` on
 * top of this call, which put a repair-prefixed string outside `ROUTER_SIGNAL_CLASSES` and a model-
 * emitted refusal onto a durable field — both of the things the paragraph above forbids, arriving
 * through the one shape that cannot be forbidden at the type level. Taking the fact as an argument
 * keeps the arm built here, from the route and from typed facts.
 */
function findingProposal(
  draftRef: DraftRef,
  route: FindingRoute,
  abandonment?: FindingProposalV1['repairAbandonment'],
): FindingProposalV1 {
  return {
    schemaVersion: CURRENT_AUTHORING_PROPOSAL_SCHEMA_VERSION,
    draftRef,
    signalClass: route.signalClass,
    ...(abandonment === undefined ? {} : { repairAbandonment: abandonment }),
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

/**
 * Stage 3, first half — ONE model call, one whole document, parsed before it is written.
 *
 * The prompt extends the ONE tiered builder through `agent_context` (389 D-04's law); there is no
 * second renderer and no persona fork here. What the model returns is handed to the shelf, which
 * parses it and answers `unparsable` without writing when it is not a test.
 *
 * The two brief renderers live in `brief-blocks.ts` because the refinement round reads the same
 * substrate; see that module's header for why they are shared rather than copied.
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
      // D-17's syntactic half, in the STABLE tier beside the role it qualifies. It is a standing
      // rule about how any step is written rather than a fact about this intent, so it belongs
      // where the byte prefix is shared across invocations.
      { title: 'Procedures', body: PROCEDURE_BY_REFERENCE_INSTRUCTION },
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
 * What stage 5 answers: the outcome, and the runs the whole invocation spent reaching it.
 *
 * The fan-out report rides OUT of stage 5 rather than being assembled by the caller, because stage
 * 5 is the only place that knows what repair spent. A caller totalling it from the outside would be
 * counting attempts it can see rather than runs that happened.
 */
export interface AuthoringLoopRouting {
  readonly outcome: AuthoringLoopOutcome
  readonly fanOut: FanOutReport
}

/**
 * The gate runs a receipt names, as consumed runs with their completion times.
 *
 * The time is read from the run's OWN record rather than stamped here: `GateRunRecord` carries a
 * run id and the draft's member outcome, not a clock, and a timestamp minted at read time would
 * order the sequence by when somebody looked rather than by when the runs finished. A record that
 * cannot be read still COUNTS — the run happened — and simply carries no time, which is what the
 * report's ordering rule has an unknown-time arm for.
 */
async function consumedGateRuns(
  receipt: DraftReceipt,
  runs: DraftRunPortLike,
): Promise<readonly ConsumedRun[]> {
  const consumed: ConsumedRun[] = []
  for (const record of receipt.gateRuns) {
    const document = await runs.get(record.runId)
    consumed.push({
      runId: record.runId,
      purpose: 'gate',
      ...(document?.endedAt === undefined ? {} : { completedAt: document.endedAt }),
    })
  }
  return consumed
}

/** The probe runs a repair sequence started, on `consumedGateRuns`' terms. */
async function consumedProbeRuns(
  probeRunIds: readonly string[],
  runs: DraftRunPortLike,
): Promise<readonly ConsumedRun[]> {
  const consumed: ConsumedRun[] = []
  for (const runId of probeRunIds) {
    const document = await runs.get(runId)
    consumed.push({
      runId,
      purpose: 'probe',
      ...(document?.endedAt === undefined ? {} : { completedAt: document.endedAt }),
    })
  }
  return consumed
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
  previewed: FanOutBound = NO_RUNS_FAN_OUT_BOUND,
  /**
   * The suite the draft proposes to JOIN, threaded to repair's final stability gate (394-19).
   *
   * HANDED IN rather than re-derived here, on the `sessionRef` posture one field over: the caller
   * computed it once for stage 4's own verify, and a second `authoredSuiteTargetPath` call at this
   * site would be a second answer to a question the invocation already answered. Absent — every
   * caller that is not the loop — leaves the repaired draft on the standalone fallback.
   */
  targetSuitePath?: string,
): Promise<AuthoringLoopRouting> {
  const draftRef = draftRefOf(draft)
  // The runs the EVALUATION already spent, read off the receipt's own record of them. It is the
  // receipt's list rather than a count this function keeps, because the receipt is what was
  // durably written — a tally maintained here could drift from the evidence a person later reads.
  const gateRuns = await consumedGateRuns(receipt, deps.shelf.runs)

  if (DRAFTED_DISPOSITIONS.includes(receipt.disposition)) {
    const fanOut = buildFanOutReport({ previewed, runs: gateRuns })
    return {
      outcome: {
        kind: 'drafted',
        draftRef,
        receipt,
        proposal: testDraftProposal(draftRef, receipt, 0, fanOut),
      },
      fanOut,
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
    return {
      outcome: { kind: 'finding', draftRef, receipt, proposal: findingProposal(draftRef, route) },
      fanOut: buildFanOutReport({ previewed, runs: gateRuns }),
    }
  }

  // `handoff` is defined here: the router refuses `no-run-evidence` by name, and that refusal was
  // already converted above — so reaching a repair arm at all means a run document was read.
  // THE SESSION IS READ OFF THE RECEIPT THAT WAS JUST MINTED, never threaded a second time
  // (394-17, D-12). The repaired candidate belongs to the same invocation as the draft that
  // failed, so its receipt must carry the same attribution — and taking it from the record stage 4
  // already wrote makes that true by construction instead of by two threads agreeing. An
  // unattributed evaluation stays unattributed through repair for the same reason.
  const repaired: RepairOutcome = await repairDraft(route, {
    draft,
    handoff: handoff as CompletedRunHandoff,
    shelf: deps.shelf,
    runs: deps.shelf.runs,
    ...(receipt.sessionRef === undefined ? {} : { sessionRef: receipt.sessionRef }),
    // The repaired candidate joins the SAME suite the draft proposed to join, so the final
    // stability gate reads the same target — one source for the whole invocation.
    ...(targetSuitePath === undefined ? {} : { targetSuitePath }),
  })

  // EVERY RUN THIS INVOCATION SPENT, in one list: the evaluation's gate runs, repair's probes, and
  // the FINAL stability gate's runs off the repaired receipt. The report counts distinct ids, so a
  // run appearing in two of these three lists contributes once — and a fenced iteration, which
  // started nothing, contributes nothing.
  const probes: readonly ConsumedRun[] = await consumedProbeRuns(
    repaired.probeRunIds,
    deps.shelf.runs,
  )

  if (repaired.kind === 'repaired') {
    const repairedRef = draftRefOf(repaired.draft)
    const finalGateRuns = await consumedGateRuns(repaired.receipt, deps.shelf.runs)
    const fanOut = buildFanOutReport({
      previewed,
      runs: [...gateRuns, ...probes, ...finalGateRuns],
    })
    return {
      outcome: {
        kind: 'repaired',
        draftRef: repairedRef,
        receipt: repaired.receipt,
        proposal: testDraftProposal(repairedRef, repaired.receipt, repaired.iterations, fanOut),
      },
      fanOut,
    }
  }

  // THE ABANDONED ARM READS THE RUN IT WAS ROUTED ON (CR-02). It used to be an empty literal —
  // `failurePoint: null`, `evidenceRefs: []` — built with `handoff` and `route.failingStepIndex`
  // both in scope, so a person was handed a durable finding naming no step, no run and no trace. The
  // derivation is the router's, shared with the ordinary finding arm rather than repeated here: an
  // exhausted repair and a first-pass finding are the same artifact class, and this function's own
  // header says so. `handoff` is defined for the reason given at the repair call above — the router
  // refuses `no-run-evidence` by name and that refusal was already converted.
  const exhaustedRoute: FindingRoute = findingRouteForAbandonedRepair(
    draftRef,
    handoff as CompletedRunHandoff,
    route.failingStepIndex,
  )
  return {
    outcome: {
      kind: 'finding',
      draftRef,
      receipt,
      proposal: findingProposal(draftRef, exhaustedRoute, repaired.abandonment.kind),
    },
    fanOut: buildFanOutReport({ previewed, runs: [...gateRuns, ...probes] }),
  }
}

export async function runAuthoringLoop(
  input: AuthoringLoopInput,
  deps: AuthoringLoopDeps,
): Promise<AuthoringLoopResult> {
  const stages: AuthoringLoopStage[] = []
  // The SAME function the dispatch confirm rendered, over the SAME input. Not a number handed in
  // from the op — a threaded value could be edited in transit, and then the receipt would report a
  // preview nobody was shown. One function, two callers, identical arguments.
  const previewed = authoringFanOutBound(input)

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
      // ZERO PREVIEWED AND ZERO CONSUMED, and the first of those is a decision. The dispatch
      // confirm disclosed the worst case for these inputs, as it must — it fires before anything
      // is known. This report describes the INVOCATION, and this invocation ended before a draft
      // existed, so nothing was ever going to run. `NO_RUNS_FAN_OUT_BOUND` is that fact; carrying
      // the dispatch bound here would report a fan-out for a path that has none.
      fanOut: buildFanOutReport({ previewed: NO_RUNS_FAN_OUT_BOUND, runs: [] }),
    }
  }

  stages.push('compile')
  const compiled = await compileDraft(input, brief, deps.shelf)
  // THE ROUND IS UNCONDITIONAL AND IT IS INSIDE STAGE 3 (D-18). Unconditional: there is no `if`
  // above this line and no argument that could turn it off — see `refine.ts` for why a trigger
  // heuristic is the thing D-18 rules out rather than the thing it configures. Inside stage 3
  // rather than beside it: `AUTHORING_LOOP_STAGES` is a pinned six, refining is part of producing
  // the draft, and a seventh stage would have re-opened an ordering contract that plans 02-08 all
  // built against for a step that has no independent entry point.
  const refinement = await refineDraft(compiled, input, deps)
  const draft = refinement.draft

  // T-394-43, AND IT SITS HERE FOR A MEASURED REASON — see `screenDraftForCredentials`. It is after
  // the refinement round so a credential D-18's patches introduced is screened as well as one the
  // compile wrote, and before stage 4 so no gate run types the value into a live application and no
  // receipt records it on disk. Nothing has been proposed at this point and nothing will be: the
  // throw ends the invocation with no receipt, no envelope and no human asked. THIS SITE DOES NOT
  // COVER REPAIR — `repairDraft` screens each patched candidate at its own site, per iteration.
  screenDraftForCredentials(draft)

  stages.push('verify')
  // WHERE ACCEPTING WOULD WRITE IT, computed ONCE for the whole invocation through the SAME
  // exported recipe the proposal arm uses (`testDraftProposal`'s `targetPath`) — so the suite the
  // stability read consults and the suite an accept would join cannot disagree (394-19, D-14).
  // Without it the read targets `draft.filePath`, a one-test shelf artifact whose only member is
  // the draft itself, and `neighbours-flaky` is unreachable from this entry point for any app.
  const targetSuitePath = authoredSuiteTargetPath(draft.filePath, draft.testName)
  const receipt = await deps.shelf.verifyDraft({
    draftPath: draft.filePath,
    targetSuitePath,
    ...(input.draftMode === undefined ? {} : { draftMode: input.draftMode }),
    ...(input.sessionRef === undefined ? {} : { sessionRef: input.sessionRef }),
  })

  stages.push('route')
  const routed = await routeAfterVerify(draft, receipt, deps, previewed, targetSuitePath)

  stages.push('compound')

  return {
    outcome: routed.outcome,
    stages,
    dedup,
    sideCounters: [],
    fanOut: routed.fanOut,
    refinement,
  }
}
