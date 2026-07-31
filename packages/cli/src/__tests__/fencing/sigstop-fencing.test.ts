import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import {
  acquireWriterLease,
  LEASE_HEARTBEAT_TTL_MS,
  enumerateBundleDirs,
  loadBundle,
  openIndexReaderConnection,
  readWriterLease,
} from '@vostride/agent-qa-knowledge-local'
import { afterAll, describe, expect, test } from 'vitest'

import { nudgeDaemon } from '../../daemon/client.js'
import { DAEMON_EVENTS_FILE } from '../../daemon/events.js'
import { inspectDaemonRegistration } from '../../daemon/registration.js'
import {
  buildFixture,
  writeFixture,
  type DualHostFixture,
} from '../dual-host/fixtures.js'
import { canonicalBundleTree, orderedLogicalDump } from '../dual-host/logical-dump.js'
import {
  FENCING_ENV,
  LEG_TIMEOUT_MS,
  cleanupFencingRoots,
  completeChildExpectingRefusal,
  completeChildSuccessfully,
  killIfRunning,
  makeRoot,
  sendSignalWhileAlive,
  startChild,
  waitForMarker,
  writeDurableJson,
} from './spawn-helpers.js'

const describePosix = process.platform === 'win32' ? describe.skip : describe

function singleCandidateFixture(): DualHostFixture {
  const source = buildFixture('mixed')
  return {
    ...source,
    candidates: [source.candidates[0]!],
    delayedCandidateId: null,
  }
}

function findEventAfter(
  events: readonly Record<string, unknown>[],
  after: number,
  predicate: (event: Record<string, unknown>) => boolean,
): number {
  const relative = events.slice(after + 1).findIndex(predicate)
  expect(relative).toBeGreaterThanOrEqual(0)
  return after + 1 + relative
}

function storeDigest(knowledgeRoot: string): string {
  return createHash('sha256')
    .update(canonicalBundleTree(knowledgeRoot))
    .update('\0')
    .update(orderedLogicalDump(knowledgeRoot))
    .digest('hex')
}

function immediateWriterAttempt(knowledgeRoot: string): 'busy' | 'entered' {
  const db = new DatabaseSync(join(knowledgeRoot, '.writer-authority.sqlite'), {
    timeout: 5,
  })
  let transactionOpen = false
  try {
    db.exec('BEGIN IMMEDIATE')
    transactionOpen = true
    return 'entered'
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code === 'ERR_SQLITE_ERROR'
      && /database is locked/i.test((error as Error).message)
    ) {
      return 'busy'
    }
    throw error
  } finally {
    if (transactionOpen) db.exec('ROLLBACK')
    db.close()
  }
}

