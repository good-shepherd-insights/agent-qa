import { lstatSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { z } from 'zod'
import { canonicalJson, deriveLabelRevisionId, parseStandaloneLabelRecord, selectEffectiveLabels, type LabelCalibrationReport, type StandaloneLabelRecord } from '@vostride/agent-qa-eval'
import { ORIGIN_PRIORS, sha256hex } from '@vostride/agent-qa-schema'
import { committedLabelPath } from './committed-root-store.js'

export const LABEL_CALIBRATION_PATH = 'labels/calibration.json'
export interface LabelCalibrationArtifact extends Omit<LabelCalibrationReport, 'minGold'> {
  schemaVersion: 1
  minGold: { value: number; source: 'default' | 'cli' }
  evidenceDigest: string
  generationId: string
  targetRevisions: readonly { cassetteId: string; revisionId: string }[]
}
export type LabelCalibrationRead =
  | { kind: 'absent' }
  | { kind: 'refused'; reason: string; targetCassetteIds?: readonly string[] }
  | { kind: 'loaded'; artifact: LabelCalibrationArtifact; authorizedRevisionIds: ReadonlySet<string> }

const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const unit = z.number().finite().min(0).max(1)
const digest = z.string().regex(/^[0-9a-f]{64}$/)
const noisy = z.union([
  z.object({ status: z.literal('uncalibrated'), n: count, n_gold: count }).strict(),
  z.object({ status: z.literal('calibrated'), n: count, n_gold: count, precision: unit,
    wilson95: z.object({ lower: unit, upper: unit, halfWidth: unit }).strict()
      .refine(v => v.lower <= v.upper),
  }).strict(),
])
const gold = z.object({ n_gold: count, precision: z.literal('by-construction') }).strict()
const prior = z.object({ alpha: z.number().finite().min(0), beta: z.number().finite().min(0) }).strict()
  .refine(v => Number.isFinite(v.alpha + v.beta) && v.alpha + v.beta > 0)
const rate = z.object({ numerator: count, denominator: count, rate: unit.optional() }).strict()
  .refine(v => v.numerator <= v.denominator && (v.denominator === 0 ? v.rate === undefined : v.rate === v.numerator / v.denominator))
const accuracy = z.object({ n: count, correct: count, accuracy: unit.optional() }).strict()
  .refine(v => v.correct <= v.n && (v.n === 0 ? v.accuracy === undefined : v.accuracy === v.correct / v.n))
const artifactSchema = z.object({
  schemaVersion: z.literal(1), generationId: digest, evidenceDigest: digest,
  corpusDigest: digest, goldSetDigest: digest,
  minGold: z.object({ value: count.min(2), source: z.enum(['default', 'cli']) }).strict(),
  channels: z.object({ 'recorded-verdict': noisy, 'self-heal-pair': noisy, 'user-mark': gold, 'overturned-verdict': gold }).strict(),
  priors: z.object({ 'agent-verified': prior.optional(), 'agent-observed': prior.optional() }).strict(),
  unchangedOrigins: z.tuple([z.literal('user'), z.literal('import')]),
  verifierFalsePassRate: rate, verifierFalseFailRate: rate,
  rootCauseClassifierAccuracy: z.object({ 'analyze-run': accuracy, 'deterministic-classifier': accuracy }).strict(),
  rootCauseClassifierGrain: z.literal('member/producer:app_bug-binary'),
  skippedCounts: z.object({ 'missing-source': count.optional(), 'invalid-gold': count.optional(), 'conflicting-truth': count.optional(), 'missing-verdict': count.optional(), 'missing-pairing': count.optional(), 'conflicting-observation': count.optional() }).strict(),
  targetRevisions: z.array(z.object({ cassetteId: z.string().min(1), revisionId: digest }).strict()),
}).strict()

/** Refuse symlinks at every existing segment, including a dangling leaf; never follow one. */
export function assertCalibrationPath(root: string, path: string): void {
  const base = resolve(root), full = resolve(path), rel = relative(base, full)
  if (rel === '..' || rel.startsWith('../') || rel.startsWith('/')) throw new Error('invalid calibration path')
  let cursor = full
  while (true) {
    try { if (lstatSync(cursor).isSymbolicLink()) throw new Error('invalid calibration path') }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    if (cursor === base) break
    const parent = dirname(cursor)
    if (parent === cursor) break
    cursor = parent
  }
}

export function calibrationGenerationId(body: Omit<LabelCalibrationArtifact, 'generationId'>): string {
  return sha256hex(canonicalJson(body))
}

/** Structural checks plus consistency between minimum, measured channels and emitted priors. */
export function guardLabelCalibration(value: unknown): LabelCalibrationArtifact | undefined {
  const parsed = artifactSchema.safeParse(value)
  if (!parsed.success) return undefined
  const artifact = parsed.data
  const { generationId, ...body } = artifact
  if (calibrationGenerationId(body) !== generationId) return undefined
  let previous: string | undefined
  for (const target of artifact.targetRevisions) {
    if (previous !== undefined && previous >= target.cassetteId) return undefined
    previous = target.cassetteId
  }
  for (const [channel, origin] of [['recorded-verdict', 'agent-verified'], ['self-heal-pair', 'agent-observed']] as const) {
    const row = artifact.channels[channel], emitted = artifact.priors[origin]
    if (row.n !== row.n_gold || (row.status === 'calibrated') !== (row.n >= artifact.minGold.value)) return undefined
    if (row.status === 'uncalibrated') { if (emitted !== undefined) return undefined }
    else {
      const mass = ORIGIN_PRIORS[origin].alpha + ORIGIN_PRIORS[origin].beta
      if (!emitted || emitted.alpha !== row.precision * mass || emitted.beta !== (1 - row.precision) * mass) return undefined
    }
  }
  return artifact
}

/** Independent marker loading: never calls the corpus reader and never grants a whole generation. */
export function readLabelCalibration(committedRoot: string): LabelCalibrationRead {
  const marker = join(committedRoot, LABEL_CALIBRATION_PATH)
  let targetCassetteIds: string[] | undefined
  try {
    assertCalibrationPath(committedRoot, marker)
    try { lstatSync(marker) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'absent' }
      throw error
    }
    const artifact = guardLabelCalibration(JSON.parse(readFileSync(marker, 'utf8')))
    if (!artifact) return { kind: 'refused', reason: 'invalid label calibration artifact' }
    targetCassetteIds = artifact.targetRevisions.map(target => target.cassetteId)
    const records = new Map<string, StandaloneLabelRecord>()
    function walk(directory: string): void {
      assertCalibrationPath(committedRoot, directory)
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name)
        if (entry.isDirectory()) { walk(path); continue }
        if (!entry.isFile() || !entry.name.endsWith('.json') || path === marker) continue
        let parsed
        try { parsed = parseStandaloneLabelRecord(JSON.parse(readFileSync(path, 'utf8'))) } catch { continue }
        if (!parsed.ok) continue
        const record = parsed.record, product = relative(join(committedRoot, 'labels'), path).split('/')[0]!
        const expected = join(committedRoot, committedLabelPath(product, record.cassetteId))
          .replace(/\.json$/, record.revision ? `--revision-${record.revision.id}.json` : '.json')
        if (expected !== path) continue
        const id = record.revision?.id ?? deriveLabelRevisionId(record)
        if (records.has(id)) throw new Error('duplicate label identity')
        records.set(id, record)
      }
    }
    walk(join(committedRoot, 'labels'))
    const authorizedRevisionIds = new Set<string>()
    for (const target of artifact.targetRevisions) {
      const chain: StandaloneLabelRecord[] = [], visited = new Set<string>(), generations = new Set<string>()
      let id: string | undefined = target.revisionId
      while (id !== undefined) {
        const record = records.get(id)
        if (!record || record.cassetteId !== target.cassetteId || visited.has(id)) throw new Error('incomplete label chain')
        visited.add(id); chain.push(record)
        if (record.revision?.generationId) generations.add(record.revision.generationId)
        id = record.revision?.predecessorId
      }
      const selected = selectEffectiveLabels(chain, { committedGenerationIds: generations })
      const terminal = selected.effective.get(target.cassetteId)
      if (selected.refusals.length || !terminal || (terminal.revision?.id ?? deriveLabelRevisionId(terminal)) !== target.revisionId) throw new Error('invalid label chain')
      for (const id of visited) authorizedRevisionIds.add(id)
    }
    return { kind: 'loaded', artifact, authorizedRevisionIds }
  } catch { return { kind: 'refused', reason: 'label calibration or target history unavailable', targetCassetteIds } }
}
