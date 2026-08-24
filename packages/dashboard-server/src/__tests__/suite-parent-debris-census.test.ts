/**
 * THE SUITE-PARENT / CHILD-RUN DEBRIS CENSUS (402-09, D-11).
 *
 * D-11, owner verbatim: "remove everything that's not required. Better to cleanup now than
 * maintain tumors." What counts as REQUIRED is decided by this census, not by judgment — the only
 * survivors are reads today's run-list / run-detail UI genuinely serves for HISTORICAL rows before
 * 405, and anything the one-run model leaves producer-less goes too.
 *
 * TWO PREDICATES THAT FAIL FOR DIFFERENT REASONS. This phase has already defeated four instrument
 * shapes: a symbol grep satisfied by an import line (402-01, 402-03), a source assertion satisfied
 * by its own file (402-07 / WINDOWS #253, 402-08 / #257), a fold from a DECLARED binding rather
 * than from what answered (402-07 / #251), and a behavioural differential blind to a byte-identical
 * private copy (402-08 / #257). Two greps with different regexes would be a fifth. So:
 *
 *   PREDICATE A — LEXICAL. Reads source TEXT. Discovers its own file universe by walking
 *   `packages/<pkg>/src` for every package that has one; never a pinned file list. Sees a token in
 *   a comment, sees a renamed-file copy, sees a type literal. Blind to a symbol that was RENAMED
 *   and to behaviour.
 *
 *   PREDICATE B — STRUCTURAL. Reads no source text at all. Discovers link-reading members by a
 *   RUNTIME DIFFERENTIAL: two byte-identically seeded databases that differ in exactly one fact —
 *   whether the child row's `parent_run_id` points at the parent — walked over the WHOLE
 *   `DashboardDatabase` and `JobQueue` prototypes and driven through the run route corpus. A member
 *   whose observable output or database effect differs between the two reads the parent link, under
 *   any name, in any file, however it is spelled. Blind to comments and to dead type breadth.
 *
 * Neither predicate can be satisfied by the other's evidence, and the register below is the ONE
 * vocabulary they are reconciled through: every site A discovers and every surface B discovers must
 * appear in it with a disposition.
 *
 * THE REGISTER IS FROZEN, NOT GENERATED. It is a hand-authored literal reviewed against
 * `DELETION-INVENTORY.md`; the predicates measure the tree AGAINST it. A register recomputed from
 * its own scan output is the self-certifying guard 401-10 warned about and can never fail.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { IncomingMessage, type ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { RunEventEnvelope, RunEventType } from '@vostride/agent-qa-schema'
import type { SuiteFileManager } from '../tests/suite-file-manager.js'
import { DashboardDatabase } from '../db/database.js'
import { JobQueue } from '../queue/job-queue.js'
import { createDashboardRunIngest } from '../reporter/dashboard-subscriber.js'
import { createRouter } from '../server/routes.js'

const HERE = dirname(fileURLToPath(import.meta.url))
/** `packages/dashboard-server/src/__tests__` -> the `agent-qa` submodule root. */
const REPO_ROOT = join(HERE, '..', '..', '..', '..')
const PACKAGES_DIR = join(REPO_ROOT, 'packages')

// ---------------------------------------------------------------------------------------------
// PREDICATE A — the lexical census
// ---------------------------------------------------------------------------------------------

/**
 * The debris vocabulary. `getRunsByParent` / `cancelChildRuns` are the two named members of the
 * suite-parent DB modeling; `suite-parent` / `suite-child` are the two `RunArtifactKind` values
 * only that modeling ever minted.
 *
 * `parentRunId` / `parent_run_id` are deliberately NOT tokens here. The COLUMN is retained
 * wholesale (see DELETION-INVENTORY.md): every `parent_run_id IS NULL` filter in the db module is a
 * top-level-run predicate that keeps working unchanged when nothing writes the column, and the
 * legacy `/api/execution/events` projection (`dashboard-ui/src/lib/live-timeline.ts`) carries
 * ~30 more references that 405 rebuilds. Scanning for it would produce a large all-keep set with no
 * discriminating power. Its SEMANTICS — who reads the link, who writes it — is exactly what
 * predicate B measures behaviourally, which is the sharper instrument for a column.
 */
export const DEBRIS_TOKENS = [
  'getRunsByParent',
  'cancelChildRuns',
  'suite-parent',
  'suite-child',
] as const

export interface DebrisSite {
  /** Repo-relative path. */
  readonly file: string
  readonly token: string
  /** The trimmed source line the token sits on — a site key that survives line-number drift. */
  readonly line: string
  /** How many times this exact (file, token, line) triple occurs today. */
  readonly before: number
  /** How many times it must occur after the D-11 deletion. */
  readonly after: number
  readonly disposition: 'keep' | 'delete'
  readonly why: string
}

const KEEP_RETAINED_UNION =
  'RETAINED union member (396-01 D-10 precedent): existing run_artifacts rows carry these kinds '
  + 'and must keep parsing. Deleting the value orphans every historical row.'

const KEEP_HISTORICAL_READ =
  'Historical-row read. The one-run model produces no new children, but operator databases hold '
  + 'rows written before 402 and the pre-405 run list / run detail must keep rendering them.'

