import { createHash } from 'node:crypto'
import { chmod, lstat, mkdtemp, readFile, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { IncomingMessage, type IncomingHttpHeaders, type ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { afterEach, describe, expect, it, vi } from 'vitest'
import { parse as parseYaml } from 'yaml'

import { ConfigFileInvalidError, ConfigManager, readConfigValues } from '../config/index.js'
import { createRouter } from '../server/routes.js'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    rename: vi.fn(actual.rename),
    writeFile: vi.fn(actual.writeFile),
  }
})

vi.mock('@vostride/agent-qa-core', async () => {
  const actual = await vi.importActual<typeof import('@vostride/agent-qa-core')>('@vostride/agent-qa-core')
  return {
    ...actual,
    getAgentQaVersion: vi.fn(() => '0.1.13'),
    readAuth: vi.fn(() => ({})),
    writeAuth: vi.fn(() => Promise.resolve()),
    removeAuth: vi.fn(() => Promise.resolve()),
  }
})

const mockRename = vi.mocked(rename)
const mockWriteFile = vi.mocked(writeFile)

interface MockResponse {
  status: number
  headers: Record<string, string>
  body: string
}

const HOST = '127.0.0.1:4317'

let router: ReturnType<typeof createRouter>
const tempDirs: string[] = []

function createMockDatabase() {
  return {
    getRuns() {
      return []
    },
    close() {},
  }
}

function createMockRequest(
  url: string,
  options: { method?: string; headers?: IncomingHttpHeaders; body?: string } = {},
): IncomingMessage {
  const req = new IncomingMessage(new Socket())
  req.method = options.method ?? 'GET'
  req.url = url
  req.headers = options.headers ?? {}

  process.nextTick(() => {
    if (options.body) {
      req.push(Buffer.from(options.body))
    }
    req.push(null)
  })

  return req
}

async function invokeRoute(
  url: string,
  options: { method?: string; headers?: IncomingHttpHeaders; body?: string } = {},
): Promise<MockResponse> {
  return await new Promise((resolve, reject) => {
    const req = createMockRequest(url, options)
    const headers = new Map<string, string>()
    let status = 200
    let body = ''

    const res = {
      headersSent: false,
      writableEnded: false,
      writeHead(statusCode: number, head?: Record<string, string | number>) {
        status = statusCode
        if (head) {
          for (const [key, value] of Object.entries(head)) {
            headers.set(key.toLowerCase(), String(value))
          }
        }
        return this
      },
      setHeader(name: string, value: string) {
        headers.set(name.toLowerCase(), value)
      },
      getHeader(name: string) {
        return headers.get(name.toLowerCase())
      },
      write(chunk: string | Buffer) {
        body += Buffer.isBuffer(chunk) ? chunk.toString('utf-8') : chunk
        return true
      },
      end(chunk?: string | Buffer) {
        if (chunk) {
          body += Buffer.isBuffer(chunk) ? chunk.toString('utf-8') : chunk
        }
        resolve({
          status,
          headers: Object.fromEntries(headers),
          body,
        })
      },
      destroy() {
        resolve({ status, headers: Object.fromEntries(headers), body })
      },
    } as unknown as ServerResponse

    try {
      router(req, res)
    } catch (error) {
      reject(error)
    }
  })
}

const baseConfig = [
  '# owner notes: keep the step timeout generous on CI',
  'workspace:',
  '  testMatch:',
  '    - tests/**/*.yaml',
  '  suiteMatch:',
  '    - suites/**/*.suite.yaml',
  '  hooksFile: hooks.yaml',
  '  envFile: .env',
  '  secretsFile: .env.secrets.local',
  'services: {}',
  'registry: {}',
  'use:',
  '  timeout:',
  '    step: 30s',
  '    test: 10m',
  '    navigation: 10s',
  '  browser:',
  '    name: chromium',
  '    headless: false',
  '  mobile:',
  '    appState: preserve',
  '',
].join('\n')

