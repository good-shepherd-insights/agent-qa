import { asRef, screenStateHash, sha256hex, type CompletedRunHandoff, type Verdict } from '@vostride/agent-qa-schema'
import type { LeafCassette } from '../../index'
import {
  buildSeedingPlan,
  canonicalJson,
  extractRunCassettes,
  guardCassette,
  maskCorpusText,
  projectCorpusEntry,
  projectSilverLabelRecord,
} from '../../index'
import type { CommittedCorpusSnapshot } from '../../index'
import { describe, expect, it } from 'vitest'
import {
  FIXTURE_ARTIFACT_SHA,
  FIXTURE_SCREENSHOT_SHA,
  makeArtifactRefV2Handoff,
  makeV2Handoff,
} from '../../__tests__/fixtures/handoff-fixtures'

// The record mask's shape: one left-to-right alternation, marker forms first, then the
// declared values longest first.
function recordMask(secrets: Record<string, string>): (text: string) => string {
  const byValue = new Map(
    Object.entries(secrets)
      .sort((a, b) => b[1].length - a[1].length)
      .map(([name, value]) => [value, name] as const),
  )
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(
    [String.raw`\{\{secret:(\w+)\}\}`, String.raw`\[secret:\w+\]`, ...[...byValue.keys()].map(escape)].join('|'),
    'g',
  )
  return (text) => text.replace(pattern, (match: string, template: string | undefined) => {
    if (template !== undefined) return `[secret:${template}]`
    if (match.startsWith('[secret:')) return match
    return `[secret:${byValue.get(match)}]`
  })
}

const artifacts = {
  getBlob: (sha: string) => sha === FIXTURE_SCREENSHOT_SHA ? new Uint8Array([1, 2, 3])
    : sha === FIXTURE_ARTIFACT_SHA ? new Uint8Array([4, 5]) : undefined,
}

function leaves(handoff: CompletedRunHandoff): LeafCassette[] {
  return extractRunCassettes({ handoff, artifacts }).cassettes
    .map(entry => entry.cassette)
    .filter((cassette): cassette is LeafCassette => cassette.granularity === 'leaf')
}

function keyPaths(value: unknown, path = ''): string[] {
  if (Array.isArray(value)) return value.flatMap((item, index) => keyPaths(item, `${path}[${index}]`))
  if (typeof value !== 'object' || value === null) return [path]
  return Object.entries(value).flatMap(([key, item]) => [`${path}.${key}`, ...keyPaths(item, `${path}.${key}`)])
}

const LONG = 'hunter2-corpus-441'

