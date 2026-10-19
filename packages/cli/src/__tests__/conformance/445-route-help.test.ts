// C445-ROUTE-HELP (445-10, D-19): every command and flag the route names exists in the shipped help

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import {
  ANCHORED_BUILDS,
  CLI_ENTRY,
  CLI_PACKAGE_ROOT,
  REBUILD_INSTRUCTION,
  buildFreshness,
  cleanupTempRoots,
  hermeticEnv,
  trackTempRoot,
} from './spawned-chat.js'

const DOCS = resolve(CLI_PACKAGE_ROOT, '..', '..', 'docs')
const ROUTE_PAGE = 'getting-started.md'
const PAGES = [ROUTE_PAGE]
const NODE_LINE = 'Node.js 24 or newer (npm comes with it)'
const ROUTE_MARKERS = [
  NODE_LINE,
  'npm install -D agent-qa @vostride/agent-qa-subscription-auth',
  'npx agent-qa install-browsers --chromium',
  'npx agent-qa init --llm',
  'npx agent-qa auth login --config',
  'npx agent-qa validate',
  'npx agent-qa run suites/examples.suite.yaml',
  'npx agent-qa run tests/examples/komazon-shipping-hook.yaml',
]

interface DocCommand {
  readonly page: string
  readonly line: string
  readonly argv: readonly string[]
}

interface Help {
  readonly code: number | null
  readonly text: string
  readonly commands: readonly string[]
}

interface Scene {
  checked: string[]
  helps: string[]
  init?: { code: number | null; stdout: string; stderr: string }
  error?: string
}

const scene: Scene = { checked: [], helps: [] }
const helpCache = new Map<string, Help>()
let helpRoot = ''

function readPage(page: string): string {
  return readFileSync(join(DOCS, page), 'utf8')
}

function shellLines(markdown: string): string[] {
  const lines: string[] = []
  for (const block of markdown.matchAll(/^```(?:sh|bash)\n([\s\S]*?)^```$/gmu)) {
    lines.push(...block[1]!.split('\n').map((line) => line.trim()).filter((line) => line !== ''))
  }
  return lines
}

function agentQaArgv(line: string): string[] | undefined {
  const tokens = line.split(/\s+/u)
  const at = tokens[0] === 'npx' ? 1 : 0
  return tokens[at] === 'agent-qa' ? tokens.slice(at + 1) : undefined
}

function docCommands(): DocCommand[] {
  return PAGES.flatMap((page) => shellLines(readPage(page)).flatMap((line) => {
    const argv = agentQaArgv(line)
    return argv === undefined ? [] : [{ page, line, argv }]
  }))
}

function helpOf(path: readonly string[]): Help {
  const key = path.join(' ')
  const cached = helpCache.get(key)
  if (cached !== undefined) return cached
  const result = spawnSync(process.execPath, [CLI_ENTRY, ...path, '--help'], {
    cwd: helpRoot,
    env: { ...hermeticEnv(helpRoot), DO_NOT_TRACK: '1' },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 60_000,
  })
  const text = `${result.stdout}${result.stderr}`
  const lines = text.split('\n')
  const start = lines.findIndex((line) => line.trim() === 'Commands:')
  const commands: string[] = []
  if (start !== -1) {
    for (const line of lines.slice(start + 1)) {
      if (line.trim() === '') break
      const match = /^ {2}(\S+)/u.exec(line)
      if (match !== null) commands.push(match[1]!)
    }
  }
  const help = { code: result.status, text, commands }
  helpCache.set(key, help)
  scene.helps.push(`agent-qa ${key} --help -> ${String(result.status)}`)
  return help
}

function assertFreshBuild(): void {
  const freshness = buildFreshness(ANCHORED_BUILDS)
  expect({ missing: freshness.missing, stale: freshness.stale },
    `these cells drive the built CLI: ${REBUILD_INSTRUCTION}`).toEqual({ missing: [], stale: [] })
}

function seen(): string {
  return JSON.stringify(scene, null, 2)
}

beforeAll(() => {
  if (process.platform === 'win32') throw new Error('POSIX run lifecycle required; never skip')
  helpRoot = trackTempRoot(mkdtempSync(join(tmpdir(), 'agent-qa-445-route-help-')))
})

afterAll(() => {
  console.info(`C445-ROUTE-HELP scene: ${seen()}`)
  cleanupTempRoots()
})

