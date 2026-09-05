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
// here, so a rerun of the same batch overwrites the same file (file-scoped plain rewrite) and a
// different batch lands beside it. Bytes are deterministic: same report ⇒ same path, same bytes.
// 415 D-16 adds an optional .decisions.json sidecar. Replacing a report without decisions
// removes that store-owned sidecar so a new run never inherits stale pairing evidence.
//
// `.agent-qa/eval/reports/` joins `eval/replays/` as UNCOMMITTED runtime staging: committed
// placement (the corpus root with fail-closed egress) is Phase 371/372's concern; Phase 372's
// baseline reads reports from exactly this path.
//
// eval-local serializes only (F9): the report arrives fully aggregated from eval core's
// buildEvalReport — no aggregation or scoring logic lives in this file.

import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { guardDecisionVectorsDocument } from '@vostride/agent-qa-eval'
import type { DecisionVectorsDocument, EvalBatchReport } from '@vostride/agent-qa-eval'
import { slugBranch } from '@vostride/agent-qa-schema'
import { z } from 'zod'

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
  | { kind: 'loaded'; report: EvalBatchReport; decisions?: DecisionVectorsDocument; file: string }
  | { kind: 'absent'; file: string }
  | { kind: 'refused'; file: string; reason: string }

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
  judge: z.object({
    judgeModelId: z.string(),
    judgeFamily: z.string(),
    judgeVersion: z.number(),
    confidenceThreshold: z.string(),
    familyOverride: z.literal('same-family-allowed').optional(),
  }).passthrough().optional(),
}).passthrough()

/** Probe exactly one directory; callers own the gate-root-first search order. */
export function loadStagedReport(
  root: string,
  batchKey: string,
  outputDir?: string,
): StagedReportLoad {
  const outputRoot = outputDir ?? join(root, DEFAULT_EVAL_REPORTS_SUBDIR)
  const stem = slugBranch(batchKey)
  const file = join(outputRoot, `${stem}.json`)
  let value: unknown
  try {
    value = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'absent', file }
    return { kind: 'refused', file, reason: `report unreadable: ${(error as Error).message}` }
  }
  const parsed = stagedReportSchema.safeParse(value)
  if (!parsed.success) {
    return { kind: 'refused', file, reason: `report rejected: ${parsed.error.message}` }
  }
  if (parsed.data.batchKey !== batchKey) {
    return { kind: 'refused', file, reason: 'report batchKey does not match the requested batchKey' }
  }
  const report = parsed.data as unknown as EvalBatchReport
  const decisionsFile = join(outputRoot, `${stem}.decisions.json`)
  let decisionsValue: unknown
  try {
    decisionsValue = JSON.parse(readFileSync(decisionsFile, 'utf8'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'loaded', report, file }
    return {
      kind: 'refused', file: decisionsFile,
      reason: `decisions unreadable: ${(error as Error).message}`,
    }
  }
  const guarded = guardDecisionVectorsDocument(decisionsValue)
  if (guarded.kind === 'rejected') {
    return { kind: 'refused', file: decisionsFile, reason: `decisions rejected: ${guarded.reason}` }
  }
  // Plan 09 passes only vectors into the gate; document identity must be checked here.
  for (const field of ['batchKey', 'matcherVersion'] as const) {
    if (guarded.document[field] !== report[field]) {
      return {
        kind: 'refused', file: decisionsFile,
        reason: `decisions ${field} does not match the report ${field}`,
      }
    }
  }
  return { kind: 'loaded', report, decisions: guarded.document, file }
}

export class FsReportStore {
  private readonly outputRoot: string

  constructor(config: FsReportStoreConfig) {
    this.outputRoot = config.outputDir ?? join(config.root, DEFAULT_EVAL_REPORTS_SUBDIR)
  }

  save(report: EvalBatchReport, decisions?: DecisionVectorsDocument): WrittenReport {
    if (decisions !== undefined) {
      for (const field of ['batchKey', 'matcherVersion'] as const) {
        if (decisions[field] !== report[field]) {
          throw new TypeError(`decisions ${field} does not match the report ${field}`)
        }
      }
    }
    const file = join(this.outputRoot, `${slugBranch(report.batchKey)}.json`)
    const decisionsFile = join(this.outputRoot, `${slugBranch(report.batchKey)}.decisions.json`)
    // Remove stale evidence before replacing its report, limited to this one owned file.
    if (decisions === undefined) {
      try {
        unlinkSync(decisionsFile)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    if (decisions !== undefined) {
      writeFileSync(decisionsFile, `${JSON.stringify(decisions, null, 2)}\n`, 'utf8')
    }
    return { batchKey: report.batchKey, file, ...(decisions === undefined ? {} : { decisionsFile }) }
  }
}
