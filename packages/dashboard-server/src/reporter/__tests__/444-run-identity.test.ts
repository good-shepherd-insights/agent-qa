import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { RunEventEnvelope, RunEventType } from '@vostride/agent-qa-schema'
import { generateRunId, generateSuiteId, generateTestId } from '@vostride/agent-qa-ids'
import { DashboardDatabase } from '../../db/database.js'
import { createDashboardRunIngest, formatRunTitle, type RunIdentityMember } from '../index.js'

let db: DashboardDatabase
let seq = 0

beforeEach(() => {
  db = new DashboardDatabase({ dbPath: ':memory:' })
  seq = 0
})

afterEach(() => {
  db.close()
})

function ev(runId: string, type: RunEventType, payload: Record<string, unknown> = {}): RunEventEnvelope {
  return { seq: ++seq, ts: seq, runId, type, payload } as RunEventEnvelope
}

function member(name: string, suite?: { suiteId: string; suiteName: string }): RunIdentityMember {
  const slug = name.toLowerCase().replace(/[^a-z]+/g, '-')
  return { name, testId: generateTestId(), filePath: `tests/${slug}.yaml`, ...(suite ?? {}) }
}

function claim(members: readonly RunIdentityMember[] | undefined) {
  const runId = generateRunId()
  const ingest = createDashboardRunIngest({
    db,
    runId,
    ...(members === undefined ? {} : { members }),
    now: () => '2026-10-17T00:00:00.000Z',
  })
  ingest.handler(ev(runId, 'runStarted', { memberTestCount: members?.length ?? 0 }))
  const row = db.getRun(runId)
  expect(row, 'the claim wrote no row').toBeDefined()
  return {
    runId,
    ingest,
    identity: {
      name: row?.name,
      testId: row?.testId,
      filePath: row?.filePath,
      suiteId: row?.suiteId,
      status: row?.status,
    },
  }
}

describe('C444-RUN-TITLE', () => {
  it('formatRunTitle names two tests, then counts the rest', () => {
    expect(formatRunTitle(['Login', 'Checkout'])).toBe('Login · Checkout')
    expect(formatRunTitle(['Login', 'Checkout', 'Search'])).toBe('Login · Checkout +1 more')
    expect(formatRunTitle(['Login', 'Checkout', 'Search', 'Logout'])).toBe('Login · Checkout +2 more')
    expect(formatRunTitle(['Login'])).toBe('Login')
    expect(formatRunTitle([])).toBe('run')
  })

  it('a multi-test run is titled at the claim and carries no test id or file path', () => {
    const members = [member('Login'), member('Checkout'), member('Search')]
    const { identity } = claim(members)
    expect(identity.name).toBe('Login · Checkout +1 more')
    expect(identity).toEqual({
      name: 'Login · Checkout +1 more',
      testId: null,
      filePath: null,
      suiteId: null,
      status: 'running',
    })
  })

  it("a run claimed with no members keeps the store's default name and no ids", () => {
    for (const members of [undefined, []]) {
      const { identity } = claim(members)
      expect(identity).toEqual({ name: 'run', testId: null, filePath: null, suiteId: null, status: 'running' })
    }
  })
})

describe('C444-SINGLE-TITLE', () => {
  it('a single-test run is titled, identified and filed by its test at the claim', () => {
    const only = member('Login')
    const { identity } = claim([only])
    expect(identity).toEqual({
      name: 'Login',
      testId: only.testId,
      filePath: only.filePath,
      suiteId: null,
      status: 'running',
    })
  })
})

describe('C444-SUITE-TITLE', () => {
  it("a one-suite run keeps the suite's name and id", () => {
    const suite = { suiteId: generateSuiteId(), suiteName: 'Storefront smoke' }
    const { identity } = claim([member('Login', suite), member('Checkout', suite), member('Search', suite)])
    expect(identity).toEqual({
      name: 'Storefront smoke',
      testId: null,
      filePath: null,
      suiteId: suite.suiteId,
      status: 'running',
    })
  })

  it('a run spanning two suites is titled by the suite names and carries no suite id', () => {
    const checkout = { suiteId: generateSuiteId(), suiteName: 'Checkout suite' }
    const login = { suiteId: generateSuiteId(), suiteName: 'Login suite' }
    const search = { suiteId: generateSuiteId(), suiteName: 'Search suite' }
    const two = claim([member('Pay', checkout), member('Sign in', login), member('Refund', checkout)])
    expect(two.identity).toEqual({
      name: 'Checkout suite · Login suite',
      testId: null,
      filePath: null,
      suiteId: null,
      status: 'running',
    })
    const three = claim([
      member('Pay', checkout),
      member('Sign in', login),
      member('Refund', checkout),
      member('Find', search),
    ])
    expect(three.identity.name).toBe('Checkout suite · Login suite +1 more')
    expect(three.identity.suiteId).toBeNull()
  })
})
