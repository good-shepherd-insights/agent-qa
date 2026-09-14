// 2026-09-15, 423 D-16: the consequence plan runs.mark consumes, previewed with no write.
import { createHash } from 'node:crypto'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LOCAL_CURATION_CAPABILITIES } from '@vostride/agent-qa-agent-local'
import { generateRunId } from '@vostride/agent-qa-ids'
import { asRunId, RunsMarkOutcomeSchema, type RunsMarkInput } from '@vostride/agent-qa-schema'
import { afterEach, describe, expect, it } from 'vitest'
import { FsMarkLedger } from '../eval-session-composition.js'
import { createFeedbackPortForHost } from '../gates/feedback-host.js'
import { previewMarkConsequences as preview } from '../gates/feedback-plan.js'
import { files, markFixture } from '../gates/__tests__/feedback-fixture.js'

const { showProposalEnvelope } = await import(new URL('../../../knowledge-local/src/review/proposals-store.js', import.meta.url).href)

const refuse = (name: string) => () => { throw new Error(`preview must not call ${name}`) }
/** Every writer, lease and draft capability throws; only the deterministic reads remain. */
function readOnlyCuration() {
  return { ...LOCAL_CURATION_CAPABILITIES,
    appendMarkEvidence: refuse('appendMarkEvidence'), withdrawPendingProposal: refuse('withdrawPendingProposal'),
    fileMarkTestDraft: refuse('fileMarkTestDraft'),
    maintenance: { ...LOCAL_CURATION_CAPABILITIES.maintenance,
      acquireWriterLease: refuse('acquireWriterLease'), releaseLease: refuse('releaseLease') } }
}

const hashes = (dir: string) => files(dir).map(path => [path, createHash('sha256').update(readFileSync(path)).digest('hex')])
const proposalStatus = (agentQaRoot: string, proposalId: string) =>
  showProposalEnvelope(agentQaRoot, proposalId, { now: Date.now() }).envelope.status

