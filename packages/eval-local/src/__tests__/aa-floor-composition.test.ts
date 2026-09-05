import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { computeBatchKey, computeGateVerdict } from '@vostride/agent-qa-eval'
import { createMaskingContext } from '@vostride/agent-qa-safety'
import { afterEach, describe, expect, it, vi } from 'vitest'

import * as evalLocal from '../index.js'
import {
  incrementingClock,
  noneAuth,
  stubProfile,
  warningStub,
  writeFloorLeaves,
} from './fixtures/floor-fixtures.js'

const roots: string[] = []
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'aa-floor-'))
  roots.push(root)
  const stub = warningStub()
  return {
    root,
    stub,
    input: {
      ...writeFloorLeaves(root),
      agentQaRoot: root,
      runRoot: join(root, 'r0-seed11'),
      profile: stubProfile(),
      auth: noneAuth,
      modelOverrides: { languageModels: stub.languageModels },
      maskingContextFactory: createMaskingContext,
      seed: 11,
      replayOutputBaseDir: join(root, 'audit'),
      source: 'committed',
      clock: incrementingClock(),
    },
  }
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('replayCorpusOnce', () => {
  it('stages actual profile and supplied corpus identity, leaving undeclared receipts absent', async () => {
    expect(evalLocal.replayCorpusOnce).toBeTypeOf('function')
    const { input } = await fixture()
    const corpusDigest = 'a'.repeat(64)
    const first = await evalLocal.replayCorpusOnce({ ...input, corpusDigest })
    const fingerprint = evalLocal.computeReplayProfileFingerprintFor({
      profile: input.profile, modelOverrides: input.modelOverrides, seedPolicy: 'declared',
    })
    expect(first.report.runIdentity).toEqual({ fingerprint, corpusDigest })
    expect(evalLocal.loadStagedReport(input.agentQaRoot, first.report.batchKey,
      join(input.runRoot, 'reports'))).toMatchObject({
      kind: 'loaded', report: { runIdentity: { fingerprint, corpusDigest } },
    })
    const second = await evalLocal.replayCorpusOnce({ ...input, corpusDigest: 'b'.repeat(64),
      profile: { ...input.profile, capabilities: { vision: true } },
    })
    expect(second.report.runIdentity?.fingerprint).not.toBe(fingerprint)
    expect(second.report.runIdentity?.corpusDigest).toBe('b'.repeat(64))
    const legacy = await evalLocal.replayCorpusOnce(input)
    expect(legacy.report).not.toHaveProperty('runIdentity')
  })

  it('stages one declared-seed batch and decision sidecar, measuring actual calls and injected time', async () => {
    expect(evalLocal.replayCorpusOnce).toBeTypeOf('function')
    const { input, stub } = await fixture()
    const result = await evalLocal.replayCorpusOnce(input)
    expect(result.report.seedHonored).toBe(false)
    expect(result.report.batchKey).toBe(computeBatchKey(input.selected.map(e => e.cassette.id)))
    expect(result.vectors).toHaveLength(3)
    expect(result.replaysRoot).toBe(join(input.runRoot, 'replays'))
    expect(result.modelCalls).toBe(3)
    expect(stub.captured).toHaveLength(3)
    expect(result.wallClockMs).toBeGreaterThan(0)
    expect(existsSync(result.reportFile)).toBe(true)
    expect(existsSync(result.decisionsFile)).toBe(true)
    expect(evalLocal.loadStagedReport(input.agentQaRoot, result.report.batchKey,
      join(input.runRoot, 'reports'))).toMatchObject({
      kind: 'loaded', report: result.report, decisions: { vectors: result.vectors },
    })
    const again = await evalLocal.replayCorpusOnce({ ...input, clock: incrementingClock() })
    expect(again.wallClockMs).toBe(result.wallClockMs)
    expect(again.report.totalCost).toEqual(result.report.totalCost)
  })

  it('leaves records and reports intact in two distinct run roots', async () => {
    expect(evalLocal.replayCorpusOnce).toBeTypeOf('function')
    const { input } = await fixture()
    const first = await evalLocal.replayCorpusOnce(input)
    const files = [first.reportFile, first.decisionsFile,
      ...first.sweep.replayedDirs.map(dir => join(dir, 'replay.json'))]
    const before = files.map(file => readFileSync(file, 'utf8'))
    const second = await evalLocal.replayCorpusOnce({ ...input,
      runRoot: join(input.agentQaRoot, 'r1-seed11') })
    expect(first.replaysRoot).not.toBe(second.replaysRoot)
    expect(files.map(file => readFileSync(file, 'utf8'))).toEqual(before)
    expect(second.sweep.replayedDirs).toHaveLength(3)
    expect(second.sweep.replayedDirs.every(dir => existsSync(join(dir, 'replay.json')))).toBe(true)
    expect(existsSync(second.reportFile)).toBe(true)
  })

  it('excludes stale records and preserves a thrown rerun failure as downstream inconclusive evidence', async () => {
    expect(evalLocal.replayCorpusOnce).toBeTypeOf('function')
    const { input } = await fixture()
    const first = await evalLocal.replayCorpusOnce(input)
    expect(first.vectors).toHaveLength(3)
    const failedId = input.selected[1]!.cassette.id
    const save = evalLocal.FsReplayRecordStore.prototype.save
    vi.spyOn(evalLocal.FsReplayRecordStore.prototype, 'save').mockImplementation(function(outcome) {
      if (outcome.cassetteId === failedId) throw new Error('current record write failed')
      return save.call(this, outcome)
    })
    const current = await evalLocal.replayCorpusOnce({ ...input, selected: input.selected.slice(0, 2) })
    expect(current.sweep.replayRefusals).toEqual({ 'harness-error': 1 })
    expect(current.report.honesty.harnessErrorCount).toBe(1)
    expect(current.modelCalls).toBe(2)
    expect(current.vectors.map(v => v.cassetteId)).toEqual([input.selected[0]!.cassette.id])
    const verdict = computeGateVerdict({
      expectedProfileKey: 'floor-fixture',
      pointer: { kind: 'absent', others: [] },
      baseline: { report: first.report },
      current: { report: current.report, vectors: current.vectors,
        fingerprint: 'fixture', corpusDigest: 'fixture' },
    })
    expect(verdict.exit).toBe(2)
    expect(verdict.inconclusive).toContainEqual({ reason: 'harness-errors', detail: expect.any(String) })
  })
})
