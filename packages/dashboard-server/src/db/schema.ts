// The dashboard's durable schema (Phase 405 plan 01, D-01/D-02).
//
// 2026-08-27 — SCHEMA VERSION 2, AS A HARD CUT AND NOT A MIGRATION. The v1 DDL below was
// REWRITTEN IN PLACE as the single version-2 entry: the three bus-shaped projection tables land,
// `execution_logs` gains the two handle columns, and there is no version-1 entry left to run. A
// database stamped `user_version = 1` is REFUSED BY NAME on open (`runSqliteMigrations`), never
// migrated — running `CREATE TABLE IF NOT EXISTS` over the old wide shape is a no-op that leaves
// the app talking to a half-old schema, which is RESEARCH Pitfall 4 and the reason the refusal is
// explicit rather than implied by the version comparison.
//
// THE V1 DEBRIS IS STILL SPELLED HERE ON PURPOSE. `steps`, `reasoning_traces`, `logs` and the
// unfed `runs` columns remain in the version-2 sql list until plan 405-07's two-predicate census
// deletes them with their readers. That is a FUNCTIONALITY gap, not an architectural one: from
// this plan on the rebuilt subscriber writes NONE of them, so they are dormant rather than
// competing — and deleting a table in the same commit that adds three would have made the census
// a guess taken under time pressure.
export const SCHEMA_VERSION = 2

export interface DashboardMigration {
  version: number
  sql: string[]
}

