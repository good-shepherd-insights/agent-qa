// Filesystem batch-report store (Phase 369, D-13/D-14).
//
// Persists one aggregated EvalBatchReport as its own artifact under the uncommitted runtime
// staging root:
//
//   <output-root>/eval/reports/<slugged batchKey>.json
//
// The filename derives ONLY from report.batchKey — eval core's deterministic replay-batch key
// (sha256 over the canonical sorted cassette-id list, D-13) — through schema's slugBranch
// sanitizer (T-368-10 path-traversal control). No timestamps or random components are minted
// in the published identity, so a rerun of the same batch replaces the same file and a
// different batch lands beside it. Bytes are deterministic: same report ⇒ same path, same bytes.
// 415 D-16 adds an optional .decisions.json sidecar. A staging-only publication manifest
// binds both file digests before either replacement; interrupted or interleaved generations
// refuse at the reader. Legacy evidence without a manifest remains readable unchanged.
//
// `.agent-qa/eval/reports/` joins `eval/replays/` as UNCOMMITTED runtime staging: committed
// placement (the corpus root with fail-closed egress) is Phase 371/372's concern; Phase 372's
// baseline reads reports from exactly this path.
//
// eval-local serializes only (F9): the report arrives fully aggregated from eval core's
// buildEvalReport — no aggregation or scoring logic lives in this file.

import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

import { guardDecisionVectorsDocument, judgeIdentitySchema } from '@vostride/agent-qa-eval'
import type { DecisionVectorsDocument, EvalBatchReport } from '@vostride/agent-qa-eval'
import { sha256hex, slugBranch } from '@vostride/agent-qa-schema'
import { z } from 'zod'
import { reportMetadataKind } from './report-metadata-guard.js'

export const DEFAULT_EVAL_REPORTS_SUBDIR = 'eval/reports'

export interface FsReportStoreConfig {
  /** Runtime root (normally the workdir's `.agent-qa` directory). */
  root: string
  /** Optional retargeted root used by later committed-corpus composition. */
  outputDir?: string
}

export interface WrittenReport {
  batchKey: string
  file: string
  decisionsFile?: string
}

export type StagedReportLoad =
  | {
      kind: 'loaded'
      report: EvalBatchReport
      decisions?: DecisionVectorsDocument
      file: string
      replayGeneration?: ReplayGeneration
    }
  | { kind: 'absent'; file: string }
  | { kind: 'refused'; file: string; reason: string }

const calibrationCount = z.number().int().nonnegative().safe()
const calibrationUnit = z.number().finite().min(0).max(1)
const copiedInterval = z.object({ lower: calibrationUnit, upper: calibrationUnit,
  halfWidth: calibrationUnit.max(0.5) }).strict().refine(value => value.lower <= value.upper
    && value.upper - value.lower <= 2 * value.halfWidth + Number.EPSILON * 4)
// Check possible integer agreement counts only; never replace the copied estimate or interval.
const consistentAgreement = (n: number, agreement: number) => agreement === Math.round(n * agreement) / n
const copiedMember = z.object({ judgeModelId: z.string(), n: calibrationCount,
  agreement: calibrationUnit.optional(), wilson95: copiedInterval.optional() }).strict()
  .refine(value => value.n === 0 ? value.agreement === undefined && value.wilson95 === undefined
    : value.agreement !== undefined && value.wilson95 !== undefined && consistentAgreement(value.n, value.agreement))
const copiedCalibration = z.discriminatedUnion('status', [
  z.object({ status: z.literal('calibrated'), n: calibrationCount.min(2),
    pooledAgreement: calibrationUnit, wilson95: copiedInterval,
    perMember: z.array(copiedMember).min(2).max(3) }).strict()
    .refine(value => consistentAgreement(value.n, value.pooledAgreement)),
  z.object({ status: z.literal('uncalibrated'), n: calibrationCount,
    provenance: z.literal('unavailable').optional() }).strict()
    .refine(value => value.provenance === undefined || value.n === 0),
  z.object({ status: z.literal('capability-gap'),
    reason: z.enum(['panel-not-configured', 'no-credential', 'single-family-host']) }).strict(),
])

