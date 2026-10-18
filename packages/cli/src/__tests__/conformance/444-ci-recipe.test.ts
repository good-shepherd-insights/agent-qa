// C444-CI-RECIPE, C444-CI-UPLOAD (444-20, D-23, D-24, D-45): the job in `docs/ci.md`, checked
// against the shipped CLI's help, then run on the shipped bin in CI mode to check what it uploads.

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import { refuseWithoutRecordingTools } from './433-door-fixture.js'
import {
  POPULATED_FAILURE_STEP_MARKER,
  POPULATED_FAILURE_STEP_TEXT,
  POPULATED_PASSING_STEP_TEXT,
  populatedRunFixtureProject,
  populatedRunSpawnEnv,
  startStubModelServer,
  startTargetPageServer,
  type FixtureServer,
  type PopulatedRunProject,
  type StubModelServer,
} from './populated-run-fixture.js'
import {
  ANCHORED_BUILDS,
  CLI_ENTRY,
  CLI_PACKAGE_ROOT,
  REBUILD_INSTRUCTION,
  buildFreshness,
  cleanupTempRoots,
  hermeticEnv,
} from './spawned-chat.js'

const FILE_BUDGET_MS = 600_000
const SPAWN_BUDGET_MS = 240_000

const AGENT_QA_ROOT = resolve(CLI_PACKAGE_ROOT, '..', '..')
const CI_DOC = join(AGENT_QA_ROOT, 'docs', 'ci.md')

// The recipe's never-upload list (D-23), as names a file or directory under an uploaded path has.
const FORBIDDEN_NAMES = new Set([
  'runs.db', 'runs.db-wal', 'runs.db-shm',
  'agent-jobs.db', 'agent-jobs.db-wal', 'agent-jobs.db-shm',
  'auth-states',
  '.env', '.env.secrets.local',
  '.lease', '.epoch', '.writer-authority.sqlite',
])
const FORBIDDEN_SEGMENT = /(?:^|\/)memory\/queue(?:\/|$)/u

interface AgentQaCommand {
  readonly line: string
  readonly sub: string
  readonly flags: readonly string[]
  readonly argv: readonly string[]
}

interface Job {
  readonly runLines: readonly string[]
  readonly commands: readonly AgentQaCommand[]
  readonly uploadPaths: readonly string[]
  readonly uploadIf?: unknown
  readonly runEnv?: Record<string, unknown>
}

interface Scene {
  job?: Job
  helpMatches: string[]
  project?: PopulatedRunProject
  run?: { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }
  error?: string
}

const scene: Scene = { helpMatches: [] }
let model: StubModelServer | undefined
let target: FixtureServer | undefined

function firstYamlBlock(markdown: string): string {
  const match = /^```yaml\n([\s\S]*?)^```$/mu.exec(markdown)
  if (match === null) throw new Error(`docs/ci.md has no fenced yaml block (${CI_DOC})`)
  return match[1]!
}

// `npx agent-qa <sub> <args…>`, split on spaces: the job's commands carry no quoting.
function agentQaCommand(line: string): AgentQaCommand | undefined {
  const tokens = line.trim().split(/\s+/u)
  const at = tokens[0] === 'npx' ? 1 : 0
  if (tokens[at] !== 'agent-qa') return undefined
  const argv = tokens.slice(at + 1)
  return {
    line,
    sub: argv[0]!,
    flags: argv.filter((token) => token.startsWith('--')).map((token) => token.split('=')[0]!),
    argv,
  }
}

function readJob(): Job {
  const doc = parse(firstYamlBlock(readFileSync(CI_DOC, 'utf8'))) as {
    jobs?: Record<string, { steps?: { run?: string; uses?: string; if?: unknown; env?: Record<string, unknown>; with?: { path?: string } }[] }>
  }
  const jobs = Object.values(doc.jobs ?? {})
  if (jobs.length !== 1) throw new Error(`docs/ci.md's job block declares ${jobs.length} jobs, not one`)
  const steps = jobs[0]!.steps ?? []
  const runLines = steps.flatMap((step) => typeof step.run === 'string' ? step.run.split('\n').filter((l) => l.trim() !== '') : [])
  const commands = runLines.flatMap((line) => agentQaCommand(line) ?? [])
  const upload = steps.find((step) => step.uses?.startsWith('actions/upload-artifact@') === true)
  const runStep = steps.find((step) => typeof step.run === 'string' && /\bagent-qa run\b/u.test(step.run))
  return {
    runLines,
    commands,
    uploadPaths: (upload?.with?.path ?? '').split('\n').map((path) => path.trim()).filter((path) => path !== ''),
    ...(upload === undefined ? {} : { uploadIf: upload.if }),
    ...(runStep?.env === undefined ? {} : { runEnv: runStep.env }),
  }
}

