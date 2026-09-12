// PRE-ENQUEUE CIRCULARITY ARBITRATION (Phase 422 plan 14, D-18 / D-19).
//
// ═══ WHAT THIS FILE IS FOR ═══
//
// A no-trust-change verdict says "the served memory was not the problem". 422-11 made that claim
// checkable and 422-12 made the evidence durable across four boundaries, but neither put a
// PRODUCER in the tree: nothing anywhere wrote a single cross-check row. This file is that
// producer, and where it sits is the entire design.
//
// IT RUNS BEFORE `enqueueAnalyzeRun`, NOT INSIDE THE CURATION FOLD. The analysis job is the first
// reader that forms an opinion about why a run failed, and the whole point of the circularity
// guard is that the opinion must not be formed on memory nobody cross-checked. Curation-time
// attribution — the other place this could have lived — happens AFTER that first analysis, so
// evidence produced there could never back it. And because `enqueueAnalyzeRun` mints the payload
// digest from the FINAL handoff bytes, evidence written after the enqueue would be evidence the
// analysed bytes do not cover.
//
// SO THE ORDER IS: skip → consult the root → enumerate exposures → reserve → spend → persist →
// enqueue. Every step before `persist` is recoverable from disk; nothing after it re-spends.
//
// ═══ THE PROVENANCE BINDING 422-13 HANDED FORWARD ═══
//
// 422-13 shipped `resolveFailingPathCandidate` and recorded its own explicit limit: the gate
// proves the authorization is internally CONSISTENT, not that it is AUTHENTIC — "a caller with
// total control over the object can synthesize one that satisfies every check", and binding the
// authorization to a loaded-handoff identity "is 422-15's job".
//
// IT IS THIS PLAN'S JOB, AND IT IS DONE HERE. `prepareMisdirectionEvidence` accepts NO
// authorization from anybody. It takes a `CompletedRunHandoff` that the caller LOADED through
// `loadCompletedRunHandoff` — the strict guard, over bytes the runner wrote — and builds every
// authorization itself, from that document's own member outcome, verbatim. There is no parameter
// on any exported surface here through which a caller could supply a `perTest` of its own
// choosing. That closes the residual for THIS producer; a future producer that accepts an
// authorization from its caller re-opens it and owes its own binding.
//
// ═══ IMPORT DISCIPLINE (FUNC-02) ═══
//
// `@vostride/agent-qa-schema` and node built-ins only. `packages/cli/src/eval-session-composition.ts`
// is the ONE CLI file the surface-firewall ledger clears for `@vostride/agent-qa-eval-local`, and
// that ledger only ever shrinks — so the replay, extraction and corpus legs arrive here through a
// PORT, resolved by deferred import at the call. The deferred import is also what keeps the eval
// composition graph out of the daemon child's module graph, which is the cost 422-09 measured.

import {
  computeBriefDigest,
  deriveMemoryOnPathSites,
  failingStepOf,
  misdirectionSourceDigest,
} from '@vostride/agent-qa-schema'
import type {
  CompletedRunHandoff,
  CrossCheck,
  MemoryOnPathTrust,
  MisdirectionRecordResult,
  MisdirectionRootPosture,
  MisdirectionSamples,
  PerTestOutcome,
  RecordId,
} from '@vostride/agent-qa-schema'

import {
  persistMisdirectionSidecar,
  readMisdirectionRunPosture,
  readMisdirectionRunState,
  reserveMisdirectionCheck,
  saveCompletedMisdirectionCheck,
  writeMisdirectionRunPolicy,
  writeMisdirectionRunPosture,
  misdirectionCheckKeyDigest,
  type MisdirectionCapSource,
  type MisdirectionCheckKey,
  type MisdirectionRunPostureRecord,
} from './misdirection-run-state.js'

