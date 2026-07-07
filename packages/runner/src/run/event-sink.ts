// The evidence → projection → mask → bus bridge (D-02/D-09/D-10). The run shell binds one
// MemberEventSink per member test; the loop drives it as steps run. Every payload that reaches
// the bus is routed through the schema projections (which collapse raw state/steps to identity)
// AND the D-09 MaskFn, so no value-bearing string escapes the masking chokepoint. The identity
// the loop never learns — `testIndex` (bound at sink construction) and `stepIndex` (curried by
// `loopEmitFor`) — is supplied HERE, killing the all-zero-stepIndex hazard (RESEARCH Pitfall 4).
//
// Telemetry never throws into the loop (D-02/D-07): every method is wrapped so a projection or
// publish failure degrades to a single best-effort `runWarning` and is otherwise swallowed. This
// module carries ZERO verdict logic and touches NO fs — it is a pure bus adapter.

import type { MaskingContext, StepEvidence, SubActionEvidence } from '@vostride/agent-qa-schema'
import { projectStepFinalized, projectSubActionRecorded } from '@vostride/agent-qa-schema'
import type { RunEventBus } from './bus.js'
import type { MemberEventSink } from './ports.js'
import type { LoopEventEmitPort } from '../loop/ports.js'

/**
 * Run one telemetry emission, isolating the loop from any projection/publish failure. On error
 * a single `runWarning` is attempted (itself guarded — a bus that cannot even accept a warning is
 * simply dropped) and the error is swallowed: telemetry is fire-and-forget and NEVER re-enters
 * the loop (D-02/D-07). Verdict independence is preserved by construction.
 */
function guardEmit(bus: RunEventBus, fn: () => void): void {
  try {
    fn()
  } catch (error) {
    try {
      bus.publish('runWarning', {
        code: 'event-sink-error',
        message: error instanceof Error ? error.message : String(error),
      })
    } catch {
      // The bus itself is unusable (e.g. closed) — drop; telemetry never throws into the loop.
    }
  }
}

/**
 * Build the per-member {@link MemberEventSink} the shell hands to the executor context (D-02).
 * `testIndex` is bound here; `stepIndex` is curried by `loopEmitFor`. `masking.mask` is the D-09
 * seam (identity pre-362). All three payload kinds go through the schema projections + mask.
 */
export function createMemberEventSink(deps: {
  bus: RunEventBus
  masking: MaskingContext
  testIndex: number
}): MemberEventSink {
  const { bus, masking, testIndex } = deps
  const mask = (text: string): string => masking.mask(text)

  return {
    stepStarted(input: { stepIndex: number; stepText: string }): void {
      guardEmit(bus, () => {
        bus.publish('stepStarted', {
          testIndex,
          stepIndex: input.stepIndex,
          stepText: mask(input.stepText),
        })
      })
    },

    loopEmitFor(stepIndex: number): LoopEventEmitPort {
      return {
        stepFinalized(evidence: StepEvidence): void {
          guardEmit(bus, () => {
            bus.publish(
              'stepFinalized',
              projectStepFinalized(evidence, { testIndex, stepIndex }, mask),
            )
          })
        },
        subActionRecorded(evidence: SubActionEvidence, subActionIndex: number): void {
          guardEmit(bus, () => {
            bus.publish(
              'subActionRecorded',
              projectSubActionRecorded(evidence, { testIndex, stepIndex, subActionIndex }, mask),
            )
          })
        },
      }
    },
  }
}
