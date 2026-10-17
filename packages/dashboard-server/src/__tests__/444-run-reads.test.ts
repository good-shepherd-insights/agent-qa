import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { DashboardDatabase } from '../db/database.js'
import type { ExecutionBackend } from '../execution/execution-backend.js'
import { startServer } from '../server/server.js'

const SEVEN = ['pending', 'running', 'passed', 'healed', 'failed', 'timeout', 'cancelled'] as const
const FINISHED = ['passed', 'healed', 'failed', 'timeout', 'cancelled'] as const

class IdleBackend extends EventEmitter {
  execute = (): void => undefined
  kill = (): boolean => false
  killAll = (): void => undefined
  getActiveExecutions = (): [] => []
}

let dir: string
let dbPath: string
let configPath: string
let db: DashboardDatabase
const started: Array<{ close: () => void }> = []

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agent-qa-444-run-reads-'))
  dbPath = join(dir, 'runs.db')
  configPath = join(dir, 'agent-qa.config.yaml')
  writeFileSync(configPath, 'testDir: tests\n')
  db = new DashboardDatabase({ dbPath })
})

afterEach(() => {
  while (started.length > 0) started.pop()?.close()
  db.close()
  vi.restoreAllMocks()
  rmSync(dir, { recursive: true, force: true })
})

function seedRun(
  status: string,
  overrides: { id?: string; name?: string; startedAt?: string; suiteId?: string; filePath?: string; testId?: string } = {},
): string {
  const startedAt = overrides.startedAt ?? '2026-10-01T10:00:00.000Z'
  return db.insertRun({
    id: overrides.id,
    name: overrides.name ?? `Run ${status}`,
    status,
    duration: 1000,
    startedAt,
    endedAt: startedAt,
    ...(overrides.suiteId ? { suiteId: overrides.suiteId } : {}),
    ...(overrides.filePath ? { filePath: overrides.filePath } : {}),
    ...(overrides.testId ? { testId: overrides.testId } : {}),
  })
}

function seedSevenWords(): Record<(typeof SEVEN)[number], string> {
  const ids = {} as Record<(typeof SEVEN)[number], string>
  for (const [index, status] of SEVEN.entries()) {
    const id = seedRun(status, {
      id: `run_444-${status}`,
      name: 'Seven words',
      startedAt: `2026-10-01T10:0${String(index)}:00.000Z`,
      suiteId: 's_seven',
      filePath: 'tests/seven.yaml',
      testId: 't_seven',
    })
    db.upsertRunMember({
      runId: id,
      testIndex: 0,
      testId: 't_seven',
      name: 'Seven words',
      filePath: 'tests/seven.yaml',
      suiteId: 's_seven',
      ...(status === 'pending' || status === 'running' ? {} : { outcome: status }),
    })
    ids[status] = id
  }
  return ids
}

async function startDashboard(): Promise<string> {
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
  const handle = await startServer({
    declaredSecretMask: (text) => text,
    db: new DashboardDatabase({ dbPath }),
    port: 0,
    configPath,
    executionBackend: new IdleBackend() as unknown as ExecutionBackend,
  })
  started.push(handle)
  const { port } = handle.server.address() as AddressInfo
  return `http://127.0.0.1:${String(port)}`
}

async function getJson(url: string): Promise<{ status: number; body: any }> {
  const response = await fetch(url)
  return { status: response.status, body: await response.json() }
}

describe('C444-STATUS-CLASS', () => {
  it('the classifier sorts the seven words into pass, fail, cancelled and live', async () => {
    const { runStatusClass, RUN_STATUS_WORDS } = await import('../db/run-status-class.js')

    expect([...RUN_STATUS_WORDS]).toEqual([...SEVEN])
    expect(Object.fromEntries(SEVEN.map((word) => [word, runStatusClass(word)]))).toEqual({
      pending: 'live',
      running: 'live',
      passed: 'pass',
      healed: 'pass',
      failed: 'fail',
      timeout: 'fail',
      cancelled: 'cancelled',
    })
    expect(() => runStatusClass('flaky')).toThrow(/flaky/)
  })

  it('healed counts as a pass and timeout as a fail in trends and the insights summary', () => {
    seedSevenWords()

    const stats = db.getStats()
    expect(stats.totalRuns).toBe(7)
    expect(stats.passed).toBe(2)
    expect(stats.failed).toBe(2)
    expect(stats.runs).toEqual([
      expect.objectContaining({ date: '2026-10-01', passed: 2, failed: 2 }),
    ])

    const trends = db.getSuiteTrends('s_seven')
    expect(trends.totalRuns).toBe(7)
    expect(trends.passRate).toBeCloseTo(2 / 7)
    expect(trends.daily).toEqual([
      expect.objectContaining({ date: '2026-10-01', passed: 2, failed: 2, total: 7 }),
    ])

    const [platform] = db.getInsightsBreakdown('platform')
    expect(platform).toMatchObject({ key: 'web', runs: 7, passed: 2, failed: 2 })
    expect(platform!.passRate).toBeCloseTo(2 / 7)
  })

  it('the insights flaky count reads the stored healed word', () => {
    seedRun('passed', { name: 'Checkout flow' })
    seedRun('healed', { name: 'Checkout flow' })
    seedRun('failed', { name: 'Checkout flow' })

    const stats = db.getStats()
    expect(stats.flaky).toBe(1)
    expect(stats.flakeRate).toBeCloseTo(1 / 3)
    expect(stats.runs).toEqual([expect.objectContaining({ healed: 1 })])

    const [checkout] = db.getInsightsBreakdown('test')
    expect(checkout).toMatchObject({ key: 'Checkout flow', runs: 3 })
    expect(checkout!.flakeRate).toBeCloseTo(1 / 3)
    expect(checkout!.passRate).toBeCloseTo(2 / 3)
  })
})

describe('C444-RUNS-FILTER', () => {
  it('repeated status parameters list every run in any of those words', async () => {
    const ids = seedSevenWords()
    const finishedIds = FINISHED.map((word) => ids[word]).sort()

    expect(db.getRuns({ statuses: FINISHED }).map((run) => run.id).sort()).toEqual(finishedIds)

    const origin = await startDashboard()
    const query = FINISHED.map((word) => `status=${word}`).join('&')
    const { status, body } = await getJson(`${origin}/api/runs?${query}`)
    expect(status).toBe(200)
    expect(body.total).toBe(5)
    expect((body.runs as Array<{ id: string }>).map((run) => run.id).sort()).toEqual(finishedIds)
  })

  it('one status parameter lists that word only', async () => {
    const ids = seedSevenWords()

    const origin = await startDashboard()
    const { status, body } = await getJson(`${origin}/api/runs?status=healed`)
    expect(status).toBe(200)
    expect(body.total).toBe(1)
    expect((body.runs as Array<{ id: string; status: string }>).map((run) => [run.id, run.status])).toEqual([
      [ids.healed, 'healed'],
    ])
  })

  it('an unknown status word is refused with 400', async () => {
    seedSevenWords()

    const origin = await startDashboard()
    const { status, body } = await getJson(`${origin}/api/runs?status=passed&status=flaky`)
    expect(status).toBe(400)
    expect(body).toEqual({ error: 'Unknown run status: flaky.' })
  })
})
