import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFunctionRegistry, invokeFunction, type FunctionDeps } from '@vostride/agent-qa-agent'
import { generateRunId } from '@vostride/agent-qa-ids'
import { asRunId, RunDetailProjectionSchema } from '@vostride/agent-qa-schema'
import { expect, it, vi } from 'vitest'
import { DashboardDatabase } from '../db/database.js'
import { createDashboardSqliteDatabase } from '../db/sqlite.js'
import { createDashboardRunDetailReader } from '../run-service/run-detail-reader.js'

it('REC-V3-ROW-READS-UNAVAILABLE-ORDINAL: cold registry reads only persisted v3 facts', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-qa-424-cold-'))
  const dbPath = join(dir, 'history.db')
  const runId = asRunId(generateRunId())
  const raw = createDashboardSqliteDatabase(dbPath)
  try {
    for (const sql of V3_SQL) raw.exec(sql)
    raw.prepare('INSERT INTO runs (id, name, status) VALUES (?, ?, ?)')
      .run(runId, 'Historical recording', 'passed')
    for (const testIndex of [0, 1]) {
      raw.prepare('INSERT INTO run_members (run_id, test_index, attempts) VALUES (?, ?, ?)')
        .run(runId, testIndex, 1)
      raw.prepare(`INSERT INTO run_steps (run_id, test_index, step_index, cache_status,
        verifier_verdict, self_heal_occurred, brief_digest) VALUES (?, ?, 0, ?, ?, 0, ?)`)
        .run(runId, testIndex, 'hit', JSON.stringify({ pass: true, reasoning: 'recorded' }), 'digest')
      for (const index of [0, 1]) {
        raw.prepare(`INSERT INTO run_sub_actions (run_id, test_index, step_index,
          sub_action_index, plan, planned_action, result, screen_state_hash)
          VALUES (?, ?, 0, ?, ?, ?, ?, ?)`)
          .run(runId, testIndex, index, 'recorded',
            JSON.stringify({ type: 'navigate', to: 'url', url: 'https://example.invalid' }),
            JSON.stringify({ success: true }), 'recorded')
      }
    }
    raw.pragma('user_version = 3')
  } finally { raw.close() }

  const db = new DashboardDatabase({ dbPath })
  try {
    const rows = db.readRunDetailRows(runId)!
    expect(rows.members).toHaveLength(2)
    expect(rows.members.every(member => !Object.hasOwn(member, 'recording'))).toBe(true)
    const forbidden = vi.fn(() => { throw new Error('No handoff, config or byte reconstruction') })
    const registry = createFunctionRegistry({
      deps: { runDetail: createDashboardRunDetailReader(db),
        runs: { get: forbidden }, config: { getMasked: forbidden },
        evidenceBlobs: { read: forbidden },
      } as unknown as FunctionDeps,
      auditSink: { appendExecutionAudit() {}, appendGuardrailAudit() {} },
      resolveExecutionContext: () => 'local-interactive',
    })
    const output = RunDetailProjectionSchema.parse(await invokeFunction(registry, 'runs.detail',
      { runId }, { surface: 'dashboard', grantedScopes: ['read'], safeMode: false, origin: 'human' }))
    expect(output.members.map(member => member.recording)).toEqual([
      { state: 'absent', reason: 'unavailable' }, { state: 'absent', reason: 'unavailable' },
    ])
    expect(output.subActions).toHaveLength(4)
    for (const row of output.subActions) expect(row).not.toHaveProperty('recordingOffsetMs')
    expect(forbidden).not.toHaveBeenCalled()
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }) }
})

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

