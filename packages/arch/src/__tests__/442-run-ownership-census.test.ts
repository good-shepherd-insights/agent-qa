/**
 * THE RUN-OWNERSHIP CENSUS (Phase 442, V2-RUN-01 / SC1; D-01, D-03, D-05).
 *
 * Phase 442 removed every path that finalized `running` rows it did not own. Each cell here REDs
 * if one returns, following the 436, 437 and 438 censuses: comments are blanked by the same lexer,
 * every needle is assembled from two halves at run time, each cell scans only the production
 * source of the CLI and the dashboard server (no `__tests__`, no `dist`), and C442-SELF-MATCH
 * proves this file spells none of them. The census reads agent-qa's own packages only (434 D-14).
 *
 * FORMER SITES AND WHAT REPLACED EACH (cell in brackets)
 *
 *   cli/src/commands/run.ts, the suite's        every running suite row marked cancelled on the
 *   first-signal sweep                          first signal -> the own-row finalizer on the id the
 *                                               suite ingest reported (442-03) -> no write on the
 *                                               first signal; a forced exit closes only its own
 *                                               still-running row (444-08)
 *                                               [C442-NO-RUNNING-SWEEP]
 *   cli/src/commands/run.ts, the action's       every running row marked failed or cancelled, each
 *   crash catch                                 id printed -> one compare-and-set on the own row
 *                                               (442-03) [C442-NO-RUNNING-SWEEP]
 *   dashboard-server/src/server/server.ts,      every running row marked failed as a server restart
 *   the startup loop                            -> only rows whose owner is provably gone, through
 *                                               the orphan compare-and-set (442-04)
 *                                               [C442-NO-RUNNING-SWEEP]
 *   dashboard-server/src/queue/job-queue.ts,    anyone's running row marked cancelled -> the
 *   the cancel route's running arm              owner-aware outcome (442-05)
 *                                               [C442-STATUS-WRITERS-CLASSIFIED]
 *   dashboard-server/src/reporter/              any existing row rewritten as running -> one claim
 *   dashboard-subscriber.ts, the adopt arm      of its own row (443-04)
 *                                               [C442-STATUS-WRITERS-CLASSIFIED]
 */

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const PACKAGES_DIR = fileURLToPath(new URL('../../../', import.meta.url))
const THIS_FILE = fileURLToPath(import.meta.url)
const OWN = 'arch/src/__tests__/442-run-ownership-census.test.ts'

// ---------------------------------------------------------------------------------------------
// The lexer (the 432 to 438 censuses'): comments out, everything else in
// ---------------------------------------------------------------------------------------------

function regexAllowed(out: string): boolean {
  let k = out.length - 1
  while (k >= 0 && /\s/.test(out[k]!)) k--
  if (k < 0) return true
  if ('(,=:[!&|?{};+-*%<>~^'.includes(out[k]!)) return true
  const word = /([A-Za-z_$][\w$]*)$/.exec(out.slice(0, k + 1))
  return word !== null
    && ['return', 'typeof', 'case', 'yield', 'await', 'in', 'of', 'void', 'delete'].includes(word[1]!)
}

