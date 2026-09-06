import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  assertFloorArtefactCommittable,
  buildEvalReport,
  committedFileText,
  deriveLeafCassetteId,
  foldNoiseFloorArtefact,
  guardNoiseFloorArtefact,
} from '@vostride/agent-qa-eval'
import type { DecisionCorrectnessVector, NoiseFloorArtefact } from '@vostride/agent-qa-eval'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { committedNoiseFloorPath } from '../committed-root-store.js'
import { writeNoiseFloorArtefact } from '../noise-floor-writer.js'
import { REPORT_EGRESS_CHANNEL } from '../report-committing.js'

const AWS_KEY = 'AKIAIOSFODNN7EXAMPLE'

function floorFixture(): NoiseFloorArtefact {
  const cassetteId = deriveLeafCassetteId({
    runSlug: 'r_proper-ewer-rud-ignore-ula-junk-may-effect-eva-ada',
    testIndex: 0, stepIndex: 0, decisionOrdinal: 0,
  })
  const vector: DecisionCorrectnessVector = {
    cassetteId, key: `${cassetteId}#-#0`, decisionOrdinal: 0, product: 'example-web',
    briefSource: 'proof', axes: {
      headline: 'correct', elementIdentity: 'correct', opClass: 'correct',
      sideEffect: 'correct', value: 'not-applicable', loop: 'not-applicable',
    },
  }
  return foldNoiseFloorArtefact({
    profile: {
      profileKey: 'fixture-profile', fingerprint: 'fixture-fingerprint',
      plannerModelId: 'fixture-planner', matcherVersion: 1,
    },
    corpusDigest: 'fixture-corpus', partitionVersion: 1,
    seeds: [11, 29], repeats: 3, bootstrapSeed: 19,
    runs: [11, 11, 11, 29].map((seed, index) => ({
      seed, index, report: buildEvalReport([]), vectors: [vector], wallClockMs: 1,
    })),
    splitByCassetteId: new Map([[cassetteId, 'natural']]),
    censusByProduct: { 'example-web': { natural: 1, heldOutShared: 0, heldOutPrivate: 0 } },
  })
}

describe('writeNoiseFloorArtefact (415 D-04/D-12)', () => {
  let root: string
  let outDir: string
  let artefact: NoiseFloorArtefact

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'eval-local-floor-root-'))
    outDir = await mkdtemp(join(tmpdir(), 'eval-local-floor-out-'))
    artefact = floorFixture()
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
    await rm(outDir, { recursive: true, force: true })
  })

  function write() {
    return writeNoiseFloorArtefact({ artefact, committedRoot: root, reportOutputBaseDir: outDir })
  }

  it('writes canonical bytes once and returns unchanged on identical evidence', () => {
    expect(guardNoiseFloorArtefact(artefact).kind).toBe('ok')
    expect(assertFloorArtefactCommittable(artefact)).toEqual({ ok: true })
    const path = committedNoiseFloorPath(artefact.profileKey)
    expect(write()).toEqual({ kind: 'written', path })
    const bytes = readFileSync(join(root, path), 'utf8')
    expect(bytes).toBe(committedFileText(artefact))
    expect(write()).toEqual({ kind: 'unchanged', path })
    expect(readFileSync(join(root, path), 'utf8')).toBe(bytes)
  })

  it('returns write-conflict on divergent evidence without overwriting it', () => {
    const path = committedNoiseFloorPath(artefact.profileKey)
    expect(write().kind).toBe('written')
    const bytes = readFileSync(join(root, path), 'utf8')
    artefact = { ...artefact, explanation: 'A different reviewed measurement' }
    expect(write()).toEqual({ kind: 'write-conflict', path })
    expect(readFileSync(join(root, path), 'utf8')).toBe(bytes)
  })

  it('is refused for an unexplained zero before any file or audit sink exists', () => {
    artefact.axes.headline.aggregateFloor = 0
    expect(guardNoiseFloorArtefact(artefact).kind).toBe('ok')
    const auditBase = join(outDir, 'not-created')
    expect(writeNoiseFloorArtefact({
      artefact, committedRoot: root, reportOutputBaseDir: auditBase,
    })).toEqual({
      kind: 'refused', refusal: { kind: 'zero-floor-without-explanation', axes: ['headline'] },
    })
    expect(existsSync(join(root, 'reports/noise-floor'))).toBe(false)
    expect(existsSync(auditBase)).toBe(false)
  })

  it('is refused below the protocol minimum before a secret can reach the checkpoint', () => {
    artefact = { ...artefact, repeats: 2, explanation: AWS_KEY }
    expect(write()).toEqual({
      kind: 'refused', refusal: { kind: 'below-protocol-minimum', repeats: 2, seeds: 2 },
    })
    expect(existsSync(join(root, 'reports'))).toBe(false)
    expect(existsSync(join(outDir, 'guardrail_audit.jsonl'))).toBe(false)
  })

  it('refuses unusable evidence before creating any report or audit file', () => {
    artefact.runs[0]!.harnessErrorCount = 1
    expect(write()).toMatchObject({ kind: 'refused', refusal: { kind: 'unusable-measurement' } })
    expect(existsSync(join(root, 'reports'))).toBe(false)
    expect(existsSync(join(outDir, 'guardrail_audit.jsonl'))).toBe(false)
  })

  it('returns egress-blocked for a planted secret on the existing eval-report channel', () => {
    artefact.explanation = `planted marker ${AWS_KEY}`
    expect(write()).toEqual({
      kind: 'egress-blocked',
      detections: [{ label: `noise-floor:${artefact.profileKey}`, detector: 'awsKey' }],
    })
    expect(existsSync(join(root, 'reports/noise-floor'))).toBe(false)
    const rows = readFileSync(join(outDir, 'guardrail_audit.jsonl'), 'utf8')
      .trim().split('\n').map(line => JSON.parse(line))
    expect(rows).toContainEqual(expect.objectContaining({
      channel: `${REPORT_EGRESS_CHANNEL}:noise-floor:${artefact.profileKey}`,
      detector: 'awsKey', action: 'block',
    }))
  })
})
