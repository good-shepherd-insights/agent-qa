import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { slugBranch } from '@vostride/agent-qa-schema'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveBaselineCache } from '../baseline-cache-read.js'
import { FsReportStore, loadStagedReport } from '../report-store.js'
import { gate1Responder, warmGateRoot, writeGate1Fixture } from './fixtures/gate1-fixtures.js'
import { respondingStub } from './fixtures/replay-fixtures.js'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
function rewrite(file: string, change: (value: Record<string, any>) => void) {
  const value = JSON.parse(readFileSync(file, 'utf8'))
  change(value)
  writeFileSync(file, JSON.stringify(value))
}
function rewriteReport(root: string, change: (value: Record<string, any>) => void) {
  const dir = join(root, 'reports')
  for (const name of readdirSync(dir).filter((name) => /^[^.]+\.json$/.test(name))) {
    const loaded = loadStagedReport(root, name.slice(0, -5), dir)
    if (loaded.kind !== 'loaded') throw new Error(JSON.stringify(loaded))
    change(loaded.report)
    new FsReportStore({ root, outputDir: dir }).save(
      loaded.report,
      loaded.decisions,
      loaded.replayGeneration,
    )
    expect(loadStagedReport(root, name.slice(0, -5), dir).kind).toBe('loaded')
  }
}
async function warm() {
  const root = mkdtempSync(join(tmpdir(), 'gate1-cache-'))
  roots.push(root)
  const f = writeGate1Fixture(root)
  const stub = respondingStub(gate1Responder(f))
  const warmed = await warmGateRoot(f, stub)
  const input = {
    agentQaRoot: f.agentQaRoot,
    ...f.identity,
    gateRootSeed: 11,
    gateRootSeedSource: 'floor',
    cassettes: f.selected.map(({ cassette }) => ({
      id: cassette.id,
      promptInputHash: cassette.receipt.promptInputHash,
    })),
  }
  return { f, stub, warmed, input }
}

