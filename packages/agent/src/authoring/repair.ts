// Bounded repair, fenced on both sides of the passing prefix (Phase 394, D-09/D-10 · WTST-04).
//
// WHAT THIS FILE IS FOR. The router (`router.ts`) has already decided that a failing draft is the
// DRAFT's problem rather than the application's. This file bounds what may be done about it: how
// many attempts, what a patch is allowed to touch, and what has to still be true afterwards.
// Nothing here re-asks the routing question, and nothing here derives a disposition — both are
// answered in exactly one place each, and a second reading of either is the failure mode this
// phase's whole arc is built to prevent.
//
// THE PASSING PREFIX IS PROTECTED TWICE, AND THE TWO HALVES CATCH DIFFERENT THINGS (D-09).
//
//   STATIC   `fencePatchAgainstPassingPrefix` reads every RFC-6902 path in the set and refuses the
//            WHOLE set if any of them addresses a step position inside the prefix. It runs before
//            anything executes, so a patch that names a protected step never costs a child process
//            against the user's application. The refusal is a VALUE, and the caller counts it
//            against K.
//   DYNAMIC  After the probe run, the prefix steps are read back out of the run's own evidence. A
//            patch may name only unprotected steps and still break a protected one — a fill that
//            changes what a later page renders, a removed wait that makes an earlier assertion
//            race — and no amount of path inspection can see that. Only the run can.
//
// A patch inspection alone proves the fence reads paths. It does not prove the prefix survives,
// which is what D-09 is actually about, and a plan shipping only the static half would have
// measured the smaller claim and reported the larger one.
//
// A FENCED PATCH IS NOT A FAILURE MODE. A legitimate early-step fix that gets refused simply exits
// repair, and the draft goes on to be a proposal or a finding a human looks at. That is the safe,
// recoverable direction: the alternative — letting a repair rewrite a step that already passed —
// is how a loop quietly turns a test that was verifying something into a test that is verifying
// whatever the application happens to do now.
//
// THIS FILE CANNOT REACH THE APPLICATION'S OWN BRANCH. `repairDraft` takes a `RepairRoute`, and
// `RepairRoute` and `FindingRoute` are mutually non-assignable by construction (each carries a
// required field the other does not have). So wiring the app-broken branch into repair is a
// COMPILE error rather than a behaviour a corpus has to notice afterwards — T-394-22's mitigation
// expressed as a type, pinned by the `@ts-expect-error` cell in `router.test-d.ts` and by the
// second cell of `scripts/394-router-mutation.sh`.
//
// WHY THE PATCH APPLIER ARRIVES AS A PORT VERB RATHER THAN AS AN IMPORT. The RFC-6902 applier is
// `applyPatchSetToTestDoc` in `core`, and this package's declared dependencies are `runner`,
// `safety`, `schema`, `ai` and `zod` — an edge to `core` is a `validate:arch` violation with no
// legal repair (the FUNC-02 firewall, and the same reason `stageDraft` lives at the host). So the
// shelf carries `applyPatches`, the host binds it over that one applier, and the "one patch
// contract, two consumers" property holds through the binding rather than through an import.

import {
  TestEditPatchSetSchema,
  parseJsonPointer,
} from '@vostride/agent-qa-schema'
import type {
  CompletedRunHandoff,
  DraftReceipt,
  DraftRef,
  PerTestOutcome,
  StepEvidence,
  TestEditPatchSet,
} from '@vostride/agent-qa-schema'

import type { DraftRunPortLike, DraftShelfPortLike, ParsedDraftLike } from './ports.js'
import { ROUTER_EVIDENCE_CHANNELS } from './router.js'
import type { RepairRoute } from './router.js'
import { buildTieredPrompt } from '../prompt/tiered-prompt-builder.js'

