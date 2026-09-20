import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { DashboardDatabase } from '../db/database.js'
import { createDashboardSqliteDatabase } from '../db/sqlite.js'
import { createDashboardRunIngest } from '../reporter/dashboard-subscriber.js'
import { EvidenceArtifactRefSchema, NETWORK_BODY_MAX_BYTES } from '@vostride/agent-qa-schema'
import type {
  EvidenceDocument, RunEventEnvelope, StepFinalizedPayload, SubActionRecordedPayload,
} from '@vostride/agent-qa-schema'
import { buildRunMaskingContext } from '@vostride/agent-qa-agent-local'
import { FsEvidenceArtifactStore } from '@vostride/agent-qa-runner-local'

// 423-25 (R-26): measurement of a SYNTHETIC finalized-v4 fixture. Nothing here is a production
// maximum, a snapshot cap or an input to the locked inline/blob layout (D-03/D-07/D-08).
const LABEL = 'SYNTHETIC fixture measurement; not a production maximum, cap or layout input'
const RUN_ID = 'synthetic-row-budget-run'
const SECRET = 'synthetic-row-budget-secret-0000000000000001'
const FILLER = 'synthetic-network-filler-'
const TABLES = ['run_steps', 'run_sub_actions'] as const

interface PageFacts { pageSize: number; pageCount: number; bytes: number; freelistCount: number }
interface BtreeFacts { pages: number; bytes: number; payloadBytes: number; unusedBytes: number; cells: number; overflowPages: number }
interface TableLogical { rows: number; valueBytes: number; maxRowValueBytes: number; columns: Record<string, number> }
interface Snapshot {
  userVersion: number
  pages: PageFacts
  logical: Record<(typeof TABLES)[number], TableLogical>
  btrees: Record<string, BtreeFacts>
  dbstatError?: string
}
interface Measurements {
  fresh: { before: Snapshot; after: Snapshot; categories: Record<string, number>; eventBytes: Record<string, number>; coldSteps: number }
  historical: { v3: Snapshot; v4: Snapshot; absentFields: string[] }
  network: { blobBytes: number; bodyBytes: { request: number; response: number }; stepEvidenceBytes: number; bodyInDatabase: boolean; secretInBlob: boolean; secretInDatabase: boolean }
  dbstatError?: string
}

let dir: string
let measured: Measurements

const utf8 = (value: string): number => Buffer.byteLength(value, 'utf8')

function one(db: DatabaseSync, sql: string): number {
  return Number(Object.values(db.prepare(sql).get() as Record<string, unknown>)[0] ?? 0)
}

// Read-only, aggregate-only queries after the writer has closed, following 423-budget-probe.mjs.
function snapshot(path: string): Snapshot {
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    const pageSize = one(db, 'PRAGMA page_size')
    const pageCount = one(db, 'PRAGMA page_count')
    const logical = Object.fromEntries(TABLES.map(table => {
      const columns = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(column => column.name)
      // SQLite value bytes: TEXT as its UTF-8 bytes, integers as their decimal text (as the probe).
      const expr = (name: string) => `COALESCE(length(CAST("${name}" AS BLOB)),0)`
      const rows = (db.prepare(`SELECT ${columns.map(expr).join('+')} AS n FROM ${table}`).all() as { n: number }[]).map(row => Number(row.n))
      return [table, {
        rows: rows.length,
        valueBytes: rows.reduce((sum, value) => sum + value, 0),
        maxRowValueBytes: Math.max(0, ...rows),
        columns: Object.fromEntries(columns.map(name => [name, one(db, `SELECT COALESCE(sum(${expr(name)}),0) FROM ${table}`)])),
      }]
    })) as Snapshot['logical']
    const names = (db.prepare(
      `SELECT name FROM sqlite_master WHERE tbl_name IN (${TABLES.map(() => '?').join(',')}) AND type IN ('table','index') ORDER BY name`,
    ).all(...TABLES) as { name: string }[]).map(row => row.name)
    const btrees: Record<string, BtreeFacts> = {}
    let dbstatError: string | undefined
    try {
      for (const name of names) {
        const row = db.prepare(`SELECT count(*) AS pages, COALESCE(sum(pgsize),0) AS bytes, COALESCE(sum(payload),0) AS payloadBytes,
          COALESCE(sum(unused),0) AS unusedBytes, COALESCE(sum(ncell),0) AS cells,
          COALESCE(sum(pagetype = 'overflow'),0) AS overflowPages FROM dbstat WHERE name = ?`).get(name) as Record<string, number>
        btrees[name] = { pages: Number(row.pages), bytes: Number(row.bytes), payloadBytes: Number(row.payloadBytes),
          unusedBytes: Number(row.unusedBytes), cells: Number(row.cells), overflowPages: Number(row.overflowPages) }
      }
    } catch (error) {
      dbstatError = error instanceof Error ? error.message : String(error)
    }
    return {
      userVersion: one(db, 'PRAGMA user_version'),
      pages: { pageSize, pageCount, bytes: pageSize * pageCount, freelistCount: one(db, 'PRAGMA freelist_count') },
      logical, btrees, ...(dbstatError === undefined ? {} : { dbstatError }),
    }
  } finally { db.close() }
}