function codeOf(text: string): string {
  let out = ''
  let i = 0
  const n = text.length
  const templateDepths: number[] = []
  let depth = 0
  let state: 'code' | 'line' | 'block' | 'single' | 'double' | 'template' = 'code'
  while (i < n) {
    const c = text[i]!
    const d = text[i + 1]
    if (state === 'code') {
      if (c === '/' && d === '/') { state = 'line'; out += '  '; i += 2; continue }
      if (c === '/' && d === '*') { state = 'block'; out += '  '; i += 2; continue }
      if (c === '/' && regexAllowed(out)) {
        let j = i + 1
        let inClass = false
        while (j < n && text[j] !== '\n') {
          const ch = text[j]
          if (ch === '\\') { j += 2; continue }
          if (ch === '[') inClass = true
          else if (ch === ']') inClass = false
          else if (ch === '/' && !inClass) break
          j++
        }
        if (j < n && text[j] === '/') {
          j++
          while (j < n && /[a-z]/i.test(text[j]!)) j++
          out += text.slice(i, j)
          i = j
          continue
        }
      }
      if (c === "'") { state = 'single'; out += c; i++; continue }
      if (c === '"') { state = 'double'; out += c; i++; continue }
      if (c === '`') { state = 'template'; out += c; i++; continue }
      if (c === '{') { depth++; out += c; i++; continue }
      if (c === '}') {
        if (templateDepths.length > 0 && templateDepths[templateDepths.length - 1] === depth) {
          templateDepths.pop()
          depth--
          state = 'template'
          out += c
          i++
          continue
        }
        depth--
        out += c
        i++
        continue
      }
      out += c
      i++
      continue
    }
    if (state === 'line') {
      if (c === '\n') { state = 'code'; out += c } else out += ' '
      i++
      continue
    }
    if (state === 'block') {
      if (c === '*' && d === '/') { state = 'code'; out += '  '; i += 2; continue }
      out += c === '\n' ? '\n' : ' '
      i++
      continue
    }
    if (state === 'single' || state === 'double') {
      const quote = state === 'single' ? "'" : '"'
      if (c === '\\') { out += c + (d ?? ''); i += 2; continue }
      if (c === quote || c === '\n') state = 'code'
      out += c
      i++
      continue
    }
    if (c === '\\') { out += c + (d ?? ''); i += 2; continue }
    if (c === '`') { state = 'code'; out += c; i++; continue }
    if (c === '$' && d === '{') { depth++; templateDepths.push(depth); state = 'code'; out += '${'; i += 2; continue }
    out += c
    i++
  }
  return out
}

// ---------------------------------------------------------------------------------------------
// The universes: production source by the 412 path rule, read as bytes
// ---------------------------------------------------------------------------------------------

function listTree(root: string): string[] {
  const files: string[] = []
  const walk = (dir: string): void => {
    if (!existsSync(join(PACKAGES_DIR, dir))) return
    for (const entry of readdirSync(join(PACKAGES_DIR, dir), { withFileTypes: true })) {
      const child = `${dir}${entry.name}`
      if (entry.isDirectory()) walk(`${child}/`)
      else if (/\.tsx?$/.test(entry.name)) files.push(child)
    }
  }
  walk(root)
  return files.sort()
}

const isProduction = (file: string): boolean =>
  !file.includes('/__tests__/') && !/\.test(-d)?\.tsx?$/.test(file)

function filesOf(region: string): string[] {
  if (region.endsWith('/')) return listTree(region).filter(isProduction)
  return existsSync(join(PACKAGES_DIR, region)) ? [region] : []
}

const bytesOf = (file: string): string => readFileSync(join(PACKAGES_DIR, file)).toString('utf8')

const codeCache = new Map<string, string>()
function code(file: string): string {
  let cached = codeCache.get(file)
  if (cached === undefined) {
    cached = existsSync(join(PACKAGES_DIR, file)) ? codeOf(bytesOf(file)) : ''
    codeCache.set(file, cached)
  }
  return cached
}

function scanned(regions: readonly string[]): string[] {
  return [...new Set(regions.flatMap(filesOf))]
}

const lineAt = (text: string, index: number): number => text.slice(0, index).split('\n').length

function hitsIn(label: string, text: string, pattern: RegExp): string[] {
  return [...text.matchAll(new RegExp(pattern.source, `${pattern.flags.replace('g', '')}g`))]
    .map((m) => `${label}:${lineAt(text, m.index)}: ${m[0].replace(/\s+/g, ' ').slice(0, 160)}`)
}

// ---------------------------------------------------------------------------------------------
// The needles, every one assembled from two halves
// ---------------------------------------------------------------------------------------------

type Halves = readonly [string, string]
const joined = (halves: Halves): string => halves[0] + halves[1]
const cat = (...parts: string[]): string => parts.join('')
const rx = (halves: Halves, flags = ''): RegExp => new RegExp(joined(halves), flags)

const RUN_LIST: Halves = ['getRu', 'ns']
const RUNS_UPDATE_TEXT: Halves = ['UPDATE ru', 'ns']
const RUNNING_LIST: Halves = [
  '\\bgetRu',
  'ns\\s*\\(\\s*\\{[^}]*\\bstatus\\s*:\\s*([\'"`])running\\1',
]
const RUNS_UPDATE: Halves = ['\\bUPDATE\\s+ru', 'ns\\s+SET\\b']

