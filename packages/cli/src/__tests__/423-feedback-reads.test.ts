// 2026-09-15, 423 D-16: the consequence plan runs.mark consumes, previewed with no write.
import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import * as agent from '@vostride/agent-qa-agent'
import { createKnowledgeReader, LOCAL_CURATION_CAPABILITIES } from '@vostride/agent-qa-agent-local'
import { createConfirmRegistry, createRunServiceRoutes, DashboardDatabase, startServer, type RunServicePorts } from '@vostride/agent-qa-dashboard'
import { generateRunId } from '@vostride/agent-qa-ids'
import { AGENT_QA_OP_CONTRACTS, UNPROJECTED_OPS } from '@vostride/agent-qa-mcp'
import { createMaskingContext, setActiveMaskingContextResolver } from '@vostride/agent-qa-safety'
import { asEvidenceToken, asRecordId, asRunId, maskedMarker, RunsEvidenceInputSchema, RunsMarkInputSchema, RunsMarksHistoryInputSchema, RunsMarkOutcomeSchema, RunsMarkPreviewResultSchema, type FeedbackReadsPort, type MarkReceipt, type RunId, type RunsMarkInput, type RunsMarkPreviewResult, type RunsMarksHistoryResult, RunsMarksHistoryResultSchema } from '@vostride/agent-qa-schema'
import { Command } from 'commander'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { composeDashboardDoor, DASHBOARD_FUNCTION_CALLER } from '../commands/dashboard.js'
import { createFnCommand } from '../commands/fn.js'
import * as host from '../composition/local-agent-host.js'
import { matchServiceBearer } from '../composition/run-service-token-resolution.js'
import { FsMarkLedger } from '../eval-session-composition.js'
import { createFeedbackPortForHost } from '../gates/feedback-host.js'
import { createFeedbackReadsPortForHost, type FeedbackReadsHostDeps } from '../gates/feedback-read-host.js'
import { previewMarkConsequences as preview } from '../gates/feedback-plan.js'
import { files, markFixture } from '../gates/__tests__/feedback-fixture.js'
import { RUN_SERVICE_ROUTE_BINDINGS, registryDeclarations } from './conformance/adapters.js'
import { catalogDocFieldsOf } from './conformance/catalog.js'
import { censusDiff, OP_INPUT_CONTRACTS, scenarioRowFor, scenarioTableOpIds, unprojectedReasonKeyOf } from './conformance/scenario-table.js'

// 2026-09-15, 423 D-16: eval initialization, gold freeze and the wording model call refuse while a
// preview runs. A key-only session only resolves configured roots; it reads no secret or auth state.
const denial = vi.hoisted(() => ({ active: false }))
vi.mock('../eval-session-composition.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../eval-session-composition.js')>()
  const deny = (name: string) => { if (denial.active) throw new Error(`preview must not call ${name}`) }
  return { ...actual,
    freezeGoldenTrajectory: (...args: Parameters<typeof actual.freezeGoldenTrajectory>) => {
      deny('freezeGoldenTrajectory'); return actual.freezeGoldenTrajectory(...args) },
    resolveEvalSession: async (input?: Parameters<typeof actual.resolveEvalSession>[0]) => {
      if (input?.keyOnly !== true) deny('resolveEvalSession')
      return await actual.resolveEvalSession(input) } }
})
vi.mock('../gates/feedback-wording.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../gates/feedback-wording.js')>()
  return { ...actual, wordImprovementPlan: async (...args: Parameters<typeof actual.wordImprovementPlan>) => {
    if (denial.active) throw new Error('preview must not call wordImprovementPlan')
    return await actual.wordImprovementPlan(...args) } }
})

