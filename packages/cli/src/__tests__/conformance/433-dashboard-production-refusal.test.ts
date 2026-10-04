// C433-DASHBOARD-PRODUCTION-REFUSED (Phase 433 plan 34; G-433-10, F-433-42).
//
// The dashboard's Run on a target declared `environment: production`, with no top-level
// `allowProduction: true`, is refused at the trigger before anything happens: 403 with the run
// service door's `run_denied` body, no runs row, no run artifact, no settle, no run directory and no
// request at the target. With the opt-in the same click starts the run; a non-production run is
// unchanged. The dashboard is composed as `agent-qa dashboard` composes it (433-door-fixture), over a
// project with one local and one production target on a loopback counting origin. Runs that start
// do so with no browser (the project's empty pin) and an unreachable model, so they probe the
// target, fail to plan and finish.

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { DashboardDatabase } from '@vostride/agent-qa-dashboard'
import { generateSuiteId, generateTestId } from '@vostride/agent-qa-ids'
import { buildProductionRefusal } from '@vostride/agent-qa-schema'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { CountingTarget } from '../../commands/__tests__/suite-run-fixture.js'
import { openDashboardScene, type DashboardScene } from './433-door-fixture.js'
import type { PopulatedRunProject } from './populated-run-fixture.js'

const PRODUCTION_TARGET = 'prod-one'
const LOCAL_TARGET = 'local-one'
const CELL_BUDGET_MS = 180_000
const QUIET_WINDOW_MS = 5_000

interface RefusalProject extends PopulatedRunProject {
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

function refusalProject(origin: string, optIn: boolean): RefusalProject {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'agent-qa-433-34-')))
  roots.push(root)
  mkdirSync(join(root, 'tests'), { recursive: true })
  mkdirSync(join(root, 'suites'), { recursive: true })
  mkdirSync(join(root, 'no-browsers'), { recursive: true })
  process.env.PLAYWRIGHT_BROWSERS_PATH = join(root, 'no-browsers')
  writeFileSync(join(root, 'agent-qa.config.yaml'), [
    ...(optIn ? ['allowProduction: true'] : []),
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
  ].join('\n'))
  writeFileSync(join(root, 'hooks.yaml'), 'hooks: []\n')
  writeFileSync(join(root, '.env'), '')
  writeFileSync(join(root, '.env.secrets.local'), '')
  const test = (file: string, target: string): { path: string; id: string } => {
    const id = generateTestId()
    writeFileSync(join(root, 'tests', file), [
      `test-id: ${id}`,
      `name: the ${file} test`,
      `target: ${target}`,
      'steps:',
      '  - Verify the page says "Example"',
      '',
    ].join('\n'))
    return { path: `tests/${file}`, id }
  }
  const local = test('local.yaml', LOCAL_TARGET)
  const production = test('prod.yaml', PRODUCTION_TARGET)
  // A suite names one target and patches every member to it, so its production member is the
  // suite's own target.
  const suitePath = 'suites/production.suite.yaml'
  writeFileSync(join(root, suitePath), [
    'name: The production suite',
    `suite-id: ${generateSuiteId()}`,
    `target: ${PRODUCTION_TARGET}`,
    'tests:',
    `  - test: ${local.path}`,
    `    id: ${local.id}`,
    `  - test: ${production.path}`,
    `    id: ${production.id}`,
    '',
  ].join('\n'))
  return {
    root,
    configPath: join(root, 'agent-qa.config.yaml'),
    agentQaRoot: join(root, '.agent-qa'),
    suitePath,
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

async function openScene(project: RefusalProject): Promise<DashboardScene> {
  const scene = await openDashboardScene(project, { dbPath: ':memory:' })
  cleanups.push(() => scene.close())
  return scene
}

function runDirectories(project: RefusalProject): string[] {
  const runs = join(project.agentQaRoot, 'runs')
  return existsSync(runs) ? readdirSync(runs) : []
}

function unsettledRuns(project: RefusalProject): string[] {
  return runDirectories(project).filter((runId) => {
    const events = join(project.agentQaRoot, 'runs', runId, 'events.jsonl')
    return !existsSync(events) || !readFileSync(events, 'utf8').includes('"type":"runFinished"')
  })
}

function artifactCount(db: DashboardDatabase): number {
  const handle = (db as unknown as { db: { prepare(sql: string): { get(): unknown } } }).db
  return (handle.prepare('SELECT COUNT(*) AS count FROM run_artifacts').get() as { count: number }).count
}

async function waitFor(check: () => boolean, timeoutMs = 120_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (check()) return true
    await new Promise((settle) => setTimeout(settle, 50))
  }
  return check()
}