function networkBody(side: 'request' | 'response'): string {
  const head = `{"side":"${side}","token":"${SECRET}","filler":"`
  const tail = '"}'
  const room = NETWORK_BODY_MAX_BYTES - utf8(head) - utf8(tail)
  return head + FILLER.repeat(Math.ceil(room / FILLER.length)).slice(0, room) + tail
}

type Evidence = NonNullable<StepFinalizedPayload['evidence']>
const verdict = { pass: true, reasoning: 'synthetic verifier verdict' }

async function freshFixture(root: string) {
  const path = join(root, 'fresh-v4.db')
  new DashboardDatabase({ dbPath: path }).close()
  const before = snapshot(path)
  const masking = buildRunMaskingContext({ env: {} })
  masking.register(SECRET)
  const mask = (text: string) => masking.mask(text)
  const store = new FsEvidenceArtifactStore({ root: join(root, 'blobs'), runId: RUN_ID })
  const persist = (document: Exclude<EvidenceDocument, { kind: 'variables' }>) =>
    EvidenceArtifactRefSchema.parse(store.persistEvidenceDocument(document))
  const bodies = { request: networkBody('request'), response: networkBody('response') }
  const absent: Evidence = {
    console: { kind: 'console', state: 'absent', reason: 'not-captured' },
    network: { kind: 'network', state: 'absent', reason: 'not-captured' },
    a11y: { kind: 'a11y', state: 'absent', reason: 'unsupported' },
    variables: { kind: 'variables', state: 'absent', reason: 'empty' },
  }
  const consoleRef = persist({ schemaVersion: 1, kind: 'console', records: Array.from({ length: 20 }, (_, index) => ({
    level: index % 5 === 0 ? 'error' : 'log', text: mask(`synthetic console line ${index} ${SECRET}`), timestamp: index,
  })) })
  const a11yRef = persist({ schemaVersion: 1, kind: 'a11y', records: [{ ruleId: 'synthetic-rule', impact: 'serious',
    description: 'Synthetic description', help: 'Synthetic help', helpUrl: 'https://example.invalid/rule',
    nodes: [{ html: '<button>Synthetic</button>', target: ['button'] }] }] })
  const smallNetworkRef = persist({ schemaVersion: 1, kind: 'network', records: [{ url: 'https://example.invalid/api',
    method: 'GET', status: 200, requestHeaders: {}, responseHeaders: { 'content-type': 'application/json' }, startTime: 1, endTime: 2 }] })
  const maskedBodies = { request: mask(bodies.request), response: mask(bodies.response) }
  const networkRef = persist({ schemaVersion: 1, kind: 'network', records: [{ url: 'https://example.invalid/api/large',
    method: 'POST', status: 200, requestHeaders: { 'content-type': 'application/json', authorization: mask(SECRET) },
    responseHeaders: { 'content-type': 'application/json' }, requestBody: maskedBodies.request, body: maskedBodies.response,
    startTime: 1, endTime: 2, requestSize: utf8(bodies.request), responseSize: utf8(bodies.response) }] })
  const largeVariables = Object.fromEntries(Array.from({ length: 1000 }, (_, index) => [
    mask(`variable-${index}`), { value: mask(index === 999 ? 'é'.repeat(40000) : index === 0 ? SECRET : 'v'.repeat(64)), source: 'inline' as const },
  ]))
  const usageRoles = {
    planner: { declared: { provider: 'openai-compatible', modelId: 'synthetic-planner' }, respondingModelIds: ['synthetic-planner'] as [string] },
    verifier: { declared: { provider: 'openai-compatible', modelId: 'synthetic-verifier' }, respondingModelIds: ['synthetic-verifier'] as [string] },
  }
  const plan: { category: string; step: Pick<StepFinalizedPayload, 'evidence' | 'variableSnapshot' | 'tokenUsage' | 'modelUsage'>; children: number }[] = [
    { category: 'absent-only', step: { evidence: absent }, children: 1 },
    { category: 'usage-reported-zero', children: 1, step: { evidence: absent,
      tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, cachedInputTokens: 0 },
      modelUsage: { roles: { planner: usageRoles.planner }, calls: { started: 1, succeeded: 1, failed: 0 },
        inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 } } },
    { category: 'usage-present', children: 2, step: { evidence: absent,
      tokenUsage: { promptTokens: 500, completionTokens: 35, totalTokens: 535, cachedInputTokens: 150 },
      modelUsage: { roles: usageRoles, calls: { started: 6, succeeded: 5, failed: 1 } } } },
    { category: 'evidence-present', children: 3, step: {
      evidence: {
        console: { kind: 'console', state: 'present', ref: consoleRef, counts: { total: 20, errors: 4, warnings: 0 } },
        network: { kind: 'network', state: 'present', ref: smallNetworkRef, counts: { total: 1, failed: 0, errored: 0 } },
        a11y: { kind: 'a11y', state: 'present', ref: a11yRef, counts: { minor: 0, moderate: 0, serious: 1, critical: 0 } },
        variables: { kind: 'variables', state: 'present', counts: { count: 3 } },
      },
      variableSnapshot: { BASE_URL: { value: 'https://example.invalid', source: 'env' },
        [mask(`token-${SECRET}`)]: { value: mask(SECRET), source: 'capture' }, user: { value: 'synthetic-user', source: 'suite' } } } },
    { category: 'variables-large', children: 1, step: { evidence: { ...absent,
      variables: { kind: 'variables', state: 'present', counts: { count: 1000 } } }, variableSnapshot: largeVariables } },
    { category: 'network-32kib', children: 1, step: { evidence: { ...absent,
      network: { kind: 'network', state: 'present', ref: networkRef, counts: { total: 1, failed: 0, errored: 0 } } } } },
  ]
  const eventBytes: Record<string, number> = {}
  const db = new DashboardDatabase({ dbPath: path })
  try {
    const ingest = createDashboardRunIngest({ db, correlationEnv: { runId: RUN_ID } })
    let seq = 0
    const emit = (type: RunEventEnvelope['type'], payload: unknown) => ingest.handler({
      runId: RUN_ID, type, payload, seq: ++seq, ts: 1_700_000_000_000 + seq,
    } as RunEventEnvelope)
    emit('runStarted', {})
    emit('testStarted', { testIndex: 0, testId: 'synthetic-test', name: 'Synthetic row budget' })
    for (const [stepIndex, { category, step, children }] of plan.entries()) {
      emit('stepStarted', { testIndex: 0, stepIndex, stepText: `Synthetic ${category} step` })
      for (let subActionIndex = 0; subActionIndex < children; subActionIndex++) {
        const ariaRef = persist({ schemaVersion: 1, kind: 'aria', tree: mask(
          `- main:\n  - button "Synthetic ${category} ${subActionIndex}" [ref=e${subActionIndex}]\n  - text "${SECRET}"`) })
        const screenshot = { id: `decision-screenshot:${String(stepIndex + 1).repeat(64)}`, sha: String(stepIndex + 1).repeat(64) }
        const child: SubActionRecordedPayload = { testIndex: 0, stepIndex, subActionIndex, plan: `Synthetic plan ${subActionIndex}`,
          plannedAction: { type: 'navigate', to: 'url', url: 'https://example.invalid' }, result: { success: true },
          screenStateHash: `synthetic-before-${stepIndex}-${subActionIndex}`, screenStateHashAfter: `synthetic-after-${stepIndex}-${subActionIndex}`,
          artifactRefs: [screenshot, ariaRef], ariaEvidence: { kind: 'aria', state: 'present', ref: ariaRef } }
        emit('subActionRecorded', child)
      }
      const payload: StepFinalizedPayload = { testIndex: 0, stepIndex, cacheStatus: 'miss', verifierVerdict: verdict,
        selfHealOccurred: false, briefDigest: `synthetic-digest-${stepIndex}`, status: 'passed', durationMs: 10, ...step }
      eventBytes[category] = utf8(JSON.stringify(payload))
      emit('stepFinalized', payload)
    }
    emit('testFinished', { testIndex: 0, outcome: 'passed' })
    emit('runFinished', { aggregateVerdict: 'passed' })
    await ingest.finalize({})
  } finally {
    db.close()
    masking.dispose()
  }
  const after = snapshot(path)
  const reader = new DatabaseSync(path, { readOnly: true })
  let categories: Record<string, number>
  let stepEvidenceBytes: number
  try {
    const columns = (reader.prepare('PRAGMA table_info(run_steps)').all() as { name: string }[]).map(column => column.name)
    const rows = reader.prepare(`SELECT step_index, ${columns.map(name => `COALESCE(length(CAST("${name}" AS BLOB)),0)`).join('+')} AS n
      FROM run_steps WHERE run_id = ? ORDER BY step_index`).all(RUN_ID) as { step_index: number; n: number }[]
    categories = Object.fromEntries(rows.map(row => [plan[row.step_index]!.category, Number(row.n)]))
    stepEvidenceBytes = one(reader, `SELECT length(CAST(evidence_json AS BLOB)) FROM run_steps
      WHERE run_id = '${RUN_ID}' AND step_index = ${plan.findIndex(item => item.category === 'network-32kib')}`)
  } finally { reader.close() }
  const cold = new DashboardDatabase({ dbPath: path })
  let coldSteps: number
  try {
    const rows = cold.readRunDetailRows(RUN_ID)!
    coldSteps = rows.steps.length
    const network = rows.steps.find(row => row.stepIndex === plan.length - 1)
    expect(network?.evidence?.network).toEqual({ kind: 'network', state: 'present', ref: networkRef, counts: { total: 1, failed: 0, errored: 0 } })
    expect(rows.steps.find(row => row.stepIndex === 4)?.variableSnapshot).toEqual(largeVariables)
  } finally { cold.close() }

  const blob = Buffer.from(store.getBlob(networkRef.sha)!)
  const databaseBytes = Buffer.concat(readdirSync(root).filter(name => name.startsWith('fresh-v4.db'))
    .map(name => readFileSync(join(root, name))))
  const bodyMarker = FILLER.repeat(8)
  return {
    fresh: { before, after, categories, eventBytes, coldSteps },
    network: {
      blobBytes: blob.byteLength,
      bodyBytes: { request: utf8(bodies.request), response: utf8(bodies.response) },
      stepEvidenceBytes,
      bodyInDatabase: databaseBytes.includes(bodyMarker),
      secretInBlob: blob.includes(SECRET) || !blob.includes(bodyMarker),
      secretInDatabase: databaseBytes.includes(SECRET),
    },
  }
}

