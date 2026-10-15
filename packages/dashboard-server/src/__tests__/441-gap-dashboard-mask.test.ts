import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { IncomingMessage, type IncomingHttpHeaders, type ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRunHook, mockResolveLLMAuth, mockGenerateText } = vi.hoisted(() => ({
  mockRunHook: vi.fn(),
  mockResolveLLMAuth: vi.fn(),
  mockGenerateText: vi.fn(),
}))

vi.mock('@vostride/agent-qa-runner-local', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@vostride/agent-qa-runner-local')>()),
  DockerHookExecutor: class { execute(...args: unknown[]) { return mockRunHook(...args) } },
}))

vi.mock('@vostride/agent-qa-core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@vostride/agent-qa-core')>()),
  resolveLLMAuth: mockResolveLLMAuth,
}))

vi.mock('@vostride/agent-qa-model', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@vostride/agent-qa-model')>()),
  createModel: vi.fn(() => ({})),
}))

vi.mock('ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('ai')>()),
  generateText: mockGenerateText,
}))

import { ConfigManager, readConfigValues } from '../config/index.js'
import { createRouter } from '../server/routes.js'
import { resolveWorkspacePaths, type ResolvedWorkspacePaths } from '@vostride/agent-qa-core'

const VALUE = 'Hunter-42-zz'
const MARKER = '[secret:PW_441]'
const HOOK_ID = 'h_amber-birch-coral-delta-ember-falcon-garden-harbor-island-jungle'
const ROUTER_DB_STUB = {
  getRuns: vi.fn(() => []),
  insertRun: vi.fn(),
  insertStep: vi.fn(),
  insertExecutionLog: vi.fn(),
} as any

const declaredMask = (text: string): string => text.split(VALUE).join(MARKER)
const throwingMask = (): string => {
  throw new Error('declared secrets unavailable')
}

interface MockResponse {
  status: number
  body: string
}

let tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })))
  tempDirs = []
})

beforeEach(() => {
  vi.clearAllMocks()
})

function invokeRoute(
  router: ReturnType<typeof createRouter>,
  url: string,
  options: { method?: string; headers?: IncomingHttpHeaders; body?: string } = {},
): Promise<MockResponse> {
  return new Promise((resolve, reject) => {
    const req = new IncomingMessage(new Socket())
    req.method = options.method ?? 'GET'
    req.url = url
    req.headers = options.headers ?? {}
    process.nextTick(() => {
      if (options.body) req.push(Buffer.from(options.body))
      req.push(null)
    })
    let status = 200
    let body = ''
    const res = {
      writeHead(statusCode: number) {
        status = statusCode
        return this
      },
      setHeader() {},
      getHeader() {
        return undefined
      },
      write(chunk: string | Buffer) {
        body += chunk.toString()
        return true
      },
      end(chunk?: string | Buffer) {
        if (chunk) body += chunk.toString()
        resolve({ status, body })
      },
    } as unknown as ServerResponse
    try {
      router(req, res)
    } catch (error) {
      reject(error)
    }
  })
}

async function hookWorkspace(): Promise<{
  configManager: ConfigManager
  configPath: string
  workspacePaths: ResolvedWorkspacePaths
}> {
  const dir = await mkdtemp(join(tmpdir(), 'agent-qa-441-gap-dashboard-'))
  tempDirs.push(dir)
  const configPath = join(dir, 'config.yaml')
  await writeFile(configPath, [
    'workspace:',
    '  testMatch:',
    '    - specs/web/**/*.yaml',
    '  suiteMatch:',
    '    - cases/**/*.suite.yaml',
    '  envFile: ./.env',
    '  secretsFile: .env.secrets.local',
    '  hooksFile: ./hooks.yaml',
    'use:',
    '  mobile:',
    '    appState: preserve',
    '',
  ].join('\n'))
  await writeFile(join(dir, 'hooks.yaml'), [
    'hooks:',
    `  - id: ${HOOK_ID}`,
    '    name: login',
    '    runtime: node',
    '    file: ./scripts/login.js',
    '    timeout: 30s',
    '    network: true',
    '',
  ].join('\n'))
  await mkdir(dirname(join(dir, 'scripts/login.js')), { recursive: true })
  await writeFile(join(dir, 'scripts/login.js'), 'console.log("login")\n')
  await writeFile(join(dir, '.env'), '')
  const configManager = new ConfigManager(configPath, (text) => text)
  return {
    configManager,
    configPath,
    workspacePaths: resolveWorkspacePaths({
      config: await readConfigValues(configManager) as any,
      configPath,
    }),
  }
}

