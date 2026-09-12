// 422-20-T1 at the READER — where the bait population comes from, and what it must never join.
//
// The judge-calibration reader admits ONE population as independent gold: marked, held-out,
// private committed entries with a saved replay behind them. An adversarial entry is structurally
// not one of those, so bait cannot reach the calibration denominators. That is a property of the
// selection rule, and this file measures it rather than trusting it: the same read that produces
// the gold also produces the committed adversarial population, and the two are asserted to be
// disjoint on the wire.
//
// The second law here is 422-19's, held at one more boundary: a reader that could not OPEN the
// committed corpus reports `unavailable`, never an empty adversarial population. Zero bait and
// unreadable bait are different facts, and only one of them is good news.
//
// The third is the capability law. 422-05 lets ANY eligible credentialed family-disjoint singleton
// AUTHOR probes; a judge PANEL still requires two declared members. An author-capable host must
// not be able to read its own authorship as evidence that panel calibration can run.
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import * as core from '@vostride/agent-qa-eval'
import { committedCorpusPath, FsCommittedRootStore } from '../committed-root-store.js'
import { loadJudgeCalibrationEvidence } from '../judge-calibration-evidence-source.js'
import { runJudgeCalibration, runJudgePanelCalibration } from '../judge-calibration-composition.js'
import { writeCommittedFloorFixture } from './fixtures/floor-fixtures.js'

const roots: string[] = []
afterEach(() => { for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true }) })

const PANEL = core.createPanelIdentity(['claude-sonnet-4-5', 'gemini-2.5-pro'])
const memberModelIds = PANEL.members!.map(member => member.judgeModelId)

const probeGenerator = (kind: core.ProbeGeneratorKind, id: string, family: string, seed: string): core.CorpusGenerator => ({
  kind, seedCassetteId: seed, generatorVersion: core.ADVERSARIAL_GENERATOR_VERSION,
  authoringModel: { id, family }, promptVersion: core.ADVERSARIAL_PROMPT_VERSION,
})

/** A committed root whose adversarial arm holds one self-authored judge bait and one table draw. */
function fixture(options: { bait?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'judge-bait-')); roots.push(root)
  const corpus = writeCommittedFloorFixture(root)
  const agentQaRoot = join(root, '.agent-qa')
  const seed = corpus.selected[0]!.cassette
  if (seed.granularity !== 'leaf') throw new Error('expected a fixture leaf')
  const store = new FsCommittedRootStore({ committedRoot: corpus.committedRoot })
  const written: string[] = []
  const add = (generator: core.CorpusGenerator, suffix: string) => {
    const entry = { ...core.projectCorpusEntry({ cassette: seed, product: 'alpha',
      runId: seed.runId, assignment: { split: 'adversarial', generator } }),
      cassetteId: `${seed.id}--${suffix}` }
    store.writeText(committedCorpusPath('alpha', entry.cassetteId), core.committedFileText(entry))
    written.push(entry.cassetteId)
    return entry.cassetteId
  }
  const table = add({ kind: 'fuzz-label', seedCassetteId: seed.id,
    generatorVersion: core.ADVERSARIAL_GENERATOR_VERSION, mutator: 'confusable',
    tableVersion: core.ADVERSARIAL_TABLE_VERSION, tableHash: core.ADVERSARIAL_TABLE_HASH }, 'table')
  const bait = options.bait === false ? undefined
    : add(probeGenerator('judge-targeted', memberModelIds[0]!, 'claude', seed.id), 'bait')
  const outsider = options.bait === false ? undefined
    : add(probeGenerator('optimized-trigger', 'outside-author', 'mistral', seed.id), 'outsider')
  const input = { committedRoot: corpus.committedRoot, agentQaRoot,
    profile: { plannerModelId: 'gpt-5', fingerprint: 'a'.repeat(64), matcherVersion: 1,
      judgeModelId: PANEL.judgeModelId, judgeVersion: PANEL.judgeVersion } }
  return { root, corpus, input, table, bait, outsider, written }
}

