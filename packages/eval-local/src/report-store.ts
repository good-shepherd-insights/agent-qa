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
//
// `.agent-qa/eval/reports/` joins `eval/replays/` as UNCOMMITTED runtime staging: committed
// placement (the corpus root with fail-closed egress) is Phase 371/372's concern; Phase 372's
// baseline reads reports from exactly this path.
//
// eval-local serializes only (F9): the report arrives fully aggregated from eval core's
// buildEvalReport — no aggregation or scoring logic lives in this file.

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import type { EvalBatchReport } from '@vostride/agent-qa-eval'
import { slugBranch } from '@vostride/agent-qa-schema'

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
}

export class FsReportStore {
  private readonly outputRoot: string

  constructor(config: FsReportStoreConfig) {
    this.outputRoot = config.outputDir ?? join(config.root, DEFAULT_EVAL_REPORTS_SUBDIR)
  }

  save(report: EvalBatchReport): WrittenReport {
    const file = join(this.outputRoot, `${slugBranch(report.batchKey)}.json`)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    return { batchKey: report.batchKey, file }
  }
}
