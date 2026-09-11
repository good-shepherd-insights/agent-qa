// The one verdict read path (Phase 389, D-10).
//
// Two producers now exist for one `(runId, testId)` verdict — the runner's deterministic
// classifier persisted on the handoff, and analyze-run's authored artifact. THE resolved
// verdict is served by this accessor and nowhere else: artifact verdicts when the artifact
// is present, the handoff's deterministic floor when it is absent. The supersession-as-
// upgrade law lives HERE — a consumer that read `rootCause` off the handoff directly would
// be re-deriving the supersession rule, and the SC2 "second independent observation" defect
// class returns the day two consumers derive it differently.

import type { CompletedRunHandoff } from '../handoff/completed-run-handoff'
import type { PerTestOutcome } from '../handoff/per-test-outcome'
import type { RunAnalysisArtifact } from './analysis-artifact'
import type {
  MemoryOnPathEntry,
  MisdirectionEvidence,
} from './misdirection-evidence'
import type { Verdict } from './verdict'

/**
 * What a RESOLVED verdict says about circularity (422 D-17/D-19) — three arms, not two.
 *
 * `not-recorded` is every verdict written before 422 and every verdict from a producer that
 * shipped no ledger. It is NOT `declared-only`: that word is D-19's specific claim that an
 * evaluation root was ABSENT, and handing it to a verdict that never made it would be the
 * reader inventing a backing. It is certainly not `held`.
 */
export type ResolvedMisdirection =
  | { readonly state: 'not-recorded' }
  | {
      readonly state: 'declared-only'
      readonly evidence: MisdirectionEvidence
      readonly memoryOnPath?: readonly MemoryOnPathEntry[]
    }
  | {
      readonly state: 'measured'
      readonly evidence: MisdirectionEvidence
      readonly memoryOnPath?: readonly MemoryOnPathEntry[]
    }

/**
 * Read a resolved verdict's circularity evidence without inventing any (422 D-17/D-19).
 *
 * Pure projection, three refusals to invent:
 *
 *   - No `misdirectionRuledOut` answers `not-recorded`, whatever else the verdict carries. A
 *     declared `memoryOnPath` with no ledger beside it is a list of records nobody cross-checked
 *     — reporting it as anything but "not recorded" would read a declaration as a result.
 *   - The `declared-only` marker is reported as its own state, never folded into `measured`.
 *     D-19 admits it only under a genuinely ABSENT evaluation root, and a surface that showed it
 *     as a measurement would present the author's own word as the check on the author's word.
 *   - An ABSENT `memoryOnPath` stays absent rather than becoming `[]`. "The author declared no
 *     records" and "the author declared nothing" are different claims, and this phase keeps them
 *     apart everywhere else.
 *
 * The evidence object is passed through by reference and never rebuilt, so a `flipped` row
 * cannot be softened on the way to a reader.
 */
export function resolveVerdictMisdirection(verdict: Verdict): ResolvedMisdirection {
  const evidence = verdict.misdirectionRuledOut
  if (evidence === undefined) return { state: 'not-recorded' }
  const declaration =
    verdict.memoryOnPath === undefined ? {} : { memoryOnPath: verdict.memoryOnPath }
  if (evidence.backing === 'declared-only') {
    return { state: 'declared-only', evidence, ...declaration }
  }
  return { state: 'measured', evidence, ...declaration }
}

/**
 * Members whose outcome is worth a root-cause verdict — the complement of the runner's own
 * presence rule (373-07): clean passes, skipped and cancelled members are not failures to
 * explain. Mirrors the agent handler's floor projection member-for-member.
 */
function needsVerdict(test: PerTestOutcome): boolean {
  return test.outcome !== 'passed' && test.outcome !== 'skipped' && test.outcome !== 'cancelled'
}

/**
 * The floor's minted `unknown`, byte-identical to the runner's `deterministicVerdict`
 * output for an absent signal (confidence 0, the fixed rationale template, empty evidence
 * arrays). Minted here rather than imported because the dependency points the other way —
 * the runner consumes schema — and the two spellings are pinned equal by test.
 */
function mintedUnknown(perTest: number): Verdict {
  return {
    class: 'unknown',
    producer: 'deterministic-classifier',
    confidence: 0,
    evidence: {
      citedSteps: [],
      citedAnchors: [],
      citedArtifacts: [],
      rationale: 'no deterministic signal matched',
    },
    memoryMisdirectionRuledOut: true,
    perTest,
  }
}

/**
 * THE only way any consumer obtains a run's verdicts (D-10).
 *
 * Artifact present → the authored verdicts, whole. Artifact absent → the deterministic
 * floor: each member needing a verdict answers its persisted `rootCause`, and a failed
 * member that carries none resolves to the minted `unknown` — the same fill the
 * classifier itself would have minted, so the array covers every failure either way.
 *
 * Pure over its two arguments. Whoever loads the artifact loads it through
 * `guardRunAnalysisArtifact`; this function never touches a byte of storage.
 *
 * 422 D-17 — WHAT THIS FUNCTION MUST NOT DO. Both paths hand back the verdict OBJECT it found,
 * so a per-record cross-check ledger, a `declared-only` backing marker and an attribution block
 * all survive resolution byte-for-byte; a projection that rebuilt a verdict field-by-field would
 * silently drop every member added after it was written. And the floor's {@link mintedUnknown}
 * carries NO circularity evidence, because it is minted precisely for a member nobody authored
 * anything about — minting `held` there would be the build asserting a cross-check that never
 * ran, on the one population where nothing is known.
 */
export function resolveRunVerdicts(
  artifact: RunAnalysisArtifact | undefined,
  handoff: CompletedRunHandoff,
): Verdict[] {
  if (artifact !== undefined) return [...artifact.verdicts]
  return handoff.tests
    .filter(needsVerdict)
    .map((test) => test.rootCause ?? mintedUnknown(test.testIndex))
}
