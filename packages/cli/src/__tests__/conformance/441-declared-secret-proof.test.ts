// C441-PROOF (441 D-22, D-30): what `ask` and `chat` send, write and print outside a run carries
// `[secret:<name>]` for each declared value and never the value. 441-13 adds the run leg.

import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join, relative, sep } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { afterAll, describe, expect, it } from 'vitest'

import { recordedDoorProject, spawnCliRun, type CliRunOutcome } from './433-door-fixture.js'
import type { RecordedStubRequest } from './populated-run-fixture.js'
import { cleanupTempRoots } from './spawned-chat.js'

const CELL_BUDGET_MS = 300_000

const SHORT = 'q^7'
const LONG = 'Lx~9^aZ4-proof441-long-declared-value-0123456789'
const SHORT_MARKER = '[secret:SHORT_441]'
const LONG_MARKER = '[secret:LONG_441]'
const RAW = [SHORT, LONG] as const
const MARKERS = [SHORT_MARKER, LONG_MARKER] as const
const SECRETS_FILE = '.env.secrets.local'

const FREE_FORM_UTTERANCE = `keep ${SHORT} and ${LONG} in mind`
const ECHO_UTTERANCE = `/fn knowledge.record.show ${JSON.stringify({ recordId: `${SHORT} ${LONG}` })}`

// D-21 media, the runs/<id>/blobs/ image documents, and the D-18 JSON paths blanked in handoff.json.
const EXCLUDED = {
  mediaExtensions: ['.png', '.jpg', '.jpeg', '.webp', '.webm', '.mp4', '.zip'],
  blobDirectory: /(^|\/)runs\/[^/]+\/blobs\//u,
  D18_PATHS: ['stepText', 'plannedAction', 'interpolatedVariables'],
} as const

afterAll(() => {
  cleanupTempRoots()
})

type HitClass = 'text' | 'sqlite' | 'handoff' | 'undecodable'

interface ScanHit {
  readonly path: string
  readonly class: HitClass
  readonly raw: string
}

interface ScanExclusions {
  readonly files: readonly string[]
}

const SQLITE_HEADER = 'SQLite format 3\u0000'
const SQLITE_SIDECARS = ['-wal', '-shm', '-journal']

function filesUnder(root: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) files.push(...filesUnder(path))
    else if (entry.isFile()) files.push(path)
  }
  return files
}

function sqliteText(path: string): string {
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
    const cells: string[] = []
    for (const { name } of tables) {
      for (const row of db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all()) {
        for (const value of Object.values(row as Record<string, unknown>)) {
          if (typeof value === 'string') cells.push(value)
        }
      }
    }
    return cells.join('\n')
  } finally {
    db.close()
  }
}

function blankD18(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(blankD18)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([key, member]) => [
    key,
    (EXCLUDED.D18_PATHS as readonly string[]).includes(key) ? null : blankD18(member),
  ]))
}

function scanRoot(root: string, raw: readonly string[], exclusions: ScanExclusions): ScanHit[] {
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const hits: ScanHit[] = []
  for (const path of filesUnder(root)) {
    const rel = relative(root, path).split(sep).join('/')
    if (exclusions.files.includes(path)) continue
    if (EXCLUDED.mediaExtensions.some((ext) => path.toLowerCase().endsWith(ext))) continue
    if (EXCLUDED.blobDirectory.test(rel)) continue
    const sidecarOf = SQLITE_SIDECARS.find((suffix) => path.endsWith(suffix))
    if (sidecarOf !== undefined && existsSync(path.slice(0, -sidecarOf.length))) continue
    const bytes = readFileSync(path)
    let text: string
    let kind: HitClass
    if (bytes.subarray(0, SQLITE_HEADER.length).toString('latin1') === SQLITE_HEADER) {
      text = sqliteText(path)
      kind = 'sqlite'
    } else {
      try {
        text = decoder.decode(bytes)
      } catch {
        hits.push({ path: rel, class: 'undecodable', raw: '<not UTF-8>' })
        continue
      }
      kind = 'text'
      if (basename(path) === 'handoff.json') {
        text = JSON.stringify(blankD18(JSON.parse(text)))
        kind = 'handoff'
      }
    }
    for (const value of raw) {
      if (text.includes(value)) hits.push({ path: rel, class: kind, raw: value })
    }
  }
  return hits
}