// Frozen pre-423 v2 DDL for the two measured tables plus their parent, the same text as
// 423-read-migration.test.ts. Never derived from current MIGRATIONS.
const V2_SQL = [
  "CREATE TABLE IF NOT EXISTS runs (\n        id TEXT PRIMARY KEY,\n        name TEXT NOT NULL,\n        file_path TEXT,\n        status TEXT NOT NULL CHECK(status IN ('passed','failed','skipped','running','cancelled','pending','flaky')),\n        priority INTEGER NOT NULL DEFAULT 0,\n        duration INTEGER NOT NULL DEFAULT 0,\n        attributes TEXT NOT NULL DEFAULT '{}',\n        environment TEXT,\n        metadata TEXT,\n        started_at TEXT,\n        ended_at TEXT,\n        created_at TEXT DEFAULT CURRENT_TIMESTAMP,\n        failure_summary TEXT,\n        platform TEXT DEFAULT 'web',\n        test_file_content TEXT,\n        model_name TEXT,\n        llm_provider TEXT,\n        parallel INTEGER DEFAULT 0,\n        error_log TEXT,\n        memory_log TEXT,\n        test_id TEXT,\n        suite_id TEXT\n      )",
  "CREATE TABLE IF NOT EXISTS execution_logs (\n        id TEXT PRIMARY KEY,\n        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,\n        step_id TEXT,\n        type TEXT NOT NULL CHECK(type IN ('hook', 'appium-script', 'runjs')),\n        name TEXT NOT NULL,\n        phase TEXT NOT NULL CHECK(phase IN ('setup', 'teardown', 'inline')),\n        status TEXT NOT NULL CHECK(status IN ('passed', 'failed')),\n        duration INTEGER NOT NULL DEFAULT 0,\n        stdout TEXT,\n        stderr TEXT,\n        return_data TEXT,\n        variables TEXT,\n        created_at TEXT DEFAULT CURRENT_TIMESTAMP,\n        hook_id TEXT,\n        test_index INTEGER,\n        step_index INTEGER\n      )",
  "CREATE TABLE IF NOT EXISTS token_events (\n        id TEXT PRIMARY KEY,\n        model_name TEXT NOT NULL,\n        prompt_tokens INTEGER NOT NULL DEFAULT 0,\n        completion_tokens INTEGER NOT NULL DEFAULT 0,\n        source TEXT NOT NULL CHECK(source IN ('test-run', 'live-editor')),\n        created_at TEXT DEFAULT CURRENT_TIMESTAMP\n      )",
  "CREATE TABLE IF NOT EXISTS run_artifacts (\n        run_id TEXT PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,\n        kind TEXT NOT NULL CHECK(kind IN ('test', 'unknown')),\n        schema_version INTEGER NOT NULL,\n        payload TEXT NOT NULL DEFAULT '{}',\n        finalized_at TEXT,\n        created_at TEXT DEFAULT CURRENT_TIMESTAMP,\n        updated_at TEXT DEFAULT CURRENT_TIMESTAMP\n      )",
  "CREATE TABLE IF NOT EXISTS run_members (\n        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,\n        test_index INTEGER NOT NULL,\n        test_id TEXT,\n        name TEXT,\n        file_path TEXT,\n        suite_id TEXT,\n        suite_name TEXT,\n        suite_index INTEGER,\n        total_steps INTEGER,\n        outcome TEXT,\n        duration_ms INTEGER,\n        failure_summary TEXT,\n        retry_count INTEGER,\n        attempts INTEGER NOT NULL DEFAULT 1,\n        PRIMARY KEY (run_id, test_index)\n      )",
  "CREATE TABLE IF NOT EXISTS run_steps (\n        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,\n        test_index INTEGER NOT NULL,\n        step_index INTEGER NOT NULL,\n        step_text TEXT,\n        cache_status TEXT NOT NULL,\n        verifier_verdict TEXT NOT NULL,\n        self_heal_occurred INTEGER NOT NULL,\n        brief_digest TEXT NOT NULL,\n        status TEXT,\n        duration_ms INTEGER,\n        error TEXT,\n        prompt_tokens INTEGER,\n        completion_tokens INTEGER,\n        total_tokens INTEGER,\n        PRIMARY KEY (run_id, test_index, step_index)\n      )",
  "CREATE TABLE IF NOT EXISTS run_sub_actions (\n        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,\n        test_index INTEGER NOT NULL,\n        step_index INTEGER NOT NULL,\n        sub_action_index INTEGER NOT NULL,\n        plan TEXT NOT NULL,\n        planned_action TEXT NOT NULL,\n        grounding TEXT,\n        result TEXT NOT NULL,\n        screen_state_hash TEXT NOT NULL,\n        screen_state_hash_after TEXT,\n        artifact_refs TEXT,\n        PRIMARY KEY (run_id, test_index, step_index, sub_action_index)\n      )",
  "CREATE INDEX IF NOT EXISTS idx_run_members_run ON run_members(run_id)",
  "CREATE INDEX IF NOT EXISTS idx_run_steps_run ON run_steps(run_id, test_index)",
  "CREATE INDEX IF NOT EXISTS idx_run_sub_actions_run ON run_sub_actions(run_id, test_index, step_index)",
  "CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status)",
  "CREATE INDEX IF NOT EXISTS idx_runs_started_at ON runs(started_at)",
  "CREATE INDEX IF NOT EXISTS idx_runs_name ON runs(name)",
  "CREATE INDEX IF NOT EXISTS idx_runs_queue ON runs(status, priority, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_execution_logs_run_id ON execution_logs(run_id)",
  "CREATE INDEX IF NOT EXISTS idx_execution_logs_step_id ON execution_logs(step_id)",
  "CREATE INDEX IF NOT EXISTS idx_execution_logs_type ON execution_logs(type)",
  "CREATE INDEX IF NOT EXISTS idx_token_events_model ON token_events(model_name)",
  "CREATE INDEX IF NOT EXISTS idx_token_events_source ON token_events(source)",
  "CREATE INDEX IF NOT EXISTS idx_token_events_created ON token_events(created_at)",
  "CREATE INDEX IF NOT EXISTS idx_run_artifacts_kind ON run_artifacts(kind)",
  "CREATE INDEX IF NOT EXISTS idx_run_artifacts_finalized ON run_artifacts(finalized_at)",
]

