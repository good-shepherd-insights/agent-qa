// 429-10 (D-15/D-16/D-17): POST /api/llm/connect tests a draft model before anything is written,
// and only a pass (or an explicit skipTest) lands the credential and the definition.
//
// auth.json is an in-memory store behind core's readAuth/writeAuth/removeAuth, and the config is a
// real temp file behind a real ConfigManager, so every cell asserts what both hold afterwards.

import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { IncomingMessage, type IncomingHttpHeaders, type ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parse as parseYaml } from 'yaml'

import { ConfigManager } from '../config/index.js'
import { authFromRuntimeConfig, toModelProfileAndAuth } from '../llm-model-mapping.js'
import { createRouter } from '../server/routes.js'
import { readAuth, removeAuth, writeAuth } from '@vostride/agent-qa-core'
import { generateText } from 'ai'

const { authStore } = vi.hoisted(() => ({
  authStore: { current: {} as Record<string, unknown> },
}))

vi.mock('@vostride/agent-qa-core', async () => {
  const actual = await vi.importActual<typeof import('@vostride/agent-qa-core')>('@vostride/agent-qa-core')
  return {
    ...actual,
    getAgentQaVersion: vi.fn(() => '0.1.13'),
    readAuth: vi.fn(async () => structuredClone(authStore.current)),
    writeAuth: vi.fn(async (name: string, credential: unknown) => {
      authStore.current = { ...authStore.current, [name]: credential }
    }),
    removeAuth: vi.fn(async (name: string) => {
      const next = { ...authStore.current }
      delete next[name]
      authStore.current = next
    }),
  }
})

vi.mock('@vostride/agent-qa-model', async () => {
  const actual = await vi.importActual<typeof import('@vostride/agent-qa-model')>('@vostride/agent-qa-model')
  return {
    ...actual,
    createModel: vi.fn(() => ({})),
    getProviderOptions: vi.fn(() => undefined),
  }
})

vi.mock('../llm-model-mapping.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../llm-model-mapping.js')>()
  return {
    ...actual,
    authFromRuntimeConfig: vi.fn(actual.authFromRuntimeConfig),
    toModelProfileAndAuth: vi.fn(actual.toModelProfileAndAuth),
  }
})

vi.mock('ai', () => ({
  generateText: vi.fn(() => Promise.resolve({ text: 'ok' })),
  addToolInputExamplesMiddleware: vi.fn(() => ({})),
  createProviderRegistry: vi.fn(),
  customProvider: vi.fn(),
  extractJsonMiddleware: vi.fn(() => ({})),
  parsePartialJson: vi.fn(),
}))

const mockReadAuth = vi.mocked(readAuth)
const mockWriteAuth = vi.mocked(writeAuth)
const mockRemoveAuth = vi.mocked(removeAuth)
const mockGenerateText = vi.mocked(generateText)
const mockAuthFromRuntimeConfig = vi.mocked(authFromRuntimeConfig)
const mockToModelProfileAndAuth = vi.mocked(toModelProfileAndAuth)

const SELF_HOST = '127.0.0.1:4317'
const SAME_SITE: IncomingHttpHeaders = { 'content-type': 'application/json', host: SELF_HOST }
const SECRET = 'sk-connect-secret-429-10'
const CONNECT = '/api/llm/connect'

const WORKSPACE = [
  'workspace:',
  '  testMatch:',
  '    - tests/**/*.yaml',
  '  suiteMatch:',
  '    - suites/**/*.suite.yaml',
  '  hooksFile: hooks.yaml',
  '  envFile: .env',
  '  secretsFile: .env.secrets.local',
  'services: {}',
]

const USE_TAIL = [
  '  timeout:',
  '    step: 30s',
  '    test: 10m',
  '    navigation: 10s',
  '  mobile:',
  '    appState: preserve',
]

// A project with no model at all: the first connect becomes the default.
const NO_MODEL_CONFIG = [...WORKSPACE, 'registry: {}', 'use:', ...USE_TAIL, ''].join('\n')

// A project whose default names a model that is on disk.
const WITH_DEFAULT_CONFIG = [
  ...WORKSPACE,
  'registry:',
  '  llms:',
  '    - name: existing',
  '      provider: openai-compatible',
  '      model: gpt-4o',
  '      baseURL: https://api.existing.test/v1',
  'use:',
  '  llm: existing',
  ...USE_TAIL,
  '',
].join('\n')

// Parses as YAML but fails whole-config validation, so applyChanges refuses whatever is appended.
const INVALID_SCHEMA_CONFIG = [...WORKSPACE, 'registry: {}', 'use:', ...USE_TAIL, 'bogusTopLevel: 1', ''].join('\n')

interface MockResponse {
  status: number
  headers: Record<string, string>
  body: string
}

let router: ReturnType<typeof createRouter>
let configPath = ''
let tempDirs: string[] = []