/** Independent report admission preserves copied precision and never reads calibration storage. */
export const reportJudgeSchema = judgeIdentitySchema.safeExtend({ calibration: copiedCalibration.optional() })
  .refine(judge => {
    const calibration = judge.calibration
    if (calibration === undefined) return true
    if (judge.panelSize === undefined || judge.members === undefined) return false
    if (calibration.status !== 'calibrated') return true
    const memberIds = calibration.perMember.map(member => member.judgeModelId).sort()
    return calibration.perMember.length === judge.members.length
      && memberIds.every((id, index) => id === judge.members![index]!.judgeModelId)
  }, 'calibration requires the complete recorded composite identity')

// A light read boundary, not a format migration. Passthrough at every checked object
// retains the full report: seed evidence, honesty, judge provenance, costs and future fields.
const stagedReportSchema = z.object({
  batchKey: z.string().min(1),
  matcherVersion: z.number().int().nonnegative(),
  headline: z.object({
    perDecisionCost: z.object({ decisionCount: z.number() }).passthrough(),
  }).passthrough(),
  // Optional historical provenance remains optional; malformed mixed identities must never
  // reach the comparator's renderer as though its judge-id list were a string array.
  judgeIdentity: z.literal('mixed').optional(),
  mixedJudgeModelIds: z.array(z.string()).optional(),
  judge: reportJudgeSchema.optional(),
}).passthrough().refine(report => report.judgeIdentity !== 'mixed' || report.judge === undefined)

const replayGenerationSchema = z
  .object({
    seed: z.number().int().safe(),
    records: z.array(
      z
        .object({
          cassetteId: z.string().min(1),
          replayDigest: z.string().regex(/^[a-f0-9]{64}$/),
          scoreDigest: z
            .string()
            .regex(/^[a-f0-9]{64}$/)
            .nullable(),
        })
        .strict(),
    ),
  })
  .strict()
export type ReplayGeneration = z.infer<typeof replayGenerationSchema>

const publicationSchema = z.object({
  schemaVersion: z.literal(1),
  reportDigest: z.string().regex(/^[a-f0-9]{64}$/),
  decisionsDigest: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  replayGeneration: replayGenerationSchema.optional(),
}).strict()

