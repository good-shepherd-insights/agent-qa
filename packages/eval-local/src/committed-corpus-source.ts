// The committed-root READ leg (413 D-14/D-08, RESEARCH F6) — the inverse of seedCommittedCorpus.
//
// Composition law (the eval-local ownership rule): every eval filesystem read lives here and the
// derivation lives in eval core. This module loads corpus entries, label records, cassette
// bundles and local blob presence off disk and hands eval core the CommittedCorpusSnapshot its
// pure census folds. It computes nothing.
//
// Refusal posture (mirrors cassette-loader.ts): a committed root is a cross-machine,
// hand-editable, git-tracked document, so NO content failure throws. An unreadable file,
// unparseable JSON, or a guard rejection becomes a typed refusal row and the surrounding read
// survives; an absent root is an empty snapshot with a notice, never an error. Blob presence is
// reported rather than required — `**/blobs/` is gitignored, so a freshly cloned root legitimately
// carries zero blobs (F6) and the census prints `blobs present locally: n/N`.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import type { Dirent } from 'node:fs'
import { join } from 'node:path'

import type {
  CommittedCorpusSnapshot,
  CorpusEntry,
  EvalBatchReport,
  LeafCassette,
  StandaloneLabelRecord,
} from '@vostride/agent-qa-eval'
import { z } from 'zod'

import { loadCassetteBundle } from './cassette-loader.js'
import { BLOBS_SUBDIR } from './cassette-store.js'
import {
  COMMITTED_CASSETTES_DIR,
  COMMITTED_CORPUS_DIR,
  COMMITTED_LABELS_DIR,
  COMMITTED_REPORTS_DIR,
} from './committed-root-store.js'
import { listCassetteBundleDirs } from './replay-read.js'

/** Reports dirs that are NOT batch reports: the census and the baseline pointer set (D-15/D-19). */
const RESERVED_REPORT_DIRS = new Set(['census', 'baselines'])

const corpusEntrySchema = z
  .object({
    schemaVersion: z.literal(1),
    cassetteId: z.string(),
    product: z.string(),
    split: z.literal('natural'),
    captured_at_ordinal: z.number(),
    run_links: z
      .object({ runId: z.string(), runSlug: z.string(), handoffPath: z.string() })
      .strict(),
    receiptDigest: z.string(),
  })
  .strict()

const labelRecordSchema = z
  .object({
    schemaVersion: z.number(),
    cassetteId: z.string(),
    label: z.object({ tier: z.enum(['gold', 'near-gold', 'silver']) }).passthrough(),
    provenance: z.object({}).passthrough(),
  })
  .passthrough()

const reportSchema = z
  .object({
    batchKey: z.string(),
    matcherVersion: z.number(),
    headline: z
      .object({ perDecisionCost: z.object({ decisionCount: z.number() }).passthrough() })
      .passthrough(),
    honesty: z
      .object({
        unscorableIdentityCounts: z.record(z.string(), z.number()),
        refusalCounts: z.record(z.string(), z.number()),
      })
      .passthrough(),
    judge: z
      .object({
        judgeModelId: z.string(),
        judgeFamily: z.string(),
        judgeVersion: z.number(),
        confidenceThreshold: z.string(),
        familyOverride: z.literal('same-family-allowed').optional(),
      })
      .strict()
      .optional(),
  })
  .passthrough()

const baselinePointerSchema = z
  .object({ schemaVersion: z.literal(1), profileKey: z.string(), batchKey: z.string() })
  .passthrough()

/** One unreadable or unadmittable committed file, attributable by path (D-08). */
export interface CommittedReadRefusal {
  path: string
  reason: string
}

/** The loaded committed root: eval core's snapshot plus everything the read learned about it. */
export interface CommittedCorpusRead {
  snapshot: CommittedCorpusSnapshot
  productsSeen: readonly string[]
  notices: string[]
  refusals: readonly CommittedReadRefusal[]
}

