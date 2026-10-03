// THE TERMINAL DOOR (Phase 433 plan 03; D-22, PXH-UAT-03).
//
// One run request, made the way a person makes it: `agent-qa run` typed at a real terminal, with
// stdin and stdout both a pseudo-terminal and no CI marker in the environment. Three postures, each
// in a fresh temporary project over a loopback counting target, as the 432 door matrix states them:
//   1. a NON-PRODUCTION test runs in its one call and nothing is asked;
//   2. a declared PRODUCTION test is refused before any effect (exit 2, no run directory, no request
//      at the target) with the one plain sentence naming the target and `allowProduction: true`;
//   3. the SAME production test runs once the config, and only the config, opts in.
//
// WHY THE MATRIX DOES NOT ALREADY PROVE THIS. Every door in `432-direct-parity.test.ts` runs in CI
// posture with no terminal: the spawned `run` door has its stdin closed and `CI=true`. A prompt
// that only appears when a person is at a keyboard (stdin a TTY, no CI marker) would pass all nine
// doors. This file is the one door the matrix leaves out.
//
// THE INSTRUMENT FOR "NOTHING ASKS" IS A STDIN THAT NEVER ANSWERS AND NEVER ENDS. The CLI's terminal
// comes from `script`, whose own stdin is a pipe nobody writes to and nobody closes. A question
// would wait forever; the bounded wait kills the process tree and reds by name. A positive control
// proves the wrapper really hands the CLI a TTY on both stdin and stdout: without it, a wrapper
// that silently dropped the terminal would make a green measure the CI door again. A missing
// wrapper FAILS the cells; nothing here skips.
//
// macOS `script` refuses a socket stdin (`tcgetattr/ioctl: Operation not supported on socket`),
// and both Node's stdio pipes and macOS FIFOs are sockets, so the never-ending pipe is a real
// pipe(2) made by `/bin/sh`: a `sleep` that writes nothing feeds `script`, and is reaped when
// `script` exits.
//
// NOTHING IS MOCKED BETWEEN THE DOOR AND THE RUN CORE: the built `dist/cli.js` is the door. The
// model points at an unbindable port, so a started run probes the target, fails to plan and
// finishes. Every fixture lives in a temporary directory.

import { spawn, spawnSync } from 'node:child_process'
import {
  existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { generateTestId } from '@vostride/agent-qa-ids'
import { afterEach, describe, expect, it } from 'vitest'

import { CountingTarget } from '../../composition/__tests__/in-process-run-fixture.js'

const CLI_DIST = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'dist', 'cli.js')
const OPT_IN_LINE = 'allowProduction: true'
const PRODUCTION_SENTENCE = 'declared environment: production'
const PRODUCTION_TARGET = 'prod-one'
const LOCAL_TARGET = 'local-one'
const DOOR_BUDGET_MS = 120_000
/** Copied from 432-direct-parity.test.ts (APPROVAL, line 74): the prompt wording a retired approval would print. */
const APPROVAL = /\[y\/N\]|\[y\/a\/N\]|needs your approval|Proceed\?|--trust-session/u

/** Copied from safety-local/src/execution-context-detector.ts (CI_VENDOR_VARS, not exported). */
const CI_MARKERS = [
  'CI', 'GITHUB_ACTIONS', 'GITLAB_CI', 'CIRCLECI', 'BUILDKITE', 'JENKINS_URL', 'TRAVIS', 'APPVEYOR',
  'TF_BUILD', 'CODEBUILD_BUILD_ID', 'DRONE', 'SEMAPHORE', 'BITBUCKET_BUILD_NUMBER', 'TEAMCITY_VERSION',
] as const

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

// ---- fixture helpers, copied from 432-direct-parity.test.ts (lines 86-180, 441-460) -------------

interface MatrixProject {
  readonly root: string
  readonly configPath: string
  readonly agentQaRoot: string
  readonly localTest: string
  readonly productionTest: string
}