it('reads committed judge-targeted bait beside the table arm and admits none of it as gold', () => {
  const f = fixture()
  const read = loadJudgeCalibrationEvidence(f.input)
  expect(read.skippedCounts).toEqual({})
  expect(read.adversarialMembers?.map(member => member.cassetteId).sort())
    .toEqual([...f.written].sort())
  // The independent-gold population is disjoint from the bait, on the wire and not by assertion.
  const gold = [...read.evidence.map(row => row.goldCassetteId), ...read.selectedInputs.map(row => row.goldCassetteId)]
  expect(gold.filter(id => f.written.includes(id))).toEqual([])

  const disclosure = core.projectJudgeTargetedCalibration({ members: read.adversarialMembers,
    memberModelIds, observedCassetteIds: gold })
  expect(disclosure.source).toBe('resolved')
  if (disclosure.source !== 'resolved') throw new Error('unreachable')
  expect(disclosure).toMatchObject({ basis: 'raw', total: 3, metadataUnavailable: 0,
    judgeTargeted: 1, selfAuthored: 1, observedInCalibration: 0 })
  expect(disclosure.byProvenance).toMatchObject({ table: 1, probe: 2, absent: 0, malformed: 0 })
  expect(disclosure.byAuthoringModel).toEqual([
    { authoringModel: memberModelIds[0], authoringFamily: 'claude', panelMember: true,
      probeAuthored: 1, judgeTargeted: 1 },
    { authoringModel: 'outside-author', authoringFamily: 'mistral', panelMember: false,
      probeAuthored: 1, judgeTargeted: 0 },
  ])
})

it('reports a committed root with no adversarial member as a measured zero, not as unavailable', () => {
  const f = fixture({ bait: false })
  const read = loadJudgeCalibrationEvidence({ ...f.input, committedRoot: f.corpus.committedRoot })
  expect(read.adversarialMembers).toBeDefined()
  expect(core.projectJudgeTargetedCalibration({ members: read.adversarialMembers, memberModelIds }))
    .toMatchObject({ source: 'resolved', judgeTargeted: 0, selfAuthored: 0 })
})

it('says unavailable rather than clean when the committed corpus could not be opened', () => {
  const f = fixture()
  symlinkSync(f.root, join(f.corpus.committedRoot, 'escape-link'))
  const read = loadJudgeCalibrationEvidence(f.input)
  expect(read.skippedCounts).toMatchObject({ 'path-refused': 1 })
  expect(read.adversarialMembers).toBeUndefined()
  expect(core.projectJudgeTargetedCalibration({ members: read.adversarialMembers,
    memberModelIds, unavailable: 'corpus-unreadable' }))
    .toEqual({ basis: 'raw', source: 'unavailable', reason: 'corpus-unreadable' })
})

it('keeps a probe-author-capable singleton from bypassing the panel capability requirement', async () => {
  const f = fixture()
  const singleton = { profile: { provider: 'openai-compatible' as const, model: memberModelIds[0]!,
    baseURL: 'http://127.0.0.1:1/v1', auth: { mode: 'none' as const } },
    auth: { kind: 'none' as const } }
  // That same model authored the committed judge bait above: authorship is a capability the
  // corpus records, and it buys exactly nothing on the panel path.
  const read = loadJudgeCalibrationEvidence(f.input)
  expect(read.adversarialMembers?.some(member => member.generator?.authoringModel?.id === memberModelIds[0]))
    .toBe(true)
  await expect(runJudgePanelCalibration({ ...f.input, replayProfile: { provider: 'openai-compatible',
    model: 'gpt-5', auth: { mode: 'none' } }, members: [singleton] })).rejects.toThrow()

  const gap = await runJudgeCalibration({ kind: 'capability-gap', reason: 'single-family-host',
    minN: core.resolveJudgeCalibrationMinimum() })
  expect(gap).toMatchObject({ status: 'capability-gap', reason: 'single-family-host', n: 0,
    artifactDisposition: 'not-created' })
  // The gap path reads no corpus, so it must not publish a clean zero it never measured.
  expect(gap).toMatchObject({ judgeTargeted: { basis: 'raw', source: 'unavailable', reason: 'not-read' } })
})
