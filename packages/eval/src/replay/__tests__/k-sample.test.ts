import { PlanningTurnError } from '@vostride/agent-qa-runner'
import { describe, expect, it } from 'vitest'
import type { ArtifactSource } from '../../ports'
import type { ReplayEscalationPredicate } from '../ports'
import type { DecisionReplayResult, ProcedureReplayResult } from '../result'
import { replayCassette } from '../replay-run'
import {
  PROCEDURE_END_STATE,
  actionsFactory,
  decisionPlan,
  fixedIncrementClock,
  leafCassette,
  makeFactory,
  procedureCassette,
} from './fixtures'

const emptyArtifacts: ArtifactSource = { getBlob: () => undefined }
const alwaysEscalate: ReplayEscalationPredicate = () => true

describe('replayCassette — k-sample agreement', () => {
  it('Test 1: the default (neverEscalate) predicate runs exactly one sample even at k=3', async () => {
    const probe = actionsFactory([
      { type: 'click', ref: 'e2' },
      { type: 'click', ref: 'e1' },
      { type: 'click', ref: 'e2' },
    ])
    const outcome = (await replayCassette({
      cassette: leafCassette(),
      artifacts: emptyArtifacts,
      plannerFactory: probe.factory,
      actionToolNames: new Set(),
      clock: fixedIncrementClock(),
      k: 3,
    })) as DecisionReplayResult
    expect(probe.createCount()).toBe(1)
    expect(outcome.samples).toHaveLength(1)
    expect(outcome.agreement.k).toBe(1)
    expect(outcome.agreement.agreementRate).toBe(1)
  })

  it('Test 2: a forced always-escalate predicate at k=3 runs three fresh samples', async () => {
    const probe = makeFactory(() => decisionPlan({ type: 'click', ref: 'e2' }))
    await replayCassette({
      cassette: leafCassette({
        leg: { exchanges: [{ tool: 'lookup', args: { query: 'a' }, result: 'ok' }] },
      }),
      artifacts: emptyArtifacts,
      plannerFactory: probe.factory,
      actionToolNames: new Set(),
      clock: fixedIncrementClock(),
      k: 3,
      escalationPredicate: alwaysEscalate,
    })
    expect(probe.createCount()).toBe(3)
    const creates = probe.creates()
    expect(creates[0].nonActionTools).not.toBe(creates[1].nonActionTools)
    expect(creates[1].nonActionTools).not.toBe(creates[2].nonActionTools)
  })

  it('Test 3: identities A/A/B yield modal A (count 2), agreementRate 2/3, noConsensus false', async () => {
    const probe = actionsFactory([
      { type: 'click', ref: 'e2' },
      { type: 'click', ref: 'e2' },
      { type: 'click', ref: 'e1' },
    ])
    const outcome = (await replayCassette({
      cassette: leafCassette(),
      artifacts: emptyArtifacts,
      plannerFactory: probe.factory,
      actionToolNames: new Set(),
      clock: fixedIncrementClock(),
      k: 3,
      escalationPredicate: alwaysEscalate,
    })) as DecisionReplayResult
    expect(outcome.agreement.noConsensus).toBe(false)
    expect(outcome.agreement.modal?.count).toBe(2)
    expect(outcome.agreement.modal?.identity.target).toEqual({ role: 'button', nameNormalized: 'log in', ordinal: 0 })
    expect(outcome.agreement.agreementRate).toBeCloseTo(2 / 3)
    expect(outcome.modalDecision?.opClass).toBe('click')
  })

  it('Test 4: all-distinct samples yield noConsensus true, modal absent, agreementRate 1/3', async () => {
    const probe = actionsFactory([
      { type: 'click', ref: 'e2' },
      { type: 'click', ref: 'e1' },
      { type: 'type', ref: 'e1', text: 'hello' },
    ])
    const outcome = (await replayCassette({
      cassette: leafCassette(),
      artifacts: emptyArtifacts,
      plannerFactory: probe.factory,
      actionToolNames: new Set(),
      clock: fixedIncrementClock(),
      k: 3,
      escalationPredicate: alwaysEscalate,
    })) as DecisionReplayResult
    expect(outcome.agreement.noConsensus).toBe(true)
    expect(outcome.agreement.modal).toBeUndefined()
    expect('modalDecision' in outcome).toBe(false)
    expect(outcome.agreement.agreementRate).toBeCloseTo(1 / 3)
  })

  it('Test 5: k=1 yields agreementRate 1 with modal = the single sample identity class', async () => {
    const probe = actionsFactory([{ type: 'click', ref: 'e2' }])
    const outcome = (await replayCassette({
      cassette: leafCassette(),
      artifacts: emptyArtifacts,
      plannerFactory: probe.factory,
      actionToolNames: new Set(),
      clock: fixedIncrementClock(),
    })) as DecisionReplayResult
    expect(outcome.agreement.k).toBe(1)
    expect(outcome.agreement.agreementRate).toBe(1)
    expect(outcome.agreement.modal?.count).toBe(1)
    expect(outcome.modalDecision?.opClass).toBe('click')
  })

  it('Test 6: planner-failure samples group by reason; harness-errors are counted, never modal', async () => {
    const probe = makeFactory(callIndex => {
      if (callIndex < 2) throw new PlanningTurnError('no_action_tool_called', `fail ${callIndex}`, [])
      throw new Error('infra down')
    })
    const outcome = (await replayCassette({
      cassette: leafCassette(),
      artifacts: emptyArtifacts,
      plannerFactory: probe.factory,
      actionToolNames: new Set(),
      clock: fixedIncrementClock(),
      k: 3,
      escalationPredicate: alwaysEscalate,
    })) as DecisionReplayResult
    expect(outcome.samples).toHaveLength(3)
    expect(outcome.agreement.harnessErrorCount).toBe(1)
    expect(outcome.agreement.agreementRate).toBeCloseTo(2 / 3)
    expect(outcome.agreement.noConsensus).toBe(false)
    expect('modalDecision' in outcome).toBe(false)
  })
})

