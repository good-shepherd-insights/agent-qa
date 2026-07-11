// The ONE sanctioned replay-composition helper (Phase 368, D-04/D-05/D-06). This is the single
// host binding that wires the pure eval-core replay engine to the production runner/model/safety
// stack — eval-local deliberately becomes the SECOND package (after cli) importing both `model`
// and `runner`, a contract-visible arch change recorded in ownership-contract.ts. Phase 372's
// CLI wraps exactly this function.
//
// Composition law (RPLY-02):
//   - `createModel` is the ONLY egress path and the ONLY call site here — every replayed prompt
//     rides its pinned-last mask/guardrail middleware (validate:safety enforced). A FRESH
//     ModelProfile copy is built before the call because createModel mutates `profile.capabilities`
//     (RESEARCH Pitfall 8); the handle is shared across samples (RESEARCH A3).
//   - The replay planner runs at temperature 0 via the 366 sampling seam
//     (DeclaredModelProfile.sampling), with a FRESH createTokenAccounting + LLMPlanner per sample
//     (RESEARCH Pitfall 6) — the 368-01 `nonActionTools` ctor seam threads the recorded-exchange
//     server through unmodified production planner code.
//   - Model selection derives ONLY from the caller-supplied profile, never the recorded id (D-03):
//     recorded vs replayed ids are both stamped on the result, neither is enforced.
//   - The ENTIRE replayCassette invocation runs inside runSafetyScope with an empty-seeded
//     MaskingContext (cassette content is already placeholder-masked at extraction; the guardrail
//     detectors still scan every replayed prompt) and a replay-scoped JsonlAuditSink under the
//     replay output dir (D-06 / T-368-12 / T-368-13). The masking context is disposed in `finally`.

import {
  buildDecisionDiff,
  neverEscalate,
  replayCassette,
  scoreCassetteReplay,
} from '@vostride/agent-qa-eval'
import type {
  ArtifactSource,
  Cassette,
  CassetteScore,
  DecisionDiff,
  ReplayCassetteInput,
  ReplayCassetteOutcome,
  ReplayClock,
  ReplayEscalationPredicate,
  ReplayPlannerFactory,
  ReplayPlannerHandle,
  ReplayResult,
} from '@vostride/agent-qa-eval'
import {
  createModel,
  createTokenAccounting,
  resolveCapabilities,
} from '@vostride/agent-qa-model'
import type {
  ModelProfile,
  ModelProviderOverrides,
  ResolvedModelAuth,
} from '@vostride/agent-qa-model'
import { LLMPlanner, buildTools, defaultRegistry } from '@vostride/agent-qa-runner'
import type { DeclaredModelProfile, ScreenState } from '@vostride/agent-qa-schema'
import { createMaskingContext } from '@vostride/agent-qa-safety'
import { JsonlAuditSink, runSafetyScope } from '@vostride/agent-qa-safety-local'

import type { FsReplayRecordStore } from './replay-record-store.js'
import type { FsScoreStore } from './score-store.js'

export interface RunCassetteReplayInput {
  /** A loaded, guarded cassette (leaf or procedure) — normally from loadCassetteBundle. */
  cassette: Cassette
  /** Blob source for full-capture screenshot reconstruction (normally a DirArtifactSource). */
  artifacts: ArtifactSource
  /** The currently-configured model profile — the SOLE source of model selection (D-03). */
  profile: ModelProfile
  /** Resolved provider auth for the configured model. */
  auth: ResolvedModelAuth
  /** Optional provider overrides — the captured-boundary stub seam for tests (createModel passthrough). */
  modelOverrides?: ModelProviderOverrides
  /** Sample budget (D-10). Defaults to the engine's k=1. */
  k?: number
  /** Optional replay seed applied through the 366 sampling seam when the provider supports it. */
  seed?: number
  /** k-sample escalation seam (D-10). Defaults to the imported neverEscalate — never re-minted. */
  escalationPredicate?: ReplayEscalationPredicate
  /** Replay-scoped audit-sink base dir (the JsonlAuditSink lands guardrail/execution rows here). */
  replayOutputBaseDir: string
  /** Optional persistence: when supplied, the outcome is saved after the safety scope closes (D-12). */
  recordStore?: FsReplayRecordStore
  /**
   * Optional D-13 score persistence: when supplied and the outcome is a ReplayResult (refusals are
   * never scored — reports count them instead), the score + per-decision diffs are computed in
   * eval core and saved AFTER recordStore.save (record-then-score ordering, OQ-2).
   */
  scoreStore?: FsScoreStore
}

