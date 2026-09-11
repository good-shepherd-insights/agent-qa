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
  ADVERSARIAL_INAPPLICABILITIES,
  ADVERSARIAL_MUTATORS,
  ADVERSARIAL_TABLE_HASH,
  ADVERSARIAL_TABLE_VERSION,
  ADVERSARIAL_TABLES,
  GENERATOR_KINDS,
  canonicalJson,
  cassetteEgressText,
  committedFileText,
  deriveAdversarialCassetteId,
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

import {
  adversarialRefreshRecordDigest,
  adversarialTupleKey,
  computeAdversarialPolicyDigest,
  derivedAdversarialCassetteIds,
  publishAdversarialRefreshRecord,
  readAdversarialRefreshRecords,
  resolveAdversarialSeedCap,
  settledAdversarialTupleIndex,
  type AdversarialRefreshRecord,
  type AdversarialRefreshTuple,
  type AdversarialSeedCap,
} from './adversarial-state.js'
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

/**
 * A refusal a PREVIOUS refresh already recorded under this same policy (D-04).
 *
 * Its own channel on purpose: re-listing it among `refusals` would assert that a detector fired
 * during THIS refresh, when nothing was scanned. It names the identities and the detector, never
 * the refused surface text — the same discipline `AdversarialRefusal` keeps.
 */
export interface AdversarialSettledRefusal {
  seedCassetteId: string
  mutator: AdversarialMutator
  detector?: string
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
    /** This id is already committed with DIFFERENT bytes. History wins; nothing is overwritten. */
    | 'committed-conflict'
}

export interface StageAdversarialProposalInput {
  agentQaRoot: string
  committedRoot: string
  product: string
  /** D-03: the host's LOADED policy, required — this composition never defaults one. */
  policy: GuardrailPolicy
  auditSink?: AuditSink
  mutators?: readonly AdversarialMutator[]
  /** D-04: the per-refresh NOVEL-seed cap; absent resolves to the recorded default. */
  maxSeeds?: number
  /** Where `maxSeeds` came from, recorded beside the refresh. Absent with a value means 'flag'. */
  maxSeedsSource?: 'flag' | 'config'
  /** Derive and scan, publish nothing — neither staged bytes nor a settle record. */
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
  /**
   * D-04: the committed root's GATE posture, not the reader's length.
   *
   * `openCorpusReader` answers an absent, unmarked or unreadable root with an empty list —
   * byte-identical to a healthy root that genuinely holds no visible entry. Only the gate's own
   * digest read establishes the root, and a refresh that cannot establish it settles nothing:
   * a settle record written against silence is evidence manufactured from an outage.
   */
  rootPosture: 'available' | 'unavailable'
  /** The corpus digest this refresh read its seeds from; absent when the posture is unavailable. */
  sourceDigest?: string
  /** The resolved cap and its source, recorded beside every refresh. */
  cap: AdversarialSeedCap
  /** NOVEL eligible seeds, counted BEFORE the cap; `seedsDeferred` is the overflow. */
  eligibleSeeds: number
  /** The durable refresh record this refresh published, if it published one. */
  stateRecordDigest?: string
  /** Refusals a previous refresh settled under this policy; disclosed, never re-asserted. */
  settledRefusals: readonly AdversarialSettledRefusal[]
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
  /**
   * Runs after ONE case's bytes have landed and been byte-verified.
   *
   * An observation and fault-injection seam. Admission is the only place in this composition
   * where an interruption can leave the committed root part-way through a reviewed batch, and
   * "a case that landed stays landed" is not a claim anything could check without a way to
   * interrupt it between cases. A throw here is treated exactly like a real IO failure.
   */
  afterCaseCommitted?: (cassetteId: string) => void
}

/**
 * The outcome of ONE operator admission (D-01..D-04).
 *
 * Four counts, deliberately not three. `admitted` are cases whose bytes this run committed;
 * `unchanged` are reviewed cases already present BYTE-IDENTICALLY, which move no digest and
 * must not be double-counted as admissions; `refusals` are policy blocks; `remaining` are
 * reviewed members that have not landed — the number that makes a partial admission legible
 * as one. Collapsing any pair of them is how an interrupted run comes to read as a complete one.
 */
