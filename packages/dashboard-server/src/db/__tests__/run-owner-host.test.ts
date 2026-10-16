import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  classifyRunOwner,
  createRunOwnerHostResolver,
  DashboardDatabase,
  defaultRunOwnership,
  orphanSummary,
  resolveRunOwnerHost,
  type RunOwnerProbe,
} from '../index.js'

const UUID = 'a1b2c3d4-e5f6-4789-abcd-0123456789ef'
const DIGEST = createHash('sha256').update(UUID.toUpperCase()).digest('hex')
const UUID_IDENTITY = /^macos-uuid-sha256:[0-9a-f]{64}$/

function namesInTurn(...names: string[]): () => string {
  let next = 0
  return () => names[Math.min(next++, names.length - 1)]
}

function countedUuidReader(...answers: Array<string | undefined>) {
  const reader = { calls: 0, read: () => answers[Math.min(reader.calls++, answers.length - 1)] }
  return reader
}

const inertProbe: RunOwnerProbe = { isAlive: () => true, incarnationOf: () => undefined }

function seedThenClassifyAfterRename(first: () => string, second: () => string) {
  const dir = mkdtempSync(join(tmpdir(), 'agent-qa-442-host-'))
  const dbPath = join(dir, 'runs.db')
  const seeding = new DashboardDatabase({
    dbPath,
    runOwnership: {
      self: { pid: 4242, incarnation: 'proc-starttime:7', host: first() },
      probe: inertProbe,
    },
  })
  const dashboard = new DashboardDatabase({
    dbPath,
    runOwnership: {
      self: { pid: 1000, incarnation: 'proc-starttime:1', host: second() },
      probe: { isAlive: (pid) => pid !== 4242, incarnationOf: () => undefined },
    },
  })
  try {
    const id = seeding.insertRun({
      name: 'Stamped before the rename',
      status: 'running',
      duration: 0,
      startedAt: '2026-10-16T00:00:00.000Z',
      endedAt: '2026-10-16T00:00:00.000Z',
    })
    const owner = dashboard.readRunOwner(id)
    if (owner === undefined) throw new Error('the running row carries no owner')
    const verdict = classifyRunOwner(owner, dashboard.runOwnership)
    const finalized = verdict === 'gone' && dashboard.finalizeOrphanRun(id, owner)
    return { verdict, finalized, run: dashboard.getRun(id) }
  } finally {
    seeding.close()
    dashboard.close()
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('C442-HOST-IDENTITY', () => {
  it('C442-HOST-IDENTITY a macOS host is its hardware UUID digest, unchanged when the host name changes', () => {
    const reader = countedUuidReader(UUID)
    const resolve = createRunOwnerHostResolver({
      platform: 'darwin',
      hostname: namesInTurn('name-1', 'name-2'),
      readPlatformUuid: reader.read,
    })
    const first = resolve()
    const second = resolve()
    expect(first).toMatch(UUID_IDENTITY)
    expect(first).toBe(`macos-uuid-sha256:${DIGEST}`)
    expect(second).toBe(first)
    for (const leaked of [UUID, UUID.toUpperCase(), 'name-1', 'name-2']) {
      expect(first).not.toContain(leaked)
    }
    expect(reader.calls).toBe(1)
  })

  it('C442-HOST-IDENTITY a macOS read failure names the host name under its own prefix, never equals a UUID identity, and is retried', () => {
    const reader = countedUuidReader(undefined, UUID)
    const resolve = createRunOwnerHostResolver({
      platform: 'darwin',
      hostname: () => 'name-1',
      readPlatformUuid: reader.read,
    })
    const fallback = resolve()
    const identity = resolve()
    expect(fallback).toBe('hostname:name-1')
    expect(identity).toBe(`macos-uuid-sha256:${DIGEST}`)
    expect(identity).not.toBe(fallback)
    expect(reader.calls).toBe(2)

    const dead = { isAlive: () => false, incarnationOf: () => undefined }
    const verdict = classifyRunOwner(
      { pid: 4242, incarnation: 'proc-starttime:7', host: fallback },
      { self: { pid: 1000, incarnation: 'proc-starttime:1', host: identity }, probe: dead },
    )
    expect(verdict).toBe('unknown')
  })

  it('C442-HOST-IDENTITY Linux and Windows hosts keep os.hostname()', () => {
    for (const platform of ['linux', 'win32'] as const) {
      const reader = countedUuidReader(UUID)
      const resolve = createRunOwnerHostResolver({
        platform,
        hostname: () => 'build-box.local',
        readPlatformUuid: reader.read,
      })
      expect(resolve()).toBe('build-box.local')
      expect(resolve()).toBe('build-box.local')
      expect(reader.calls).toBe(0)
    }
  })

  it("C442-HOST-IDENTITY this machine's identity is its UUID digest on macOS and its host name elsewhere", () => {
    if (process.platform === 'darwin') expect(resolveRunOwnerHost()).toMatch(UUID_IDENTITY)
    else expect(resolveRunOwnerHost()).toBe(hostname())
  })

  it('C442-HOST-IDENTITY a dead owner stamped before the host name changed is still finalized as an orphan', () => {
    const named = (platform: 'darwin' | 'linux', name: string) =>
      createRunOwnerHostResolver({ platform, hostname: () => name, readPlatformUuid: () => UUID })
    const renamed = seedThenClassifyAfterRename(
      named('darwin', 'name-1'),
      named('darwin', 'name-2'),
    )
    expect(renamed.verdict).toBe('gone')
    expect(renamed.finalized).toBe(true)
    expect(renamed.run?.status).toBe('failed')
    expect(renamed.run?.failureSummary).toBe(orphanSummary(4242))

    const byHostName = seedThenClassifyAfterRename(
      named('linux', 'name-1'),
      named('linux', 'name-2'),
    )
    expect(byHostName.verdict).toBe('unknown')
    expect(byHostName.run?.status).toBe('running')
  })

  it("C442-HOST-IDENTITY a handle injected without a host stamps and classifies with this machine's identity", () => {
    const here = resolveRunOwnerHost()
    const db = new DashboardDatabase({
      dbPath: ':memory:',
      runOwnership: {
        self: { pid: process.pid, incarnation: 'proc-starttime:7' },
        probe: inertProbe,
      },
    })
    try {
      const id = db.insertRun({
        name: 'Stamped by a host-less injector',
        status: 'running',
        duration: 0,
        startedAt: '2026-10-16T00:00:00.000Z',
        endedAt: '2026-10-16T00:00:00.000Z',
      })
      const owner = db.readRunOwner(id)
      expect(owner?.host).toBe(here)
      expect(db.runOwnership.self.host).toBe(here)
      if (owner === undefined) throw new Error('the running row carries no owner')
      expect(classifyRunOwner(owner, db.runOwnership)).toBe('self')
      expect(defaultRunOwnership().self.host).toBe(here)
    } finally {
      db.close()
    }
  })
})