function readOptional(file: string): string | undefined {
  try {
    return readFileSync(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

function removeOptional(file: string): void {
  try {
    unlinkSync(file)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

/** Probe exactly one directory; callers own the gate-root-first search order. */
export function loadStagedReport(
  root: string,
  batchKey: string,
  outputDir?: string,
): StagedReportLoad {
  const outputRoot = outputDir ?? join(root, DEFAULT_EVAL_REPORTS_SUBDIR)
  const stem = slugBranch(batchKey)
  const file = join(outputRoot, `${stem}.json`)
  const publicationFile = join(outputRoot, `${stem}.publication.json`)
  let publicationText: string | undefined
  try {
    publicationText = readOptional(publicationFile)
  } catch (error) {
    return { kind: 'refused', file: publicationFile, reason: `publication unreadable: ${(error as Error).message}` }
  }
  let reportText: string
  let value: unknown
  try {
    reportText = readFileSync(file, 'utf8')
    value = JSON.parse(reportText)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'absent', file }
    return { kind: 'refused', file, reason: `report unreadable: ${(error as Error).message}` }
  }
  const parsed = stagedReportSchema.safeParse(value)
  if (!parsed.success) {
    return { kind: 'refused', file, reason: `report rejected: ${parsed.error.message}` }
  }
  if (reportMetadataKind(value) === 'invalid') {
    return { kind: 'refused', file, reason: 'report label metadata incomplete or malformed' }
  }
  if (parsed.data.batchKey !== batchKey) {
    return { kind: 'refused', file, reason: 'report batchKey does not match the requested batchKey' }
  }
  const report = parsed.data as unknown as EvalBatchReport
  const decisionsFile = join(outputRoot, `${stem}.decisions.json`)
  let decisionsText: string | undefined
  let decisionsValue: unknown
  try {
    decisionsText = readOptional(decisionsFile)
    decisionsValue = decisionsText === undefined ? undefined : JSON.parse(decisionsText)
  } catch (error) {
    return {
      kind: 'refused', file: decisionsFile,
      reason: `decisions unreadable: ${(error as Error).message}`,
    }
  }
  let decisions: DecisionVectorsDocument | undefined
  if (decisionsValue !== undefined) {
    const guarded = guardDecisionVectorsDocument(decisionsValue)
    if (guarded.kind === 'rejected') {
      return { kind: 'refused', file: decisionsFile, reason: `decisions rejected: ${guarded.reason}` }
    }
    // Plan 09 passes only vectors into the gate; check document identity at this boundary.
    for (const field of ['batchKey', 'matcherVersion'] as const) {
      if (guarded.document[field] !== report[field]) {
        return { kind: 'refused', file: decisionsFile,
          reason: `decisions ${field} does not match the report ${field}` }
      }
    }
    decisions = guarded.document
  }
  // Read the manifest on both sides of the data reads, including the legacy absent case.
  // No newly published generation can be mistaken for an unbound historical pair.
  let replayGeneration: ReplayGeneration | undefined
  try {
    if (readOptional(publicationFile) !== publicationText) {
      return { kind: 'refused', file: publicationFile, reason: 'report publication changed during read' }
    }
    if (publicationText !== undefined) {
      const publication = publicationSchema.parse(JSON.parse(publicationText))
      replayGeneration = publication.replayGeneration
      if (publication.reportDigest !== sha256hex(reportText)) {
        return { kind: 'refused', file, reason: 'report publication digest mismatch' }
      }
      if (publication.decisionsDigest !== (decisionsText === undefined ? null : sha256hex(decisionsText))) {
        return { kind: 'refused', file: decisionsFile, reason: 'decisions publication digest mismatch or incomplete sidecar' }
      }
    }
  } catch (error) {
    return { kind: 'refused', file: publicationFile, reason: `publication rejected: ${(error as Error).message}` }
  }
  return { kind: 'loaded', report, ...(decisions === undefined ? {} : { decisions }), file,
    ...(replayGeneration === undefined ? {} : { replayGeneration }) }
}

export class FsReportStore {
  private readonly outputRoot: string

  constructor(config: FsReportStoreConfig) {
    this.outputRoot = config.outputDir ?? join(config.root, DEFAULT_EVAL_REPORTS_SUBDIR)
  }

  save(report: EvalBatchReport, decisions?: DecisionVectorsDocument, replayGeneration?: ReplayGeneration): WrittenReport {
    if (replayGeneration !== undefined) replayGenerationSchema.parse(replayGeneration)
    if (decisions !== undefined) {
      for (const field of ['batchKey', 'matcherVersion'] as const) {
        if (decisions[field] !== report[field]) {
          throw new TypeError(`decisions ${field} does not match the report ${field}`)
        }
      }
    }
    const file = join(this.outputRoot, `${slugBranch(report.batchKey)}.json`)
    const decisionsFile = join(this.outputRoot, `${slugBranch(report.batchKey)}.decisions.json`)
    const publicationFile = join(this.outputRoot, `${slugBranch(report.batchKey)}.publication.json`)
    const reportText = `${JSON.stringify(report, null, 2)}\n`
    const decisionsText = decisions === undefined ? undefined : `${JSON.stringify(decisions, null, 2)}\n`
    const publicationText = `${JSON.stringify({ schemaVersion: 1,
      reportDigest: sha256hex(reportText),
      decisionsDigest: decisionsText === undefined ? null : sha256hex(decisionsText),
      ...(replayGeneration === undefined ? {} : { replayGeneration }),
    }, null, 2)}\n`
    mkdirSync(dirname(file), { recursive: true })
    // Unique temporary storage keeps concurrent writers from sharing a staging file.
    const temporary = mkdtempSync(join(this.outputRoot, '.publish-'))
    const replace = (target: string, text: string): void => {
      const staged = join(temporary, basename(target))
      try {
        writeFileSync(staged, text, 'utf8')
        renameSync(staged, target)
      } catch (error) {
        const io = error as NodeJS.ErrnoException
        if (typeof io.code !== 'string') throw error
        // The public failed file is the intended publication; retain OS detail and cause.
        throw Object.assign(new Error(io.message, { cause: error }), { code: io.code, path: target })
      }
    }
    try {
      replace(publicationFile, publicationText)
      // Invalidate even when this save supplies new vectors, before replacing the report.
      removeOptional(decisionsFile)
      replace(file, reportText)
      if (decisionsText !== undefined) replace(decisionsFile, decisionsText)
    } finally {
      for (const target of [publicationFile, file, decisionsFile]) {
        removeOptional(join(temporary, basename(target)))
      }
      rmdirSync(temporary)
    }
    return { batchKey: report.batchKey, file, ...(decisions === undefined ? {} : { decisionsFile }) }
  }
}