/** The platform the action-tool slice is derived for — the cassette's recorded observation platform. */
function cassettePlatform(cassette: Cassette): ScreenState['platform'] {
  if (cassette.granularity === 'leaf') {
    return cassette.input.stateBefore.platform
  }
  for (const step of cassette.steps) {
    if (step.kind === 'decision') {
      return step.record.input.stateBefore.platform
    }
  }
  return 'web'
}

function isReplayResult(outcome: ReplayCassetteOutcome): outcome is ReplayResult {
  return 'granularity' in outcome
}

/**
 * The matcher-constitution stamp already minted inside the eval-core score — read for the persisted
 * record's attribution field, never computed here (F9).
 */
function scoreMatcherVersion(score: CassetteScore): number {
  if (score.kind === 'shape-mismatch') return score.matcherVersion
  const entries =
    score.kind === 'leaf' ? [score.entry] : score.kind === 'procedure' ? score.entries : []
  for (const entry of entries) {
    if (entry.kind === 'decision') return entry.score.matcherVersion
    if (entry.kind === 'never-scored') return entry.matcherVersion
  }
  // Unreachable through this composition: refusal outcomes are guarded before scoring, and every
  // extracted cassette carries at least one decision entry.
  throw new Error('cassette score carries no matcher-version stamp')
}

/**
 * Orchestrate eval core's buildDecisionDiff over every scored decision entry — joining each entry
 * back to its recorded sidecar/elements and its replayed decision result. Pure plumbing: the diff
 * content itself is computed entirely in eval core (F9).
 */
function decisionDiffs(
  cassette: Cassette,
  outcome: ReplayResult,
  score: CassetteScore,
): DecisionDiff[] {
  if (score.kind === 'leaf') {
    if (cassette.granularity !== 'leaf' || outcome.granularity !== 'leaf') return []
    const entry = score.entry
    if (entry.kind !== 'decision') return []
    return [
      buildDecisionDiff({
        cassetteId: cassette.id,
        decisionOrdinal: entry.decisionOrdinal,
        sidecar: cassette.sidecar,
        elements: cassette.input.stateBefore.elements,
        result: outcome,
        score: entry.score,
      }),
    ]
  }

  if (score.kind !== 'procedure') return []
  if (cassette.granularity !== 'procedure' || outcome.granularity !== 'procedure') return []
  const diffs: DecisionDiff[] = []
  for (const entry of score.entries) {
    if (entry.kind !== 'decision') continue
    const step = outcome.steps.find(
      candidate =>
        candidate.kind === 'decision' &&
        candidate.stepIndex === entry.stepIndex &&
        candidate.decisionOrdinal === entry.decisionOrdinal,
    )
    const record = cassette.steps.find(
      candidate =>
        candidate.kind === 'decision' &&
        candidate.stepIndex === entry.stepIndex &&
        candidate.decisionOrdinal === entry.decisionOrdinal,
    )
    if (step?.kind !== 'decision' || record?.kind !== 'decision') continue
    diffs.push(
      buildDecisionDiff({
        cassetteId: cassette.id,
        ...(entry.stepIndex === undefined ? {} : { stepIndex: entry.stepIndex }),
        decisionOrdinal: entry.decisionOrdinal,
        sidecar: record.record.sidecar,
        elements: record.record.input.stateBefore.elements,
        result: step.result,
        score: entry.score,
      }),
    )
  }
  return diffs
}

/**
 * Run one loaded cassette through the pure replay engine bound to the production planner/model/
 * safety stack, optionally persisting the typed outcome. The one sanctioned model+runner
 * composition in eval-local (D-04).
 */