/**
 * The four not-run words this producer can write, spelled once.
 *
 * They are DIFFERENT SENTENCES and the vocabulary keeps them apart on purpose: a check nobody was
 * allowed to run, a check that spent and did not finish, a run with no evaluation root to check
 * against, and a run whose root exists and could not be read. 422-11's D-19 rule turns on exactly
 * the last two being distinguishable.
 */
export const MISDIRECTION_CAP_EXCEEDED = 'cap-exceeded'
export const MISDIRECTION_INTERRUPTED = 'interrupted'
export const MISDIRECTION_NO_EVAL_ROOT = 'no-eval-root'
export const MISDIRECTION_POSTURE_UNAVAILABLE = 'posture-unavailable'

/**
 * What the evaluation root answered, and the run-level identities a row must bind.
 *
 * THREE ARMS, NEVER TWO. An absent root and a broken root produce identical (empty) evidence and
 * mean opposite things: the first is the BYOM exemption D-19 grants, the second is an unbacked
 * gated posture that has NOT earned it. Folding them would let every broken root borrow the
 * exemption, which is the failure 422-11 designed the posture vocabulary against.
 *
 * `corpusDigest` and `profileDigest` are RUN-LEVEL rather than per-decision, so a row for an
 * exposure the cap refused still binds the corpus and profile the run would have checked under.
 */
export type MisdirectionRootPostureRead =
  | { readonly kind: 'eval-root'; readonly corpusDigest: string; readonly profileDigest: string }
  | { readonly kind: 'no-eval-root' }
  | { readonly kind: 'broken-eval-root'; readonly reason: string }

/** The resolved per-run check cap and where it came from. Durable — see `MisdirectionRunPolicy`. */
export interface MisdirectionCaps {
  readonly maxChecks: number
  readonly source: MisdirectionCapSource
}

/** Which live decision a step's failing path replays. Deterministic: extraction, never spend. */
export interface MisdirectionLocateInput {
  readonly agentQaRoot: string
  readonly runId: string
  readonly testId: string
  readonly stepIndex: number
}

export type MisdirectionLocated =
  | { readonly kind: 'located'; readonly decisionOrdinal: number }
  | { readonly kind: 'unavailable'; readonly reason: string }

/**
 * The D-18 authorization, as this producer builds it — the run's own recorded member outcome and
 * nothing a caller asserted. It is handed to eval-local's `resolveFailingPathCandidate`, which
 * RECOMPUTES which step failed and whether the record was on its path.
 */
export interface MisdirectionAuthorization {
  readonly recordId: string
  readonly runId: string
  readonly perTest: PerTestOutcome
}

export interface MisdirectionCheckInput extends MisdirectionLocateInput {
  readonly decisionOrdinal: number
  readonly recordId: string
  readonly authorization: MisdirectionAuthorization
}

export type MisdirectionChecked =
  | {
      readonly kind: 'checked'
      readonly crossCheck: CrossCheck
      readonly seedHonored: boolean
      readonly samples: MisdirectionSamples
      readonly reason?: string
    }
  | { readonly kind: 'unavailable'; readonly reason: string }

/**
 * Everything this producer needs from the eval side, as data and closures.
 *
 * `locate` and `check` are two members rather than one because the RESERVATION goes between them:
 * locating a decision is deterministic extraction and costs no provider call, while `check` is the
 * spend. A single member would force the charge to be written either before work that never needed
 * one, or after a call this process may not survive.
 */
export interface MisdirectionArbiterPort {
  rootPosture(): Promise<MisdirectionRootPostureRead>
  resolveCaps(): Promise<MisdirectionCaps>
  locate(input: MisdirectionLocateInput): Promise<MisdirectionLocated>
  check(input: MisdirectionCheckInput): Promise<MisdirectionChecked>
}

/** One low-trust record on one failing step of one member — the unit of work and of evidence. */
export interface MisdirectionExposure {
  readonly perTest: number
  readonly testId: string
  readonly stepIndex: number
  readonly recordId: RecordId
  readonly trust: MemoryOnPathTrust
  /** Recomputed from the failing step's OWN served brief, never read off a stored field. */
  readonly briefDigest: string
}

