import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { calibrateLabels, canonicalJson } from '@vostride/agent-qa-eval'
import { sha256hex } from '@vostride/agent-qa-schema'
import { createKnowledgeChecks, type KnowledgeCheckProbes } from '../commands/doctor-knowledge-checks.js'

vi.mock('@vostride/agent-qa-eval-local', async original => {
  const actual = await original<typeof import('@vostride/agent-qa-eval-local')>()
  return { ...actual, readLabelCalibration: vi.fn(actual.readLabelCalibration) }
})
import { readLabelCalibration } from '@vostride/agent-qa-eval-local'

const roots: string[] = []
afterEach(() => { vi.clearAllMocks(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function project(knowledge = true) {
  const root = mkdtempSync(join(tmpdir(), 'agent-qa-doctor-calibration-')); roots.push(root)
  if (knowledge) mkdirSync(join(root, 'knowledge'))
  return { root, configPath: join(root, 'agent-qa.config.yaml'), config: { knowledge: { dir: 'knowledge' } } }
}
function artifact(verified = false, observed = false, stale = false) {
  const report = calibrateLabels({ snapshot: { entries: [], labelsById: new Map(), cassettesById: new Map(), blobPresentById: new Map() }, marks: [] })
  const body = { ...report, schemaVersion: 1, evidenceDigest: sha256hex('doctor fixture'), targetRevisions: [],
    goldSetDigest: stale ? sha256hex('old gold') : report.goldSetDigest,
    channels: { ...report.channels }, priors: { ...report.priors } }
  for (const [yes, channel, origin, mass, n] of [[verified, 'recorded-verdict', 'agent-verified', 3, 20], [observed, 'self-heal-pair', 'agent-observed', 2, 25]] as const) {
    if (!yes) continue
    body.channels[channel] = { status: 'calibrated', n, n_gold: n, precision: 0.5, wilson95: { lower: 0.3, upper: 0.7, halfWidth: 0.2 } }
    body.priors[origin] = { alpha: mass / 2, beta: mass / 2 }
  }
  return { ...body, generationId: sha256hex(canonicalJson(body)) }
}
function write(root: string, value: unknown) {
  const path = join(root, 'agent-qa-eval/labels/calibration.json')
  mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(value))
}
function tree(root: string): unknown {
  return readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
    .map(entry => [entry.name, entry.isDirectory() ? tree(join(root, entry.name)) : readFileSync(join(root, entry.name)).toString('hex')])
}
const probes: KnowledgeCheckProbes = {
  classifyIndexFace: () => ({ source: 'index' }),
  resolveEmbedderCapability: async () => ({ kind: 'lexical-only' }),
  readWriterLease: () => ({ kind: 'absent' }),
  buildPromotionPosture: async input => ({ kind: 'no-eval-root', committedRoot: join(dirname(input.configPath), 'agent-qa-eval') }),
}
it.each([false, true])('discloses absent calibration with knowledge=%s without creating any file', async knowledge => {
  const p = project(knowledge), before = tree(p.root)
  const checks = createKnowledgeChecks({ ...p, probes })
  const rows = await Promise.all(checks.map(row => row.check()))
  expect(rows[3]!.message).toContain('trust priors: provisional')
  expect(rows[3]!.message).toContain('label calibration: absent')
  expect(rows[3]!.status).toBe(knowledge ? 'warn' : 'skip')
  expect(tree(p.root)).toEqual(before)
  expect(readLabelCalibration).toHaveBeenCalledTimes(1)
})
it.each([[false, false], [true, false], [true, true]])('reports guarded channel n and current identity (%s/%s)', async (verified, observed) => {
  const p = project(), value = artifact(verified, observed); write(p.root, value)
  const before = tree(p.root), checks = createKnowledgeChecks({ ...p, probes })
  await Promise.all(checks.map(row => row.check()))
  const row = await checks[3].check()
  expect(row.message).toContain(`recorded-verdict ${verified ? 'calibrated' : 'uncalibrated'} n=${verified ? 20 : 0}`)
  expect(row.message).toContain(`self-heal-pair ${observed ? 'calibrated' : 'uncalibrated'} n=${observed ? 25 : 0}`)
  expect(row.message).toContain('goldDigest current')
  expect(row.message).toContain(verified ? `trust priors: calibrated@${value.generationId} (agent-verified n=20, agent-observed n=${observed ? 25 : 0})` : 'trust priors: provisional')
  expect(tree(p.root)).toEqual(before)
  expect(readLabelCalibration).toHaveBeenCalledTimes(1)
})
it('discloses stale gold by identity and never refreshes the artifact', async () => {
  const p = project(); write(p.root, artifact(true, false, true)); const before = tree(p.root)
  const row = await createKnowledgeChecks({ ...p, probes })[3].check()
  expect(row.message).toContain('goldDigest stale')
  expect(tree(p.root)).toEqual(before)
})
it.each([false, true])('refuses malformed evidence explicitly with knowledge=%s and no private text', async knowledge => {
  const p = project(knowledge); write(p.root, { privateCorrection: 'do not disclose' }); const before = tree(p.root)
  const row = await createKnowledgeChecks({ ...p, probes })[3].check()
  expect(row.message).toContain('label calibration: invalid or unavailable')
  expect(row.message).toContain('trust priors: unavailable')
  expect(row.message).not.toMatch(/provisional|do not disclose/)
  expect(row.status).toBe(knowledge ? 'fail' : 'skip')
  expect(tree(p.root)).toEqual(before)
  expect(readLabelCalibration).toHaveBeenCalledTimes(1)
})
