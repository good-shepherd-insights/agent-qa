// Write-once committed eval-root store (Phase 371, ROOT-01/D-15/D-17).
//
// Owns the physical committed root: cassettes/ · corpus/ · labels/ · contracts/ · reports/,
// product-partitioned, scaffolded on first seed with a .gitignore whose one rule covers
// every blobs/ dir at any depth plus a schemaVersion root marker (D-15). Every text write
// is write-once: a byte-identical re-write is a silent 'unchanged' no-op, the same path
// with differing bytes is a typed 'write-conflict' refusal — never an overwrite, never a
// delete (D-17). The ONLY mutations in this file are recursive mkdir and create-new-file
// writes; the staging store's dir-recreate posture is deliberately inverted here.
//
// Boundary: text reaching this store has passed the committed-egress checkpoint upstream
// (the seeding composition helper checks BEFORE handing text over) — the store enforces
// write-once and layout, never content policy. Blob bytes bypass the text checkpoint and
// land only under ignore-covered blobs/ dirs after sha-format + byte-hash verification.
//
// Every id-derived path segment passes schema's security-reviewed slugBranch sanitizer
// (T-368-10 posture): a crafted cassette id cannot escape the committed root.

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

import type { ExtractedBlob } from '@vostride/agent-qa-eval'
import { slugBranch } from '@vostride/agent-qa-schema'

import { BLOBS_SUBDIR, CASSETTE_FILE } from './cassette-store.js'

export const COMMITTED_CASSETTES_DIR = 'cassettes'
export const COMMITTED_CORPUS_DIR = 'corpus'
export const COMMITTED_LABELS_DIR = 'labels'
export const COMMITTED_CONTRACTS_DIR = 'contracts'
export const COMMITTED_REPORTS_DIR = 'reports'
/** 414 D-02: one committed file per excluded run, product-partitioned. */
export const COMMITTED_EXCLUSIONS_DIR = 'exclusions'
/** 414 D-05: the file-name prefix that makes a partition manifest findable under contracts/. */
export const PARTITION_MANIFEST_FILE_PREFIX = 'partition-'
/** 413 D-19: baseline pointers live one level under reports/, beside the batchKey dirs. */
export const COMMITTED_BASELINES_SUBDIR = 'baselines'
/** 413 D-15: the corpus census lives one level under reports/, beside the batchKey dirs. */
export const COMMITTED_CENSUS_SUBDIR = 'census'
/** 415 D-04: one floor artefact per profile, beside the baseline-pointer set. */
export const COMMITTED_NOISE_FLOOR_SUBDIR = 'noise-floor'

export const COMMITTED_ROOT_MARKER_FILE = 'eval-root.json'
export const COMMITTED_ROOT_SCHEMA_VERSION = 1

/** Scaffolded ignore content: one rule covering every blobs/ dir at any depth (D-15). */
export const COMMITTED_GITIGNORE_TEXT =
  '# agent-qa committed eval root: binary blob bytes stay untracked (D-15/L12).\n**/blobs/\n'

const BLOB_SHA_RE = /^[0-9a-f]{64}$/

export interface CommittedRootStoreConfig {
  /**
   * Explicit absolute committed-root path — `<configDir>/agent-qa-eval` for the Phase 372
   * CLI. Deliberately NO default: nothing may silently resolve into a workdir (OQ-2).
   */
  committedRoot: string
}

export type CommittedWriteOutcome =
  | { kind: 'written' }
  | { kind: 'unchanged' }
  | { kind: 'write-conflict'; path: string }

export function buildRootMarkerValue(): { schemaVersion: number } {
  return { schemaVersion: COMMITTED_ROOT_SCHEMA_VERSION }
}

function sluggedIdSegments(cassetteId: string): string[] {
  return cassetteId.split('/').map(segment => slugBranch(segment))
}

function sluggedJsonLeaf(cassetteId: string): string[] {
  const segments = sluggedIdSegments(cassetteId)
  const last = segments.pop() ?? 'default'
  return [...segments, `${last}.json`]
}

