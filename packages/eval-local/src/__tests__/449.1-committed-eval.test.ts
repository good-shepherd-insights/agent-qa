import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildSeedingPlan,
  calibrateLabels,
  canonicalJson,
  committedFileText,
  computeCorpusDigest,
  contractFileName,
  createPanelIdentity,
  extractRunCassettes,
  projectJudgeConfigContract,
  projectMatcherConfigContract,
  resolveJudgeCalibrationMinimum,
} from '@vostride/agent-qa-eval'
import { sha256hex } from '@vostride/agent-qa-schema'
import {
  COMMITTED_ROOT_MARKER_FILE,
  COMMITTED_ROOT_SCHEMA_VERSION,
  JUDGE_CALIBRATION_SCHEMA_VERSION,
  LABEL_CALIBRATION_PATH,
  LABEL_CALIBRATION_SCHEMA_VERSION,
  buildRootMarkerValue,
  committedContractPath,
  createJudgeCalibrationArtifact,
  judgeCalibrationGenerationId,
  judgeCalibrationPath,
  publishJudgeCalibration,
  readCommittedCorpusDigest,
  readJudgeCalibration,
  readLabelCalibration,
  seedCommittedCorpus,
} from '../index.js'
import { LOCAL_FIXTURE_BLOB_BYTES, makeLocalV2Handoff } from './fixtures/local-handoff-fixture.js'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function freshRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix))
  roots.push(root)
  return root
}

function put(root: string, relPath: string, text: string): void {
  mkdirSync(dirname(join(root, relPath)), { recursive: true })
  writeFileSync(join(root, relPath), text)
}

function seed(committedRoot: string) {
  const handoff = makeLocalV2Handoff()
  const cassettes = extractRunCassettes({ handoff, artifacts: { getBlob: () => LOCAL_FIXTURE_BLOB_BYTES } }).cassettes
  const plan = buildSeedingPlan({
    handoff,
    cassettes,
    partition: { saltHex: 'a3f'.repeat(21).concat('b'), heldOutFraction: 0.95, privateFraction: 0.5 },
  })
  const report = seedCommittedCorpus({ plan, cassettes, committedRoot, mask: (text: string) => text })
  if ('reports' in report) throw new Error('one plan seeds one report')
  return report
}

function labelCalibration(stamp: number) {
  const report = calibrateLabels({
    snapshot: { entries: [], labelsById: new Map(), cassettesById: new Map(), blobPresentById: new Map() },
    marks: [],
  })
  const body = { ...report, schemaVersion: stamp, evidenceDigest: sha256hex('evidence'), targetRevisions: [] }
  return { ...body, generationId: sha256hex(canonicalJson(body)) }
}

function judgeFixture() {
  const root = freshRoot('agent-qa-committed-judge-')
  const committedRoot = join(root, 'committed'), agentQaRoot = join(root, 'runtime')
  mkdirSync(committedRoot)
  mkdirSync(agentQaRoot)
  const identity = createPanelIdentity(['claude-sonnet-4', 'gemini-2.5'])
  const input = { committedRoot, agentQaRoot, identity, minN: resolveJudgeCalibrationMinimum(),
    profile: { plannerModelId: 'gpt-5', fingerprint: sha256hex('fixture'), matcherVersion: 1,
      judgeModelId: identity.judgeModelId, judgeVersion: identity.judgeVersion } }
  const artifact = createJudgeCalibrationArtifact(input, { status: 'capability-gap', reason: 'no-credential' })
  return { input, artifact, path: join(committedRoot, judgeCalibrationPath(artifact.profileKey)) }
}

function resigned<T extends { generationId: string }>(artifact: T, change: Partial<T>): T {
  const { generationId: _generationId, ...body } = { ...artifact, ...change }
  return { ...body, generationId: judgeCalibrationGenerationId(body as never) } as T
}

