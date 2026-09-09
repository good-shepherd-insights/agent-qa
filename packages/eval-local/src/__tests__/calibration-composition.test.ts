import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { afterEach, expect, it, vi } from 'vitest'
import { asRunId, type CompletedRunHandoff } from '@vostride/agent-qa-schema'
import { buildSeedingPlan, committedFileText, extractRunCassettes, computeCorpusDigest } from '@vostride/agent-qa-eval'
import * as api from '../index.js'
import * as safety from '@vostride/agent-qa-safety'
import { committedCassettePath, committedCorpusPath, committedLabelPath } from '../committed-root-store.js'
import { makeLocalV2Handoff, LOCAL_FIXTURE_BLOB_BYTES } from './fixtures/local-handoff-fixture.js'

const roots: string[] = []
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function write(root: string, path: string, text: string) { const full = join(root, path); mkdirSync(dirname(full), { recursive: true }); writeFileSync(full, text); return full }
function bytes(root: string): Record<string, string> {
  const result: Record<string, string> = {}
  if (!existsSync(root)) return result
  const walk = (dir: string, prefix = '') => { for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = prefix + entry.name
    if (entry.isDirectory()) walk(join(dir, entry.name), path + '/')
    else result[path] = readFileSync(join(dir, entry.name), 'utf8')
  } }
  walk(root); return result
}
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'agent-qa-calibration-write-')); roots.push(root)
  const committedRoot = join(root, 'committed'), agentQaRoot = join(root, 'runtime'), reportOutputBaseDir = join(root, 'audit')
  const handoff = makeLocalV2Handoff({ runId: asRunId('calibration-producer'), scope: { tier: 'product', key: 'shop' } })
  handoff.tests = [handoff.tests[0]!]
  handoff.tests[0]!.steps = [handoff.tests[0]!.steps[0]!]
  const step = handoff.tests[0]!.steps[0]!, failed = step.subActions[0]!
  failed.stateBefore.timestamp = 1725000000
  failed.plannedAction = { type: 'navigate', to: 'url', url: 'https://example.test/first' }
  failed.result = { success: false, error: 'did not advance' }
  const recovery = structuredClone(failed)
  recovery.plannedAction = { type: 'navigate', to: 'url', url: 'https://example.test/second' }
  recovery.result = { success: true }
  step.subActions.push(recovery)
  step.selfHeal = { failedDecision: { plan: failed.plan, plannedAction: failed.plannedAction, result: failed.result }, recoveringDecision: { plan: recovery.plan, plannedAction: recovery.plannedAction, result: recovery.result } }
  const persistRun = (value: CompletedRunHandoff) => write(agentQaRoot, `runs/${value.runId}/handoff.json`, JSON.stringify(value))
  persistRun(handoff)
  const extracted = extractRunCassettes({ handoff, artifacts: { getBlob: () => LOCAL_FIXTURE_BLOB_BYTES } })
  const plan = buildSeedingPlan({ handoff, cassettes: extracted.cassettes, partition: { saltHex: 'a'.repeat(64), heldOutFraction: 0.2, privateFraction: 0.5 } })
  for (const item of plan.cases) {
    const label = structuredClone(item.labelRecord); delete label.weight
    write(committedRoot, committedLabelPath('shop', item.cassetteId), committedFileText(label))
    write(committedRoot, committedCorpusPath('shop', item.cassetteId), committedFileText(item.corpusEntry))
    write(committedRoot, committedCassettePath('shop', item.cassetteId), committedFileText(extracted.cassettes.find(row => row.cassette.id === item.cassetteId)!.cassette))
  }
  expect(plan.pairCounts.total).toBe(1)
  const invoke = (opts: Record<string, unknown> = {}) => (api as Record<string, any>).runLabelCalibration?.({ committedRoot, agentQaRoot, reportOutputBaseDir, ...opts })
  return { root, committedRoot, agentQaRoot, reportOutputBaseDir, invoke, handoff, persistRun, plan }
}