export const DEBRIS_REGISTER: readonly DebrisSite[] = [
  // ---- cli ----------------------------------------------------------------------------------
  {
    file: 'packages/cli/src/commands/run.ts',
    token: 'getRunsByParent',
    line: 'const children = activeSuiteDb.getRunsByParent(run.id)',
    before: 1,
    after: 0,
    disposition: 'delete',
    why: 'CLI SIGINT child-cancellation fan-out. Under the one-run model the suite run IS the row '
      + 'the sweep already cancels; there are no children to fan out to.',
  },
  {
    file: 'packages/cli/src/commands/run.ts',
    token: 'suite-parent',
    line: "kind: 'suite-parent',",
    before: 1,
    after: 0,
    disposition: 'delete',
    why: 'The CLI-side parent-kind mint on the suite run artifact document. A kind claiming '
      + 'parenthood over rows nothing creates is exactly the label D-11 forbids.',
  },
  {
    file: 'packages/cli/src/commands/run.ts',
    token: 'suite-parent',
    line: "kind: 'test' | 'suite-parent' | 'suite-child'",
    before: 1,
    after: 0,
    disposition: 'delete',
    why: 'Local parameter breadth on buildRunArtifactContext. With the mint gone both call sites '
      + "pass 'test'; the surviving arms are unreachable breadth, not the retained schema union.",
  },
  {
    file: 'packages/cli/src/commands/run.ts',
    token: 'suite-child',
    line: "kind: 'test' | 'suite-parent' | 'suite-child'",
    before: 1,
    after: 0,
    disposition: 'delete',
    why: 'Same local parameter breadth (the suite-child arm of the same literal).',
  },
  {
    file: 'packages/cli/src/commands/run.ts',
    token: 'suite-parent',
    line: "}): { artifact: Record<string, unknown> & { kind: 'test' | 'suite-parent' | 'suite-child' } } {",
    before: 1,
    after: 0,
    disposition: 'delete',
    why: 'Local return-type breadth on buildRunArtifactContext.',
  },
  {
    file: 'packages/cli/src/commands/run.ts',
    token: 'suite-child',
    line: "}): { artifact: Record<string, unknown> & { kind: 'test' | 'suite-parent' | 'suite-child' } } {",
    before: 1,
    after: 0,
    disposition: 'delete',
    why: 'Same local return-type breadth (the suite-child arm).',
  },
  {
    file: 'packages/cli/src/commands/run.ts',
    token: 'suite-parent',
    line: "}) as { artifact: Record<string, unknown> & { kind: 'test' | 'suite-parent' | 'suite-child' } }",
    before: 1,
    after: 0,
    disposition: 'delete',
    why: 'Local cast breadth on buildRunArtifactContext.',
  },
  {
    file: 'packages/cli/src/commands/run.ts',
    token: 'suite-child',
    line: "}) as { artifact: Record<string, unknown> & { kind: 'test' | 'suite-parent' | 'suite-child' } }",
    before: 1,
    after: 0,
    disposition: 'delete',
    why: 'Same local cast breadth (the suite-child arm).',
  },
  {
    file: 'packages/cli/src/commands/run.ts',
    token: 'suite-parent',
    line: "// single-test analog of Plan 10's suite-parent parallel drop under the one-RunSession law).",
    before: 1,
    after: 1,
    disposition: 'keep',
    why: 'Historical prose. A comment naming a retirement that already happened is a record, not a '
      + 'producer; deleting it would erase the reason a later reader needs.',
  },

  // ---- dashboard-server: queue -----------------------------------------------------------------
  {
    file: 'packages/dashboard-server/src/queue/job-queue.ts',
    token: 'cancelChildRuns',
    line: 'private cancelChildRuns(parentRunId: string, endedAt: string): void {',
    before: 1,
    after: 0,
    disposition: 'delete',
    why: 'The child-run cancellation fan-out named in D-11.',
  },
  {
    file: 'packages/dashboard-server/src/queue/job-queue.ts',
    token: 'cancelChildRuns',
    line: 'this.cancelChildRuns(runId, now)',
    before: 2,
    after: 0,
    disposition: 'delete',
    why: 'Both call sites of the fan-out (pending-cancel and running-cancel arms).',
  },
  {
    file: 'packages/dashboard-server/src/queue/job-queue.ts',
    token: 'getRunsByParent',
    line: 'for (const child of this.db.getRunsByParent(parentRunId)) {',
    before: 1,
    after: 0,
    disposition: 'delete',
    why: 'The fan-out body; goes with the method.',
  },

  // ---- dashboard-server: reporter --------------------------------------------------------------
  {
    file: 'packages/dashboard-server/src/reporter/dashboard-subscriber.ts',
    token: 'suite-parent',
    line: "const kind: RunArtifactKind = mode === 'suite' ? 'suite-parent' : 'test'",
    before: 1,
    after: 0,
    disposition: 'delete',
    why: 'The ingest parent-kind mint. This module is the LIVE producer of new parent/child run '
      + 'records — the dashboard suite door still reaches it — so the truth "no producer survives" '
      + 'is false while it stands.',
  },
  {
    file: 'packages/dashboard-server/src/reporter/dashboard-subscriber.ts',
    token: 'suite-child',
    line: "insertArtifact(id, 'suite-child')",
    before: 1,
    after: 0,
    disposition: 'delete',
    why: 'The ingest child-row artifact mint, written per suite member alongside a run row carrying '
      + 'parent_run_id. Deleted with the suite ingest mode itself.',
  },

  // ---- dashboard-server: routes ----------------------------------------------------------------
  {
    file: 'packages/dashboard-server/src/server/routes.ts',
    token: 'suite-parent',
    line: "kind: isSuiteFile ? 'suite-parent' : 'test',",
    before: 1,
    after: 0,
    disposition: 'delete',
    why: 'The parent-kind mint on POST /api/queue/enqueue named in D-11.',
  },
  {
    file: 'packages/dashboard-server/src/server/routes.ts',
    token: 'suite-parent',
    line: "kind: isSuite ? 'suite-parent' : 'test',",
    before: 1,
    after: 0,
    disposition: 'delete',
    why: 'The same mint on POST /api/runs/trigger — the door the dashboard UI actually uses.',
  },
  {
    file: 'packages/dashboard-server/src/server/routes.ts',
    token: 'getRunsByParent',
    line: "'getRunsByParent',",
    before: 1,
    after: 1,
    disposition: 'keep',
    why: 'RESPONSE_SAFE_RUN_READ_METHODS membership. The 401-23 allowlist asserts SET EQUALITY with '
      + 'the database\'s run reads at construction; dropping the name while the method survives '
      + 'throws at router build.',
  },
  {
    file: 'packages/dashboard-server/src/server/routes.ts',
    token: 'getRunsByParent',
    line: 'getRunsByParent: { value: (parentRunId: string) => scrubRows(db.getRunsByParent(parentRunId)) },',
    before: 1,
    after: 1,
    disposition: 'keep',
    why: 'The metadata-scrubbing override for the same read. A surviving read that lost its scrub '
      + 'would leak server-derived run metadata (401-23).',
  },
  {
    file: 'packages/dashboard-server/src/server/routes.ts',
    token: 'getRunsByParent',
    line: 'const tests = db.getRunsByParent(run.id).map(test => enrichRunRow(test, targetPlatforms))',
    before: 1,
    after: 1,
    disposition: 'keep',
    why: `GET /api/runs — the run-LIST read. ${KEEP_HISTORICAL_READ}`,
  },
  {
    file: 'packages/dashboard-server/src/server/routes.ts',
    token: 'getRunsByParent',
    line: 'const childRuns = db.getRunsByParent(id)',
    before: 1,
    after: 1,
    disposition: 'keep',
    why: `GET /api/runs/:id/execution-logs aggregates a historical suite's member logs. ${KEEP_HISTORICAL_READ}`,
  },
  {
    file: 'packages/dashboard-server/src/server/routes.ts',
    token: 'getRunsByParent',
    line: 'const attempts = db.getRunsByParent(id)',
    before: 1,
    after: 1,
    disposition: 'keep',
    why: `GET /api/runs/:id — the run-DETAIL read. ${KEEP_HISTORICAL_READ}`,
  },
  {
    file: 'packages/dashboard-server/src/server/routes.ts',
    token: 'getRunsByParent',
    line: 'const tests = db.getRunsByParent(id)',
    before: 1,
    after: 1,
    disposition: 'keep',
    why: `GET /api/runs/:id member list for a historical suite parent. ${KEEP_HISTORICAL_READ}`,
  },

  // ---- dashboard-server: server ----------------------------------------------------------------
  {
    file: 'packages/dashboard-server/src/server/server.ts',
    token: 'getRunsByParent',
    line: 'const children = db.getRunsByParent(runId)',
    before: 1,
    after: 0,
    disposition: 'delete',
    why: 'Run-close suite fold: derives the parent row\'s status from its children. With no child '
      + 'producer this can only ever read an empty list, so it is dead code reading as live policy '
      + '— the same shape 401-07 retired for retry children at this exact site.',
  },
  {
    file: 'packages/dashboard-server/src/server/server.ts',
    token: 'getRunsByParent',
    line: 'const updatedChildren = db.getRunsByParent(runId)',
    before: 1,
    after: 0,
    disposition: 'delete',
    why: 'The second half of the same fold (re-read after forcing incomplete children).',
  },
  {
    file: 'packages/dashboard-server/src/server/server.ts',
    token: 'getRunsByParent',
    line: 'const children = db.getRunsByParent(run.id)',
    before: 1,
    after: 0,
    disposition: 'delete',
    why: 'Startup orphan-cleanup skip: leaves a suite parent stuck in `running` when a child still '
      + 'reads `running`. After a restart nothing is running, and with no child producer the skip '
      + 'can only strand historical rows in a state no process will ever finish.',
  },

  // ---- retained storage + type surface ---------------------------------------------------------
  {
    file: 'packages/dashboard-server/src/db/database.ts',
    token: 'getRunsByParent',
    line: 'getRunsByParent(parentRunId: string): RunRow[] {',
    before: 1,
    after: 1,
    disposition: 'keep',
    why: `The declaration of the historical read the run list and run detail serve. ${KEEP_HISTORICAL_READ}`,
  },
  {
    file: 'packages/dashboard-server/src/db/database.ts',
    token: 'getRunsByParent',
    line: 'const children = this.getRunsByParent(runId).map((run) => ({',
    before: 1,
    after: 1,
    disposition: 'keep',
    why: `getRunArtifactBundle's child section, served by GET /api/runs/:id/artifact. ${KEEP_HISTORICAL_READ}`,
  },
  {
    file: 'packages/dashboard-server/src/db/schema.ts',
    token: 'suite-parent',
    line: "kind TEXT NOT NULL CHECK(kind IN ('test', 'suite-parent', 'suite-child', 'unknown')),",
    before: 1,
    after: 1,
    disposition: 'keep',
    why: `${KEEP_RETAINED_UNION} Narrowing the CHECK would additionally require a table rebuild `
      + 'migration on every operator database.',
  },
  {
    file: 'packages/dashboard-server/src/db/schema.ts',
    token: 'suite-child',
    line: "kind TEXT NOT NULL CHECK(kind IN ('test', 'suite-parent', 'suite-child', 'unknown')),",
    before: 1,
    after: 1,
    disposition: 'keep',
    why: 'Same CHECK constraint (the suite-child arm).',
  },
  {
    file: 'packages/dashboard-ui/src/lib/api.ts',
    token: 'suite-parent',
    line: "export type RunArtifactKind = 'test' | 'suite-parent' | 'suite-child' | 'unknown'",
    before: 1,
    after: 1,
    disposition: 'keep',
    why: `${KEEP_RETAINED_UNION} The UI renders this value verbatim as the artifact badge, so a `
      + 'historical row whose kind the type does not admit stops type-checking at the render site.',
  },
  {
    file: 'packages/dashboard-ui/src/lib/api.ts',
    token: 'suite-child',
    line: "export type RunArtifactKind = 'test' | 'suite-parent' | 'suite-child' | 'unknown'",
    before: 1,
    after: 1,
    disposition: 'keep',
    why: 'Same UI-side union (the suite-child arm).',
  },
  {
    file: 'packages/schema/src/run/run-artifact.ts',
    token: 'suite-parent',
    line: "export type RunArtifactKind = 'test' | 'suite-parent' | 'suite-child' | 'unknown'",
    before: 1,
    after: 1,
    disposition: 'keep',
    why: `${KEEP_RETAINED_UNION} This is the canonical union; the D-11 ruling deletes the PRODUCERS `
      + 'of the value, not the value.',
  },
  {
    file: 'packages/schema/src/run/run-artifact.ts',
    token: 'suite-child',
    line: "export type RunArtifactKind = 'test' | 'suite-parent' | 'suite-child' | 'unknown'",
    before: 1,
    after: 1,
    disposition: 'keep',
    why: 'Same canonical union (the suite-child arm).',
  },
]