export async function runCassetteReplay(
  input: RunCassetteReplayInput,
): Promise<ReplayCassetteOutcome> {
  // Fresh ModelProfile copy: createModel mutates `profile.capabilities` (RESEARCH Pitfall 8), so
  // the caller's object is never touched and the one call site owns its own copy.
  const profileCopy: ModelProfile = {
    ...input.profile,
    ...(input.profile.capabilities !== undefined
      ? { capabilities: { ...input.profile.capabilities } }
      : {}),
  }
  const capabilities = resolveCapabilities(profileCopy)

  // Temp-0 declared profile via the 366 sampling seam — model identity comes ONLY from the caller
  // profile (D-03), sampling pins temperature 0 with an optional caller-supplied seed.
  const replayProfile: DeclaredModelProfile = {
    provider: input.profile.provider,
    modelId: input.profile.model,
    vision: capabilities.vision,
    maxOutputTokens: capabilities.maxOutput,
    sampling: { temperature: 0, ...(input.seed !== undefined ? { seed: input.seed } : {}) },
  }

  // The ONLY createModel call site and the ONLY egress path. The handle is shared across samples
  // (RESEARCH A3); per-sample freshness is confined to accounting + planner + exchange server.
  const model = createModel(profileCopy, input.auth, input.modelOverrides ?? {})
  const replayedModel = { provider: input.profile.provider, modelId: input.profile.model }

  const plannerFactory: ReplayPlannerFactory = {
    create({ platform, nonActionTools }): ReplayPlannerHandle {
      // Fresh accounting per sample so clamp/degrade + per-sample token cost stay attributable.
      const accounting = createTokenAccounting({
        getCapabilities: () => resolveCapabilities(profileCopy),
      })
      // Fresh unmodified LLMPlanner per sample; the 368-01 nonActionTools ctor seam threads the
      // recorded-exchange server through the real bounded tool-loop.
      const planner = new LLMPlanner(
        model,
        platform,
        undefined,
        undefined,
        accounting,
        replayProfile,
        nonActionTools,
      )
      return {
        plan: (stepText, screenState, context) => planner.plan(stepText, screenState, context),
        model,
        replayedModel,
      }
    },
  }

  // The action slice a recorded exchange may never shadow (RESEARCH Open Q2): derived here in the
  // host from buildTools so the engine stays pure. plan() rebuilds the same slice internally.
  const actionToolNames: ReadonlySet<string> = new Set(
    Object.keys(buildTools(defaultRegistry, { platform: cassettePlatform(input.cassette) })),
  )

  // Host wall-clock behind the eval-core ReplayClock port (eval core bans host time APIs).
  const clock: ReplayClock = { now: () => performance.now() }

  // D-06 safety scope: empty-seeded masking (pass-through by construction; guardrails still scan
  // every replayed prompt) + a replay-scoped JsonlAuditSink under the replay output dir. The
  // executionContext is omitted so the live host detector resolves it.
  const maskingContext = createMaskingContext()
  const auditSink = new JsonlAuditSink(input.replayOutputBaseDir)

  const engineInput: ReplayCassetteInput = {
    cassette: input.cassette,
    artifacts: input.artifacts,
    plannerFactory,
    actionToolNames,
    clock,
    ...(input.k !== undefined ? { k: input.k } : {}),
    escalationPredicate: input.escalationPredicate ?? neverEscalate,
  }

  let outcome: ReplayCassetteOutcome
  try {
    // The ENTIRE engine invocation runs inside runSafetyScope so the ALS bundle propagates to
    // every plan() → createModel egress call.
    outcome = await runSafetyScope({ maskingContext, auditSink }, () => replayCassette(engineInput))
  } finally {
    maskingContext.dispose()
  }

  if (input.recordStore !== undefined) {
    input.recordStore.save(outcome)
  }

  // Record-then-score ordering is load-bearing (OQ-2): the record store recreates the cassette dir
  // in full (rm + mkdir), so the file-scoped score write MUST land after it — never before —
  // or a re-run would wipe the fresh score.json. Refusals save a record but never a score
  // (they are counted in reports instead). Score + diffs are computed in eval core (F9);
  // this composition only orchestrates and saves.
  if (input.scoreStore !== undefined && isReplayResult(outcome)) {
    const score = scoreCassetteReplay(input.cassette, outcome)
    input.scoreStore.save({
      cassetteId: input.cassette.id,
      matcherVersion: scoreMatcherVersion(score),
      score,
      diffs: decisionDiffs(input.cassette, outcome, score),
    })
  }

  return outcome
}
