/** Durable observations of successful curation effects; never lifecycle or write authority. */
import { randomUUID } from 'node:crypto'
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'

import { canonicalJson, sha256hex } from '@vostride/agent-qa-schema'
import { z } from 'zod'

import { checkpointCommittedParts, type BundleEgressOptions } from '../bundle-egress.js'
import { fsyncDirectory } from '../durable-fs.js'
import { withCurrentWriterAuthority, type CurrentWriterAuthority } from '../lease/writer-lease.js'
import { loadBundle, verifyBundleIntegrity } from '../bundle-read.js'
import { BundleTargetResolutionError, resolveProductQualifiedBundleDir } from '../bundle-scan.js'

export const COMPLETED_EFFECTS_SUBDIR = 'memory/queue/journal/completed-effects'
const digest = z.string().regex(/^[0-9a-f]{64}$/)
const deltaKind = z.enum(['Add', 'Confirm', 'Supersede', 'Deprecate', 'MintUnknown', 'Noop'])

/** The expected canonical change is recorded before any bundle publication. */
export const curationEffectSchema = z.object({
  recordId: z.string().min(1),
  product: z.string().min(1),
  change: z.enum(['added', 'confirmed', 'superseded', 'deprecated']),
  atOrdinal: z.number().int().nonnegative(),
  evidenceToken: z.string().min(1),
  byRecordId: z.string().min(1).optional(),
}).strict()
export type CurationEffect = z.infer<typeof curationEffectSchema>

const classificationFields = {
  sourceRunId: z.string().min(1),
  observationId: z.string().min(1),
  originalDeltaKind: deltaKind,
  appliedDeltaKind: deltaKind,
  disposition: z.enum(['apply', 'downgraded']),
  downgradeReason: z.string().min(1).optional(),
}

export const curationObservationSchema = z.object({
  schemaVersion: z.literal(1),
  ...classificationFields,
  effects: z.array(curationEffectSchema),
}).strict()
export type CurationObservation = z.infer<typeof curationObservationSchema>

export function effectIdentity(candidateId: string, effect: CurationEffect): string {
  return sha256hex(canonicalJson({ candidateId: digest.parse(candidateId), ...curationEffectSchema.parse(effect) }))
}

export const curationEffectReceiptSchema = z.object({
  schemaVersion: z.literal(1),
  candidateId: digest,
  effectId: digest,
  ...curationEffectSchema.shape,
  ...classificationFields,
}).strict().refine((row) => row.effectId === sha256hex(canonicalJson({ candidateId: row.candidateId,
  recordId: row.recordId, product: row.product, change: row.change,
  atOrdinal: row.atOrdinal, evidenceToken: row.evidenceToken,
  ...(row.byRecordId === undefined ? {} : { byRecordId: row.byRecordId }),
})), 'effect identity mismatch')
export type CurationEffectReceipt = z.infer<typeof curationEffectReceiptSchema>

function receiptRoot(knowledgeRoot: string): string {
  if (!isAbsolute(knowledgeRoot)) throw new TypeError('knowledgeRoot must be absolute')
  return join(knowledgeRoot, COMPLETED_EFFECTS_SUBDIR)
}
function receiptName(row: CurationEffectReceipt): string {
  return `${row.candidateId}-${row.effectId}.json`
}
function parseReceipt(text: string, name: string): CurationEffectReceipt {
  // Do not expose parser values or untrusted keys in diagnostics.
  try {
    const row = curationEffectReceiptSchema.parse(JSON.parse(text))
    if (receiptName(row) === name && text === `${canonicalJson(row)}\n`) return row
  } catch { /* fixed diagnostic below */ }
  throw new TypeError('invalid curation effect receipt')
}