function historicalFixture(root: string) {
  const path = join(root, 'historical-v2.db')
  const raw = createDashboardSqliteDatabase(path)
  try {
    for (const sql of V2_SQL) raw.exec(sql)
    raw.exec(`INSERT INTO runs (id,name,status) VALUES ('historical','Synthetic historical run','passed')`)
    const step = raw.prepare(`INSERT INTO run_steps (run_id,test_index,step_index,step_text,cache_status,verifier_verdict,
      self_heal_occurred,brief_digest,status,duration_ms,prompt_tokens,completion_tokens,total_tokens)
      VALUES ('historical',0,?,?,'miss','{"pass":true,"reasoning":"synthetic historical"}',0,?,'passed',10,?,?,?)`)
    const child = raw.prepare(`INSERT INTO run_sub_actions (run_id,test_index,step_index,sub_action_index,plan,planned_action,
      result,screen_state_hash,artifact_refs) VALUES ('historical',0,?,0,'synthetic plan',
      '{"type":"navigate","to":"url","url":"https://example.invalid"}','{"success":true}',?,'[]')`)
    for (let index = 0; index < 50; index++) {
      step.run(index, `Synthetic historical step ${index}`, `synthetic-digest-${index}`, 100 + index, 7, 107 + index)
      child.run(index, `synthetic-hash-${index}`)
    }
    raw.exec('PRAGMA user_version = 2')
  } finally { raw.close() }
  const refused = snapshot(path)
  const history = () => {
    const reader = new DatabaseSync(path, { readOnly: true })
    try {
      const schema = reader.prepare('SELECT * FROM sqlite_master ORDER BY name').all()
      const data = ['runs', 'run_members', 'run_steps', 'run_sub_actions', 'execution_logs', 'token_events', 'run_artifacts']
        .map(table => reader.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all())
      return { schema, data }
    } finally { reader.close() }
  }
  const before = history()
  expect(() => new DashboardDatabase({ dbPath: path })).toThrow('user_version 2')
  expect(snapshot(path)).toEqual(refused)
  expect(history()).toEqual(before)
  const historical = createDashboardSqliteDatabase(path)
  try {
    historical.exec('ALTER TABLE run_steps ADD COLUMN evidence_json TEXT')
    historical.exec('ALTER TABLE run_steps ADD COLUMN variable_snapshot_json TEXT')
    historical.exec('ALTER TABLE run_steps ADD COLUMN model_usage_json TEXT')
    historical.exec('ALTER TABLE run_sub_actions ADD COLUMN evidence_state_json TEXT')
    historical.exec('PRAGMA user_version = 3')
  } finally { historical.close() }
  const v3 = snapshot(path)
  const db = new DashboardDatabase({ dbPath: path })
  const absentFields: string[] = []
  try {
    const rows = db.readRunDetailRows('historical')!
    expect(rows.steps).toHaveLength(50)
    if (rows.steps.every(row => !('evidence' in row))) absentFields.push('evidence')
    if (rows.steps.every(row => !('variableSnapshot' in row))) absentFields.push('variableSnapshot')
    if (rows.steps.every(row => !('modelUsage' in row))) absentFields.push('modelUsage')
    if (rows.subActions.every(row => !('ariaEvidence' in row))) absentFields.push('ariaEvidence')
  } finally { db.close() }
  return { v3, v4: snapshot(path), absentFields }
}

