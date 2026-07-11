import { describe, expect, it } from 'vitest'
import { asRef } from '@vostride/agent-qa-schema'
import {
  makeSidecar,
  procedureCassette,
} from '../../replay/__tests__/fixtures'
import {
  computeDecisionIdentity,
  decisionIdentityKey,
} from '../../replay/identity'
import {
  collectProcedurePriorIdentities,
  computeLoopVerdict,
} from '../loop'

describe('computeLoopVerdict', () => {
  const candidate = {
    opClass: 'click',
    target: { role: 'button', nameNormalized: 'log in', ordinal: 0 },
  }

  it('flags the first same-screen prior step with the same decision identity', () => {
    expect(
      computeLoopVerdict(candidate, 'screen-a', [
        {
          identityKey: decisionIdentityKey(candidate),
          screenStateHash: 'screen-a',
          stepIndex: 4,
        },
      ]),
    ).toEqual({ kind: 'flagged', priorStepIndex: 4 })
  })

  it('does not flag the same identity on a different screen', () => {
    expect(
      computeLoopVerdict(candidate, 'screen-b', [
        {
          identityKey: decisionIdentityKey(candidate),
          screenStateHash: 'screen-a',
          stepIndex: 4,
        },
      ]),
    ).toEqual({ kind: 'none' })
  })

  it('marks leaf decisions as not applicable without fabricating procedure history', () => {
    expect(computeLoopVerdict(candidate, 'screen-a', 'leaf-no-history')).toEqual({
      kind: 'not-applicable',
    })
  })

  it('treats an empty procedure prefix as applicable history with no repeat', () => {
    expect(computeLoopVerdict(candidate, 'screen-a', [])).toEqual({ kind: 'none' })
  })
})

describe('collectProcedurePriorIdentities', () => {
  it('collects decision-step gold identities in step order and skips non-decisions', () => {
    const cassette = procedureCassette([
      {
        sidecar: makeSidecar({ goldAction: { type: 'click', ref: asRef('e2') } }),
        receipt: { screenStateHash: 'screen-a' },
      },
      {
        sidecar: makeSidecar({
          goldAction: { type: 'fill', ref: asRef('e1'), text: 'Person@example.test' },
        }),
        receipt: { screenStateHash: 'screen-b' },
      },
    ])
    const decisionSteps = cassette.steps.filter(step => step.kind === 'decision')

    expect(collectProcedurePriorIdentities(cassette)).toEqual(
      decisionSteps.map(step => ({
        identityKey: decisionIdentityKey(
          computeDecisionIdentity(step.record.sidecar.goldAction, step.record.input.stateBefore.elements),
        ),
        screenStateHash: step.record.receipt.screenStateHash,
        stepIndex: step.stepIndex,
      })),
    )
  })
})
