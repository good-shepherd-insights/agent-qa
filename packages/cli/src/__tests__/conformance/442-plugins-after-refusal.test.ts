// 2026-10-16 (442-08, D-10, SC5): loading a plugin is an effect, so a refused production request loads none.

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { generateSuiteId, generateTestId } from '@vostride/agent-qa-ids'
import { Command } from 'commander'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createFnCommand } from '../../commands/fn.js'
import { CountingTarget } from '../../composition/__tests__/in-process-run-fixture.js'

const CLI_DIST = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'dist', 'cli.js')
const OPT_IN_LINE = 'allowProduction: true'
const PRODUCTION_SENTENCE = 'declared environment: production'
const PRODUCTION_TARGET = 'prod-one'
const LOCAL_TARGET = 'local-one'
const AUTH_MARKER = 'plugin-loaded.marker'
const PROVIDER_MARKER = 'provider-plugin-loaded.marker'

const roots: string[] = []

afterEach(() => {
  vi.restoreAllMocks()
  process.exitCode = undefined
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function posixOnly(): void {
  if (process.platform === 'win32') throw new Error('POSIX run lifecycle required; never skip')
}

interface MarkerProject {
  readonly root: string
  readonly configPath: string
  readonly productionTest: string
  readonly productionSuite: string
  readonly markers: readonly string[]
}

// A local copy of 432-direct-parity's matrix project, plus an auth and a provider plugin that
// each write a marker on import. A fresh directory per cell gives a fresh file URL, so neither
// Node's module cache nor the loaders' declaration sets can make a refused leg pass vacuously.
function markerProject(origin: string, optIn: boolean): MarkerProject {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'agent-qa-442-08-plugins-')))
  roots.push(root)
  mkdirSync(join(root, 'tests'), { recursive: true })
  mkdirSync(join(root, 'suites'), { recursive: true })
  mkdirSync(join(root, 'no-browsers'), { recursive: true })
  const markerPlugin = (marker: string): string => [
    "import { writeFileSync } from 'node:fs'",
    `writeFileSync(new URL('./${marker}', import.meta.url), String(process.pid))`,
    'export const providers = []',
    '',
  ].join('\n')
  writeFileSync(join(root, 'marker-auth-plugin.mjs'), markerPlugin(AUTH_MARKER))
  writeFileSync(join(root, 'marker-provider-plugin.mjs'), markerPlugin(PROVIDER_MARKER))
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
    'plugins:',
    '  auth:',
    '    - path: ./marker-auth-plugin.mjs',
    '  providers:',
    '    - path: ./marker-provider-plugin.mjs',
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
  const testId = generateTestId()
  writeFileSync(join(root, 'tests', 'prod.yaml'), [
    `test-id: ${testId}`,
    'name: the production test',
    `target: ${PRODUCTION_TARGET}`,
    'steps:',
    '  - Verify the page says "Example"',
    '',
  ].join('\n'))
  writeFileSync(join(root, 'suites', 'prod.suite.yaml'), [
    `suite-id: ${generateSuiteId()}`,
    'name: the production suite',
    `target: ${JSON.stringify(PRODUCTION_TARGET)}`,
    'tests:',
    '  - test: tests/prod.yaml',
    `    id: ${testId}`,
    '',
  ].join('\n'))
  return {
    root,
    configPath: join(root, 'agent-qa.config.yaml'),
    productionTest: 'tests/prod.yaml',
    productionSuite: 'suites/prod.suite.yaml',
    markers: [join(root, AUTH_MARKER), join(root, PROVIDER_MARKER)],
  }
}

function writtenMarkers(project: MarkerProject): string[] {
  return project.markers.filter((marker) => existsSync(marker))
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

async function spawnCli(project: MarkerProject, args: readonly string[]): Promise<{ status: number | null; text: string }> {
  posixOnly()
  expect(existsSync(CLI_DIST), `the built CLI is missing at ${CLI_DIST}; run pnpm build first`).toBe(true)
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CI: 'true',
    NO_COLOR: '1',
    DO_NOT_TRACK: '1',
    PLAYWRIGHT_BROWSERS_PATH: join(project.root, 'no-browsers'),
  }
  delete env.AGENT_QA_RUN_ID
  const child = spawn(process.execPath, [CLI_DIST, ...args], { cwd: project.root, env, stdio: ['ignore', 'pipe', 'pipe'] })
  const chunks: Buffer[] = []
  child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
  child.stderr.on('data', (chunk: Buffer) => chunks.push(chunk))
  const status = await new Promise<number | null>((settle) => child.on('close', settle))
  return { status, text: Buffer.concat(chunks).toString('utf8') }
}