export interface AdversarialAdmissionResult {
  kind: 'admitted' | 'partial' | 'dry-run' | 'refused'
  reason?:
    | 'batch-not-found'
    | 'staging-integrity'
    | 'corpus-unavailable'
    | 'admission-refused'
    | 'admission-interrupted'
  product: string
  batchDigest: string
  /** Cases whose bytes THIS run committed. */
  admitted: readonly StagedAdversarialCase[]
  /** Reviewed cases already committed byte-identically; the digest does not move for these. */
  unchanged: readonly StagedAdversarialCase[]
  refusals: readonly AdversarialRefusal[]
  /** Reviewed members that have not landed — zero on a complete admission. */
  remaining: readonly StagedAdversarialCase[]
  stagingSkips: readonly AdversarialStagingSkip[]
  previousCorpusDigest?: string
  nextCorpusDigest?: string
  writesStarted: boolean
}

/** 422-01's spelling of the same result, retained for its existing callers. */
export type RefreshAdversarialSplitResult = AdversarialAdmissionResult

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

/**
 * Narrow a recorded `detail` back to the generator's closed inapplicability vocabulary.
 *
 * A record written by an older build may carry a member this build does not know. That is not a
 * reason to drop the row — it is a reason not to re-report it as a vocabulary term the caller
 * would then switch on. Such a row falls back to `already-derived`, which is true of every
 * settled tuple by construction: its id is decided for this generation.
 */