function helpOf(sub: string, env: NodeJS.ProcessEnv): { code: number | null; text: string } {
  const result = spawnSync(process.execPath, [CLI_ENTRY, sub, '--help'], {
    env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000,
  })
  return { code: result.status, text: `${result.stdout}${result.stderr}` }
}

function headlessEnv(project: PopulatedRunProject): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...hermeticEnv(project.root),
    ...populatedRunSpawnEnv(),
    CI: 'true',
    DO_NOT_TRACK: '1',
  }
  delete env.NO_COLOR
  delete env.FORCE_COLOR
  return env
}

async function runJobCommand(project: PopulatedRunProject, command: AgentQaCommand): Promise<NonNullable<Scene['run']>> {
  const child = spawn(process.execPath, [CLI_ENTRY, '--config', project.configPath, ...command.argv], {
    cwd: project.root, env: headlessEnv(project), stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
  child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
  const budget = setTimeout(() => { child.kill('SIGKILL') }, SPAWN_BUDGET_MS)
  try {
    const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((settle, fail) => {
      child.once('error', fail)
      child.once('close', (code, signal) => { settle({ code, signal }) })
    })
    return { ...exit, stdout, stderr }
  } finally {
    clearTimeout(budget)
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  }
}

function walk(root: string, at: string, out: string[]): void {
  const stat = statSync(at)
  out.push(relative(root, at))
  if (!stat.isDirectory()) return
  for (const name of readdirSync(at).sort()) walk(root, join(at, name), out)
}

function findAll(root: string, names: ReadonlySet<string>): string[] {
  const all: string[] = []
  walk(root, root, all)
  return all.filter((path) => names.has(path.split('/').at(-1)!))
}

beforeAll(async () => {
  refuseWithoutRecordingTools()
  if (process.platform === 'win32') throw new Error('POSIX run lifecycle required; never skip')
  try {
    scene.job = readJob()
    target = await startTargetPageServer()
    model = await startStubModelServer({
      plannerOutcome: 'stepFailed',
      failOnlyStepText: POPULATED_FAILURE_STEP_MARKER,
    })
    const project = populatedRunFixtureProject('444-ci-recipe', {
      modelBaseUrl: model.baseUrl,
      targetUrl: target.url,
    }, {
      stepText: POPULATED_PASSING_STEP_TEXT,
      secondStepText: POPULATED_FAILURE_STEP_TEXT,
    })
    scene.project = project
    const run = scene.job.commands.find((command) => command.sub === 'run')
    if (run === undefined) throw new Error('docs/ci.md\'s job runs no `agent-qa run`')
    scene.run = await runJobCommand(project, run)
  } catch (error) {
    scene.error = error instanceof Error ? error.message : String(error)
  }
  console.info(`C444-CI-RECIPE scene: ${JSON.stringify({ ...scene, project: scene.project?.root }, null, 2)}`)
}, FILE_BUDGET_MS)

afterAll(async () => {
  await model?.close().catch(() => undefined)
  await target?.close().catch(() => undefined)
  cleanupTempRoots()
}, 120_000)

function seen(): string {
  return JSON.stringify({ ...scene, project: scene.project?.root }, null, 2)
}

function jobOf(): Job {
  expect(scene.error, seen()).toBeUndefined()
  expect(scene.job, seen()).toBeDefined()
  return scene.job!
}

describe('C444-CI-RECIPE', () => {
  it('every agent-qa command and flag in the job exists in the shipped help', () => {
    const freshness = buildFreshness(ANCHORED_BUILDS)
    expect({ missing: freshness.missing, stale: freshness.stale },
      `these cells drive the built CLI: ${REBUILD_INSTRUCTION}`).toEqual({ missing: [], stale: [] })
    const job = jobOf()
    expect(job.commands.map((command) => command.sub), seen()).toEqual(['install-browsers', 'run'])
    const env = hermeticEnv(AGENT_QA_ROOT)
    for (const command of job.commands) {
      const help = helpOf(command.sub, env)
      expect(help.code, `${command.sub} --help\n${help.text}`).toBe(0)
      expect(help.text, `${command.sub} --help`).toContain(`Usage: agent-qa ${command.sub} `)
      expect(command.flags.length, command.line).toBeGreaterThan(0)
      for (const flag of command.flags) {
        const line = help.text.split('\n').find((each) => new RegExp(`^\\s+(?:-\\w, )?${flag}(?:\\s|$)`, 'u').test(each))
        expect(line, `${command.sub} --help names ${flag}\n${help.text}`).toBeDefined()
        scene.helpMatches.push(`${command.sub}: ${line!.trim()}`)
      }
    }
    console.info(`C444-CI-RECIPE help lines matched:\n${scene.helpMatches.join('\n')}`)
  })

  it('the job never selects the junit reporter without its output path', () => {
    const job = jobOf()
    expect(readFileSync(CI_DOC, 'utf8'), 'docs/ci.md never names the reporter-selection flag')
      .not.toMatch(/--reporter\b/u)
    const run = job.commands.find((command) => command.sub === 'run')!
    expect(run.flags, run.line).not.toContain('--reporter')
    const at = run.argv.indexOf('--junit-output')
    expect(at, run.line).toBeGreaterThan(0)
    expect(run.argv[at + 1], `${run.line} names the report path`).toMatch(/^[^-].*\.xml$/u)
    expect(job.uploadPaths, 'the report the run writes is the report the job uploads').toContain(run.argv[at + 1])
    expect(job.runEnv, 'the run step sets CI').toMatchObject({ CI: 'true' })
  })
})

describe('C444-CI-UPLOAD', () => {
  it('every uploaded path exists after a CI-mode run', () => {
    const job = jobOf()
    const project = scene.project!
    const run = scene.run!
    expect(job.uploadIf, 'the upload runs even when the job fails').toBe('always()')
    expect(job.uploadPaths, seen()).toEqual(['.agent-qa/runs/', 'junit.xml'])
    expect(run.signal, seen()).toBeNull()
    expect([0, 1], `the run reached a verdict\n${run.stdout}\n${run.stderr}`).toContain(run.code)
    for (const path of job.uploadPaths) {
      expect(existsSync(join(project.root, path)), `${path} exists after the run\n${seen()}`).toBe(true)
    }
    const runs = join(project.root, '.agent-qa', 'runs')
    const runDirs = readdirSync(runs).filter((name) => statSync(join(runs, name)).isDirectory())
    expect(runDirs.length, seen()).toBeGreaterThan(0)
    for (const name of runDirs) {
      for (const file of ['events.jsonl', 'handoff.json']) {
        expect(existsSync(join(runs, name, file)), `${name}/${file}`).toBe(true)
      }
    }
    expect(readFileSync(join(project.root, 'junit.xml'), 'utf8'), 'the JUnit report').toMatch(/<testsuite\b/u)
  })

  it('nothing under the uploaded paths is a file the recipe forbids', () => {
    const job = jobOf()
    const project = scene.project!
    const uploaded: string[] = []
    for (const path of job.uploadPaths) walk(project.root, join(project.root, path), uploaded)
    expect(uploaded.length, seen()).toBeGreaterThan(2)
    const offenders = uploaded.filter((path) => FORBIDDEN_NAMES.has(path.split('/').at(-1)!)
      || FORBIDDEN_SEGMENT.test(path))
    expect(offenders, `forbidden files under the uploaded paths\n${uploaded.join('\n')}`).toEqual([])

    // The forbidden files exist in this workspace, outside the uploaded paths: an upload of
    // `.agent-qa/` wholesale would have carried them.
    const elsewhere = findAll(project.root, FORBIDDEN_NAMES).filter((path) => !uploaded.includes(path))
    for (const name of ['runs.db', 'agent-jobs.db', '.env.secrets.local']) {
      expect(elsewhere.some((path) => path.split('/').at(-1) === name),
        `${name} exists in the workspace\n${elsewhere.join('\n')}`).toBe(true)
    }
    console.info(`C444-CI-UPLOAD forbidden files found outside the uploaded paths:\n${elsewhere.join('\n')}`)
  })
})