async function measureFixtures(root: string): Promise<Measurements> {
  const { fresh, network } = await freshFixture(root)
  const historical = historicalFixture(root)
  const dbstatError = [fresh.before, fresh.after, historical.v3, historical.v4].find(item => item.dbstatError)?.dbstatError
  return { fresh, historical, network, ...(dbstatError === undefined ? {} : { dbstatError }) }
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'agent-qa-423-row-budget-'))
  measured = await measureFixtures(dir)
})
afterAll(() => { rmSync(dir, { recursive: true, force: true }) })

function report(cell: string, value: unknown): void {
  console.info(cell, JSON.stringify({ label: LABEL, ...value as object }))
}

it('ROW-BUDGET-LOGICAL: finalized v4 rows report UTF-8 logical value bytes per table, column and category', () => {
  const { before, after, categories, eventBytes, coldSteps } = measured.fresh
  report('ROW-BUDGET-LOGICAL', { categories, eventBytes, coldSteps, before: before.logical, after: after.logical,
    historicalV3: measured.historical.v3.logical, historicalV4: measured.historical.v4.logical })
  expect(after.userVersion).toBe(4)
  expect(coldSteps).toBe(6)
  for (const table of TABLES) {
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
    expect(measured.historical.v4.logical.run_steps.columns[column]).toBe(0)
  }
})