function isInapplicability(value: string | undefined): value is AdversarialSeedSkip['reason'] {
  return value !== undefined && (ADVERSARIAL_INAPPLICABILITIES as readonly string[]).includes(value)
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
  // D-04: resolved BEFORE any read, so an invalid cap is a loud refusal rather than a refresh
  // that silently ran under the default.
  const cap = resolveAdversarialSeedCap({
    ...(input.maxSeeds === undefined ? {} : { value: input.maxSeeds }),
    ...(input.maxSeedsSource === undefined ? {} : { source: input.maxSeedsSource }),
  })
  const empty: Omit<StageAdversarialProposalResult, 'kind'> = {
    product: input.product,
    staged: [],
    refusals: [],
    skips: [],
    stagingSkips: [],
    seedsConsidered: 0,
    seedsDeferred: 0,
    tableVersion: ADVERSARIAL_TABLE_VERSION,
    tableHash: ADVERSARIAL_TABLE_HASH,
    rootPosture: 'unavailable',
    cap,
    eligibleSeeds: 0,
    settledRefusals: [],
  }
  // The gate's own read, not the reader's length: an unmarked or refusing root reads empty
  // through the proposer port and must not be mistaken for a healthy corpus with nothing in it.
  const posture = readCommittedCorpusDigest({ committedRoot: input.committedRoot })
  if (posture.kind !== 'digest') return { ...empty, kind: 'nothing-derived' }
  const sourceDigest = posture.corpusDigest
  const policyDigest = computeAdversarialPolicyDigest(input.policy)

  const reader = openCorpusReader(input.committedRoot)
  const entries = reader.listEntries(input.product)
  const candidates: AdversarialSeed[] = []
  const existingCassetteIds = new Set<string>()
  for (const entry of entries) {
    existingCassetteIds.add(entry.cassetteId)
    if (entry.split !== 'natural') continue
    const cassette = reader.loadCassette(entry.cassetteId)
    if (cassette.kind !== 'loaded' || cassette.cassette.granularity !== 'leaf') continue
    const label = reader.loadLabel(entry.cassetteId)
    candidates.push({
      cassette: cassette.cassette,
      entry,
      ...(label.kind === 'loaded' ? { label: label.record } : {}),
    })
  }
  // Anything already staged is also already derived: D-04's idempotence key spans both.
  for (const batch of listStagedAdversarial({ agentQaRoot: input.agentQaRoot, product: input.product })) {
    for (const staged of batch.manifest.cases) existingCassetteIds.add(staged.cassetteId)
  }
  // ...and so is anything a previous refresh recorded, under ANY generation or policy (D-08).
  const records = readAdversarialRefreshRecords({
    agentQaRoot: input.agentQaRoot,
    product: input.product,
  })
  for (const id of derivedAdversarialCassetteIds(records)) existingCassetteIds.add(id)
  const settled = settledAdversarialTupleIndex(records, {
    tableVersion: ADVERSARIAL_TABLE_VERSION,
    policyDigest,
  })

  // The seed-level filter the cap depends on. A seed whose every requested tuple is already
  // decided — derived, refused or explicitly inapplicable — is NOT novel, and letting it into
  // the generator would spend a cap slot to re-reach a conclusion already on disk. That is the
  // starvation this plan exists to remove: without it the leading seeds are re-selected forever
  // and the seeds behind them are never reached.
  //
  // A dropped seed is DISCLOSED, never silently forgotten: an empty batch with no rows cannot
  // be told apart from a refresh that never ran. Derived and inapplicable settlements re-report
  // through the generator's own closed vocabulary; a settled REFUSAL gets its own channel,
  // because re-announcing it as a refusal would claim a detector fired on this run when none did.
  const requested = ADVERSARIAL_MUTATORS.filter(
    mutator => input.mutators === undefined || input.mutators.includes(mutator),
  )
  const settledSkips: AdversarialSeedSkip[] = []
  const settledRefusals: AdversarialSettledRefusal[] = []
  const seeds = candidates.filter(seed => {
    const decided: { mutator: AdversarialMutator; tuple?: AdversarialRefreshTuple }[] = []
    let novel = false
    for (const mutator of requested) {
      const tuple = settled.get(adversarialTupleKey(seed.cassette.id, mutator))
      if (tuple !== undefined) {
        decided.push({ mutator, tuple })
        continue
      }
      const derivedId = deriveAdversarialCassetteId({
        seedCassetteId: seed.cassette.id,
        kind: ADVERSARIAL_TABLES[mutator].kind,
        mutator,
        tableVersion: ADVERSARIAL_TABLE_VERSION,
      })
      if (existingCassetteIds.has(derivedId)) {
        decided.push({ mutator })
        continue
      }
      novel = true
    }
    if (novel) return true
    for (const row of decided) {
      if (row.tuple?.outcome === 'refused') {
        settledRefusals.push({
          seedCassetteId: seed.cassette.id,
          mutator: row.mutator,
          ...(row.tuple.detail === undefined ? {} : { detector: row.tuple.detail }),
        })
        continue
      }
      settledSkips.push({
        seedCassetteId: seed.cassette.id,
        mutator: row.mutator,
        reason:
          row.tuple?.outcome === 'inapplicable' && isInapplicability(row.tuple.detail)
            ? row.tuple.detail
            : 'already-derived',
      })
    }
    return false
  })

  const generated = generateAdversarialVariants({
    product: input.product,
    seeds,
    existingCassetteIds,
    ...(input.mutators === undefined ? {} : { mutators: input.mutators }),
    maxSeeds: cap.value,
  })
  // Novel eligible seeds, counted before the cap: the generator only defers a seed that passed
  // its own eligibility check, so considered + deferred is exactly that population.
  const eligibleSeeds = generated.seedsConsidered + generated.seedsDeferred

  const refusals: AdversarialRefusal[] = []
  const stagingSkips: AdversarialStagingSkip[] = []
  const tuples: AdversarialRefreshTuple[] = []
  const publishable: {
    manifestCase: AdversarialBatchManifestCase
    texts: { cassette: string; label: string; entry: string }
  }[] = []

  // A family the generator explicitly could not act on is a COMPLETED decision for this
  // generation, so it settles. `cap-exceeded` is a deferral and `already-derived` is a decision
  // taken earlier — neither is work this refresh did, and recording either would manufacture a
  // settlement. Seed-level rows carry no mutator and settle nothing: an ineligible seed can
  // become eligible when its corpus entry changes.
  for (const outcome of generated.outcomes) {
    if (outcome.kind !== 'inapplicable') continue
    if (outcome.mutator === undefined) continue
    if (outcome.reason === 'cap-exceeded' || outcome.reason === 'already-derived') continue
    tuples.push({
      seedCassetteId: outcome.seedCassetteId,
      mutator: outcome.mutator,
      cassetteId: deriveAdversarialCassetteId({
        seedCassetteId: outcome.seedCassetteId,
        kind: ADVERSARIAL_TABLES[outcome.mutator].kind,
        mutator: outcome.mutator,
        tableVersion: ADVERSARIAL_TABLE_VERSION,
      }),
      outcome: 'inapplicable',
      detail: outcome.reason,
    })
  }

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
      // A refusal is a decision the LOADED POLICY made about these bytes. It settles under that
      // policy's digest and reopens the moment the host changes it — which is the only way a
      // refused family ever gets a second hearing, and the only way it stops eating the cap.
      tuples.push({
        seedCassetteId: variant.seedCassetteId,
        mutator: variant.mutator,
        cassetteId: variant.cassette.id,
        outcome: 'refused',
        detail: caseRefusals[0]!.detector,
      })
      continue
    }
    const resolved = resolveSeedBlobs(
      input.committedRoot,
      input.product,
      variant.seedCassetteId,
      variant.blobShas,
    )
    if ('skipReason' in resolved) {
      // Deliberately NOT settled: an unresolvable blob is an operational failure that a repaired
      // root fixes. Settling it would turn a transient disk problem into a permanent exclusion.
      stagingSkips.push({
        cassetteId: variant.cassette.id,
        seedCassetteId: variant.seedCassetteId,
        reason: resolved.skipReason,
      })
      continue
    }
    tuples.push({
      seedCassetteId: variant.seedCassetteId,
      mutator: variant.mutator,
      cassetteId: variant.cassette.id,
      outcome: 'derived',
    })
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

  // Immutable batch membership: every seed this refresh actually SELECTED, ascending. A seed
  // the cap deferred, or one that was ineligible, emits a single mutator-less row and is not a
  // member — so a retry after an interruption reconstructs the same membership from the same
  // corpus rather than drifting onto a different eight.
  const seedIds = [
    ...new Set(
      generated.outcomes.flatMap(outcome =>
        outcome.mutator === undefined ? [] : [outcome.seedCassetteId],
      ),
    ),
  ].sort()

  const record: AdversarialRefreshRecord = {
    schemaVersion: 1,
    product: input.product,
    tableVersion: ADVERSARIAL_TABLE_VERSION,
    policyDigest,
    sourceDigest,
    cap,
    eligibleSeeds,
    excessSeeds: generated.seedsDeferred,
    seedIds,
    tuples: [...tuples].sort((left, right) =>
      left.cassetteId < right.cassetteId ? -1 : left.cassetteId > right.cassetteId ? 1 : 0,
    ),
  }

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
    skips: [...settledSkips, ...generated.skips],
    stagingSkips,
    seedsConsidered: generated.seedsConsidered,
    seedsDeferred: generated.seedsDeferred,
    tableVersion: ADVERSARIAL_TABLE_VERSION,
    tableHash: ADVERSARIAL_TABLE_HASH,
    rootPosture: 'available',
    sourceDigest,
    cap,
    eligibleSeeds,
    settledRefusals,
  }

  /**
   * Settle what this refresh decided. A DRY RUN settles nothing — it published no bytes, so
   * claiming its conclusions would let a preview silently retire seeds. An empty tuple list
   * settles nothing either: there is no decision to record.
   */
  function settle(): { stateRecordDigest?: string } {
    if (input.dryRun === true || record.tuples.length === 0) return {}
    publishAdversarialRefreshRecord({ agentQaRoot: input.agentQaRoot, record })
    return { stateRecordDigest: adversarialRefreshRecordDigest(record) }
  }

  if (publishable.length === 0) return { ...base, kind: 'nothing-derived', ...settle() }

  const cases = publishable.map(row => row.manifestCase)
  const batchDigest = computeAdversarialBatchDigest(input.product, cases)
  const productDir = adversarialProductDir(input.agentQaRoot, input.product)
  const dir = join(productDir, batchDigest)
  if (input.dryRun === true) return { ...base, kind: 'dry-run', batchDigest, dir }

  requireDirectories(productDir)
  // An already-published batch still settles: the previous run may have been interrupted
  // between the staging rename and its record, and the decisions are the same either way.
  if (pathPresent(dir)) return { ...base, kind: 'unchanged', batchDigest, dir, ...settle() }

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
    if (pathPresent(dir)) return { ...base, kind: 'unchanged', batchDigest, dir, ...settle() }
    renameSync(temporary, dir)
    temporary = undefined
    // Settle AFTER the bytes are published: an interruption before this point leaves nothing
    // settled and the retry re-derives the same batch, which is the recoverable order.
    return { ...base, kind: 'staged', batchDigest, dir, ...settle() }
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
    unchanged: [] as StagedAdversarialCase[],
    refusals: [] as AdversarialRefusal[],
    remaining: [] as StagedAdversarialCase[],
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
  const unchanged: StagedAdversarialCase[] = []
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
    // D-04/D-08 against what is ALREADY committed. Three cases, and only the third is work:
    // byte-identical is `unchanged` (an interrupted run's survivor, or a duplicate admission —
    // the digest does not move for it); conflicting bytes are refused, because deciding which
    // of two versions of one id is right is not an admission's call and history wins; absent
    // is the case this run commits.
    const present = committedState(input.committedRoot, input.product, staged.manifest.cassetteId, staged.texts)
    if (present === 'conflict') {
      stagingSkips.push({
        cassetteId: staged.manifest.cassetteId,
        seedCassetteId: staged.manifest.seedCassetteId,
        reason: 'committed-conflict',
      })
      continue
    }
    if (present === 'identical') {
      unchanged.push(stagedCaseOf(staged.manifest))
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

  const result: AdversarialAdmissionResult = {
    ...base,
    kind: 'admitted',
    unchanged,
    refusals,
    stagingSkips,
    previousCorpusDigest: previous.corpusDigest,
  }
  const reviewed = batch.cases.map(row => stagedCaseOf(row.manifest))
  const notLanded = (landed: readonly StagedAdversarialCase[]): StagedAdversarialCase[] => {
    const done = new Set(landed.map(row => row.cassetteId))
    return reviewed.filter(row => !done.has(row.cassetteId))
  }

  if (input.dryRun === true) {
    // A preview reports what WOULD be committed and what is already there, and writes nothing.
    return {
      ...result,
      kind: 'dry-run',
      admitted: admissible.map(row => stagedCaseOf(row.manifestCase)),
      remaining: notLanded([...unchanged, ...admissible.map(row => stagedCaseOf(row.manifestCase))]),
    }
  }
  if (admissible.length === 0) {
    // Nothing to write. Already-complete is an ADMISSION whose digest simply does not move;
    // nothing admissible and nothing unchanged is a refusal.
    const complete = unchanged.length === reviewed.length && reviewed.length > 0
    if (complete) retireBatch(batch.dir)
    return {
      ...result,
      kind: complete ? 'admitted' : 'refused',
      ...(complete ? {} : { reason: 'admission-refused' as const }),
      remaining: notLanded(unchanged),
      nextCorpusDigest: previous.corpusDigest,
    }
  }

  // Commit ONE case at a time. The batch was preflighted in full above, so every case reached
  // here was already judged admissible — which is what makes stopping between them safe: an
  // interruption leaves committed bytes that a retry recognises as `unchanged`, never a
  // half-written case and never a case nobody checked.
  const admitted: StagedAdversarialCase[] = []
  let interrupted = false
  result.writesStarted = true
  for (const row of admissible) {
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
    let report: SeedingBatchReport['reports'][number] | undefined
    try {
      report = seedCommittedCorpus({
        batches: [{ plan, cassettes }],
        committedRoot: input.committedRoot,
        seedingOutputBaseDir: input.seedingOutputBaseDir,
        policy: input.policy,
        ...(input.auditSink === undefined ? {} : { auditSink: input.auditSink }),
      }).reports[0]
    } catch {
      report = undefined
    }
    if (report === undefined || report.refusals.length > 0) {
      stagingSkips.push({
        cassetteId: row.cassette.id,
        seedCassetteId: row.manifestCase.seedCassetteId,
        reason: report?.refusals.some(refusal => refusal.kind === 'write-conflict') === true
          ? 'committed-conflict'
          : 'text-hash-mismatch',
      })
      continue
    }
    // Neither aggregate counts nor the absence of an exception is evidence: verify the bytes.
    if (committedState(input.committedRoot, input.product, row.cassette.id, row.texts) !== 'identical'
      || !blobsCommitted(input.committedRoot, input.product, row.cassette.id, row.blobs)) {
      stagingSkips.push({
        cassetteId: row.cassette.id,
        seedCassetteId: row.manifestCase.seedCassetteId,
        reason: 'text-hash-mismatch',
      })
      continue
    }
    admitted.push(stagedCaseOf(row.manifestCase))
    try {
      input.afterCaseCommitted?.(row.cassette.id)
    } catch {
      // A real interruption at exactly this point: the case above is committed and stays so.
      interrupted = true
      break
    }
  }

  const landed = [...admitted, ...unchanged]
  const remaining = notLanded(landed)
  // Retire the reviewed batch only when every member landed AND this run finished its own
  // bookkeeping. A partial batch — or one whose run was interrupted after the last case —
  // stays on disk so the operator resumes THAT manifest rather than deriving a different one.
  const complete = remaining.length === 0 && !interrupted
  if (complete) retireBatch(batch.dir)

  const next = readCommittedCorpusDigest({ committedRoot: input.committedRoot })
  const kind: AdversarialAdmissionResult['kind'] =
    complete ? 'admitted' : admitted.length > 0 ? 'partial' : 'refused'
  return {
    ...result,
    kind,
    // An interruption and a refusal are different facts about an incomplete batch: one stopped,
    // the other was told no. Reporting either as the other misdirects the operator's next move.
    ...(complete
      ? {}
      : { reason: interrupted ? ('admission-interrupted' as const) : ('admission-refused' as const) }),
    admitted,
    unchanged,
    refusals,
    remaining,
    stagingSkips,
    writesStarted: true,
    ...(next.kind === 'digest' ? { nextCorpusDigest: next.corpusDigest } : {}),
  }
}