const CLI = 'cli/src/'
const DASHBOARD = 'dashboard-server/src/'
const REGIONS = [CLI, DASHBOARD] as const
const RUN_TS = 'cli/src/commands/run.ts'
const SHUTDOWN = 'cli/src/commands/shutdown-controller.ts'
const SERVER = 'dashboard-server/src/server/server.ts'
const JOB_QUEUE = 'dashboard-server/src/queue/job-queue.ts'
const ROUTES = 'dashboard-server/src/server/routes.ts'
const DATABASE = 'dashboard-server/src/db/database.ts'
const SUBSCRIBER = 'dashboard-server/src/reporter/dashboard-subscriber.ts'
const SCHEMA = 'dashboard-server/src/db/schema.ts'
const GUARDED = [RUN_TS, SHUTDOWN, SERVER, JOB_QUEUE, ROUTES, DATABASE, SUBSCRIBER, SCHEMA]

const memberCalls = (text: string, name: string): number =>
  [...text.matchAll(new RegExp(`\\.${name}\\s*\\(`, 'g'))].length

// The SQL statement a match sits in: from the match to the quote that opened it.
function statementAt(text: string, index: number): string {
  let k = index - 1
  while (k >= 0 && /\s/.test(text[k]!)) k--
  const quote = k >= 0 && '\'"`'.includes(text[k]!) ? text[k]! : undefined
  if (quote === undefined) return text.slice(index, index + 400)
  const end = text.indexOf(quote, index)
  return text.slice(index, end < 0 ? undefined : end)
}

function bulkUpdateOffenses(label: string, text: string): string[] {
  return [...text.matchAll(rx(RUNS_UPDATE, 'gi'))].flatMap((m) => {
    const statement = statementAt(text, m.index)
    const whereAt = statement.search(/\bWHERE\b/i)
    const bulk = whereAt < 0
      ? /\bstatus\b/i.test(statement)
      : /\bstatus\b/i.test(statement.slice(whereAt)) && !/\bid\b/i.test(statement.slice(whereAt))
    return bulk
      ? [`${label}:${lineAt(text, m.index)}: ${statement.replace(/\s+/g, ' ').slice(0, 160)}`]
      : []
  })
}

const sweepOffenses = (label: string, text: string): string[] => [
  ...hitsIn(label, text, rx(RUNNING_LIST)),
  ...bulkUpdateOffenses(label, text),
]

// ---------------------------------------------------------------------------------------------
// The runs.status writers, each classified by whose row it writes
// ---------------------------------------------------------------------------------------------

const WRITER_CALL: Halves = [
  '\\.(claimRunningRow|updateRun|updateRunStatus|insertRun|insertPendingRun|finalizeOwnRun|closeOwnRun',
  '|finalizeOrphanRun|finalizeRunArtifact)\\s*\\(',
]
// updateRun and insertRun write a status only when their argument names one.
const STATUS_OPTIONAL = new Set(['updateRun', 'insertRun'])
const STATUS_KEY = /(?:^|[{,\s])status\s*(?:[:,}]|$)/m

type Classification = 'own' | 'orphan' | 'own-queue'
interface Writer { file: string; call: string; classification: Classification; why: string }
interface WriterSite { file: string; call: string; line: number }

const w = (file: string, call: string, classification: Classification, why: string): Writer =>
  ({ file, call, classification, why })