async function commander(project: MarkerProject, args: readonly string[]): Promise<{ text: string; exitCode: unknown }> {
  const printed: string[] = []
  vi.spyOn(console, 'log').mockImplementation((...values: unknown[]) => { printed.push(values.map(String).join(' ')) })
  vi.spyOn(console, 'error').mockImplementation((...values: unknown[]) => { printed.push(values.map(String).join(' ')) })
  vi.spyOn(console, 'warn').mockImplementation((...values: unknown[]) => { printed.push(values.map(String).join(' ')) })
  const savedCi = process.env.CI
  const savedBrowsers = process.env.PLAYWRIGHT_BROWSERS_PATH
  process.env.CI = 'true'
  process.env.PLAYWRIGHT_BROWSERS_PATH = join(project.root, 'no-browsers')
  process.exitCode = undefined
  const program = new Command()
    .exitOverride()
    .configureOutput({ writeErr: (text) => { printed.push(text) }, writeOut: (text) => { printed.push(text) } })
    .option('--config <path>', 'config file path')
    .addCommand(createFnCommand())
  try {
    await program.parseAsync(['node', 'agent-qa', '--config', project.configPath, ...args])
  } catch (error) {
    printed.push(String(error))
  } finally {
    if (savedCi === undefined) delete process.env.CI
    else process.env.CI = savedCi
    if (savedBrowsers === undefined) delete process.env.PLAYWRIGHT_BROWSERS_PATH
    else process.env.PLAYWRIGHT_BROWSERS_PATH = savedBrowsers
  }
  const exitCode = process.exitCode
  vi.restoreAllMocks()
  process.exitCode = undefined
  return { text: printed.join('\n'), exitCode }
}

describe('C442-PLUGINS-AFTER-REFUSAL', () => {
  it('a refused production run loads no plugin', async () => {
    await withTarget(async (target) => {
      const project = markerProject(target.origin, false)
      const { status, text } = await spawnCli(project, ['run', project.productionTest])
      expect(status, text).toBe(2)
      expect(text).toContain(PRODUCTION_SENTENCE)
      expect(text).toContain(OPT_IN_LINE)
      expect(target.hits).toEqual([])
      expect(writtenMarkers(project), 'a refused production run loaded a plugin').toEqual([])
    })
  }, 120_000)

  it('a refused production suite loads no plugin', async () => {
    await withTarget(async (target) => {
      const project = markerProject(target.origin, false)
      const { status, text } = await spawnCli(project, ['run', project.productionSuite])
      expect(status, text).toBe(2)
      expect(text).toContain(`"${PRODUCTION_TARGET}"`)
      expect(text).toContain(OPT_IN_LINE)
      expect(target.hits).toEqual([])
      expect(writtenMarkers(project), 'a refused production suite loaded a plugin').toEqual([])
    })
  }, 120_000)

  it('a refused production fn request loads no plugin', async () => {
    await withTarget(async (target) => {
      const project = markerProject(target.origin, false)
      const { text, exitCode } = await commander(project, [
        'fn', 'runs.start', '--input', JSON.stringify({ patterns: [project.productionTest] }), '--json',
      ])
      expect(exitCode, text).not.toBe(undefined)
      expect(exitCode, text).not.toBe(0)
      expect(text).toContain(`"${PRODUCTION_TARGET}"`)
      expect(text).toContain(OPT_IN_LINE)
      expect(target.hits).toEqual([])
      expect(writtenMarkers(project), 'a refused production fn request loaded a plugin').toEqual([])
    })
  }, 120_000)

  it('an opted-in production run loads its plugin and runs', async () => {
    await withTarget(async (target) => {
      const project = markerProject(target.origin, true)
      const { text } = await spawnCli(project, ['run', project.productionTest])
      expect(text).not.toContain(OPT_IN_LINE)
      expect(target.hits, text).toContain(`/${PRODUCTION_TARGET}`)
      expect(writtenMarkers(project), 'the opted-in run did not load its plugins').toEqual(project.markers)
    })
  }, 120_000)
})