/**
 * Every exposure this run owes a cross-check, in the one deterministic order (D-18).
 *
 * MEMBER, then FAILING STEP, then the brief's own rendered order, with the record id as the final
 * tie-break so the sequence is a total order rather than a stable-sort accident. The order is
 * load-bearing: it is what decides which exposures fall inside the cap, and a cap applied to an
 * unordered set would check a different four on every retry.
 *
 * PURE, AND IT RUNS FIRST. A run with no low-trust memory on any failing path reaches no store, no
 * root and no provider — which is why a handoff with nothing to check keeps a handoff with NO
 * sidecar member at all rather than an empty one.
 */
export function misdirectionExposures(handoff: CompletedRunHandoff): MisdirectionExposure[] {
  const tests = Array.isArray(handoff.tests) ? handoff.tests : []
  const rows: MisdirectionExposure[] = []
  for (const test of [...tests].sort((left, right) => left.testIndex - right.testIndex)) {
    if (!Array.isArray(test.steps) || test.steps.length === 0) continue
    const failing = failingStepOf(test)
    // `failingStepOf` answers the LAST step when nothing failed (the timeout anchor), so the
    // verdict is read separately: a verified-passing step is not a failing path and owes nothing.
    if (failing === undefined || failing.verifierVerdict.pass) continue
    const briefDigest = computeBriefDigest(failing.servedBrief)
    for (const site of deriveMemoryOnPathSites([failing])) {
      rows.push({
        perTest: test.testIndex,
        testId: test.testId,
        stepIndex: site.stepIndex,
        recordId: site.recordId,
        trust: site.trust,
        briefDigest,
      })
    }
  }
  return rows.sort(
    (left, right) =>
      left.perTest - right.perTest ||
      left.stepIndex - right.stepIndex ||
      (left.recordId < right.recordId ? -1 : left.recordId > right.recordId ? 1 : 0),
  )
}

export interface PrepareMisdirectionEvidenceInput {
  readonly agentQaRoot: string
  /** `<agentQaRoot>/runs/<slug(runId)>` — the run's own audit directory. */
  readonly runDir: string
  /** `<runDir>/handoff.json` — the document the sidecar is published onto. */
  readonly handoffPath: string
  /**
   * The run's handoff AS LOADED through the strict guard. The single source of every
   * authorization this function builds — see the provenance note in this file's header.
   */
  readonly handoff: CompletedRunHandoff
  readonly arbiter: MisdirectionArbiterPort
}

export interface PrepareMisdirectionEvidenceResult {
  /** `not-consulted` means the arbiter never ran: a skipped run, or nothing to check. */
  readonly posture: MisdirectionRootPosture | 'not-consulted'
  readonly rows: readonly MisdirectionRecordResult[]
  /** D-19's absence exemption, and ONLY under a genuinely absent evaluation root. */
  readonly backing?: 'declared-only'
  /** Did the sidecar reach `handoff.json`? False exactly when the arbiter never ran. */
  readonly persisted: boolean
  readonly cap?: MisdirectionCaps
  /** Every exposure this pass could not reach, in its own words. Never folded into one line. */
  readonly notices: readonly string[]
}

const NOT_CONSULTED: PrepareMisdirectionEvidenceResult = {
  posture: 'not-consulted',
  rows: [],
  persisted: false,
  notices: [],
}

function keyOf(exposure: MisdirectionExposure, runId: string, decisionOrdinal: number): MisdirectionCheckKey {
  return {
    runId,
    perTest: exposure.perTest,
    stepIndex: exposure.stepIndex,
    decisionOrdinal,
    recordId: exposure.recordId,
  }
}