export function committedCassettePath(product: string, cassetteId: string): string {
  return [
    COMMITTED_CASSETTES_DIR,
    slugBranch(product),
    ...sluggedIdSegments(cassetteId),
    CASSETTE_FILE,
  ].join('/')
}

export function committedBlobPath(product: string, cassetteId: string, sha: string): string {
  return [
    COMMITTED_CASSETTES_DIR,
    slugBranch(product),
    ...sluggedIdSegments(cassetteId),
    BLOBS_SUBDIR,
    slugBranch(sha),
  ].join('/')
}

export function committedLabelPath(product: string, cassetteId: string): string {
  return [COMMITTED_LABELS_DIR, slugBranch(product), ...sluggedJsonLeaf(cassetteId)].join('/')
}

/** Preserve validated cassette path segments; suffix only the JSON leaf, never slug the whole ID. */
export function committedLabelRevisionPath(product: string, cassetteId: string, revisionId: string): string {
  if (!BLOB_SHA_RE.test(revisionId) || !cassetteId.split('/').every(segment =>
    segment.length > 0 && segment !== '.' && segment !== '..' && slugBranch(segment) === segment)) {
    throw new TypeError('invalid label revision path')
  }
  return committedLabelPath(product, cassetteId).replace(/\.json$/, `--revision-${revisionId}.json`)
}

export function committedCorpusPath(product: string, cassetteId: string): string {
  return [COMMITTED_CORPUS_DIR, slugBranch(product), ...sluggedJsonLeaf(cassetteId)].join('/')
}

export function committedContractPath(fileName: string): string {
  return [COMMITTED_CONTRACTS_DIR, slugBranch(fileName)].join('/')
}

/**
 * Phase 372 D-13: the baseline report commits beside the corpus/contracts that produced it —
 * one dir per batchKey, so a changed corpus (⇒ changed key) gets a fresh dir under write-once
 * while an identical regen byte-compares 'unchanged'. Every segment slugged (T-368-10).
 */
export function committedReportPath(batchKey: string, fileName: string): string {
  return [COMMITTED_REPORTS_DIR, slugBranch(batchKey), slugBranch(fileName)].join('/')
}

/**
 * Phase 413 D-15: the census commits one dir per CORPUS DIGEST, the reports/<batchKey>/ shape
 * applied to the population rather than to a replay batch — a grown corpus hashes to a fresh
 * digest and therefore gets a fresh dir under write-once, while re-running the census over an
 * unchanged corpus byte-compares 'unchanged' and is an idempotent no-op. Every segment slugged,
 * so a crafted digest cannot escape the committed root (T-368-10 / T-413-18).
 */
export function committedCensusPath(corpusDigest: string, fileName: string): string {
  return [
    COMMITTED_REPORTS_DIR,
    COMMITTED_CENSUS_SUBDIR,
    slugBranch(corpusDigest),
    slugBranch(fileName),
  ].join('/')
}

/**
 * Phase 413 D-19: baseline designation is a committed pointer, one file per profile key, so
 * moving a baseline is a reviewed git edit of that file rather than a silent overwrite. The
 * key is a single path segment and every segment is slugged (T-368-10).
 */
export function committedBaselinePointerPath(profileKey: string): string {
  return [COMMITTED_REPORTS_DIR, COMMITTED_BASELINES_SUBDIR, `${slugBranch(profileKey)}.json`].join(
    '/',
  )
}

/** 415 D-04: the entire profile key is one slugged segment, never a batch report dir. */
export function committedNoiseFloorPath(profileKey: string): string {
  return [COMMITTED_REPORTS_DIR, COMMITTED_NOISE_FLOOR_SUBDIR, `${slugBranch(profileKey)}.json`].join('/')
}

/**
 * Phase 414 D-05: one partition manifest per product, under contracts/ rather than beside the
 * entries it governs. Two reasons. (1) The recursive corpus/ walk parses every *.json it finds,
 * so a manifest under corpus/ would be handed to the corpus-entry guard and refused as a corpus
 * entry — putting it under contracts/ means the walk never sees it (T-414-20). (2) contracts/ is
 * already where this root keeps its reviewed constitution documents, and a manifest IS one: a
 * change to its salt or fractions re-partitions a committed corpus, so it lands as a reviewed git
 * edit and a named migration, never a silent rewrite. Every segment slugged (T-368-10).
 */
