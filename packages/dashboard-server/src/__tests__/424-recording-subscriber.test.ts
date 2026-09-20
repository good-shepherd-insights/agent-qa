import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { generateRunId } from '@vostride/agent-qa-ids'
import { asRunId, RecordingEntrySchema } from '@vostride/agent-qa-schema'
import type { SubActionRecordedPayload } from '@vostride/agent-qa-schema'
import { DashboardDatabase } from '../db/database.js'
import { createDashboardSqliteDatabase } from '../db/sqlite.js'
import { createDashboardRunDetailReader } from '../run-service/run-detail-reader.js'

let dir: string
let dbPath: string
let db: DashboardDatabase
let runId: ReturnType<typeof asRunId>
const recording = RecordingEntrySchema.parse({
  state: 'present',
  ref: { id: `recording:${'a'.repeat(64)}`, sha: 'a'.repeat(64) },
  contentType: 'video/webm',
  byteLength: 12345,
  durationMs: 2400.5,
})
const child: SubActionRecordedPayload = {
  testIndex: 0,
  stepIndex: 0,
  subActionIndex: 0,
  plan: 'Open the page',
  plannedAction: { type: 'navigate', to: 'url', url: 'https://example.invalid' },
  result: { success: true },
  screenStateHash: 'before',
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agent-qa-424-recording-subscriber-'))
  dbPath = join(dir, 'dashboard.db')
  db = new DashboardDatabase({ dbPath })
  runId = asRunId(generateRunId())
})
afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

function seedRun() {
  db.insertRun({ id: runId, name: 'recording', status: 'passed', duration: 0,
    startedAt: '', endedAt: '' })
}

it('REC-SUB-ABSENT-KEY-NULL: omitted recording and offset persist as NULL and read as absent', async () => {
  seedRun()
  db.upsertRunMember({ runId, testIndex: 0 })
  db.insertRunSubAction({ runId, ...child })
  const raw = createDashboardSqliteDatabase(dbPath)
  try {
    expect(raw.prepare('SELECT recording_json FROM run_members WHERE run_id = ?').get(runId))
      .toEqual({ recording_json: null })
    expect(raw.prepare('SELECT recording_offset_ms FROM run_sub_actions WHERE run_id = ?').get(runId))
      .toEqual({ recording_offset_ms: null })
  } finally { raw.close() }
  const rows = await createDashboardRunDetailReader(db).read(runId)
  expect(rows?.members).toHaveLength(1)
  expect(rows?.subActions).toHaveLength(1)
  expect(rows?.members[0]).not.toHaveProperty('recording')
  expect(rows?.subActions[0]).not.toHaveProperty('recordingOffsetMs')
})

it('REC-SUB-UPSERT-OMISSION: a terminal upsert without recording preserves the stored entry', async () => {
  seedRun()
  const member = { runId, testIndex: 0, recording }
  db.upsertRunMember(member)
  db.upsertRunMember({ runId, testIndex: 0, outcome: 'passed' })
  const rows = await createDashboardRunDetailReader(db).read(runId)
  expect(rows?.members[0]?.recording).toEqual(recording)
  expect(rows?.members[0]?.outcome).toBe('passed')
  const raw = createDashboardSqliteDatabase(dbPath)
  try {
    expect(raw.prepare('SELECT recording_json FROM run_members WHERE run_id = ?').get(runId))
      .toEqual({ recording_json: JSON.stringify(recording) })
  } finally { raw.close() }
})

it('REC-SUB-MALFORMED-JSON: malformed recording JSON maps to an absent key without throwing', async () => {
  seedRun()
  db.upsertRunMember({ runId, testIndex: 0 })
  const raw = createDashboardSqliteDatabase(dbPath)
  try {
    raw.prepare('UPDATE run_members SET recording_json = ? WHERE run_id = ?')
      .run('{broken', runId)
  } finally { raw.close() }
  const rows = await createDashboardRunDetailReader(db).read(runId)
  expect(rows?.members).toHaveLength(1)
  expect(rows?.members[0]).not.toHaveProperty('recording')
})

it('REC-SUB-OFFSET-ZERO: zero and fractional offsets survive storage separately from omission', async () => {
  seedRun()
  for (const [subActionIndex, recordingOffsetMs] of [0, 12.5, undefined].entries()) {
    const input = { runId, ...child, subActionIndex, recordingOffsetMs }
    db.insertRunSubAction(input)
  }
  const rows = await createDashboardRunDetailReader(db).read(runId)
  expect(rows?.subActions.map(row => row.recordingOffsetMs)).toEqual([0, 12.5, undefined])
  expect(rows?.subActions[2]).not.toHaveProperty('recordingOffsetMs')
  const raw = createDashboardSqliteDatabase(dbPath)
  try {
    expect(raw.prepare('SELECT recording_offset_ms FROM run_sub_actions WHERE run_id = ? ORDER BY sub_action_index').all(runId))
      .toEqual([{ recording_offset_ms: 0 }, { recording_offset_ms: 12.5 }, { recording_offset_ms: null }])
  } finally { raw.close() }
})
