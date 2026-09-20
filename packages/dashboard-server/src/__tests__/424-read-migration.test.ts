import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { runSqliteMigrations } from '../db/database.js'
import { createDashboardSqliteDatabase, type DashboardSqliteDatabase } from '../db/sqlite.js'
import { MIGRATIONS, SCHEMA_VERSION } from '../db/schema.js'

// Frozen v3 DDL, copied before the v4 change.
const V3_SQL = [

      `CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        file_path TEXT,
        status TEXT NOT NULL CHECK(status IN ('passed','failed','skipped','running','cancelled','pending','flaky')),
        priority INTEGER NOT NULL DEFAULT 0,
        duration INTEGER NOT NULL DEFAULT 0,
        attributes TEXT NOT NULL DEFAULT '{}',
        environment TEXT,
        metadata TEXT,
        started_at TEXT,
        ended_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        failure_summary TEXT,
        platform TEXT DEFAULT 'web',
        test_file_content TEXT,
        model_name TEXT,
        llm_provider TEXT,
        parallel INTEGER DEFAULT 0,
        error_log TEXT,
        memory_log TEXT,
        test_id TEXT,
        suite_id TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS execution_logs (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        step_id TEXT,
        type TEXT NOT NULL CHECK(type IN ('hook', 'appium-script', 'runjs')),
        name TEXT NOT NULL,
        phase TEXT NOT NULL CHECK(phase IN ('setup', 'teardown', 'inline')),
        status TEXT NOT NULL CHECK(status IN ('passed', 'failed')),
        duration INTEGER NOT NULL DEFAULT 0,
        stdout TEXT,
        stderr TEXT,
        return_data TEXT,
        variables TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        hook_id TEXT,
        test_index INTEGER,
        step_index INTEGER
      )`,
      `CREATE TABLE IF NOT EXISTS token_events (
        id TEXT PRIMARY KEY,
        model_name TEXT NOT NULL,
        prompt_tokens INTEGER NOT NULL DEFAULT 0,
        completion_tokens INTEGER NOT NULL DEFAULT 0,
        source TEXT NOT NULL CHECK(source IN ('test-run', 'live-editor')),
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS run_artifacts (
        run_id TEXT PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK(kind IN ('test', 'unknown')),
        schema_version INTEGER NOT NULL,
        payload TEXT NOT NULL DEFAULT '{}',
        finalized_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS run_members (
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        test_index INTEGER NOT NULL,
        test_id TEXT,
        name TEXT,
        file_path TEXT,
        suite_id TEXT,
        suite_name TEXT,
        suite_index INTEGER,
        total_steps INTEGER,
        outcome TEXT,
        duration_ms INTEGER,
        failure_summary TEXT,
        retry_count INTEGER,
        attempts INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (run_id, test_index)
      )`,
      `CREATE TABLE IF NOT EXISTS run_steps (
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        test_index INTEGER NOT NULL,
        step_index INTEGER NOT NULL,
        step_text TEXT,
        cache_status TEXT NOT NULL,
        verifier_verdict TEXT NOT NULL,
        self_heal_occurred INTEGER NOT NULL,
        brief_digest TEXT NOT NULL,
        status TEXT,
        duration_ms INTEGER,
        error TEXT,
        prompt_tokens INTEGER,
        completion_tokens INTEGER,
        total_tokens INTEGER,
        evidence_json TEXT,
        variable_snapshot_json TEXT,
        model_usage_json TEXT,
        PRIMARY KEY (run_id, test_index, step_index)
      )`,
      `CREATE TABLE IF NOT EXISTS run_sub_actions (
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        test_index INTEGER NOT NULL,
        step_index INTEGER NOT NULL,
        sub_action_index INTEGER NOT NULL,
        plan TEXT NOT NULL,
        planned_action TEXT NOT NULL,
        grounding TEXT,
        result TEXT NOT NULL,
        screen_state_hash TEXT NOT NULL,
        screen_state_hash_after TEXT,
        artifact_refs TEXT,
        evidence_state_json TEXT,
        PRIMARY KEY (run_id, test_index, step_index, sub_action_index)
      )`,
      'CREATE INDEX IF NOT EXISTS idx_run_members_run ON run_members(run_id)',
      'CREATE INDEX IF NOT EXISTS idx_run_steps_run ON run_steps(run_id, test_index)',
      'CREATE INDEX IF NOT EXISTS idx_run_sub_actions_run ON run_sub_actions(run_id, test_index, step_index)',
      'CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status)',
      'CREATE INDEX IF NOT EXISTS idx_runs_started_at ON runs(started_at)',
      'CREATE INDEX IF NOT EXISTS idx_runs_name ON runs(name)',
      'CREATE INDEX IF NOT EXISTS idx_runs_queue ON runs(status, priority, created_at)',
      'CREATE INDEX IF NOT EXISTS idx_execution_logs_run_id ON execution_logs(run_id)',
      'CREATE INDEX IF NOT EXISTS idx_execution_logs_step_id ON execution_logs(step_id)',
      'CREATE INDEX IF NOT EXISTS idx_execution_logs_type ON execution_logs(type)',
      'CREATE INDEX IF NOT EXISTS idx_token_events_model ON token_events(model_name)',
      'CREATE INDEX IF NOT EXISTS idx_token_events_source ON token_events(source)',
      'CREATE INDEX IF NOT EXISTS idx_token_events_created ON token_events(created_at)',
      'CREATE INDEX IF NOT EXISTS idx_run_artifacts_kind ON run_artifacts(kind)',
      'CREATE INDEX IF NOT EXISTS idx_run_artifacts_finalized ON run_artifacts(finalized_at)',

]