/** One project, one local and one production target over the counting origin, one product. */
function matrixProject(origin: string, optIn: boolean): MatrixProject {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'agent-qa-433-03-tty-')))
  roots.push(root)
  mkdirSync(join(root, 'tests'), { recursive: true })
  mkdirSync(join(root, 'no-browsers'), { recursive: true })
  writeFileSync(join(root, 'agent-qa.config.yaml'), [
    ...(optIn ? [OPT_IN_LINE] : []),
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
  const test = (file: string, target: string): string => {
    writeFileSync(join(root, 'tests', file), [
      `test-id: ${generateTestId()}`,
      `name: the ${file} test`,
      `target: ${target}`,
      'steps:',
      '  - Verify the page says "Example"',
      '',
    ].join('\n'))
    return `tests/${file}`
  }
  return {
    root,
    configPath: join(root, 'agent-qa.config.yaml'),
    agentQaRoot: join(root, '.agent-qa'),
    localTest: test('local.yaml', LOCAL_TARGET),
    productionTest: test('prod.yaml', PRODUCTION_TARGET),
  }
}

function runDirectories(project: MatrixProject): string[] {
  const runs = join(project.agentQaRoot, 'runs')
  return existsSync(runs) ? readdirSync(runs) : []
}

function noBrowsers(project: MatrixProject): string {
  return join(project.root, 'no-browsers')
}

/** The runs this project started that have not written `runFinished` yet. */
function unsettledRuns(project: MatrixProject): string[] {
  return runDirectories(project).filter((runId) => {
    const events = join(project.agentQaRoot, 'runs', runId, 'events.jsonl')
    return !existsSync(events) || !readFileSync(events, 'utf8').includes('"type":"runFinished"')
  })
}

/** The execution context each run's `runStarted` recorded: the run core's own reading of the door. */
function recordedExecutionContexts(project: MatrixProject): unknown[] {
  return runDirectories(project).map((runId) => {
    const events = join(project.agentQaRoot, 'runs', runId, 'events.jsonl')
    if (!existsSync(events)) return undefined
    const started = readFileSync(events, 'utf8').split('\n').filter(Boolean)
      .map((line) => JSON.parse(line) as { type?: string; payload?: { executionContext?: unknown } })
      .find((event) => event.type === 'runStarted')
    return started?.payload?.executionContext
  })
}

async function waitFor(check: () => boolean, timeoutMs = 60_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (check()) return true
    await new Promise((settle) => setTimeout(settle, 50))
  }
  return check()
}

/** The browser pin this process held at each target hit, in arrival order. */
type PinsAtHit = Array<string | undefined>

async function withTarget<T>(body: (target: CountingTarget, pinsAtHit: PinsAtHit) => Promise<T>): Promise<T> {
  const pinsAtHit: PinsAtHit = []
  const target = new CountingTarget(() => { pinsAtHit.push(process.env.PLAYWRIGHT_BROWSERS_PATH) })
  await target.listen()
  try {
    return await body(target, pinsAtHit)
  } finally {
    await target.close()
  }
}

/** Every hit arrived while this process held the project's no-browser pin. */
function expectPinnedHits(project: MatrixProject, pinsAtHit: PinsAtHit): void {
  expect(pinsAtHit.length, 'the target was never hit').toBeGreaterThan(0)
  expect(new Set(pinsAtHit), 'the run reached the target without the no-browser pin')
    .toEqual(new Set([noBrowsers(project)]))
}

// ---- the terminal -------------------------------------------------------------------------------

/** The `script` binary that gives the CLI its terminal, or undefined when this machine has none. */
function wrapperBinary(): string | undefined {
  if (process.platform === 'darwin') return existsSync('/usr/bin/script') ? '/usr/bin/script' : undefined
  const found = spawnSync('/bin/sh', ['-c', 'command -v script'], { encoding: 'utf8' })
  const path = found.stdout.trim()
  return found.status === 0 && path !== '' ? path : undefined
}

function shellQuote(word: string): string {
  return `'${word.replace(/'/gu, `'\\''`)}'`
}

/** `cmd` under `script`, so its stdin and stdout are a pseudo-terminal. */
function ttyArgv(cmd: readonly string[]): string[] {
  if (process.platform === 'darwin') return ['/usr/bin/script', '-q', '/dev/null', ...cmd]
  if (process.platform === 'linux') return ['script', '-q', '-e', '-c', cmd.map(shellQuote).join(' '), '/dev/null']
  throw new Error(`433-03: no TTY wrapper is defined for platform ${process.platform}`)
}

/** `sleep` holds the pipe open without writing; it is reaped once the wrapped command exits. */
const NEVER_ENDING_STDIN = 'sleep 2147483647 | { "$@"; status=$?; pkill -P "$$" -x sleep; exit "$status"; }'

/** Every live descendant of `pid`, deepest first. */
function descendants(pid: number): number[] {
  const listed = spawnSync('ps', ['-A', '-o', 'pid=,ppid='], { encoding: 'utf8' }).stdout
  const children = new Map<number, number[]>()
  for (const line of listed.split('\n')) {
    const [child, parent] = line.trim().split(/\s+/u).map(Number)
    if (child === undefined || parent === undefined || Number.isNaN(child) || Number.isNaN(parent)) continue
    children.set(parent, [...(children.get(parent) ?? []), child])
  }
  const found: number[] = []
  const walk = (at: number): void => {
    for (const child of children.get(at) ?? []) {
      walk(child)
      found.push(child)
    }
  }
  walk(pid)
  return found
}

function killTree(pid: number | undefined): void {
  if (pid === undefined) return
  for (const each of [...descendants(pid), pid]) {
    try { process.kill(each, 'SIGKILL') } catch { /* already gone */ }
  }
}

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-_]/gu

function plain(text: string): string {
  return text.replace(ANSI, '').replace(/\r/gu, '')
}

interface TerminalAnswer {
  readonly status: number | null
  readonly timedOut: boolean
  readonly text: string
}

/** Run `cmd` at a terminal: a PTY on stdin and stdout, a stdin nobody answers, a bounded wait. */
async function atTerminal(cmd: readonly string[], options: { cwd: string; env: NodeJS.ProcessEnv }): Promise<TerminalAnswer> {
  const wrapper = wrapperBinary()
  expect(wrapper, `the TTY wrapper \`script\` is missing on ${process.platform}; the terminal door cannot be measured`).toBeDefined()
  const child = spawn('/bin/sh', ['-c', NEVER_ENDING_STDIN, 'sh', ...ttyArgv(cmd)], {
    cwd: options.cwd, env: options.env, stdio: ['ignore', 'pipe', 'pipe'],
  })
  const chunks: Buffer[] = []
  child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
  child.stderr.on('data', (chunk: Buffer) => chunks.push(chunk))
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; killTree(child.pid) }, DOOR_BUDGET_MS)
  try {
    const status = await new Promise<number | null>((settle) => child.on('close', settle))
    return { status, timedOut, text: plain(Buffer.concat(chunks).toString('utf8')) }
  } finally {
    clearTimeout(timer)
    killTree(child.pid)
  }
}

