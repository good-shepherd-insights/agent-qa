import { asRef, screenStateHash, sha256hex, type Verdict } from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'
import { canonicalJson } from '../../canonical-json'
import { makeArtifactRefV2Handoff, FIXTURE_ARTIFACT_SHA, FIXTURE_SCREENSHOT_SHA } from '../../__tests__/fixtures/handoff-fixtures'
import { extractRunCassettes } from '../../extract/extract-run'
import type { CommittedCorpusSnapshot } from '../../census/derive-census'
import { projectCorpusEntry } from '../corpus-entry'
import { createLabelRevision, selectEffectiveLabels } from '../effective-labels'
import { projectSilverLabelRecord } from '../label-record'
import { buildSeedingPlan } from '../seeding-plan'
import * as sampling from '../silver-sampling'

const partition = { saltHex: '0'.repeat(64), heldOutFraction: 0.4, privateFraction: 0.5 }
const artifacts = { getBlob: (sha: string) => sha === FIXTURE_SCREENSHOT_SHA ? new Uint8Array([1, 2, 3])
  : sha === FIXTURE_ARTIFACT_SHA ? new Uint8Array([4, 5]) : undefined }
const verdict = (classification: Verdict['class'], perTest = 0): Verdict => ({ class: classification,
  producer: 'deterministic-classifier', perTest, confidence: 1, memoryMisdirectionRuledOut: true,
  evidence: { citedSteps: [0], citedAnchors: [], citedArtifacts: [], rationale: 'Recorded failure' } })

function fixture(classification?: Verdict['class']) {
  const handoff = makeArtifactRefV2Handoff()
  handoff.tests = [handoff.tests[0]!]
  const member = handoff.tests[0]!
  member.steps = [member.steps[0]!]
  const evidence = structuredClone(member.steps[0]!)
  evidence.verifierVerdict = { pass: false, reasoning: 'Original failure' }
  const facts = { runId: handoff.runId, testId: member.testId, testIndex: member.testIndex,
    stepIndex: evidence.stepIndex, decisionOrdinal: 0, evidence }
  const origin = { attempt: 0, outcome: 'failed' as const,
    ...(classification ? { rootCause: verdict(classification) } : {}), decisions: [{ ...facts,
      screenStateHash: screenStateHash(evidence.subActions[0]!.stateBefore),
      evidenceDigest: sha256hex(canonicalJson(facts)) }] }
  member.isRerun = true
  member.rerunAttempt = 2
  member.rootCause = verdict('flake')
  member.rerunOrigin = { ...origin, evidenceDigest: sha256hex(canonicalJson(origin)) }
  const originalHandoff = { ...handoff, tests: [{ ...member, steps: [evidence] }] }
  const original = extractRunCassettes({ handoff: originalHandoff, artifacts }).cassettes
    .find(entry => entry.cassette.granularity === 'leaf')!.cassette
  if (original.granularity !== 'leaf') throw new Error('fixture leaf missing')
  const label = projectSilverLabelRecord({ cassette: original, runId: handoff.runId })
  const entry = projectCorpusEntry({ cassette: original, product: 'default', runId: handoff.runId,
    assignment: { split: 'natural' } })
  const snapshot: CommittedCorpusSnapshot = { entries: [entry], labelsById: new Map([[original.id, label]]),
    cassettesById: new Map([[original.id, original]]), blobPresentById: new Map([[original.id, true]]) }
  const plan = (source = snapshot) => buildSeedingPlan({ handoff, partition,
    cassettes: extractRunCassettes({ handoff, artifacts }).cassettes,
    populationContext: { snapshot: source, handoffs: [], marks: [] } })
  return { handoff, member, snapshot, label, original, plan }
}