const WRITERS: readonly Writer[] = [
  w(RUN_TS, 'finalizeOwnRun', 'own', 'forced exit, only the running row this process claimed'),
  w(RUN_TS, 'finalizeOwnRun', 'own', 'crash catch, its own row only'),
  w(RUN_TS, 'closeOwnRun', 'own', 'record flush, the row its own claim stamped, after a failed write'),
  w(RUN_TS, 'finalizeRunArtifact', 'own', 'crash catch, only after its own CAS wrote'),
  w(RUN_TS, 'finalizeRunArtifact', 'own', 'direct parse-error validation row'),
  w(RUN_TS, 'insertRun', 'own', "suite preparation failure, under the run's own id"),
  w(RUN_TS, 'insertRun', 'own', 'direct parse-error validation row'),
  w(SUBSCRIBER, 'updateRun', 'own', 'runFinished aggregate verdict'),
  w(SUBSCRIBER, 'updateRun', 'own', 'verdict envelope'),
  w(SUBSCRIBER, 'claimRunningRow', 'own', 'ingest claims its own run row'),
  w(SUBSCRIBER, 'finalizeRunArtifact', 'own', 'runFinished finalize'),
  w(SERVER, 'updateRun', 'own', 'run-settled of a run this dashboard executed'),
  w(SERVER, 'updateRun', 'own', 'Appium start failure of a run this dashboard executed'),
  w(SERVER, 'finalizeRunArtifact', 'own', 'best-effort helper of the two writes above'),
  w(SERVER, 'finalizeOrphanRun', 'orphan', 'startup, only for an owner classified gone'),
  w(JOB_QUEUE, 'insertPendingRun', 'own-queue', 'enqueue writes a pending row'),
  w(JOB_QUEUE, 'updateRunStatus', 'own-queue', 'pending to running, stamped with this dashboard'),
  w(JOB_QUEUE, 'updateRun', 'own-queue', 'cancel of a pending row'),
  w(JOB_QUEUE, 'finalizeRunArtifact', 'own-queue', 'cancel of a pending row'),
  w(JOB_QUEUE, 'finalizeOrphanRun', 'orphan', 'cancel of a running row whose owner is gone'),
  w(DATABASE, 'finalizeRunArtifact', 'orphan', 'inside finalizeOrphanRun, after its CAS wrote'),
]
const WRITER_FLOOR = 21

function argumentOf(text: string, open: number): string {
  let depth = 0
  for (let i = open; i < text.length && i < open + 4000; i++) {
    if (text[i] === '(') depth++
    else if (text[i] === ')' && --depth === 0) return text.slice(open + 1, i)
  }
  return text.slice(open + 1, open + 4000)
}

function writerCalls(file: string, text: string): WriterSite[] {
  return [...text.matchAll(rx(WRITER_CALL, 'g'))]
    .filter((m) => !STATUS_OPTIONAL.has(m[1]!)
      || STATUS_KEY.test(argumentOf(text, m.index + m[0].length - 1)))
    .map((m) => ({ file, call: m[1]!, line: lineAt(text, m.index) }))
}

function classificationDiff(found: readonly WriterSite[], pinned: readonly Writer[]): string[] {
  const key = (site: { file: string; call: string }): string => `${site.file} ${site.call}`
  const keys = [...new Set([...found.map(key), ...pinned.map(key)])].sort()
  return keys.flatMap((k) => {
    const sites = found.filter((site) => key(site) === k)
    const listed = pinned.filter((writer) => key(writer) === k).length
    const lines = sites.map((site) => site.line).join(', ')
    if (sites.length > listed) {
      return [`unlisted: ${k} (found ${sites.length} at lines ${lines}, listed ${listed})`]
    }
    if (sites.length < listed) return [`stale: ${k} (found ${sites.length}, listed ${listed})`]
    return []
  })
}

const RUNNING_CHECK = "CHECK (status <> 'running' OR owner_pid IS NOT NULL)"

// ---------------------------------------------------------------------------------------------
// The cells
// ---------------------------------------------------------------------------------------------