function siteKey(site: { file: string; token: string; line: string }): string {
  return `${site.file} ${site.token} ${site.line}`
}

/** Every directory name the scan refuses to descend into, with the reason it is refused. */
const SCAN_EXCLUDED_DIRS: ReadonlyMap<string, string> = new Map([
  ['dist', 'build output — a copy of the sources already scanned'],
  ['node_modules', 'third-party code this project does not own'],
  ['__tests__', 'test fixtures legitimately seed historical parent/child rows (see the exclusion '
    + 'control below, which proves this region is where the excluded matches live)'],
])

function collectSourceFiles(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (SCAN_EXCLUDED_DIRS.has(entry.name)) continue
      collectSourceFiles(full, out)
      continue
    }
    if (!/\.tsx?$/.test(entry.name)) continue
    if (/\.test\.tsx?$/.test(entry.name)) continue
    out.push(full)
  }
}

/** The packages that have a `src` directory, discovered from disk — never a pinned list. */
function discoverSourceRoots(): Array<{ pkg: string; dir: string }> {
  const roots: Array<{ pkg: string; dir: string }> = []
  for (const pkg of readdirSync(PACKAGES_DIR)) {
    const dir = join(PACKAGES_DIR, pkg, 'src')
    try {
      if (statSync(dir).isDirectory()) roots.push({ pkg, dir })
    } catch { /* a package without src contributes nothing */ }
  }
  return roots
}

function scanFileUniverse(): string[] {
  const files: string[] = []
  for (const root of discoverSourceRoots()) collectSourceFiles(root.dir, files)
  return files
}

interface ScannedSite { file: string; token: string; line: string }

function extractSites(relPath: string, contents: string): ScannedSite[] {
  const found: ScannedSite[] = []
  for (const line of contents.split('\n')) {
    for (const token of DEBRIS_TOKENS) {
      if (line.includes(token)) found.push({ file: relPath, token, line: line.trim() })
    }
  }
  return found
}

