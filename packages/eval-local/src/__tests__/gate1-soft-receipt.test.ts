import { dirname, join } from 'node:path'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { afterEach, expect, it, vi } from 'vitest'
import { createLabelRevision, projectSilverLabelRecord, type StandaloneLabelRecord } from '@vostride/agent-qa-eval'
import { GateReceiptSchema, receiptDigestOf } from '@vostride/agent-qa-schema'
import { committedCorpusPath, committedLabelPath } from '../committed-root-store.js'
import { readActiveCommittedCorpus } from '../committed-corpus-source.js'
import { runReplayGate, serializeReplayGateReceipt, type RunReplayGateInput } from '../replay-gate-composition.js'
import { gate1Responder, warmGateRoot, writeGate1Fixture } from './fixtures/gate1-fixtures.js'
import { actionGenerateResult, respondingStub, noneAuth, stubProfile } from './fixtures/replay-fixtures.js'
import { incrementingClock } from './fixtures/floor-fixtures.js'

const roots: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
function write(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(value))
}
function weight(value: number): NonNullable<StandaloneLabelRecord['weight']> {
  return { value, k: 0, n: 0, verdictSource: 'unverified', verdictFactor: 1,
    capabilityTier: 'full', tierFactor: 1, alpha0: 2, beta0: 1,
    corpusDigest: 'a'.repeat(64), evidenceDigest: 'b'.repeat(64),
    capabilityEvidence: { kind: 'deterministic' } }
}
async function fixture(options: Parameters<typeof writeGate1Fixture>[1] = {}) {
  const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('unexpected provider call'))
  const root = mkdtempSync(join(tmpdir(), 'agent-qa-soft-gate-'))
  roots.push(root)
  const f = writeGate1Fixture(root, options)
  const baseline = respondingStub(call => JSON.stringify(call.prompt).includes('gate1-target-sibling-1')
    ? actionGenerateResult() : gate1Responder(f)(call))
  await warmGateRoot(f, baseline)
  const stub = respondingStub(call => JSON.stringify(call.prompt).includes('gate1-collateral-0')
    ? actionGenerateResult('web', 'e-other') : gate1Responder(f)(call))
  const input: RunReplayGateInput = {
    injection: f.injection, committedRoot: f.committedRoot, agentQaRoot: f.agentQaRoot,
    identity: f.identity, planner: { profile: stubProfile(),
      modelOverrides: { languageModels: stub.languageModels }, resolveAuth: async () => noneAuth },
    judgeOverrideConfigured: false, k: 3, kSource: 'default', maxScreens: 64,
    baselineSeed: { floorSeeds: [11] }, producedBy: { opId: 'eval.replay-gate' }, clock: incrementingClock(),
  }
  const record = (id: string) => {
    const { cassette } = f.selected.find(row => row.cassette.id === id)!
    return projectSilverLabelRecord({ cassette, runId: cassette.runId })
  }
  const save = (label: StandaloneLabelRecord) => write(
    join(f.committedRoot, committedLabelPath('alpha', label.cassetteId)).replace(/\.json$/,
      label.revision ? `--revision-${label.revision.id}.json` : '.json'), label)
  const run = async () => {
    const result = await runReplayGate(input)
    if (result.kind !== 'receipt') throw new Error(JSON.stringify(result))
    const path = join(root, 'receipt.json')
    writeFileSync(path, serializeReplayGateReceipt(result.receipt))
    const saved = GateReceiptSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
    expect(saved).toEqual(result.receipt)
    expect(receiptDigestOf(saved)).toBe(saved.receiptDigest)
    expect(network).not.toHaveBeenCalled()
    return result.receipt
  }
  return { f, input, record, save, run, stub }
}

it.each(['gold', 'near-gold', 'silver'] as const)(
  'real %s harm persists exact authoritative weights without changing gate outcomes', async tier => {
    const { f, record, save, run } = await fixture()
    const id = f.selected.find(row => row.cassette.input.stepText === 'gate1-collateral-0')!.cassette.id
    const original = record(id)
    original.label = { ...original.label, tier }
    save(original)
    const before = await run()
    expect(before.verdict).toBe('fail')
    expect(before.reasons).toEqual(['collateral-harm'])
    expect(before.harmed).toHaveLength(1)
    expect(before.harmed![0]).toMatchObject({ cassetteId: id, labelTier: tier })
    expect(Object.hasOwn(before.harmed![0]!, 'softWeight')).toBe(false)
    let current = original
    for (const value of [0, 0.25, 1]) {
      current = createLabelRevision(current, { weight: weight(value) })
      save(current)
      const selected = readActiveCommittedCorpus(f.committedRoot, f.agentQaRoot)
      expect(selected.refusals).toEqual([])
      expect(selected.snapshot.labelsById.get(id)?.weight?.value).toBe(value)
      const got = await run()
      expect(got.harmed).toEqual([{ ...before.harmed![0], softWeight: value }])
      for (const key of ['verdict', 'reasons', 'crossCheck', 'perAxisScore', 'targets', 'population'] as const)
        expect(got[key]).toEqual(before[key])
    }
  },
)

it('quarantined collateral never returns through the embedded silver fallback', async () => {
  const { f, record, save, run } = await fixture()
  const original = record(f.selected.find(row => row.cassette.input.stepText === 'gate1-collateral-0')!.cassette.id)
  save(original)
  save(createLabelRevision(original, { quarantine: 'rerun-overturned' }))
  const got = await run()
  expect(got.verdict).toBe('pass')
  expect(got.harmed).toEqual([])
  expect(got.corpusVersion.gateSetSize).toBe(4)
})

it('quarantined target cannot return through handoff extraction', async () => {
  const { f, input, record, save, run, stub } = await fixture({ handoffForTarget: true })
  const original = record(f.targetId)
  save(original)
  save(createLabelRevision(original, { quarantine: 'rerun-overturned' }))
  input.planner.resolveAuth = async () => noneAuth
  const got = await run()
  expect(got.reasons).toEqual(['target-unavailable'])
  expect(got.spend?.modelCalls).toBe(0)
  expect(stub.captured).toHaveLength(0)
})

it('a genuinely non-corpus extracted target retains its existing eligibility', async () => {
  const { run } = await fixture({ targetInCorpus: false, handoffForTarget: true })
  const got = await run()
  expect(got.reasons).toEqual(['baseline-uncached'])
  expect(got.spend?.modelCalls).toBe(0)
})

it('excludes a quarantined original while preserving its non-corpus target sibling', async () => {
  const { f, record, save, run } = await fixture({ targetDecisions: 2, handoffForTarget: true })
  const original = record(f.targetId)
  save(original)
  save(createLabelRevision(original, { quarantine: 'rerun-overturned' }))
  const siblingId = f.targetIds[1]!
  rmSync(join(f.committedRoot, committedCorpusPath('alpha', siblingId)))
  const read = readActiveCommittedCorpus(f.committedRoot, f.agentQaRoot)
  expect(read.snapshot.excludedLabelIds?.has(original.cassetteId)).toBe(true)
  expect(read.corpusEntriesById?.has(siblingId)).toBe(false)
  const got = await run()
  expect(got.reasons).toEqual(['baseline-uncached'])
  expect(got.spend?.modelCalls).toBe(0)
})
