// §A8 handoff assembly (D-04/D-07/D-17/D-20). Pure functions that fold per-member TestResults
// into PerTestOutcomes and the one CompletedRunHandoff a run persists. Two invariants live here:
//
//  1. Step re-indexing + evidence synthesis (RESEARCH Pitfall 4 / Open Q1). The loop hardcodes
//     StepEvidence.stepIndex to 0, so the authoritative index is the array position — always
//     OVERRIDDEN here. A step that carries NO §A8 evidence is NOT dropped: §A8 consumers expect
//     the step list to cover every executed step, so a minimal StepEvidence is synthesized,
//     masked-before-record like every real evidence field.
//  2. Identity is copied FROM RunConfig, never re-derived (D-04/D-20): runId/scope/buildOrdinal/
//     executionContext/configDigests on the handoff are the exact values the run keyed on, so run
//     identity and handoff identity cannot fork by construction.
//
// This module carries the EXECUTION verdict (RunStatus) and ATTACHES a caller-supplied root-cause
// Verdict onto PerTestOutcome (373-07) — it never DERIVES one (§A9 boundary): all root-cause logic
// lives in run/root-cause.ts behind the shell's classify call (D-05). No fs, no providers.

import type {
  CompletedRunHandoff,
  DeclaredModelProfile,
  MemberTestOutcome,
  ModelIdentity,
  PerTestOutcome,
  RunStatus,
  ScopeKey,
  StepEvidence,
  Verdict,
} from '@vostride/agent-qa-schema'
import { CURRENT_HANDOFF_SCHEMA_VERSION } from '@vostride/agent-qa-schema'
import type { MaskFn } from '@vostride/agent-qa-schema'
import type { RunConfig, RunMemberDescriptor } from './ports.js'
import type { StepResult, TestResult } from '../result.js'
import { makeEmptyServedBrief } from '../loop/evidence.js'

interface SynthDeps {
  scope: ScopeKey
  buildOrdinal: number
  mask: MaskFn
  modelProfile?: DeclaredModelProfile
  verifierIdentity?: ModelIdentity
  toolSchemaDigest?: string
}

/**
 * Synthesize a minimal, fully-typed {@link StepEvidence} for an executed step the loop finished
 * WITHOUT recording §A8 evidence (Open Q1: synthesize, do not drop). `cacheStatus` is `'bypass'`
 * — the shipped not-cache-served member of the union (the step never touched the cache) — and the
 * verifier verdict mirrors the step status with its error text passed through `mask` (masked-
 * before-record, identical to real evidence). `servedBrief` is the canonical empty brief.
 */
function synthesizeStepEvidence(step: StepResult, stepIndex: number, deps: SynthDeps): StepEvidence {
  const passed = step.status === 'passed' || step.status === 'healed'
  const reasoning = step.error ?? `synthesized: step "${step.name}" ${step.status} (no §A8 evidence recorded)`
  return {
    stepIndex,
    stepText: deps.mask(step.name),
    cacheStatus: 'bypass',
    servedBrief: makeEmptyServedBrief(deps.scope, deps.buildOrdinal),
    subActions: [],
    verifierVerdict: {
      pass: passed,
      reasoning: deps.mask(reasoning),
    },
    ...(deps.modelProfile !== undefined ? { modelProfile: deps.modelProfile } : {}),
    ...(deps.verifierIdentity !== undefined ? { verifierIdentity: deps.verifierIdentity } : {}),
    ...(deps.toolSchemaDigest !== undefined ? { toolSchemaDigest: deps.toolSchemaDigest } : {}),
  }
}

/**
 * Fold one completed member {@link TestResult} + its derived {@link MemberTestOutcome} into a
 * {@link PerTestOutcome}. Steps are built from `result.steps`: a step with §A8 evidence carries it
 * (with `stepIndex` OVERRIDDEN to its array position); an evidence-less step gets a synthesized
 * minimal StepEvidence. `testIndex` is the shell-owned array position.
 *
 * `rootCause` is the shell-classified §A9 verdict (373-07): attached ONLY when defined so clean
 * passes/skipped/cancelled members stay rootCause-free in the persisted JSON (the D-01 presence
 * rule — the key is absent, never undefined-valued).
 *
 * `deps.quarantined` is the 390 D-14 disposition, stamped BESIDE `outcome` under the same
 * presence rule. It never alters `outcome`: a quarantined failing member reads `'failed'` here, and
 * the licence to ignore that failure lives entirely in the aggregate rule and in this marker.
 */
