import { asRecordId, sha256hex, type CandidateInjection, type ServedBrief } from '@vostride/agent-qa-schema'
import { renderObservationLine } from '@vostride/agent-qa-runner'
import { describe, expect, it } from 'vitest'
import { canonicalizeInputLeg } from '../../extract/receipt'
import { rebuildKnowledgeTiers } from '../../replay/brief-tiers'
import { computeReplayDrift } from '../../replay/drift'
import { leafCassette } from '../../replay/__tests__/fixtures'
import proofs from '../../replay/__tests__/fixtures/proof-briefs.json'
import { injectCandidate, toDeclaredBriefDelta } from '../candidate-injection'

function injection(): CandidateInjection {
  const line = { id: asRecordId('gate-candidate'), kind: 'fact', summary: 'Choose the submit button',
    trust: 0.5, status: 'candidate', servedAsCanary: false, tier: 'L2' }
  return { candidateId: line.id, kind: 'fact', product: 'example-web', scope: { tier: 'product', key: 'example-web' },
    anchors: [], status: 'candidate', line, renderedLine: renderObservationLine(line),
    provenance: { runIds: [], receiptDigests: [], capturedAtOrdinals: [1] }, latestOrdinal: 1 }
}

describe('candidate injection', () => {
  it('appends to the exact second proof turn, preserving every other byte and zero harness drift', () => {
    const brief = structuredClone(proofs[0]!.servedBrief) as unknown as ServedBrief
    brief.proof!.promptTurns = brief.proof!.promptTurns.slice(0, 2)
    const cassette = { ...leafCassette({ leg: { servedBrief: brief } }), decisionOrdinal: 1 }
    const before = structuredClone(cassette)
    const result = toDeclaredBriefDelta(injection(), cassette)
    expect(result.kind).toBe('plan')
    if (result.kind !== 'plan') throw new Error(result.detail)
    const text = brief.proof!.promptTurns[1]!.learnedL2
    expect(result.plan).toMatchObject({ expectedBriefSource: 'proof', turnMatch: 'exact',
      delta: { turnOrdinal: 1, position: text === '' ? 0 : text.split('\n').length } })
    const injected = injectCandidate(cassette, result.plan)
    expect(injected.input.servedBrief.proof!.promptTurns[1]!.learnedL2.split('\n').at(-1)).toBe(injection().renderedLine)
    expect(injected.input.servedBrief.proof!.promptTurns[0]).toEqual(brief.proof!.promptTurns[0])
    expect(injected.input.servedBrief.channel1).toHaveLength(brief.channel1.length + 1)
    expect(computeReplayDrift(injected.input, sha256hex(canonicalizeInputLeg(cassette.input)),
      { declaredBriefDelta: result.plan.delta })).toMatchObject({ drift: true, harnessDrift: false })
    expect(cassette).toEqual(before)
  })

  it('compares an empty baseline through an explicitly rendered candidate arm', () => {
    const cassette = leafCassette()
    const result = toDeclaredBriefDelta(injection(), cassette)
    expect(result).toMatchObject({ kind: 'plan', plan: { expectedBriefSource: 'rendered', delta: { position: 0 } } })
    if (result.kind !== 'plan') throw new Error(result.detail)
    const injected = injectCandidate(cassette, result.plan)
    expect(injected.input.servedBrief.channel1).toHaveLength(1)
    expect(rebuildKnowledgeTiers(injected.input.servedBrief, 0)).toEqual({
      briefSource: 'rendered', knowledgeBriefL2: injection().renderedLine,
    })
  })

  it('uses the uniform first turn when no exact ordinal exists, otherwise refuses with rebuild detail', () => {
    const brief = structuredClone(proofs[0]!.servedBrief) as unknown as ServedBrief
    const first = brief.proof!.promptTurns[0]!
    brief.proof!.promptTurns = [first, { ...first, turnOrdinal: 1 }]
    const cassette = { ...leafCassette({ leg: { servedBrief: brief } }), decisionOrdinal: 9 }
    expect(toDeclaredBriefDelta(injection(), cassette)).toMatchObject({ kind: 'plan',
      plan: { turnMatch: 'uniform', delta: { turnOrdinal: first.turnOrdinal } } })
    brief.proof!.promptTurns[1]!.learnedL2 = 'different'
    const result = toDeclaredBriefDelta(injection(), cassette)
    expect(result).toEqual({ kind: 'unrenderable-target', detail: 'no promptTurn matches decisionOrdinal 9 (turnOrdinals 0,1 differ)' })
    expect(() => rebuildKnowledgeTiers(brief, 9)).toThrow('no promptTurn matches decisionOrdinal 9 (turnOrdinals 0,1 differ)')
  })

  it('refuses channel2-only evidence, unsupported tiers, and proof objects without turns', () => {
    const cassette = leafCassette()
    cassette.input.servedBrief.channel2 = [{ summary: 'existing evidence' }] as unknown as ServedBrief['channel2']
    expect(toDeclaredBriefDelta(injection(), cassette)).toMatchObject({ kind: 'unrenderable-target' })
    expect(toDeclaredBriefDelta({ ...injection(), line: { ...injection().line, tier: 'L9' } }, leafCassette()))
      .toMatchObject({ kind: 'unrenderable-target' })
    const brief = structuredClone(proofs[0]!.servedBrief) as unknown as ServedBrief
    brief.proof!.promptTurns = []
    expect(toDeclaredBriefDelta(injection(), leafCassette({ leg: { servedBrief: brief } })))
      .toMatchObject({ kind: 'unrenderable-target' })
  })
})
