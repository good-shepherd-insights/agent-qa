import { sha256hex } from '@vostride/agent-qa-schema'
import { z } from 'zod'
import { canonicalJson } from '../canonical-json'
import { cassetteSchema } from '../cassette/schema'
import { actionWireSchema } from '../cassette/action-wire-schema'
import type { StandaloneLabelRecord } from './label-record'
import { ADVERSARIAL_MUTATORS, GENERATOR_KINDS } from './corpus-entry'

const digest = z.string().regex(/^[0-9a-f]{64}$/)
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const factor = z.number().finite().nonnegative()
const weightSchema = z.object({
  value: factor.max(1), k: count, n: count,
  verdictSource: z.enum(['user-gold', 'stable-pass-silver', 'unverified']),
  verdictFactor: factor, capabilityTier: z.enum(['full', 'degraded', 'floor']),
  tierFactor: factor, alpha0: factor, beta0: factor,
  corpusDigest: digest, evidenceDigest: digest,
  capabilityEvidence: z.object({
    kind: z.enum(['model-identity', 'deterministic', 'missing']),
    modelIdentity: z.object({ provider: z.string(), modelId: z.string() }).strict().optional(),
  }).strict(),
}).strict().refine(w => w.k <= w.n && Number.isFinite(w.alpha0 + w.beta0) && w.alpha0 + w.beta0 > 0)

// 2026-09-11, 422 D-06: the derived-gold marker, read STRICTLY. A derived record that names
// an unknown mutator, a non-digest table hash, or any key outside this shape is refused by the
// same reader every other persisted label goes through — a fresh committed-reader readback of a
// derived record is therefore already executable, rather than silently falling back to legacy
// bytes. Optional, so every pre-422 record still parses byte-for-byte as before.
//
// 2026-09-11, 422-02: the generator metadata is REQUIRED here, unlike on the corpus entry.
// The distinction is where the bytes came from. A committed adversarial ENTRY may predate
// 422 and legitimately name none of the three additive fields; a `derivedFrom` marker has no
// history at all — the 422 derivation engine is the only thing that has ever minted one, and
// it mints all three together. So a partial marker is not "an old record", it is a malformed
// one, and admitting it would mean inventing the generation a committed variant was derived
// under. The two seed identities must also agree: a marker that names one seed in its own
// field and another in its generator states a provenance that cannot be true.
const derivedFromSchema = z.object({
  seedCassetteId: z.string().min(1),
  generator: z.object({
    kind: z.enum(GENERATOR_KINDS),
    seedCassetteId: z.string().min(1),
    generatorVersion: count,
    mutator: z.enum(ADVERSARIAL_MUTATORS),
    tableVersion: count.min(1),
    tableHash: digest,
  }).strict(),
}).strict().refine(marker => marker.seedCassetteId === marker.generator.seedCassetteId, {
  message: 'derivedFrom.seedCassetteId must equal derivedFrom.generator.seedCassetteId',
})

const recordSchema = z.object({
  derivedFrom: derivedFromSchema.optional(),
  schemaVersion: z.literal(1), cassetteId: z.string().min(1),
  label: cassetteSchema.options[0].shape.label,
  supersedes: z.string().min(1).optional(),
  revision: z.object({ id: digest, predecessorId: digest, generationId: z.string().min(1).optional() }).strict().optional(),
  quarantine: z.literal('rerun-overturned').optional(), weight: weightSchema.optional(),
  pairState: z.object({ sameState: z.boolean(), screenStateHash: z.string(), pairedScreenStateHash: z.string() }).strict().optional(),
  provenance: z.object({
    sourceCassetteId: z.string().optional(), runId: z.string(), runSlug: z.string(),
    capturedAtOrdinal: count, receiptDigest: z.string(),
    rerun: z.object({ attempt: count, originalAttempt: count.optional(), originalEvidenceDigest: digest.optional() }).strict().optional(),
  }).strict(),
  correction: z.object({
    verdict: z.enum(['pass', 'fail']),
    overturnedVerdict: z.object({ pass: z.boolean(), reasoning: z.string() }).passthrough(),
    correctedExpectation: z.string().optional(), correctedAction: actionWireSchema.optional(), markId: z.string(),
  }).strict().optional(),
}).strict().refine(record => record.quarantine === undefined || (
  record.revision !== undefined && record.label.sourceChannel === 'recorded-verdict' && record.label.tier === 'silver'
))

export type LabelRecordParse = { ok: true; record: StandaloneLabelRecord } | { ok: false; issues: string }

/** Fixed diagnostics never echo untrusted persisted values. Legacy bytes are not normalized. */
export function parseStandaloneLabelRecord(value: unknown): LabelRecordParse {
  const parsed = recordSchema.safeParse(value)
  return parsed.success ? { ok: true, record: parsed.data as StandaloneLabelRecord }
    : { ok: false, issues: 'invalid standalone label record' }
}

function semantic(record: StandaloneLabelRecord) {
  const { revision: _revision, supersedes: _supersedes, ...content } = record
  return content
}

/** Legacy base hashes all original bytes; successors hash semantic bytes and predecessor only.
 * Generation authorization is deliberately outside content identity to avoid publication cycles.
 */
export function deriveLabelRevisionId(record: StandaloneLabelRecord): string {
  return sha256hex(canonicalJson(record.revision === undefined ? record : {
    content: semantic(record), predecessorId: record.revision.predecessorId,
  }))
}