/**
 * Produce this run's circularity evidence and publish it, BEFORE the analysis enqueue.
 *
 * THE SKIPS COME FIRST AND COST NOTHING. A gate run or an outcome-excluded run reaches no store,
 * no root and no provider — the same D-08 line `post-verdict-step.ts` holds one layer up, restated
 * here so the PRODUCER is safe on its own terms rather than only because its one caller is.
 *
 * WHAT IS DURABLE WHEN THIS RETURNS: the resolved cap, one reservation per charged check, one
 * completion per finished result, and the sidecar on `handoff.json`. What is NOT durable is the
 * `notices` list, which is diagnosis rather than evidence.
 *
 * A CHECK THAT THREW IS AN INTERRUPTED CHECK, NOT A LOST ONE. The reservation stays on disk with
 * no completion beside it, so the charge is kept and a retry reports `interrupted` with unknown
 * usage instead of silently asking the provider the same question again. A remote call this
 * process did not see finish is not a call this process may assume did not happen.
 */
export async function prepareMisdirectionEvidence(
  input: PrepareMisdirectionEvidenceInput,
): Promise<PrepareMisdirectionEvidenceResult> {
  const { handoff } = input
  if (handoff.gateRun === true || handoff.excludedFromOutcomes === true) return NOT_CONSULTED
  const exposures = misdirectionExposures(handoff)
  if (exposures.length === 0) return NOT_CONSULTED

  const runId = String(handoff.runId)
  const handoffBaseDigest = misdirectionSourceDigest(handoff)
  const notices: string[] = []

  // ═══ THE RETRY SHORT-CIRCUIT, BEFORE ANY ARBITER CALL AT ALL ═══
  //
  // A run whose published ledger already answers every exposure it owes is a run this pass has
  // nothing to do for, and "nothing to do" has to mean NOTHING: not a root consultation, not a
  // cassette extraction, not a provider call. Skipping only the provider call would still make a
  // crash loop re-read the committed corpus and re-extract every target on every attempt, which
  // is real work charged to the verdict's own clock.
  //
  // It is keyed on the EXPOSURE — `(perTest, stepIndex, recordId)` — and not on the record,
  // because the ledger is. An exposure whose decision could not be located has no row, so such a
  // run correctly falls through and tries again: the decision may be locatable now.
  const recovered = recoverPublishedEvidence(input, runId, exposures)
  if (recovered !== undefined) return recovered

  let posture: MisdirectionRootPostureRead
  try {
    posture = await input.arbiter.rootPosture()
  } catch (error) {
    posture = { kind: 'broken-eval-root', reason: errorText(error) }
  }
  writeMisdirectionRunPosture(input.runDir, postureRecord(runId, posture))

  // D-19. An absent root earns the declared-only exemption; a present-but-broken root does not,
  // and both record an EMPTY ledger rather than an absent one — the arbiter ran, and said so.
  if (posture.kind !== 'eval-root') {
    if (posture.kind === 'broken-eval-root') {
      notices.push(`${MISDIRECTION_POSTURE_UNAVAILABLE}: ${posture.reason}`)
    } else {
      notices.push(MISDIRECTION_NO_EVAL_ROOT)
    }
    persistMisdirectionSidecar(input.handoffPath, [])
    return {
      posture: posture.kind,
      rows: [],
      ...(posture.kind === 'no-eval-root' ? { backing: 'declared-only' as const } : {}),
      persisted: true,
      notices,
    }
  }

  const state = readMisdirectionRunState(input.runDir, runId)
  const cap = state.policy === undefined ? await resolveDurableCap(input, runId) : {
    maxChecks: state.policy.maxChecks,
    source: state.policy.source,
  }

  const completedByKey = new Map(
    state.completions.map((row) => [misdirectionCheckKeyDigest(row), row] as const),
  )
  const interruptedKeys = new Set(
    state.interrupted.map((row) => misdirectionCheckKeyDigest(row)),
  )
  const interruptedByKey = new Map(
    state.interrupted.map((row) => [misdirectionCheckKeyDigest(row), row] as const),
  )
  let budget = Math.max(0, cap.maxChecks - state.spent)

  /** One `locate` per STEP, memoised: the live decision is a fact about the step, not the record. */
  const located = new Map<string, MisdirectionLocated>()
  const locate = async (exposure: MisdirectionExposure): Promise<MisdirectionLocated> => {
    const stepKey = `${exposure.testId}\u001f${String(exposure.stepIndex)}`
    const seen = located.get(stepKey)
    if (seen !== undefined) return seen
    let answer: MisdirectionLocated
    try {
      answer = await input.arbiter.locate({
        agentQaRoot: input.agentQaRoot,
        runId,
        testId: exposure.testId,
        stepIndex: exposure.stepIndex,
      })
    } catch (error) {
      answer = { kind: 'unavailable', reason: errorText(error) }
    }
    located.set(stepKey, answer)
    return answer
  }

  const rows: MisdirectionRecordResult[] = []
  const emitted = new Set<string>()
  for (const exposure of exposures) {
    const decision = await locate(exposure)
    if (decision.kind !== 'located') {
      // NO ROW WITHOUT A LOCATED DECISION IDENTITY. Inventing a decision ordinal to carry a
      // refusal would bind the row to a decision the run never made; the record instead reads
      // `unchecked` at fold time, which is what 422-11's aggregation already says about it, and
      // the cause stays visible here.
      notices.push(`${exposure.recordId} at step ${String(exposure.stepIndex)}: ${decision.reason}`)
      continue
    }
    const key = keyOf(exposure, runId, decision.decisionOrdinal)
    const digest = misdirectionCheckKeyDigest(key)
    // EXACT keys dedupe; the same record on another step does not, because its key differs.
    if (emitted.has(digest)) continue
    emitted.add(digest)

    const completed = completedByKey.get(digest)
    if (completed !== undefined) {
      rows.push(completed)
      continue
    }
    const identities = {
      ...key,
      // Re-stated after the spread: the durable key carries the record id as a plain string (the
      // store has no business knowing about brands), and the evidence row's own type is branded.
      recordId: exposure.recordId,
      handoffBaseDigest,
      briefDigest: exposure.briefDigest,
      corpusDigest: posture.corpusDigest,
      profileDigest: posture.profileDigest,
    }
    if (interruptedKeys.has(digest)) {
      // The charge was taken and the answer never arrived. Reported, never re-spent.
      const prior = interruptedByKey.get(digest)!
      rows.push({
        ...identities,
        briefDigest: prior.briefDigest,
        corpusDigest: prior.corpusDigest,
        profileDigest: prior.profileDigest,
        crossCheck: 'not-run',
        seedHonored: false,
        reason: MISDIRECTION_INTERRUPTED,
      })
      continue
    }
    if (budget <= 0) {
      // Every excess exposure is RETAINED as an explicit not-run result rather than dropped, so
      // the fold sees an unchecked record instead of a silently shorter ledger.
      const row: MisdirectionRecordResult = {
        ...identities,
        crossCheck: 'not-run',
        seedHonored: false,
        reason: MISDIRECTION_CAP_EXCEEDED,
      }
      saveCompletedMisdirectionCheck(input.runDir, row)
      rows.push(row)
      continue
    }

    // THE CHARGE, BEFORE THE CALL.
    reserveMisdirectionCheck(input.runDir, { schemaVersion: 1, ...identities })
    budget -= 1
    let checked: MisdirectionChecked
    try {
      checked = await input.arbiter.check({
        agentQaRoot: input.agentQaRoot,
        runId,
        testId: exposure.testId,
        stepIndex: exposure.stepIndex,
        decisionOrdinal: decision.decisionOrdinal,
        recordId: exposure.recordId,
        // BUILT HERE, FROM THE LOADED HANDOFF. Nobody hands this in — see the header.
        authorization: {
          recordId: exposure.recordId,
          runId,
          perTest: memberOf(handoff, exposure.testId, exposure.perTest)!,
        },
      })
    } catch (error) {
      notices.push(`${exposure.recordId} at step ${String(exposure.stepIndex)}: ${errorText(error)}`)
      rows.push({
        ...identities,
        crossCheck: 'not-run',
        seedHonored: false,
        reason: MISDIRECTION_INTERRUPTED,
      })
      continue
    }
    const row: MisdirectionRecordResult =
      checked.kind === 'checked'
        ? {
            ...identities,
            crossCheck: checked.crossCheck,
            seedHonored: checked.seedHonored,
            ...(checked.reason === undefined ? {} : { reason: checked.reason }),
            samples: checked.samples,
          }
        : {
            ...identities,
            crossCheck: 'inconclusive',
            seedHonored: false,
            reason: checked.reason,
          }
    saveCompletedMisdirectionCheck(input.runDir, row)
    rows.push(row)
  }

  persistMisdirectionSidecar(input.handoffPath, rows)
  return { posture: 'eval-root', rows, persisted: true, cap, notices }
}