/**
 * Whether this id is ALREADY committed, and whether its bytes are the reviewed ones.
 *
 * `absent` only when all three documents are missing: a root holding one of them is a partial
 * write, not an empty slot, and calling it absent would let an admission write over the rest.
 */
function committedState(
  committedRoot: string,
  product: string,
  cassetteId: string,
  texts: { cassette: string; label: string; entry: string },
): 'absent' | 'identical' | 'conflict' {
  const files: [string, string][] = [
    [join(committedRoot, committedCassettePath(product, cassetteId)), texts.cassette],
    [join(committedRoot, committedLabelPath(product, cassetteId)), texts.label],
    [join(committedRoot, committedCorpusPath(product, cassetteId)), texts.entry],
  ]
  let present = 0
  let equal = 0
  for (const [file, expected] of files) {
    let actual: string
    try {
      actual = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    present += 1
    if (actual === expected) equal += 1
  }
  if (present === 0) return 'absent'
  return equal === files.length ? 'identical' : 'conflict'
}

/** The derived cassette's own committed blob closure, byte-compared. */
function blobsCommitted(
  committedRoot: string,
  product: string,
  cassetteId: string,
  blobs: readonly ExtractedBlob[],
): boolean {
  try {
    return blobs.every(blob =>
      readFileSync(join(committedRoot, committedBlobPath(product, cassetteId, blob.sha))).equals(
        Buffer.from(blob.bytes),
      ),
    )
  } catch {
    return false
  }
}

/** Cleanup is not un-admission: the bytes are already verified in the committed root. */
function retireBatch(dir: string): void {
  try {
    rmSync(dir, { recursive: true })
  } catch {
    // A staging directory that cannot be removed is an operator annoyance, not a failed admission.
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
