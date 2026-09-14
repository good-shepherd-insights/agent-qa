import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DashboardDatabase, runSqliteMigrations } from '../db/database.js'
import { createDashboardSqliteDatabase, type DashboardSqliteDatabase } from '../db/sqlite.js'
import { MIGRATIONS, SCHEMA_VERSION } from '../db/schema.js'

// Frozen pre-423 v2 DDL, copied before the v3 change. Never derived from current MIGRATIONS.
const V2_SQL: string[] = [
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
  "CREATE INDEX IF NOT EXISTS idx_run_artifacts_finalized ON run_artifacts(finalized_at)"
]

let dir: string
const opened: DashboardSqliteDatabase[] = []
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'agent-qa-423-migration-')) })
afterEach(() => {
  vi.restoreAllMocks()
  for (const db of opened.splice(0)) db.close()
  rmSync(dir, { recursive: true, force: true })
})
function open(name: string): DashboardSqliteDatabase {
  const db = createDashboardSqliteDatabase(join(dir, name))
  opened.push(db)
  return db
}
function seedV2(db: DashboardSqliteDatabase): void {
  for (const sql of V2_SQL) db.exec(sql)
  db.exec(`
    INSERT INTO runs (id,name,status,metadata) VALUES ('old','Historical','passed','{"kept":true}');
    INSERT INTO runs (id,name,status) VALUES ('old-null','No optional facts','failed');
    INSERT INTO run_members (run_id,test_index,name,outcome) VALUES ('old',0,'member','passed');
    INSERT INTO run_steps (run_id,test_index,step_index,cache_status,verifier_verdict,self_heal_occurred,brief_digest,prompt_tokens,completion_tokens,total_tokens)
      VALUES ('old',0,0,'miss','{"pass":true,"reasoning":"kept"}',0,'digest',3,4,7);
    INSERT INTO run_steps (run_id,test_index,step_index,cache_status,verifier_verdict,self_heal_occurred,brief_digest)
      VALUES ('old-null',0,0,'hit','{"pass":false,"reasoning":""}',0,'');
    INSERT INTO run_sub_actions (run_id,test_index,step_index,sub_action_index,plan,planned_action,result,screen_state_hash,artifact_refs)
      VALUES ('old',0,0,0,'plan','{"type":"wait"}','{"success":true}','hash','[]');
    INSERT INTO execution_logs (id,run_id,type,name,phase,status,stdout) VALUES ('hook','old','hook','kept','setup','passed','output');
    INSERT INTO token_events (id,model_name,source,prompt_tokens) VALUES ('token','model','live-editor',9);
    INSERT INTO run_artifacts (run_id,kind,schema_version,payload) VALUES ('old','test',1,'{"kept":true}');
    PRAGMA user_version = 2;
    PRAGMA foreign_keys = ON;
  `)
}
const tables = ['runs', 'run_members', 'run_steps', 'run_sub_actions', 'execution_logs', 'token_events', 'run_artifacts']
function data(db: DashboardSqliteDatabase) {
  return Object.fromEntries(tables.map(table => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))
}
function schema(db: DashboardSqliteDatabase) {
  return Object.fromEntries(tables.map(table => [table, db.prepare(`PRAGMA table_info(${table})`).all()]))
}
function nullableColumns(db: DashboardSqliteDatabase): void {
  for (const [table, names] of [
    ['run_steps', ['evidence_json', 'variable_snapshot_json', 'model_usage_json']],
    ['run_sub_actions', ['evidence_state_json']],
  ] as const) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{name: string; type: string; notnull: number; dflt_value: unknown}>
    for (const name of names) expect(columns.find(column => column.name === name)).toMatchObject({ name, type: 'TEXT', notnull: 0, dflt_value: null })
  }
}
it('MIGRATION-FRESH: creates complete nullable v3 directly on a SQLite file', () => {
  const db = open('fresh.db')
  runSqliteMigrations(db, MIGRATIONS, SCHEMA_VERSION)
  expect(db.pragma('user_version', { simple: true })).toBe(3)
  nullableColumns(db)
  expect(MIGRATIONS[0]?.fromV2Sql).toEqual([
    'ALTER TABLE run_steps ADD COLUMN evidence_json TEXT',
    'ALTER TABLE run_steps ADD COLUMN variable_snapshot_json TEXT',
    'ALTER TABLE run_steps ADD COLUMN model_usage_json TEXT',
    'ALTER TABLE run_sub_actions ADD COLUMN evidence_state_json TEXT',
  ])
  expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
})
it('MIGRATION-V2-HISTORY: retains every prior value and NULL with exactly four added columns', () => {
  const db = open('history.db')
  seedV2(db)
  const before = data(db)
  const priorSchema = schema(db) as Record<string, Array<{name: string}>>
  expect(() => runSqliteMigrations(db, MIGRATIONS, 3)).not.toThrow()
  expect(db.pragma('user_version', { simple: true })).toBe(3)
  nullableColumns(db)
  const after = data(db)
  for (const table of tables) {
    const names = priorSchema[table]!.map(column => column.name)
    expect(after[table]!.map(row => Object.fromEntries(names.map(name => [name, (row as Record<string, unknown>)[name]])))).toEqual(before[table])
    const additions = table === 'run_steps'
      ? { evidence_json: null, variable_snapshot_json: null, model_usage_json: null }
      : table === 'run_sub_actions' ? { evidence_state_json: null } : {}
    expect(after[table]).toEqual(before[table]!.map(row => ({ ...row as object, ...additions })))
  }
  const fresh = open('compare.db')
  runSqliteMigrations(fresh, MIGRATIONS, 3)
  expect(schema(db)).toEqual(schema(fresh))
  expect(db.prepare("SELECT name FROM sqlite_master WHERE type='index' ORDER BY name").all())
    .toEqual(fresh.prepare("SELECT name FROM sqlite_master WHERE type='index' ORDER BY name").all())
  expect(db.pragma('foreign_key_check')).toEqual([])
})
it('MIGRATION-REOPEN: a published v3 file reopens without executing DDL', () => {
  const db = open('reopen.db')
  seedV2(db)
  db.exec('ALTER TABLE run_steps ADD COLUMN evidence_json TEXT')
  db.exec('ALTER TABLE run_steps ADD COLUMN variable_snapshot_json TEXT')
  db.exec('ALTER TABLE run_steps ADD COLUMN model_usage_json TEXT')
  db.exec('ALTER TABLE run_sub_actions ADD COLUMN evidence_state_json TEXT')
  db.exec('PRAGMA user_version = 3')
  const before = data(db)
  db.close()
  const reopened = open('reopen.db')
  const exec = vi.spyOn(reopened, 'exec')
  expect(() => runSqliteMigrations(reopened, MIGRATIONS, SCHEMA_VERSION)).not.toThrow()
  expect(exec).not.toHaveBeenCalled()
  expect(data(reopened)).toEqual(before)
  nullableColumns(reopened)
})
for (const [name, version] of [['V1', 1], ['FUTURE', 4], ['FUTURE', 17]] as const) {
  it(`MIGRATION-${name}-REFUSE: names unsupported version ${version} and leaves schema/data untouched`, () => {
    const db = open(`refuse-${version}.db`)
    seedV2(db)
    db.exec(`PRAGMA user_version = ${version}`)
    const before = { data: data(db), schema: schema(db) }
    expect(() => runSqliteMigrations(db, MIGRATIONS, SCHEMA_VERSION)).toThrow(`user_version ${version}`)
    expect({ data: data(db), schema: schema(db) }).toEqual(before)
    expect(db.pragma('user_version', { simple: true })).toBe(version)
  })
}
it('MIGRATION-ROLLBACK: failure after a real ALTER restores schema, version, data and foreign keys', () => {
  const db = open('rollback.db')
  seedV2(db)
  const before = { data: data(db), schema: schema(db) }
  const exec = db.exec.bind(db)
  let altered = false
  vi.spyOn(db, 'exec').mockImplementation(sql => {
    exec(sql)
    if (sql.startsWith('ALTER TABLE')) {
      altered = true
      expect(db.pragma('foreign_keys', { simple: true })).toBe(0)
      throw new Error('injected failure after ALTER')
    }
  })
  expect(() => runSqliteMigrations(db, MIGRATIONS, 3)).toThrow('injected failure after ALTER')
  expect(altered).toBe(true)
  expect({ data: data(db), schema: schema(db) }).toEqual(before)
  expect(db.pragma('user_version', { simple: true })).toBe(2)
  expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
  db.close()
  const reopened = open('rollback.db')
  expect({ data: data(reopened), schema: schema(reopened) }).toEqual(before)
  expect(reopened.pragma('user_version', { simple: true })).toBe(2)
})

it('MIGRATION-ROLLBACK: version stamp shares the same transaction as all four ALTERs', () => {
  const db = open('rollback-stamp.db')
  seedV2(db)
  const before = { data: data(db), schema: schema(db) }
  const pragma = db.pragma.bind(db)
  vi.spyOn(db, 'pragma').mockImplementation((sql, options) => {
    const value = pragma(sql, options)
    if (sql === 'user_version = 3') {
      nullableColumns(db)
      expect(pragma('user_version', { simple: true })).toBe(3)
      throw new Error('injected failure after version stamp')
    }
    return value
  })
  expect(() => runSqliteMigrations(db, MIGRATIONS, 3)).toThrow('injected failure after version stamp')
  expect({ data: data(db), schema: schema(db) }).toEqual(before)
  expect(db.pragma('user_version', { simple: true })).toBe(2)
  expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
})
