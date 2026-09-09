import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { calibrateLabels, canonicalJson } from '@vostride/agent-qa-eval'
import { ORIGIN_PRIORS, sha256hex } from '@vostride/agent-qa-schema'
import type { LabelCalibrationArtifact } from '@vostride/agent-qa-eval-local'

vi.mock('@vostride/agent-qa-eval-local', async original => {
  const actual = await original<typeof import('@vostride/agent-qa-eval-local')>()
  return { ...actual, readLabelCalibration: vi.fn(actual.readLabelCalibration) }
})
vi.mock('@vostride/agent-qa-agent-local', async original => {
  const actual = await original<typeof import('@vostride/agent-qa-agent-local')>()
  return { ...actual, composeLocalAgent: vi.fn(actual.composeLocalAgent),
    createKnowledgeReader: vi.fn(actual.createKnowledgeReader),
    createKnowledgeReview: vi.fn(actual.createKnowledgeReview) }
})
import { readLabelCalibration } from '@vostride/agent-qa-eval-local'
import { composeLocalAgent, createKnowledgeReader } from '@vostride/agent-qa-agent-local'
import { composeCliLocalAgent } from '../../composition/local-agent-host.js'
import { createReplayGateHost } from '../../gates/replay-gate-host.js'

let root: string
beforeEach(() => { vi.clearAllMocks(); root = mkdtempSync(join(tmpdir(), 'agent-qa-priors-cli-')) })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })
function fixture(precision = 0.75): LabelCalibrationArtifact {
  const report = calibrateLabels({ snapshot: { entries: [], labelsById: new Map() }, marks: [] })
  const mass = ORIGIN_PRIORS['agent-verified'].alpha + ORIGIN_PRIORS['agent-verified'].beta
  const body = { ...report, schemaVersion: 1 as const, evidenceDigest: sha256hex('synthetic evidence'), targetRevisions: [],
    channels: { ...report.channels, 'recorded-verdict': { status: 'calibrated' as const, n: 20, n_gold: 20,
      precision, wilson95: { lower: 0.1, upper: 0.9, halfWidth: 0.4 } } },
    priors: { 'agent-verified': { alpha: precision * mass, beta: (1 - precision) * mass } },
  }
  return { ...body, generationId: sha256hex(canonicalJson(body)) }
}
function writeArtifact(value: unknown) {
  const path = join(root, 'agent-qa-eval/labels/calibration.json')
  mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(value))
}
// Optional lookup gives the initial missing factory an assertion RED, never an import crash.
async function build() {
  const files = import.meta.glob('../trust-priors.ts')
  const module = await files['../trust-priors.ts']?.() as { buildTrustPriorsResolver?: (input: { configPath: string }) => any } | undefined
  return module?.buildTrustPriorsResolver?.({ configPath: join(root, 'agent-qa.config.yaml') })
}

it('resolves once and retains independent immutable old and new snapshots', async () => {
  const old = fixture(); writeArtifact(old)
  const first = await build()
  expect(first?.kind).toBe('ready')
  expect(first.resolve()).toEqual(old.priors)
  expect(first.disclosure).toEqual({ status: 'calibrated', digest: old.generationId,
    nByOrigin: { 'agent-verified': 20, 'agent-observed': 0 } })
  expect(Object.isFrozen(first.resolve())).toBe(true)
  expect(Object.isFrozen(first.resolve()['agent-verified'])).toBe(true)
  writeArtifact(fixture(0.25))
  expect(first.resolve()).toEqual(old.priors)
  expect(first.resolve()).toBe(first.resolve())
  expect(readLabelCalibration).toHaveBeenCalledTimes(1)
  const second = await build()
  expect(second.resolve()).toEqual(fixture(0.25).priors)
  expect(readLabelCalibration).toHaveBeenCalledTimes(2)
  expect(Object.keys(first.resolve())).toEqual(['agent-verified'])
  expect(JSON.stringify(first)).not.toMatch(/targetRevisions|goldSetDigest|channels|correction/)
})

it('distinguishes absent and uncalibrated fallback from a fixed safe refusal', async () => {
  const absent = await build()
  expect(absent?.kind).toBe('ready')
  expect(absent.resolve()).toBeUndefined()
  expect(absent.disclosure.status).toBe('provisional')
  const report = calibrateLabels({ snapshot: { entries: [], labelsById: new Map() }, marks: [] })
  const body = { ...report, schemaVersion: 1, evidenceDigest: sha256hex('fixture'), targetRevisions: [] }
  writeArtifact({ ...body, generationId: sha256hex(canonicalJson(body)) })
  const empty = await build()
  expect(empty.resolve()).toBeUndefined()
  expect(empty.disclosure.status).toBe('provisional')
  writeArtifact({ privateCorrection: 'never disclose this' })
  expect(await build()).toEqual({ kind: 'refused', reason: 'Trust prior calibration is invalid or unavailable; repair the committed calibration before composing this host.' })
})

it('production local host loads once and refuses malformed calibration before composition', async () => {
  writeArtifact(fixture())
  const host = composeCliLocalAgent({ configPath: join(root, 'agent-qa.config.yaml'), agentQaRoot: join(root, '.agent-qa'), confirm: undefined })
  try {
    const input = vi.mocked(composeLocalAgent).mock.calls.at(-1)![0]
    expect(input.resolveTrustPriors?.()).toEqual(fixture().priors)
    expect(readLabelCalibration).toHaveBeenCalledTimes(1)
    writeArtifact(fixture(0.25))
    expect(input.resolveTrustPriors?.()).toEqual(fixture().priors)
  } finally { await host.close() }
  writeArtifact({ privateCorrection: 'never disclose this' })
  expect(() => composeCliLocalAgent({ configPath: join(root, 'agent-qa.config.yaml'), agentQaRoot: join(root, '.agent-qa') })).toThrow('Trust prior calibration is invalid or unavailable')
  expect(composeLocalAgent).toHaveBeenCalledTimes(1)
})

it('standalone replay host binds a cached reader and refuses malformed data before any gate', async () => {
  writeArtifact(fixture())
  const deps = { configPath: join(root, 'agent-qa.config.yaml'), agentQaRoot: root,
    session: { config: { knowledge: { dir: 'knowledge' } } }, record: false, composition: {} } as never
  createReplayGateHost(deps)
  const resolver = vi.mocked(createKnowledgeReader).mock.calls.at(-1)?.[3]
  expect(resolver?.()).toEqual(fixture().priors)
  writeArtifact(fixture(0.25))
  expect(resolver?.()).toEqual(fixture().priors)
  expect(readLabelCalibration).toHaveBeenCalledTimes(1)
  writeArtifact({ secret: 'private mark' })
  expect(() => createReplayGateHost(deps)).toThrow('Trust prior calibration is invalid or unavailable')
})