/** Strict, deterministic, read-only; absence never creates the journal directory. */
export function listCurationEffectReceipts(knowledgeRoot: string): CurationEffectReceipt[] {
  const dir = receiptRoot(knowledgeRoot)
  let entries
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  return entries.filter((entry) => !entry.name.includes('.tmp-')).sort((a, b) => a.name.localeCompare(b.name)).map((entry) => {
    if (!entry.isFile() || !/^[0-9a-f]{64}-[0-9a-f]{64}\.json$/.test(entry.name)) {
      throw new TypeError('invalid curation effect receipt')
    }
    return parseReceipt(readFileSync(join(dir, entry.name), 'utf8'), entry.name)
  })
}

export interface WriteCurationEffectReceiptOptions extends BundleEgressOptions {
  knowledgeRoot: string
  authority: CurrentWriterAuthority
  receipt: CurationEffectReceipt
}

/** @internal Caller already holds the existing root writer authority section. */
export function writeCurationEffectReceiptWithinCurrentAuthority(opts: WriteCurationEffectReceiptOptions): void {
  const parsed = curationEffectReceiptSchema.safeParse(opts.receipt)
  if (!parsed.success) throw new TypeError('invalid curation effect receipt')
  const row = parsed.data
  const file = join(receiptRoot(opts.knowledgeRoot), receiptName(row))
  const text = `${canonicalJson(row)}\n`
  if (existsSync(file)) {
    const existing = parseReceipt(readFileSync(file, 'utf8'), receiptName(row))
    if (canonicalJson(existing) !== canonicalJson(row)) throw new TypeError('conflicting curation effect receipt')
    return
  }
  const checked = checkpointCommittedParts([{ label: 'curation-effect-receipt', text }], opts)
  if (checked.kind !== 'ok') throw new Error('curation effect receipt egress blocked')
  mkdirSync(dirname(file), { recursive: true })
  fsyncDirectory(dirname(dirname(file)))
  const temporary = `${file}.tmp-${randomUUID()}`
  let fd: number | undefined
  try {
    fd = openSync(temporary, 'wx')
    writeFileSync(fd, text, 'utf8')
    fsyncSync(fd)
    closeSync(fd)
    fd = undefined
    renameSync(temporary, file)
    fsyncDirectory(dirname(file))
  } finally {
    if (fd !== undefined) closeSync(fd)
    rmSync(temporary, { force: true })
  }
}

export function writeCurationEffectReceipt(opts: WriteCurationEffectReceiptOptions): void {
  withCurrentWriterAuthority(opts.knowledgeRoot, opts.authority, () => writeCurationEffectReceiptWithinCurrentAuthority(opts))
}

/** Check actual canonical bytes, never index presence or an intended effect alone. */
export function isCurationEffectCommitted(knowledgeRoot: string, candidateId: string, effect: CurationEffect): boolean {
  let dir: string
  try {
    dir = resolveProductQualifiedBundleDir({ knowledgeRoot, product: effect.product, recordId: effect.recordId }).dir
  } catch (error) {
    if (error instanceof BundleTargetResolutionError && error.reason === 'not-found') return false
    throw error
  }
  const loaded = loadBundle(dir)
  if (loaded.kind !== 'loaded' || !verifyBundleIntegrity(dir).ok) return false
  const { bundle } = loaded
  if (effect.change === 'added' && (
    bundle.provenance.mode !== 'run-linked'
    || bundle.provenance.curationJobId !== candidateId
    || bundle.manifest.createdAtOrdinal !== effect.atOrdinal
  )) return false
  return bundle.events.some((event) =>
    event.curationJobId === candidateId
    && event.evidenceToken === effect.evidenceToken
    && event.buildOrdinal === effect.atOrdinal
    && event.type === (effect.change === 'added' ? 'confirmed' : effect.change)
    && (effect.byRecordId === undefined || (event.type === 'superseded' && event.byRecordId === effect.byRecordId)),
  )
}

/** Shared live/recovery row construction, independent of the recovering writer's epoch. */
export function receiptForEffect(candidateId: string, observation: CurationObservation, effect: CurationEffect): CurationEffectReceipt {
  const { effects: _effects, ...classification } = observation
  return curationEffectReceiptSchema.parse({ ...classification, candidateId, ...effect, effectId: effectIdentity(candidateId, effect) })
}