const SAVED_HEADER = 'sk-header-saved-441'
const SAVED_BASE_URL = 'https://proxy.example/v1'
const LLM_TEST_HEADERS: IncomingHttpHeaders = { 'content-type': 'application/json', host: '127.0.0.1:4317' }

const BASE_LINES = [
  'workspace:',
  '  testMatch:',
  '    - tests/**/*.yaml',
  '  suiteMatch:',
  '    - suites/**/*.suite.yaml',
  '  hooksFile: hooks.yaml',
  '  envFile: .env',
  '  secretsFile: .env.secrets.local',
  'registry:',
  '  llms:',
  '    - name: proxy',
  '      provider: anthropic-compatible',
  '      model: claude-proxy',
  `      baseURL: ${SAVED_BASE_URL}`,
  '      providerHeaders:',
  `        X-Org: ${SAVED_HEADER}`,
  '  targets:',
  `    qa-${VALUE}:`,
  '      platform: web',
  '      url: https://shop.test',
  'use:',
  '  llm: proxy',
  '  mobile:',
  '    appState: preserve',
  '',
]

async function configWorkspace(lines: readonly string[] = BASE_LINES): Promise<{
  configManager: ConfigManager
  configPath: string
}> {
  const dir = await mkdtemp(join(tmpdir(), 'agent-qa-441-gap-config-'))
  tempDirs.push(dir)
  const configPath = join(dir, 'agent-qa.config.yaml')
  await writeFile(configPath, lines.join('\n'))
  return { configManager: new ConfigManager(configPath, (text) => text), configPath }
}

function testConnection(router: ReturnType<typeof createRouter>): Promise<MockResponse> {
  return invokeRoute(router, '/api/llm/test', {
    method: 'POST',
    headers: LLM_TEST_HEADERS,
    body: JSON.stringify({
      configName: 'proxy',
      provider: 'anthropic-compatible',
      model: 'claude-proxy',
      baseURL: SAVED_BASE_URL,
    }),
  })
}