/** Compare before adding predecessor identity, so repeated refreshes reuse the terminal. */
export function createLabelRevision(
  current: StandaloneLabelRecord,
  changes: Partial<Pick<StandaloneLabelRecord, 'weight' | 'quarantine' | 'provenance' | 'label'>>,
  generationId?: string,
): StandaloneLabelRecord {
  const desired = { ...current, ...changes }
  if (canonicalJson(semantic(current)) === canonicalJson(semantic(desired))) return current
  const predecessorId = current.revision?.id ?? deriveLabelRevisionId(current)
  const next = { ...desired, supersedes: predecessorId,
    revision: { id: '', predecessorId, ...(generationId === undefined ? {} : { generationId }) } }
  next.revision.id = deriveLabelRevisionId(next)
  return next
}

export type LabelHistoryRefusalReason = 'invalid-record' | 'conflicting-id' | 'conflicting-roots'
  | 'fork' | 'cycle' | 'dangling-predecessor' | 'foreign-predecessor'
  | 'revision-id-mismatch' | 'predecessor-mismatch' | 'immutable-identity-changed'
export interface LabelHistoryRefusal { cassetteId: string; reason: LabelHistoryRefusalReason }
export interface EffectiveLabelSelection {
  effective: ReadonlyMap<string, StandaloneLabelRecord>
  history: readonly unknown[]
  refusals: readonly LabelHistoryRefusal[]
  excludedLabelIds: ReadonlySet<string>
}

function immutable(record: StandaloneLabelRecord) {
  const { rerun: _rerun, ...provenance } = record.provenance
  const { weight: _weight, quarantine: _quarantine, ...content } = semantic(record)
  return { ...content, provenance }
}

/** Validate a whole cassette graph before exposing any terminal, regardless of input ordering. */
export function selectEffectiveLabels(
  history: readonly unknown[],
  options: { committedGenerationIds?: ReadonlySet<string> } = {},
): EffectiveLabelSelection {
  const groups = new Map<string, StandaloneLabelRecord[]>()
  const owners = new Map<string, Set<string>>()
  const failures = new Map<string, Set<LabelHistoryRefusalReason>>()
  const fail = (id: string, reason: LabelHistoryRefusalReason) => {
    const reasons = failures.get(id) ?? new Set<LabelHistoryRefusalReason>()
    reasons.add(reason)
    failures.set(id, reasons)
  }
  for (const raw of history) {
    const parsed = parseStandaloneLabelRecord(raw)
    if (!parsed.ok) {
      const id = typeof raw === 'object' && raw !== null && 'cassetteId' in raw && typeof raw.cassetteId === 'string' ? raw.cassetteId : ''
      fail(id, 'invalid-record')
      continue
    }
    const record = parsed.record
    if (record.revision?.generationId !== undefined && !options.committedGenerationIds?.has(record.revision.generationId)) continue
    const group = groups.get(record.cassetteId) ?? []
    group.push(record)
    groups.set(record.cassetteId, group)
    const id = record.revision?.id ?? deriveLabelRevisionId(record)
    const ids = owners.get(id) ?? new Set<string>()
    ids.add(record.cassetteId)
    owners.set(id, ids)
  }
  const effective = new Map<string, StandaloneLabelRecord>()
  const excludedLabelIds = new Set<string>()
  for (const cassetteId of [...groups.keys()].sort()) {
    const nodes = new Map<string, StandaloneLabelRecord>()
    for (const record of groups.get(cassetteId)!) {
      const id = record.revision?.id ?? deriveLabelRevisionId(record)
      if (nodes.has(id) && canonicalJson(nodes.get(id)) !== canonicalJson(record)) fail(cassetteId, 'conflicting-id')
      nodes.set(id, record)
    }
    const roots = [...nodes.values()].filter(record => record.revision === undefined)
    if (roots.length > 1) fail(cassetteId, 'conflicting-roots')
    const children = new Map<string, string[]>()
    for (const [id, record] of nodes) {
      const revision = record.revision
      if (revision === undefined) continue
      if (record.supersedes !== revision.predecessorId) fail(cassetteId, 'predecessor-mismatch')
      if (deriveLabelRevisionId(record) !== id) fail(cassetteId, 'revision-id-mismatch')
      const previous = nodes.get(revision.predecessorId)
      if (previous === undefined) fail(cassetteId, owners.has(revision.predecessorId) ? 'foreign-predecessor' : 'dangling-predecessor')
      else if (canonicalJson(immutable(previous)) !== canonicalJson(immutable(record))) fail(cassetteId, 'immutable-identity-changed')
      const siblings = children.get(revision.predecessorId) ?? []
      siblings.push(id)
      children.set(revision.predecessorId, siblings)
      if (siblings.length > 1) fail(cassetteId, 'fork')
    }
    const visited = new Set<string>()
    for (const id of nodes.keys()) {
      const path = new Set<string>()
      let cursor: string | undefined = id
      while (cursor !== undefined && nodes.has(cursor) && !visited.has(cursor)) {
        if (path.has(cursor)) {
          fail(cassetteId, 'cycle')
          break
        }
        path.add(cursor)
        cursor = nodes.get(cursor)?.revision?.predecessorId
      }
      for (const node of path) visited.add(node)
    }
    if (failures.has(cassetteId)) continue
    const terminal = [...nodes.entries()].find(([id]) => !children.has(id))?.[1]
    if (terminal !== undefined) {
      effective.set(cassetteId, terminal)
      if (terminal.quarantine !== undefined) excludedLabelIds.add(cassetteId)
    }
  }
  const refusals: LabelHistoryRefusal[] = []
  for (const cassetteId of [...failures.keys()].sort()) {
    excludedLabelIds.add(cassetteId)
    for (const reason of [...failures.get(cassetteId)!].sort()) refusals.push({ cassetteId, reason })
  }
  return { effective, history: [...history], refusals, excludedLabelIds }
}