function open(name: string): DashboardSqliteDatabase {
  const db = createDashboardSqliteDatabase(join(dir, name))
  opened.push(db)
  return db
}
function seedV3(db: DashboardSqliteDatabase): void {
  for (const sql of V3_SQL) db.exec(sql)
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
    PRAGMA user_version = 3;
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

let dir: string
const opened: DashboardSqliteDatabase[] = []
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'agent-qa-424-migration-')) })
afterEach(() => {
  vi.restoreAllMocks()
  for (const db of opened.splice(0)) db.close()
  rmSync(dir, { recursive: true, force: true })
})

function nullableColumns(db: DashboardSqliteDatabase): void {
  for (const [table, name, type] of [
    ['run_members', 'recording_json', 'TEXT'],
    ['run_sub_actions', 'recording_offset_ms', 'REAL'],
  ] as const) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
    expect(columns.find(column => column.name === name)).toMatchObject({
      name, type, notnull: 0, dflt_value: null,
    })
  }
}

it('MIGRATION-FRESH: creates v4 directly on an empty SQLite file', () => {
  const db = open('fresh.db')
  runSqliteMigrations(db, MIGRATIONS, SCHEMA_VERSION)
  expect(db.pragma('user_version', { simple: true })).toBe(4)
  nullableColumns(db)
  expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
})

it('MIGRATION-COLUMNS-NULLABLE: both recording columns have no defaults or constraints', () => {
  const db = open('nullable.db')
  runSqliteMigrations(db, MIGRATIONS, SCHEMA_VERSION)
  nullableColumns(db)
})

it('MIGRATION-V3-HISTORY: keeps every prior row and NULL with fresh schema and index parity', () => {
  const db = open('history.db')
  seedV3(db)
  const before = data(db)
  const transaction = vi.spyOn(db, 'transaction')
  runSqliteMigrations(db, MIGRATIONS, SCHEMA_VERSION)
  expect(db.pragma('user_version', { simple: true })).toBe(4)
  expect(transaction).toHaveBeenCalledWith(expect.any(Function), { immediate: true })
  nullableColumns(db)
  const after = data(db)
  for (const table of tables) {
    const additions = table === 'run_members' ? { recording_json: null }
      : table === 'run_sub_actions' ? { recording_offset_ms: null } : {}
    expect(after[table]).toEqual(before[table]!.map(row => ({ ...row as object, ...additions })))
  }
  const fresh = open('compare.db')
  runSqliteMigrations(fresh, MIGRATIONS, SCHEMA_VERSION)
  expect(schema(db)).toEqual(schema(fresh))
  expect(db.prepare("SELECT name, sql FROM sqlite_master WHERE type='index' ORDER BY name").all())
    .toEqual(fresh.prepare("SELECT name, sql FROM sqlite_master WHERE type='index' ORDER BY name").all())
  expect(db.pragma('foreign_key_check')).toEqual([])
})