/** One exposure's identity on the LEDGER: the same key 422-11's aggregation folds by. */
function exposureKey(row: { perTest: number; stepIndex: number; recordId: string }): string {
  return `${String(row.perTest)}\u001f${String(row.stepIndex)}\u001f${row.recordId}`
}

function postureRecord(
  runId: string,
  posture: MisdirectionRootPostureRead,
): MisdirectionRunPostureRecord {
  if (posture.kind === 'eval-root') {
    return {
      schemaVersion: 1,
      runId,
      kind: 'eval-root',
      corpusDigest: posture.corpusDigest,
      profileDigest: posture.profileDigest,
    }
  }
  return posture.kind === 'no-eval-root'
    ? { schemaVersion: 1, runId, kind: 'no-eval-root' }
    : { schemaVersion: 1, runId, kind: 'broken-eval-root', reason: posture.reason }
}

/**
 * The already-answered pass: a published ledger plus a recorded posture that between them cover
 * every exposure this run owes. Returns `undefined` when anything is still owed, so the ordinary
 * path runs and pays only for what is missing.
 */
function recoverPublishedEvidence(
  input: PrepareMisdirectionEvidenceInput,
  runId: string,
  exposures: readonly MisdirectionExposure[],
): PrepareMisdirectionEvidenceResult | undefined {
  const published = input.handoff.misdirectionEvidence
  if (published === undefined) return undefined
  const recordedPosture = readMisdirectionRunPosture(input.runDir, runId)
  if (recordedPosture === undefined) return undefined
  if (recordedPosture.kind !== 'eval-root') {
    // A root-less pass owes an EMPTY ledger and nothing else, so a non-empty one is not this.
    if (published.length > 0) return undefined
    return {
      posture: recordedPosture.kind,
      rows: [],
      ...(recordedPosture.kind === 'no-eval-root' ? { backing: 'declared-only' as const } : {}),
      persisted: true,
      notices:
        recordedPosture.kind === 'no-eval-root'
          ? [MISDIRECTION_NO_EVAL_ROOT]
          : [`${MISDIRECTION_POSTURE_UNAVAILABLE}: ${recordedPosture.reason ?? 'unknown'}`],
    }
  }
  const answered = new Set(published.map(exposureKey))
  if (!exposures.every((exposure) => answered.has(exposureKey(exposure)))) return undefined
  const policy = readMisdirectionRunState(input.runDir, runId).policy
  return {
    posture: 'eval-root',
    rows: published,
    persisted: true,
    ...(policy === undefined
      ? {}
      : { cap: { maxChecks: policy.maxChecks, source: policy.source } }),
    notices: [],
  }
}