function createMockRequest(
  url: string,
  options: { method?: string; headers?: IncomingHttpHeaders; body?: string },
): IncomingMessage {
  const req = new IncomingMessage(new Socket())
  req.method = options.method ?? 'GET'
  req.url = url
  req.headers = options.headers ?? {}
  process.nextTick(() => {
    if (options.body) req.push(Buffer.from(options.body))
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
        for (const [key, value] of Object.entries(head ?? {})) headers.set(key.toLowerCase(), String(value))
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
        if (chunk) body += Buffer.isBuffer(chunk) ? chunk.toString('utf-8') : chunk
        resolve({ status, headers: Object.fromEntries(headers), body })
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

function connect(body: unknown, headers: IncomingHttpHeaders = SAME_SITE): Promise<MockResponse> {
  return invokeRoute(CONNECT, { method: 'POST', headers, body: JSON.stringify(body) })
}

async function useConfig(yaml: string): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'agent-qa-llm-connect-'))
  tempDirs.push(dir)
  configPath = join(dir, 'agent-qa.config.yaml')
  await writeFile(configPath, yaml, 'utf-8')
  router = createRouter({ db: { getRuns: () => [], close() {} } as any, configManager: new ConfigManager(configPath), configPath })
}

async function fileText(): Promise<string> {
  return readFile(configPath, 'utf-8')
}

async function fileConfig(): Promise<{ registry?: { llms?: Array<Record<string, unknown>> }; use?: { llm?: string } }> {
  return parseYaml(await fileText()) as { registry?: { llms?: Array<Record<string, unknown>> }; use?: { llm?: string } }
}

const keyDraft = (overrides: Record<string, unknown> = {}) => ({
  name: 'gpt-5.6',
  provider: 'openai-compatible',
  model: 'gpt-5.6',
  baseURL: 'https://api.example.test/v1',
  credential: { type: 'api-key', secret: SECRET },
  ...overrides,
})

beforeEach(async () => {
  vi.clearAllMocks()
  authStore.current = {}
  mockGenerateText.mockImplementation(() => Promise.resolve({ text: 'ok' }) as never)
  await useConfig(NO_MODEL_CONFIG)
})

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })))
  tempDirs = []
})

describe('POST /api/llm/connect, key mode (429-10 Task 1)', () => {
  it('CONNECT-NOTHING-WRITTEN-ON-FAIL: a failed test answers the shared sentence and writes nothing', async () => {
    const before = await fileText()
    mockGenerateText.mockRejectedValueOnce(new Error('401 unauthorized'))

    const res = await connect(keyDraft())

    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toEqual({
      success: false,
      errorClass: 'auth_error',
      message: 'Authentication failed. Check the saved credential for this config.',
    })
    expect(mockWriteAuth).not.toHaveBeenCalled()
    expect(authStore.current).toEqual({})
    expect(await fileText()).toBe(before)
  })

  it('CONNECT-REACHES-AUTH-FROM-RUNTIME-CONFIG: the typed key becomes the model auth through authFromRuntimeConfig', async () => {
    const res = await connect(keyDraft())

    expect(res.status).toBe(200)
    expect(mockAuthFromRuntimeConfig).toHaveBeenCalledWith({ apiKey: SECRET })
    const produced = mockAuthFromRuntimeConfig.mock.results[0]?.value
    expect(produced).toEqual({ kind: 'api-key', apiKey: SECRET })
    expect(mockToModelProfileAndAuth).toHaveBeenCalledTimes(1)
    expect(mockToModelProfileAndAuth.mock.calls[0]?.[1]).toBe(produced)
  })

  it('CONNECT-PASS-SAVES: a pass writes the credential, then the definition and the default in one write', async () => {
    const order: string[] = []
    mockWriteAuth.mockImplementationOnce(async (name: string, credential: unknown) => {
      order.push(`auth:${(await fileConfig()).registry?.llms?.length ?? 0}`)
      authStore.current = { ...authStore.current, [name]: credential }
    })

    const res = await connect(keyDraft())

    expect(res.status).toBe(200)
    const answer = JSON.parse(res.body)
    const text = await fileText()
    expect(answer).toEqual({
      success: true,
      saved: true,
      becameDefault: true,
      usedCredential: true,
      revision: createHash('sha256').update(text, 'utf-8').digest('hex'),
    })
    expect(order).toEqual(['auth:0'])
    expect(mockWriteAuth).toHaveBeenCalledWith('gpt-5.6', { type: 'api', provider: 'openai-compatible', key: SECRET })
    const config = await fileConfig()
    expect(config.registry?.llms).toEqual([
      { name: 'gpt-5.6', provider: 'openai-compatible', model: 'gpt-5.6', baseURL: 'https://api.example.test/v1' },
    ])
    expect(config.use?.llm).toBe('gpt-5.6')
    expect(text).not.toContain(SECRET)
  })

  it('CONNECT-KEEPS-EXISTING-DEFAULT: with a valid default already set, the new model does not take it', async () => {
    await useConfig(WITH_DEFAULT_CONFIG)

    const res = await connect(keyDraft())

    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toMatchObject({ success: true, saved: true, becameDefault: false, usedCredential: true })
    const config = await fileConfig()
    expect(config.use?.llm).toBe('existing')
    expect(config.registry?.llms?.map((llm) => llm.name)).toEqual(['existing', 'gpt-5.6'])
  })

  it('CONNECT-SKIP-TEST-SAVES: skipTest never calls the provider and writes the credential and definition', async () => {
    mockGenerateText.mockRejectedValue(new Error('401 unauthorized'))

    const res = await connect(keyDraft({ skipTest: true }))

    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toMatchObject({ success: true, saved: true, becameDefault: true, usedCredential: true })
    expect(mockGenerateText).not.toHaveBeenCalled()
    expect(authStore.current['gpt-5.6']).toEqual({ type: 'api', provider: 'openai-compatible', key: SECRET })
    expect((await fileConfig()).registry?.llms?.map((llm) => llm.name)).toEqual(['gpt-5.6'])
  })

  it('CONNECT-WRITE-FAILURE-ROLLS-BACK-CREDENTIAL: a refused config write removes a credential this request created', async () => {
    await useConfig(INVALID_SCHEMA_CONFIG)
    const before = await fileText()

    const res = await connect(keyDraft())

    expect(res.status).toBe(422)
    expect(JSON.parse(res.body)).toMatchObject({ error: 'validation_failed' })
    expect(mockWriteAuth).toHaveBeenCalledTimes(1)
    expect(mockRemoveAuth).toHaveBeenCalledWith('gpt-5.6')
    expect(authStore.current).toEqual({})
    expect(await fileText()).toBe(before)
  })

  it('CONNECT-WRITE-FAILURE-ROLLS-BACK-CREDENTIAL: a credential that existed before is never removed', async () => {
    await useConfig(INVALID_SCHEMA_CONFIG)
    const saved = { type: 'api', provider: 'openai-compatible', key: 'sk-saved-before' }
    authStore.current = { 'gpt-5.6': saved }

    const res = await connect(keyDraft())

    expect(res.status).toBe(422)
    expect(JSON.parse(res.body)).toMatchObject({ error: 'validation_failed' })
    expect(mockRemoveAuth).not.toHaveBeenCalled()
    expect(authStore.current).toEqual({ 'gpt-5.6': saved })
  })
})