async function trigger(scene: DashboardScene, file: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${scene.origin}/api/runs/trigger`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ file }),
  })
  const raw = await response.text()
  const body = (() => { try { return JSON.parse(raw) as Record<string, unknown> } catch { return { raw } } })()
  return { status: response.status, body }
}

/** Everything a refused click could have left, read after a quiet window. */
async function aftermath(scene: DashboardScene, project: RefusalProject, target: CountingTarget): Promise<Record<string, unknown>> {
  await new Promise((settle) => setTimeout(settle, QUIET_WINDOW_MS))
  // A click the trigger let through is refused later by the run core; let it settle so the cell
  // reports what it left rather than racing it.
  await waitFor(() => unsettledRuns(project).length === 0, 30_000)
  return {
    runRows: scene.db.getRuns({}).map((row) => ({ status: row.status, name: row.name })),
    runArtifacts: artifactCount(scene.db),
    settled: scene.settled.map((entry) => ({ status: entry.status, refusedBeforeStart: entry.details['refusedBeforeStart'] })),
    runDirectories: runDirectories(project),
    targetHits: [...target.hits],
  }
}

const NOTHING_HAPPENED = { runRows: [], runArtifacts: 0, settled: [], runDirectories: [], targetHits: [] }

describe('C433-DASHBOARD-PRODUCTION-REFUSED: the dashboard refuses a production run at its door', () => {
  it('C433-DASHBOARD-PRODUCTION-REFUSED: the trigger refuses a production test before any effect', async () => {
    await withTarget(async (target) => {
      const project = refusalProject(target.origin, false)
      const scene = await openScene(project)
      const answer = await trigger(scene, project.productionTest)
      const left = await aftermath(scene, project, target)
      expect({ ...answer, ...left }).toEqual({
        status: 403,
        body: { error: 'run_denied', neutralReason: buildProductionRefusal([PRODUCTION_TARGET]) },
        ...NOTHING_HAPPENED,
      })
    })
  }, CELL_BUDGET_MS)

  it('C433-DASHBOARD-PRODUCTION-REFUSED: a suite with a production member is refused the same way', async () => {
    await withTarget(async (target) => {
      const project = refusalProject(target.origin, false)
      const scene = await openScene(project)
      const answer = await trigger(scene, project.suitePath)
      const left = await aftermath(scene, project, target)
      expect({ ...answer, ...left }).toEqual({
        status: 403,
        body: { error: 'run_denied', neutralReason: buildProductionRefusal([PRODUCTION_TARGET]) },
        ...NOTHING_HAPPENED,
      })
    })
  }, CELL_BUDGET_MS)

  it('C433-DASHBOARD-PRODUCTION-REFUSED: the opt-in starts the same run', async () => {
    await withTarget(async (target) => {
      const project = refusalProject(target.origin, true)
      const scene = await openScene(project)
      const answer = await trigger(scene, project.productionTest)
      expect(answer.status, JSON.stringify(answer.body)).toBe(202)
      expect(answer.body['status']).toBe('queued')
      expect(await waitFor(() => scene.settled.length > 0), 'the opted-in run never settled').toBe(true)
      expect(await waitFor(() => unsettledRuns(project).length === 0), 'the opted-in run never finished').toBe(true)
      expect(scene.settled[0]!.details['refusedBeforeStart']).toBeUndefined()
      expect(target.hits, 'the opted-in run never reached the target').toContain(`/${PRODUCTION_TARGET}`)
      expect(scene.db.getRuns({}).map((row) => row.id)).toEqual([answer.body['runId']])
    })
  }, CELL_BUDGET_MS)

  it('C433-DASHBOARD-PRODUCTION-REFUSED: a non-production run is unchanged', async () => {
    await withTarget(async (target) => {
      const project = refusalProject(target.origin, false)
      const scene = await openScene(project)
      const answer = await trigger(scene, project.localTest)
      expect(answer.status, JSON.stringify(answer.body)).toBe(202)
      expect(answer.body['status']).toBe('queued')
      expect(await waitFor(() => scene.settled.length > 0), 'the run never settled').toBe(true)
      expect(await waitFor(() => unsettledRuns(project).length === 0), 'the run never finished').toBe(true)
      expect(scene.settled[0]!.details['refusedBeforeStart']).toBeUndefined()
      expect(target.hits).toContain(`/${LOCAL_TARGET}`)
      expect(target.hits).not.toContain(`/${PRODUCTION_TARGET}`)
      expect(scene.db.getRuns({}).map((row) => row.id)).toEqual([answer.body['runId']])
    })
  }, CELL_BUDGET_MS)
})