it('dry-run computes all pair weights without creating committed, lock or audit bytes', async () => {
  const f = setup(), before = bytes(f.root)
  expect((await f.invoke())).toMatchObject({ kind: 'dry-run', refreshedCount: 2, artifact: { schemaVersion: 1 } })
  expect(bytes(f.root)).toEqual(before)
})
it('commits once, reuses semantic terminals and returns byte-identical unchanged', async () => {
  const f = setup(), originals = bytes(f.committedRoot), digest = computeCorpusDigest(api.readCommittedCorpus(f.committedRoot).snapshot.entries)
  const first = (await f.invoke({ commit: true }))
  expect(first).toMatchObject({ kind: 'committed', refreshedCount: 2 })
  const published = bytes(f.committedRoot)
  expect((await f.invoke({ commit: true }))).toMatchObject({ kind: 'unchanged', refreshedCount: 0, artifact: first.artifact })
  expect(bytes(f.committedRoot)).toEqual(published)
  for (const [path, text] of Object.entries(originals)) expect(published[path]).toBe(text)
  const read = api.readCommittedCorpus(f.committedRoot)
  expect(read.snapshot.labelsById.size).toBe(2)
  expect([...read.snapshot.labelsById.values()].map(label => label.weight?.n)).toEqual([1, 1])
  expect(computeCorpusDigest(read.snapshot.entries)).toBe(digest)
})
it('requires explicit replacement and permits calibration-only replacement without new revisions', async () => {
  const f = setup()
  expect((await f.invoke({ commit: true }))?.kind).toBe('committed')
  const original = bytes(f.committedRoot)
  expect((await f.invoke({ commit: true, minGold: { value: 2, source: 'cli' } }))?.kind).toBe('write-conflict')
  expect(bytes(f.committedRoot)).toEqual(original)
  expect((await f.invoke({ commit: true, replace: true, minGold: { value: 2, source: 'cli' } }))).toMatchObject({ kind: 'committed', refreshedCount: 0, artifact: { minGold: { value: 2, source: 'cli' } } })
  expect(Object.keys(bytes(f.committedRoot))).toEqual(Object.keys(original))
})
it.each(['before-revision:0', 'before-revision:1', 'before-marker', 'before-rename'])('interruption at %s keeps old effective state and resumes deterministic generation', async boundary => {
  const f = setup()
  const planned = (await f.invoke())
  expect(planned?.kind).toBe('dry-run')
  const failed = (await f.invoke({ commit: true, onBoundary: (stage: string) => { if (stage === boundary) throw new Error('interrupted') } }))
  expect(failed?.kind).toBe('publication-failed')
  expect(api.readLabelCalibration(f.committedRoot).kind).toBe('absent')
  expect([...api.readCommittedCorpus(f.committedRoot).snapshot.labelsById.values()].every(label => label.weight === undefined)).toBe(true)
  expect((await f.invoke({ commit: true }))).toMatchObject({ kind: 'committed', artifact: planned.artifact })
})
it('keeps an existing marker through interrupted replacement and changes both weights only at publication', async () => {
  const f = setup(), first = (await f.invoke({ commit: true }))
  expect(first?.kind).toBe('committed')
  f.handoff.tests[0]!.steps[0]!.modelProfile!.modelId = 'gpt-5'
  f.handoff.tests[0]!.steps[0]!.subActions[1]!.callRecord!.resolvedModelId = 'gpt-5'
  f.persistRun(f.handoff)
  const planned = (await f.invoke())
  expect(planned?.refreshedCount).toBe(2)
  expect((await f.invoke({ commit: true, replace: true, onBoundary: (stage: string) => { if (stage === 'before-marker') throw new Error('stop') } }))?.kind).toBe('publication-failed')
  expect(api.readLabelCalibration(f.committedRoot)).toMatchObject({ kind: 'loaded', artifact: first.artifact })
  expect([...api.readCommittedCorpus(f.committedRoot).snapshot.labelsById.values()].map(label => label.weight?.capabilityTier)).toEqual(['degraded', 'degraded'])
  expect((await f.invoke({ commit: true, replace: true }))).toMatchObject({ kind: 'committed', artifact: planned.artifact })
  expect([...api.readCommittedCorpus(f.committedRoot).snapshot.labelsById.values()].map(label => label.weight?.capabilityTier)).toEqual(['full', 'full'])
})
it('refuses active lock contention and input drift without publishing', async () => {
  const f = setup(), before = bytes(f.committedRoot)
  write(f.committedRoot, '.label-calibration.lock', JSON.stringify({ pid: process.pid }))
  expect((await f.invoke({ commit: true }))?.kind).toBe('busy')
  rmSync(join(f.committedRoot, '.label-calibration.lock'))
  expect((await f.invoke({ commit: true, onBoundary: (stage: string) => { if (stage === 'after-lock') { f.handoff.tests[0]!.steps[0]!.modelProfile!.modelId = 'gpt-5'; f.persistRun(f.handoff) } } }))?.kind).toBe('input-drift')
  expect(bytes(f.committedRoot)).toEqual(before)
}, 15000)
it('checks every text through egress before writing any part', async () => {
  const f = setup()
  // Public detector vector in immutable provenance; a label revision must be checkpointed.
  for (const item of f.plan.cases) {
    const path = committedLabelPath('shop', item.cassetteId), label = JSON.parse(readFileSync(join(f.committedRoot, path), 'utf8'))
    label.label.verdict.reasoning = 'AKIAIOSFODNN7EXAMPLE'
    write(f.committedRoot, path, committedFileText(label))
  }
  const before = bytes(f.committedRoot)
  expect((await f.invoke({ commit: true }))?.kind).toBe('egress-blocked')
  expect(bytes(f.committedRoot)).toEqual(before)
})
it.each([0, 1, 2])('blocks egress part %i before all committed writes', async blockedIndex => {
  const f = setup(), before = bytes(f.committedRoot), checkpoint = safety.assertCommittedEgressSafe
  const spy = vi.spyOn(safety, 'assertCommittedEgressSafe').mockImplementation((parts, opts) => {
    expect(parts).toHaveLength(3)
    expect(opts.channel).toBe('eval-report')
    return checkpoint(parts.map((part, index) => index === blockedIndex ? { ...part, text: 'AKIAIOSFODNN7EXAMPLE' } : part), opts)
  })
  expect((await f.invoke({ commit: true }))?.kind).toBe('egress-blocked')
  expect(spy).toHaveBeenCalledOnce()
  expect(bytes(f.committedRoot)).toEqual(before)
})
it('previews every destination and refuses one conflicting revision before any other write', async () => {
  const f = setup(), before = bytes(f.committedRoot)
  const preview = api.FsCommittedRootStore.prototype.previewText
  const spy = vi.spyOn(api.FsCommittedRootStore.prototype, 'previewText').mockImplementation(function (this: api.FsCommittedRootStore, path, text) {
    return path.includes('d01-leaf--revision') ? 'conflict' : preview.call(this, path, text)
  })
  expect((await f.invoke({ commit: true }))?.kind).toBe('write-conflict')
  expect(spy).toHaveBeenCalledTimes(3)
  expect(bytes(f.committedRoot)).toEqual(before)
})
it('refuses marker drift at the last boundary while retaining the external marker bytes', async () => {
  const f = setup()
  expect((await f.invoke({ commit: true, onBoundary: (stage: string) => {
    if (stage === 'before-rename') write(f.committedRoot, 'labels/calibration.json', 'external marker')
  } }))?.kind).toBe('input-drift')
  expect(readFileSync(join(f.committedRoot, 'labels/calibration.json'), 'utf8')).toBe('external marker')
})
it('contains leaf-suffixed revision paths and refuses escaped destinations', async () => {
  const f = setup()
  expect((api as Record<string, any>).committedLabelRevisionPath?.('shop', 'run/member', 'a'.repeat(64))).toBe(`labels/shop/run/member--revision-${'a'.repeat(64)}.json`)
  expect(() => (api as Record<string, any>).committedLabelRevisionPath?.('shop', '../escape', 'a'.repeat(64))).toThrow()
  const outside = join(f.root, 'outside'); mkdirSync(outside)
  rmSync(join(f.committedRoot, 'labels/shop'), { recursive: true }); symlinkSync(outside, join(f.committedRoot, 'labels/shop'))
  expect((await f.invoke({ commit: true }))?.kind).toBe('refused')
  expect(bytes(outside)).toEqual({})
})
it('resumes after actual publisher process death using the existing stale-owner lock law', async () => {
  const f = setup(), planned = await f.invoke()
  const moduleUrl = pathToFileURL(join(process.cwd(), 'dist/index.js')).href
  const child = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import { runLabelCalibration } from ${JSON.stringify(moduleUrl)}; await runLabelCalibration({ ...JSON.parse(process.argv[1]), commit: true, onBoundary(stage) { if (stage === 'before-marker') process.exit(73) } })`,
    JSON.stringify({ committedRoot: f.committedRoot, agentQaRoot: f.agentQaRoot, reportOutputBaseDir: f.reportOutputBaseDir })], { encoding: 'utf8' })
  expect(child.status, child.stderr).toBe(73)
  expect(api.readLabelCalibration(f.committedRoot).kind).toBe('absent')
  expect(await f.invoke({ commit: true })).toMatchObject({ kind: 'committed', artifact: planned.artifact })
  expect(await f.invoke({ commit: true })).toMatchObject({ kind: 'unchanged', refreshedCount: 0, artifact: planned.artifact })
})