it('ROW-BUDGET-PAGES: PRAGMA page_size and page_count before and after insertion, fresh v4 and populated v3-to-v4 with v2 refused', () => {
  const { fresh, historical } = measured
  report('ROW-BUDGET-PAGES', {
    fresh: { before: fresh.before.pages, after: fresh.after.pages,
      deltaPages: fresh.after.pages.pageCount - fresh.before.pages.pageCount,
      deltaBytes: fresh.after.pages.bytes - fresh.before.pages.bytes },
    historical: { v3: historical.v3.pages, v4: historical.v4.pages,
      deltaPages: historical.v4.pages.pageCount - historical.v3.pages.pageCount },
  })
  expect(fresh.before.pages.pageSize).toBeGreaterThan(0)
  expect(fresh.after.pages.pageSize).toBe(fresh.before.pages.pageSize)
  expect(fresh.after.pages.pageCount).toBeGreaterThan(fresh.before.pages.pageCount)
  expect(fresh.after.pages.bytes).toBe(fresh.after.pages.pageSize * fresh.after.pages.pageCount)
  expect(historical.v3.userVersion).toBe(3)
  expect(historical.v4.userVersion).toBe(4)
  expect(historical.v3.pages.pageCount).toBeGreaterThan(0)
  expect(historical.absentFields).toEqual(['evidence', 'variableSnapshot', 'modelUsage', 'ariaEvidence'])
})

it('ROW-BUDGET-PAYLOAD: dbstat page, payload and unused bytes for run_steps and run_sub_actions', () => {
  if (measured.dbstatError !== undefined) {
    throw new Error(`ROW-BUDGET-PAYLOAD BLOCKED: dbstat unavailable in this SQLite build: ${measured.dbstatError}`)
  }
  const { fresh, historical } = measured
  report('ROW-BUDGET-PAYLOAD', { fresh: { before: fresh.before.btrees, after: fresh.after.btrees },
    historical: { v3: historical.v3.btrees, v4: historical.v4.btrees } })
  for (const table of TABLES) {
    const after = fresh.after.btrees[table]!
    expect(after.pages).toBeGreaterThan(0)
    expect(after.payloadBytes).toBeGreaterThan(0)
    expect(after.bytes).toBe(after.pages * fresh.after.pages.pageSize)
    expect(after.unusedBytes).toBeGreaterThanOrEqual(0)
    expect(after.payloadBytes).toBeGreaterThan(fresh.before.btrees[table]!.payloadBytes)
    expect(historical.v4.btrees[table]!.payloadBytes).toBe(historical.v3.btrees[table]!.payloadBytes)
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