export function committedPartitionManifestPath(product: string): string {
  return committedContractPath(`${PARTITION_MANIFEST_FILE_PREFIX}${slugBranch(product)}.json`)
}

/**
 * Phase 414 D-02: one committed file per excluded run, so corpus membership becomes a function of
 * a committed list rather than a fact about whoever ran the growth campaign. 413 dropped excluded
 * runs before anything was committed and they left no trace; a record per run lets the census
 * count what never arrived and 422's curator ask why a run is missing. Every segment slugged, so a
 * crafted product or runSlug cannot escape the committed root (T-368-10 / T-414-16).
 */
export function committedExclusionPath(product: string, runSlug: string): string {
  return [COMMITTED_EXCLUSIONS_DIR, slugBranch(product), `${slugBranch(runSlug)}.json`].join('/')
}

function byteSha(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export class FsCommittedRootStore {
  private readonly committedRoot: string

  constructor(config: CommittedRootStoreConfig) {
    this.committedRoot = config.committedRoot
  }

  /**
   * Scaffold the committed root deterministically: the blobs-covering .gitignore plus the
   * schemaVersion root marker (D-15). Both texts arrive as ALREADY-CHECKED strings from
   * the seeding composition helper — the store never imports the guardrail. Re-scaffolding
   * an intact root yields two 'unchanged' outcomes and mutates nothing.
   */
  scaffold(
    checkedGitignoreText: string,
    checkedRootMarkerText: string,
  ): { gitignore: CommittedWriteOutcome; rootMarker: CommittedWriteOutcome } {
    return {
      gitignore: this.writeText('.gitignore', checkedGitignoreText),
      rootMarker: this.writeText(COMMITTED_ROOT_MARKER_FILE, checkedRootMarkerText),
    }
  }

  /** The write-once comparison WITHOUT any mkdir or write — pure read + compare. */
  previewText(relPath: string, text: string): 'absent' | 'identical' | 'conflict' {
    const file = join(this.committedRoot, relPath)
    if (!existsSync(file)) return 'absent'
    return readFileSync(file, 'utf8') === text ? 'identical' : 'conflict'
  }

  /** Write-once text: read-compare-refuse, never overwrite (D-17). */
  writeText(relPath: string, text: string): CommittedWriteOutcome {
    const file = join(this.committedRoot, relPath)
    if (existsSync(file)) {
      return readFileSync(file, 'utf8') === text
        ? { kind: 'unchanged' }
        : { kind: 'write-conflict', path: relPath }
    }
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, text, 'utf8')
    return { kind: 'written' }
  }

  /**
   * Write-once blob bytes, confined to ignore-covered blobs/ dirs. The sha must match the
   * lowercase 64-hex content-address format, the byte hash must equal it, and the target
   * path must be `.../blobs/<sha>` — any verification failure is a typed refusal, so
   * corrupt bytes never land under an untrue content address (T-371-11).
   */
  writeBlob(relBlobPath: string, blob: ExtractedBlob): CommittedWriteOutcome {
    if (!BLOB_SHA_RE.test(blob.sha)) return { kind: 'write-conflict', path: relBlobPath }
    if (byteSha(blob.bytes) !== blob.sha) return { kind: 'write-conflict', path: relBlobPath }
    if (basename(relBlobPath) !== blob.sha || basename(dirname(relBlobPath)) !== BLOBS_SUBDIR) {
      return { kind: 'write-conflict', path: relBlobPath }
    }
    const file = join(this.committedRoot, relBlobPath)
    if (existsSync(file)) {
      return readFileSync(file).equals(Buffer.from(blob.bytes))
        ? { kind: 'unchanged' }
        : { kind: 'write-conflict', path: relBlobPath }
    }
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, blob.bytes)
    return { kind: 'written' }
  }
}