/** A person's shell: no CI marker, no inherited run identity, a colour terminal, the browser pin. */
function personEnv(project: MatrixProject): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, TERM: 'xterm-256color', DO_NOT_TRACK: '1' }
  for (const marker of CI_MARKERS) delete env[marker]
  for (const name of Object.keys(env)) if (name.startsWith('AGENT_QA_')) delete env[name]
  delete env.NO_COLOR
  env.PLAYWRIGHT_BROWSERS_PATH = noBrowsers(project)
  return env
}

/** `agent-qa run <pattern>` typed at a terminal in `project`, with this process holding the pin. */
async function runAtTerminal(project: MatrixProject, pattern: string): Promise<TerminalAnswer> {
  expect(existsSync(CLI_DIST), `the built CLI is missing at ${CLI_DIST}; run pnpm build first`).toBe(true)
  const savedBrowsers = process.env.PLAYWRIGHT_BROWSERS_PATH
  process.env.PLAYWRIGHT_BROWSERS_PATH = noBrowsers(project)
  try {
    const answer = await atTerminal([process.execPath, CLI_DIST, 'run', pattern], { cwd: project.root, env: personEnv(project) })
    expect(answer.timedOut, `the TTY door waited for input:\n${answer.text}`).toBe(false)
    return answer
  } finally {
    if (savedBrowsers === undefined) delete process.env.PLAYWRIGHT_BROWSERS_PATH
    else process.env.PLAYWRIGHT_BROWSERS_PATH = savedBrowsers
  }
}

describe('the terminal door: agent-qa run at a real pseudo-terminal (D-22)', () => {
  it('C433-TTY-WRAPPER-IS-TTY: the wrapper gives the command a TTY on stdin and on stdout', async () => {
    const answer = await atTerminal(
      [process.execPath, '-e', 'process.stdout.write(JSON.stringify({i:process.stdin.isTTY===true,o:process.stdout.isTTY===true}))'],
      { cwd: tmpdir(), env: { ...process.env } },
    )
    expect(answer.timedOut, answer.text).toBe(false)
    expect(answer.text, 'the wrapper did not give the command a terminal').toContain('{"i":true,"o":true}')
  }, 180_000)

  it('C433-DOOR-TTY-NONPRODUCTION: a non-production run starts and finishes in its one call, asking nothing', async () => {
    await withTarget(async (target, pinsAtHit) => {
      const project = matrixProject(target.origin, false)
      const answer = await runAtTerminal(project, project.localTest)
      expect(answer.text, 'a non-production run was refused').not.toContain(PRODUCTION_SENTENCE)
      expect(answer.text).not.toMatch(APPROVAL)
      expect(answer.text).not.toContain(OPT_IN_LINE)
      expect(runDirectories(project), `expected exactly one run directory:\n${answer.text}`).toHaveLength(1)
      expect(await waitFor(() => unsettledRuns(project).length === 0, 30_000), 'the run never wrote runFinished').toBe(true)
      expect(recordedExecutionContexts(project), 'the run core did not see a person at a terminal').toEqual(['local-interactive'])
      expect(target.hits, `the run never reached the target:\n${answer.text}`).toContain(`/${LOCAL_TARGET}`)
      expect(target.hits).not.toContain(`/${PRODUCTION_TARGET}`)
      expectPinnedHits(project, pinsAtHit)
    })
  }, 180_000)
})