it('MIGRATION-REOPEN: a published v4 file reopens without DDL or data changes', () => {
  const db = open('reopen.db')
  seedV3(db)
  db.exec('ALTER TABLE run_members ADD COLUMN recording_json TEXT')
  db.exec('ALTER TABLE run_sub_actions ADD COLUMN recording_offset_ms REAL')
  db.exec('PRAGMA user_version = 4')
  const before = { data: data(db), schema: schema(db) }
  db.close()
  const reopened = open('reopen.db')
  const exec = vi.spyOn(reopened, 'exec')
  expect(() => runSqliteMigrations(reopened, MIGRATIONS, SCHEMA_VERSION)).not.toThrow()
  expect(exec).not.toHaveBeenCalled()
  expect({ data: data(reopened), schema: schema(reopened) }).toEqual(before)
})

for (const [name, version] of [
  ['V1-REFUSE', 1], ['FUTURE-REFUSE', 5], ['FUTURE-REFUSE', 17], ['V2-DISPOSITION', 2],
] as const) {
  it(`MIGRATION-${name}: names unsupported version ${version} without changing schema or data`, () => {
    const db = open(`refuse-${version}.db`)
    seedV3(db)
    if (version === 2) {
      for (const column of ['evidence_json', 'variable_snapshot_json', 'model_usage_json']) {
        db.exec(`ALTER TABLE run_steps DROP COLUMN ${column}`)
      }
      db.exec('ALTER TABLE run_sub_actions DROP COLUMN evidence_state_json')
    }
    db.exec(`PRAGMA user_version = ${version}`)
    const before = { data: data(db), schema: schema(db) }
    expect(() => runSqliteMigrations(db, MIGRATIONS, SCHEMA_VERSION)).toThrow(`user_version ${version}`)
    expect({ data: data(db), schema: schema(db) }).toEqual(before)
    expect(db.pragma('user_version', { simple: true })).toBe(version)
  })
}

it('MIGRATION-ROLLBACK: failure after the first real ALTER restores schema, version and data', () => {
  const db = open('rollback.db')
  seedV3(db)
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
  expect(() => runSqliteMigrations(db, MIGRATIONS, SCHEMA_VERSION)).toThrow('injected failure after ALTER')
  expect(altered).toBe(true)
  expect({ data: data(db), schema: schema(db) }).toEqual(before)
  expect(db.pragma('user_version', { simple: true })).toBe(3)
  expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
  db.close()
  const reopened = open('rollback.db')
  expect({ data: data(reopened), schema: schema(reopened) }).toEqual(before)
  expect(reopened.pragma('user_version', { simple: true })).toBe(3)
})

it('MIGRATION-RACE-IDEMPOTENT: a second opener re-reads v4 under the lock and adds nothing', () => {
  const first = open('race.db')
  seedV3(first)
  const second = open('race.db')
  const pragma = second.pragma.bind(second)
  let staleReads = 0
  vi.spyOn(second, 'pragma').mockImplementation((sql, options) => {
    if (sql === 'user_version' && staleReads === 0) {
      staleReads += 1
      const observed = pragma(sql, options)
      runSqliteMigrations(first, MIGRATIONS, SCHEMA_VERSION)
      expect(observed).toBe(3)
      return observed
    }
    return pragma(sql, options)
  })
  const exec = vi.spyOn(second, 'exec')
  expect(() => runSqliteMigrations(second, MIGRATIONS, SCHEMA_VERSION)).not.toThrow()
  expect(staleReads).toBe(1)
  expect(pragma('user_version', { simple: true })).toBe(4)
  expect(exec).not.toHaveBeenCalled()
  expect(data(second)).toEqual(data(first))
  nullableColumns(second)
})