/**
 * K: how many repair iterations one draft gets. PINNED, never config (386 D-15).
 *
 * RETUNE NOTE. Raising this multiplies the fan-out preview LINEARLY — the bound a user approves at
 * dispatch is initial N + K probes + final N, so K=5 turns a 7-run preview into a 9-run one for
 * every draft, whether or not the extra iterations ever help. That makes a retune a measurement
 * rather than a preference. Before moving it, report on the FROZEN corpus: (a) how many additional
 * drafts reach a passing probe at each K between here and the proposed value — if the second and
 * third iterations rescue nothing, a fourth will not either; (b) the wall-clock cost per
 * additional keep, priced at the local-form run time (~22s per probe) times the drafts that spend
 * the extra iterations WITHOUT being rescued, which is the population that pays for the ones that
 * are; and (c) the token cost per additional keep, since every iteration is one more model call
 * carrying a full trace. A retune that only argues from intuition — "three feels low" — is exactly
 * what this comment exists to prevent. Three is the same order as the spec's own 3-5 suggestion
 * and one more than the single in-attempt round-trip `AUTHOR_REPAIR_CAP` already ships with.
 */
export const REPAIR_ITERATION_CAP = 3

/**
 * The `agent_context` every repair call carries into the ONE tiered prompt builder (389 D-04).
 *
 * Pinned rather than computed, on `AUTHORING_COMPILE_AGENT_CONTEXT`'s reasoning: it lands in the
 * stable tier, which is the byte prefix a provider's prompt cache keys on, so a per-invocation
 * value would defeat the caching the tier law exists to enable. It names the SAME op as the
 * compile call because a repair is a stage of that op rather than an op of its own.
 */
export const REPAIR_AGENT_CONTEXT =
  'authoring.draft.write — repair a draft that failed for a test reason'

/**
 * The steps that already worked, and the run that says so.
 *
 * PREFIX IDENTITY, SPELLED ONCE (D-09): step POSITIONS in the BEST PRIOR RUN. `length` is the
 * count of leading steps that passed, so the protected set is `[0, length)` — a contiguous prefix
 * and not the set of every step that is not currently failing. The difference is load-bearing: a
 * step AFTER the failure never ran, so nobody has seen it pass, and protecting it would fence off
 * exactly the region a repair legitimately needs to work in.
 */
export interface PassingPrefix {
  /** The run this prefix was read out of — carried so a refusal can name its own evidence. */
  readonly runId: string
  /** Steps `[0, length)` passed. Zero means nothing is protected. */
  readonly length: number
}

/**
 * A patch named a step the prefix protects. A VALUE, never thrown.
 *
 * Returning it rather than raising is what lets the caller count the refusal against K without a
 * `try` around the one call in the loop body that is supposed to be able to say no — and a fenced
 * patch MUST consume an iteration, or a model that emits nothing but fenced patches never
 * terminates (T-394-23).
 */
export class PassingPrefixViolationError extends Error {
  constructor(
    readonly path: string,
    readonly stepIndex: number,
    readonly prefix: PassingPrefix,
  ) {
    super(
      `repair: the patch path ${path} addresses step ${stepIndex}, which is inside the `
        + `passing prefix of ${prefix.length} step(s) established by run ${prefix.runId}; `
        + 'the whole patch set is refused before anything runs',
    )
    this.name = 'PassingPrefixViolationError'
  }
}

/**
 * The probe showed a step that used to pass now failing. The dynamic half's refusal.
 *
 * Distinct from the static one by NAME rather than by a flag, because the two are evidence of
 * different things: a static violation says the model asked to touch a protected step, and this
 * says it broke one WITHOUT asking. The second is the more interesting signal and would be lost
 * inside a shared class.
 */
export class PassingPrefixRegressedError extends Error {
  constructor(
    readonly stepIndex: number,
    readonly runId: string,
  ) {
    super(
      `repair: probe run ${runId} shows step ${stepIndex} failing, and that step passed in the `
        + 'best prior run; the candidate is discarded and repair ends',
    )
    this.name = 'PassingPrefixRegressedError'
  }
}