describe('423-35 shared mark consequence plan (D-16)', () => {
  const roots: string[] = []
  afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
  function fixture() {
    const f = markFixture(); roots.push(f.root)
    return { ...f, previewDeps: { configPath: f.configPath, agentQaRoot: f.agentQaRoot, curation: readOnlyCuration() } }
  }

  it('PREVIEW-REFUSAL-PARITY: missing run/member/step and ambiguous address/correction match runs.mark with no bytes', async () => {
    const f = fixture()
    const runId = f.handoff.runId
    const member = f.handoff.tests[0]!
    const step = member.steps[0]!
    const correctedAction = step.subActions[0]!.plannedAction
    step.subActions.push({ ...step.subActions[0]! })
    f.handoff.tests.push({ ...member, testIndex: 1, testId: 'second-member' }); f.save()
    const port = createFeedbackPortForHost(f.deps)
    const inputs: RunsMarkInput[] = [
      { runId: asRunId(generateRunId()), kind: 'confirmed-bug' },
      { runId, testId: 'absent-member', kind: 'false-fail' },
      { runId, kind: 'confirmed-bug' },
      { runId, testId: member.testId!, stepIndex: 4, kind: 'false-pass' },
      { runId, testId: member.testId!, kind: 'confirmed-bug', correctedAction },
    ]
    const kinds: unknown[] = []
    for (const input of inputs) {
      const before = hashes(f.root)
      const previewed = await preview(f.previewDeps, input)
      expect(hashes(f.root)).toEqual(before)
      const written = await port.mark(input)
      expect(previewed).toEqual(written)
      // The strict outcome schema pins the unchanged writer wire shape, which a shared plan could otherwise drift together.
      expect(RunsMarkOutcomeSchema.parse(written)).toEqual(written)
      expect(hashes(f.root)).toEqual(before)
      kinds.push(written.kind)
    }
    expect(kinds).toEqual(['run-not-found', 'member-not-found', 'ambiguous-address', 'step-not-found', 'ambiguous-correction'])
    expect(new FsMarkLedger({ root: f.agentQaRoot, runId }).read()).toEqual([])
    expect(await port.marksFor(runId)).toEqual([])
    expect(await preview(f.previewDeps, { runId, testId: member.testId!, kind: 'confirmed-bug' }))
      .toMatchObject({ kind: 'consequences', latest: { kind: 'first' }, basis: { ledgerOrdinal: 0 } })
  })

  it('NOTE-ONLY-REPEAT: a note-only change previews already-marked; a changed correction previews supersession', async () => {
    const f = fixture()
    const runId = f.handoff.runId
    const port = createFeedbackPortForHost(f.deps)
    const first = await port.mark({ runId, kind: 'confirmed-bug', note: 'first note' })
    if (first.kind !== 'marked') throw new Error('expected the first mark')
    const before = hashes(f.root)
    const repeat: RunsMarkInput = { runId, kind: 'confirmed-bug', note: 'a different note' }
    expect(await preview(f.previewDeps, repeat))
      .toEqual({ kind: 'already-marked', receipt: first.receipt, basis: { ledgerOrdinal: 1, priorOrdinal: 1 } })
    expect(hashes(f.root)).toEqual(before)
    expect(await port.mark(repeat)).toEqual({ kind: 'already-marked', receipt: first.receipt })
    const corrected: RunsMarkInput = { runId, kind: 'confirmed-bug', note: 'first note', correctedExpectation: 'The order total is shown' }
    const superseding = await preview(f.previewDeps, corrected)
    expect(superseding).toMatchObject({ kind: 'consequences',
      latest: { kind: 'supersedes', markId: first.receipt.markId, ordinal: 1 }, basis: { ledgerOrdinal: 1, priorOrdinal: 1 } })
    expect(superseding).not.toHaveProperty('withdraws')
    expect(hashes(f.root)).toEqual(before)
    expect(await port.mark(corrected))
      .toMatchObject({ kind: 'marked', receipt: { ordinal: 2, supersedes: first.receipt.markId } })
  })

  it('QUARANTINE-ORDER: step refusal precedes quarantine, and quarantine precedes the ambiguous-correction refusal', async () => {
    const f = fixture()
    const runId = f.handoff.runId
    const member = f.handoff.tests[0]!
    const step = member.steps[0]!
    const correctedAction = step.subActions[0]!.plannedAction
    step.subActions.push({ ...step.subActions[0]! })
    member.rootCause = { class: 'flake', producer: 'deterministic-classifier', confidence: 1, evidence: { citedSteps: [0], citedAnchors: [], citedArtifacts: [], rationale: 'Recorded classification' }, memoryMisdirectionRuledOut: true, perTest: 0 }
    f.save()
    const port = createFeedbackPortForHost(f.deps)
    const before = hashes(f.root)
    const missing: RunsMarkInput = { runId, stepIndex: 3, kind: 'false-fail', correctedAction }
    const refused = await preview(f.previewDeps, missing)
    expect(refused).toMatchObject({ kind: 'step-not-found', stepCount: 1 })
    expect(refused).toEqual(await port.mark(missing))
    const ambiguous: RunsMarkInput = { runId, kind: 'false-fail', correctedAction }
    expect(await preview(f.previewDeps, ambiguous)).toEqual({ kind: 'quarantined', class: 'flake',
      resolvedStep: { stepIndex: 0, reason: 'failing-step' }, latest: { kind: 'first' }, basis: { ledgerOrdinal: 0 } })
    expect(hashes(f.root)).toEqual(before)
    expect(await port.mark(ambiguous)).toMatchObject({ kind: 'marked',
      receipt: { disposition: { kind: 'quarantined', class: 'flake' }, gold: [], evidence: { confirmed: 0, overturned: 0 } } })
    delete member.rootCause; f.save()
    const learnable: RunsMarkInput = { runId, testId: member.testId!, kind: 'confirmed-bug', correctedAction }
    const previewed = await preview(f.previewDeps, learnable)
    expect(previewed).toEqual({ kind: 'ambiguous-correction', runId, testIndex: 0, decisionCount: 2 })
    expect(previewed).toEqual(await port.mark(learnable))
  })

  it('PRIOR-WITHDRAWAL: only a new completing effect withdraws the prior draft; repeats, refusals and quarantine do not', async () => {
    const f = fixture()
    const runId = f.handoff.runId
    const port = createFeedbackPortForHost(f.deps)
    const first = await port.mark({ runId, kind: 'false-fail' })
    if (first.kind !== 'marked' || first.receipt.disposition.kind !== 'drafted') throw new Error('expected a drafted mark')
    const { proposalId, proposalKind } = first.receipt.disposition
    const before = hashes(f.root)
    const repeated = await preview(f.previewDeps, { runId, kind: 'false-fail', note: 'only the note moved' })
    expect(repeated).toMatchObject({ kind: 'already-marked' })
    expect(repeated).not.toHaveProperty('withdraws')
    expect(await preview(f.previewDeps, { runId, stepIndex: 2, kind: 'confirmed-bug' })).toMatchObject({ kind: 'step-not-found' })

    const scratch = mkdtempSync(join(tmpdir(), '423-35-withdrawal-')); roots.push(scratch)
    cpSync(f.root, scratch, { recursive: true })
    const copy = { configPath: join(scratch, 'agent-qa.config.yaml'), agentQaRoot: join(scratch, '.agent-qa') }
    const quarantinedHandoff = { ...f.handoff, tests: [{ ...f.handoff.tests[0]!, rootCause: { class: 'timeout' as const, producer: 'deterministic-classifier', confidence: 1, evidence: { citedSteps: [0], citedAnchors: [], citedArtifacts: [], rationale: 'Recorded classification' }, memoryMisdirectionRuledOut: true, perTest: 0 } }] }
    writeFileSync(join(copy.agentQaRoot, 'runs', f.runDir.split('/').at(-1)!, 'handoff.json'), JSON.stringify(quarantinedHandoff))
    const quarantined = await preview({ ...copy, curation: readOnlyCuration() }, { runId, kind: 'confirmed-bug' })
    expect(quarantined).toMatchObject({ kind: 'quarantined', class: 'timeout', latest: { kind: 'supersedes', markId: first.receipt.markId } })
    expect(quarantined).not.toHaveProperty('withdraws')
    expect(await createFeedbackPortForHost({ ...f.deps, ...copy }).mark({ runId, kind: 'confirmed-bug' }))
      .toMatchObject({ kind: 'marked', receipt: { disposition: { kind: 'quarantined' }, supersedes: first.receipt.markId } })
    expect(proposalStatus(copy.agentQaRoot, proposalId)).toBe('pending')

    const effect = await preview(f.previewDeps, { runId, kind: 'confirmed-bug' })
    expect(effect).toMatchObject({ kind: 'consequences', withdraws: { proposalId, proposalKind },
      latest: { kind: 'supersedes', markId: first.receipt.markId, ordinal: 1 } })
    expect(hashes(f.root)).toEqual(before)
    expect(proposalStatus(f.agentQaRoot, proposalId)).toBe('pending')
    expect(await port.mark({ runId, kind: 'confirmed-bug' })).toMatchObject({ kind: 'marked', receipt: { supersedes: first.receipt.markId } })
    expect(proposalStatus(f.agentQaRoot, proposalId)).toBe('rejected')
  })

  it('MARK-PLAN-PARITY: the previewed step, labels, served evidence and draft target are the ones the writer lands', async () => {
    const f = fixture()
    const runId = f.handoff.runId
    const before = hashes(f.root)
    const previewed = await preview(f.previewDeps, { runId, kind: 'false-fail' })
    expect(hashes(f.root)).toEqual(before)
    expect(JSON.stringify(previewed)).not.toMatch(/mark_[0-9a-f]{12}/)
    expect(previewed).toMatchObject({ kind: 'consequences', resolvedStep: { stepIndex: 0, reason: 'failing-step' }, decisionCount: 1,
      knowledge: { servedRecordIds: [f.published.id], appendsEvidence: true },
      draft: { kind: 'knowledge', fix: 'fact', target: { grain: 'record', recordId: f.published.id } },
      latest: { kind: 'first' }, basis: { ledgerOrdinal: 0 } })
    const written = await createFeedbackPortForHost(f.deps).mark({ runId, kind: 'false-fail' })
    if (written.kind !== 'marked' || previewed.kind !== 'consequences') throw new Error('expected mark')
    expect(previewed.labels.map(label => [label.channel, label.sourceCassetteId]))
      .toEqual(written.receipt.gold.map(item => [item.channel, item.sourceCassetteId]))
    expect(written.receipt.evidence.confirmed).toBe(1)
    expect(written.receipt.disposition).toMatchObject({ kind: 'drafted', fix: 'fact', proposalKind: 'knowledge' })
  })
})
