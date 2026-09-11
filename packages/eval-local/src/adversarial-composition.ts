// 2026-09-11, 422 D-01/D-02/D-03/D-06/D-07/D-08: the adversarial staging and admission
// composition — the 418 D-21 feedback idiom (gate2-composition.ts) pointed at generated
// cassettes instead of observed ones.
//
// Authority law (D-01): NOTHING here commits on its own. `stageAdversarialProposal` derives
// concrete bytes and publishes them as LOCAL AUDIT DATA under
// `.agent-qa/eval/adversarial/<product>/<batchDigest>`; `refreshAdversarialSplit` is the only
// function that touches the committed root, and its sole production caller is the explicit
// `eval adversarial --admit --batch <digest>` branch. An operator reviews real
// injection-shaped text before it can enter a git-tracked root.
//
// Checkpoint law (D-03): BOTH the generation-time scan and the admission-time recheck call
// `assertCommittedEgressSafe` with the HOST'S LOADED policy — a required parameter here, never
// a defaulted fallback — and `channel: 'eval-adversarial'`, over ALL THREE serialized
// documents of a case (cassette, standalone label, corpus entry). `injectionShape` defaults to
// `route`, so an injection probe fires an audit row and is still admitted; a `block` (or a
// non-user `redact`) hit becomes a typed `AdversarialRefusal` row and publishes no cassette.
// Rechecking at admission is what makes a policy tightened AFTER staging still bind.
//
// Exact-byte law (D-02): the reviewed manifest pins the sha256 of each staged document, and
// the batch digest is a function of those pins. Admission re-reads the staged bytes, re-hashes
// them against the manifest, re-derives the digest from the manifest's own case list, and
// requires the operator's `--batch` digest to equal both — so recomputing a manifest after an
// edit is not admission authority, it is a mismatch. Nothing is re-generated at admission: a
// regenerated label or a fresh timestamp would mean the operator reviewed other bytes.
//
// Blob law: referenced blob bytes are VALIDATED by content address against the seed's
// committed blobs and are never copied into staging. They are copied into the committed root
// only at admission, by the one sanctioned seeding writer, under the derived cassette's own
// path — which is what makes a fresh reader's blob closure resolvable.

import { createHash } from 'node:crypto'
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import {
  ADVERSARIAL_MUTATORS,
  ADVERSARIAL_TABLE_HASH,
  ADVERSARIAL_TABLE_VERSION,
  GENERATOR_KINDS,
  canonicalJson,
  cassetteEgressText,
  committedFileText,
  deriveRunSlug,
  generateAdversarialVariants,
  guardCassette,
  guardCorpusEntry,
  parseStandaloneLabelRecord,
  type AdversarialCorpusEntry,
  type AdversarialMutator,
  type AdversarialSeed,
  type AdversarialSeedSkip,
  type CorpusGenerator,
  type ExtractedBlob,
  type ExtractedCassette,
  type GeneratorKind,
  type LeafCassette,
  type SeedingPlan,
  type StandaloneLabelRecord,
} from '@vostride/agent-qa-eval'
import {
  CommittedEgressBlockedError,
  assertCommittedEgressSafe,
  defaultGuardrailPolicyInput,
  loadGuardrailPolicy,
  type AuditSink,
} from '@vostride/agent-qa-safety'
import { slugBranch, type GuardrailPolicy } from '@vostride/agent-qa-schema'
import { z } from 'zod'

import { committedBlobPath, committedCassettePath, committedCorpusPath, committedLabelPath } from './committed-root-store.js'
import { openCorpusReader } from './corpus-reader.js'
import { readCommittedCorpus } from './committed-corpus-source.js'
import { readCommittedCorpusDigest } from './gate2-composition.js'
import { seedCommittedCorpus, type SeedingBatchReport } from './seeding-composition.js'

/** Local staging root for reviewable adversarial batches (D-01, beside `eval/feedback`). */
export const ADVERSARIAL_STAGING_SUBDIR = 'eval/adversarial'

/** The ONE checkpoint channel both the generation scan and the admission recheck name (D-03). */
export const ADVERSARIAL_EGRESS_CHANNEL = 'eval-adversarial'

/** The reviewed manifest's file name inside a staged batch directory. */
export const ADVERSARIAL_MANIFEST_FILE = 'manifest.json'

const LOWER_HEX_64 = /^[0-9a-f]{64}$/
const digestField = z.string().regex(LOWER_HEX_64)

/**
 * The SEED's label identity as it stood when the batch was reviewed (D-06).
 *
 * This is the pin that a recomputed manifest cannot launder. Every other pin here describes
 * STAGED bytes, so an operator who edits a staged document and regenerates the manifest gets
 * a self-consistent manifest — with a different digest, which is already refused. This one is
 * checked against the seed's COMMITTED label at admission, so a derived record whose
 * provenance, channel or tier was rewritten to something the seed never had is refused even
 * if every staged pin agrees with itself.
 */