function scanDebrisSites(files: string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const file of files) {
    const rel = relative(REPO_ROOT, file).split(sep).join('/')
    for (const site of extractSites(rel, readFileSync(file, 'utf8'))) {
      const key = siteKey(site)
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  return counts
}

function registerCounts(phase: 'before' | 'after'): Map<string, number> {
  const counts = new Map<string, number>()
  for (const entry of DEBRIS_REGISTER) {
    const n = phase === 'before' ? entry.before : entry.after
    if (n === 0) continue
    counts.set(siteKey(entry), n)
  }
  return counts
}

function describeCounts(counts: Map<string, number>): string[] {
  return [...counts.entries()]
    .map(([key, n]) => `${n}x ${key.split(' ').join(' | ')}`)
    .sort()
}

// ---------------------------------------------------------------------------------------------
// PREDICATE B — the structural surface walk
// ---------------------------------------------------------------------------------------------

const PARENT_ID = 'r_parent-alpha-bravo-charlie-delta-echo-foxtrot-golf-hotel-india'
const CHILD_A = 'r_childa-alpha-bravo-charlie-delta-echo-foxtrot-golf-hotel-india'
const CHILD_B = 'r_childb-alpha-bravo-charlie-delta-echo-foxtrot-golf-hotel-india'
const SUITE_ID = 's_suite-alpha-bravo-charlie-delta-echo-foxtrot-golf-hotel-india'

/**
 * Two databases identical in every byte except the one fact under test: whether the two member rows
 * point at the parent through `parent_run_id`. Everything else — ids, names, statuses, timestamps,
 * suite ids, steps, artifacts — is written from the same literals in the same order.
 */
function seedPair(): { linked: DashboardDatabase; unlinked: DashboardDatabase } {
  const build = (linked: boolean): DashboardDatabase => {
    const db = new DashboardDatabase({ dbPath: ':memory:' })
    db.insertRun({
      id: PARENT_ID,
      name: 'Checkout Suite',
      filePath: 'suites/checkout.suite.yaml',
      status: 'running',
      duration: 0,
      startedAt: '2026-08-01T00:00:00.000Z',
      endedAt: '2026-08-01T00:00:00.000Z',
      suiteId: SUITE_ID,
    })
    db.insertRunArtifact({ runId: PARENT_ID, kind: 'suite-parent' })
    for (const childId of [CHILD_A, CHILD_B]) {
      db.insertRun({
        id: childId,
        name: `Member ${childId === CHILD_A ? 'A' : 'B'}`,
        filePath: 'tests/member.yaml',
        status: 'running',
        duration: 0,
        startedAt: '2026-08-01T00:00:01.000Z',
        endedAt: '2026-08-01T00:00:01.000Z',
        suiteId: SUITE_ID,
        ...(linked ? { parentRunId: PARENT_ID } : {}),
      })
      db.insertRunArtifact({ runId: childId, kind: 'suite-child' })
      db.insertStep({
        runId: childId,
        name: 'open the page',
        status: 'passed',
        duration: 10,
        stepOrder: 0,
      })
      db.insertExecutionLog({
        id: `log-${childId}`,
        runId: childId,
        type: 'hook',
        name: 'setup',
        phase: 'setup',
        status: 'passed',
        duration: 1,
      })
    }
    return db
  }
  return { linked: build(true), unlinked: build(false) }
}

/**
 * Drops the one fact the two seeded databases differ by, plus every clock-derived field, so a
 * difference the differential reports is a difference in what the member DID with the link.
 */
function normalizeObservation(value: unknown): string {
  const seen = new WeakSet<object>()
  return JSON.stringify(value, (key, val) => {
    if (key === 'parentRunId' || key === 'parent_run_id') return undefined
    if (/at$/i.test(key)) return undefined
    if (typeof val === 'object' && val !== null) {
      if (seen.has(val as object)) return '[circular]'
      seen.add(val as object)
    }
    if (typeof val === 'bigint') return val.toString()
    if (typeof val === 'function') return '[function]'
    return val
  }) ?? 'undefined'
}

function runsSnapshot(db: DashboardDatabase): string {
  const rows = (db as unknown as { db: { prepare(sql: string): { all(): unknown[] } } }).db
    .prepare('SELECT * FROM runs ORDER BY id')
    .all()
  const artifacts = (db as unknown as { db: { prepare(sql: string): { all(): unknown[] } } }).db
    .prepare('SELECT run_id, kind FROM run_artifacts ORDER BY run_id')
    .all()
  return normalizeObservation({ rows, artifacts })
}

function invokeSafely(fn: () => unknown): unknown {
  try {
    const out = fn()
    if (out instanceof Promise) return '[promise]'
    return out
  } catch (error) {
    return `[threw:${error instanceof Error ? error.name : typeof error}]`
  }
}

/** Argument tuples every walked member is offered, in order, on the same seeded pair. */
const ARG_TUPLES: readonly unknown[][] = [
  [PARENT_ID],
  [SUITE_ID],
  ['Member A'],
  [],
  [{}],
  [{ suiteId: SUITE_ID }],
  ['suite', {}],
  [PARENT_ID, {}],
]

/**
 * Members skipped by the walk, with the reason. Both would break the walk itself rather than tell
 * it anything: `close` tears down the database the remaining tuples run against, and `start` arms a
 * polling interval that would outlive the test.
 */
const WALK_SKIPPED = new Set(['constructor', 'close', 'start'])

function walkPrototype(
  ctor: { prototype: object },
  instantiate: (db: DashboardDatabase) => object,
): string[] {
  const discovered: string[] = []
  for (const name of Object.getOwnPropertyNames(ctor.prototype)) {
    if (WALK_SKIPPED.has(name)) continue
    const descriptor = Object.getOwnPropertyDescriptor(ctor.prototype, name)
    if (typeof descriptor?.value !== 'function') continue

    const { linked, unlinked } = seedPair()
    try {
      const linkedTarget = instantiate(linked) as Record<string, unknown>
      const unlinkedTarget = instantiate(unlinked) as Record<string, unknown>
      const observations: string[] = []
      for (const args of ARG_TUPLES) {
        const l = invokeSafely(() => (linkedTarget[name] as (...a: unknown[]) => unknown)(...args))
        const u = invokeSafely(() => (unlinkedTarget[name] as (...a: unknown[]) => unknown)(...args))
        observations.push(
          `${normalizeObservation(l)}::${normalizeObservation(u)}`,
          `${runsSnapshot(linked)}::${runsSnapshot(unlinked)}`,
        )
      }
      const differs = observations.some((pair) => {
        const [a, b] = pair.split('::')
        return a !== b
      })
      if (differs) discovered.push(name)
    } finally {
      linked.close()
      unlinked.close()
    }
  }
  return discovered.sort()
}

// --- routes -----------------------------------------------------------------------------------

interface ProbeResponse { status: number; body: string }

function suiteFileManagerStub(): SuiteFileManager {
  return {
    resolvePath: (filePath: string) => ({ storagePath: filePath, executionPath: filePath }),
    read: async () => 'name: Checkout Suite\ntests: []\n',
  } as unknown as SuiteFileManager
}

function buildRouter(db: DashboardDatabase): ReturnType<typeof createRouter> {
  const jobQueue = new JobQueue({ db, concurrency: 1 })
  return createRouter({
    db,
    jobQueue,
    suiteFileManager: suiteFileManagerStub(),
  } as unknown as Parameters<typeof createRouter>[0])
}

async function probeRoute(
  router: ReturnType<typeof createRouter>,
  url: string,
  options: { method?: string; body?: string } = {},
): Promise<ProbeResponse> {
  return await new Promise<ProbeResponse>((resolve) => {
    const req = new IncomingMessage(new Socket())
    req.method = options.method ?? 'GET'
    req.url = url
    req.headers = options.body === undefined ? {} : { 'content-type': 'application/json' }
    process.nextTick(() => {
      if (options.body !== undefined) req.push(Buffer.from(options.body))
      req.push(null)
    })

    let status = 200
    let body = ''
    let settled = false
    const settle = (): void => {
      if (settled) return
      settled = true
      resolve({ status, body })
    }
    const timer = setTimeout(() => { status = -1; body = '[no response]'; settle() }, 5_000)
    timer.unref?.()

    const res = {
      writeHead(code: number) { status = code; return this },
      setHeader() { /* headers are not part of the differential */ },
      getHeader() { return undefined },
      write(chunk: string | Buffer) {
        body += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk
        return true
      },
      end(chunk?: string | Buffer) {
        if (chunk) body += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk
        clearTimeout(timer)
        settle()
      },
      on() { return this },
      once() { return this },
      removeListener() { return this },
      get writableEnded() { return settled },
    } as unknown as ServerResponse

    try {
      router(req, res)
    } catch (error) {
      status = -2
      body = `[threw:${error instanceof Error ? error.name : typeof error}]`
      clearTimeout(timer)
      settle()
    }
  })
}

/**
 * The run routes the census drives. DECLARED, and honestly so: the router is a long if-chain with
 * no enumerable route table, so this corpus is the one part of predicate B that is not discovered.
 * Two things keep it from being the fold-from-a-declaration failure 402-07 measured — `routes.ts`
 * issues no SQL of its own (every parent-link read it can make goes through the database surface
 * the walk above enumerates TOTALLY), and the non-vacuity cell below requires the corpus to contain
 * routes that actually differ.
 */
const ROUTE_CORPUS: ReadonlyArray<{ id: string; url: string; method?: string; body?: string }> = [
  { id: 'GET /api/runs', url: '/api/runs' },
  { id: 'GET /api/runs/:id', url: `/api/runs/${PARENT_ID}` },
  { id: 'GET /api/runs/:id/artifact', url: `/api/runs/${PARENT_ID}/artifact` },
  { id: 'GET /api/runs/:id/execution-logs', url: `/api/runs/${PARENT_ID}/execution-logs` },
  { id: 'GET /api/runs/:id/logs', url: `/api/runs/${PARENT_ID}/logs` },
  { id: 'GET /api/runs/:id/steps', url: `/api/runs/${PARENT_ID}/steps` },
  { id: 'POST /api/runs/:id/cancel', url: `/api/runs/${PARENT_ID}/cancel`, method: 'POST', body: '{}' },
  { id: 'DELETE /api/runs/:id', url: `/api/runs/${PARENT_ID}`, method: 'DELETE' },
]

async function walkRouteCorpus(): Promise<string[]> {
  const discovered: string[] = []
  for (const route of ROUTE_CORPUS) {
    const { linked, unlinked } = seedPair()
    try {
      const l = await probeRoute(buildRouter(linked), route.url, route)
      const u = await probeRoute(buildRouter(unlinked), route.url, route)
      const observedL = `${l.status}|${normalizeObservation(safeParse(l.body))}|${runsSnapshot(linked)}`
      const observedU = `${u.status}|${normalizeObservation(safeParse(u.body))}|${runsSnapshot(unlinked)}`
      if (observedL !== observedU) discovered.push(route.id)
    } finally {
      linked.close()
      unlinked.close()
    }
  }
  return discovered.sort()
}

function safeParse(body: string): unknown {
  try { return JSON.parse(body) } catch { return body }
}

// --- production channels ------------------------------------------------------------------------

function envelope(runId: string, type: RunEventType, payload: Record<string, unknown> = {}, seq = 1): RunEventEnvelope {
  return { seq, ts: seq, runId, type, payload } as RunEventEnvelope
}

/**
 * Every channel through which this process can create a run record today. A channel counts as a
 * PRODUCER when, driven against an empty database, it leaves behind a run row carrying a non-null
 * `parent_run_id` or a run artifact of a parent/child kind.
 *
 * `JobQueue.enqueue` is deliberately absent: it stores whatever `kind` its caller hands it, so the
 * mint lives at the CALLERS (the two routes below), which is what this probes. A future caller
 * passing a parent kind would be caught by predicate A instead — the two predicates cover each
 * other here, which is the point of having two.
 */
const PRODUCTION_CHANNELS: ReadonlyArray<{ id: string; drive: (db: DashboardDatabase) => Promise<void> }> = [
  {
    id: 'route:POST /api/queue/enqueue (suite file)',
    drive: async (db) => {
      await probeRoute(buildRouter(db), '/api/queue/enqueue', {
        method: 'POST',
        body: JSON.stringify({ name: 'Checkout Suite', file: 'suites/checkout.suite.yaml' }),
      })
    },
  },
  {
    id: 'route:POST /api/runs/trigger (suite file)',
    drive: async (db) => {
      await probeRoute(buildRouter(db), '/api/runs/trigger', {
        method: 'POST',
        body: JSON.stringify({ file: 'suites/checkout.suite.yaml' }),
      })
    },
  },
  {
    id: 'ingest:createDashboardRunIngest suite correlation',
    drive: async (db) => {
      const ingest = createDashboardRunIngest({
        db,
        correlationEnv: { suiteQueueId: PARENT_ID },
        sourceSnapshot: { kind: 'suite', name: 'Checkout Suite', suiteId: SUITE_ID },
        now: () => '2026-08-01T00:00:00.000Z',
      })
      ingest.handler(envelope('bus-1', 'runStarted', { memberTestCount: 2 }, 1))
      ingest.handler(envelope('bus-1', 'testStarted', { testIndex: 0, name: 'Member A' }, 2))
      ingest.handler(envelope('bus-1', 'testStarted', { testIndex: 1, name: 'Member B' }, 3))
      ingest.handler(envelope('bus-1', 'testFinished', { testIndex: 0, outcome: 'passed' }, 4))
      ingest.handler(envelope('bus-1', 'runFinished', { aggregateVerdict: 'passed', finalSeq: 5 }, 5))
    },
  },
  {
    id: 'ingest:createDashboardRunIngest retry correlation',
    drive: async (db) => {
      const ingest = createDashboardRunIngest({
        db,
        correlationEnv: { parentRunId: PARENT_ID, runId: CHILD_A, attemptNumber: 2 } as never,
        sourceSnapshot: { kind: 'test', name: 'Member A' },
        now: () => '2026-08-01T00:00:00.000Z',
      })
      ingest.handler(envelope('bus-2', 'runStarted', { memberTestCount: 1 }, 1))
      ingest.handler(envelope('bus-2', 'testStarted', { testIndex: 0, name: 'Member A' }, 2))
      ingest.handler(envelope('bus-2', 'runFinished', { aggregateVerdict: 'passed', finalSeq: 3 }, 3))
    },
  },
]

interface ProducerFinding { channel: string; linkedRows: number; parentKinds: string[] }

async function walkProductionChannels(): Promise<ProducerFinding[]> {
  const findings: ProducerFinding[] = []
  for (const channel of PRODUCTION_CHANNELS) {
    const db = new DashboardDatabase({ dbPath: ':memory:' })
    try {
      await channel.drive(db)
      const raw = db as unknown as { db: { prepare(sql: string): { all(...a: unknown[]): unknown[] } } }
      const linkedRows = (raw.db
        .prepare('SELECT id FROM runs WHERE parent_run_id IS NOT NULL')
        .all() as unknown[]).length
      const parentKinds = (raw.db
        .prepare("SELECT kind FROM run_artifacts WHERE kind IN ('suite-parent','suite-child')")
        .all() as Array<{ kind: string }>).map((r) => r.kind).sort()
      if (linkedRows > 0 || parentKinds.length > 0) {
        findings.push({ channel: channel.id, linkedRows, parentKinds })
      }
    } finally {
      db.close()
    }
  }
  return findings
}

// ---------------------------------------------------------------------------------------------
// The register's surface vocabulary — where predicates A and B are reconciled
// ---------------------------------------------------------------------------------------------

export interface DebrisSurface {
  readonly id: string
  readonly kind: 'producer' | 'reader'
  readonly disposition: 'keep' | 'delete'
  /** Register site keys (file|token|line) this surface is implemented by. */
  readonly sites: readonly string[]
  readonly why: string
}

const S = (file: string, token: string, line: string): string => siteKey({ file, token, line })

const TOP_LEVEL_RUN_FILTER = 'A `parent_run_id IS NULL` top-level-run filter in raw SQL. Predicate A is structurally blind to these — they name no debris token — and predicate B found all ten by differential. KEEP, and required: a child row admitted as a top-level run would double-count every historical suite in the list, the counts and the trend series.'

const ROUTES = 'packages/dashboard-server/src/server/routes.ts'
const DATABASE = 'packages/dashboard-server/src/db/database.ts'
const SUBSCRIBER = 'packages/dashboard-server/src/reporter/dashboard-subscriber.ts'
const QUEUE = 'packages/dashboard-server/src/queue/job-queue.ts'

export const DEBRIS_SURFACES: readonly DebrisSurface[] = [
  {
    id: 'db:getRunsByParent',
    kind: 'reader',
    disposition: 'keep',
    sites: [S(DATABASE, 'getRunsByParent', 'getRunsByParent(parentRunId: string): RunRow[] {')],
    why: KEEP_HISTORICAL_READ,
  },
  {
    id: 'db:getRunArtifactBundle',
    kind: 'reader',
    disposition: 'keep',
    sites: [S(DATABASE, 'getRunsByParent', 'const children = this.getRunsByParent(runId).map((run) => ({')],
    why: `${KEEP_HISTORICAL_READ} Served by GET /api/runs/:id/artifact.`,
  },
  {
    id: 'db:deleteRun',
    kind: 'reader',
    disposition: 'keep',
    sites: [],
    why: 'The recursive `run_tree` cascade. Deleting a historical suite parent must still delete '
      + 'its members, or the rows this census orphans become undeletable through the UI. Reads the '
      + 'link in raw SQL, which is why predicate A never saw it and predicate B did.',
  },
  {
    id: 'db:getRuns',
    kind: 'reader',
    disposition: 'keep',
    sites: [],
    why: 'The run-list query itself: `parent_run_id IS NULL` is its first condition. '
      + TOP_LEVEL_RUN_FILTER,
  },
  {
    id: 'db:getRunsBySuiteId',
    kind: 'reader',
    disposition: 'keep',
    sites: [],
    why: 'Suite drill-down listing. '
      + TOP_LEVEL_RUN_FILTER,
  },
  {
    id: 'db:getRunsBySuiteIdCount',
    kind: 'reader',
    disposition: 'keep',
    sites: [],
    why: 'The paging total for the same listing. '
      + TOP_LEVEL_RUN_FILTER,
  },
  {
    id: 'db:getRunsByTestName',
    kind: 'reader',
    disposition: 'keep',
    sites: [],
    why: 'Test-history listing. '
      + TOP_LEVEL_RUN_FILTER,
  },
  {
    id: 'db:getRunsByTestNameCount',
    kind: 'reader',
    disposition: 'keep',
    sites: [],
    why: 'The paging total for the same listing. '
      + TOP_LEVEL_RUN_FILTER,
  },
  {
    id: 'db:getStats',
    kind: 'reader',
    disposition: 'keep',
    sites: [],
    why: 'Dashboard headline counters. '
      + TOP_LEVEL_RUN_FILTER,
  },
  {
    id: 'db:getSuiteTrends',
    kind: 'reader',
    disposition: 'keep',
    sites: [],
    why: 'Suite trend series. '
      + TOP_LEVEL_RUN_FILTER,
  },
  {
    id: 'db:getTestTrends',
    kind: 'reader',
    disposition: 'keep',
    sites: [],
    why: 'Test trend series. '
      + TOP_LEVEL_RUN_FILTER,
  },
  {
    id: 'db:getInsightsBreakdown',
    kind: 'reader',
    disposition: 'keep',
    sites: [],
    why: 'Insights breakdowns; its suite/platform dimensions split on the link. '
      + TOP_LEVEL_RUN_FILTER,
  },
  {
    id: 'db:listRunsForInsights',
    kind: 'reader',
    disposition: 'keep',
    sites: [],
    why: 'The private row source getInsightsBreakdown folds; on the prototype, so the walk reaches it directly. '
      + TOP_LEVEL_RUN_FILTER,
  },
  {
    id: 'queue:cancel',
    kind: 'reader',
    disposition: 'delete',
    sites: [
      S(QUEUE, 'cancelChildRuns', 'this.cancelChildRuns(runId, now)'),
      S(QUEUE, 'cancelChildRuns', 'private cancelChildRuns(parentRunId: string, endedAt: string): void {'),
      S(QUEUE, 'getRunsByParent', 'for (const child of this.db.getRunsByParent(parentRunId)) {'),
    ],
    why: 'The child-cancellation fan-out D-11 names. Its link-reading effect is what the queue walk '
      + 'observes; after the deletion cancelling a parent leaves historical members untouched.',
  },
  {
    id: 'route:GET /api/runs',
    kind: 'reader',
    disposition: 'keep',
    sites: [S(ROUTES, 'getRunsByParent', 'const tests = db.getRunsByParent(run.id).map(test => enrichRunRow(test, targetPlatforms))')],
    why: KEEP_HISTORICAL_READ,
  },
  {
    id: 'route:GET /api/runs/:id',
    kind: 'reader',
    disposition: 'keep',
    sites: [
      S(ROUTES, 'getRunsByParent', 'const attempts = db.getRunsByParent(id)'),
      S(ROUTES, 'getRunsByParent', 'const tests = db.getRunsByParent(id)'),
    ],
    why: KEEP_HISTORICAL_READ,
  },
  {
    id: 'route:GET /api/runs/:id/artifact',
    kind: 'reader',
    disposition: 'keep',
    sites: [],
    why: 'Serves getRunArtifactBundle, whose child section is registered above.',
  },
  {
    id: 'route:GET /api/runs/:id/execution-logs',
    kind: 'reader',
    disposition: 'keep',
    sites: [S(ROUTES, 'getRunsByParent', 'const childRuns = db.getRunsByParent(id)')],
    why: KEEP_HISTORICAL_READ,
  },
  {
    id: 'route:DELETE /api/runs/:id',
    kind: 'reader',
    disposition: 'keep',
    sites: [],
    why: 'Serves db:deleteRun and inherits its disposition.',
  },
  {
    id: 'route:POST /api/runs/:id/cancel',
    kind: 'reader',
    disposition: 'delete',
    sites: [S(QUEUE, 'cancelChildRuns', 'this.cancelChildRuns(runId, now)')],
    why: 'The HTTP door onto queue:cancel. It stays a route; what goes is its link-reading effect.',
  },
  {
    id: 'route:POST /api/queue/enqueue (suite file)',
    kind: 'producer',
    disposition: 'delete',
    sites: [S(ROUTES, 'suite-parent', "kind: isSuiteFile ? 'suite-parent' : 'test',")],
    why: 'The parent-kind mint D-11 names.',
  },
  {
    id: 'route:POST /api/runs/trigger (suite file)',
    kind: 'producer',
    disposition: 'delete',
    sites: [S(ROUTES, 'suite-parent', "kind: isSuite ? 'suite-parent' : 'test',")],
    why: 'The same mint on the door the dashboard UI uses.',
  },
  {
    id: 'ingest:createDashboardRunIngest suite correlation',
    kind: 'producer',
    disposition: 'delete',
    sites: [
      S(SUBSCRIBER, 'suite-parent', "const kind: RunArtifactKind = mode === 'suite' ? 'suite-parent' : 'test'"),
      S(SUBSCRIBER, 'suite-child', "insertArtifact(id, 'suite-child')"),
    ],
    why: 'The live producer of new parent/child run records: a parent row of kind suite-parent plus '
      + 'one linked child row per member. A parallel suite is ONE run row with member handles (D-11).',
  },
  {
    id: 'ingest:createDashboardRunIngest retry correlation',
    kind: 'producer',
    disposition: 'delete',
    sites: [],
    why: 'Already producer-less before this plan — 401-07 (D-12) retired the machinery that set '
      + 'AGENT_QA_PARENT_RUN_ID, so nothing can reach this mode. "Anything the one-run model leaves '
      + 'producer-less goes too" (D-11). Predicate A never saw it (it spells no debris token); '
      + 'predicate B found it by producing a linked row.',
  },
]

// ---------------------------------------------------------------------------------------------
// Cells
// ---------------------------------------------------------------------------------------------

describe('predicate A — the lexical debris census', () => {
  it('discovers its file universe from disk rather than a pinned list', () => {
    const roots = discoverSourceRoots()
    expect(roots.length).toBeGreaterThan(5)

    const files = scanFileUniverse()
    // A narrowing that silently drops packages is the 401-10 failure this control exists for:
    // every package that HAS a src directory must contribute at least one scanned file.
    const packagesSeen = new Set(
      files.map((f) => relative(PACKAGES_DIR, f).split(sep)[0]),
    )
    const missing = roots.map((r) => r.pkg).filter((pkg) => !packagesSeen.has(pkg))
    expect(missing, `packages with src/ that contributed no scanned file: ${missing.join(', ')}`).toEqual([])
    expect(files.length).toBeGreaterThan(500)
  })

  it('finds a planted token — the known-positive control for the extractor', () => {
    const planted = extractSites('synthetic/planted.ts', [
      'const rows = db.getRunsByParent(id)',
      "const kind = 'suite-parent'",
      'const untouched = 1',
    ].join('\n'))
    expect(planted.map((s) => s.token).sort()).toEqual(['getRunsByParent', 'suite-parent'])
  })

  it('the excluded regions DO contain debris tokens — the exclusion hides them, not a broken glob', () => {
    const testDir = join(PACKAGES_DIR, 'dashboard-server', 'src', '__tests__')
    const testFiles: string[] = []
    for (const entry of readdirSync(testDir, { withFileTypes: true })) {
      if (!entry.isFile() || !/\.tsx?$/.test(entry.name)) continue
      if (entry.name === 'suite-parent-debris-census.test.ts') continue
      testFiles.push(join(testDir, entry.name))
    }
    const inExcludedRegion = scanDebrisSites(testFiles)
    expect(inExcludedRegion.size).toBeGreaterThan(0)

    // ...and none of them leaked into the production scan.
    const production = scanDebrisSites(scanFileUniverse())
    for (const key of inExcludedRegion.keys()) {
      const file = key.split(' ')[0]
      expect(file.includes('__tests__')).toBe(true)
      expect(production.has(key) && key.includes('__tests__')).toBe(false)
    }
  })

  it("every debris site in the shipped sources is registered, and the register has no site the tree doesn't", () => {
    const scanned = scanDebrisSites(scanFileUniverse())
    expect(describeCounts(scanned)).toEqual(describeCounts(registerCounts(CENSUS_PHASE)))
  })

  it('the register is internally coherent — every entry dispositioned, deletes end at zero, keeps stay byte-intact', () => {
    for (const entry of DEBRIS_REGISTER) {
      expect(entry.why.length, `${entry.file} ${entry.token} has no rationale`).toBeGreaterThan(20)
      if (entry.disposition === 'delete') {
        expect(entry.after, `${entry.file} ${entry.token} is a delete that survives`).toBe(0)
      } else {
        expect(entry.after, `${entry.file} ${entry.token} is a keep whose count moved`).toBe(entry.before)
      }
    }
    // Site keys are unique — a duplicated key would let one disposition mask another.
    const keys = DEBRIS_REGISTER.map(siteKey)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('predicate B — the structural surface walk (no source text is read)', () => {
  it('the differential is not vacuous: the two seeded databases differ only in the parent link', () => {
    const { linked, unlinked } = seedPair()
    try {
      expect(runsSnapshot(linked)).toBe(runsSnapshot(unlinked))
      expect(linked.getRunsByParent(PARENT_ID).map((r) => r.id).sort()).toEqual([CHILD_A, CHILD_B].sort())
      expect(unlinked.getRunsByParent(PARENT_ID)).toEqual([])
    } finally {
      linked.close()
      unlinked.close()
    }
  }, 30_000)

  it('walks the WHOLE DashboardDatabase prototype and discovers its link-reading members', () => {
    const discovered = walkPrototype(DashboardDatabase, (db) => db)
    const registered = DEBRIS_SURFACES
      .filter((s) => s.id.startsWith('db:'))
      .map((s) => s.id.slice('db:'.length))
      .sort()
    expect(discovered).toEqual(registered)
  }, 120_000)

  it('walks the WHOLE JobQueue prototype and discovers its link-reading members', () => {
    const discovered = walkPrototype(JobQueue, (db) => new JobQueue({ db, concurrency: 1 }))
    expect(discovered).toEqual(QUEUE_LINK_READERS.slice().sort())
  }, 60_000)

  it('drives the run route corpus and discovers the routes that read the parent link', async () => {
    const discovered = await walkRouteCorpus()
    expect(discovered).toEqual(ROUTE_LINK_READERS.slice().sort())
  }, 120_000)

  it('the route corpus is not vacuous — it contains routes that DO read the link', async () => {
    const discovered = await walkRouteCorpus()
    expect(discovered.length).toBeGreaterThan(2)
  }, 120_000)

  it('drives every production channel and reports which still mint parent/child run records', async () => {
    const findings = await walkProductionChannels()
    expect(findings.map((f) => f.channel).sort()).toEqual(PARENT_CHILD_PRODUCERS.slice().sort())
  }, 60_000)
})

describe('reconciliation — the two predicates meet in the register', () => {
  it('every surface names only registered sites', () => {
    const registered = new Set(DEBRIS_REGISTER.map(siteKey))
    for (const surface of DEBRIS_SURFACES) {
      for (const site of surface.sites) {
        expect(registered.has(site), `${surface.id} names an unregistered site: ${site.split(' ').join(' | ')}`).toBe(true)
      }
    }
  })

  it('every producer surface the walk can reach is registered with a disposition', async () => {
    const findings = await walkProductionChannels()
    const registeredProducers = new Set(
      DEBRIS_SURFACES.filter((s) => s.kind === 'producer').map((s) => s.id),
    )
    for (const finding of findings) {
      expect(registeredProducers.has(finding.channel), `unregistered producer: ${finding.channel}`).toBe(true)
    }
  }, 60_000)

  it('every delete-dispositioned site is justified by an observed surface, or says why it cannot be', () => {
    const namedByDeletingSurface = new Set(
      DEBRIS_SURFACES.filter((s) => s.disposition === 'delete').flatMap((s) => s.sites),
    )
    const unobserved = DEBRIS_REGISTER
      .filter((e) => e.disposition === 'delete')
      .filter((e) => !namedByDeletingSurface.has(siteKey(e)))
      .map((e) => `${e.file} | ${e.token} | ${e.line}`)
    expect(unobserved.sort()).toEqual(UNOBSERVABLE_DELETES.slice().sort())
  })

  it('no parent/child producer survives — the D-11 headline, measured', async () => {
    const findings = await walkProductionChannels()
    if (CENSUS_PHASE === 'before') {
      // Task 1 commits the register BEFORE the deletion, so the headline is not yet true. The cell
      // states what it is measuring rather than asserting a claim the tree does not yet support.
      expect(findings.length).toBeGreaterThan(0)
      return
    }
    expect(findings, `surviving producers: ${JSON.stringify(findings)}`).toEqual([])
  }, 60_000)
})

describe('historical rows still render (T-402-29)', () => {
  it('serves the run list and the run detail for an operator database holding parent/child rows', async () => {
    const { linked } = seedPair()
    try {
      const router = buildRouter(linked)

      const list = await probeRoute(router, '/api/runs')
      expect(list.status).toBe(200)
      const listBody = JSON.parse(list.body) as { runs: Array<{ id: string; tests?: Array<{ id: string }> }> }
      const parentRow = listBody.runs.find((r) => r.id === PARENT_ID)
      expect(parentRow, 'the historical suite parent vanished from the run list').toBeTruthy()
      expect((parentRow?.tests ?? []).map((t) => t.id).sort()).toEqual([CHILD_A, CHILD_B].sort())

      const detail = await probeRoute(router, `/api/runs/${PARENT_ID}`)
      expect(detail.status).toBe(200)
      const detailBody = JSON.parse(detail.body) as { tests?: Array<{ id: string }>; attempts?: Array<{ id: string }> }
      expect((detailBody.tests ?? []).map((t) => t.id).sort()).toEqual([CHILD_A, CHILD_B].sort())

      const artifact = await probeRoute(router, `/api/runs/${PARENT_ID}/artifact`)
      expect(artifact.status).toBe(200)
      // The RETAINED union member: a historical row's kind still round-trips out of the door.
      expect(artifact.body).toContain('suite-parent')

      const memberDetail = await probeRoute(router, `/api/runs/${CHILD_A}`)
      expect(memberDetail.status).toBe(200)
    } finally {
      linked.close()
    }
  }, 60_000)

  it('the retained RunArtifactKind values are still writable and readable', () => {
    const db = new DashboardDatabase({ dbPath: ':memory:' })
    try {
      for (const kind of ['suite-parent', 'suite-child'] as const) {
        const id = db.insertRun({
          name: `historical ${kind}`,
          status: 'passed',
          duration: 1,
          startedAt: '2026-08-01T00:00:00.000Z',
          endedAt: '2026-08-01T00:00:01.000Z',
        })
        db.insertRunArtifact({ runId: id, kind })
        expect(db.getRunArtifact(id)?.kind).toBe(kind)
      }
    } finally {
      db.close()
    }
  })
})

// ---------------------------------------------------------------------------------------------
// THE MEASURED SETS — the census's expectations for the tree as it stands
//
// These are EQUALITIES against measured sets, never bare zeroes over unfiltered files (T-402-31):
// while keeps exist the cells cannot be vacuous, and any NEW reference or reintroduced producer
// reds them. `CENSUS_PHASE` says which column of the register the lexical arm is measured against;
// the D-11 deletion flips it, and every constant below, in one auditable diff.
// ---------------------------------------------------------------------------------------------

/** `before` = the tree as 402-08 left it. `after` = the tree the D-11 deletion produces. */
const CENSUS_PHASE: 'before' | 'after' = 'before'

/** JobQueue members whose behaviour depends on the parent link. */
const QUEUE_LINK_READERS: readonly string[] = ['cancel', 'cancelChildRuns']

/** Run routes whose response or database effect depends on the parent link. */
const ROUTE_LINK_READERS: readonly string[] = [
  'DELETE /api/runs/:id',
  'GET /api/runs',
  'GET /api/runs/:id',
  'GET /api/runs/:id/artifact',
  'GET /api/runs/:id/execution-logs',
  'POST /api/runs/:id/cancel',
]

/** Channels that still mint parent/child run records. */
const PARENT_CHILD_PRODUCERS: readonly string[] = [
  'ingest:createDashboardRunIngest retry correlation',
  'ingest:createDashboardRunIngest suite correlation',
  'route:POST /api/queue/enqueue (suite file)',
  'route:POST /api/runs/trigger (suite file)',
]

/** Delete-dispositioned sites no behavioural surface can reach, each with its reason recorded. */
const UNOBSERVABLE_DELETES: readonly string[] = [
  "packages/cli/src/commands/run.ts | getRunsByParent | const children = activeSuiteDb.getRunsByParent(run.id)",
  "packages/cli/src/commands/run.ts | suite-child | kind: 'test' | 'suite-parent' | 'suite-child'",
  "packages/cli/src/commands/run.ts | suite-child | }) as { artifact: Record<string, unknown> & { kind: 'test' | 'suite-parent' | 'suite-child' } }",
  "packages/cli/src/commands/run.ts | suite-child | }): { artifact: Record<string, unknown> & { kind: 'test' | 'suite-parent' | 'suite-child' } } {",
  "packages/cli/src/commands/run.ts | suite-parent | kind: 'suite-parent',",
  "packages/cli/src/commands/run.ts | suite-parent | kind: 'test' | 'suite-parent' | 'suite-child'",
  "packages/cli/src/commands/run.ts | suite-parent | }) as { artifact: Record<string, unknown> & { kind: 'test' | 'suite-parent' | 'suite-child' } }",
  "packages/cli/src/commands/run.ts | suite-parent | }): { artifact: Record<string, unknown> & { kind: 'test' | 'suite-parent' | 'suite-child' } } {",
  'packages/dashboard-server/src/server/server.ts | getRunsByParent | const children = db.getRunsByParent(run.id)',
  'packages/dashboard-server/src/server/server.ts | getRunsByParent | const children = db.getRunsByParent(runId)',
  'packages/dashboard-server/src/server/server.ts | getRunsByParent | const updatedChildren = db.getRunsByParent(runId)',
]