describe('C441-GAP3-CORPUS', () => {
  it('a one-character declared value masks the free text of a run and keeps its closed vocabulary, so every cassette still guards', () => {
    const mask = recordMask({ E: 'e' })
    const handoff = makeV2Handoff()
    handoff.tests[0]!.steps[0]!.subActions[0]!.plannedAction = {
      type: 'fill', ref: asRef('e-continue-1'), text: 'Enter the code', clearMode: 'replace', submit: false,
    }
    const raw = leaves(handoff)
    const masked = maskCorpusText(handoff, mask)
    const extracted = extractRunCassettes({ handoff: masked, artifacts }).cassettes
    for (const { cassette } of extracted) expect(() => guardCassette(cassette)).not.toThrow()

    const fill = leaves(masked).find(cassette => cassette.id.endsWith('test-00-step-00-d00-leaf'))!
    const rawFill = raw.find(cassette => cassette.id === fill.id)!
    const state = fill.input.stateBefore
    expect(state.platform).toBe('web')
    expect(state.elements.map(element => [element.ref, element.role, element.hierarchy]))
      .toEqual(rawFill.input.stateBefore.elements.map(element => [element.ref, element.role, element.hierarchy]))
    expect(Object.keys(state.refMap)).toEqual(Object.keys(rawFill.input.stateBefore.refMap))
    expect(state.refMap).toEqual(rawFill.input.stateBefore.refMap)
    expect(state.metadata).toMatchObject({ captureMode: 'full', coordSpace: 'viewport' })
    expect(state.tree).toContain('[secret:E]')
    expect(state.elements[1]!.name).toBe('Continu[secret:E]')
    expect(fill.input.stepText).toContain('[secret:E]')
    expect(fill.sidecar.goldAction).toEqual({
      type: 'fill', ref: 'e-continue-1', text: 'Ent[secret:E]r th[secret:E] cod[secret:E]', clearMode: 'replace', submit: false,
    })
    expect(fill.sidecar.goldValue).toBe('Ent[secret:E]r th[secret:E] cod[secret:E]')
    expect(fill.sidecar.goldAnchor).toEqual({ role: 'button', nameNormalized: 'continu[secret:E]', ordinal: 0, ref: 'e-continue-1' })
    expect(fill.completeness.status).toBe(rawFill.completeness.status)

    const assertLeaf = leaves(masked).find(cassette => cassette.sidecar.goldAction.type === 'assertValue')!
    expect(assertLeaf.sidecar.goldAction).toMatchObject({ type: 'assertValue', source: 'url', op: 'contains' })
    expect(assertLeaf.sidecar.goldAction).toHaveProperty('expected', '/compl[secret:E]t[secret:E]')
  })

  it('maskCorpusText renames no key, leaves numbers alone, reaches nested screen states and self-heal actions, and leaves rerunOrigin byte-identical', () => {
    const mask = recordMask({ CODE: LONG })
    const handoff = makeV2Handoff()
    const failing = handoff.tests[1]!.steps[0]!
    failing.subActions[0]!.stateBefore.tree += `\ntextbox "Access code": ${LONG}`
    failing.selfHeal = {
      failedDecision: { plan: 'Open the code page', plannedAction: { type: 'navigate', to: 'url', url: `https://example.test/?code=${LONG}` },
        result: { success: false } },
      recoveringDecision: { plan: 'Click Continue', plannedAction: { type: 'click', ref: asRef('e-continue-2') }, result: { success: true } },
    }
    const member = handoff.tests[0]!
    const evidence = structuredClone(member.steps[0]!)
    evidence.stepText = `Type ${LONG}`
    const facts = { runId: handoff.runId, testId: member.testId, testIndex: 0, stepIndex: 0, decisionOrdinal: 0, evidence }
    const origin = { attempt: 0, outcome: 'failed' as const, decisions: [{ ...facts,
      screenStateHash: screenStateHash(evidence.subActions[0]!.stateBefore), evidenceDigest: sha256hex(canonicalJson(facts)) }] }
    member.isRerun = true
    member.rerunAttempt = 1
    member.rerunOrigin = { ...origin, evidenceDigest: sha256hex(canonicalJson(origin)) }
    const before = canonicalJson(handoff)

    const masked = maskCorpusText(handoff, mask)

    expect(canonicalJson(handoff)).toBe(before)
    expect(keyPaths(masked)).toEqual(keyPaths(handoff))
    expect(masked.startedAt).toBe(handoff.startedAt)
    expect(masked.tests[1]!.steps[0]!.subActions[0]!.stateBefore.timestamp)
      .toBe(handoff.tests[1]!.steps[0]!.subActions[0]!.stateBefore.timestamp)
    expect(masked.tests[1]!.steps[0]!.subActions[0]!.stateBefore.tree).toContain('[secret:CODE]')
    expect(masked.tests[1]!.steps[0]!.subActions[0]!.stateBefore.tree).not.toContain(LONG)
    expect(masked.tests[1]!.steps[0]!.selfHeal!.failedDecision.plannedAction)
      .toEqual({ type: 'navigate', to: 'url', url: 'https://example.test/?code=[secret:CODE]' })
    expect(canonicalJson(masked.tests[0]!.rerunOrigin)).toBe(canonicalJson(handoff.tests[0]!.rerunOrigin))
    expect(canonicalJson(masked.tests[0]!.rerunOrigin)).toContain(LONG)
  })

  it('a rerun whose original decision text holds a declared value still retires its masked original silver label', () => {
    const mask = recordMask({ CODE: LONG })
    const partition = { saltHex: '0'.repeat(64), heldOutFraction: 0.4, privateFraction: 0.5 }
    const verdict = (classification: Verdict['class']): Verdict => ({ class: classification,
      producer: 'deterministic-classifier', perTest: 0, confidence: 1, memoryMisdirectionRuledOut: true,
      evidence: { citedSteps: [0], citedAnchors: [], citedArtifacts: [], rationale: 'Recorded failure' } })
    const handoff = makeArtifactRefV2Handoff()
    handoff.tests = [handoff.tests[0]!]
    const member = handoff.tests[0]!
    member.steps = [member.steps[0]!]
    member.steps[0]!.stepText = `Type ${LONG} into the code field`
    const evidence = structuredClone(member.steps[0]!)
    evidence.verifierVerdict = { pass: false, reasoning: 'Original failure' }
    const facts = { runId: handoff.runId, testId: member.testId, testIndex: member.testIndex,
      stepIndex: evidence.stepIndex, decisionOrdinal: 0, evidence }
    const origin = { attempt: 0, outcome: 'failed' as const, rootCause: verdict('flake'), decisions: [{ ...facts,
      screenStateHash: screenStateHash(evidence.subActions[0]!.stateBefore),
      evidenceDigest: sha256hex(canonicalJson(facts)) }] }
    member.isRerun = true
    member.rerunAttempt = 2
    member.rootCause = verdict('flake')
    member.rerunOrigin = { ...origin, evidenceDigest: sha256hex(canonicalJson(origin)) }
    const { rootCause: _rerunRootCause, ...originalMember } = member
    const originalHandoff = { ...handoff, tests: [{ ...originalMember, steps: [evidence], rootCause: verdict('flake') }] }
    const original = leaves(maskCorpusText(originalHandoff, mask))[0]!
    expect(original.input.stepText).toBe('Type [secret:CODE] into the code field')
    const snapshot: CommittedCorpusSnapshot = {
      entries: [projectCorpusEntry({ cassette: original, product: 'default', runId: handoff.runId, assignment: { split: 'natural' } })],
      labelsById: new Map([[original.id, projectSilverLabelRecord({ cassette: original, runId: handoff.runId })]]),
      cassettesById: new Map([[original.id, original]]),
      blobPresentById: new Map([[original.id, true]]),
    }
    const masked = maskCorpusText(handoff, mask)

    const plan = buildSeedingPlan({ handoff: masked, partition, mask,
      cassettes: extractRunCassettes({ handoff: masked, artifacts }).cassettes,
      populationContext: { snapshot, handoffs: [], marks: [] } })

    expect(plan.retirementCounts).toEqual({ superseded: 1, missing: 0, conflict: 0 })
    expect(plan.labelRevisions).toMatchObject([{ cassetteId: original.id, quarantine: 'rerun-overturned' }])
  })
})
