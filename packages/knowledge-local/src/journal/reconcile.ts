/**
 * Deterministic recovery before a writer starts draining.
 *
 * The caller acquires the writer lease first, which bumps the fencing epoch on stale takeover.
 * This module then reclaims every non-current claim, resolves journal state against canonical
 * bundle truth, and delegates projection work through injected index functions. It deliberately
 * has no author/model dependency: recovery can replay only the persisted deterministic tail.
 */
import {
  existsSync,
  readFileSync,
  readdirSync,
  rmdirSync,
  rmSync,
} from 'node:fs'
import { basename, join } from 'node:path'

import { enumerateBundleDirs } from '../bundle-scan.js'
import { loadBundle } from '../bundle-read.js'
import {
  isLeaseStale,
  LEASE_FILE,
  readCurrentEpoch,
} from '../lease/writer-lease.js'
import {
  claimedCandidateDir,
  queuedCandidateDir,
} from '../queue/queue-layout.js'
import {
  listClaimedLeases,
  requeueClaimed,
} from '../queue/curation-queue.js'
import { readJobState, writeJobState } from '../queue/job-state.js'
import {
  clearCommitIntent,
  listCommitIntents,
  type CommitIntent,
} from './intent-journal.js'

export interface ReconcileOnDrainStartDependencies {
  knowledgeRoot: string
  hasIndexRow(bundleId: string): boolean
  applyIndexDelta(intent: CommitIntent): void
  deriveIndexRowFromBundle(bundleId: string): void
}

export interface ReconcileReport {
  intentsCleared: number
  intentsReplayed: number
  intentsDiscarded: number
  jobsRequeued: number
  orphansRemoved: number
  malformed: number
}

interface LiveWriterLease {
  leaseId: string
  epoch: number
}

function readLiveCurrentLease(knowledgeRoot: string): LiveWriterLease | undefined {
  let value: unknown
  try {
    value = JSON.parse(readFileSync(join(knowledgeRoot, LEASE_FILE), 'utf8'))
  } catch {
    return undefined
  }
  if (isLeaseStale(value, Date.now())) return undefined

  const lease = value as { leaseId?: unknown; epoch?: unknown }
  if (typeof lease.leaseId !== 'string' || typeof lease.epoch !== 'number') {
    return undefined
  }
  if (lease.epoch !== readCurrentEpoch(knowledgeRoot)) return undefined
  return { leaseId: lease.leaseId, epoch: lease.epoch }
}

function childDirectories(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

function stagingRoots(root: string): string[] {
  const roots: string[] = []
  const visit = (dir: string): void => {
    for (const name of childDirectories(dir)) {
      const child = join(dir, name)
      if (name === '.staging') {
        roots.push(child)
      } else {
        visit(child)
      }
    }
  }
  visit(root)
  return roots.sort()
}

function stagingEntryBelongsToLease(entryName: string, leaseId: string): boolean {
  return (
    entryName === leaseId ||
    entryName.startsWith(`${leaseId}-`) ||
    entryName.endsWith(`-${leaseId}`) ||
    entryName.includes(`-${leaseId}-`)
  )
}

function removeEmptyDirectory(dir: string): void {
  try {
    rmdirSync(dir)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'ENOENT' && code !== 'ENOTEMPTY' && code !== 'EEXIST') throw error
  }
}

function removeExpiredLeaseStaging(
  knowledgeRoot: string,
  expiredLeaseIds: ReadonlySet<string>,
): number {
  let removed = 0
  if (expiredLeaseIds.size === 0) return removed

  for (const stagingRoot of stagingRoots(knowledgeRoot)) {
    for (const entryName of childDirectories(stagingRoot)) {
      if (
        [...expiredLeaseIds].some((leaseId) =>
          stagingEntryBelongsToLease(entryName, leaseId),
        )
      ) {
        rmSync(join(stagingRoot, entryName), { recursive: true, force: true })
        removed += 1
      }
    }
    removeEmptyDirectory(stagingRoot)
  }
  return removed
}