export interface AdversarialSeedProvenancePin {
  runId: string
  capturedAtOrdinal: number
  sourceChannel: string
  tier: string
}

/** One reviewed case, pinned by content address (D-02). */
export interface AdversarialBatchManifestCase {
  cassetteId: string
  seedCassetteId: string
  mutator: AdversarialMutator
  kind: GeneratorKind
  /** Disclosure of the drawn table entry; not part of the derived identity (D-08). */
  tableEntryId: string
  cassetteTextHash: string
  labelTextHash: string
  entryTextHash: string
  /** The ORIGINAL label identity the clone must still carry (D-06). */
  seedProvenance: AdversarialSeedProvenancePin
  /** The derived cassette's blob closure, validated against the seed's committed bytes. */
  blobShas: readonly string[]
}

/** The reviewed batch: what an operator admits with `--batch <digest>` (D-01/D-02). */
export interface AdversarialBatchManifest {
  schemaVersion: 1
  product: string
  /** sha256 over the pinned case list; equals the staging directory name. */
  batchDigest: string
  tableVersion: number
  tableHash: string
  /** Disclosure only — deliberately OUTSIDE the digest so re-staging is idempotent. */
  stagedAt: string
  cases: readonly AdversarialBatchManifestCase[]
}

const manifestCaseSchema = z.object({
  cassetteId: z.string().min(1),
  seedCassetteId: z.string().min(1),
  mutator: z.enum(ADVERSARIAL_MUTATORS),
  kind: z.enum(GENERATOR_KINDS),
  tableEntryId: z.string().min(1),
  cassetteTextHash: digestField,
  labelTextHash: digestField,
  entryTextHash: digestField,
  seedProvenance: z.object({
    runId: z.string().min(1),
    capturedAtOrdinal: z.number().int().nonnegative(),
    sourceChannel: z.string().min(1),
    tier: z.string().min(1),
  }).strict(),
  blobShas: z.array(digestField),
}).strict()

const manifestSchema = z.object({
  schemaVersion: z.literal(1),
  product: z.string().min(1),
  batchDigest: digestField,
  tableVersion: z.number().int().nonnegative(),
  tableHash: digestField,
  stagedAt: z.iso.datetime(),
  cases: z.array(manifestCaseSchema).min(1),
}).strict()

/**
 * A per-detector refusal row (D-03). A refused case publishes NO cassette; the refusal is
 * DATA on the report, never a thrown error, so one blocked variant never aborts a batch.
 */
export interface AdversarialRefusal {
  cassetteId: string
  seedCassetteId: string
  generator: GeneratorKind
  detector: string
  action: 'block' | 'redact'
}

/** Everything that stopped a derived case short of publication for a non-policy reason. */
export interface AdversarialStagingSkip {
  cassetteId: string
  seedCassetteId: string
  reason:
    | 'blob-unresolvable'
    | 'blob-hash-mismatch'
    | 'text-hash-mismatch'
    | 'manifest-digest-mismatch'
    | 'path-identity-mismatch'
    | 'seed-label-unavailable'
    | 'seed-provenance-mismatch'
}

export interface StageAdversarialProposalInput {
  agentQaRoot: string
  committedRoot: string
  product: string
  /** D-03: the host's LOADED policy, required — this composition never defaults one. */
  policy: GuardrailPolicy
  auditSink?: AuditSink
  mutators?: readonly AdversarialMutator[]
  maxSeeds?: number
  /** Derive and scan, publish nothing. */
  dryRun?: boolean
}

export interface StagedAdversarialCase {
  cassetteId: string
  seedCassetteId: string
  mutator: AdversarialMutator
  kind: GeneratorKind
  tableEntryId: string
}

export interface StageAdversarialProposalResult {
  kind: 'staged' | 'unchanged' | 'dry-run' | 'nothing-derived'
  product: string
  batchDigest?: string
  dir?: string
  staged: readonly StagedAdversarialCase[]
  refusals: readonly AdversarialRefusal[]
  skips: readonly AdversarialSeedSkip[]
  stagingSkips: readonly AdversarialStagingSkip[]
  seedsConsidered: number
  seedsDeferred: number
  tableVersion: number
  tableHash: string
}

/** A staged batch loaded back from disk with its bytes verified against the manifest pins. */
export interface StagedAdversarialBatch {
  dir: string
  manifest: AdversarialBatchManifest
  cases: readonly {
    manifest: AdversarialBatchManifestCase
    caseDir: string
    cassette: LeafCassette
    labelRecord: StandaloneLabelRecord
    corpusEntry: AdversarialCorpusEntry
    /** The EXACT reviewed bytes; admission never re-serializes from the parsed objects. */
    texts: { cassette: string; label: string; entry: string }
  }[]
}

