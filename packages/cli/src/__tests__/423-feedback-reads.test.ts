// 2026-09-15, 423 D-16: the consequence plan runs.mark consumes, previewed with no write.
import { createHash } from 'node:crypto'
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import * as agent from '@vostride/agent-qa-agent'
import { LOCAL_CURATION_CAPABILITIES } from '@vostride/agent-qa-agent-local'
import { createConfirmRegistry } from '@vostride/agent-qa-dashboard'
import { generateRunId } from '@vostride/agent-qa-ids'
import { createMaskingContext, setActiveMaskingContextResolver } from '@vostride/agent-qa-safety'
import { asRunId, maskedMarker, RunsMarkOutcomeSchema, type FeedbackReadsPort, type MarkReceipt, type RunId, type RunsMarkInput, type RunsMarksHistoryResult, RunsMarksHistoryResultSchema } from '@vostride/agent-qa-schema'
import { Command } from 'commander'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { composeDashboardDoor, DASHBOARD_FUNCTION_CALLER } from '../commands/dashboard.js'
import { createFnCommand } from '../commands/fn.js'
import * as host from '../composition/local-agent-host.js'
import { FsMarkLedger } from '../eval-session-composition.js'
import { createFeedbackPortForHost } from '../gates/feedback-host.js'
import { createFeedbackReadsPortForHost, type FeedbackReadsHostDeps } from '../gates/feedback-read-host.js'
import { previewMarkConsequences as preview } from '../gates/feedback-plan.js'
import { files, markFixture } from '../gates/__tests__/feedback-fixture.js'

const { claimPendingProposal, showProposalEnvelope } = await import(new URL('../../../knowledge-local/src/review/proposals-store.js', import.meta.url).href)
const { runsMarksHistorySpec } = await import(new URL('../../../agent/src/functions/ops/runs-marks-history.js', import.meta.url).href)

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

// 2026-09-15, 423 D-19: marks history over the real ledger and proposals store, observed with no write.
const SECRET = 'synthetic-423-18-history-token'
type HistoryReadsDeps = FeedbackReadsHostDeps

/** Every path under a root, directories included, so a created directory is a visible change. */
function tree(root: string): [string, string][] {
  if (!existsSync(root)) return [[root, 'absent']]
  const walk = (path: string): [string, string][] => lstatSync(path).isDirectory()
    ? [[path, 'dir'], ...readdirSync(path).sort().flatMap(name => walk(join(path, name)))]
    : [[path, createHash('sha256').update(readFileSync(path)).digest('hex')]]
  return walk(root)
}

const readsFor = (deps: HistoryReadsDeps): FeedbackReadsPort => createFeedbackReadsPortForHost(deps)

const historyOf = async (reads: FeedbackReadsPort, runId: RunId): Promise<RunsMarksHistoryResult> =>
  await runsMarksHistorySpec.invoke({ runId }, { feedbackReads: reads } as never)

function historyEntries(result: RunsMarksHistoryResult) {
  if (result.kind !== 'history') throw new Error(`expected history, got ${result.kind}`)
  return result.entries
}

function proposalIdOf(receipt: MarkReceipt): string {
  if (receipt.disposition.kind !== 'drafted') throw new Error('expected a drafted receipt')
  return receipt.disposition.proposalId
}

type MarkedTemplate = { root: string; runSlug: string; runId: RunId; receipts: MarkReceipt[] }

/** Three real marks: a drafted run-level mark, its confirmed-bug successor (which withdraws the draft), and a drafted step mark. */
async function markedTemplate(roots: string[]): Promise<MarkedTemplate> {
  const f = markFixture(); roots.push(f.root)
  const runId = f.handoff.runId
  const port = createFeedbackPortForHost(f.deps)
  const receipts: MarkReceipt[] = []
  for (const input of [
    { runId, kind: 'false-fail', note: 'first run-level note' },
    { runId, kind: 'confirmed-bug' },
    { runId, stepIndex: 0, kind: 'false-fail', note: `step note ${SECRET}` },
  ] satisfies RunsMarkInput[]) {
    const outcome = await port.mark(input)
    if (outcome.kind !== 'marked') throw new Error(`fixture mark refused: ${outcome.kind}`)
    receipts.push(outcome.receipt)
  }
  expect(receipts.map(receipt => receipt.disposition.kind)).toEqual(['drafted', 'confirmed-bug', 'drafted'])
  return { root: f.root, runSlug: f.runDir.split('/').at(-1)!, runId, receipts }
}