async function createConfigWorkspace(initialConfig = baseConfig): Promise<{
  configManager: ConfigManager
  configPath: string
}> {
  const dir = await mkdtemp(join(tmpdir(), 'agent-qa-config-write-'))
  tempDirs.push(dir)
  const configPath = join(dir, 'agent-qa.config.yaml')
  await writeFile(configPath, initialConfig, 'utf-8')
  return { configManager: new ConfigManager(configPath), configPath }
}

async function useConfigWorkspace(initialConfig = baseConfig): Promise<string> {
  const { configManager, configPath } = await createConfigWorkspace(initialConfig)
  router = createRouter({
    db: createMockDatabase() as any,
    configManager,
    configPath,
  })
  return configPath
}

function patchConfig(body: unknown, headers: IncomingHttpHeaders = {}): Promise<MockResponse> {
  return invokeRoute('/api/config', {
    method: 'PATCH',
    headers: { host: HOST, 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

const setStep = (value: unknown) => ({
  changes: [{ op: 'set', path: ['use', 'timeout', 'step'], value }],
})

afterEach(async () => {
  vi.clearAllMocks()
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('PATCH /api/config (429-01)', () => {
  it('SC3-FIELD-MERGE: an outside edit and a human autosave both survive, comments kept', async () => {
    const configPath = await useConfigWorkspace()
    const outside = (await readFile(configPath, 'utf-8')).replace('headless: false', 'headless: true')
    await writeFile(configPath, outside, 'utf-8')

    const response = await patchConfig(setStep('45s'))

    expect(response.status).toBe(200)
    const text = await readFile(configPath, 'utf-8')
    const parsed = parseYaml(text) as { use: { browser: { headless: boolean }; timeout: Record<string, string> } }
    expect(parsed.use.browser.headless).toBe(true)
    expect(parsed.use.timeout).toEqual({ step: '45s', test: '10m', navigation: '10s' })
    expect(text).toContain('# owner notes: keep the step timeout generous on CI')
  })

  it('PATCH-ONE-ATOMIC-WRITE: one rename onto the config path per request, no direct write', async () => {
    const configPath = await useConfigWorkspace()
    mockRename.mockClear()
    mockWriteFile.mockClear()

    const response = await patchConfig(setStep('45s'))

    expect(response.status).toBe(200)
    expect(mockRename).toHaveBeenCalledTimes(1)
    expect(mockRename.mock.calls[0]?.[1]).toBe(configPath)
    expect(mockWriteFile.mock.calls.some(([target]) => target === configPath)).toBe(false)
  })

  it('INVALID-MERGE-KEEPS-BYTES: a merge that fails whole-config validation answers 422 and writes nothing', async () => {
    const configPath = await useConfigWorkspace()
    const before = await readFile(configPath)
    mockRename.mockClear()

    const response = await patchConfig(setStep(123))

    expect(response.status).toBe(422)
    const body = JSON.parse(response.body) as { error: string; issues: Array<{ path: Array<string | number>; message: string }> }
    expect(body.error).toBe('validation_failed')
    expect(body.issues.some((issue) => issue.path[0] === 'use' && issue.path[1] === 'timeout')).toBe(true)
    expect(Buffer.compare(await readFile(configPath), before)).toBe(0)
    expect(mockRename).not.toHaveBeenCalled()
  })

  it('PATCH-CROSS-SITE-REFUSED: a cross-site caller is refused before the body is read, with no CORS grant', async () => {
    const configPath = await useConfigWorkspace()
    const before = await readFile(configPath)

    for (const headers of [{ origin: 'https://evil.example' }, { 'sec-fetch-site': 'cross-site' }]) {
      const response = await patchConfig(setStep('45s'), headers)
      expect(response.status).toBe(403)
      expect(JSON.parse(response.body)).toEqual({ error: 'cross_site_refused' })
      expect(response.headers['access-control-allow-origin']).toBeUndefined()
    }
    expect(Buffer.compare(await readFile(configPath), before)).toBe(0)

    const ok = await patchConfig(setStep('45s'), { origin: `http://${HOST}`, 'sec-fetch-site': 'same-origin' })
    expect(ok.status).toBe(200)
    expect(ok.headers['access-control-allow-origin']).toBeUndefined()
    const invalid = await patchConfig(setStep(123))
    expect(invalid.status).toBe(422)
    expect(invalid.headers['access-control-allow-origin']).toBeUndefined()
    const malformed = await patchConfig({ changes: [{ op: 'set', path: 'use.timeout.step', value: '1s' }] })
    expect(malformed.status).toBe(400)
    expect(JSON.parse(malformed.body)).toEqual({ error: 'invalid_write_input' })
    expect(malformed.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('PATCH-RETURNS-REVISION: the answer carries the sha256 of the bytes now on disk', async () => {
    const configPath = await useConfigWorkspace()

    const response = await patchConfig(setStep('45s'))

    expect(response.status).toBe(200)
    const onDisk = await readFile(configPath)
    expect(JSON.parse(response.body)).toEqual({
      revision: createHash('sha256').update(onDisk).digest('hex'),
    })
  })
})

describe('PATCH /api/config concurrency, idempotency and file identity (429-05)', () => {
  it('TWO-SETTLES-BOTH-LAND: two PATCH requests started together both reach the file', async () => {
    const configPath = await useConfigWorkspace()

    const [step, headless] = await Promise.all([
      patchConfig(setStep('45s')),
      patchConfig({ changes: [{ op: 'set', path: ['use', 'browser', 'headless'], value: true }] }),
    ])

    expect([step.status, headless.status]).toEqual([200, 200])
    const parsed = parseYaml(await readFile(configPath, 'utf-8')) as {
      use: { timeout: { step: string }; browser: { headless: boolean } }
    }
    expect(parsed.use.timeout.step).toBe('45s')
    expect(parsed.use.browser.headless).toBe(true)
  })

  it('APPLY-TWICE-IDEMPOTENT: the same change set twice leaves the same bytes and the same revision', async () => {
    const configPath = await useConfigWorkspace()
    const body = {
      changes: [
        { op: 'set', path: ['use', 'timeout', 'step'], value: '45s' },
        { op: 'set', path: ['use', 'browser', 'headless'], value: true },
      ],
    }

    const first = await patchConfig(body)
    const afterFirst = await readFile(configPath)
    const second = await patchConfig(body)

    expect([first.status, second.status]).toEqual([200, 200])
    expect(Buffer.compare(await readFile(configPath), afterFirst)).toBe(0)
    expect(JSON.parse(second.body)).toEqual(JSON.parse(first.body))
  })

  it('MODE-PRESERVED: the rewritten file keeps the mode the owner gave it', async () => {
    const configPath = await useConfigWorkspace()

    for (const [mode, step] of [[0o640, '45s'], [0o664, '50s']] as const) {
      await chmod(configPath, mode)
      const response = await patchConfig(setStep(step))
      expect(response.status).toBe(200)
      expect((await stat(configPath)).mode & 0o777).toBe(mode)
    }
  })

  it('SYMLINK-KEPT: a symlinked config keeps its link and the real file takes the change', async () => {
    const realDir = await mkdtemp(join(tmpdir(), 'agent-qa-config-real-'))
    const linkDir = await mkdtemp(join(tmpdir(), 'agent-qa-config-link-'))
    tempDirs.push(realDir, linkDir)
    const realPath = join(realDir, 'agent-qa.config.yaml')
    const configPath = join(linkDir, 'agent-qa.config.yaml')
    await writeFile(realPath, baseConfig, 'utf-8')
    await symlink(realPath, configPath)
    router = createRouter({ db: createMockDatabase() as any, configManager: new ConfigManager(configPath), configPath })

    const response = await patchConfig(setStep('45s'))

    expect(response.status).toBe(200)
    expect((await lstat(configPath)).isSymbolicLink()).toBe(true)
    const parsed = parseYaml(await readFile(realPath, 'utf-8')) as { use: { timeout: { step: string } } }
    expect(parsed.use.timeout.step).toBe('45s')
  })
})

const CONFIG_MANAGER_SOURCE = new URL('../config/config-manager.ts', import.meta.url)
const FILE_ACCESS = /\b(?:readFile|writeFile|rename|rm|lstat|realpath|stat|chmod|mkdir)\(/

// The ConfigManager class body, from its declaration to the first closing brace at column 0.
function classBody(source: string): string {
  const start = source.indexOf('export class ConfigManager {')
  expect(start).toBeGreaterThan(-1)
  const end = source.indexOf('\n}\n', start)
  return source.slice(start, end)
}

describe('one write path to the config file (429-32)', () => {
  it('LEGACY-WRITE-ROUTES-GONE: a PUT to each retired per-section route is an unknown route and the file is untouched', async () => {
    const configPath = await useConfigWorkspace()
    const before = await readFile(configPath)
    const retired: Array<[string, unknown]> = [
      ['/api/config/settings', { 'use.timeout': { step: '45s', test: '10m', navigation: '10s' } }],
      ['/api/config/llms', {
        llms: [{ name: 'planner', provider: 'gemini', model: 'gemini-2.5-flash' }],
        defaultLLM: 'planner',
      }],
      ['/api/config/default-llm', { llm: 'planner' }],
    ]

    for (const [url, body] of retired) {
      const response = await invokeRoute(url, {
        method: 'PUT',
        headers: { host: HOST, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      expect([url, response.status]).toEqual([url, 404])
    }
    expect(Buffer.compare(await readFile(configPath), before)).toBe(0)

    // The control: the one write route still answers on the same router and file.
    expect((await patchConfig(setStep('45s'))).status).toBe(200)
  })

  it('ONE-WRITE-PATH: the manager exposes only the five file methods, and nothing outside the class touches the file', async () => {
    const source = await readFile(CONFIG_MANAGER_SOURCE, 'utf-8')
    const body = classBody(source)

    const publicMethods = [...body.matchAll(/^ {2}(?:async )?([A-Za-z]\w*)\(/gm)].map((match) => match[1])
    expect(publicMethods.sort()).toEqual(
      ['applyChanges', 'constructor', 'readMasked', 'readWithRevision', 'restorePriors', 'revealAt'],
    )
    for (const retired of ['updateSection', 'replaceSection', 'replaceSectionRaw', 'deleteSectionRaw', 'readDocument']) {
      expect(source).not.toMatch(new RegExp(`\\b${retired}\\b`))
    }
    expect(source).not.toMatch(/^ {2}(?:async )?read\(/m)

    // Every direct file access sits inside the class; a module-level reader goes through it.
    const outside = source.replace(body, '')
    expect(outside.split('\n').filter((line) => FILE_ACCESS.test(line) && !line.startsWith('import'))).toEqual([])

    const manager = new ConfigManager(join(tmpdir(), 'agent-qa-one-write-path.yaml'))
    const prototypeMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(manager))
    for (const retired of ['read', 'updateSection', 'replaceSection', 'replaceSectionRaw', 'deleteSectionRaw', 'readDocument']) {
      expect(prototypeMethods).not.toContain(retired)
    }
  })

  it('VALUES-READ-REFUSES-BROKEN-FILE: a reader that only needs values never gets the part of a broken file yaml recovers', async () => {
    const { configManager, configPath } = await createConfigWorkspace()
    expect(await readConfigValues(configManager)).toEqual(parseYaml(baseConfig))

    await writeFile(configPath, 'a: 1\nb: [1, 2\nc: 3\n', 'utf-8')
    await expect(readConfigValues(configManager)).rejects.toBeInstanceOf(ConfigFileInvalidError)

    await rm(configPath)
    expect(await readConfigValues(configManager)).toEqual({})
  })
})