export interface RefreshAdversarialSplitInput {
  agentQaRoot: string
  committedRoot: string
  product: string
  /** The reviewed batch digest the operator named; exact, never "the latest". */
  batchDigest: string
  /** D-03: the policy LOADED AT ADMISSION — a tightening since staging must bind. */
  policy: GuardrailPolicy
  auditSink?: AuditSink
  seedingOutputBaseDir: string
  dryRun?: boolean
}

export interface RefreshAdversarialSplitResult {
  kind: 'admitted' | 'dry-run' | 'refused'
  reason?: 'batch-not-found' | 'staging-integrity' | 'corpus-unavailable' | 'admission-refused'
  product: string
  batchDigest: string
  admitted: readonly StagedAdversarialCase[]
  refusals: readonly AdversarialRefusal[]
  stagingSkips: readonly AdversarialStagingSkip[]
  previousCorpusDigest?: string
  nextCorpusDigest?: string
  writesStarted: boolean
}

// ---------------------------------------------------------------------------
// Guarded local IO (the gate2 staging posture, verbatim in spirit).
// ---------------------------------------------------------------------------

function pathPresent(path: string): boolean {
  try {
    lstatSync(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

/** Refuse links and wrong-kind ancestors rather than following audit paths out of their root. */
function requireDirectories(path: string): void {
  const absolute = resolve(path)
  const parent = dirname(absolute)
  if (parent !== absolute) requireDirectories(parent)
  if (pathPresent(absolute) && !lstatSync(absolute).isDirectory()) {
    throw new TypeError('unsafe adversarial staging directory')
  }
}

function directoryNames(path: string): string[] {
  requireDirectories(path)
  if (!pathPresent(path)) return []
  return readdirSync(path, { withFileTypes: true })
    .map(entry => {
      if (!entry.isDirectory()) throw new TypeError('unexpected adversarial staging path')
      return entry.name
    })
    .sort()
}

/** A staged document is only readable as a REGULAR file inside its own case directory. */
function readStagedFile(caseDir: string, name: string): string {
  const file = join(caseDir, name)
  if (!pathPresent(file) || !lstatSync(file).isFile()) {
    throw new TypeError('unsafe adversarial staging file')
  }
  return readFileSync(file, 'utf8')
}

function textHash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/** The four label facts D-06 forbids a derivation from changing. */
function seedProvenancePin(record: StandaloneLabelRecord): AdversarialSeedProvenancePin {
  return {
    runId: record.provenance.runId,
    capturedAtOrdinal: record.provenance.capturedAtOrdinal,
    sourceChannel: record.label.sourceChannel,
    tier: record.label.tier,
  }
}

function samePin(left: AdversarialSeedProvenancePin, right: AdversarialSeedProvenancePin): boolean {
  return (
    left.runId === right.runId &&
    left.capturedAtOrdinal === right.capturedAtOrdinal &&
    left.sourceChannel === right.sourceChannel &&
    left.tier === right.tier
  )
}

function adversarialProductDir(agentQaRoot: string, product: string): string {
  return join(realpathSync(agentQaRoot), ADVERSARIAL_STAGING_SUBDIR, slugBranch(product))
}

function caseDirName(index: number): string {
  return `case-${String(index).padStart(4, '0')}`
}

/**
 * The batch digest (D-02). `stagedAt` is deliberately absent: two refreshes that derive the
 * same cases must address the same directory, so re-staging is an idempotent no-op rather
 * than an unbounded pile of near-identical batches.
 */
export function computeAdversarialBatchDigest(
  product: string,
  cases: readonly AdversarialBatchManifestCase[],
): string {
  return createHash('sha256')
    .update(
      canonicalJson({
        schemaVersion: 1,
        product,
        tableVersion: ADVERSARIAL_TABLE_VERSION,
        tableHash: ADVERSARIAL_TABLE_HASH,
        cases,
      }),
      'utf8',
    )
    .digest('hex')
}

// ---------------------------------------------------------------------------
// The ONE checkpoint helper both legs call (D-03).
// ---------------------------------------------------------------------------

interface CaseTexts {
  cassetteId: string
  seedCassetteId: string
  kind: GeneratorKind
  /** The scan VIEW of the cassette; the committed bytes are `texts.cassette`. */
  scanView: string
  texts: { cassette: string; label: string; entry: string }
}

/**
 * Scan all three serialized documents of one case on the adversarial channel.
 *
 * Only `CommittedEgressBlockedError` becomes refusal data — every other error is a real
 * operational failure and propagates. A blocked case yields one row PER firing detector so
 * the report names what actually tripped, not just that something did.
 */
function scanCase(
  input: CaseTexts,
  opts: { policy: GuardrailPolicy; auditSink?: AuditSink },
): readonly AdversarialRefusal[] {
  try {
    assertCommittedEgressSafe(
      [
        { label: `cassette:${input.cassetteId}`, text: input.scanView },
        { label: `label:${input.cassetteId}`, text: input.texts.label },
        { label: `corpus:${input.cassetteId}`, text: input.texts.entry },
      ],
      {
        policy: opts.policy,
        channel: ADVERSARIAL_EGRESS_CHANNEL,
        ...(opts.auditSink === undefined ? {} : { auditSink: opts.auditSink }),
      },
    )
    return []
  } catch (error) {
    if (!(error instanceof CommittedEgressBlockedError)) throw error
    return error.blocked.map(blocked => ({
      cassetteId: input.cassetteId,
      seedCassetteId: input.seedCassetteId,
      generator: input.kind,
      detector: blocked.detector,
      action: blocked.action,
    }))
  }
}

/**
 * Resolve the derived cassette's blob closure from the SEED's committed blobs, by content
 * address. Nothing is copied here; the bytes are proof that the closure is admissible.
 */
function resolveSeedBlobs(
  committedRoot: string,
  product: string,
  seedCassetteId: string,
  shas: readonly string[],
): { blobs: ExtractedBlob[] } | { skipReason: AdversarialStagingSkip['reason'] } {
  const blobs: ExtractedBlob[] = []
  for (const sha of shas) {
    if (!LOWER_HEX_64.test(sha)) return { skipReason: 'blob-hash-mismatch' }
    const file = join(committedRoot, committedBlobPath(product, seedCassetteId, sha))
    let bytes: Buffer
    try {
      if (!lstatSync(file).isFile()) return { skipReason: 'blob-unresolvable' }
      bytes = readFileSync(file)
    } catch {
      return { skipReason: 'blob-unresolvable' }
    }
    if (createHash('sha256').update(bytes).digest('hex') !== sha) {
      return { skipReason: 'blob-hash-mismatch' }
    }
    blobs.push({ sha, bytes })
  }
  return { blobs }
}

// ---------------------------------------------------------------------------
// Stage (D-01/D-02): derive concrete bytes, scan them, publish LOCAL audit data.
// ---------------------------------------------------------------------------

/**
 * Derive and stage one reviewable adversarial batch for a product.
 *
 * Seeds come from a FRESH `/reader` snapshot of the committed root, so a private held-out
 * entry is structurally unreachable — the proposer's door is the same door this uses.
 * Nothing under the committed root is written, read-modified, or re-digested.
 */
export function stageAdversarialProposal(
  input: StageAdversarialProposalInput,
): StageAdversarialProposalResult {
  const reader = openCorpusReader(input.committedRoot)
  const entries = reader.listEntries(input.product)
  const seeds: AdversarialSeed[] = []
  const existingCassetteIds = new Set<string>()
  for (const entry of entries) {
    existingCassetteIds.add(entry.cassetteId)
    if (entry.split !== 'natural') continue
    const cassette = reader.loadCassette(entry.cassetteId)
    if (cassette.kind !== 'loaded' || cassette.cassette.granularity !== 'leaf') continue
    const label = reader.loadLabel(entry.cassetteId)
    seeds.push({
      cassette: cassette.cassette,
      entry,
      ...(label.kind === 'loaded' ? { label: label.record } : {}),
    })
  }
  // Anything already staged is also already derived: D-04's idempotence key spans both.
  for (const batch of listStagedAdversarial({ agentQaRoot: input.agentQaRoot, product: input.product })) {
    for (const staged of batch.manifest.cases) existingCassetteIds.add(staged.cassetteId)
  }

  const generated = generateAdversarialVariants({
    product: input.product,
    seeds,
    existingCassetteIds,
    ...(input.mutators === undefined ? {} : { mutators: input.mutators }),
    ...(input.maxSeeds === undefined ? {} : { maxSeeds: input.maxSeeds }),
  })

  const refusals: AdversarialRefusal[] = []
  const stagingSkips: AdversarialStagingSkip[] = []
  const publishable: {
    manifestCase: AdversarialBatchManifestCase
    texts: { cassette: string; label: string; entry: string }
  }[] = []

  for (const variant of generated.variants) {
    const texts = {
      cassette: committedFileText(variant.cassette),
      label: committedFileText(variant.labelRecord),
      entry: committedFileText(variant.corpusEntry),
    }
    const caseRefusals = scanCase(
      {
        cassetteId: variant.cassette.id,
        seedCassetteId: variant.seedCassetteId,
        kind: variant.generator.kind,
        scanView: cassetteEgressText(variant.cassette),
        texts,
      },
      { policy: input.policy, ...(input.auditSink === undefined ? {} : { auditSink: input.auditSink }) },
    )
    if (caseRefusals.length > 0) {
      refusals.push(...caseRefusals)
      continue
    }
    const resolved = resolveSeedBlobs(
      input.committedRoot,
      input.product,
      variant.seedCassetteId,
      variant.blobShas,
    )
    if ('skipReason' in resolved) {
      stagingSkips.push({
        cassetteId: variant.cassette.id,
        seedCassetteId: variant.seedCassetteId,
        reason: resolved.skipReason,
      })
      continue
    }
    publishable.push({
      manifestCase: {
        cassetteId: variant.cassette.id,
        seedCassetteId: variant.seedCassetteId,
        mutator: variant.mutator,
        kind: variant.generator.kind,
        tableEntryId: variant.tableEntryId,
        cassetteTextHash: textHash(texts.cassette),
        labelTextHash: textHash(texts.label),
        entryTextHash: textHash(texts.entry),
        seedProvenance: seedProvenancePin(variant.labelRecord),
        blobShas: [...variant.blobShas],
      },
      texts,
    })
  }

  // One deterministic order for the manifest, the directory layout and the digest.
  publishable.sort((left, right) =>
    left.manifestCase.cassetteId < right.manifestCase.cassetteId
      ? -1
      : left.manifestCase.cassetteId > right.manifestCase.cassetteId
        ? 1
        : 0,
  )

  const base: Omit<StageAdversarialProposalResult, 'kind'> = {
    product: input.product,
    staged: publishable.map(row => ({
      cassetteId: row.manifestCase.cassetteId,
      seedCassetteId: row.manifestCase.seedCassetteId,
      mutator: row.manifestCase.mutator,
      kind: row.manifestCase.kind,
      tableEntryId: row.manifestCase.tableEntryId,
    })),
    refusals,
    skips: generated.skips,
    stagingSkips,
    seedsConsidered: generated.seedsConsidered,
    seedsDeferred: generated.seedsDeferred,
    tableVersion: ADVERSARIAL_TABLE_VERSION,
    tableHash: ADVERSARIAL_TABLE_HASH,
  }
  if (publishable.length === 0) return { ...base, kind: 'nothing-derived' }

  const cases = publishable.map(row => row.manifestCase)
  const batchDigest = computeAdversarialBatchDigest(input.product, cases)
  const productDir = adversarialProductDir(input.agentQaRoot, input.product)
  const dir = join(productDir, batchDigest)
  if (input.dryRun === true) return { ...base, kind: 'dry-run', batchDigest, dir }

  requireDirectories(productDir)
  if (pathPresent(dir)) return { ...base, kind: 'unchanged', batchDigest, dir }

  const manifest: AdversarialBatchManifest = {
    schemaVersion: 1,
    product: input.product,
    batchDigest,
    tableVersion: ADVERSARIAL_TABLE_VERSION,
    tableHash: ADVERSARIAL_TABLE_HASH,
    stagedAt: new Date().toISOString(),
    cases,
  }

  let temporary: string | undefined
  try {
    mkdirSync(productDir, { recursive: true })
    temporary = mkdtempSync(join(productDir, '.pending-'))
    writeFileSync(join(temporary, ADVERSARIAL_MANIFEST_FILE), committedFileText(manifest), { flag: 'wx' })
    for (const [index, row] of publishable.entries()) {
      const caseDir = join(temporary, caseDirName(index))
      mkdirSync(caseDir)
      writeFileSync(join(caseDir, 'cassette.json'), row.texts.cassette, { flag: 'wx' })
      writeFileSync(join(caseDir, 'label.json'), row.texts.label, { flag: 'wx' })
      writeFileSync(join(caseDir, 'entry.json'), row.texts.entry, { flag: 'wx' })
    }
    // Publish once, fully validated. An existing published batch is nonempty and cannot be
    // replaced by rename; a competitor is reported as 'unchanged', never as a fresh stage.
    if (pathPresent(dir)) return { ...base, kind: 'unchanged', batchDigest, dir }
    renameSync(temporary, dir)
    temporary = undefined
    return { ...base, kind: 'staged', batchDigest, dir }
  } finally {
    if (temporary !== undefined) rmSync(temporary, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------
// List (D-02): read staged batches back with every pin re-checked.
// ---------------------------------------------------------------------------

/**
 * Load staged batches, verifying identity at every level: the directory name IS the manifest
 * digest, the digest recomputed from the manifest's own case list equals it, and each staged
 * document re-hashes to its pinned value. A structural violation throws — a tampered batch is
 * never handed back as if it were reviewable.
 */
export function listStagedAdversarial(input: {
  agentQaRoot: string
  product?: string
  batchDigest?: string
}): StagedAdversarialBatch[] {
  if (!pathPresent(input.agentQaRoot)) return []
  const root = join(realpathSync(input.agentQaRoot), ADVERSARIAL_STAGING_SUBDIR)
  const products = input.product === undefined ? directoryNames(root) : [slugBranch(input.product)]
  const batches: StagedAdversarialBatch[] = []
  for (const productSlug of products) {
    const productDir = join(root, productSlug)
    if (!pathPresent(productDir)) continue
    for (const batchDigest of directoryNames(productDir)) {
      if (batchDigest.startsWith('.pending-')) continue
      if (input.batchDigest !== undefined && input.batchDigest !== batchDigest) continue
      const dir = join(productDir, batchDigest)
      const manifest = manifestSchema.parse(
        JSON.parse(readStagedFile(dir, ADVERSARIAL_MANIFEST_FILE)),
      ) as AdversarialBatchManifest
      if (slugBranch(manifest.product) !== productSlug || manifest.batchDigest !== batchDigest) {
        throw new TypeError('adversarial staging path identity mismatch')
      }
      if (input.product !== undefined && input.product !== manifest.product) {
        throw new TypeError('adversarial staging path identity mismatch')
      }
      if (computeAdversarialBatchDigest(manifest.product, manifest.cases) !== manifest.batchDigest) {
        throw new TypeError('adversarial manifest digest mismatch')
      }
      const cases: StagedAdversarialBatch['cases'] = manifest.cases.map((manifestCase, index) => {
        const caseDir = join(dir, caseDirName(index))
        const texts = {
          cassette: readStagedFile(caseDir, 'cassette.json'),
          label: readStagedFile(caseDir, 'label.json'),
          entry: readStagedFile(caseDir, 'entry.json'),
        }
        if (
          textHash(texts.cassette) !== manifestCase.cassetteTextHash ||
          textHash(texts.label) !== manifestCase.labelTextHash ||
          textHash(texts.entry) !== manifestCase.entryTextHash
        ) {
          throw new TypeError('adversarial staged text hash mismatch')
        }
        const cassette = guardCassette(JSON.parse(texts.cassette))
        if (cassette.granularity !== 'leaf' || cassette.id !== manifestCase.cassetteId) {
          throw new TypeError('adversarial staged cassette identity mismatch')
        }
        const parsedLabel = parseStandaloneLabelRecord(JSON.parse(texts.label))
        if (!parsedLabel.ok || parsedLabel.record.cassetteId !== manifestCase.cassetteId) {
          throw new TypeError('adversarial staged label rejected')
        }
        const corpusEntry = guardCorpusEntry(JSON.parse(texts.entry))
        if (corpusEntry.split !== 'adversarial' || corpusEntry.cassetteId !== manifestCase.cassetteId) {
          throw new TypeError('adversarial staged entry identity mismatch')
        }
        if (
          corpusEntry.generator.seedCassetteId !== manifestCase.seedCassetteId ||
          corpusEntry.generator.kind !== manifestCase.kind ||
          corpusEntry.generator.mutator !== manifestCase.mutator
        ) {
          throw new TypeError('adversarial staged provenance mismatch')
        }
        return { manifest: manifestCase, caseDir, cassette, labelRecord: parsedLabel.record, corpusEntry, texts }
      })
      batches.push({ dir, manifest, cases })
    }
  }
  return batches
}

// ---------------------------------------------------------------------------
// Admit (D-01): the ONLY writer of adversarial entries into the committed root.
// ---------------------------------------------------------------------------

/**
 * Commit ONE reviewed batch, named by its digest.
 *
 * The order is deliberate: integrity first (nothing is trusted because it is on disk), then
 * the admission-time checkpoint under the policy loaded NOW, then blob resolution, then the
 * one sanctioned seeding writer, then a byte-verification of what actually landed. Only a
 * case whose committed bytes equal the reviewed bytes counts as admitted.
 */
export function refreshAdversarialSplit(
  input: RefreshAdversarialSplitInput,
): RefreshAdversarialSplitResult {
  const base = {
    product: input.product,
    batchDigest: input.batchDigest,
    admitted: [] as StagedAdversarialCase[],
    refusals: [] as AdversarialRefusal[],
    stagingSkips: [] as AdversarialStagingSkip[],
    writesStarted: false,
  }
  if (!LOWER_HEX_64.test(input.batchDigest)) {
    return { ...base, kind: 'refused', reason: 'batch-not-found' }
  }
  const previous = readCommittedCorpusDigest({ committedRoot: input.committedRoot })
  if (previous.kind !== 'digest') return { ...base, kind: 'refused', reason: 'corpus-unavailable' }

  let batch: StagedAdversarialBatch | undefined
  try {
    batch = listStagedAdversarial({
      agentQaRoot: input.agentQaRoot,
      product: input.product,
      batchDigest: input.batchDigest,
    })[0]
  } catch (error) {
    // A tampered batch is an integrity refusal, not an operational failure — and it happens
    // BEFORE any committed byte is read for writing, so the corpus digest cannot have moved.
    // An UNRELATED IO failure (an unreadable staging dir, a permissions error) is NOT laundered
    // into a refusal: it propagates as the typed operational failure it is, because reporting
    // "this batch is tampered" when the disk was merely unreadable would be a false accusation.
    if (!(error instanceof TypeError) && !(error instanceof z.ZodError) && !(error instanceof SyntaxError)) {
      throw error
    }
    return {
      ...base,
      kind: 'refused',
      reason: 'staging-integrity',
      previousCorpusDigest: previous.corpusDigest,
    }
  }
  if (batch === undefined) {
    return { ...base, kind: 'refused', reason: 'batch-not-found', previousCorpusDigest: previous.corpusDigest }
  }

  const refusals: AdversarialRefusal[] = []
  const stagingSkips: AdversarialStagingSkip[] = []
  const admissible: {
    manifestCase: AdversarialBatchManifestCase
    cassette: LeafCassette
    labelRecord: StandaloneLabelRecord
    corpusEntry: AdversarialCorpusEntry
    texts: { cassette: string; label: string; entry: string }
    blobs: ExtractedBlob[]
  }[] = []

  // ONE fresh reader snapshot for the whole admission: the seed labels it answers with are
  // COMMITTED bytes, which is what makes the provenance pin unforgeable from staging.
  const committedReader = openCorpusReader(input.committedRoot)

  for (const staged of batch.cases) {
    // D-06 against committed truth: the clone must still carry the SEED's run, build ordinal,
    // channel and tier — both as reviewed (the manifest pin) and as the root records them now.
    const seedLabel = committedReader.loadLabel(staged.manifest.seedCassetteId)
    if (seedLabel.kind !== 'loaded') {
      stagingSkips.push({
        cassetteId: staged.manifest.cassetteId,
        seedCassetteId: staged.manifest.seedCassetteId,
        reason: 'seed-label-unavailable',
      })
      continue
    }
    const derivedPin = seedProvenancePin(staged.labelRecord)
    if (
      !samePin(derivedPin, staged.manifest.seedProvenance) ||
      !samePin(derivedPin, seedProvenancePin(seedLabel.record)) ||
      staged.labelRecord.derivedFrom?.seedCassetteId !== staged.manifest.seedCassetteId
    ) {
      stagingSkips.push({
        cassetteId: staged.manifest.cassetteId,
        seedCassetteId: staged.manifest.seedCassetteId,
        reason: 'seed-provenance-mismatch',
      })
      continue
    }
    // Exact-byte admission: the bytes about to be committed must re-serialize identically
    // from the parsed documents, or the reviewed text and the committed text are not one
    // thing. This is what makes "the operator reviewed THESE bytes" a checkable claim.
    if (
      committedFileText(staged.cassette) !== staged.texts.cassette ||
      committedFileText(staged.labelRecord) !== staged.texts.label ||
      committedFileText(staged.corpusEntry) !== staged.texts.entry
    ) {
      stagingSkips.push({
        cassetteId: staged.manifest.cassetteId,
        seedCassetteId: staged.manifest.seedCassetteId,
        reason: 'text-hash-mismatch',
      })
      continue
    }
    const caseRefusals = scanCase(
      {
        cassetteId: staged.manifest.cassetteId,
        seedCassetteId: staged.manifest.seedCassetteId,
        kind: staged.manifest.kind,
        scanView: cassetteEgressText(staged.cassette),
        texts: staged.texts,
      },
      { policy: input.policy, ...(input.auditSink === undefined ? {} : { auditSink: input.auditSink }) },
    )
    if (caseRefusals.length > 0) {
      refusals.push(...caseRefusals)
      continue
    }
    const resolved = resolveSeedBlobs(
      input.committedRoot,
      input.product,
      staged.manifest.seedCassetteId,
      staged.manifest.blobShas,
    )
    if ('skipReason' in resolved) {
      stagingSkips.push({
        cassetteId: staged.manifest.cassetteId,
        seedCassetteId: staged.manifest.seedCassetteId,
        reason: resolved.skipReason,
      })
      continue
    }
    admissible.push({
      manifestCase: staged.manifest,
      cassette: staged.cassette,
      labelRecord: staged.labelRecord,
      corpusEntry: staged.corpusEntry,
      texts: staged.texts,
      blobs: resolved.blobs,
    })
  }

  const result: RefreshAdversarialSplitResult = {
    ...base,
    kind: 'admitted',
    refusals,
    stagingSkips,
    previousCorpusDigest: previous.corpusDigest,
  }
  if (input.dryRun === true) {
    return {
      ...result,
      kind: 'dry-run',
      admitted: admissible.map(row => stagedCaseOf(row.manifestCase)),
    }
  }
  if (admissible.length === 0) {
    return { ...result, kind: 'refused', reason: 'admission-refused', nextCorpusDigest: previous.corpusDigest }
  }

  const batches = admissible.map(row => {
    const runId = row.corpusEntry.run_links.runId
    const plan: SeedingPlan = {
      product: input.product,
      runId,
      runSlug: deriveRunSlug(runId),
      cases: [
        {
          cassetteId: row.cassette.id,
          labelRecord: row.labelRecord,
          corpusEntry: row.corpusEntry,
        },
      ],
      pairSkips: [],
      silverExclusions: [],
      pairCounts: { total: 0, sameState: 0, differingState: 0 },
      proceduresExcludedCount: 0,
    }
    const cassettes: ExtractedCassette[] = [{ cassette: row.cassette, blobs: row.blobs }]
    return { plan, cassettes }
  })

  const admitted: StagedAdversarialCase[] = []
  let seeded: SeedingBatchReport | undefined
  result.writesStarted = true
  try {
    seeded = seedCommittedCorpus({
      batches,
      committedRoot: input.committedRoot,
      seedingOutputBaseDir: input.seedingOutputBaseDir,
      policy: input.policy,
      ...(input.auditSink === undefined ? {} : { auditSink: input.auditSink }),
    })
  } catch {
    seeded = undefined
  }
  for (const [index, row] of admissible.entries()) {
    const report = seeded?.reports[index]
    if (report === undefined || report.refusals.length > 0) {
      stagingSkips.push({
        cassetteId: row.cassette.id,
        seedCassetteId: row.manifestCase.seedCassetteId,
        reason: 'text-hash-mismatch',
      })
      continue
    }
    // Neither aggregate counts nor the absence of an exception is evidence: verify the bytes.
    let verified = false
    try {
      verified =
        readFileSync(join(input.committedRoot, committedCassettePath(input.product, row.cassette.id)), 'utf8') === row.texts.cassette &&
        readFileSync(join(input.committedRoot, committedLabelPath(input.product, row.cassette.id)), 'utf8') === row.texts.label &&
        readFileSync(join(input.committedRoot, committedCorpusPath(input.product, row.cassette.id)), 'utf8') === row.texts.entry &&
        row.blobs.every(blob =>
          readFileSync(join(input.committedRoot, committedBlobPath(input.product, row.cassette.id, blob.sha))).equals(
            Buffer.from(blob.bytes),
          ),
        )
    } catch {
      verified = false
    }
    if (!verified) {
      stagingSkips.push({
        cassetteId: row.cassette.id,
        seedCassetteId: row.manifestCase.seedCassetteId,
        reason: 'text-hash-mismatch',
      })
      continue
    }
    admitted.push(stagedCaseOf(row.manifestCase))
  }

  // Retire the staged batch only when every reviewed case actually landed; a partial batch
  // stays on disk so the operator can see what did not.
  if (admitted.length === batch.cases.length) {
    try {
      rmSync(batch.dir, { recursive: true })
    } catch {
      // Cleanup failure is not un-admission; the bytes are verified in the committed root.
    }
  }

  const next = readCommittedCorpusDigest({ committedRoot: input.committedRoot })
  return {
    ...result,
    kind: admitted.length === 0 ? 'refused' : 'admitted',
    ...(admitted.length === 0 ? { reason: 'admission-refused' as const } : {}),
    admitted,
    refusals,
    stagingSkips,
    writesStarted: true,
    ...(next.kind === 'digest' ? { nextCorpusDigest: next.corpusDigest } : {}),
  }
}

function stagedCaseOf(manifestCase: AdversarialBatchManifestCase): StagedAdversarialCase {
  return {
    cassetteId: manifestCase.cassetteId,
    seedCassetteId: manifestCase.seedCassetteId,
    mutator: manifestCase.mutator,
    kind: manifestCase.kind,
    tableEntryId: manifestCase.tableEntryId,
  }
}

/**
 * The host's guardrail policy for the adversarial channel (D-03).
 *
 * It lives HERE rather than in the CLI because the FUNC-02 surface firewall does not let the
 * eval composition root name `@vostride/agent-qa-safety`, and the ledger only ever shrinks.
 * eval-local already depends on the gate package, so the loader is a legitimate eval-local
 * function rather than a re-export that would widen this package's surface with foreign
 * symbols. It does not INVENT a policy: an absent host override resolves to the same shipped
 * default input every other committed-egress checkpoint uses.
 */
export function loadAdversarialGuardrailPolicy(input?: unknown): GuardrailPolicy {
  return loadGuardrailPolicy(input ?? defaultGuardrailPolicyInput)
}

/** Re-exported for callers that only need the derived provenance shape. */
export type { CorpusGenerator }
