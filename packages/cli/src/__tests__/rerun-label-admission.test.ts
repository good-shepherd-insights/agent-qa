import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as model from '@vostride/agent-qa-model'
import { asRef, screenStateHash, sha256hex, type Verdict } from '@vostride/agent-qa-schema'
import { buildSeedingPlan, canonicalJson, committedFileText, deriveRunSlug, extractRunCassettes,
  projectCorpusEntry, projectSilverLabelRecord, projectRunExclusion, renderCensusMarkdown } from '@vostride/agent-qa-eval'
import { committedLabelPath, FsRunArtifactSource, readCommittedCorpus, readRunExclusions,
  seedCommittedCorpus, writeRunExclusion, commitCensus } from '@vostride/agent-qa-eval-local'
import { files, markFixture } from '../gates/__tests__/feedback-fixture.js'
import { resolveEvalSession, runSeedVerb, runCensusVerb } from '../eval-session-composition.js'

const roots: string[] = []
const fractions = { heldOutFraction: 0.4, privateFraction: 0.5 }
const partition = { ...fractions, saltHex: '0'.repeat(64) }
const bytes = (root: string) => files(root).map(path => [path, readFileSync(path).toString('hex')])
const verdict = (classification: Verdict['class'], perTest: number): Verdict => ({ class: classification,
  producer: 'deterministic-classifier', perTest, confidence: 1, memoryMisdirectionRuledOut: true,
  evidence: { citedSteps: [0], citedAnchors: [], citedArtifacts: [], rationale: 'Recorded failure' } })
beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('provider access forbidden') })
  vi.spyOn(model, 'createModel').mockImplementation(() => { throw new Error('model creation forbidden') })
})
afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled()
  expect(model.createModel).not.toHaveBeenCalled()
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture(existingOriginal = true) {
  const f = markFixture(); roots.push(f.root)
  writeFileSync(join(f.root, '.env.secrets.local'), '')
  const member = f.handoff.tests[0]!
  f.handoff.tests = [member]
  const committedRoot = join(f.root, 'agent-qa-eval')
  const artifacts = new FsRunArtifactSource({ root: f.agentQaRoot, runId: f.handoff.runId })
  const evidence = structuredClone(member.steps[0]!)
  // 422-12: extraction now projects the member's recorded root cause onto the cassette label, so
  // the ORIGINAL cassette must be extracted from a handoff carrying the ORIGINAL attempt's
  // verdict — the one `rerunOrigin.rootCause` preserves below — never the rerun's final class.
  member.rootCause = verdict('environment', 0)
  const originalExtraction = extractRunCassettes({ handoff: f.handoff, artifacts }).cassettes
  const original = originalExtraction.find(row => row.cassette.granularity === 'leaf')!.cassette
  if (original.granularity !== 'leaf') throw new Error('fixture leaf missing')
  const label = projectSilverLabelRecord({ cassette: original, runId: f.handoff.runId })
  const originalPlan = buildSeedingPlan({ handoff: f.handoff, cassettes: originalExtraction, partition })
  originalPlan.cases = [{ cassetteId: original.id, labelRecord: label, corpusEntry: projectCorpusEntry({
    cassette: original, product: 'default', runId: f.handoff.runId, assignment: { split: 'natural' },
  }) }]
  if (existingOriginal) {
    const initial = seedCommittedCorpus({ plan: originalPlan, cassettes: originalExtraction,
      committedRoot, seedingOutputBaseDir: join(f.agentQaRoot, 'eval', 'audit', 'original') })
    expect(initial.refusals).toEqual([])
    expect(initial.seededCount).toBe(1)
  }
  const facts = { runId: f.handoff.runId, testId: member.testId, testIndex: member.testIndex,
    stepIndex: evidence.stepIndex, decisionOrdinal: 0, evidence }
  const origin = { attempt: 0, outcome: 'failed' as const, rootCause: verdict('environment', 0),
    decisions: [{ ...facts, screenStateHash: screenStateHash(evidence.subActions[0]!.stateBefore),
      evidenceDigest: sha256hex(canonicalJson(facts)) }] }
  member.isRerun = true; member.rerunAttempt = 2
  member.rerunOrigin = { ...origin, evidenceDigest: sha256hex(canonicalJson(origin)) }
  member.rootCause = verdict('flake', 0)
  member.outcome = 'passed'
  member.steps[0]!.verifierVerdict = { pass: true, reasoning: 'Retry passed' }
  // A recovery on a later step keeps distinct actual cassette addresses from the original.
  const pairStep = structuredClone(member.steps[0]!)
  pairStep.stepIndex = 1
  const failed = pairStep.subActions[0]!, recovering = structuredClone(failed)
  failed.result = { success: false, error: 'Action rejected' }
  const ref = asRef('e-recovery')
  recovering.stateBefore.elements.push({ ...structuredClone(recovering.stateBefore.elements[0]!), ref,
    name: 'Recovery', nameNormalized: 'recovery' })
  recovering.stateBefore.refMap[ref] = structuredClone(recovering.stateBefore.refMap[recovering.stateBefore.elements[0]!.ref]!)
  recovering.plannedAction = { type: 'click', ref }
  recovering.result = { success: true }
  pairStep.subActions = [failed, recovering]
  const decision = (sub: typeof failed) => ({ plan: sub.plan, plannedAction: sub.plannedAction, result: sub.result })
  pairStep.selfHeal = { failedDecision: decision(failed), recoveringDecision: decision(recovering) }
  member.steps.push(pairStep)
  const silver = structuredClone(member)
  silver.testIndex = 2; silver.rootCause = verdict('flake', 2)
  delete silver.rerunOrigin
  silver.steps = [structuredClone(member.steps[0]!)]
  const excluded = structuredClone(member)
  excluded.testIndex = 5; excluded.rootCause = verdict('timeout', 5)
  excluded.outcome = 'timeout'
  delete excluded.isRerun; delete excluded.rerunAttempt; delete excluded.rerunOrigin
  // Even a self-heal step here must not enter this mixed run's admission/population.
  f.handoff.tests = [member, silver, excluded]
  f.save()
  return { ...f, member, silver, excluded, original, committedRoot, artifacts }
}