/**
 * K iterations were spent and none produced a passing probe.
 *
 * Carries the count and the LAST refusal so a caller can distinguish two very different reports: we
 * tried K times and the model kept missing, versus every patch it proposed was fenced. A bare
 * boolean collapses them, and they call for opposite things from the person reading the result.
 */
export class RepairExhaustedError extends Error {
  constructor(
    readonly iterations: number,
    readonly lastRefusal: string,
  ) {
    super(
      `repair: ${iterations} iteration(s) produced no passing probe; the last one ended with: `
        + lastRefusal,
    )
    this.name = 'RepairExhaustedError'
  }
}

/** Why repair stopped without a repaired draft. Two named reasons, never a bare `false`. */
export type RepairAbandonment =
  | { readonly kind: 'exhausted'; readonly error: RepairExhaustedError }
  | { readonly kind: 'prefix-regressed'; readonly error: PassingPrefixRegressedError }

/**
 * What one repair sequence produced.
 *
 * `iterations` is on BOTH arms because the fan-out actually consumed is what the receipt and the
 * D-03 preview are compared against; reporting it only on the failing arm would make a successful
 * repair the one case whose cost nobody can state.
 */
export type RepairOutcome =
  | {
      readonly kind: 'repaired'
      readonly draft: ParsedDraftLike
      readonly receipt: DraftReceipt
      readonly iterations: number
      readonly probeRunIds: readonly string[]
    }
  | {
      readonly kind: 'abandoned'
      readonly abandonment: RepairAbandonment
      readonly iterations: number
      readonly probeRunIds: readonly string[]
    }

/**
 * What repair needs from its host.
 *
 * `handoff` is the BEST PRIOR RUN — the run the receipt's gates judged — and it is where both the
 * prefix and the repair prompt's evidence come from. It is a parameter rather than something this
 * module fetches, on the router's own posture: choosing among an evaluation's several runs is the
 * stage-5 wiring's job, and a module that picked one itself would be a second answer to a question
 * the wiring already has to answer.
 */
export interface RepairDeps {
  readonly draft: ParsedDraftLike
  readonly handoff: CompletedRunHandoff
  readonly shelf: DraftShelfPortLike
  readonly runs: DraftRunPortLike
}

// ---- the prefix ------------------------------------------------------------------------------

function draftMember(
  draftRef: DraftRef | ParsedDraftLike,
  handoff: CompletedRunHandoff | undefined,
): PerTestOutcome | undefined {
  return handoff?.tests.find(
    (member) => member.filePath === draftRef.filePath && member.testName === draftRef.testName,
  )
}

function stepFailed(step: StepEvidence): boolean {
  return step.verifierVerdict.pass === false
}

/**
 * The leading contiguous run of steps that passed, read out of the best prior run.
 *
 * A run with no member for this draft yields a prefix of zero, which protects nothing — the honest
 * answer, since a prefix asserted with no evidence behind it would fence a repair out of a region
 * nobody has ever seen work.
 */
export function derivePassingPrefix(
  draftRef: DraftRef | ParsedDraftLike,
  handoff: CompletedRunHandoff | undefined,
): PassingPrefix {
  const runId = handoff?.runId ?? ''
  const member = draftMember(draftRef, handoff)
  if (member === undefined) return { runId, length: 0 }

  let length = 0
  for (const step of member.steps) {
    if (stepFailed(step)) break
    length += 1
  }
  return { runId, length }
}

/**
 * Which step position a pointer addresses, if any.
 *
 * `'all'` is not "no step" — it is EVERY step, and it is what the whole-document pointer and the
 * bare `/steps` pointer address. Both are treated as reaching into the prefix, because a patch
 * that replaces the step sequence wholesale reaches the protected part of it too.
 */
function stepPositionAddressedBy(path: string): number | 'all' | null {
  const segments = parseJsonPointer(path)
  if (segments.length === 0) return 'all'
  if (segments[0] !== 'steps') return null
  if (segments.length === 1) return 'all'
  const index = Number(segments[1])
  return Number.isInteger(index) && index >= 0 ? index : 'all'
}

