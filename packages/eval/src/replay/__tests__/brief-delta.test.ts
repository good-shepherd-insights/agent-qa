import { asRecordId, sha256hex } from '@vostride/agent-qa-schema'
import type { BriefLine, ServedBrief } from '@vostride/agent-qa-schema'
import { APP_OBSERVED_DATA_CLOSE, APP_OBSERVED_DATA_OPEN } from '@vostride/agent-qa-safety'
import { describe, expect, it } from 'vitest'
import { canonicalizeInputLeg } from '../../extract/receipt'
import { applyBriefDelta, locateBriefLine, reverseBriefDelta } from '../brief-delta'
import type { BriefTier, DeclaredBriefDelta } from '../brief-delta'
import { makeLeg } from './fixtures'
import proofs from './fixtures/proof-briefs.json'

const fields = { L0: 'policyL0', L1: 'learnedL1', L2: 'learnedL2' } as const

function proofLeg(index = 3) {
  return makeLeg({ servedBrief: structuredClone(proofs[index]!.servedBrief) as unknown as ServedBrief })
}

function injection(tier: BriefTier = 'L2'): DeclaredBriefDelta {
  const line: BriefLine = {
    id: asRecordId('delta-observation'), kind: 'fact', summary: 'A declared observation',
    trust: 0.5, status: 'active', servedAsCanary: false, tier,
  }
  return {
    kind: 'injected', line, tier, renderedLine: `Observation: ${line.summary} [CANARY]`,
    turnOrdinal: 0, position: 1, channel1Position: 3,
  }
}