function requeueCandidate(
  knowledgeRoot: string,
  candidateId: string,
  requeued: Set<string>,
): void {
  for (const leaseId of listClaimedLeases(knowledgeRoot)) {
    if (!existsSync(claimedCandidateDir(knowledgeRoot, leaseId, candidateId))) continue
    for (const movedCandidateId of requeueClaimed({ knowledgeRoot, leaseId })) {
      requeued.add(movedCandidateId)
    }
  }

  if (!existsSync(queuedCandidateDir(knowledgeRoot, candidateId))) return
  const state = readJobState(knowledgeRoot, candidateId)
  if (state.kind === 'parsed' && state.state.lifecycle === 'queued') return
  writeJobState({
    knowledgeRoot,
    candidateId,
    lifecycle: 'queued',
    embedCrashCount: state.kind === 'parsed' ? state.state.embedCrashCount : 0,
    ...(state.kind === 'parsed' && state.state.authored !== undefined
      ? { authored: state.state.authored }
      : {}),
  })
  requeued.add(candidateId)
}

function loadedBundleIds(knowledgeRoot: string): Map<string, string> {
  const loaded = new Map<string, string>()
  for (const entry of enumerateBundleDirs(knowledgeRoot)) {
    const outcome = loadBundle(entry.dir)
    if (outcome.kind !== 'loaded') continue
    loaded.set(outcome.bundle.manifest.id, entry.dir)
  }
  return loaded
}

/**
 * Reconcile the root after lease acquisition and before the first queue claim.
 *
 * Index writes are caller-injected so Plan 378-10 and this recovery path share one projection
 * authority. A thrown apply/derive operation intentionally leaves the intent in place for retry.
 */
export function reconcileOnDrainStart(
  deps: ReconcileOnDrainStartDependencies,
): ReconcileReport {
  const report: ReconcileReport = {
    intentsCleared: 0,
    intentsReplayed: 0,
    intentsDiscarded: 0,
    jobsRequeued: 0,
    orphansRemoved: 0,
    malformed: 0,
  }
  const requeued = new Set<string>()
  const current = readLiveCurrentLease(deps.knowledgeRoot)
  const expiredLeaseIds = new Set<string>()

  for (const leaseId of listClaimedLeases(deps.knowledgeRoot)) {
    if (current?.leaseId === leaseId) continue
    expiredLeaseIds.add(leaseId)
    for (const candidateId of requeueClaimed({
      knowledgeRoot: deps.knowledgeRoot,
      leaseId,
    })) {
      requeued.add(candidateId)
    }
  }
  report.orphansRemoved = removeExpiredLeaseStaging(
    deps.knowledgeRoot,
    expiredLeaseIds,
  )

  const entries = listCommitIntents(deps.knowledgeRoot)
  const bundleIdsWithIntent = new Set(
    entries.flatMap((entry) => ('parsed' in entry ? [entry.parsed.bundleId] : [])),
  )
  const bundles = loadedBundleIds(deps.knowledgeRoot)

  for (const entry of entries) {
    if ('malformed' in entry) {
      requeueCandidate(deps.knowledgeRoot, entry.candidateId, requeued)
      clearCommitIntent(deps.knowledgeRoot, entry.candidateId)
      report.intentsDiscarded += 1
      report.malformed += 1
      continue
    }

    const { parsed: intent } = entry
    if (!bundles.has(intent.bundleId)) {
      requeueCandidate(deps.knowledgeRoot, intent.candidateId, requeued)
      clearCommitIntent(deps.knowledgeRoot, intent.candidateId)
      report.intentsDiscarded += 1
      continue
    }

    if (!deps.hasIndexRow(intent.bundleId)) {
      deps.applyIndexDelta(intent)
      report.intentsReplayed += 1
    }
    clearCommitIntent(deps.knowledgeRoot, intent.candidateId)
    report.intentsCleared += 1
  }

  for (const [bundleId, dir] of bundles) {
    if (bundleIdsWithIntent.has(bundleId) || deps.hasIndexRow(bundleId)) continue
    const outcome = loadBundle(dir)
    if (outcome.kind !== 'loaded' || basename(dir) !== outcome.bundle.manifest.id) continue
    deps.deriveIndexRowFromBundle(bundleId)
  }

  report.jobsRequeued = requeued.size
  return report
}
