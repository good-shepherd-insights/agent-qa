// 2026-09-07, 417 D-05/D-06/D-07: identity-bearing profile run roots (F-02).
// Read-only cache resolution; a corpus change does not invalidate an individual cassette.
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { canonicalJson, type ReplayCassetteOutcome } from '@vostride/agent-qa-eval'
import { sha256hex, slugBranch } from '@vostride/agent-qa-schema'
import { loadReplayRecord, loadScoreRecord } from './replay-read.js'
import { loadStagedReport } from './report-store.js'
import type { ScoreRecord } from './score-store.js'
import { baselineReplaySchema, baselineScoreSchema } from './baseline-cache-guards.js'

export function listBaselineRunRoots(
  agentQaRoot: string,
  profileKey: string,
): {
  root: string
  kind: 'gate' | 'floor'
  seed?: number
}[] {
  const roots: ReturnType<typeof listBaselineRunRoots> = []
  const gate = join(agentQaRoot, 'eval', 'gate', slugBranch(profileKey))
  if (existsSync(gate)) roots.push({ root: gate, kind: 'gate' })
  const floor = join(agentQaRoot, 'eval', 'floor', slugBranch(profileKey))
  if (!existsSync(floor)) return roots
  for (const entry of readdirSync(floor, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const match = /^r\d+-seed(-?\d+)$/.exec(entry.name)
    if (entry.isDirectory() && match && Number.isSafeInteger(Number(match[1]))) {
      roots.push({ root: join(floor, entry.name), kind: 'floor', seed: Number(match[1]) })
    }
  }
  return roots
}

export type BaselineCacheRow =
  | {
      cassetteId: string
      kind: 'cached'
      root: string
      replay: ReplayCassetteOutcome
      score: ScoreRecord
      seed: number
      seedSource: string
      seedHonored: boolean
    }
  | { cassetteId: string; kind: 'refused'; root: string; reason: string }
  | { cassetteId: string; kind: 'uncached'; reason: string }
export interface BaselineCacheResolution {
  rows: BaselineCacheRow[]
  roots: string[]
}

export function resolveBaselineCache(input: {
  agentQaRoot: string
  profileKey: string
  fingerprint: string
  matcherVersion: number
  plannerModelId: string
  judgeIdentity?: { judgeModelId: string; judgeVersion: number }
  gateRootSeed: number
  gateRootSeedSource: string
  cassettes: readonly { id: string; promptInputHash: string }[]
}): BaselineCacheResolution {
  const resolved = new Map<string, BaselineCacheRow>()
  const failures = new Map<string, string>()
  const roots = new Set<string>()
  for (const run of listBaselineRunRoots(input.agentQaRoot, input.profileKey)) {
    const reportsDir = join(run.root, 'reports')
    let names: string[] = []
    try {
      names = readdirSync(reportsDir)
        .filter((name) => /^[^.]+\.json$/.test(name))
        .sort()
    } catch {
      /* cold root */
    }
    const reports = names.map((name) =>
      loadStagedReport(input.agentQaRoot, name.slice(0, -5), reportsDir),
    )
    const matchingReports = reports.filter(
      (read): read is Extract<typeof read, { kind: 'loaded' }> =>
        read.kind === 'loaded' &&
        read.report.runIdentity?.fingerprint === input.fingerprint &&
        read.report.matcherVersion === input.matcherVersion,
    )
    if (matchingReports.length === 0) {
      const reason = reports.some((read) => read.kind === 'loaded')
        ? 'report fingerprint or matcherVersion mismatch'
        : 'missing or refused replay record report'
      for (const cassette of input.cassettes) failures.set(cassette.id, reason)
      continue
    }
    for (const cassette of input.cassettes) {
      if (resolved.has(cassette.id)) continue
      const miss = (reason: string) => failures.set(cassette.id, reason)
      const dir = join(run.root, 'replays', ...cassette.id.split('/').map(slugBranch))
      const loaded = loadReplayRecord(dir)
      if (loaded.kind !== 'loaded') {
        miss('missing or refused replay record')
        continue
      }
      const replay = loaded.outcome
      if (!baselineReplaySchema.safeParse(replay).success) {
        miss('invalid replay record: malformed leaf samples, refusal, or replay metadata')
        continue
      }
      if (replay.cassetteId !== cassette.id) {
        miss('replay cassetteId mismatch')
        continue
      }
      if ('kind' in replay) {
        resolved.set(cassette.id, {
          cassetteId: cassette.id,
          kind: 'refused',
          root: run.root,
          reason: replay.reason,
        })
        roots.add(run.root)
        continue
      }
      if (replay.granularity !== 'leaf') {
        miss('replay is not a leaf')
        continue
      }
      if (replay.promptDrift?.recordedHash !== cassette.promptInputHash) {
        miss('promptInputHash mismatch: promptDrift.recordedHash differs')
        continue
      }
      if (replay.replayedModel?.modelId !== input.plannerModelId) {
        miss('replayedModel.modelId mismatch')
        continue
      }
      const score = loadScoreRecord(dir)
      if (score.kind !== 'loaded') {
        miss('missing or refused score record')
        continue
      }
      if (!baselineScoreSchema.safeParse(score.record).success) {
        miss(
          'invalid score record: malformed score, diffs, or nested cassetteId/matcherVersion identities',
        )
        continue
      }
      if (score.record.cassetteId !== cassette.id) {
        miss('score cassetteId mismatch')
        continue
      }
      if (score.record.matcherVersion !== input.matcherVersion) {
        miss('score matcherVersion mismatch')
        continue
      }
      const judge = score.record.judge
      if (
        input.judgeIdentity === undefined
          ? judge !== undefined
          : judge?.judgeModelId !== input.judgeIdentity.judgeModelId ||
            judge?.judgeVersion !== input.judgeIdentity.judgeVersion
      ) {
        miss('judge identity mismatch')
        continue
      }
      // A gate root can hold multiple batch reports. Admit against the publication
      // that binds this row, never whichever filename happens to sort first.
      const replayDigest = sha256hex(canonicalJson(replay))
      const scoreDigest = sha256hex(canonicalJson(score.record))
      const report = matchingReports.find((candidate) => {
        const generation = candidate.replayGeneration
        if (generation === undefined)
          return (
            run.kind === 'floor' &&
            (Reflect.get(replay, 'executionSeed') === undefined ||
              Reflect.get(replay, 'executionSeed') === run.seed)
          )
        const matching = generation.records.filter((record) => record.cassetteId === cassette.id)
        const recorded = matching[0]
        return (
          matching.length === 1 &&
          recorded?.replayDigest === replayDigest &&
          recorded.scoreDigest === scoreDigest &&
          Reflect.get(replay, 'executionSeed') === generation.seed &&
          (run.seed === undefined || run.seed === generation.seed)
        )
      })
      if (report === undefined) {
        miss(
          run.kind === 'gate' && matchingReports.every((row) => row.replayGeneration === undefined)
            ? 'gate replay seed is unproven: missing run publication generation'
            : 'replay generation mismatch: seed or record digests differ from run publication',
        )
        continue
      }
      const generation = report.replayGeneration
      resolved.set(cassette.id, {
        cassetteId: cassette.id,
        kind: 'cached',
        root: run.root,
        replay,
        score: score.record,
        seed: generation?.seed ?? run.seed!,
        seedSource: generation === undefined ? 'run-dir' : 'run-publication',
        seedHonored: report.report.seedHonored === true,
      })
      roots.add(run.root)
    }
  }
  return {
    rows: input.cassettes.map(
      (cassette) =>
        resolved.get(cassette.id) ?? {
          cassetteId: cassette.id,
          kind: 'uncached',
          reason: failures.get(cassette.id) ?? 'missing replay record',
        },
    ),
    roots: [...roots],
  }
}
