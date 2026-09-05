import { resolveProductPartition } from '@vostride/agent-qa-eval'
import type {
  Cassette,
  CassetteLabelLeg,
  CassetteScore,
  JudgeIdentityBlock,
  ScoredBatchEntry,
} from '@vostride/agent-qa-eval'

import { loadCassetteBundle } from './cassette-loader.js'
import {
  listCassetteBundleDirs,
  listReplayRecordDirs,
  loadReplayRecord,
  loadScoreRecord,
} from './replay-read.js'

/**
 * Resolve the product partition from the recorded served-brief scope. Procedures read their
 * first decision record; a cassette with no decision maps to the typed 'default' partition.
 */
export function cassetteProductPartition(cassette: Cassette): string {
  if (cassette.granularity === 'leaf') {
    return resolveProductPartition(cassette.input.servedBrief.scope)
  }
  for (const step of cassette.steps) {
    if (step.kind === 'decision') {
      return resolveProductPartition(step.record.input.servedBrief.scope)
    }
  }
  return 'default'
}

/**
 * Assemble report inputs from the caller's replay root, joining labels and product partitions
 * from cassette bundles. Scores and judge blocks come only from persisted records; every
 * replay remains an entry, including a record that can only be read as a typed refusal.
 */
export function assembleScoredBatch(input: {
  replaysRoot: string
  cassettesRoot: string
  source: string
}): {
  entries: ScoredBatchEntry[]
  judgeBlocks: JudgeIdentityBlock[]
  partitionsById: Map<string, string>
  missingBundleCount: number
  notices: string[]
} {
  const { replaysRoot, cassettesRoot, source } = input
  const notices: string[] = []

  // Only leaf cassettes carry a label leg; procedures join with partition only.
  const labelsById = new Map<string, CassetteLabelLeg>()
  const partitionsById = new Map<string, string>()
  for (const bundleDir of listCassetteBundleDirs(cassettesRoot)) {
    const load = loadCassetteBundle(bundleDir)
    if (load.kind === 'refused') {
      notices.push(`${source} bundle read refused under ${bundleDir}: ${load.refusal.detail}`)
      continue
    }
    if (load.cassette.granularity === 'leaf') {
      labelsById.set(load.cassette.id, load.cassette.label)
    }
    partitionsById.set(load.cassette.id, cassetteProductPartition(load.cassette))
  }

  const entries: ScoredBatchEntry[] = []
  const judgeBlocks: JudgeIdentityBlock[] = []
  let missingBundleCount = 0
  for (const recordDir of listReplayRecordDirs(replaysRoot)) {
    const load = loadReplayRecord(recordDir)
    const outcome = load.kind === 'loaded' ? load.outcome : load.refusal
    if (load.kind === 'refused') {
      notices.push(`replay record read refused under ${recordDir}: ${load.refusal.detail}`)
    }
    const cassetteId = outcome.cassetteId

    let score: CassetteScore | undefined
    const scoreLoad = loadScoreRecord(recordDir)
    if (scoreLoad.kind === 'loaded') {
      score = scoreLoad.record.score
      if (scoreLoad.record.judge !== undefined) judgeBlocks.push(scoreLoad.record.judge)
    } else if (scoreLoad.kind === 'refused') {
      notices.push(`score read refused under ${recordDir}: ${scoreLoad.refusal.detail}`)
    }

    const label = labelsById.get(cassetteId)
    const product = partitionsById.get(cassetteId)
    if (!partitionsById.has(cassetteId)) missingBundleCount++

    entries.push({
      cassetteId,
      outcome,
      ...(score !== undefined ? { score } : {}),
      ...(label !== undefined ? { label } : {}),
      ...(product !== undefined ? { product } : {}),
    })
  }

  return { entries, judgeBlocks, partitionsById, missingBundleCount, notices }
}
