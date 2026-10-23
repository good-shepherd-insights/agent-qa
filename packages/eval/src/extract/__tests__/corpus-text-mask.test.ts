import {
  asRecordId,
  asRef,
  computeBriefDigest,
  guardLosslessServedBrief,
  screenStateHash,
  sha256hex,
  type CompletedRunHandoff,
  type ServedBrief,
  type Verdict,
  SERVED_BRIEF_PROOF_SCHEMA_VERSION,
} from '@vostride/agent-qa-schema'
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

function stamp(brief: ServedBrief): ServedBrief {
  return { ...brief, briefDigest: computeBriefDigest(brief) }
}

function losslessBrief(turn: {
  runDate: string
  contextTier: string
  volatileTier: string
  policyL0?: string
  learnedL1?: string
  learnedL2?: string
}): ServedBrief {
  const policyL0 = turn.policyL0 ?? ''
  return stamp({
    scope: { tier: 'suite', key: 'checkout' },
    asOfBuild: 3,
    budget: 0,
    truncation: 'none',
    channel1: [],
    channel2: [],
    channel3: [],
    briefDigest: '',
    proof: {
      schemaVersion: SERVED_BRIEF_PROOF_SCHEMA_VERSION,
      completeness: 'lossless',
      recordCap: 0,
      combinedBudget: 0,
      admissionEvents: [],
      promptTurns: [{
        ordinal: 0,
        turnOrdinal: 0,
        runDate: turn.runDate,
        policyL0,
        learnedL1: turn.learnedL1 ?? '',
        learnedL2: turn.learnedL2 ?? '',
        contextTier: turn.contextTier,
        volatileTier: turn.volatileTier,
        policyDigest: sha256hex(policyL0),
        contextTierDigest: sha256hex(turn.contextTier),
        volatileTierDigest: sha256hex(turn.volatileTier),
      }],
    },
  })
}

function stringLeaves(value: unknown, path = ''): [string, string][] {
  if (typeof value === 'string') return [[path, value]]
  if (Array.isArray(value)) return value.flatMap((item, index) => stringLeaves(item, `${path}[${index}]`))
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([key, item]) => stringLeaves(item, path === '' ? key : `${path}.${key}`))
  }
  return []
}

function changedPaths(before: unknown, after: unknown): string[] {
  const next = new Map(stringLeaves(after))
  return stringLeaves(before).filter(([path, text]) => next.get(path) !== text).map(([path]) => path).sort()
}