interface SessionEvent {
  readonly kind?: string
}

function sessionEvents(agentQaRoot: string): SessionEvent[] {
  const dir = join(agentQaRoot, 'sessions')
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((name) => name.endsWith('.jsonl')).flatMap((name) =>
    readFileSync(join(dir, name), 'utf8').split('\n').filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line) as SessionEvent))
}

type PresenceClass = 'user_message' | 'clause_receipt'

function presence(agentQaRoot: string, marker: string): Record<PresenceClass, boolean> {
  const events = sessionEvents(agentQaRoot)
  const holds = (kind: PresenceClass): boolean =>
    events.filter((event) => event.kind === kind).some((event) => JSON.stringify(event).includes(marker))
  return { user_message: holds('user_message'), clause_receipt: holds('clause_receipt') }
}

function transcript(outcome: CliRunOutcome): string {
  return `exit ${String(outcome.status)}\n--- stdout ---\n${outcome.stdout}\n--- stderr ---\n${outcome.stderr}`
}

function declare(root: string): string {
  const path = join(root, SECRETS_FILE)
  writeFileSync(path, `SHORT_441=${SHORT}\nLONG_441=${LONG}\n`, 'utf8')
  return path
}

function wholeBodies(requests: readonly RecordedStubRequest[]): string[] {
  return requests.map((request) => {
    if (request.fullBody === undefined) throw new Error('the stub recorded a request without its whole body')
    return request.fullBody
  })
}

describe('C441-PROOF', () => {
  it('ask masks both declared values in what it writes and prints', async () => {
    const project = await recordedDoorProject('441-ask', { fullBodies: true })
    try {
      const secretsPath = declare(project.root)
      const freeForm = await spawnCliRun(project, ['ask', FREE_FORM_UTTERANCE])
      const echo = await spawnCliRun(project, ['ask', ECHO_UTTERANCE])

      expect(echo.status, transcript(echo)).toBe(0)
      expect(freeForm.status, transcript(freeForm)).toBe(1)
      expect(freeForm.stderr, transcript(freeForm)).toContain('Ask error [fail-closed]')

      for (const body of wholeBodies(project.model.requests)) {
        for (const value of RAW) expect(body.includes(value), `a model request carried ${value}`).toBe(false)
      }

      const events = sessionEvents(project.agentQaRoot)
      expect(events.filter((event) => event.kind === 'user_message')).toHaveLength(2)
      for (const marker of MARKERS) {
        expect(presence(project.agentQaRoot, marker), marker).toEqual({ user_message: true, clause_receipt: true })
      }

      const stdout = `${freeForm.stdout}\n${echo.stdout}`
      const stderr = `${freeForm.stderr}\n${echo.stderr}`
      for (const marker of MARKERS) expect(stdout, marker).toContain(marker)
      for (const value of RAW) {
        expect(stdout.includes(value), `stdout carried ${value}`).toBe(false)
        expect(stderr.includes(value), `stderr carried ${value}`).toBe(false)
      }

      expect(scanRoot(project.root, RAW, { files: [secretsPath] })).toEqual([])
    } finally {
      await project.close()
    }
  }, CELL_BUDGET_MS)

  it('ask refuses at start when the secrets file cannot be read', async () => {
    const project = await recordedDoorProject('441-ask-refusal', { fullBodies: true })
    try {
      const secretsPath = join(project.root, SECRETS_FILE)
      rmSync(secretsPath)
      const outcome = await spawnCliRun(project, ['ask', 'status'])

      expect(outcome.status, transcript(outcome)).toBe(1)
      expect(outcome.stderr).toContain(`Error: Secrets file not found: ${secretsPath}`)
      expect(outcome.stderr).toContain('Create the file before running tests. It may be empty, but it must exist.')
      expect(project.model.requests).toEqual([])
      expect(existsSync(join(project.agentQaRoot, 'sessions'))).toBe(false)
    } finally {
      await project.close()
    }
  }, CELL_BUDGET_MS)
})