describe('C442-CENSUS — no path finalizes runs it does not own (442 D-05)', () => {
  it('C442-UNIVERSE-FLOORS: both production regions and every guarded file read real code, so no cell can pass over an empty scan', () => {
    for (const file of GUARDED) {
      expect(existsSync(join(PACKAGES_DIR, file)), `${file} is missing`).toBe(true)
    }
    for (const region of REGIONS) {
      expect(filesOf(region).length, `${region} scanned nothing`).toBeGreaterThan(20)
    }
    const files = scanned(REGIONS)
    for (const file of GUARDED) expect(files, `${file} is not scanned`).toContain(file)
    expect(memberCalls(code(RUN_TS), 'finalizeOwnRun'), `${RUN_TS} no longer finalizes its own row`)
      .toBeGreaterThanOrEqual(2)
    expect(memberCalls(code(SERVER), 'listRunningRunOwners'), `${SERVER} classifies no owner`).toBe(1)
    expect(memberCalls(code(SERVER), 'finalizeOrphanRun'), `${SERVER} no longer finalizes orphans`)
      .toBe(1)
    expect(memberCalls(code(DATABASE), 'prepare'), `${DATABASE} holds no SQL`).toBeGreaterThan(20)
  })

  it('C442-NO-RUNNING-SWEEP: no production code lists the running rows to finalize them, and no SQL text updates the runs table by status without naming its id', () => {
    const offenders = scanned(REGIONS).flatMap((file) => sweepOffenses(file, code(file)))
    expect(offenders, offenders.join('\n')).toEqual([])
  })

  it('C442-STATUS-WRITERS-CLASSIFIED: every runs.status writer is listed with whose row it writes', () => {
    const found = scanned(REGIONS).flatMap((file) => writerCalls(file, code(file)))
    const diff = classificationDiff(found, WRITERS)
    expect(diff, diff.join('\n')).toEqual([])
    expect(WRITERS).toHaveLength(WRITER_FLOOR)
    expect(found.length, 'the scan found fewer writers than the list pins')
      .toBeGreaterThanOrEqual(WRITER_FLOOR)
    for (const writer of WRITERS) {
      expect(writer.why, `${writer.file} ${writer.call} has no reason`).not.toBe('')
      if (writer.call === 'finalizeOrphanRun') expect(writer.classification).toBe('orphan')
      if (writer.classification === 'own-queue') expect(writer.file).toBe(JOB_QUEUE)
      if (writer.classification === 'orphan') {
        const inFinalizer = writer.call === 'finalizeOrphanRun' || writer.file === DATABASE
        expect(inFinalizer, `${writer.file} ${writer.call}: orphan outside the orphan finalizer`)
          .toBe(true)
      }
    }
  })

  it('C442-OWNER-REQUIRED: the runs table requires an owner on every running row', () => {
    const schema = bytesOf(SCHEMA)
    expect(code(SCHEMA)).toMatch(/\bexport const SCHEMA_VERSION = 6\b/)
    const migrations = schema.indexOf('export const MIGRATIONS')
    const start = schema.indexOf('CREATE TABLE IF NOT EXISTS runs (')
    expect(migrations, `${SCHEMA} declares no MIGRATIONS`).toBeGreaterThan(-1)
    expect(start, 'the runs DDL is not inside MIGRATIONS').toBeGreaterThan(migrations)
    expect(schema.slice(migrations, start)).toMatch(/version: 6,/)
    const ddl = schema.slice(start, schema.indexOf('`', start))
    const parts = ['owner_pid INTEGER', 'owner_incarnation TEXT', 'owner_host TEXT', RUNNING_CHECK]
    for (const part of parts) {
      expect(ddl, `the runs DDL lacks ${part}`).toContain(part)
    }

    const root = mkdtempSync(join(tmpdir(), 'c442-owner-required-'))
    try {
      const db = new DatabaseSync(join(root, 'runs.db'))
      try {
        db.exec(ddl)
        const insert = db.prepare(
          'INSERT INTO runs (id, name, status, owner_pid, owner_incarnation, owner_host)'
            + ' VALUES (?, ?, ?, ?, ?, ?)',
        )
        expect(() => insert.run('ownerless', 'raw', 'running', null, null, null))
          .toThrow(/CHECK constraint failed/)
        insert.run('owned', 'raw', 'running', 4242, 'ps-lstart:fixed', 'census-host')
        insert.run('queued', 'raw', 'pending', null, null, null)
        insert.run('healed', 'raw', 'healed', null, null, null)
        expect(() => insert.run('skipped', 'raw', 'skipped', null, null, null))
          .toThrow(/CHECK constraint failed/)
        const flip = db.prepare(cat('UPDATE ru', "ns SET status = 'running' WHERE id = ?"))
        expect(() => flip.run('queued')).toThrow(/CHECK constraint failed/)
        expect(db.prepare('SELECT id, status FROM runs ORDER BY id').all()).toEqual([
          { id: 'healed', status: 'healed' },
          { id: 'owned', status: 'running' },
          { id: 'queued', status: 'pending' },
        ])
      } finally {
        db.close()
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

// ---------------------------------------------------------------------------------------------
// Controls: the planted pre-442 shapes and this file
// ---------------------------------------------------------------------------------------------

describe('C442-CENSUS instruments', () => {
  it('C442-PLANTED-POSITIVE: every removed shape is found when planted as code, and none as a comment', () => {
    const loop = cat(
      'const running = db.getRu', "ns({ status: 'running' })\n",
      'for (const run of running) {\n  db.updat',
      "eRun(run.id, { status: 'failed', endedAt })\n}\n",
    )
    expect(sweepOffenses('planted.ts', codeOf(loop))).toHaveLength(1)
    expect(sweepOffenses('planted.ts', codeOf(`/* ${loop} */`))).toEqual([])
    expect(sweepOffenses('planted.ts', codeOf(loop.replace(/^/gm, '// ')))).toEqual([])
    const spread = cat('db.getRu', 'ns({\n  limit: 10,\n  status:\n    "running",\n})\n')
    expect(sweepOffenses('planted.ts', codeOf(spread))).toHaveLength(1)
    const pending = cat('db.getRu', "ns({ status: 'pending' })\n")
    expect(sweepOffenses('planted.ts', codeOf(pending))).toEqual([])

    const bulk = cat(
      'db.prepare("UPDATE ru',
      "ns SET status = 'failed' WHERE status = 'running'\").run()\n",
    )
    expect(sweepOffenses('planted.ts', codeOf(bulk))).toHaveLength(1)
    expect(sweepOffenses('planted.ts', codeOf(`// ${bulk}`))).toEqual([])
    const unbounded = cat('db.exec(`update ru', "ns set status = 'failed'`)\n")
    expect(sweepOffenses('planted.ts', codeOf(unbounded))).toHaveLength(1)
    const select = "db.prepare(\"SELECT id FROM runs WHERE status = 'running'\").all()\n"
    expect(sweepOffenses('planted.ts', codeOf(select))).toEqual([])
    const cas = cat(
      'db.prepare(`\n  UPDATE ru',
      "ns SET status = ?\n  WHERE id = ? AND status = 'running'\n`).run(s, id)\n",
    )
    expect(sweepOffenses('planted.ts', codeOf(cas))).toEqual([])

    const planted = 'cli/src/commands/planted.ts'
    const real = scanned(REGIONS).flatMap((file) => writerCalls(file, code(file)))
    const unclassified = cat('  db.updat', "eRun(id, { status: 'failed' })\n")
    const sites = writerCalls(planted, codeOf(unclassified))
    expect(sites).toEqual([{ file: planted, call: 'updateRun', line: 1 }])
    expect(classificationDiff([...real, ...sites], WRITERS))
      .toEqual([`unlisted: ${planted} updateRun (found 1 at lines 1, listed 0)`])
    expect(writerCalls(planted, codeOf(`// ${unclassified}`))).toEqual([])
    const shorthand = cat('db.updat', 'eRun(id, {\n  status,\n  endedAt,\n})\n')
    expect(writerCalls(planted, codeOf(shorthand))).toHaveLength(1)
    expect(writerCalls(planted, codeOf(cat('db.updat', 'eRun(id, { errorLog })\n')))).toEqual([])
    expect(writerCalls(planted, codeOf(cat('db.updat', 'eRun(id, { previous: run.status })\n'))))
      .toEqual([])
    const gone = real.filter((site) => !(site.file === SERVER && site.call === 'finalizeOrphanRun'))
    expect(classificationDiff(gone, WRITERS))
      .toEqual([`stale: ${SERVER} finalizeOrphanRun (found 0, listed 1)`])
  })

  it('C442-SELF-MATCH: this file spells none of the needles it assembles, and lies outside every region it scans', () => {
    const own = readFileSync(THIS_FILE).toString('utf8')
    expect(existsSync(join(PACKAGES_DIR, OWN)), 'the self path is wrong').toBe(true)
    const spelled = [RUN_LIST, RUNS_UPDATE_TEXT].map(joined)
      .filter((needle) => own.toLowerCase().includes(needle.toLowerCase()))
    expect(spelled, `this file spells what it reads: ${spelled.join(', ')}`).toEqual([])
    expect(sweepOffenses(OWN, codeOf(own))).toEqual([])
    expect(writerCalls(OWN, codeOf(own))).toEqual([])
    const files = scanned(REGIONS)
    expect(files, 'this census file is inside a region it scans').not.toContain(OWN)
    const tests = files.filter((file) => file.includes('/__tests__/'))
    expect(tests, 'a test file was scanned').toEqual([])
    expect(files.filter((file) => file.includes('/dist/')), 'a built file was scanned').toEqual([])
  })
})