describe('420 rerun routing', () => {
  it.each(['flake', 'environment', 'timeout'] as const)('quarantines silver from original %s and retires only its exact record', classification => {
    const f = fixture(classification), before = canonicalJson(f.label)
    f.member.rootCause = verdict('app_bug') // The final class never substitutes for the original.
    const plan = f.plan()
    expect(plan.cases).toEqual([])
    expect(plan.silverExclusions).toContainEqual(expect.objectContaining({ reason: 'rerun-overturn-quarantined', testIndex: 0 }))
    expect(plan).toMatchObject({ labelRevisions: [{ cassetteId: f.original.id,
      quarantine: 'rerun-overturned', supersedes: expect.any(String) }],
      retirementCounts: { superseded: 1, missing: 0, conflict: 0 } })
    expect(canonicalJson(f.label)).toBe(before)
  })

  it.each(['app_bug', 'test_bug', 'config_error', 'llm_error', 'unknown', undefined] as const)('keeps original %s silver with real rerun provenance despite final flake', classification => {
    const f = fixture(classification), plan = f.plan()
    expect(plan.cases).toHaveLength(1)
    expect(plan.cases[0]!.labelRecord).toMatchObject({ label: { tier: 'silver', sourceChannel: 'recorded-verdict' },
      provenance: { rerun: { attempt: 2, originalAttempt: 0, originalEvidenceDigest: f.member.rerunOrigin!.evidenceDigest } } })
    expect(plan).toMatchObject({ labelRevisions: [] })
  })

  it('keeps legacy absent original silver and does not invent an attempt', () => {
    const f = fixture()
    delete f.member.rerunOrigin
    expect(f.plan().cases[0]!.labelRecord.provenance.rerun).toEqual({ attempt: 2 })
    delete f.member.isRerun
    delete f.member.rerunAttempt
    expect(f.plan().cases[0]!.labelRecord.provenance.rerun).toBeUndefined()
  })

  it('does not quarantine from an authored original verdict', () => {
    const f = fixture('flake')
    f.member.rerunOrigin!.rootCause!.producer = 'analyze-run'
    expect(f.plan().cases).toHaveLength(1)
  })

  it('discloses missing originals without inventing a record', () => {
    const f = fixture('flake')
    expect(f.plan({ ...f.snapshot, entries: [], labelsById: new Map(), cassettesById: new Map() }))
      .toMatchObject({ labelRevisions: [], retirementCounts: { superseded: 0, missing: 1, conflict: 0 } })
  })

  it.each(['run', 'member', 'decision', 'input', 'receipt', 'label', 'duplicate'] as const)('refuses a conflicting original %s identity', mismatch => {
    const f = fixture('flake')
    if (mismatch === 'run') f.original.runId = 'foreign-run'
    if (mismatch === 'member') f.original.testIndex = 9
    if (mismatch === 'decision') f.original.decisionOrdinal = 9
    if (mismatch === 'input') f.original.input.stepText = 'foreign evidence'
    if (mismatch === 'receipt') f.original.receipt.memoryBriefDigest = 'f'.repeat(64)
    if (mismatch === 'label') f.label.provenance.receiptDigest = 'f'.repeat(64)
    if (mismatch === 'duplicate') f.snapshot.entries = [...f.snapshot.entries, f.snapshot.entries[0]!]
    expect(f.plan()).toMatchObject({ labelRevisions: [], retirementCounts: { superseded: 0, missing: 0, conflict: 1 } })
  })

  it('never retires near-gold or gold originals', () => {
    for (const tier of ['near-gold', 'gold'] as const) {
      const f = fixture('flake')
      f.label.label.tier = tier
      expect(f.plan()).toMatchObject({ labelRevisions: [], retirementCounts: { superseded: 0, missing: 0, conflict: 1 } })
    }
  })

  it('reuses an already quarantined effective terminal without another revision', () => {
    const f = fixture('flake')
    const revision = createLabelRevision(f.label, { quarantine: 'rerun-overturned' })
    const effective = selectEffectiveLabels([f.label, revision])
    expect(effective.excludedLabelIds.has(f.original.id)).toBe(true)
    expect(f.plan({ ...f.snapshot, labelsById: effective.effective, excludedLabelIds: effective.excludedLabelIds }))
      .toMatchObject({ labelRevisions: [], retirementCounts: { superseded: 0, missing: 0, conflict: 0 } })
  })

  it('keeps retry pairs weighted and population-counted when the same member silver is excluded', () => {
    const f = fixture('flake')
    const step = structuredClone(f.member.steps[0]!)
    step.stepIndex = 1
    const failed = step.subActions[0]!, recovering = structuredClone(failed)
    recovering.plannedAction = { type: 'click', ref: asRef('e-continue-2') }
    step.subActions = [failed, recovering]
    const decision = (sub: typeof failed) => ({ plan: sub.plan, plannedAction: sub.plannedAction, result: sub.result })
    step.selfHeal = { failedDecision: decision(failed), recoveringDecision: decision(recovering) }
    f.member.steps.push(step)
    const plan = f.plan()
    expect(plan.pairCounts.total).toBe(1)
    expect(plan.cases).toHaveLength(2)
    for (const row of plan.cases) expect(row.labelRecord).toMatchObject({ label: { sourceChannel: 'self-heal-pair' },
      provenance: { rerun: { attempt: 2 } }, weight: { k: 1, n: 1 } })
  })
})

it('420 exact silver exclusions', () => {
  expect(sampling).toHaveProperty('SILVER_EXCLUSION_REASONS', [
    'test-not-passed', 'step-verdict-failed', 'self-heal-step', 'evidence-incomplete',
    'cap-exceeded', 'procedure-granularity', 'rerun-overturn-quarantined',
  ])
})

it('420 exact quarantine marker', () => {
  expect(sampling).toHaveProperty('LABEL_QUARANTINE_MARKERS', ['rerun-overturned'])
})