describePosix('SIGSTOP writer-epoch fencing', () => {
  afterAll(cleanupFencingRoots)

    test('serializes takeover behind a drainer paused inside the publish rename mutation', async () => {
      const paths = makeRoot('publish-rename-held')
      const fixture = singleCandidateFixture()
      const candidateId = fixture.candidates[0]!.candidateId
      writeFixture(paths.fixture, fixture)

      const drainer = startChild('paused-drainer', paths, {
        [FENCING_ENV.pauseAt]: 'publish-rename',
      })
      try {
        const paused = await waitForMarker(
          drainer,
          paths.marker,
          'beforePublishRename marker',
        )
        expect(paused).toMatchObject({
          phase: 'beforePublishRename',
          pid: drainer.child.pid,
          candidateId,
          oldEpoch: 1,
        })
        sendSignalWhileAlive(drainer, 'SIGSTOP')

        expect(immediateWriterAttempt(paths.knowledgeRoot)).toBe('busy')
        const whilePaused = acquireWriterLease(paths.knowledgeRoot, {
          mutationLockTakeoverMs: 0,
        })
        expect(whilePaused).toMatchObject({
          kind: 'held',
          holder: {
            pid: drainer.child.pid,
            leaseId: paused.leaseId,
            epoch: 1,
          },
        })
        expect(drainer.child.exitCode).toBeNull()
        expect(drainer.child.signalCode).toBeNull()

        writeDurableJson(paths.permit, { resume: true })
        sendSignalWhileAlive(drainer, 'SIGCONT')
        const report = await completeChildSuccessfully(drainer, paths.drainerReport)
        expect(report).toMatchObject({
          pauseAt: 'publish-rename',
          candidateId,
          hookCount: 1,
          beforePublishRenameReached: true,
          acceptedKind: 'applied',
          publicationEntryCount: 1,
        })
        expect(enumerateBundleDirs(paths.knowledgeRoot)).toHaveLength(1)
        const { db } = openIndexReaderConnection(paths.knowledgeRoot)
        try {
          expect(db.prepare('SELECT COUNT(*) AS count FROM records').get()?.count).toBe(1)
        } finally {
          db.close()
        }

        expect(acquireWriterLease(paths.knowledgeRoot, {
          mutationLockTakeoverMs: 0,
        })).toMatchObject({ kind: 'acquired', epoch: 2 })
      } finally {
        if (drainer.child.exitCode === null && drainer.child.signalCode === null) {
          drainer.child.kill('SIGCONT')
        }
        await killIfRunning(drainer.child)
      }
    }, LEG_TIMEOUT_MS)

    test('refuses a drainer resumed after the daemon reclaims and commits X', async () => {
      const paths = makeRoot('reclaim')
      const fixture = singleCandidateFixture()
      writeFixture(paths.fixture, fixture)

      const drainer = startChild('paused-drainer', paths)
      let daemon: ReturnType<typeof startChild> | undefined
      try {
        const paused = await waitForMarker(drainer, paths.marker, 'afterIntentWritten marker')
        const candidateId = fixture.candidates[0]!.candidateId
        expect(paused).toMatchObject({
          phase: 'afterIntentWritten',
          pid: drainer.child.pid,
          candidateId,
          oldEpoch: 1,
        })
        sendSignalWhileAlive(drainer, 'SIGSTOP')

        await new Promise((resolve) =>
          setTimeout(resolve, LEASE_HEARTBEAT_TTL_MS + 1_500))

        daemon = startChild('reclaiming-daemon', paths)
        await waitForMarker(daemon, paths.readyMarker, 'successor daemon readiness')
        await nudgeDaemon(paths.agentQaRoot)
        const committed = await waitForMarker(
          daemon,
          paths.committedMarker,
          'successor commit and post-X heartbeat',
        )
        expect(committed).toMatchObject({
          committed: true,
          candidateId,
          holderPid: daemon.child.pid,
          epoch: 2,
          diskEpoch: 2,
        })
        expect(daemon.child.exitCode).toBeNull()
        expect(daemon.child.signalCode).toBeNull()

        const beforeResume = readWriterLease(paths.knowledgeRoot)
        expect(beforeResume.kind).toBe('parsed')
        if (beforeResume.kind !== 'parsed') throw new Error('successor lease disappeared')
        expect(beforeResume.lease).toMatchObject({
          pid: daemon.child.pid,
          leaseId: committed.leaseId,
          epoch: committed.epoch,
        })
        expect(Date.now() - beforeResume.lease.heartbeatAtMs).toBeLessThan(
          LEASE_HEARTBEAT_TTL_MS,
        )
        expect(Number(readFileSync(`${paths.knowledgeRoot}/.epoch`, 'utf8').trim())).toBe(2)

        writeDurableJson(paths.permit, { resume: true })
        sendSignalWhileAlive(drainer, 'SIGCONT')
        const refusal = await completeChildExpectingRefusal(drainer, paths.drainerReport)
        expect(refusal).toMatchObject({
          candidateId,
          oldEpoch: 1,
          exactInputRetained: true,
          hookCount: 1,
          beforePublishRenameReached: false,
          retainedReferenceEquality: {
            deps: true,
            job: true,
            checkpoint: true,
          },
          mutationFreeReplay: true,
          nonHeartbeatEventsUnchanged: true,
          publicationEntryCount: 0,
        })
        expect(refusal.outcomes).toEqual([{
            guard: 'beforePublish',
            kind: 'abandoned-stale-epoch',
            observedEpoch: 2,
          }, {
            guard: 'beforeWork',
            kind: 'abandoned-stale-epoch',
            observedEpoch: 2,
          }])

        const afterRefusal = readWriterLease(paths.knowledgeRoot)
        expect(afterRefusal.kind).toBe('parsed')
        if (afterRefusal.kind !== 'parsed') throw new Error('successor lease disappeared')
        expect(afterRefusal.lease).toMatchObject({
          pid: daemon.child.pid,
          leaseId: committed.leaseId,
          epoch: 2,
        })
        expect(Date.now() - afterRefusal.lease.heartbeatAtMs).toBeLessThan(
          LEASE_HEARTBEAT_TTL_MS,
        )
        expect(storeDigest(paths.knowledgeRoot)).toBe(committed.storeDigest)

        sendSignalWhileAlive(daemon, 'SIGTERM')
        const daemonReport = await completeChildSuccessfully(daemon, paths.daemonReport)
        expect(daemonReport).toMatchObject({ candidateId, exitCode: 0 })
        expect(inspectDaemonRegistration(paths.agentQaRoot).kind).toBe('absent')
        expect(readWriterLease(paths.knowledgeRoot).kind).toBe('absent')

        const bundles = enumerateBundleDirs(paths.knowledgeRoot)
        expect(bundles).toHaveLength(1)
        expect(loadBundle(bundles[0]!.dir).kind).toBe('loaded')
        const { db } = openIndexReaderConnection(paths.knowledgeRoot)
        try {
          expect(db.prepare('SELECT COUNT(*) AS count FROM records').get()?.count).toBe(1)
        } finally {
          db.close()
        }

        const events = readFileSync(
          `${paths.agentQaRoot}/${DAEMON_EVENTS_FILE}`,
          'utf8',
        ).trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>)
        const acquiredIndex = findEventAfter(events, -1, (event) =>
          event.kind === 'lease-acquired'
          && event.pid === committed.holderPid
          && event.leaseId === committed.leaseId
          && event.epoch === committed.epoch)
        const reclaimedIndex = findEventAfter(events, acquiredIndex, (event) =>
          event.kind === 'lease-reclaimed'
          && event.priorHolderPid === paused.pid
          && event.priorLeaseId === paused.leaseId
          && event.priorEpoch === paused.oldEpoch
          && event.newEpoch === committed.epoch)
        const epochIndex = findEventAfter(events, reclaimedIndex, (event) =>
          event.kind === 'epoch-bump' && event.epoch === committed.epoch)
        const sessionStartIndex = findEventAfter(events, epochIndex, (event) =>
          event.kind === 'drain-session-start'
          && event.holderPid === committed.holderPid
          && event.epoch === committed.epoch)
        const sessionId = events[sessionStartIndex]!.sessionId
        const claimedIndex = findEventAfter(events, sessionStartIndex, (event) =>
          event.kind === 'job-claimed'
          && event.candidateId === candidateId
          && event.sessionId === sessionId
          && event.holderPid === committed.holderPid
          && event.leaseId === committed.leaseId
          && event.epoch === committed.epoch)
        const completedIndex = findEventAfter(events, claimedIndex, (event) =>
          event.kind === 'job-completed'
          && event.candidateId === candidateId
          && event.sessionId === sessionId
          && event.holderPid === committed.holderPid
          && event.leaseId === committed.leaseId
          && event.epoch === committed.epoch)
        const sessionEndIndex = findEventAfter(events, completedIndex, (event) =>
          event.kind === 'drain-session-end'
          && event.sessionId === sessionId
          && event.holderPid === committed.holderPid
          && event.epoch === committed.epoch)
        const heartbeatIndex = findEventAfter(events, sessionEndIndex, (event) =>
          event.kind === 'lease-heartbeated'
          && event.pid === committed.holderPid
          && event.epoch === committed.epoch)
        findEventAfter(events, heartbeatIndex, (event) => event.kind === 'daemon-stopped')
        expect(events.filter((event) =>
          event.kind === 'job-completed' && event.candidateId === candidateId)).toHaveLength(1)
      } finally {
        if (drainer.child.exitCode === null && drainer.child.signalCode === null) {
          drainer.child.kill('SIGCONT')
        }
        await killIfRunning(drainer.child)
        if (daemon !== undefined) await killIfRunning(daemon.child)
        expect(existsSync(paths.fixture)).toBe(true)
      }
    }, LEG_TIMEOUT_MS)

    test('serializes takeover behind a drainer paused after the final authority comparison', async () => {
      const paths = makeRoot('post-comparison-held')
      const fixture = singleCandidateFixture()
      const candidateId = fixture.candidates[0]!.candidateId
      writeFixture(paths.fixture, fixture)

      const drainer = startChild('paused-drainer', paths, {
        [FENCING_ENV.pauseAt]: 'afterFinalAuthorityCompare',
      })
      try {
        const paused = await waitForMarker(
          drainer,
          paths.marker,
          'afterFinalAuthorityCompare marker',
        )
        expect(paused).toMatchObject({
          phase: 'afterFinalAuthorityCompare',
          pid: drainer.child.pid,
          candidateId,
          oldEpoch: 1,
        })
        sendSignalWhileAlive(drainer, 'SIGSTOP')
        expect(immediateWriterAttempt(paths.knowledgeRoot)).toBe('busy')
        expect(acquireWriterLease(paths.knowledgeRoot, {
          mutationLockTakeoverMs: 0,
        })).toMatchObject({
          kind: 'held',
          holder: {
            pid: drainer.child.pid,
            leaseId: paused.leaseId,
            epoch: 1,
          },
        })
        expect(drainer.child.exitCode).toBeNull()
        expect(drainer.child.signalCode).toBeNull()

        writeDurableJson(paths.permit, { resume: true })
        sendSignalWhileAlive(drainer, 'SIGCONT')
        const report = await completeChildSuccessfully(drainer, paths.drainerReport)
        expect(report).toMatchObject({
          pauseAt: 'afterFinalAuthorityCompare',
          candidateId,
          oldEpoch: 1,
          hookCount: 1,
          beforePublishRenameReached: true,
          acceptedKind: 'applied',
          publicationEntryCount: 1,
        })
        const bundles = enumerateBundleDirs(paths.knowledgeRoot)
        expect(bundles).toHaveLength(1)
        expect(loadBundle(bundles[0]!.dir).kind).toBe('loaded')
        const { db } = openIndexReaderConnection(paths.knowledgeRoot)
        try {
          expect(db.prepare('SELECT COUNT(*) AS count FROM records').get()?.count).toBe(1)
        } finally {
          db.close()
        }

        expect(acquireWriterLease(paths.knowledgeRoot, {
          mutationLockTakeoverMs: 0,
        })).toMatchObject({ kind: 'acquired', epoch: 2 })
      } finally {
        if (drainer.child.exitCode === null && drainer.child.signalCode === null) {
          drainer.child.kill('SIGCONT')
        }
        await killIfRunning(drainer.child)
        expect(existsSync(paths.fixture)).toBe(true)
      }
    }, LEG_TIMEOUT_MS)

    test('accepts the same real commit wrapper when authority was never reclaimed', async () => {
      const paths = makeRoot('no-pause-control')
      const fixture = singleCandidateFixture()
      const candidateId = fixture.candidates[0]!.candidateId
      writeFixture(paths.fixture, fixture)
      writeDurableJson(paths.permit, { resume: true, control: true })

      const control = startChild('paused-drainer', paths, {
        [FENCING_ENV.control]: '1',
      })
      try {
        const report = await completeChildSuccessfully(control, paths.drainerReport)
        expect(report).toMatchObject({
          failed: false,
          control: true,
          candidateId,
          hookCount: 1,
          acceptedKind: 'applied',
          publicationEntryCount: 1,
        })
        expect(enumerateBundleDirs(paths.knowledgeRoot)).toHaveLength(1)
        const { db } = openIndexReaderConnection(paths.knowledgeRoot)
        try {
          expect(db.prepare('SELECT COUNT(*) AS count FROM records').get()?.count).toBe(1)
        } finally {
          db.close()
        }
      } finally {
        await killIfRunning(control.child)
      }
    }, LEG_TIMEOUT_MS)
  })