const { claimPendingProposal, showProposalEnvelope } = await import(new URL('../../../knowledge-local/src/review/proposals-store.js', import.meta.url).href)
const { runsMarksHistorySpec } = await import(new URL('../../../agent/src/functions/ops/runs-marks-history.js', import.meta.url).href)
const { runsMarkPreviewSpec } = await import(new URL('../../../agent/src/functions/ops/runs-mark-preview.js', import.meta.url).href)
const { showRecords } = await import(new URL('../../../knowledge-local/src/show-records.js', import.meta.url).href)
const { appendOutcomeEvent } = await import(new URL('../../../knowledge-local/src/bundle-append.js', import.meta.url).href)
const { createPromotionFloorFixture } = await import(new URL('../../../knowledge-local/src/curator/__tests__/fixtures/promotion-floor-fixture.js', import.meta.url).href)

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
    expect(await preview(f.previewDeps, ambiguous)).toEqual({ kind: 'quarantined', class: 'flake', member: { testIndex: 0, testId: member.testId },
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
    // A cold host holds no masking authority for this read, so every free-text field is fully redacted.
    expect(entries.map(entry => entry.note ?? null)).toEqual([maskedMarker('secret'), null, maskedMarker('secret')])
    expect(entries[0]!.proposal).toMatchObject({ state: 'rejected', decision: { reason: maskedMarker('secret') } })
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

// 2026-09-15, 423 D-16/D-17: runs.mark.preview through the read host, content-led and write-free.
const CONTENT_SECRET = 'Held checkout marked'
type PreviewFixture = ReturnType<typeof markFixture>
type Consequences = Extract<RunsMarkPreviewResult, { kind: 'consequences' }>
const MARK_ID = /mark_[0-9a-f]{12}/g

/** Writer lease, ledger transaction/intent, gold freeze, eval initialization and the wording model all throw. */
async function denying<T>(run: () => Promise<T>): Promise<T> {
  const spies = (['transact', 'prepareIntent', 'checkpointIntent', 'append'] as const)
    .map(name => vi.spyOn(FsMarkLedger.prototype, name).mockImplementation(refuse(`FsMarkLedger.${name}`) as never))
  denial.active = true
  try { return await run() } finally {
    denial.active = false
    for (const spy of spies) spy.mockRestore()
  }
}

function previewReadsFor(f: { agentQaRoot: string; configPath: string }, extra: Partial<FeedbackReadsHostDeps> = {}): FeedbackReadsPort {
  return createFeedbackReadsPortForHost({ agentQaRoot: f.agentQaRoot, configPath: f.configPath, curation: readOnlyCuration(), ...extra })
}

function previewPort(reads: FeedbackReadsPort) {
  expect(typeof reads.preview, 'gates/feedback-read-host must expose preview').toBe('function')
  return reads.preview!.bind(reads)
}

/** The host answer, unmasked, under every negative capability. */
async function rawPreview(reads: FeedbackReadsPort, input: RunsMarkInput): Promise<RunsMarkPreviewResult> {
  const preview = previewPort(reads)
  return await denying(() => preview(input))
}

/** The real op: exact input parse, live mask and strict result parse over the host answer. */
async function opPreview(reads: FeedbackReadsPort, input: RunsMarkInput): Promise<RunsMarkPreviewResult> {
  previewPort(reads)
  return await denying(async () => await runsMarkPreviewSpec.invoke(input, { feedbackReads: reads } as never) as RunsMarkPreviewResult)
}

function consequencesOf(result: RunsMarkPreviewResult): Consequences {
  if (result.kind !== 'consequences') throw new Error(`expected consequences, got ${result.kind}`)
  return result
}

/** No receipt, gold id, timestamp or fresh mark id: only mark ids already in the ledger may appear. */
function expectNoMint(result: RunsMarkPreviewResult, known: readonly string[] = []) {
  const text = JSON.stringify(result)
  expect(text).not.toMatch(/"(markedAt|cassetteId|receipt|proposalUuid)"/)
  expect([...new Set(text.match(MARK_ID) ?? [])].filter(id => !known.includes(id))).toEqual([])
}

function bundleDirOf(f: PreviewFixture, recordId: string) {
  return join(f.knowledgeRoot, 'memory', 'storefront', 'bundles', recordId)
}

describe('423-19 content-led consequence preview over the read host (D-16/D-17)', () => {
  const roots: string[] = []
  afterEach(() => {
    setActiveMaskingContextResolver(() => undefined)
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  })
  function fixture() {
    const f = markFixture(); roots.push(f.root)
    return f
  }
  function copyOf(f: PreviewFixture) {
    const root = mkdtempSync(join(tmpdir(), '423-19-scene-')); roots.push(root)
    cpSync(f.root, root, { recursive: true })
    const rebase = (path: string) => join(root, path.slice(f.root.length))
    return { ...f, root, agentQaRoot: rebase(f.agentQaRoot), configPath: rebase(f.configPath), knowledgeRoot: rebase(f.knowledgeRoot),
      runDir: rebase(f.runDir), deps: { ...f.deps, agentQaRoot: rebase(f.agentQaRoot), configPath: rebase(f.configPath) } }
  }

  it('PREVIEW-WRITES-NOTHING: valid, refused, repeated, quarantined, false-pass, missing and corrupt previews keep every path and byte', async () => {
    const f = fixture()
    const runId = f.handoff.runId
    const prior = await createFeedbackPortForHost(f.deps).mark({ runId, stepIndex: 0, kind: 'false-fail' })
    if (prior.kind !== 'marked') throw new Error('expected the prior step mark')
    const known = [prior.receipt.markId]
    // An orphaned intent is exactly what a writer transaction would inspect and clean up.
    writeFileSync(join(f.runDir, 'mark-intent.json'), '{"stage":"prepared"}\n')
    const reads = previewReadsFor(f)
    const before = tree(f.root)
    const cases: [RunsMarkInput, RunsMarkPreviewResult['kind']][] = [
      [{ runId, kind: 'false-fail' }, 'consequences'],
      [{ runId, kind: 'confirmed-bug' }, 'consequences'],
      [{ runId, kind: 'false-pass' }, 'consequences'],
      [{ runId, stepIndex: 5, kind: 'false-fail' }, 'step-not-found'],
      [{ runId, testId: 'absent-member', kind: 'confirmed-bug' }, 'member-not-found'],
      [{ runId: asRunId(generateRunId()), kind: 'confirmed-bug' }, 'run-not-found'],
      [{ runId, stepIndex: 0, kind: 'false-fail', note: 'only the note moved' }, 'already-marked'],
    ]
    for (const [input, kind] of cases) {
      const result = await opPreview(reads, input)
      expect(result.kind, JSON.stringify(input)).toBe(kind)
      expectNoMint(result, known)
      expect(tree(f.root)).toEqual(before)
    }

    const quarantine = copyOf(f)
    const quarantinedHandoff = { ...f.handoff, tests: [{ ...f.handoff.tests[0]!, rootCause: { class: 'environment' as const, producer: 'deterministic-classifier', confidence: 1, evidence: { citedSteps: [0], citedAnchors: [], citedArtifacts: [], rationale: 'Recorded classification' }, memoryMisdirectionRuledOut: true, perTest: 0 } }] }
    writeFileSync(join(quarantine.runDir, 'handoff.json'), JSON.stringify(quarantinedHandoff))
    const quarantineBefore = tree(quarantine.root)
    expect(await opPreview(previewReadsFor(quarantine), { runId, kind: 'false-pass' }))
      .toMatchObject({ kind: 'quarantined', prospective: true, markKind: 'false-pass', class: 'environment', member: { testIndex: 0 } })
    expect(tree(quarantine.root)).toEqual(quarantineBefore)

    // A purged served record and a corrupt served bundle are typed absences, not writes or crashes.
    const purged = copyOf(f)
    rmSync(bundleDirOf(purged, f.published.id), { recursive: true })
    const purgedBefore = tree(purged.root)
    expect(consequencesOf(await opPreview(previewReadsFor(purged), { runId, kind: 'confirmed-bug' })).knowledge.records)
      .toEqual([{ recordId: f.published.id, contentAbsence: { reason: 'not-found' }, served: true, evidence: { kind: 'unreadable' } }])
    expect(tree(purged.root)).toEqual(purgedBefore)
    const corrupt = copyOf(f)
    writeFileSync(join(bundleDirOf(corrupt, f.published.id), 'manifest.json'), '{"torn":')
    const corruptBefore = tree(corrupt.root)
    expect(consequencesOf(await opPreview(previewReadsFor(corrupt), { runId, kind: 'confirmed-bug' })).knowledge)
      .toMatchObject({ records: [{ recordId: f.published.id, contentAbsence: { reason: 'scan-incomplete' }, served: true, evidence: { kind: 'unreadable' } }],
        evidence: { confirmed: 0, overturned: 0 } })
    expect(tree(corrupt.root)).toEqual(corruptBefore)

    // A corrupt ledger refuses the read the writer would refuse, with its bytes left in place.
    const torn = copyOf(f)
    writeFileSync(join(torn.runDir, 'marks.jsonl'), '{"torn":\n')
    const tornBefore = tree(torn.root)
    await expect(denying(() => previewPort(previewReadsFor(torn))({ runId, kind: 'confirmed-bug' }))).rejects.toThrow()
    expect(tree(torn.root)).toEqual(tornBefore)

    // A host without a config binds history only, so preview stays unbound by name.
    expect(createFeedbackReadsPortForHost({ agentQaRoot: f.agentQaRoot }).preview).toBeUndefined()
  }, 120_000)

  it('INTENT-UNCHANGED: an in-flight mark intent is observed without cleanup, and only the writer resumes it', async () => {
    const f = fixture()
    const runId = f.handoff.runId
    const input: RunsMarkInput = { runId, kind: 'false-fail', note: 'interrupted' }
    await expect(createFeedbackPortForHost({ ...f.deps, word: async () => { throw new Error('model unavailable') } }).mark(input))
      .rejects.toThrow('model unavailable')
    const intentPath = join(f.runDir, 'mark-intent.json')
    const intent = JSON.parse(readFileSync(intentPath, 'utf8')) as { stage: string; mark: MarkReceipt }
    expect(intent.stage).toBe('evidence')
    expect(new FsMarkLedger({ root: f.agentQaRoot, runId }).read()).toEqual([])
    const before = tree(f.root)
    const intentBytes = readFileSync(intentPath)

    const reads = previewReadsFor(f)
    const previewed = consequencesOf(await rawPreview(reads, input))
    expect(previewed).toMatchObject({ latest: { kind: 'first' }, basis: { ledgerOrdinal: 0 },
      knowledge: { evidence: { confirmed: 1, overturned: 0 } } })
    expect(previewed.basis).not.toHaveProperty('priorMarkOrdinal')
    // The intent's id and time belong to the writer. Its evidence already landed, so the id appears only
    // as the served record's current trust token, read-time state, and the preview mints nothing else.
    expectNoMint(previewed, [intent.mark.markId])
    expect(previewed.knowledge.records[0]!.recordContent!.currentTrust.evidenceTokens).toContain(`mark:${intent.mark.markId}`)
    const { recordContent: _current, ...planned } = previewed.knowledge.records[0]!
    expect(JSON.stringify({ ...previewed, knowledge: { ...previewed.knowledge, records: [planned] } })).not.toContain(intent.mark.markId)
    expect(JSON.stringify(previewed)).not.toContain(String(intent.mark.markedAt))
    expect(readFileSync(intentPath)).toEqual(intentBytes)
    expect(tree(f.root)).toEqual(before)

    const resumed = await createFeedbackPortForHost(f.deps).mark(input)
    expect(resumed).toMatchObject({ kind: 'marked', receipt: { markId: intent.mark.markId, markedAt: intent.mark.markedAt, ordinal: 1,
      evidence: previewed.knowledge.evidence } })
    expect(existsSync(intentPath)).toBe(false)
  }, 120_000)

  it('BASIS-RACE: the basis is an observation; a mark landing after preview is re-evaluated by the unchanged writer', async () => {
    const f = fixture()
    const runId = f.handoff.runId
    const port = createFeedbackPortForHost(f.deps)
    const reads = previewReadsFor(f)
    const input: RunsMarkInput = { runId, kind: 'false-fail' }
    const stale = consequencesOf(await opPreview(reads, input))
    expect(stale).toMatchObject({ latest: { kind: 'first' }, basis: { ledgerOrdinal: 0 } })
    // The observed basis is not a token runs.mark accepts.
    expect(RunsMarkInputSchema.safeParse({ ...input, basis: stale.basis }).success).toBe(false)
    expect(RunsMarkInputSchema.safeParse({ ...input, priorMarkOrdinal: 0 }).success).toBe(false)

    const racing = await port.mark({ runId, kind: 'confirmed-bug' })
    if (racing.kind !== 'marked') throw new Error('expected the racing mark')
    const landed = await port.mark(input)
    expect(landed).toMatchObject({ kind: 'marked', receipt: { ordinal: 2, supersedes: racing.receipt.markId } })

    const fresh = await opPreview(reads, { runId, kind: 'confirmed-bug' })
    expect(fresh).toMatchObject({ kind: 'consequences', latest: { kind: 'supersedes', ordinal: 2 },
      basis: { ledgerOrdinal: 2, priorMarkOrdinal: 2 } })
    // A stale consequences preview never outranks the writer's identical-repeat rule.
    const repeatPreview = consequencesOf(await opPreview(reads, { runId, kind: 'confirmed-bug', note: 'raced' }))
    expect(repeatPreview.basis).toEqual({ ledgerOrdinal: 2, priorMarkOrdinal: 2 })
    expect(await port.mark({ runId, kind: 'confirmed-bug' })).toMatchObject({ kind: 'marked', receipt: { ordinal: 3 } })
    expect(await port.mark({ runId, kind: 'confirmed-bug', note: 'raced' })).toMatchObject({ kind: 'already-marked' })
    expect(await opPreview(reads, { runId, kind: 'confirmed-bug', note: 'raced' }))
      .toMatchObject({ kind: 'already-marked', prior: { ordinal: 3, kind: 'confirmed-bug', testIndex: 0 }, basis: { ledgerOrdinal: 3, priorMarkOrdinal: 3 } })
  }, 120_000)

  it('PREVIEW-CONTENT: served targets lead with joined content and their effects; typed absences keep ids and effects', async () => {
    const f = fixture()
    const runId = f.handoff.runId
    const reads = previewReadsFor(f)
    const before = tree(f.root)
    const raw = consequencesOf(await rawPreview(reads, { runId, kind: 'false-fail' }))
    const [shown] = showRecords({ knowledgeRoot: f.knowledgeRoot, recordIds: [f.published.id] })
    if (shown?.kind !== 'found') throw new Error('expected the served record to be shown')
    expect(raw.knowledge).toEqual({ servedRecordIds: [f.published.id], appendsEvidence: true,
      records: [{ recordId: f.published.id, recordContent: {
        content: shown.body, summary: shown.summary, kind: shown.record.kind,
        applicability: { product: shown.record.product, scope: shown.record.scope, anchors: shown.record.anchors,
          openedAtOrdinal: shown.record.openedAtOrdinal },
        currentStatus: shown.record.status,
        currentTrust: { confirmations: shown.record.confirmations, contradictions: shown.record.contradictions,
          evidenceTokens: shown.record.evidenceTokens, lastEventOrdinal: shown.record.lastEventOrdinal,
          ...(shown.record.trustNarrative ? { trustNarrative: shown.record.trustNarrative } : {}) } },
      served: true, evidence: { kind: 'effects', effects: [{ direction: 'confirm' }] } }],
      evidence: { confirmed: 1, overturned: 0 } })
    // Content leads the record: identity first, then the joined content, then its effects.
    expect(Object.keys(raw.knowledge.records[0]!)).toEqual(['recordId', 'recordContent', 'served', 'evidence'])
    expect(raw.knowledge.records[0]!.recordContent!.content).toContain(CONTENT_SECRET)
    expect(tree(f.root)).toEqual(before)

    // Joined content crosses the live mask; without a context it is fully redacted.
    const masking = createMaskingContext()
    masking.register(CONTENT_SECRET)
    setActiveMaskingContextResolver(() => masking)
    const masked = consequencesOf(await opPreview(reads, { runId, kind: 'false-fail' }))
    expect(masked.knowledge.records[0]!.recordContent).toMatchObject({ content: masking.mask(shown.body), summary: masking.mask(shown.summary) })
    expect(JSON.stringify(masked)).not.toContain(CONTENT_SECRET)
    setActiveMaskingContextResolver(() => undefined)
    const cold = consequencesOf(await opPreview(reads, { runId, kind: 'false-fail' }))
    expect(cold.knowledge.records[0]!.recordContent).toMatchObject({ content: maskedMarker('secret'), summary: maskedMarker('secret') })
    expect(cold.knowledge.records[0]).toMatchObject({ recordId: f.published.id, served: true, evidence: { kind: 'effects', effects: [{ direction: 'confirm' }] } })

    // A reader with no batch join keeps the record id and its effect under a named absence.
    const unbatched = { ...createKnowledgeReader(() => f.knowledgeRoot), showRecords: undefined }
    const unjoined = consequencesOf(await rawPreview(previewReadsFor(f, { reader: unbatched }), { runId, kind: 'false-fail' }))
    expect(unjoined.knowledge.records).toEqual([{ recordId: f.published.id, contentAbsence: { reason: 'not-bound' }, served: true,
      evidence: { kind: 'effects', effects: [{ direction: 'confirm' }] } }])
    expect(tree(f.root)).toEqual(before)

    const written = await createFeedbackPortForHost(f.deps).mark({ runId, kind: 'false-fail' })
    expect(written).toMatchObject({ kind: 'marked', receipt: { evidence: raw.knowledge.evidence } })
  }, 120_000)

  it('CORRELATED-EVIDENCE: false-pass keeps both directions on a served record and overturns correlated unserved records', async () => {
    const f = fixture()
    const runId = f.handoff.runId
    const unserved = createPromotionFloorFixture({ knowledgeRoot: f.knowledgeRoot, auditBaseDir: f.agentQaRoot }).publishHeldCandidate('unserved').published
    const unrelated = createPromotionFloorFixture({ knowledgeRoot: f.knowledgeRoot, auditBaseDir: f.agentQaRoot }).publishHeldCandidate('unrelated').published
    const lease = LOCAL_CURATION_CAPABILITIES.maintenance.acquireWriterLease(f.knowledgeRoot)
    if (lease.kind !== 'acquired') throw new Error('fixture must hold writer authority')
    const helpful = (recordId: string, observationId: string, token: string) => expect(appendOutcomeEvent({ knowledgeRoot: f.knowledgeRoot,
      productKey: 'storefront', auditBaseDir: f.agentQaRoot, commitArtifacts: 'none', writerLeaseId: lease.leaseId, writerEpoch: lease.epoch },
    asRecordId(recordId), { type: 'helpful', evidenceToken: asEvidenceToken(token), curationJobId: `canary-${token}`, buildOrdinal: 43, observationId }).kind).toBe('appended')
    // The deterministic emitter's persisted observation address for this run's step.
    helpful(f.published.id, `${runId}:test-0:step-0`, 'served-positive')
    helpful(unserved.id, `${runId}:test-0:step-0`, 'unserved-positive')
    helpful(unrelated.id, 'another-run:test-0:step-0', 'unrelated-positive')
    expect(LOCAL_CURATION_CAPABILITIES.maintenance.releaseLease({ knowledgeRoot: f.knowledgeRoot, leaseId: lease.leaseId }).kind).toBe('released')

    const reads = previewReadsFor(f)
    const before = tree(f.root)
    const previewed = consequencesOf(await rawPreview(reads, { runId, kind: 'false-pass' }))
    expect(tree(f.root)).toEqual(before)
    expect(previewed.knowledge.records.map(record => [record.recordId, record.served, record.evidence])).toEqual([
      [f.published.id, true, { kind: 'effects', effects: [{ direction: 'confirm' },
        { direction: 'overturn', overturnsEvidenceToken: 'served-positive', overturnsCurationJobId: 'canary-served-positive' }] }],
      [unserved.id, false, { kind: 'effects', effects: [
        { direction: 'overturn', overturnsEvidenceToken: 'unserved-positive', overturnsCurationJobId: 'canary-unserved-positive' }] }],
    ])
    expect(previewed.knowledge.servedRecordIds).toEqual([f.published.id])
    // Correlated records carry joined content too; the unrelated positive is never reached.
    expect(previewed.knowledge.records[1]!.recordContent?.summary).toContain('unserved')
    expect(JSON.stringify(previewed)).not.toContain(unrelated.id)
    expect(previewed.knowledge.evidence).toEqual({ confirmed: 1, overturned: 2 })

    const written = await createFeedbackPortForHost(f.deps).mark({ runId, kind: 'false-pass' })
    expect(written).toMatchObject({ kind: 'marked', receipt: { evidence: { confirmed: 1, overturned: 2 } } })
  }, 120_000)

  it('FALSE-PASS-TWO-LABELS: false-pass previews the two labels the freeze lands, with no gold id, receipt or time', async () => {
    const f = fixture()
    const runId = f.handoff.runId
    const reads = previewReadsFor(f)
    const before = tree(f.root)
    const previewed = consequencesOf(await opPreview(reads, { runId, kind: 'false-pass' }))
    expect(tree(f.root)).toEqual(before)
    expectNoMint(previewed)
    expect(RunsMarkPreviewResultSchema.parse(previewed)).toEqual(previewed)
    expect(previewed).toMatchObject({ prospective: true, markKind: 'false-pass', member: { testIndex: 0, testId: f.handoff.tests[0]!.testId },
      resolvedStep: { stepIndex: 0, reason: 'passing-verdict' }, markedDecisionCount: 1 })
    expect(previewed.labels.map(label => [label.channel, label.correction])).toEqual([
      ['user-mark', { verdict: 'fail' }], ['overturned-verdict', { verdict: 'fail' }]])
    const written = await createFeedbackPortForHost(f.deps).mark({ runId, kind: 'false-pass' })
    if (written.kind !== 'marked') throw new Error('expected the false-pass mark')
    expect(written.receipt.gold).toHaveLength(2)
    expect(previewed.labels.map(label => [label.channel, label.sourceCassetteId]))
      .toEqual(written.receipt.gold.map(item => [item.channel, item.sourceCassetteId]))
  }, 120_000)
})

// 2026-09-15, 423 D-16/D-18: runs.mark.preview registered and bound on every CLI host composition.
// Plan 423-21 projects it to MCP as agent_qa_preview_run_mark; fn reaches it now, with no model.
const PREVIEW = 'runs.mark.preview'

describe('423-19 runs.mark.preview registration and composed invocation (D-16)', () => {
  const roots: string[] = []
  const closers: Array<() => void | Promise<void>> = []
  let template: MarkedTemplate

  beforeAll(async () => { template = await markedTemplate(roots) }, 180_000)
  afterEach(async () => {
    process.exitCode = 0
    setActiveMaskingContextResolver(() => undefined)
    for (const close of closers.splice(0).reverse()) await close()
  })
  afterAll(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

  function coldScene() {
    const root = mkdtempSync(join(tmpdir(), '423-19-binding-')); roots.push(root)
    cpSync(template.root, root, { recursive: true })
    writeFileSync(join(root, '.env.secrets.local'), `HISTORY_SYNTHETIC_TOKEN=${SECRET}\n`)
    const agentQaRoot = join(root, '.agent-qa')
    return { root, configPath: join(root, 'agent-qa.config.yaml'), agentQaRoot,
      stores: [join(agentQaRoot, 'runs'), join(agentQaRoot, 'proposals'), join(agentQaRoot, 'eval'), join(root, 'agent-qa-knowledge'), join(root, 'agent-qa-eval')] }
  }
  const storeMaps = (stores: readonly string[]) => stores.map(tree)
  // The run-level address's latest mark is the confirmed-bug at ordinal 2, so a false-pass supersedes it.
  const input = (): RunsMarkInput => ({ runId: template.runId, kind: 'false-pass', note: `preview ${SECRET}` })

  /** A cold host holds no masking authority for this read, so the op's no-context mask fully redacts free text. */
  async function expectedColdPreview(s: ReturnType<typeof coldScene>) {
    const reads = createFeedbackReadsPortForHost({ agentQaRoot: s.agentQaRoot, configPath: s.configPath })
    expect(typeof reads.preview, 'gates/feedback-read-host must expose preview').toBe('function')
    return await runsMarkPreviewSpec.invoke(input(), { feedbackReads: reads } as never) as RunsMarkPreviewResult
  }

  function expectColdMaskedPreview(value: unknown) {
    const result = consequencesOf(RunsMarkPreviewResultSchema.parse(value))
    const [, second] = template.receipts as [MarkReceipt, MarkReceipt, MarkReceipt]
    expect(result).toMatchObject({ runId: template.runId, prospective: true, markKind: 'false-pass', member: { testIndex: 0 },
      resolvedStep: { stepIndex: 0, reason: 'passing-verdict' }, latest: { kind: 'supersedes', markId: second.markId, ordinal: 2 },
      basis: { ledgerOrdinal: 3, priorMarkOrdinal: 2 } })
    expect(result.labels.map(label => label.channel)).toEqual(['user-mark', 'overturned-verdict'])
    expect(result.groundTruth[0]!.recordedVerdict.reasoning).toBe(maskedMarker('secret'))
    expect(result.knowledge.records[0]).toMatchObject({ served: true, recordContent: { content: maskedMarker('secret'), summary: maskedMarker('secret') } })
    expect(JSON.stringify(result)).not.toContain(SECRET)
    expectNoMint(result, template.receipts.map(receipt => receipt.markId))
    return result
  }

  it('PREVIEW-REGISTRY-BINDING: the cold CLI host binds preview through the read host; history-only or writer-only bindings stay unbound', async () => {
    expect(Reflect.get(agent, 'RUNS_MARK_PREVIEW_FUNCTION_ID')).toBe(PREVIEW)
    expect(Reflect.get(agent, 'runsMarkPreviewSpec')).toBeUndefined()

    const s = coldScene()
    const composed = host.composeCliLocalAgent({ configPath: s.configPath, agentQaRoot: s.agentQaRoot, confirm: undefined,
      resolveExecutionContext: () => 'local-headless' })
    closers.push(() => composed.close())
    expect(composed.registry.list(host.CLI_FUNCTION_CALLER).find(entry => entry.id === PREVIEW)).toMatchObject({
      bindingStatus: 'bound', requiredScopes: ['read'], resultKind: 'unary', risk: { readOnly: true } })
    // runs.mark keeps its own tier and binding beside the read.
    expect(composed.registry.list(host.CLI_FUNCTION_CALLER).find(entry => entry.id === 'runs.mark'))
      .toMatchObject({ bindingStatus: 'bound', requiredScopes: ['knowledge-write'] })
    const before = storeMaps(s.stores)
    const expected = await expectedColdPreview(s)
    const composedResult = await agent.invokeFunction(composed.registry, PREVIEW, input(), host.CLI_FUNCTION_CALLER)
    expect(composedResult).toEqual(expected)
    expectColdMaskedPreview(composedResult)
    expect(storeMaps(s.stores)).toEqual(before)
    expect(existsSync(join(s.agentQaRoot, 'runs', template.runSlug, 'mark-intent.json'))).toBe(false)
    // The exact input is still refused before the port: a preview basis is not an input field.
    await expect(agent.invokeFunction(composed.registry, PREVIEW, { ...input(), basis: { ledgerOrdinal: 3 } }, host.CLI_FUNCTION_CALLER)).rejects.toThrow()

    const historyOnly = agent.createFunctionRegistry({ auditSink: auditless, resolveExecutionContext: () => 'local-headless',
      deps: { feedbackReads: createFeedbackReadsPortForHost({ agentQaRoot: s.agentQaRoot }) } as never })
    await expect(agent.invokeFunction(historyOnly, PREVIEW, input(), host.CLI_FUNCTION_CALLER)).rejects.toBeInstanceOf(agent.FunctionNotBoundError)
    const writerOnly = agent.createFunctionRegistry({ auditSink: auditless, resolveExecutionContext: () => 'local-headless',
      deps: { feedback: { mark: refuse('feedback.mark'), marksFor: refuse('feedback.marksFor') } } as never })
    expect(writerOnly.list(host.CLI_FUNCTION_CALLER).find(entry => entry.id === PREVIEW)?.bindingStatus).toBe('unbound')
    await expect(agent.invokeFunction(writerOnly, PREVIEW, input(), host.CLI_FUNCTION_CALLER)).rejects.toBeInstanceOf(agent.FunctionNotBoundError)
    expect(storeMaps(s.stores)).toEqual(before)
  }, 180_000)

  it('PREVIEW-FN-PARITY: agent-qa fn, the CLI registry and the dashboard door return one masked preview with unchanged stores', async () => {
    const s = coldScene()
    const before = storeMaps(s.stores)

    const stdout: string[] = []
    const stderr: string[] = []
    const log = vi.spyOn(console, 'log').mockImplementation((...values: unknown[]) => { stdout.push(values.map(String).join(' ')) })
    const errors = vi.spyOn(console, 'error').mockImplementation((...values: unknown[]) => { stderr.push(values.map(String).join(' ')) })
    process.exitCode = undefined
    try {
      await new Command().exitOverride().option('--config <path>').addCommand(createFnCommand())
        .parseAsync(['--config', s.configPath, 'fn', PREVIEW, '--input', JSON.stringify(input()), '--json'], { from: 'user' })
    } finally { log.mockRestore(); errors.mockRestore() }
    expect(stderr).toEqual([])
    expect(process.exitCode).toBeUndefined()
    const viaFn = expectColdMaskedPreview(JSON.parse(stdout.join('\n')))

    const composed = host.composeCliLocalAgent({ configPath: s.configPath, agentQaRoot: s.agentQaRoot, confirm: undefined,
      resolveExecutionContext: () => 'local-headless' })
    closers.push(() => composed.close())
    const viaRegistry = expectColdMaskedPreview(await agent.invokeFunction(composed.registry, PREVIEW, input(), host.CLI_FUNCTION_CALLER))

    const door = composeDashboardDoor({ configPath: s.configPath, agentQaRoot: s.agentQaRoot, boundOrigin: () => undefined,
      confirms: createConfirmRegistry({ timeoutMs: 1_000 }) })
    closers.push(() => door.host.close())
    expect(door.host.registry.list(DASHBOARD_FUNCTION_CALLER).find(entry => entry.id === PREVIEW)?.bindingStatus).toBe('bound')
    const viaDashboard = expectColdMaskedPreview(await agent.invokeFunction(door.host.registry, PREVIEW, input(), DASHBOARD_FUNCTION_CALLER))

    expect(viaFn).toEqual(viaRegistry)
    expect(viaDashboard).toEqual(viaRegistry)
    expect(viaRegistry).toEqual(await expectedColdPreview(s))
    expect(storeMaps(s.stores)).toEqual(before)

    // The writer still lands what the preview promised, through its own unchanged transaction.
    const marked = await createFeedbackPortForHost({ configPath: s.configPath, agentQaRoot: s.agentQaRoot, randomUuid: () => '00000000-0000-4000-8000-00000000abcd' })
      .mark(input())
    expect(marked).toMatchObject({ kind: 'marked', receipt: { ordinal: 4, supersedes: template.receipts[1]!.markId,
      evidence: viaRegistry.knowledge.evidence, gold: viaRegistry.labels.map(label => ({ channel: label.channel, sourceCassetteId: label.sourceCassetteId })) } })
  }, 180_000)
})

// 2026-09-15, 423-21 D-18: both feedback reads over the shipped dashboard door's two HTTP boundaries,
// against the same real ledger, proposals store and preview inputs the fn parity cells use.
describe('423-21 feedback reads over both HTTP doors (D-18)', () => {
  const roots: string[] = []
  const closers: Array<() => void | Promise<void>> = []
  let template: MarkedTemplate

  beforeAll(async () => { template = await markedTemplate(roots) }, 180_000)
  afterEach(async () => {
    setActiveMaskingContextResolver(() => undefined)
    for (const close of closers.splice(0).reverse()) await close()
  })
  afterAll(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

  async function httpScene() {
    const root = mkdtempSync(join(tmpdir(), '423-21-http-')); roots.push(root)
    cpSync(template.root, root, { recursive: true })
    writeFileSync(join(root, '.env.secrets.local'), `HISTORY_SYNTHETIC_TOKEN=${SECRET}\n`)
    const agentQaRoot = join(root, '.agent-qa')
    const configPath = join(root, 'agent-qa.config.yaml')
    const door = composeDashboardDoor({ configPath, agentQaRoot, boundOrigin: () => undefined,
      confirms: createConfirmRegistry({ timeoutMs: 1_000 }) })
    closers.push(() => door.host.close())
    const db = new DashboardDatabase({ dbPath: ':memory:' })
    closers.push(() => db.close())
    const started = await startServer({ db, port: 0, agentHost: door.agentHost })
    closers.push(() => started.close())
    const remote: Server = createServer(createRunServiceRoutes({ agentHost: door.agentHost,
      verifyBearer: header => matchServiceBearer(header, [{ name: 'test', tokenEnvVar: 'AGENT_QA_TEST_TOKEN',
        value: 'synthetic-423-21-client', trustScope: { project: 'test' } }]),
    } as RunServicePorts))
    await new Promise<void>(resolve => remote.listen(0, '127.0.0.1', resolve))
    closers.push(() => new Promise<void>(resolve => remote.close(() => resolve())))
    const port = (server: { address(): unknown }) => (server.address() as { port: number }).port
    return { root, agentQaRoot, configPath, door,
      stores: [join(agentQaRoot, 'runs'), join(agentQaRoot, 'proposals'), join(agentQaRoot, 'eval'), join(root, 'agent-qa-knowledge'), join(root, 'agent-qa-eval')],
      doors: [
        { name: 'local-human', base: `http://127.0.0.1:${port(started.server)}/api/runs`, headers: {} as Record<string, string> },
        { name: 'remote-machine', base: `http://127.0.0.1:${port(remote)}/run`, headers: { Authorization: 'Bearer synthetic-423-21-client' } },
      ] }
  }
  const storeMaps = (stores: readonly string[]) => stores.map(tree)
  const previewBody = (): RunsMarkInput => ({ runId: template.runId, kind: 'false-pass', note: `preview ${SECRET}` })
  const post = (url: string, body: unknown, headers: Record<string, string>) =>
    fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })

  it('HTTP-MARKS-HISTORY: GET marks on both doors equals the registry and fn result over the real ledger', async () => {
    const s = await httpScene()
    const before = storeMaps(s.stores)
    const viaRegistry = await agent.invokeFunction(s.door.host.registry, HISTORY, { runId: template.runId }, DASHBOARD_FUNCTION_CALLER)
    const viaOp = await historyOf(createFeedbackReadsPortForHost({ agentQaRoot: s.agentQaRoot }), template.runId)
    expect(viaRegistry).toEqual(viaOp)
    const entries = historyEntries(RunsMarksHistoryResultSchema.parse(viaRegistry))
    expect(entries.map(entry => [entry.ordinal, entry.active, entry.proposal?.state ?? null]))
      .toEqual([[1, false, 'rejected'], [2, true, null], [3, true, 'pending']])
    for (const door of s.doors) {
      const response = await fetch(`${door.base}/${template.runId}/marks`, { headers: door.headers })
      expect(response.status, door.name).toBe(200)
      const raw = await response.text()
      expect(JSON.parse(raw), door.name).toEqual(viaRegistry)
      expect(raw, door.name).not.toContain(SECRET)
    }
    expect(storeMaps(s.stores)).toEqual(before)
  }, 180_000)

  it('HTTP-MARK-PREVIEW: POST mark-preview on both doors equals the registry preview over the real stores', async () => {
    const s = await httpScene()
    const before = storeMaps(s.stores)
    const viaRegistry = await agent.invokeFunction(s.door.host.registry, PREVIEW, previewBody(), DASHBOARD_FUNCTION_CALLER)
    const viaOp = await runsMarkPreviewSpec.invoke(previewBody(), { feedbackReads: createFeedbackReadsPortForHost({
      agentQaRoot: s.agentQaRoot, configPath: s.configPath }) } as never)
    expect(viaRegistry).toEqual(viaOp)
    const [, second] = template.receipts as [MarkReceipt, MarkReceipt, MarkReceipt]
    expect(consequencesOf(RunsMarkPreviewResultSchema.parse(viaRegistry))).toMatchObject({ prospective: true, markKind: 'false-pass',
      latest: { kind: 'supersedes', markId: second.markId, ordinal: 2 }, basis: { ledgerOrdinal: 3, priorMarkOrdinal: 2 } })
    for (const door of s.doors) {
      const response = await post(`${door.base}/${template.runId}/mark-preview`, previewBody(), door.headers)
      expect(response.status, door.name).toBe(200)
      const raw = await response.text()
      expect(JSON.parse(raw), door.name).toEqual(viaRegistry)
      expect(raw, door.name).not.toContain(SECRET)
      const refused = await post(`${door.base}/${template.runId}/mark-preview`, { ...previewBody(), runId: asRunId(generateRunId()) }, door.headers)
      expect(refused.status, door.name).toBe(400)
      expect(await refused.json()).toEqual({ error: 'run_id_mismatch' })
    }
    expect(storeMaps(s.stores)).toEqual(before)
  }, 180_000)

  // Measured 2026-09-15 and pinned for the open owner decision: runs.marks.history and runs.mark.preview are
  // outside compose-local-agent's cold read-scope allowlist. A cold host fully redacts their free text,
  // so the human door has nothing to restore. With a masking context active, only the declared secret
  // span is masked; the door restores no placeholder it has no run sidecar for and shows a chip.
  it('HTTP-FEEDBACK-HUMAN-POSTURE: the local human door shows cold full redaction, and warm plain text with secret chips', async () => {
    const s = await httpScene()
    const [human, machine] = s.doors as [typeof s.doors[0], typeof s.doors[1]]
    const read = async (door: typeof human) => {
      const history = RunsMarksHistoryResultSchema.parse(await (await fetch(`${door.base}/${template.runId}/marks`, { headers: door.headers })).json())
      const preview = consequencesOf(RunsMarkPreviewResultSchema.parse(
        await (await post(`${door.base}/${template.runId}/mark-preview`, previewBody(), door.headers)).json()))
      return { notes: historyEntries(history).map(entry => entry.note ?? null),
        reasoning: preview.groundTruth.map(item => item.recordedVerdict.reasoning),
        content: preview.knowledge.records.map(record => record.recordContent?.content ?? null) }
    }
    const redacted = maskedMarker('secret')
    const cold = { notes: [redacted, null, redacted], reasoning: [redacted], content: [redacted] }
    expect(await read(human)).toEqual(cold)
    expect(await read(machine)).toEqual(cold)

    const masking = createMaskingContext()
    masking.register(SECRET)
    setActiveMaskingContextResolver(() => masking)
    const warmHuman = await read(human)
    expect(warmHuman.notes).toEqual(['first run-level note', null, `step note ${redacted}`])
    expect(warmHuman.reasoning).toEqual(['The recorded state advanced'])
    expect(warmHuman.content).toEqual(['The Held checkout marked button was resolved and verified.'])
    // The bearer door keeps the recorded placeholder instead of a display chip.
    const warmMachine = await read(machine)
    expect(warmMachine.notes).toEqual(['first run-level note', null, masking.mask(`step note ${SECRET}`)])
    expect(JSON.stringify([warmHuman, warmMachine])).not.toContain(SECRET)
  }, 180_000)

  it('FEEDBACK-HTTP-WRITES-NOTHING: HTTP history and preview leave every store byte-identical and create nothing', async () => {
    const s = await httpScene()
    const runDir = join(s.agentQaRoot, 'runs', template.runSlug)
    // A claimed proposal is exactly what a reaping listing would rename.
    const [, , third] = template.receipts as [MarkReceipt, MarkReceipt, MarkReceipt]
    expect(claimPendingProposal(s.agentQaRoot, proposalIdOf(third))).toMatchObject({ kind: 'consumed' })
    const before = storeMaps(s.stores)
    const unknown = asRunId(generateRunId())
    for (const door of s.doors) {
      for (let repeat = 0; repeat < 2; repeat += 1) {
        expect((await fetch(`${door.base}/${template.runId}/marks`, { headers: door.headers })).status).toBe(200)
        expect((await post(`${door.base}/${template.runId}/mark-preview`, previewBody(), door.headers)).status).toBe(200)
      }
      expect(await (await fetch(`${door.base}/${unknown}/marks`, { headers: door.headers })).json()).toEqual({ kind: 'run-not-found', runId: unknown })
      expect(await (await post(`${door.base}/${unknown}/mark-preview`, { ...previewBody(), runId: unknown }, door.headers)).json())
        .toEqual({ kind: 'run-not-found', runId: unknown })
    }
    expect(storeMaps(s.stores)).toEqual(before)
    expect(existsSync(join(runDir, 'mark-intent.json'))).toBe(false)
  }, 180_000)
})

// 2026-09-15, 423-21 D-04/D-18: the three new read ops, adjudicated against the one registry by the
// conformance tables every surface leg reads: input contract, scenario row, MCP ruling, doc
// adjudication, authed remote route binding and read policy points.
describe('423-21 read-op adjudication (D-04/D-18)', () => {
  const NEW_READS = ['runs.evidence', 'runs.marks.history', 'runs.mark.preview'] as const
  const declarationOf = (opId: string) => {
    const declaration = registryDeclarations().find(entry => entry.id === opId)
    if (declaration === undefined) throw new Error(`${opId} is not registered`)
    return declaration
  }

  it('OP-INPUT-PARTITION: each new read pairs its own input singleton, once, and the table keys equal the registry', () => {
    const contracts = OP_INPUT_CONTRACTS as Record<string, unknown>
    expect(contracts['runs.evidence']).toBe(RunsEvidenceInputSchema)
    expect(contracts['runs.marks.history']).toBe(RunsMarksHistoryInputSchema)
    // The preview is runs.mark's exact input: one schema object serves both ops.
    expect(contracts['runs.mark.preview']).toBe(RunsMarkInputSchema)
    expect(contracts['runs.mark']).toBe(RunsMarkInputSchema)
    for (const opId of ['runs.marks.history', 'runs.mark.preview'] as const) {
      expect(AGENT_QA_OP_CONTRACTS[opId]?.input, opId).toBe(contracts[opId])
    }
    expect(AGENT_QA_OP_CONTRACTS['runs.evidence']).toBeUndefined()
    const registryIds = registryDeclarations().map(entry => entry.id)
    expect(registryIds).toHaveLength(51)
    expect(censusDiff(registryIds, Object.keys(contracts))).toEqual({ missing: [], stray: [] })
  })

  it('OP-REGISTRY-SCENARIO: one scenario row, one MCP ruling, one doc adjudication and one remote route per new read', () => {
    expect(censusDiff(registryDeclarations().map(entry => entry.id), scenarioTableOpIds())).toEqual({ missing: [], stray: [] })
    const tools: Record<string, unknown> = {
      'runs.evidence': { unprojected: 'not-mid-flight-read' },
      'runs.marks.history': { reachable: { tool: 'agent_qa_get_run_marks' } },
      'runs.mark.preview': { reachable: { tool: 'agent_qa_preview_run_mark' } },
    }
    const routes: Record<string, string> = {
      'runs.evidence': 'GET /run/:runId/evidence',
      'runs.marks.history': 'GET /run/:runId/marks',
      'runs.mark.preview': 'POST /run/:runId/mark-preview',
    }
    for (const opId of NEW_READS) {
      const rows = scenarioTableOpIds().filter(id => id === opId)
      expect(rows, opId).toHaveLength(1)
      const row = scenarioRowFor(opId)!
      const contract = (OP_INPUT_CONTRACTS as Record<string, { safeParse(value: unknown): { success: boolean } }>)[opId]!
      expect(contract.safeParse(row.input).success, `${opId} scenario input`).toBe(true)
      expect(row.perSurface).toEqual({ chat: { reachable: true }, mcp: tools[opId], fn: { reachable: true } })
      // Markers are the op's required first-arm output fields, derived by the table's one rule.
      const output = declarationOf(opId).output as { oneOf?: Array<{ required?: string[] }>; anyOf?: Array<{ required?: string[] }>; required?: string[] }
      const first = output.oneOf?.[0] ?? output.anyOf?.[0] ?? output
      expect([...row.renderExpect.markers].sort(), `${opId} markers`).toEqual([...(first.required ?? [])].sort())
      expect(() => catalogDocFieldsOf(opId), `${opId} doc adjudication`).not.toThrow()
      expect(RUN_SERVICE_ROUTE_BINDINGS.filter(binding => 'opId' in binding && binding.opId === opId).map(binding => binding.key), opId)
        .toEqual([routes[opId]])
    }
    const ruled = UNPROJECTED_OPS.filter(entry => entry.opId === 'runs.evidence')
    expect(ruled).toHaveLength(1)
    expect(unprojectedReasonKeyOf(ruled[0]!.reason)).toBe('not-mid-flight-read')
    // The widened completed-run reads keep the same one-rule marker sets over the 51-op registry.
    for (const opId of ['runs.detail', 'runs.postprocessing', 'runs.knowledge'] as const) {
      const output = declarationOf(opId).output as { oneOf?: Array<{ required?: string[] }>; anyOf?: Array<{ required?: string[] }>; required?: string[] }
      const first = output.oneOf?.[0] ?? output.anyOf?.[0] ?? output
      expect([...scenarioRowFor(opId)!.renderExpect.markers].sort(), `${opId} markers`).toEqual([...(first.required ?? [])].sort())
    }
  })

  it('READ-POLICY-POINTS: the new reads carry read policy points and read-tier declarations; runs.mark keeps its ask', () => {
    const readPoints = scenarioRowFor('runs.postprocessing')!.policyPoints
    expect(readPoints).toEqual({ grant: 'allow', refuse: 'deny' })
    for (const opId of NEW_READS) {
      expect(scenarioRowFor(opId)?.policyPoints, opId).toEqual(readPoints)
      const declaration = declarationOf(opId)
      expect(declaration.requiredScopes, opId).toEqual(['read'])
      expect(declaration.risk, opId).toMatchObject({ readOnly: true })
      expect(declaration.requiresHumanOrigin, opId).not.toBe(true)
    }
    expect(scenarioRowFor('runs.mark')?.policyPoints).toEqual({ grant: 'allow', refuse: 'deny', ask: 'ask' })
    expect(declarationOf('runs.mark').requiredScopes).toEqual(['knowledge-write'])
  })
})
