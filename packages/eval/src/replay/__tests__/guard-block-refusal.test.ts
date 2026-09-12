import { GuardrailBlockError } from '@vostride/agent-qa-safety'
import { describe, expect, it } from 'vitest'
import { buildEvalReport } from '../../match/metrics'
import { replayCassette } from '../replay-run'
import { decisionPlan, fixedIncrementClock, leafCassette, makeFactory } from './fixtures'

const cassette = leafCassette()
const block = new GuardrailBlockError('injectionShape')

function replayError(error: Error) {
  return replayCassette({
    cassette,
    artifacts: { getBlob: () => undefined },
    plannerFactory: makeFactory(() => { throw error }).factory,
    actionToolNames: new Set(),
    clock: fixedIncrementClock(),
  })
}

describe('replay-time guard block refusal', () => {
  it('refuses the cassette when the planning turn raises a guard block', async () => {
    expect(await replayError(block)).toEqual({
      kind: 'integrity-refusal',
      reason: 'guard-failed',
      cassetteId: cassette.id,
      detail: block.message,
    })
  })

  it('discards earlier decision samples when an escalated sample is blocked', async () => {
    const probe = makeFactory(index => {
      if (index === 1) throw block
      return decisionPlan({ type: 'click', ref: 'e2' })
    })
    const outcome = await replayCassette({
      cassette,
      artifacts: { getBlob: () => undefined },
      plannerFactory: probe.factory,
      actionToolNames: new Set(),
      clock: fixedIncrementClock(),
      k: 3,
      escalationPredicate: () => true,
    })
    expect(outcome).toMatchObject({ kind: 'integrity-refusal', reason: 'guard-failed' })
    expect(outcome).not.toHaveProperty('samples')
    expect(probe.createCount()).toBe(2)
  })

  it('preserves a provider outage as a harness-error sample', async () => {
    const outcome = await replayError(new Error('provider outage'))
    expect(outcome).toMatchObject({
      granularity: 'leaf',
      samples: [{ outcome: { kind: 'harness-error', message: 'provider outage' } }],
    })
  })

  it('counts guard blocks as refusals and provider outages as harness errors', async () => {
    const refused = buildEvalReport([{ cassetteId: cassette.id, outcome: await replayError(block) }])
    expect(refused.honesty.refusalCounts['guard-failed']).toBe(1)
    expect(refused.honesty.harnessErrorCount).toBe(0)
    const outage = buildEvalReport([
      { cassetteId: cassette.id, outcome: await replayError(new Error('provider outage')) },
    ])
    expect(outage.honesty.refusalCounts['guard-failed']).toBe(0)
    expect(outage.honesty.harnessErrorCount).toBe(1)
  })

  it('discloses only the detector identifier in the refusal detail', async () => {
    const outcome = await replayError(block)
    expect(outcome).toHaveProperty('detail', block.message)
    if (!('kind' in outcome)) throw new Error('expected refusal')
    expect(outcome.detail).toContain('injectionShape')
    expect(outcome.detail).not.toContain(cassette.input.stepText)
  })
})