/** One committed batch report keyed by its own dir name. */
export interface CommittedReportEntry {
  batchKey: string
  report: EvalBatchReport
  path: string
}

/** One committed per-profile baseline designation (D-19). */
export interface BaselinePointerEntry {
  profileKey: string
  batchKey: string
  path: string
}

function listDirNames(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
  } catch {
    return []
  }
}

/** Every `*.json` file under dir at any depth, sorted; ENOENT is an empty list. */
function listJsonFiles(dir: string): string[] {
  const found: string[] = []

  function walk(current: string): void {
    let entries: Dirent[]
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.isFile() && entry.name.endsWith('.json')) found.push(path)
    }
  }

  walk(dir)
  return found.sort()
}

function readJson(path: string): { ok: true; value: unknown } | { ok: false; reason: string } {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (error) {
    return { ok: false, reason: `unreadable: ${(error as NodeJS.ErrnoException).message}` }
  }
  try {
    return { ok: true, value: JSON.parse(raw) }
  } catch (error) {
    return { ok: false, reason: `invalid JSON: ${(error as Error).message}` }
  }
}

function issueText(error: z.ZodError): string {
  return error.issues
    .map(
      (issue) => `${issue.path.length === 0 ? '<root>' : issue.path.join('.')}: ${issue.message}`,
    )
    .join('; ')
}

/** A blobs/ dir counts as present only when it exists AND holds at least one file (F6). */
function blobsPresent(bundleDir: string): boolean {
  const blobsDir = join(bundleDir, BLOBS_SUBDIR)
  if (!existsSync(blobsDir)) return false
  try {
    return readdirSync(blobsDir).length > 0
  } catch {
    return false
  }
}

/**
 * Load the committed root at `committedRoot` into the snapshot eval core's `deriveCensus` folds.
 * Never throws for content: every parse or guard failure lands in `refusals`, and a missing root
 * yields an empty snapshot with a notice naming it.
 */
export function readCommittedCorpus(committedRoot: string): CommittedCorpusRead {
  const notices: string[] = []
  const refusals: CommittedReadRefusal[] = []
  const entries: CorpusEntry[] = []
  const labelsById = new Map<string, StandaloneLabelRecord>()
  const cassettesById = new Map<string, LeafCassette>()
  const blobPresentById = new Map<string, boolean>()

  if (!existsSync(committedRoot)) {
    notices.push(`committed root absent: ${committedRoot}`)
    return {
      snapshot: { entries, labelsById, cassettesById, blobPresentById },
      productsSeen: [],
      notices,
      refusals,
    }
  }

  const corpusRoot = join(committedRoot, COMMITTED_CORPUS_DIR)
  const productsSeen = listDirNames(corpusRoot)

  for (const product of productsSeen) {
    for (const path of listJsonFiles(join(corpusRoot, product))) {
      const read = readJson(path)
      if (!read.ok) {
        refusals.push({ path, reason: read.reason })
        continue
      }
      const parsed = corpusEntrySchema.safeParse(read.value)
      if (!parsed.success) {
        refusals.push({ path, reason: `corpus entry rejected: ${issueText(parsed.error)}` })
        continue
      }
      if (parsed.data.product !== product) {
        notices.push(
          `corpus dir '${product}' holds an entry declaring product '${parsed.data.product}' (${parsed.data.cassetteId}); the entry field is authoritative`,
        )
      }
      entries.push(parsed.data as CorpusEntry)
    }
  }

  const labelsRoot = join(committedRoot, COMMITTED_LABELS_DIR)
  for (const product of listDirNames(labelsRoot)) {
    for (const path of listJsonFiles(join(labelsRoot, product))) {
      const read = readJson(path)
      if (!read.ok) {
        refusals.push({ path, reason: read.reason })
        continue
      }
      const parsed = labelRecordSchema.safeParse(read.value)
      if (!parsed.success) {
        refusals.push({ path, reason: `label record rejected: ${issueText(parsed.error)}` })
        continue
      }
      labelsById.set(parsed.data.cassetteId, parsed.data as unknown as StandaloneLabelRecord)
    }
  }

  for (const bundleDir of listCassetteBundleDirs(join(committedRoot, COMMITTED_CASSETTES_DIR))) {
    const load = loadCassetteBundle(bundleDir)
    if (load.kind === 'refused') {
      refusals.push({
        path: join(bundleDir, 'cassette.json'),
        reason: `${load.refusal.reason}: ${load.refusal.detail}`,
      })
      continue
    }
    if (load.cassette.granularity !== 'leaf') {
      notices.push(`skipped non-leaf cassette bundle: ${bundleDir}`)
      continue
    }
    cassettesById.set(load.cassette.id, load.cassette)
    blobPresentById.set(load.cassette.id, blobsPresent(bundleDir))
  }

  entries.sort((first, second) =>
    first.cassetteId < second.cassetteId ? -1 : first.cassetteId > second.cassetteId ? 1 : 0,
  )

  return {
    snapshot: { entries, labelsById, cassettesById, blobPresentById },
    productsSeen,
    notices,
    refusals,
  }
}