describe('replayCassette — procedure teacher-forcing', () => {
  it('Test 7: procedure steps replay independently; non-decision steps skip; endState untouched', async () => {
    const probe = actionsFactory([
      { type: 'click', ref: 'e2' },
      { type: 'click', ref: 'e1' },
    ])
    const cassette = procedureCassette()
    const outcome = (await replayCassette({
      cassette,
      artifacts: emptyArtifacts,
      plannerFactory: probe.factory,
      actionToolNames: new Set(),
      clock: fixedIncrementClock(),
    })) as ProcedureReplayResult

    expect(outcome.granularity).toBe('procedure')
    expect(probe.createCount()).toBe(2)
    expect(outcome.steps).toHaveLength(4)

    const [step0, step1, step2, step3] = outcome.steps
    expect(step0).toMatchObject({ kind: 'decision', stepIndex: 0, decisionOrdinal: 0 })
    expect(step1).toEqual({ kind: 'skipped', stepIndex: 1, reason: 'cache-served', decisionOrdinal: 0 })
    expect(step2).toEqual({ kind: 'skipped', stepIndex: 2, reason: 'synthesized' })
    expect(step3).toMatchObject({ kind: 'decision', stepIndex: 3, decisionOrdinal: 0 })

    if (step0.kind !== 'decision' || step3.kind !== 'decision') throw new Error('expected decision steps')
    // Teacher-forced: each decision step replayed against its own recorded state independently.
    expect(step0.result.samples[0].outcome).toMatchObject({ kind: 'decision', action: { ref: 'e2' } })
    expect(step3.result.samples[0].outcome).toMatchObject({ kind: 'decision', action: { ref: 'e1' } })

    // endState carried through untouched for Phase 369 to score.
    expect(outcome.endState).toEqual(PROCEDURE_END_STATE)
    expect(outcome.endState).toBe(cassette.endState)
  })
})