export const MIGRATIONS: DashboardMigration[] = [
  {
    version: 2,
    sql: [
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
        video_path TEXT,
        failure_summary TEXT,
        platform TEXT DEFAULT 'web',
        test_file_content TEXT,
        model_name TEXT,
        llm_provider TEXT,
        parallel INTEGER DEFAULT 0,
        parent_run_id TEXT,
        attempt_number INTEGER DEFAULT 0,
        retry_count INTEGER DEFAULT 0,
        max_retries INTEGER DEFAULT 0,
        error_log TEXT,
        memory_log TEXT,
        test_id TEXT,
        suite_id TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS steps (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES runs(id),
        name TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('passed','failed','healed','skipped','cancelled')),
        duration INTEGER NOT NULL DEFAULT 0,
        action TEXT,
        observation TEXT,
        reasoning TEXT,
        planned_action TEXT,
        result TEXT CHECK(result IN ('success','failure')),
        error TEXT,
        screenshot_path TEXT,
        screenshot_before_path TEXT,
        healing_attempts TEXT,
        retry_count INTEGER DEFAULT 0,
        captured_variables TEXT,
        step_order INTEGER NOT NULL DEFAULT 0,
        annotation_data TEXT,
        healing_screenshot_paths TEXT,
        accessibility_violations TEXT,
        confidence REAL,
        prompt_tokens INTEGER DEFAULT 0,
        completion_tokens INTEGER DEFAULT 0,
        total_tokens INTEGER DEFAULT 0,
        sub_actions_data TEXT,
        console_logs TEXT,
        network_logs TEXT,
        variable_snapshot TEXT,
        original_step_name TEXT,
        screen_context_before TEXT,
        screen_context_after TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS reasoning_traces (
        id TEXT PRIMARY KEY,
        step_id TEXT NOT NULL REFERENCES steps(id),
        observe_text TEXT,
        observe_duration INTEGER,
        plan_reasoning TEXT,
        plan_confidence REAL,
        plan_action TEXT,
        plan_duration INTEGER,
        execute_action TEXT,
        execute_duration INTEGER,
        verify_reasoning TEXT,
        verify_success INTEGER,
        verify_duration INTEGER,
        heal_attempts TEXT,
        total_duration INTEGER,
        screen_state_before TEXT,
        screen_state_after TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS logs (
        id TEXT PRIMARY KEY,
        step_id TEXT REFERENCES steps(id) ON DELETE CASCADE,
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        level TEXT NOT NULL CHECK(level IN ('debug','info','warn','error')),
        source TEXT NOT NULL CHECK(source IN ('agent','adapter','cache','planner','healer','hook','runner')),
        message TEXT NOT NULL,
        data TEXT,
        timestamp TEXT NOT NULL
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
        -- 405 D-01: where in the run tree this hook ran. Sourced from HookFinishedPayload's own
        -- optional testIndex/stepIndex; NULL means a run-scoped hook, which is a real state and
        -- not a missing value.
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
        kind TEXT NOT NULL CHECK(kind IN ('test', 'suite-parent', 'suite-child', 'unknown')),
        schema_version INTEGER NOT NULL,
        payload TEXT NOT NULL DEFAULT '{}',
        finalized_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`,
      // ---- The v2 bus-shaped projection (405 D-01) ----------------------------------------
      //
      // THE COLUMNS ARE THE PAYLOAD'S OWN NAMES, snake_cased and nothing else. No field is
      // re-derived, renamed or re-interpreted on the way in — that is D-01's whole claim, and
      // it is what makes the read a mirror rather than a second opinion. Nested payload objects
      // (`planned_action`, `grounding`, `result`, `artifact_refs`) are `JSON.stringify` of the
      // field VERBATIM; the projection never reaches inside one.
      //
      // `test_index` IS THE HANDLE (RESEARCH D4). `handleId(runId, testIndex)` is how this
      // product spells run-scoped member identity, so minting a second id here would be a
      // second spelling of the same fact.
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
        -- D-17 ordinal. Starts at 1 and rises on testRetryScheduled; never reset by an upsert.
        attempts INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (run_id, test_index)
      )`,
      // The token columns are NULLABLE AND NEVER DEFAULT 0 (D-05/D-06). The v1 `steps` table
      // above declares `prompt_tokens INTEGER DEFAULT 0`, and that zero is a measurement nobody
      // made — the exact lie this shape refuses to be able to tell. They are written by 405-04,
      // which lands the producer; until then every row carries NULL, which is honest.
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
        PRIMARY KEY (run_id, test_index, step_index)
      )`,
      // NO FOREIGN KEY TO `run_steps`, deliberately: `subActionRecorded` envelopes PRECEDE the
      // `stepFinalized` for their own step by construction, so a constraint pointing at a row
      // that does not exist yet would drop every sub-action of every step.
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
        PRIMARY KEY (run_id, test_index, step_index, sub_action_index)
      )`,
      'CREATE INDEX IF NOT EXISTS idx_run_members_run ON run_members(run_id)',
      'CREATE INDEX IF NOT EXISTS idx_run_steps_run ON run_steps(run_id, test_index)',
      'CREATE INDEX IF NOT EXISTS idx_run_sub_actions_run ON run_sub_actions(run_id, test_index, step_index)',
      'CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status)',
      'CREATE INDEX IF NOT EXISTS idx_runs_started_at ON runs(started_at)',
      'CREATE INDEX IF NOT EXISTS idx_runs_name ON runs(name)',
      'CREATE INDEX IF NOT EXISTS idx_runs_queue ON runs(status, priority, created_at)',
      'CREATE INDEX IF NOT EXISTS idx_runs_parent ON runs(parent_run_id)',
      'CREATE INDEX IF NOT EXISTS idx_steps_run_id ON steps(run_id)',
      'CREATE INDEX IF NOT EXISTS idx_reasoning_traces_step_id ON reasoning_traces(step_id)',
      'CREATE INDEX IF NOT EXISTS idx_logs_step_id ON logs(step_id)',
      'CREATE INDEX IF NOT EXISTS idx_logs_run_id ON logs(run_id)',
      'CREATE INDEX IF NOT EXISTS idx_logs_level ON logs(level)',
      'CREATE INDEX IF NOT EXISTS idx_logs_source ON logs(source)',
      'CREATE INDEX IF NOT EXISTS idx_logs_run_level_source ON logs(run_id, level, source)',
      'CREATE INDEX IF NOT EXISTS idx_execution_logs_run_id ON execution_logs(run_id)',
      'CREATE INDEX IF NOT EXISTS idx_execution_logs_step_id ON execution_logs(step_id)',
      'CREATE INDEX IF NOT EXISTS idx_execution_logs_type ON execution_logs(type)',
      'CREATE INDEX IF NOT EXISTS idx_token_events_model ON token_events(model_name)',
      'CREATE INDEX IF NOT EXISTS idx_token_events_source ON token_events(source)',
      'CREATE INDEX IF NOT EXISTS idx_token_events_created ON token_events(created_at)',
      'CREATE INDEX IF NOT EXISTS idx_run_artifacts_kind ON run_artifacts(kind)',
      'CREATE INDEX IF NOT EXISTS idx_run_artifacts_finalized ON run_artifacts(finalized_at)',
    ],
  },
]