describe('committed eval on disk', () => {
  it('seeds a fresh root with eval-root.json stamped 2 and reports it unchanged when re-seeded', () => {
    const root = freshRoot('agent-qa-committed-seed-')
    const first = seed(root)
    expect(COMMITTED_ROOT_SCHEMA_VERSION).toBe(2)
    expect(first.scaffold.marker).toBe('written')
    expect(JSON.parse(readFileSync(join(root, COMMITTED_ROOT_MARKER_FILE), 'utf8'))).toEqual({ schemaVersion: 2 })
    expect(first.contracts.map(row => row.outcome)).toEqual(['written', 'written'])
    const second = seed(root)
    expect(second.scaffold).toEqual({ gitignore: 'unchanged', marker: 'unchanged' })
    expect(second.contracts.map(row => row.outcome)).toEqual(['unchanged', 'unchanged'])
  })

  it.each([1, 3])('reports a write conflict when re-seeding over contracts stamped %i', (stamp) => {
    const root = freshRoot('agent-qa-committed-contracts-')
    for (const projection of [projectMatcherConfigContract(), projectJudgeConfigContract()]) {
      put(root, committedContractPath(contractFileName(projection)), committedFileText({ ...projection, schemaVersion: stamp }))
    }
    expect(seed(root).contracts.map(row => row.outcome)).toEqual(['write-conflict', 'write-conflict'])
  })

  it('reads the corpus digest of a root whose marker is stamped 2', () => {
    const root = freshRoot('agent-qa-committed-marker-')
    put(root, COMMITTED_ROOT_MARKER_FILE, committedFileText(buildRootMarkerValue()))
    expect(readCommittedCorpusDigest({ committedRoot: root })).toEqual({
      kind: 'digest', corpusDigest: computeCorpusDigest([]),
    })
  })

  it.each([1, 3])('reports a root whose marker is stamped %i as unreadable', (stamp) => {
    const root = freshRoot('agent-qa-committed-marker-')
    put(root, COMMITTED_ROOT_MARKER_FILE, committedFileText({ schemaVersion: stamp }))
    expect(readCommittedCorpusDigest({ committedRoot: root })).toMatchObject({
      kind: 'unavailable', reason: 'corpus-unreadable', detail: 'invalid eval root marker schemaVersion',
    })
  })

  it('loads a label calibration stamped 2', () => {
    const root = freshRoot('agent-qa-committed-calibration-')
    expect(LABEL_CALIBRATION_SCHEMA_VERSION).toBe(2)
    put(root, LABEL_CALIBRATION_PATH, JSON.stringify(labelCalibration(2)))
    expect(readLabelCalibration(root).kind).toBe('loaded')
  })

  it.each([1, 3])('refuses a label calibration stamped %i', (stamp) => {
    const root = freshRoot('agent-qa-committed-calibration-')
    put(root, LABEL_CALIBRATION_PATH, JSON.stringify(labelCalibration(stamp)))
    expect(readLabelCalibration(root)).toEqual({ kind: 'refused', reason: 'invalid label calibration artifact' })
  })

  it('loads a judge calibration stamped 2', async () => {
    const f = judgeFixture()
    expect(JUDGE_CALIBRATION_SCHEMA_VERSION).toBe(2)
    expect(f.artifact.schemaVersion).toBe(2)
    expect(await publishJudgeCalibration({ ...f.input, artifact: f.artifact })).toMatchObject({ kind: 'committed' })
    expect(readJudgeCalibration(f.input)).toEqual({ kind: 'loaded', artifact: f.artifact })
  })

  it.each([1, 3])('refuses a judge calibration stamped %i', (stamp) => {
    const f = judgeFixture()
    put(f.input.committedRoot, judgeCalibrationPath(f.artifact.profileKey),
      JSON.stringify(resigned(f.artifact, { schemaVersion: stamp } as never)))
    expect(readJudgeCalibration(f.input).kind).toBe('refused')
  })

  it.each([1, 3])('refuses a judge calibration naming the constitution stamped %i', (stamp) => {
    const f = judgeFixture()
    const constitutionDigest = sha256hex(canonicalJson({ ...projectJudgeConfigContract(), schemaVersion: stamp }))
    expect(constitutionDigest).not.toBe(f.artifact.constitutionDigest)
    put(f.input.committedRoot, judgeCalibrationPath(f.artifact.profileKey),
      JSON.stringify(resigned(f.artifact, { constitutionDigest })))
    expect(readJudgeCalibration(f.input).kind).toBe('refused')
  })
})