describe('brief delta inverse law', () => {
  it.each(['L0', 'L1', 'L2'] as const)('injected %s edits only a clone and round-trips exactly', tier => {
    const leg = proofLeg()
    const before = structuredClone(leg)
    const delta = injection(tier)
    const deltaBefore = structuredClone(delta)
    const oldLines = leg.servedBrief.proof!.promptTurns[0]![fields[tier]].split('\n')
    const expectedLines = [...oldLines.slice(0, 1), delta.renderedLine, ...oldLines.slice(1)]
    const applied = applyBriefDelta(leg, delta)
    expect(applied).not.toBe(leg)
    expect(applied.servedBrief.channel1).toEqual([...leg.servedBrief.channel1, delta.line])
    expect(applied.servedBrief.channel1[3]).not.toBe(delta.line)
    expect(applied.servedBrief.proof!.promptTurns[0]![fields[tier]]).toBe(expectedLines.join('\n'))
    const reversed = reverseBriefDelta(applied, delta)
    expect(reversed).toEqual(before)
    expect(sha256hex(canonicalizeInputLeg(reversed))).toBe(sha256hex(canonicalizeInputLeg(before)))
    expect(leg).toEqual(before)
    expect(delta).toEqual(deltaBefore)
    expect(applied.servedBrief.channel1).toHaveLength(4)
  })

  it('removed middle channel1 item restores its original index and exact proof hash', () => {
    const leg = proofLeg()
    const before = structuredClone(leg)
    const line = leg.servedBrief.channel1[1]!
    const text = leg.servedBrief.proof!.promptTurns[0]!.learnedL2
    const located = locateBriefLine(text, line, 'L2')
    expect(located).toEqual({ kind: 'located', tier: 'L2', index: 0 })
    if (located.kind !== 'located') throw new Error('fixture must locate')
    const delta: DeclaredBriefDelta = {
      kind: 'removed', line, tier: 'L2', renderedLine: text.split('\n')[located.index]!,
      turnOrdinal: 0, position: located.index, channel1Position: 1,
    }
    const deltaBefore = structuredClone(delta)
    const applied = applyBriefDelta(leg, delta)
    expect(applied.servedBrief.channel1).toEqual([before.servedBrief.channel1[0], before.servedBrief.channel1[2]])
    expect(applied.servedBrief.proof!.promptTurns[0]!.learnedL2).toBe(text.split('\n')[1])
    expect(reverseBriefDelta(applied, delta)).toEqual(before)
    expect(sha256hex(canonicalizeInputLeg(reverseBriefDelta(applied, delta))))
      .toBe(sha256hex(canonicalizeInputLeg(before)))
    expect(leg).toEqual(before)
    expect(delta).toEqual(deltaBefore)
    expect(applyBriefDelta(reverseBriefDelta(applied, delta), delta)).toEqual(applied)
  })

  it('inserts into an empty tier and removes its last line back to the empty string', () => {
    const leg = proofLeg(0)
    const delta = { ...injection('L1'), position: 0, channel1Position: 1, turnOrdinal: 1 }
    const applied = applyBriefDelta(leg, delta)
    expect(applied.servedBrief.proof!.promptTurns[1]!.learnedL1).toBe(delta.renderedLine)
    expect(applied.servedBrief.proof!.promptTurns[0]).toEqual(leg.servedBrief.proof!.promptTurns[0])
    expect(applied.servedBrief.proof!.promptTurns[2]).toEqual(leg.servedBrief.proof!.promptTurns[2])
    expect(reverseBriefDelta(applied, delta)).toEqual(leg)
  })

  it('edits channel1 without synthesizing a proof for historical legs', () => {
    const leg = makeLeg()
    const delta = { ...injection(), position: 0, channel1Position: 0 }
    const applied = applyBriefDelta(leg, delta)
    expect(applied.servedBrief).not.toHaveProperty('proof')
    expect(reverseBriefDelta(applied, delta)).toEqual(leg)
  })

  it.each([-1, 99, 0.5, NaN])('rejects invalid tier position %s', position => {
    expect(() => applyBriefDelta(proofLeg(), { ...injection(), position })).toThrow(TypeError)
  })

  it.each([-1, 99, 0.5, NaN])('rejects invalid channel1 position %s', channel1Position => {
    expect(() => applyBriefDelta(proofLeg(), { ...injection(), channel1Position })).toThrow(TypeError)
  })

  it('rejects absent IDs, stale positions, mismatched line text and missing proof turns', () => {
    const leg = proofLeg()
    const delta = injection()
    expect(() => applyBriefDelta(leg, { ...delta, kind: 'removed' })).toThrow(TypeError)
    expect(() => applyBriefDelta(leg, { ...delta, turnOrdinal: 99 })).toThrow(TypeError)
    const applied = applyBriefDelta(leg, delta)
    expect(() => reverseBriefDelta(applied, { ...delta, channel1Position: 0 })).toThrow(TypeError)
    expect(() => reverseBriefDelta(applied, { ...delta, renderedLine: 'different' })).toThrow(TypeError)
    expect(() => applyBriefDelta(applied, delta)).toThrow(TypeError)
  })

  it.each(['', 'one\ntwo'])('rejects a renderedLine that is not one nonempty line: %j', renderedLine => {
    expect(() => applyBriefDelta(proofLeg(), { ...injection(), renderedLine })).toThrow(TypeError)
  })
})

describe('locateBriefLine', () => {
  const line = proofLeg().servedBrief.channel1[0]!
  it('finds an annotated observation between app-observed delimiter lines', () => {
    expect(locateBriefLine([
      APP_OBSERVED_DATA_OPEN, `Observation: ${line.summary} [CANARY]`, APP_OBSERVED_DATA_CLOSE,
    ].join('\n'), line, 'L1')).toEqual({ kind: 'located', tier: 'L1', index: 1 })
  })
  it('reports both matches for an ambiguous summary', () => {
    expect(locateBriefLine(`Observation: ${line.summary}\nother\nObservation: ${line.summary} [CANARY]`, line, 'L1'))
      .toEqual({ kind: 'ambiguous', id: line.id, tier: 'L1', matches: [0, 2] })
  })
  it('returns a typed absence naming id and tier, never matching delimiters or bare summaries', () => {
    expect(locateBriefLine([APP_OBSERVED_DATA_OPEN, line.summary, APP_OBSERVED_DATA_CLOSE].join('\n'), line, 'L1'))
      .toEqual({ kind: 'brief-line-not-found', id: line.id, tier: 'L1' })
  })
})
