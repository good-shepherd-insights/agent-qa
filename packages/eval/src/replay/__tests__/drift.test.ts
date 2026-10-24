import { sha256hex } from '@vostride/agent-qa-schema'
import type { CompletedRunHandoff, ServedBrief } from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'
import { makeV2Handoff } from '../../__tests__/fixtures/handoff-fixtures'
import { canonicalJson } from '../../canonical-json'
import { assembleReceipt, canonicalizeInputLeg } from '../../extract/receipt'
import { projectInputLeg } from '../../extract/input-leg'
import { computeReplayDrift } from '../drift'
import type { DeclaredBriefDelta } from '../brief-delta'
import proofs from './fixtures/proof-briefs.json'

function fixtureDecision(handoff: CompletedRunHandoff = makeV2Handoff()) {
  const handoffTest = handoff.tests[0]!
  const step = handoffTest.steps[0]!
  const subAction = step.subActions[0]!
  const inputLeg = projectInputLeg({
    handoffTest,
    step,
    subAction,
    testIndex: handoffTest.testIndex,
    stepIndex: step.stepIndex,
    decisionOrdinal: 0,
  })
  const receipt = assembleReceipt({ inputLeg, step, subAction, handoff })
  return { handoff, step, subAction, inputLeg, receipt }
}

describe('computeReplayDrift', () => {
  it('reports no drift when the reconstructed leg matches the recorded hash', () => {
    const { inputLeg, receipt } = fixtureDecision()

    const result = computeReplayDrift(inputLeg, receipt.promptInputHash)

    expect(result.drift).toBe(false)
    expect(result.harnessDrift).toBe(false)
    expect(result).not.toHaveProperty('declaredDelta')
    expect(result.recordedHash).toBe(receipt.promptInputHash)
    expect(result.recomputedHash).toBe(receipt.promptInputHash)
    expect(result.recomputedHash).toBe(sha256hex(canonicalizeInputLeg(inputLeg)))
  })

  it('reports drift with both hashes stamped when any single leg field mutates', () => {
    const { inputLeg, receipt } = fixtureDecision()
    const mutated = { ...inputLeg, stepText: `${inputLeg.stepText} (mutated)` }

    const result = computeReplayDrift(mutated, receipt.promptInputHash)

    expect(result.drift).toBe(true)
    expect(result.harnessDrift).toBe(true)
    expect(result).not.toHaveProperty('declaredDelta')
    expect(result.recordedHash).toBe(receipt.promptInputHash)
    expect(result.recomputedHash).not.toBe(receipt.promptInputHash)
    expect(result.recomputedHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it.each(['injected', 'removed'] as const)('%s brief divergence alone has zero harnessDrift', kind => {
    const { inputLeg } = fixtureDecision()
    inputLeg.servedBrief = structuredClone(proofs[3]!.servedBrief) as unknown as ServedBrief
    const line = structuredClone(inputLeg.servedBrief.channel1[1]!)
    const renderedLine = inputLeg.servedBrief.proof!.promptTurns[0]!.learnedL2.split('\n')[0]!
    const without = structuredClone(inputLeg)
    without.servedBrief.channel1.splice(1, 1)
    without.servedBrief.proof!.promptTurns[0]!.learnedL2 =
      inputLeg.servedBrief.proof!.promptTurns[0]!.learnedL2.split('\n').slice(1).join('\n')
    const [base, applied] = kind === 'removed' ? [inputLeg, without] : [without, inputLeg]
    const recordedHash = sha256hex(canonicalizeInputLeg(base))
    const delta: DeclaredBriefDelta = {
      kind, line, tier: 'L2', renderedLine, turnOrdinal: 0, position: 0, channel1Position: 1,
    }
    const before = structuredClone(applied)
    const result = computeReplayDrift(applied, recordedHash, { declaredBriefDelta: delta })
    expect(result).toEqual({
      drift: true, harnessDrift: false, declaredDelta: { kind, id: line.id },
      recordedHash, recomputedHash: sha256hex(canonicalizeInputLeg(applied)),
    })
    expect(applied).toEqual(before)
    expect(computeReplayDrift({ ...applied, stepText: 'undeclared divergence' }, recordedHash,
      { declaredBriefDelta: delta }).harnessDrift).toBe(true)
  })
})

describe('canonicalJson', () => {
  it('sorts object keys recursively while retaining array order', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}')
    expect(canonicalJson({ arr: [3, 1, 2] })).toBe('{"arr":[3,1,2]}')
    expect(canonicalJson({ b: 1, a: { d: 4, c: 3 } })).toBe('{"a":{"c":3,"d":4},"b":1}')
  })

  it('is stable across key-insertion-order permutations', () => {
    const a = { b: 1, a: { d: 4, c: 3 }, arr: [3, 1, 2] }
    const permuted = { arr: [3, 1, 2], a: { c: 3, d: 4 }, b: 1 }

    expect(canonicalJson(a)).toBe(canonicalJson(permuted))
  })
})