/**
 * The static half of D-09. Pure, total, and it refuses the WHOLE set on the first violation.
 *
 * A DISTINCT CONTROL FROM `EDITABLE_POINTER_ROOTS`, and neither substitutes for the other. That
 * fence bounds which PART OF THE DOCUMENT any patch may touch at all — it keeps a model-authored
 * pointer away from `target`, `use` and `meta`, so a patch cannot silently change which
 * application a test drives. This one bounds which STEPS a repair may touch, inside the region the
 * first one already allows. A document-region check cannot express "step 1 is off limits and step
 * 2 is not", and a prefix check cannot express "the credentials block is off limits to everyone".
 *
 * An `add` counts as addressing the position it names because it SHIFTS every later step: an
 * insert at index 0 renumbers the whole prefix, which is a change to those steps whether or not
 * any of their text moves.
 */
export function fencePatchAgainstPassingPrefix(
  patchSet: TestEditPatchSet,
  prefix: PassingPrefix,
): PassingPrefixViolationError | null {
  for (const op of patchSet.patches) {
    const position = stepPositionAddressedBy(op.path)
    if (position === null) continue
    if (position === 'all') {
      if (prefix.length > 0) return new PassingPrefixViolationError(op.path, 0, prefix)
      continue
    }
    if (position < prefix.length) {
      return new PassingPrefixViolationError(op.path, position, prefix)
    }
  }
  return null
}

/**
 * The dynamic half of D-09: a prefix step that used to pass and now does not.
 *
 * An ABSENT prefix step is not a regression. A probe that stopped before reaching it recorded no
 * verdict about it, and "we do not know" is not the same answer as "it broke" — counting missing
 * evidence as a regression would end repair for an infrastructure hiccup, which is the direction
 * that costs a user a good test. It also cannot hide anything: a probe missing a prefix step
 * cannot have passed either, so the iteration is spent regardless.
 */
function prefixRegression(
  draft: ParsedDraftLike,
  probe: CompletedRunHandoff | undefined,
  prefix: PassingPrefix,
): PassingPrefixRegressedError | null {
  const member = draftMember(draft, probe);
  if (member === undefined || probe === undefined) return null
  for (const step of member.steps) {
    if (step.stepIndex < prefix.length && stepFailed(step)) {
      return new PassingPrefixRegressedError(step.stepIndex, probe.runId)
    }
  }
  return null
}

/** Member outcomes that are a pass. A heal is a pass (393-01 F3); a skip never ran. */
const PROBE_PASSING_OUTCOMES: readonly string[] = ['passed', 'healed']

function probePassed(draft: ParsedDraftLike, probe: CompletedRunHandoff | undefined): boolean {
  const member = draftMember(draft, probe)
  if (member === undefined) return false
  return PROBE_PASSING_OUTCOMES.includes(member.outcome) && !member.steps.some(stepFailed)
}

// ---- the repair prompt -------------------------------------------------------------------------

/**
 * The failure, in the run's OWN words plus coordinates into its durable records.
 *
 * The trace is rendered as text because a prompt is text; the a11y screen states are rendered as
 * CHANNEL COORDINATES rather than as inlined snapshots, in the same map-not-territory posture the
 * finding arm takes. A pasted element tree would be a second copy of a record the run already
 * holds, and a large one — the model gets what it needs to ask for the right edit, not the whole
 * screen.
 */