describe('420 member admission through actual seed', () => {
  it('censuses full committed ownership without scoring quarantines and refuses old census overwrite', async () => {
    const f = fixture()
    const session = await resolveEvalSession({ configPath: f.configPath })
    await runSeedVerb(session, {}, fractions)
    const result = await runCensusVerb(session)
    expect(result.census.products.default).toMatchObject({ total: 3, labelAudit: {
      committedMembers: 4, scorableMembers: 3, rerunPairs: 1, rerunMarkedLabels: 3,
      rerunOverturnedOriginals: 1, rerunOverturnQuarantined: 1, refusedHistories: 0 } })
    const legacy = structuredClone(result.census)
    delete legacy.products.default!.labelAudit
    expect(commitCensus({ census: legacy, markdown: renderCensusMarkdown(legacy),
      committedRoot: f.committedRoot, censusOutputBaseDir: join(f.agentQaRoot, 'eval', 'audit') }).kind).toBe('committed')
    const before = bytes(f.committedRoot)
    expect((await runCensusVerb(session, { commit: true })).committed?.kind).toBe('write-conflict')
    expect(bytes(f.committedRoot)).toEqual(before)
  })
  it('admits only eligible mixed members, retires one exact original and repeats byte-identically', async () => {
    const f = fixture(), originalBytes = bytes(f.committedRoot)
    const session = await resolveEvalSession({ configPath: f.configPath })
    const report = await runSeedVerb(session, {}, fractions)
    expect(report.runsSkipped).toEqual([])
    expect(report.refusals).toEqual([])
    expect(report.seededCount).toBe(3)
    expect(report).toMatchObject({ supersededOriginalCount: 1, retirementCounts: { missing: 0, conflict: 0 },
      membersExcluded: [{ testIndex: 5, verdict: { class: 'timeout', producer: 'deterministic-classifier' } }],
      silverExclusionRows: expect.arrayContaining([expect.objectContaining({ testIndex: 0, reason: 'rerun-overturn-quarantined' })]) })
    expect(report.exclusionsWritten).toEqual([])
    expect(readRunExclusions(f.committedRoot).exclusions).toEqual([])
    const read = readCommittedCorpus(f.committedRoot)
    expect(read.refusals).toEqual([])
    expect(read.snapshot.entries).toHaveLength(3)
    expect(read.snapshot.entries.some(row => row.cassetteId === f.original.id)).toBe(false)
    expect(read.snapshot.labelsById.get(f.original.id)?.quarantine).toBe('rerun-overturned')
    expect(read.snapshot.excludedLabelIds?.has(f.original.id)).toBe(true)
    expect(read.snapshot.labelHistory).toHaveLength(5)
    const pair = [...read.snapshot.labelsById.values()].filter(row => row.label.sourceChannel === 'self-heal-pair')
    expect(pair).toHaveLength(2)
    for (const label of pair) expect(label).toMatchObject({ weight: { k: 1, n: 1 }, provenance: { rerun: { attempt: 2 } } })
    expect([...read.snapshot.cassettesById.values()].map(row => row.testIndex)).not.toContain(5)
    const silver = [...read.snapshot.labelsById.values()].find(row => read.snapshot.cassettesById.get(row.cassetteId)?.testIndex === 2)!
    expect(silver.label.tier).toBe('silver')
    expect(silver.provenance.rerun).toEqual({ attempt: 2 })
    for (const [path, content] of originalBytes) expect(readFileSync(path!).toString('hex')).toBe(content)
    const before = bytes(f.committedRoot)
    const again = await runSeedVerb(session)
    expect(again).toMatchObject({ seededCount: 0, unchangedCount: 3, supersededOriginalCount: 0,
      retirementCounts: { missing: 0, conflict: 0 }, refusals: [], runsSkipped: [] })
    expect(bytes(f.committedRoot)).toEqual(before)
  })

  it('discloses missing original evidence while admitting the retry recovery pair', async () => {
    const f = fixture(false)
    const session = await resolveEvalSession({ configPath: f.configPath })
    const report = await runSeedVerb(session, {}, fractions)
    expect(report).toMatchObject({ seededCount: 3, supersededOriginalCount: 0,
      retirementCounts: { missing: 1, conflict: 0 }, refusals: [], runsSkipped: [] })
    expect(readCommittedCorpus(f.committedRoot).snapshot.labelsById.has(f.original.id)).toBe(false)
  })

  it('preserves a pre-existing whole-run exclusion and reports the reviewed-path conflict', async () => {
    const f = fixture(false)
    const record = projectRunExclusion({ runId: f.handoff.runId, runSlug: deriveRunSlug(f.handoff.runId),
      product: 'default', verdicts: [{ class: 'flake', producer: 'deterministic-classifier' }], analysisDigest: 'a'.repeat(64) })
    expect(writeRunExclusion({ record, committedRoot: f.committedRoot,
      seedingOutputBaseDir: join(f.agentQaRoot, 'eval', 'audit') }).kind).toBe('written')
    const before = bytes(f.committedRoot)
    const report = await runSeedVerb(await resolveEvalSession({ configPath: f.configPath }))
    expect(report).toMatchObject({ handoffsSeeded: 0, runsAdmitted: [],
      admissionConflicts: [{ reason: 'existing-run-exclusion' }] })
    expect(bytes(f.committedRoot)).toEqual(before)
  })

  it('still writes ordinary whole-run exclusions before any partition requirement', async () => {
    const f = fixture(false)
    f.handoff.tests = [f.excluded]
    f.save()
    const report = await runSeedVerb(await resolveEvalSession({ configPath: f.configPath }))
    expect(report).toMatchObject({ seededCount: 0, partitions: [], runsSkipped: [] })
    expect(report.exclusionsWritten).toHaveLength(1)
    expect(report.exclusionsWritten[0]!.outcome).toBe('written')
    expect(readRunExclusions(f.committedRoot).exclusions).toHaveLength(1)
  })

  it.each(['egress', 'conflict'] as const)('protects label-only revisions from %s without rewriting the original', mode => {
    const f = fixture()
    const snapshot = readCommittedCorpus(f.committedRoot).snapshot
    const plan = buildSeedingPlan({ handoff: { ...f.handoff, tests: [f.member] }, partition,
      cassettes: extractRunCassettes({ handoff: f.handoff, artifacts: f.artifacts }).cassettes,
      populationContext: { snapshot, handoffs: [], marks: [] } })
    plan.cases = []
    expect(plan.labelRevisions).toHaveLength(1)
    const revision = plan.labelRevisions[0]!
    const path = join(f.committedRoot, committedLabelPath('default', revision.cassetteId))
      .replace(/\.json$/, `--revision-${revision.revision!.id}.json`)
    if (mode === 'egress') revision.provenance.runId = 'AKIAIOSFODNN7EXAMPLE'
    else writeFileSync(path, committedFileText({ occupied: true }))
    const before = bytes(f.committedRoot)
    const report = seedCommittedCorpus({ plan, cassettes: [], committedRoot: f.committedRoot,
      seedingOutputBaseDir: join(f.agentQaRoot, 'eval', 'audit') })
    expect(report.refusals).toContainEqual(expect.objectContaining({ cassetteId: f.original.id,
      kind: mode === 'egress' ? 'egress-blocked' : 'write-conflict' }))
    expect(bytes(f.committedRoot)).toEqual(before)
    if (mode === 'egress') expect(existsSync(path)).toBe(false)
  })
})
