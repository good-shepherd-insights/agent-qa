import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { NETWORK_BODY_MAX_BYTES } from '@vostride/agent-qa-schema'

// 423-25 (R-26): measurement of a SYNTHETIC finalized-v3 fixture. Nothing here is a production
// maximum, a snapshot cap or an input to the locked inline/blob layout (D-03/D-07/D-08).
const LABEL = 'SYNTHETIC fixture measurement; not a production maximum, cap or layout input'

interface PageFacts { pageSize: number; pageCount: number; bytes: number; freelistCount: number }
interface BtreeFacts { pages: number; bytes: number; payloadBytes: number; unusedBytes: number; cells: number; overflowPages: number }
interface TableLogical { rows: number; valueBytes: number; maxRowValueBytes: number; columns: Record<string, number> }
interface Snapshot {
  userVersion: number
  pages: PageFacts
  logical: Record<'run_steps' | 'run_sub_actions', TableLogical>
  btrees: Record<string, BtreeFacts>
}
interface Measurements {
  fresh: { before: Snapshot; after: Snapshot; categories: Record<string, number> }
  historical: { v2: Snapshot; v3: Snapshot; absentFields: string[] }
  network: { blobBytes: number; bodyBytes: { request: number; response: number }; stepEvidenceBytes: number; bodyInDatabase: boolean; secretInBlob: boolean; secretInDatabase: boolean }
  dbstatError?: string
}

let dir: string
let measured: Measurements

async function measureFixtures(_root: string): Promise<Measurements> {
  return {
    fresh: { before: emptySnapshot(), after: emptySnapshot(), categories: {} },
    historical: { v2: emptySnapshot(), v3: emptySnapshot(), absentFields: [] },
    network: { blobBytes: 0, bodyBytes: { request: 0, response: 0 }, stepEvidenceBytes: 0, bodyInDatabase: true, secretInBlob: true, secretInDatabase: true },
  }
}

function emptySnapshot(): Snapshot {
  const table = (): TableLogical => ({ rows: 0, valueBytes: 0, maxRowValueBytes: 0, columns: {} })
  return { userVersion: 0, pages: { pageSize: 0, pageCount: 0, bytes: 0, freelistCount: 0 },
    logical: { run_steps: table(), run_sub_actions: table() }, btrees: {} }
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'agent-qa-423-row-budget-'))
  measured = await measureFixtures(dir)
})
afterAll(() => { rmSync(dir, { recursive: true, force: true }) })

function report(cell: string, value: unknown): void {
  console.info(cell, JSON.stringify({ label: LABEL, ...value as object }))
}

it('ROW-BUDGET-LOGICAL: finalized v3 rows report UTF-8 logical value bytes per table, column and category', () => {
  const { before, after, categories } = measured.fresh
  report('ROW-BUDGET-LOGICAL', { categories, before: before.logical, after: after.logical,
    historicalV3: measured.historical.v3.logical })
  expect(after.userVersion).toBe(3)
  for (const table of ['run_steps', 'run_sub_actions'] as const) {
    expect(before.logical[table].rows).toBe(0)
    expect(after.logical[table].rows).toBeGreaterThan(0)
    expect(after.logical[table].valueBytes).toBeGreaterThan(0)
  }
  for (const column of ['evidence_json', 'variable_snapshot_json', 'model_usage_json']) {
    expect(after.logical.run_steps.columns[column]).toBeGreaterThan(0)
  }
  expect(after.logical.run_sub_actions.columns.evidence_state_json).toBeGreaterThan(0)
  for (const category of ['absent-only', 'usage-reported-zero', 'usage-present', 'evidence-present', 'variables-large', 'network-32kib']) {
    expect(categories[category]).toBeGreaterThan(0)
  }
  expect(categories['variables-large']).toBeGreaterThan(40_000)
  expect(categories['network-32kib']).toBeLessThan(NETWORK_BODY_MAX_BYTES)
  for (const column of ['evidence_json', 'variable_snapshot_json', 'model_usage_json']) {
    expect(measured.historical.v3.logical.run_steps.columns[column]).toBe(0)
  }
})

it('ROW-BUDGET-PAGES: PRAGMA page_size and page_count before and after insertion, fresh v3 and populated v2-to-v3', () => {
  const { fresh, historical } = measured
  report('ROW-BUDGET-PAGES', {
    fresh: { before: fresh.before.pages, after: fresh.after.pages,
      deltaPages: fresh.after.pages.pageCount - fresh.before.pages.pageCount,
      deltaBytes: fresh.after.pages.bytes - fresh.before.pages.bytes },
    historical: { v2: historical.v2.pages, v3: historical.v3.pages,
      deltaPages: historical.v3.pages.pageCount - historical.v2.pages.pageCount },
  })
  expect(fresh.before.pages.pageSize).toBeGreaterThan(0)
  expect(fresh.after.pages.pageSize).toBe(fresh.before.pages.pageSize)
  expect(fresh.after.pages.pageCount).toBeGreaterThan(fresh.before.pages.pageCount)
  expect(fresh.after.pages.bytes).toBe(fresh.after.pages.pageSize * fresh.after.pages.pageCount)
  expect(historical.v2.userVersion).toBe(2)
  expect(historical.v3.userVersion).toBe(3)
  expect(historical.v2.pages.pageCount).toBeGreaterThan(0)
  expect(historical.absentFields).toEqual(['evidence', 'variableSnapshot', 'modelUsage', 'ariaEvidence'])
})

it('ROW-BUDGET-PAYLOAD: dbstat page, payload and unused bytes for run_steps and run_sub_actions', () => {
  if (measured.dbstatError !== undefined) {
    throw new Error(`ROW-BUDGET-PAYLOAD BLOCKED: dbstat unavailable in this SQLite build: ${measured.dbstatError}`)
  }
  const { fresh, historical } = measured
  report('ROW-BUDGET-PAYLOAD', { fresh: { before: fresh.before.btrees, after: fresh.after.btrees },
    historical: { v2: historical.v2.btrees, v3: historical.v3.btrees } })
  for (const table of ['run_steps', 'run_sub_actions']) {
    const after = fresh.after.btrees[table]!
    expect(after.pages).toBeGreaterThan(0)
    expect(after.payloadBytes).toBeGreaterThan(0)
    expect(after.bytes).toBe(after.pages * fresh.after.pages.pageSize)
    expect(after.unusedBytes).toBeGreaterThanOrEqual(0)
    expect(after.payloadBytes).toBeGreaterThan(fresh.before.btrees[table]!.payloadBytes)
    expect(historical.v3.btrees[table]!.payloadBytes).toBe(historical.v2.btrees[table]!.payloadBytes)
  }
  expect(fresh.after.btrees.run_steps!.overflowPages).toBeGreaterThan(0)
})

it('ROW-BUDGET-NETWORK-OFF-ROW: 32 KiB masked request and response bodies live only in blob storage', () => {
  const { network } = measured
  report('ROW-BUDGET-NETWORK-OFF-ROW', network)
  expect(network.bodyBytes).toEqual({ request: NETWORK_BODY_MAX_BYTES, response: NETWORK_BODY_MAX_BYTES })
  expect(network.blobBytes).toBeGreaterThan(NETWORK_BODY_MAX_BYTES * 2 - 256)
  expect(network.stepEvidenceBytes).toBeGreaterThan(0)
  expect(network.stepEvidenceBytes).toBeLessThan(1024)
  expect(network.bodyInDatabase).toBe(false)
  expect(network.secretInBlob).toBe(false)
  expect(network.secretInDatabase).toBe(false)
})