describe('C441-GAP4-CORPUS', () => {
  it('a prompt tier holding a one-character declared value is masked, its tier and brief digests are recomputed over the masked text, and the brief still guards', () => {
    const cases = [['7', '2026-10-17'], ['0', '2026-10-16']] as const
    for (const [value, runDate] of cases) {
      const mask = recordMask({ PIN: value })
      const brief = losslessBrief({
        runDate,
        contextTier: `Keypad with ${value} keys`,
        volatileTier: `Current date: ${runDate}`,
        policyL0: 'Prefer the keypad',
        learnedL1: 'L1 — critical cautions:\nObservation: Wait for the banner',
      })
      expect(() => guardLosslessServedBrief(brief)).not.toThrow()

      const masked = maskCorpusText({ servedBrief: brief }, mask).servedBrief
      const raw = brief.proof!.promptTurns[0]!
      const turn = masked.proof!.promptTurns[0]!
      for (const tier of [turn.contextTier, turn.volatileTier]) {
        expect(tier).toContain('[secret:PIN]')
        expect(tier).not.toContain(value)
      }
      expect(turn.contextTierDigest).toBe(sha256hex(turn.contextTier))
      expect(turn.volatileTierDigest).toBe(sha256hex(turn.volatileTier))
      expect(turn.contextTierDigest).not.toBe(raw.contextTierDigest)
      expect(masked.briefDigest).toBe(computeBriefDigest(masked))
      expect(masked.briefDigest).not.toBe(brief.briefDigest)
      for (const member of ['policyL0', 'learnedL1', 'learnedL2', 'policyDigest', 'runDate'] as const) {
        expect(turn[member]).toBe(raw[member])
      }
      expect(() => guardLosslessServedBrief(masked)).not.toThrow()
      const committed = { servedBrief: masked }
      expect(JSON.stringify(maskCorpusText(committed, mask, { everyLeaf: true }))).toBe(JSON.stringify(committed))
    }
  })

  it('a brief whose digests and run date hold a one-character declared value but whose text does not is returned byte-identical in both modes', () => {
    const mask = recordMask({ PIN: '7' })
    const brief = losslessBrief({
      runDate: '2026-10-17',
      contextTier: 'Keypad shown',
      volatileTier: 'Current date: withheld',
      policyL0: 'Use the keypad',
    })
    const turn = brief.proof!.promptTurns[0]!
    for (const derived of [brief.briefDigest, turn.policyDigest, turn.contextTierDigest, turn.volatileTierDigest, turn.runDate]) {
      expect(derived).toContain('7')
    }
    const doc = { servedBrief: brief }
    expect(JSON.stringify(maskCorpusText(doc, mask))).toBe(JSON.stringify(doc))
    expect(JSON.stringify(maskCorpusText(doc, mask, { everyLeaf: true }))).toBe(JSON.stringify(doc))

    const placeholder = {
      servedBrief: {
        ...brief,
        briefDigest: '1'.repeat(64),
        proof: {
          ...brief.proof!,
          promptTurns: [{
            ...turn,
            runDate: '2026-10-16',
            policyDigest: '1'.repeat(64),
            contextTierDigest: '1'.repeat(64),
            volatileTierDigest: '1'.repeat(64),
          }],
        },
      },
    }
    for (const options of [{}, { everyLeaf: true }]) {
      expect(JSON.stringify(maskCorpusText(placeholder, mask, options))).toBe(JSON.stringify(placeholder))
    }
  })

  it('in everyLeaf mode a served brief keeps exactly its digest, date, enum, literal and minted-id paths, and every other string leaf holding a declared value changes', () => {
    const mask = recordMask({ PIN: '7' })
    const base = losslessBrief({
      runDate: '2026-10-17',
      contextTier: 'Keypad with [secret:PIN] keys',
      volatileTier: 'Current date: 2026-10-1[secret:PIN]',
      policyL0: 'Policy 7',
      learnedL1: 'Caution 7',
      learnedL2: 'Fact 7',
    })
    const brief = stamp({
      ...base,
      scope: { tier: 'suite', key: 'checkout-7' },
      truncation: 'served 7 of 9 records',
      channel1: [{
        id: asRecordId('rec-7a'), kind: 'fact', summary: 'Pay with card 7', trust: 0.7,
        status: 'active', servedAsCanary: false, tier: 'L2',
      }],
      channel2: [{ id: asRecordId('rec-7b'), detailLevel: 'detail-7', bodyDigest: sha256hex('body 7') }],
      channel3: [{
        id: asRecordId('rec-7c'),
        summary: 'Caution 7',
        anchors: [
          { t: 'page', route: '/pay/7' },
          { t: 'flow', name: 'Checkout 7' },
          { t: 'el', role: 'key-7', name: 'Key 7', ordinal: 7 },
          { t: 'platform', platform: 'web' },
          { t: 'selector', literal: '#key-7' },
          { t: 'error', message: 'Error 7' },
        ],
      }],
      proof: {
        ...base.proof!,
        admissionEvents: [{
          ordinal: 0, turnOrdinal: 0, surface: 'brief-line', id: asRecordId('rec-7a'),
          sourceId: 'source-7', clusterKey: 'cluster-7', renderedCost: 7, chargeRepeated: false,
        }],
      },
    })
    expect(() => guardLosslessServedBrief(brief)).not.toThrow()
    const kept = [
      'briefDigest', 'channel1[0].id', 'channel2[0].id', 'channel2[0].bodyDigest', 'channel3[0].id',
      'proof.admissionEvents[0].id', 'proof.promptTurns[0].runDate', 'proof.promptTurns[0].policyDigest',
      'proof.promptTurns[0].contextTierDigest', 'proof.promptTurns[0].volatileTierDigest',
    ]
    const before = new Map(stringLeaves(brief))
    for (const path of kept) expect(before.get(path), path).toContain('7')

    const checked = maskCorpusText({ servedBrief: brief }, mask, { everyLeaf: true }).servedBrief

    expect(changedPaths(brief, checked)).toEqual([
      'scope.key', 'truncation', 'channel1[0].summary', 'channel2[0].detailLevel', 'channel3[0].summary',
      'channel3[0].anchors[0].route', 'channel3[0].anchors[1].name', 'channel3[0].anchors[2].role',
      'channel3[0].anchors[2].name', 'channel3[0].anchors[4].literal', 'channel3[0].anchors[5].message',
      'proof.admissionEvents[0].sourceId', 'proof.admissionEvents[0].clusterKey',
      'proof.promptTurns[0].policyL0', 'proof.promptTurns[0].learnedL1', 'proof.promptTurns[0].learnedL2',
    ].sort())
    const after = new Map(stringLeaves(checked))
    for (const path of kept) expect(after.get(path), path).toBe(before.get(path))

    const rawTier = losslessBrief({
      runDate: '2026-10-17',
      contextTier: 'Keypad ready',
      volatileTier: 'Current date: 2026-10-17',
      policyL0: 'Prefer the keypad',
    })
    const rechecked = maskCorpusText({ servedBrief: rawTier }, mask, { everyLeaf: true }).servedBrief
    expect(changedPaths(rawTier, rechecked)).toEqual([
      'briefDigest', 'proof.promptTurns[0].volatileTier', 'proof.promptTurns[0].volatileTierDigest',
    ])
  })
})
