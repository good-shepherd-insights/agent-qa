// C442-ENQUEUE-REFUSAL (Phase 442 D-12, WINDOWS #550).
//
// `POST /api/queue/enqueue` naming a target declared `environment: production`, with no top-level
// `allowProduction: true`, is refused before anything is queued, leased or recorded: the answer is
// the trigger's 403 `run_denied` body, and the runs database (main file, `-wal` and every table),
// the run store, the artifacts directory, the job store and the queue read exactly as before. The
// dashboard is composed as `agent-qa dashboard` composes it (433-door-fixture) over a FILE-backed
// runs database, so "byte-identical" means something. Runs that start do so with no browser and an
// unreachable model, so they probe the target, fail to plan and finish.

import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'

import type { DashboardDatabase } from '@vostride/agent-qa-dashboard'
import { generateTestId } from '@vostride/agent-qa-ids'
import { buildProductionRefusal } from '@vostride/agent-qa-schema'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { CountingTarget } from '../../commands/__tests__/suite-run-fixture.js'
import { openDashboardScene, type DashboardScene } from './433-door-fixture.js'
import type { PopulatedRunProject } from './populated-run-fixture.js'

const PRODUCTION_TARGET = 'prod-one'
const LOCAL_TARGET = 'local-one'
const CELL_BUDGET_MS = 180_000
const QUIET_WINDOW_MS = 5_000

type OptIn = 'absent' | 'false' | 'true'

interface EnqueueProject extends PopulatedRunProject {
  readonly dbPath: string
  readonly localTest: string
  readonly productionTest: string
}

const roots: string[] = []
const cleanups: Array<() => Promise<void>> = []
let savedCi: string | undefined
let savedBrowsers: string | undefined

beforeEach(() => {
  savedCi = process.env.CI
  savedBrowsers = process.env.PLAYWRIGHT_BROWSERS_PATH
  process.env.CI = 'true'
})

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup().catch(() => {})
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  if (savedCi === undefined) delete process.env.CI
  else process.env.CI = savedCi
  if (savedBrowsers === undefined) delete process.env.PLAYWRIGHT_BROWSERS_PATH
  else process.env.PLAYWRIGHT_BROWSERS_PATH = savedBrowsers
})

function enqueueProject(origin: string, optIn: OptIn): EnqueueProject {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'agent-qa-442-07-')))
  roots.push(root)
  mkdirSync(join(root, 'tests'), { recursive: true })
  mkdirSync(join(root, 'suites'), { recursive: true })
  mkdirSync(join(root, 'no-browsers'), { recursive: true })
  mkdirSync(join(root, '.agent-qa'), { recursive: true })
  process.env.PLAYWRIGHT_BROWSERS_PATH = join(root, 'no-browsers')
  writeFileSync(
    join(root, 'agent-qa.config.yaml'),
    [
      ...(optIn === 'absent' ? [] : [`allowProduction: ${optIn}`]),
      'workspace:',
      '  testMatch:',
      "    - 'tests/**/*.yaml'",
      '  suiteMatch:',
      "    - 'suites/**/*.suite.yaml'",
      '  hooksFile: hooks.yaml',
      '  envFile: .env',
      '  secretsFile: .env.secrets.local',
      'registry:',
      '  targets:',
      `    ${LOCAL_TARGET}:`,
      '      platform: web',
      `      url: ${origin}/${LOCAL_TARGET}`,
      '      product: door-product',
      '      environment: local',
      `    ${PRODUCTION_TARGET}:`,
      '      platform: web',
      `      url: ${origin}/${PRODUCTION_TARGET}`,
      '      product: door-product',
      '      environment: production',
      '  llms:',
      '    - name: unreachable',
      '      provider: openai-compatible',
      '      model: gpt-4o-mini',
      '      baseURL: http://127.0.0.1:1/v1',
      'use:',
      '  llm: unreachable',
      '  mobile:',
      '    appState: preserve',
      '',
    ].join('\n'),
  )
  writeFileSync(join(root, 'hooks.yaml'), 'hooks: []\n')
  writeFileSync(join(root, '.env'), '')
  writeFileSync(join(root, '.env.secrets.local'), '')
  const test = (file: string, target: string): { path: string; id: string } => {
    const id = generateTestId()
    writeFileSync(
      join(root, 'tests', file),
      [
        `test-id: ${id}`,
        `name: the ${file} test`,
        `target: ${target}`,
        'steps:',
        '  - Verify the page says "Example"',
        '',
      ].join('\n'),
    )
    return { path: `tests/${file}`, id }
  }
  const local = test('local.yaml', LOCAL_TARGET)
  const production = test('prod.yaml', PRODUCTION_TARGET)
  return {
    root,
    configPath: join(root, 'agent-qa.config.yaml'),
    agentQaRoot: join(root, '.agent-qa'),
    dbPath: join(root, '.agent-qa', 'runs.db'),
    suitePath: '',
    testPath: production.path,
    testId: production.id,
    localTest: local.path,
    productionTest: production.path,
  }
}

