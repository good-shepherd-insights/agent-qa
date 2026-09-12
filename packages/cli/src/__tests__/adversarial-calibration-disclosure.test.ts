// 422-20-T2 at the OPERATOR's eye — the four states a reader must be able to tell apart.
//
// The disclosure only does its job if a person reading `eval calibrate --judge-panel` can see the
// difference between these, and none of them is allowed to look like another:
//
//   1. NOT RECORDED — an artifact written before this field existed. Silence about bait, not a
//      statement about it. Rendering it as "0" would retro-certify every historical artifact.
//   2. NOT DETERMINED — the run could not open the committed corpus. Also not "0"; this is the
//      state a capability-gap run reports, because it reads nothing.
//   3. MEASURED ZERO — the corpus WAS read and holds no judge-targeted bait. The only state that
//      is actually good news, and the only one allowed to print a zero.
//   4. MEASURED SELF-AUTHORSHIP — bait exists, and the author identities are named, with the ones
//      sitting on the calibrated panel marked as such.
//
// The staged preview and the stored artifact must render IDENTICALLY. A disclosure that reads one
// way before `--commit` and another way after is a disclosure an operator cannot rely on.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import * as core from '@vostride/agent-qa-eval'
import * as local from '@vostride/agent-qa-eval-local'
import { renderJudgeTargetedCalibration } from '../eval-session-composition.js'
// Untyped on purpose: a `typeof import(...)` annotation would pull the eval-local source tree
// into this package's `rootDir`. The same idiom the sibling judge-calibrate command cell uses.
const { writeCommittedFloorFixture } = await import(
  new URL('../../../eval-local/src/__tests__/fixtures/floor-fixtures.js', import.meta.url).href
)

const roots: string[] = []
afterEach(() => { for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true }) })

const PANEL = core.createPanelIdentity(['claude-judge-stub', 'gemini-judge-stub'])
const memberModelIds = PANEL.members!.map(member => member.judgeModelId)
const population: core.JudgeTargetedCalibrationMember[] = [
  { cassetteId: 'adv-table', generator: { kind: 'fuzz-label', seedCassetteId: 'seed',
    generatorVersion: core.ADVERSARIAL_GENERATOR_VERSION, mutator: 'confusable',
    tableVersion: core.ADVERSARIAL_TABLE_VERSION, tableHash: core.ADVERSARIAL_TABLE_HASH } },
  { cassetteId: 'adv-bait', generator: { kind: 'judge-targeted', seedCassetteId: 'seed',
    generatorVersion: core.ADVERSARIAL_GENERATOR_VERSION,
    authoringModel: { id: memberModelIds[0]!, family: 'claude' },
    promptVersion: core.ADVERSARIAL_PROMPT_VERSION } },
]

const lines = (disclosure?: core.JudgeTargetedCalibrationDisclosure) =>
  renderJudgeTargetedCalibration(disclosure).join('\n')

it('renders not-recorded, not-determined, a measured zero and measured self-authorship distinctly', () => {
  const notRecorded = lines(undefined)
  const notDetermined = lines({ basis: 'raw', source: 'unavailable', reason: 'corpus-unreadable' })
  const measuredZero = lines(core.projectJudgeTargetedCalibration({ members: [], memberModelIds }))
  const measured = lines(core.projectJudgeTargetedCalibration({ members: population, memberModelIds }))
  expect(new Set([notRecorded, notDetermined, measuredZero, measured]).size).toBe(4)
  // Only the state that actually read a corpus may print a count.
  expect(notRecorded).not.toMatch(/\d/)
  expect(notDetermined).not.toMatch(/\d/)
  expect(notDetermined).toContain('corpus-unreadable')
  expect(measuredZero).toMatch(/judge-targeted=0/)
  expect(measuredZero).not.toContain('author ')
})

it('names the self-authoring panel member and states that the counts are raw', () => {
  const measured = lines(core.projectJudgeTargetedCalibration({ members: population, memberModelIds }))
  expect(measured).toContain(memberModelIds[0]!)
  expect(measured).toMatch(/self-authored/)
  expect(measured).toMatch(/table-derived=1/)
  expect(measured).toMatch(/model-authored=1/)
  // The arithmetic above this block is untouched, and the rendering says so in words.
  expect(measured.toLowerCase()).toContain('raw')
})

it('renders the staged preview and the stored artifact identically', () => {
  const root = mkdtempSync(join(tmpdir(), 'calibration-disclosure-')); roots.push(root)
  const corpus = writeCommittedFloorFixture(root) as { committedRoot: string; selected: { cassette: core.Cassette }[] }
  const seed = corpus.selected[0]!.cassette
  if (seed.granularity !== 'leaf') throw new Error('expected a fixture leaf')
  const store = new local.FsCommittedRootStore({ committedRoot: corpus.committedRoot })
  for (const member of population) {
    const entry = { ...core.projectCorpusEntry({ cassette: seed, product: 'alpha', runId: seed.runId,
      assignment: { split: 'adversarial', generator: member.generator! } }), cassetteId: member.cassetteId }
    store.writeText(local.committedCorpusPath('alpha', entry.cassetteId), core.committedFileText(entry))
  }
  const input = { committedRoot: corpus.committedRoot, agentQaRoot: join(root, '.agent-qa'),
    identity: PANEL, minN: core.resolveJudgeCalibrationMinimum(20),
    profile: { plannerModelId: 'gpt-replay-stub', fingerprint: 'a'.repeat(64), matcherVersion: 1,
      judgeModelId: PANEL.judgeModelId, judgeVersion: PANEL.judgeVersion } }

  // Staged: what the dry-run summary computes off the reader, before any publication.
  const read = local.loadJudgeCalibrationEvidence(input)
  const staged = core.summarizeJudgeCalibration({ observations: [], memberModelIds,
    minN: input.minN, selected: read.selected,
    judgeTargeted: { members: read.adversarialMembers,
      observedCassetteIds: read.evidence.map(row => row.goldCassetteId) } }).judgeTargeted

  // Stored: the same fact, read back out of a published artifact's checked bytes.
  const artifact = local.createJudgeCalibrationArtifact(input, { status: 'capability-gap', reason: 'no-credential' })
  const path = join(input.committedRoot, local.judgeCalibrationPath(artifact.profileKey))
  mkdirSync(join(input.committedRoot, 'reports/judge-calibration'), { recursive: true })
  writeFileSync(path, core.committedFileText(artifact))
  const stored = local.readJudgeCalibration(input)
  if (stored.kind !== 'loaded') throw new Error(`expected a loaded artifact, got ${stored.kind}`)

  expect(stored.artifact.judgeTargeted).toEqual(staged)
  expect(lines(stored.artifact.judgeTargeted)).toBe(lines(staged))
  expect(lines(staged)).toContain(memberModelIds[0]!)
})