describe('C445-ROUTE-HELP', () => {
  it('every agent-qa command and flag the route and the re-initialize page name exists in the shipped help', () => {
    assertFreshBuild()
    const commands = docCommands()
    expect(commands.length, 'the pages name agent-qa commands').toBeGreaterThan(5)
    for (const command of commands) {
      const where = `${command.page}: ${command.line}`
      const path: string[] = []
      let help = helpOf(path)
      let at = 0
      while (at < command.argv.length && !command.argv[at]!.startsWith('-')
        && help.commands.includes(command.argv[at]!)) {
        path.push(command.argv[at]!)
        help = helpOf(path)
        at += 1
      }
      expect(path.length, `${where} names a command`).toBeGreaterThan(0)
      expect(help.code, `${where}\n${help.text}`).toBe(0)
      expect(help.text, where).toMatch(new RegExp(`Usage: agent-qa ${path.join(' ')}(?: |$)`, 'mu'))
      const rest = command.argv.slice(at)
      const next = rest.find((token) => !token.startsWith('-') && !/^<[^>]+>$/u.test(token))
      if (help.commands.length > 0) {
        expect(next, `${where}: "${String(next)}" is not a subcommand of agent-qa ${path.join(' ')}`)
          .toBeUndefined()
      }
      for (const flag of rest.filter((token) => token.startsWith('--')).map((token) => token.split('=')[0]!)) {
        const line = help.text.split('\n')
          .find((each) => new RegExp(`^\\s+(?:-\\w, )?${flag}(?:\\s|,|$)`, 'u').test(each))
        expect(line, `${where}: agent-qa ${path.join(' ')} --help names ${flag}\n${help.text}`).toBeDefined()
      }
      scene.checked.push(`${command.page}: agent-qa ${[...path, ...rest].join(' ')}`)
    }
    console.info(`C445-ROUTE-HELP commands checked:\n${scene.checked.join('\n')}`)
  })

  it('the route names its steps in the documented order', () => {
    const page = readPage(ROUTE_PAGE)
    const positions = ROUTE_MARKERS.map((marker) => ({ marker, at: page.indexOf(marker) }))
    for (const { marker, at } of positions) expect(at, `${ROUTE_PAGE} names ${marker}`).toBeGreaterThanOrEqual(0)
    for (let i = 1; i < positions.length; i += 1) {
      expect(positions[i]!.at, `${positions[i]!.marker} comes after ${positions[i - 1]!.marker}`)
        .toBeGreaterThan(positions[i - 1]!.at)
    }
  })

  it('the route names npm only and states the Node floor in one line', () => {
    const page = readPage(ROUTE_PAGE)
    expect(page.split(NODE_LINE).length - 1, `${ROUTE_PAGE} states the Node floor once`).toBe(1)
    const versions = [...page.matchAll(/\bNode(?:\.js)?\s+v?(\d+)/gu)].map((match) => match[1])
    expect(versions.length, 'the page names a Node version').toBeGreaterThan(0)
    expect(versions.filter((version) => version !== '24'), 'no Node version but the floor').toEqual([])
    expect(page, 'no npm version matrix').not.toMatch(/\bnpm\s+v?\d+/u)
    const lines = PAGES.flatMap((name) => shellLines(readPage(name)).map((line) => `${name}: ${line}`))
    expect(lines.length).toBeGreaterThan(5)
    const others = lines.filter((line) => /: (?:npx )?(?:pnpm|yarn|bun|bunx)(?:\s|$)/u.test(line))
    expect(others, 'a shell line names another package manager').toEqual([])
    expect(lines.some((line) => / npm install -D agent-qa/u.test(line)), 'npm installs agent-qa').toBe(true)
  })

  it('the first-run command selects the suite init writes', () => {
    assertFreshBuild()
    const root = trackTempRoot(mkdtempSync(join(tmpdir(), 'agent-qa-445-route-init-')))
    const dir = join(root, 'workspace')
    const result = spawnSync(process.execPath, [CLI_ENTRY, 'init', '--platform', 'web', '--dir', dir], {
      cwd: root,
      env: { ...hermeticEnv(root), DO_NOT_TRACK: '1' },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120_000,
    })
    scene.init = { code: result.status, stdout: result.stdout, stderr: result.stderr }
    expect(result.status, seen()).toBe(0)
    const runs = docCommands().filter((command) => command.argv[0] === 'run')
    const paths = runs.flatMap((command) => command.argv.slice(1)
      .filter((token) => !token.startsWith('-') && /\.ya?ml$/u.test(token)))
    expect(paths.length, 'the route runs named files').toBeGreaterThan(1)
    const first = runs.find((command) => command.page === ROUTE_PAGE)
    expect(first?.argv, 'the first run selects the examples suite').toEqual(['run', 'suites/examples.suite.yaml'])
    for (const path of paths) expect(existsSync(join(dir, path)), `init writes ${path}\n${seen()}`).toBe(true)
    const suite = parse(readFileSync(join(dir, 'suites', 'examples.suite.yaml'), 'utf8')) as {
      tests?: { test?: string }[]
    }
    const members = (suite.tests ?? []).map((member) => member.test)
    expect(members.length, `the suite has members\n${JSON.stringify(suite)}`).toBeGreaterThan(1)
    for (const member of members) {
      expect(typeof member === 'string' && existsSync(join(dir, member)), `suite member ${String(member)}`).toBe(true)
    }
  })
})