/**
 * List every committed batch report under `reports/`, one per batchKey dir. The reserved `census/`
 * and `baselines/` dirs are NOT batch reports and are skipped by name.
 */
export function listCommittedReports(committedRoot: string): {
  reports: CommittedReportEntry[]
  refusals: CommittedReadRefusal[]
} {
  const reportsRoot = join(committedRoot, COMMITTED_REPORTS_DIR)
  const reports: CommittedReportEntry[] = []
  const refusals: CommittedReadRefusal[] = []

  for (const name of listDirNames(reportsRoot)) {
    if (RESERVED_REPORT_DIRS.has(name)) continue
    const path = join(reportsRoot, name, 'report.json')
    if (!existsSync(path)) {
      refusals.push({ path, reason: 'report.json absent' })
      continue
    }
    const read = readJson(path)
    if (!read.ok) {
      refusals.push({ path, reason: read.reason })
      continue
    }
    const parsed = reportSchema.safeParse(read.value)
    if (!parsed.success) {
      refusals.push({ path, reason: `report rejected: ${issueText(parsed.error)}` })
      continue
    }
    reports.push({ batchKey: name, report: parsed.data as unknown as EvalBatchReport, path })
  }

  reports.sort((first, second) =>
    first.batchKey < second.batchKey ? -1 : first.batchKey > second.batchKey ? 1 : 0,
  )
  return { reports, refusals }
}

/** List every committed per-profile baseline pointer under `reports/baselines/`, sorted (D-19). */
export function listBaselinePointers(committedRoot: string): {
  pointers: BaselinePointerEntry[]
  refusals: CommittedReadRefusal[]
} {
  const baselinesRoot = join(committedRoot, COMMITTED_REPORTS_DIR, 'baselines')
  const pointers: BaselinePointerEntry[] = []
  const refusals: CommittedReadRefusal[] = []

  let names: string[]
  try {
    names = readdirSync(baselinesRoot).sort()
  } catch {
    return { pointers, refusals }
  }

  for (const name of names) {
    if (!name.endsWith('.json')) continue
    const path = join(baselinesRoot, name)
    if (!statSync(path).isFile()) continue
    const read = readJson(path)
    if (!read.ok) {
      refusals.push({ path, reason: read.reason })
      continue
    }
    const parsed = baselinePointerSchema.safeParse(read.value)
    if (!parsed.success) {
      refusals.push({ path, reason: `baseline pointer rejected: ${issueText(parsed.error)}` })
      continue
    }
    pointers.push({ profileKey: parsed.data.profileKey, batchKey: parsed.data.batchKey, path })
  }

  pointers.sort((first, second) =>
    first.profileKey < second.profileKey ? -1 : first.profileKey > second.profileKey ? 1 : 0,
  )
  return { pointers, refusals }
}