const FOREIGN_ORIGIN = 'http://evil.example'
const CROSS_SITE_CALLERS: readonly { readonly name: string; readonly headers: IncomingHttpHeaders }[] = [
  { name: 'a foreign Origin', headers: { ...SAME_SITE, origin: FOREIGN_ORIGIN } },
  { name: 'Sec-Fetch-Site cross-site with no Origin', headers: { ...SAME_SITE, 'sec-fetch-site': 'cross-site' } },
  { name: 'a rebound Host', headers: { 'content-type': 'application/json', host: 'evil.example:4317', origin: 'http://evil.example:4317' } },
]

describe('the connect door (429-10 Task 1)', () => {
  for (const caller of CROSS_SITE_CALLERS) {
    it(`CONNECT-SAME-SITE: ${caller.name} is refused with 403 and no cross-origin grant`, async () => {
      const before = await fileText()

      const res = await connect(keyDraft(), caller.headers)

      expect(res.status).toBe(403)
      expect(JSON.parse(res.body)).toEqual({ error: 'cross_site_refused' })
      expect(res.headers['access-control-allow-origin']).toBeUndefined()
      expect(mockReadAuth).not.toHaveBeenCalled()
      expect(mockGenerateText).not.toHaveBeenCalled()
      expect(mockWriteAuth).not.toHaveBeenCalled()
      expect(await fileText()).toBe(before)
    })
  }

  it('CONNECT-SAME-SITE: an admitted answer carries no cross-origin grant', async () => {
    const res = await connect(keyDraft())
    expect(res.status).toBe(200)
    expect(res.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('CONNECT-NO-SECRET-IN-ANSWER: no answer and no console line ever holds the typed secret', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => undefined))
    try {
      const bodies: string[] = []
      mockGenerateText.mockRejectedValueOnce(new Error(`Upstream echoed ${SECRET} back`))
      bodies.push((await connect(keyDraft())).body)
      mockGenerateText.mockRejectedValueOnce(new Error('401 unauthorized'))
      bodies.push((await connect(keyDraft())).body)
      bodies.push((await connect(keyDraft({ name: 'Bad Name' }))).body)
      bodies.push((await connect(keyDraft({ provider: 'openai-subscription' }))).body)
      bodies.push((await connect(keyDraft())).body)
      bodies.push((await connect(keyDraft())).body)

      expect(bodies).toHaveLength(6)
      expect(JSON.parse(bodies[0]!)).toMatchObject({ success: false, errorClass: 'provider_error' })
      expect(JSON.parse(bodies[4]!)).toMatchObject({ success: true })
      for (const body of bodies) expect(body).not.toContain(SECRET)
      for (const spy of spies) {
        for (const call of spy.mock.calls) expect(JSON.stringify(call)).not.toContain(SECRET)
      }
    } finally {
      for (const spy of spies) spy.mockRestore()
    }
  })
})
