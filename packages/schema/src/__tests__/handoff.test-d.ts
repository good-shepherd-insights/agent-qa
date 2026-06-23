import { expectTypeOf } from 'vitest'
import { CURRENT_HANDOFF_SCHEMA_VERSION } from '../handoff/completed-run-handoff'
import type { Action } from '../action/index'
import type { ServedBrief } from '../brief/served-brief'
import type { CompletedRunHandoff } from '../handoff/completed-run-handoff'
import type { PerTestOutcome } from '../handoff/per-test-outcome'
import type { StepEvidence, VerifierVerdict } from '../handoff/step-evidence'
import type { SubActionEvidence } from '../handoff/sub-action-evidence'
import type { ArtifactRef } from '../ids/artifact-ref'
import type { ActionResult } from '../result/index'
import type { RunStatus } from '../run/run-status'
import type { ScreenState } from '../screen/screen-state'

expectTypeOf<CompletedRunHandoff['aggregateVerdict']>().toEqualTypeOf<RunStatus>()

const verdictShaped = { class: 'app_bug' as const }

// @ts-expect-error aggregateVerdict is a RunStatus execution verdict, not a root-cause Verdict.
const invalidAggregateVerdict: CompletedRunHandoff['aggregateVerdict'] = verdictShaped

expectTypeOf<SubActionEvidence['stateBefore']>().toEqualTypeOf<ScreenState>()
expectTypeOf<SubActionEvidence['stateAfter']>().toEqualTypeOf<ScreenState | undefined>()
expectTypeOf<SubActionEvidence['artifactRefs']>().toEqualTypeOf<ArtifactRef[] | undefined>()

expectTypeOf<CompletedRunHandoff['tests']>().toEqualTypeOf<PerTestOutcome[]>()
expectTypeOf<PerTestOutcome['steps']>().toEqualTypeOf<StepEvidence[]>()
expectTypeOf<StepEvidence['subActions']>().toEqualTypeOf<SubActionEvidence[]>()
expectTypeOf<StepEvidence['servedBrief']>().toEqualTypeOf<ServedBrief>()

expectTypeOf<CompletedRunHandoff['schemaVersion']>().toEqualTypeOf<number>()
expectTypeOf(CURRENT_HANDOFF_SCHEMA_VERSION).toMatchTypeOf<number>()

expectTypeOf<StepEvidence['cacheStatus']>().toEqualTypeOf<'hit' | 'miss' | 'bypass'>()
expectTypeOf<StepEvidence['verifierVerdict']>().toEqualTypeOf<VerifierVerdict>()
expectTypeOf<VerifierVerdict>().toEqualTypeOf<{ pass: boolean; reasoning: string }>()

const verifierVerdictShaped = { class: 'app_bug' as const }

// @ts-expect-error verifierVerdict is a verifier pass/reasoning shape, not a root-cause Verdict.
const invalidVerifierVerdict: StepEvidence['verifierVerdict'] = verifierVerdictShaped

expectTypeOf<SubActionEvidence['plannedAction']>().toEqualTypeOf<Action>()
expectTypeOf<SubActionEvidence['result']>().toEqualTypeOf<ActionResult>()
expectTypeOf<PerTestOutcome['outcome']>().toEqualTypeOf<RunStatus>()

void invalidAggregateVerdict
void invalidVerifierVerdict