describe('profile-keyed gate and floor baseline cache', () => {
  it.each([11, 29])(
    'inherits the actual producer seed %i despite changed caller config',
    async (seed) => {
      const { f, input, stub } = await warm()
      stub.captured.length = 0
      await warmGateRoot(f, stub, seed)
      expect(stub.captured.every((call) => call.seed === seed)).toBe(true)
      const rows = resolveBaselineCache({
        ...input,
        gateRootSeed: seed === 11 ? 29 : 11,
        gateRootSeedSource: 'config',
      }).rows
      expect(
        rows.every(
          (row) =>
            row.kind === 'cached' && row.seed === seed && row.seedSource === 'run-publication',
        ),
      ).toBe(true)
    },
  )
  it('inherits floor seed 11 and seedHonored from the report without calls', async () => {
    const { f, stub, warmed, input } = await warm()
    const before = stub.captured.length
    const cache = resolveBaselineCache(input)
    expect(cache.rows).toHaveLength(6)
    for (const row of cache.rows)
      expect(row).toMatchObject({
        kind: 'cached',
        root: f.gateRoot,
        seed: 11,
        seedSource: 'run-publication',
        seedHonored: warmed.report.seedHonored,
      })
    expect(stub.captured).toHaveLength(before)
  })
  it('falls back per cassette to r0-seed29 with run-dir seed provenance', async () => {
    const { f, input } = await warm()
    const floorRoot = join(f.agentQaRoot, 'eval/floor', slugBranch(f.profileKey), 'r0-seed29')
    await warmGateRoot({ ...f, gateRoot: floorRoot }, respondingStub(gate1Responder(f)), 29)
    rewriteReport(floorRoot, (report) => {
      if ('seed' in report) report.seed = 29
      if (report.runIdentity && 'seed' in report.runIdentity) report.runIdentity.seed = 29
      report.seedHonored = false
    })
    const id = f.collateralIds[0]!
    rmSync(join(f.gateRoot, 'replays', id), { recursive: true })
    const cache = resolveBaselineCache(input)
    expect(cache.rows.find((row) => row.cassetteId === id)).toMatchObject({
      kind: 'cached',
      root: floorRoot,
      seed: 29,
      seedSource: 'run-publication',
      seedHonored: false,
    })
    expect(cache.rows.find((row) => row.cassetteId !== id)).toMatchObject({
      kind: 'cached',
      root: f.gateRoot,
      seed: 11,
    })
  })
  it.each(['promptInputHash', 'matcherVersion', 'modelId', 'judge'])(
    'rejects stale %s on only the changed cassette',
    async (leg) => {
      const { f, input } = await warm()
      const id = f.collateralIds[0]!
      const file = join(
        f.gateRoot,
        'replays',
        id,
        leg === 'matcherVersion' || leg === 'judge' ? 'score.json' : 'replay.json',
      )
      rewrite(file, (record) => {
        if (leg === 'promptInputHash') record.promptDrift.recordedHash = 'f'.repeat(64)
        if (leg === 'matcherVersion') record.matcherVersion += 1
        if (leg === 'modelId') record.replayedModel.modelId = 'other-model'
        if (leg === 'judge')
          record.judge = {
            judgeModelId: 'claude-sonnet-4',
            judgeFamily: 'anthropic',
            judgeVersion: 1,
            confidenceThreshold: 'high',
          }
      })
      const cache = resolveBaselineCache(input)
      expect(cache.rows.find((row) => row.cassetteId === id)).toMatchObject({
        kind: 'uncached',
        reason: expect.stringContaining(leg),
      })
      expect(cache.rows.filter((row) => row.kind === 'cached')).toHaveLength(5)
    },
  )
  it('skips an entire root with a foreign runIdentity fingerprint', async () => {
    const { f, input } = await warm()
    rewriteReport(f.gateRoot, (report) => {
      report.runIdentity.fingerprint = 'f'.repeat(64)
    })
    const cache = resolveBaselineCache(input)
    expect(cache.rows.every((row) => row.kind === 'uncached')).toBe(true)
    expect(cache.roots).toEqual([])
  })
  it('returns a typed refused row without requiring samples or a score', async () => {
    const { f, input } = await warm()
    const id = f.collateralIds[0]!
    writeFileSync(
      join(f.gateRoot, 'replays', id, 'replay.json'),
      JSON.stringify({
        kind: 'integrity-refusal',
        cassetteId: id,
        reason: 'missing-blob',
        detail: 'offline refusal',
      }),
    )
    rmSync(join(f.gateRoot, 'replays', id, 'score.json'))
    expect(resolveBaselineCache(input).rows.find((row) => row.cassetteId === id)).toMatchObject({
      kind: 'refused',
      reason: 'missing-blob',
    })
  })
  it('returns all uncached on ENOENT without throwing', async () => {
    const { f, input } = await warm()
    expect(
      resolveBaselineCache({ ...input, agentQaRoot: join(f.root, 'absent') }).rows.every(
        (row) => row.kind === 'uncached',
      ),
    ).toBe(true)
  })
  it('rejects interrupted seed replacement and does not attribute stale rows to a later report', async () => {
    const { f, input, stub } = await warm()
    const savedReports = join(f.root, 'previous-reports')
    cpSync(join(f.gateRoot, 'reports'), savedReports, { recursive: true })
    await warmGateRoot(f, stub, 29)
    rmSync(join(f.gateRoot, 'reports'), { recursive: true })
    cpSync(savedReports, join(f.gateRoot, 'reports'), { recursive: true })
    expect(
      resolveBaselineCache(input).rows.every(
        (row) => row.kind === 'uncached' && row.reason.includes('generation mismatch'),
      ),
    ).toBe(true)
    const selected = f.selected.slice(0, 1)
    await warmGateRoot({ ...f, selected }, stub, 29)
    const rows = resolveBaselineCache(input).rows
    expect(rows.filter((row) => row.kind === 'cached')).toHaveLength(1)
    expect(rows.find((row) => row.kind === 'cached')).toMatchObject({ seed: 29 })
  })
  it('treats historical gate records with no seed publication as cold and uses a historical floor fallback', async () => {
    const { f, input } = await warm()
    const dir = join(f.gateRoot, 'reports')
    for (const name of readdirSync(dir).filter((name) => name.endsWith('.publication.json')))
      rewrite(join(dir, name), (value) => {
        delete value.replayGeneration
      })
    expect(
      resolveBaselineCache(input).rows.every(
        (row) => row.kind === 'uncached' && row.reason.includes('seed is unproven'),
      ),
    ).toBe(true)
    const floorRoot = join(f.agentQaRoot, 'eval/floor', slugBranch(f.profileKey), 'r0-seed11')
    cpSync(f.gateRoot, floorRoot, { recursive: true })
    expect(
      resolveBaselineCache(input).rows.every(
        (row) => row.kind === 'cached' && row.seed === 11 && row.seedSource === 'run-dir',
      ),
    ).toBe(true)
  })
})