function runHook(router: ReturnType<typeof createRouter>): Promise<MockResponse> {
  return invokeRoute(router, `/api/hooks/${HOOK_ID}/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ overrides: [] }),
  })
}

describe('C441-GAP-DASHBOARD', () => {
  beforeEach(() => {
    mockRunHook.mockResolvedValue({
      success: true,
      output: `token ${VALUE}`,
      stdout: `logged in as ${VALUE}`,
      stderr: `warn: ${VALUE} expires soon`,
      error: `last error ${VALUE}`,
      variables: { [`KEY_${VALUE}`]: `value-${VALUE}`, PLAIN: 'kept' },
      duration: 5,
      networkLogs: [
        { url: `https://host.test/login?pw=${VALUE}`, method: 'POST', status: 200, startTime: 1, endTime: 3 },
      ],
    })
  })

  it('a hook run answers its output, variables and network log with a declared value only as its marker', async () => {
    const workspace = await hookWorkspace()
    const router = createRouter({ db: ROUTER_DB_STUB, ...workspace, declaredSecretMask: declaredMask })

    const res = await runHook(router)

    expect(res.status).toBe(200)
    expect(res.body).not.toContain(VALUE)
    const body = JSON.parse(res.body)
    expect(body).toMatchObject({
      success: true,
      status: 'passed',
      duration: 5,
      output: `token ${MARKER}`,
      stdout: `logged in as ${MARKER}`,
      stderr: `warn: ${MARKER} expires soon`,
      error: `last error ${MARKER}`,
      variables: { [`KEY_${MARKER}`]: `value-${MARKER}`, PLAIN: 'kept' },
      sandbox: { runtime: 'node', networkMode: 'enabled', networkLogsAvailable: true },
    })
    expect(body.sandbox.networkLogs[0]).toMatchObject({
      method: 'POST',
      url: `https://host.test/login?pw=${MARKER}`,
      statusCode: 200,
    })
  })

  it('a hook run whose mask throws answers masking_unavailable and no hook output', async () => {
    const workspace = await hookWorkspace()
    const router = createRouter({ db: ROUTER_DB_STUB, ...workspace, declaredSecretMask: throwingMask })

    const res = await runHook(router)

    expect(res.status).toBe(503)
    expect(JSON.parse(res.body)).toEqual({ error: 'masking_unavailable' })
    expect(res.body).not.toContain(VALUE)
    expect(res.body).not.toContain('logged in')
  })

  it('an LLM connection test answers provider error text with a declared value only as its marker', async () => {
    mockResolveLLMAuth.mockResolvedValue({ kind: 'unauthenticated', message: 'Testing without a saved credential.' })
    mockGenerateText.mockRejectedValue(Object.assign(
      new Error(`upstream echoed ${VALUE} and header ${SAVED_HEADER}`),
      { statusCode: 502 },
    ))
    const router = createRouter({ db: ROUTER_DB_STUB, ...await configWorkspace(), declaredSecretMask: declaredMask })

    const res = await testConnection(router)

    expect(res.status).toBe(200)
    expect(res.body).not.toContain(VALUE)
    expect(res.body).not.toContain(SAVED_HEADER)
    expect(JSON.parse(res.body)).toMatchObject({
      success: false,
      error: 'provider_error',
      message: `Connection failed. upstream echoed ${MARKER} and header [redacted]`,
      details: `upstream echoed ${MARKER} and header [redacted]`,
    })
  })

  it('the target list answers a name holding a declared value as its marker', async () => {
    const router = createRouter({ db: ROUTER_DB_STUB, ...await configWorkspace(), declaredSecretMask: declaredMask })

    const res = await invokeRoute(router, '/api/config/targets')

    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ targets: [`qa-${MARKER}`] })
  })

  it('with a mask that throws, the LLM test and the target list answer without provider text or names', async () => {
    mockResolveLLMAuth.mockResolvedValue({ kind: 'unauthenticated', message: 'Testing without a saved credential.' })
    mockGenerateText.mockRejectedValue(Object.assign(new Error(`upstream echoed ${VALUE}`), { statusCode: 502 }))
    const router = createRouter({ db: ROUTER_DB_STUB, ...await configWorkspace(), declaredSecretMask: throwingMask })

    const tested = await testConnection(router)
    expect(tested.status).toBe(200)
    expect(JSON.parse(tested.body)).toMatchObject({ success: false, error: 'provider_error', message: 'Connection failed.' })
    expect(JSON.parse(tested.body)).not.toHaveProperty('details')
    expect(tested.body).not.toContain('upstream')

    const targets = await invokeRoute(router, '/api/config/targets')
    expect(targets.status).toBe(500)
    expect(JSON.parse(targets.body)).toEqual({ error: 'masking_unavailable' })
  })

  // The target key is not a valid name, so the issue sits on the key holding the declared value.
  it('config issue paths show a key holding a declared value as its marker', async () => {
    const { configPath } = await configWorkspace()
    const manager = new ConfigManager(configPath, declaredMask)

    const refused = await manager.applyChanges([
      { op: 'set', path: ['registry', 'targets', `qa-${VALUE}`, 'platform'], value: 'nope' },
    ])
    expect(refused.kind).toBe('refused')
    if (refused.kind !== 'refused') return
    expect(refused.error).toBe('validation_failed')
    expect(JSON.stringify(refused)).not.toContain(VALUE)
    expect((refused.issues ?? []).some((issue) => issue.path.includes(`qa-${MARKER}`)), JSON.stringify(refused.issues)).toBe(true)

    const read = await manager.readMasked()
    expect(read.kind).toBe('ok')
    if (read.kind !== 'ok') return
    expect(JSON.stringify(read.fileIssues)).not.toContain(VALUE)
    expect(read.fileIssues.some((issue) => issue.path.includes(`qa-${MARKER}`)), JSON.stringify(read.fileIssues)).toBe(true)
  })
})