export function assemblePerTestOutcome(
  member: RunMemberDescriptor,
  result: TestResult,
  outcome: MemberTestOutcome,
  deps: {
    testIndex: number
    scope: ScopeKey
    buildOrdinal: number
    mask: MaskFn
    modelProfile?: DeclaredModelProfile
    verifierIdentity?: ModelIdentity
    toolSchemaDigest?: string
    quarantined?: true
  },
  rootCause?: Verdict,
): PerTestOutcome {
  const synthDeps: SynthDeps = {
    scope: deps.scope,
    buildOrdinal: deps.buildOrdinal,
    mask: deps.mask,
    modelProfile: deps.modelProfile,
    verifierIdentity: deps.verifierIdentity,
    toolSchemaDigest: deps.toolSchemaDigest,
  }
  const steps: StepEvidence[] = result.steps.map((step, index) =>
    step.evidence !== undefined
      ? { ...step.evidence, stepIndex: index }
      : synthesizeStepEvidence(step, index, synthDeps),
  )
  return {
    testId: member.testId,
    testName: member.name,
    filePath: member.filePath,
    testIndex: deps.testIndex,
    outcome,
    steps,
    ...(rootCause !== undefined ? { rootCause } : {}),
    ...(deps.quarantined === true ? { quarantined: true as const } : {}),
  }
}

/**
 * The shell-produced skip outcome (D-15): a member the shell never invoked (run aborted, or a
 * poisoned same-group member). `outcome: 'skipped'`, no steps — neutral in the aggregate fold.
 *
 * `quarantined` is still stamped when the ledger licensed this member (390 D-14): the disposition
 * describes the TEST's standing, not the outcome it happened to reach, so a reader of the handoff
 * sees the same truth whether the member ran or was skipped past.
 */
export function skippedPerTestOutcome(
  member: RunMemberDescriptor,
  testIndex: number,
  quarantined?: true,
): PerTestOutcome {
  return {
    testId: member.testId,
    testName: member.name,
    filePath: member.filePath,
    testIndex,
    outcome: 'skipped',
    steps: [],
    ...(quarantined === true ? { quarantined: true as const } : {}),
  }
}

/**
 * Assemble the one {@link CompletedRunHandoff} a run persists (D-17). Every header field is copied
 * verbatim FROM the resolved {@link RunConfig} (D-04/D-20 — never re-derived); `aggregateVerdict`
 * is the execution verdict; `tests` are the assembled per-member outcomes in run order.
 *
 * 390 D-16: `quarantineApplied` records the ledger entries this run was operating under, copied
 * from the same resolved config the disposition markers were matched against — so the run's own
 * receipt answers "which suppressions were licensed here, and until when" without re-reading a
 * ledger that may since have changed. An empty set stays ABSENT, keeping every unquarantined run's
 * handoff bytes identical to pre-390.
 */
export function assembleHandoff(
  config: RunConfig,
  outcomes: PerTestOutcome[],
  aggregateVerdict: RunStatus,
  timing: { startedAt: number; endedAt: number },
): CompletedRunHandoff {
  return {
    schemaVersion: CURRENT_HANDOFF_SCHEMA_VERSION,
    runId: config.runId,
    scope: config.scope,
    buildOrdinal: config.buildOrdinal,
    ...(config.excludedFromOutcomes === true ? { excludedFromOutcomes: true } : {}),
    ...(config.gateRun === true ? { gateRun: true } : {}),
    executionContext: config.executionContext,
    aggregateVerdict,
    configDigests: config.configDigests,
    startedAt: timing.startedAt,
    endedAt: timing.endedAt,
    tests: outcomes,
    ...(config.quarantined !== undefined && config.quarantined.length > 0
      ? { quarantineApplied: config.quarantined }
      : {}),
  }
}