async function resolveDurableCap(
  input: PrepareMisdirectionEvidenceInput,
  runId: string,
): Promise<MisdirectionCaps> {
  const caps = await input.arbiter.resolveCaps()
  if (!Number.isSafeInteger(caps.maxChecks) || caps.maxChecks < 0) {
    throw new TypeError('misdirection check cap must be a non-negative integer')
  }
  writeMisdirectionRunPolicy(input.runDir, {
    schemaVersion: 1,
    runId,
    maxChecks: caps.maxChecks,
    source: caps.source,
  })
  // Read back rather than trusting the write: a policy that already existed WINS, and a resolution
  // that lost that race must not be the one this pass spends against.
  const state = readMisdirectionRunState(input.runDir, runId)
  return state.policy === undefined
    ? caps
    : { maxChecks: state.policy.maxChecks, source: state.policy.source }
}

/** The member outcome this exposure came from — matched on the id the enumeration carried. */
function memberOf(
  handoff: CompletedRunHandoff,
  testId: string,
  perTest: number,
): PerTestOutcome | undefined {
  return handoff.tests.find((test) => test.testId === testId && test.testIndex === perTest)
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * The host-owned preparation capability — ONE builder, composed by BOTH production run hosts and
 * by the post-verdict step's own default, and by nothing else.
 *
 * PARITY IS A PROPERTY OF THERE BEING ONE CONSTRUCTION SITE (422-09's line, held here). A
 * capability bound on the terminal and forgotten on the daemon is a behavioural split between two
 * ways of running the same product, and the two hosts' objects are compared against EACH OTHER
 * rather than against a restated literal — two restatements both go green the moment somebody
 * updates both and neither binding.
 */
export interface MisdirectionPreparationCapabilities {
  readonly prepareMisdirectionEvidence: (
    input: Omit<PrepareMisdirectionEvidenceInput, 'arbiter'>,
  ) => Promise<PrepareMisdirectionEvidenceResult>
}

export function misdirectionPreparationCapabilities(input: {
  readonly configPath: string
  readonly agentQaRoot: string
}): MisdirectionPreparationCapabilities {
  const arbiter = misdirectionArbiterForHost(input)
  return {
    prepareMisdirectionEvidence: async (prepared) =>
      await prepareMisdirectionEvidence({ ...prepared, arbiter }),
  }
}

/**
 * The eval-side port, bound lazily over this host's configuration.
 *
 * Every member defers its import of `../eval-session-composition.js` to the CALL, on
 * `createCanaryAblationForHost`'s exact idiom (418 D-01/D-08): composing a host must resolve no
 * eval session, must resolve no provider credential, and must not pull the eval composition graph
 * into a daemon child that will never arbitrate anything.
 *
 * A ROOT THAT CANNOT BE CONSULTED IS A POSTURE, NOT A CRASH. Every arm converts its own failure
 * into the honest answer — `broken-eval-root`, `unavailable` — because post-processing may never
 * cost the verdict, and a throw here would become a retry asking the same unanswerable question.
 */
export function misdirectionArbiterForHost(input: {
  readonly configPath: string
  readonly agentQaRoot: string
}): MisdirectionArbiterPort {
  const session = async () => {
    const { resolveEvalSession } = await import('../eval-session-composition.js')
    return await resolveEvalSession({ configPath: input.configPath, keyOnly: true })
  }
  return {
    async rootPosture() {
      try {
        const { readMisdirectionRootPosture } = await import('../eval-session-composition.js')
        return await readMisdirectionRootPosture(await session())
      } catch (error) {
        return { kind: 'broken-eval-root', reason: errorText(error) }
      }
    },
    async resolveCaps() {
      const { resolveMisdirectionCaps } = await import('../eval-session-composition.js')
      return resolveMisdirectionCaps(await session())
    },
    async locate(target) {
      try {
        const { locateMisdirectionDecision } = await import('../eval-session-composition.js')
        return await locateMisdirectionDecision(await session(), target)
      } catch (error) {
        return { kind: 'unavailable', reason: errorText(error) }
      }
    },
    async check(target) {
      const { runMisdirectionCheck } = await import('../eval-session-composition.js')
      return await runMisdirectionCheck(await session(), target)
    },
  }
}