function failureBlockBody(route: RepairRoute, member: PerTestOutcome | undefined): string {
  const lines: string[] = []
  lines.push(`mechanics signals: ${route.mechanics.map((signal) => signal.signal).join(', ')}`)
  if (route.failingStepIndex === null) {
    lines.push('the failure is recorded at the member level, with no step to point at')
  }
  for (const step of member?.steps ?? []) {
    const marker = step.stepIndex === route.failingStepIndex ? ' <- FAILED HERE' : ''
    lines.push(`step ${step.stepIndex}: ${step.stepText}${marker}`)
    lines.push(`  verdict: ${step.verifierVerdict.pass ? 'pass' : 'fail'} — ${step.verifierVerdict.reasoning}`)
    if (step.stepIndex !== route.failingStepIndex) continue
    step.subActions.forEach((subAction, subActionIndex) => {
      lines.push(`  plan: ${subAction.plan}`)
      for (const channel of ROUTER_EVIDENCE_CHANNELS) {
        if (channel === 'step-trace') continue
        if (channel === 'state-after' && subAction.stateAfter === undefined) continue
        lines.push(`  a11y ${channel}: step ${step.stepIndex} sub-action ${subActionIndex}`)
      }
    })
  }
  return lines.join('\n')
}

function repairPromptFor(
  route: RepairRoute,
  draft: ParsedDraftLike,
  handoff: CompletedRunHandoff,
  lastRefusal: string | undefined,
): ReturnType<typeof buildTieredPrompt> {
  return buildTieredPrompt({
    agent_context: REPAIR_AGENT_CONTEXT,
    stable: [
      {
        title: 'Role',
        body: 'You repair the MECHANICS of an agent-qa test draft that could not be carried out. '
          + 'Emit ONE JSON object and nothing else: {"thoughts": string, "patches": [...]}, where '
          + 'each patch is an RFC-6902 add, remove or replace whose path is a JSON Pointer into '
          + 'the test document. You may not change what the test CLAIMS in order to make it pass, '
          + 'and you may not touch a step that already worked.',
      },
    ],
    context: [
      {
        title: 'The draft as it stands',
        body: draft.steps.map((step, index) => `${index}: ${step}`).join('\n'),
      },
      {
        title: `What happened in run ${handoff.runId}`,
        body: failureBlockBody(route, draftMember(draft, handoff)),
      },
    ],
    volatile: lastRefusal === undefined
      ? []
      : [{ title: 'Why the previous attempt was not kept', body: lastRefusal }],
  })
}

/** Every probe is ONE gate-run over the draft file and nothing else. */
function probeStartInput(draft: ParsedDraftLike): Parameters<DraftRunPortLike['start']>[0] {
  return { patterns: [draft.filePath], gateRun: true, excludedFromOutcomes: true }
}

// ---- the loop -----------------------------------------------------------------------------------

/**
 * Repair a draft the router sent here, at most {@link REPAIR_ITERATION_CAP} times (D-09/D-10).
 *
 * ONE PROBE PER ITERATION, STABILISE AT THE END (D-10). Each iteration verifies with a single run,
 * because a full pinned-N stability gate per iteration would multiply the fan-out by N for
 * candidates that mostly do not survive. The pinned-N gate then runs ONCE, on the final candidate,
 * before any disposition exists — which is what makes a repaired draft keep-eligible at all: a
 * single-run evaluation is forced to `unverified` by rule 1 of the disposition table, so a loop
 * that stopped at the probe could never produce a draft anyone is allowed to keep.
 *
 * PROBES MINT NO RECEIPT (T-394-24). A probe goes through the run port directly; only the final
 * gate goes through `verifyDraft`, which is the registered op that persists one. The receipt is
 * per DRAFT, and a funnel counting `1 + K` receipts for one draft would report a filter rate over
 * a denominator of attempts rather than of drafts.
 *
 * NO DISPOSITION IS DERIVED HERE. The final receipt carries the one `computeDraftDisposition`
 * produced, and this function neither reads nor recomputes it — 393 D-18 put that rule in one
 * place expressly so 394 would be structurally unable to grow a second reading of it.
 */