describe('423-18 read-only marks history host (D-19)', () => {
  const roots: string[] = []
  let template: MarkedTemplate

  beforeAll(async () => { template = await markedTemplate(roots) }, 180_000)
  afterEach(() => setActiveMaskingContextResolver(() => undefined))
  afterAll(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

  function scene() {
    const root = mkdtempSync(join(tmpdir(), '423-18-history-')); roots.push(root)
    cpSync(template.root, root, { recursive: true })
    const agentQaRoot = join(root, '.agent-qa')
    const runDir = join(agentQaRoot, 'runs', template.runSlug)
    return { root, agentQaRoot, runDir, ledger: join(runDir, 'marks.jsonl'), proposals: join(agentQaRoot, 'proposals') }
  }

  it('HISTORY-WRITES-NOTHING: history leaves ledger, intent, gold, knowledge and proposals byte-identical and creates nothing', async () => {
    const s = scene()
    const [first, second, third] = template.receipts as [MarkReceipt, MarkReceipt, MarkReceipt]
    // An in-flight intent and an orphaned claim are exactly what a writer or a listing would clean up.
    writeFileSync(join(s.runDir, 'mark-intent.json'), '{"stage":"prepared"}\n')
    expect(claimPendingProposal(s.agentQaRoot, proposalIdOf(third))).toMatchObject({ kind: 'consumed' })
    const before = tree(s.root)
    const reads = readsFor({ agentQaRoot: s.agentQaRoot, isProcessAlive: () => false })
    const result = await historyOf(reads, template.runId)
    expect(result).toMatchObject({ kind: 'history', runId: template.runId, entries: [
      { markId: first.markId, ordinal: 1, active: false, supersededBy: second.markId, proposal: { state: 'rejected' } },
      { markId: second.markId, ordinal: 2, active: true, supersedes: first.markId },
      { markId: third.markId, ordinal: 3, active: true, stepIndex: 0, proposal: { state: 'pending', applyInFlight: false } },
    ] })
    expect(historyEntries(result)[1]).not.toHaveProperty('proposal')
    expect(await historyOf(reads, template.runId)).toEqual(result)
    expect(tree(s.root)).toEqual(before)

    // An unmarked run answers an empty history without creating a ledger, lock or intent.
    const bare = markFixture(); roots.push(bare.root)
    const bareBefore = tree(bare.root)
    expect(await historyOf(readsFor({ agentQaRoot: bare.agentQaRoot }), bare.handoff.runId))
      .toEqual({ kind: 'history', runId: bare.handoff.runId, entries: [] })
    expect(tree(bare.root)).toEqual(bareBefore)

    // A run this root never recorded, and a root that was never created, stay absent.
    const unknown = asRunId(generateRunId())
    expect(await historyOf(reads, unknown)).toEqual({ kind: 'run-not-found', runId: unknown })
    expect(tree(s.root)).toEqual(before)
    const fresh = mkdtempSync(join(tmpdir(), '423-18-fresh-')); roots.push(fresh)
    const absentRoot = join(fresh, 'never-created', '.agent-qa')
    expect(await historyOf(readsFor({ agentQaRoot: absentRoot }), template.runId)).toEqual({ kind: 'run-not-found', runId: template.runId })
    expect(tree(fresh)).toEqual([[fresh, 'dir']])
    expect(existsSync(dirname(absentRoot))).toBe(false)
  })

  it('PROPOSAL-CURRENT/MISSING: drafted receipts join the store classifier state; missing never reads as pending', async () => {
    const s = scene()
    const [first, , third] = template.receipts as [MarkReceipt, MarkReceipt, MarkReceipt]
    const now = Date.now()
    const reads = (extra: Partial<HistoryReadsDeps> = {}) => readsFor({ agentQaRoot: s.agentQaRoot, now: () => now, ...extra })

    const current = historyEntries(await historyOf(reads(), template.runId))
    expect(current.map(entry => [entry.disposition.kind, entry.proposal?.state ?? null]))
      .toEqual([['drafted', 'rejected'], ['confirmed-bug', null], ['drafted', 'pending']])
    // The historical disposition keeps the drafted proposal id even though its proposal is now rejected.
    expect(current[0]!.disposition).toEqual(first.disposition)
    const shown = showProposalEnvelope(s.agentQaRoot, proposalIdOf(third), { now })
    expect(current[2]!.proposal).toEqual({ state: shown.envelope.status, applyInFlight: shown.applyInFlight })
    expect(current[2]!.proposal).toEqual({ state: 'pending', applyInFlight: false })

    const later = now + 365 * 24 * 60 * 60 * 1000
    expect(historyEntries(await historyOf(reads({ now: () => later }), template.runId))[2]!.proposal)
      .toEqual({ state: 'expired', applyInFlight: false })

    expect(claimPendingProposal(s.agentQaRoot, proposalIdOf(third))).toMatchObject({ kind: 'consumed' })
    expect(historyEntries(await historyOf(reads(), template.runId))[2]!.proposal).toEqual({ state: 'pending', applyInFlight: true })
    const claimed = tree(s.root)
    expect(historyEntries(await historyOf(reads({ isProcessAlive: () => false }), template.runId))[2]!.proposal)
      .toEqual({ state: 'pending', applyInFlight: false })
    expect(tree(s.root)).toEqual(claimed)

    rmSync(s.proposals, { recursive: true, force: true })
    const missing = historyEntries(await historyOf(reads(), template.runId))
    expect(missing.map(entry => entry.proposal)).toEqual([{ state: 'missing' }, undefined, { state: 'missing' }])
    expect(missing.map(entry => entry.disposition.kind)).toEqual(['drafted', 'confirmed-bug', 'drafted'])
    expect(existsSync(s.proposals)).toBe(false)
  })

  it('WITHDRAWAL-REASON: the withdrawn proposal carries its decision reason, and every free-text field crosses the mask', async () => {
    const s = scene()
    const [first, second, third] = template.receipts as [MarkReceipt, MarkReceipt, MarkReceipt]
    const reads = readsFor({ agentQaRoot: s.agentQaRoot })
    const raw = await reads.history(template.runId)
    if (raw.kind !== 'history') throw new Error('expected a history read')
    expect(raw.entries[0]!.proposal).toEqual({ state: 'rejected',
      decision: { decision: 'rejected', at: expect.any(Number), reason: `superseded by ${second.markId}` } })
    expect(raw.entries[0]!.receipt).toEqual(first)

    const masking = createMaskingContext()
    masking.register(SECRET)
    setActiveMaskingContextResolver(() => masking)
    const masked = await historyOf(reads, template.runId)
    const entries = historyEntries(masked)
    expect(entries[0]).toMatchObject({ note: masking.mask('first run-level note'),
      proposal: { state: 'rejected', decision: { reason: masking.mask(`superseded by ${second.markId}`) } } })
    expect(entries[2]).toMatchObject({ markId: third.markId, note: masking.mask(`step note ${SECRET}`) })
    expect(JSON.stringify(masked)).not.toContain(SECRET)

    setActiveMaskingContextResolver(() => undefined)
    const unmaskable = historyEntries(await historyOf(reads, template.runId))
    expect(unmaskable[0]).toMatchObject({ note: maskedMarker('secret'), proposal: { decision: { reason: maskedMarker('secret') } } })
    expect(unmaskable[2]!.note).toBe(maskedMarker('secret'))
    expect(JSON.stringify(unmaskable)).not.toContain('superseded by')
  })

  it('HISTORY-CORRUPT: corrupt ledgers and proposals are typed failures that leave their bytes in place', async () => {
    const proposalScene = scene()
    const third = template.receipts[2]!
    writeFileSync(join(proposalScene.proposals, `${proposalIdOf(third)}.json`), '{"not":"a proposal"')
    const proposalBefore = tree(proposalScene.root)
    const entries = historyEntries(await historyOf(readsFor({ agentQaRoot: proposalScene.agentQaRoot }), template.runId))
    expect(entries.map(entry => entry.proposal?.state ?? null)).toEqual(['rejected', null, 'corrupt'])
    expect(tree(proposalScene.root)).toEqual(proposalBefore)

    // A receipt whose drafted id names a proposal of another kind is not joined as that proposal.
    const kindScene = scene()
    const ledgerLines = readFileSync(kindScene.ledger, 'utf8').split('\n')
    const drafted = JSON.parse(ledgerLines[2]!) as MarkReceipt
    ledgerLines[2] = JSON.stringify({ ...drafted, disposition: { ...drafted.disposition, proposalKind: 'test-draft', fix: 'test-edit' } })
    writeFileSync(kindScene.ledger, ledgerLines.join('\n'))
    const kindBefore = tree(kindScene.root)
    expect(historyEntries(await historyOf(readsFor({ agentQaRoot: kindScene.agentQaRoot }), template.runId))
      .map(entry => entry.proposal?.state ?? null)).toEqual(['rejected', null, 'corrupt'])
    expect(tree(kindScene.root)).toEqual(kindBefore)

    const torn = scene()
    writeFileSync(torn.ledger, readFileSync(torn.ledger, 'utf8').slice(0, -1))
    const tornBefore = tree(torn.root)
    expect(await historyOf(readsFor({ agentQaRoot: torn.agentQaRoot }), template.runId))
      .toEqual({ kind: 'ledger-corrupt', runId: template.runId, line: 3 })
    expect(tree(torn.root)).toEqual(tornBefore)

    const garbled = scene()
    const lines = readFileSync(garbled.ledger, 'utf8').split('\n')
    lines[1] = '{"torn":'
    writeFileSync(garbled.ledger, lines.join('\n'))
    const garbledBefore = tree(garbled.root)
    expect(await historyOf(readsFor({ agentQaRoot: garbled.agentQaRoot }), template.runId))
      .toEqual({ kind: 'ledger-corrupt', runId: template.runId, line: 2 })
    expect(tree(garbled.root)).toEqual(garbledBefore)

    const unreadable = scene()
    rmSync(unreadable.ledger)
    mkdirSync(unreadable.ledger)
    const unreadableBefore = tree(unreadable.root)
    expect(await historyOf(readsFor({ agentQaRoot: unreadable.agentQaRoot }), template.runId))
      .toEqual({ kind: 'ledger-unavailable', runId: template.runId })
    expect(tree(unreadable.root)).toEqual(unreadableBefore)
  })
})

// 2026-09-15, 423 D-19: runs.marks.history registered and bound on every existing local host composition.
const HISTORY = 'runs.marks.history'
const auditless = { appendExecutionAudit() {}, appendGuardrailAudit() {} }

describe('423-18 marks history registration and host binding (D-19)', () => {
  const roots: string[] = []
  const closers: Array<() => void | Promise<void>> = []
  let template: MarkedTemplate

  beforeAll(async () => { template = await markedTemplate(roots) }, 180_000)
  afterEach(async () => {
    process.exitCode = 0
    for (const close of closers.splice(0).reverse()) await close()
  })
  afterAll(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

  function coldScene() {
    const root = mkdtempSync(join(tmpdir(), '423-18-binding-')); roots.push(root)
    cpSync(template.root, root, { recursive: true })
    // The note's synthetic token is a declared secret, so a cold host's live mask must hide it.
    writeFileSync(join(root, '.env.secrets.local'), `HISTORY_SYNTHETIC_TOKEN=${SECRET}\n`)
    const agentQaRoot = join(root, '.agent-qa')
    return { root, configPath: join(root, 'agent-qa.config.yaml'), agentQaRoot,
      stores: [join(agentQaRoot, 'runs'), join(agentQaRoot, 'proposals'), join(root, 'agent-qa-knowledge'), join(root, 'agent-qa-eval')] }
  }
  const storeMaps = (stores: readonly string[]) => stores.map(tree)

  function expectMaskedOrdinalHistory(value: unknown) {
    const result = RunsMarksHistoryResultSchema.parse(value)
    const entries = historyEntries(result)
    const [first, second, third] = template.receipts as [MarkReceipt, MarkReceipt, MarkReceipt]
    expect(entries.map(entry => [entry.markId, entry.ordinal, entry.active, entry.supersededBy ?? null, entry.proposal?.state ?? null]))
      .toEqual([[first.markId, 1, false, second.markId, 'rejected'], [second.markId, 2, true, null, null], [third.markId, 3, true, null, 'pending']])
    expect(typeof entries[2]!.note).toBe('string')
    expect(JSON.stringify(result)).not.toContain(SECRET)
    return result
  }

  it('HISTORY-REGISTRY-BINDING: the cold CLI host binds the read host, and a registry without feedbackReads stays unbound', async () => {
    expect(Reflect.get(agent, 'RUNS_MARKS_HISTORY_FUNCTION_ID')).toBe(HISTORY)
    expect(Reflect.get(agent, 'runsMarksHistorySpec')).toBeUndefined()

    const s = coldScene()
    const composed = host.composeCliLocalAgent({ configPath: s.configPath, agentQaRoot: s.agentQaRoot, confirm: undefined,
      resolveExecutionContext: () => 'local-headless' })
    closers.push(() => composed.close())
    expect(composed.registry.list(host.CLI_FUNCTION_CALLER).find(entry => entry.id === HISTORY)).toMatchObject({
      bindingStatus: 'bound', requiredScopes: ['read'], resultKind: 'unary', risk: { readOnly: true } })
    const before = storeMaps(s.stores)
    expectMaskedOrdinalHistory(await agent.invokeFunction(composed.registry, HISTORY, { runId: template.runId }, host.CLI_FUNCTION_CALLER))
    expect(storeMaps(s.stores)).toEqual(before)
    expect(existsSync(join(s.agentQaRoot, 'runs', template.runSlug, 'mark-intent.json'))).toBe(false)

    // The mark writer is not a history binding; an absent read port is refused by name.
    const writerOnly = agent.createFunctionRegistry({ auditSink: auditless, resolveExecutionContext: () => 'local-headless',
      deps: { feedback: { mark: refuse('feedback.mark'), marksFor: refuse('feedback.marksFor') } } as never })
    expect(writerOnly.list(host.CLI_FUNCTION_CALLER).find(entry => entry.id === HISTORY)?.bindingStatus).toBe('unbound')
    await expect(agent.invokeFunction(writerOnly, HISTORY, { runId: template.runId }, host.CLI_FUNCTION_CALLER))
      .rejects.toBeInstanceOf(agent.FunctionNotBoundError)
  })

  it('HISTORY-FN-PARITY: agent-qa fn, the CLI registry and the dashboard door return one masked history with unchanged stores', async () => {
    const s = coldScene()
    const before = storeMaps(s.stores)

    const stdout: string[] = []
    const stderr: string[] = []
    const log = vi.spyOn(console, 'log').mockImplementation((...values: unknown[]) => { stdout.push(values.map(String).join(' ')) })
    const errors = vi.spyOn(console, 'error').mockImplementation((...values: unknown[]) => { stderr.push(values.map(String).join(' ')) })
    process.exitCode = undefined
    try {
      await new Command().exitOverride().option('--config <path>').addCommand(createFnCommand())
        .parseAsync(['--config', s.configPath, 'fn', HISTORY, '--input', JSON.stringify({ runId: template.runId }), '--json'], { from: 'user' })
    } finally { log.mockRestore(); errors.mockRestore() }
    expect(stderr).toEqual([])
    expect(process.exitCode).toBeUndefined()
    const viaFn = expectMaskedOrdinalHistory(JSON.parse(stdout.join('\n')))

    const composed = host.composeCliLocalAgent({ configPath: s.configPath, agentQaRoot: s.agentQaRoot, confirm: undefined,
      resolveExecutionContext: () => 'local-headless' })
    closers.push(() => composed.close())
    const viaRegistry = expectMaskedOrdinalHistory(
      await agent.invokeFunction(composed.registry, HISTORY, { runId: template.runId }, host.CLI_FUNCTION_CALLER))

    const door = composeDashboardDoor({ configPath: s.configPath, agentQaRoot: s.agentQaRoot, boundOrigin: () => undefined,
      confirms: createConfirmRegistry({ timeoutMs: 1_000 }) })
    closers.push(() => door.host.close())
    expect(door.host.registry.list(DASHBOARD_FUNCTION_CALLER).find(entry => entry.id === HISTORY)?.bindingStatus).toBe('bound')
    const viaDashboard = expectMaskedOrdinalHistory(
      await agent.invokeFunction(door.host.registry, HISTORY, { runId: template.runId }, DASHBOARD_FUNCTION_CALLER))

    expect(viaFn).toEqual(viaRegistry)
    expect(viaDashboard).toEqual(viaRegistry)
    expect(storeMaps(s.stores)).toEqual(before)
  })
})