async function withTarget<T>(body: (target: CountingTarget) => Promise<T>): Promise<T> {
  const target = new CountingTarget()
  await target.listen()
  try {
    return await body(target)
  } finally {
    await target.close()
  }
}

async function openScene(project: EnqueueProject): Promise<DashboardScene> {
  const scene = await openDashboardScene(project, { dbPath: project.dbPath })
  cleanups.push(() => scene.close())
  return scene
}

async function waitFor(check: () => boolean, timeoutMs = 120_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (check()) return true
    await new Promise((settle) => setTimeout(settle, 50))
  }
  return check()
}

interface Answer {
  readonly status: number
  readonly body: Record<string, unknown>
}

async function call(scene: DashboardScene, path: string, payload?: unknown): Promise<Answer> {
  const response = await fetch(`${scene.origin}${path}`, {
    method: payload === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json' },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  })
  const raw = await response.text()
  const body = (() => {
    try {
      return JSON.parse(raw) as Record<string, unknown>
    } catch {
      return { raw }
    }
  })()
  return { status: response.status, body }
}

function enqueue(scene: DashboardScene, payload: Record<string, unknown>): Promise<Answer> {
  return call(scene, '/api/queue/enqueue', payload)
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function fileHash(path: string): string {
  return existsSync(path) ? sha256(path) : 'absent'
}

function treeHash(dir: string): Array<[string, string]> | 'absent' {
  if (!existsSync(dir)) return 'absent'
  const entries: Array<[string, string]> = []
  const walk = (at: string): void => {
    for (const name of readdirSync(at).sort()) {
      const path = join(at, name)
      if (statSync(path).isDirectory()) walk(path)
      else entries.push([relative(dir, path), sha256(path)])
    }
  }
  walk(dir)
  return entries
}

function logicalDump(db: DashboardDatabase): Record<string, string[]> {
  const handle = (db as unknown as { db: { prepare(sql: string): { all(): unknown[] } } }).db
  const tables = handle
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all() as Array<{ name: string }>
  const encode = (row: unknown): string =>
    JSON.stringify(row, (_key, value: unknown) =>
      typeof value === 'bigint' ? value.toString() : value,
    )
  return Object.fromEntries(
    tables.map(({ name }) => [
      name,
      handle
        .prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`)
        .all()
        .map(encode)
        .sort(),
    ]),
  )
}

/** Every place a refused enqueue could have left something, read in one pass. */
async function snapshot(
  scene: DashboardScene,
  project: EnqueueProject,
): Promise<Record<string, unknown>> {
  const queue = await call(scene, '/api/queue/status')
  const count = (key: string): unknown =>
    (queue.body[key] as { count?: unknown } | undefined)?.count
  return {
    runsDbMain: fileHash(project.dbPath),
    runsDbWal: fileHash(`${project.dbPath}-wal`),
    runsDbTables: logicalDump(scene.db),
    runStore: treeHash(join(project.agentQaRoot, 'runs')),
    artifacts: treeHash(join(project.agentQaRoot, 'artifacts')),
    agentJobsDb: fileHash(join(project.agentQaRoot, 'agent-jobs.db')),
    queue: {
      status: queue.status,
      pending: count('pending'),
      running: count('running'),
      activeSlots: queue.body['activeSlots'],
    },
  }
}

/** Lets anything an enqueue let through run to its end, so the after-snapshot reports what it left. */
async function quiet(scene: DashboardScene): Promise<void> {
  await new Promise((settle) => setTimeout(settle, QUIET_WINDOW_MS))
  await waitFor(
    () =>
      scene.db.getPendingRuns().length === 0 &&
      scene.db.getRuns({}).every((row) => row.status !== 'running'),
    30_000,
  )
}

function refusal(): Record<string, unknown> {
  return { error: 'run_denied', neutralReason: buildProductionRefusal([PRODUCTION_TARGET]) }
}

describe('C442-ENQUEUE-REFUSAL', () => {
  it(
    'a production enqueue is refused before anything is queued, leased or recorded',
    async () => {
      await withTarget(async (target) => {
        const project = enqueueProject(target.origin, 'absent')
        const scene = await openScene(project)
        const before = await snapshot(scene, project)
        const answer = await enqueue(scene, {
          name: 'the production enqueue',
          file: project.productionTest,
        })
        await quiet(scene)
        const after = await snapshot(scene, project)
        const reason = String(answer.body['neutralReason'] ?? '')
        expect(
          {
            ...answer,
            names: [
              reason.includes(`"${PRODUCTION_TARGET}"`),
              reason.includes('allowProduction: true'),
            ],
            ...after,
            settled: scene.settled,
            targetHits: target.hits,
          },
          `the route answered ${String(answer.status)} ${JSON.stringify(answer.body)}`,
        ).toEqual({
          status: 403,
          body: refusal(),
          names: [true, true],
          ...before,
          settled: [],
          targetHits: [],
        })
      })
    },
    CELL_BUDGET_MS,
  )
})