export async function repairDraft(route: RepairRoute, deps: RepairDeps): Promise<RepairOutcome> {
  const prefix = derivePassingPrefix(deps.draft, deps.handoff)
  const model = await deps.shelf.model()

  let candidate = deps.draft
  let lastRefusal = 'no iteration was taken'
  // 394-08 / WTST-08: the probe runs this sequence actually started, so the caller can report what
  // was CONSUMED rather than what was attempted. `iterations` cannot answer that question — a
  // fenced or unparsable emission spends an iteration and starts nothing — and an actual-runs
  // figure derived from the iteration count would over-report by exactly the refusals D-09 exists
  // to produce. Every element is appended at the ONE place a probe is started.
  const probeRunIds: string[] = []

  for (let iteration = 1; iteration <= REPAIR_ITERATION_CAP; iteration += 1) {
    const emitted = await model.generate(
      repairPromptFor(route, candidate, deps.handoff, iteration === 1 ? undefined : lastRefusal),
    )

    const parsed = parsePatchSet(emitted.text)
    if (typeof parsed === 'string') {
      // An unusable emission spends an iteration exactly as a fenced patch does. It is not retried
      // for free: a hidden retry would make the fan-out preview a number that does not describe
      // what happens, which is the same argument the compile stage's single model call rests on.
      lastRefusal = parsed
      continue
    }

    const violation = fencePatchAgainstPassingPrefix(parsed, prefix)
    if (violation !== null) {
      // THE ITERATION IS SPENT AND NOTHING RAN. Both halves matter: nothing ran, so a refused
      // patch costs no child process; and the iteration is spent, so a model emitting only fenced
      // patches still terminates.
      lastRefusal = violation.message
      continue
    }

    const staged = await deps.shelf.applyPatches(candidate, parsed)
    if (staged.kind === 'unparsable') {
      lastRefusal = `the patched document did not parse: ${staged.reason}`
      continue
    }

    const acknowledgement = await deps.runs.start(probeStartInput(staged.draft))
    probeRunIds.push(acknowledgement.runId)
    const probe = await deps.runs.get(acknowledgement.runId)

    const regression = prefixRegression(staged.draft, probe, prefix)
    if (regression !== null) {
      return {
        kind: 'abandoned',
        abandonment: { kind: 'prefix-regressed', error: regression },
        iterations: iteration,
        probeRunIds: [...probeRunIds],
      }
    }

    if (probePassed(staged.draft, probe)) {
      // The pinned-N gate, WITHOUT the draft-mode marker — the whole point of stabilising at the
      // end. `stabilityRunsRequested` reaching the disposition table as `DRAFT_STABILITY_RUNS_N`
      // rather than as 1 is what lets a repaired draft be anything other than `unverified`.
      const receipt = await deps.shelf.verifyDraft({ draftPath: staged.draft.filePath })
      return {
        kind: 'repaired',
        draft: staged.draft,
        receipt,
        iterations: iteration,
        probeRunIds: [...probeRunIds],
      }
    }

    candidate = staged.draft
    lastRefusal = `probe run ${acknowledgement.runId} did not pass`
  }

  return {
    kind: 'abandoned',
    abandonment: {
      kind: 'exhausted',
      error: new RepairExhaustedError(REPAIR_ITERATION_CAP, lastRefusal),
    },
    iterations: REPAIR_ITERATION_CAP,
    probeRunIds: [...probeRunIds],
  }
}

/**
 * The model's emission as a patch set, or the reason it is not one.
 *
 * A string return rather than a throw, because an unusable emission is an ordinary thing for a
 * model to produce and the loop's answer to it is to spend an iteration, not to fail the draft.
 */
function parsePatchSet(text: string): TestEditPatchSet | string {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch (error) {
    return `the model did not emit JSON: ${error instanceof Error ? error.message : String(error)}`
  }
  const parsed = TestEditPatchSetSchema.safeParse(json)
  if (!parsed.success) {
    return `the model emitted JSON that is not a patch set: ${parsed.error.message}`
  }
  return parsed.data
}

// 394-08: `repairFanOutBound` used to live here, returning a bare number over its own `+`. It is
// GONE, replaced by `authoringFanOutBound` in `loop.ts` over `computeFanOutBound` in `schema` —
// which is the ONE arithmetic the dispatch confirm and the finished proposal both read. Two
// additions of the same three terms is precisely how a preview begins promising a number the
// report then contradicts, and a bare total could not have kept the two N terms apart.
