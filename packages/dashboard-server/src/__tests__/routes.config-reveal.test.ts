import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { IncomingMessage, type IncomingHttpHeaders, type ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { readAuth } from '@vostride/agent-qa-core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ConfigManager } from '../config/index.js'
import { createRouter } from '../server/routes.js'

vi.mock('@vostride/agent-qa-core', async () => {
  const actual =
    await vi.importActual<typeof import('@vostride/agent-qa-core')>('@vostride/agent-qa-core')
  return {
    ...actual,
    getAgentQaVersion: vi.fn(() => '0.1.13'),
    readAuth: vi.fn(() =>
      Promise.resolve({
        gpt: { type: 'api-key', provider: 'anthropic-compatible', key: 'sk-live-AUTH-DO-NOT-LEAK' },
      }),
    ),
    writeAuth: vi.fn(() => Promise.resolve()),
    removeAuth: vi.fn(() => Promise.resolve()),
  }
})

const mockReadAuth = vi.mocked(readAuth)

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

const FARM_KEY = 'sk-live-FARM-DO-NOT-LEAK'
const HEADER_VALUE = 'sk-live-HEADER-DO-NOT-LEAK'
const ENV_TOKEN = 'sk-live-ENV-DO-NOT-LEAK'
const AUTH_KEY = 'sk-live-AUTH-DO-NOT-LEAK'
const FOREIGN_ORIGIN = 'http://evil.example'

const revealConfig = [
  'workspace:',
  '  testMatch:',
  '    - tests/**/*.yaml',
  '  suiteMatch:',
  '    - suites/**/*.suite.yaml',
  '  hooksFile: hooks.yaml',
  '  envFile: .env',
  '  secretsFile: .env.secrets.local',
  'services:',
  '  mcp:',
  '    enabled: true',
  '    port: 3471',
  'registry:',
  '  llms:',
  '    - name: gpt',
  '      provider: anthropic-compatible',
  '      model: claude-proxy',
  '      baseURL: https://llm.example.test/v1',
  '      providerHeaders:',
  `        x-org-route: ${HEADER_VALUE}`,
  '  providers:',
  '    farm:',
  '      username: owner',
  `      accessKey: ${FARM_KEY}`,
  'use:',
  '  llm: gpt',
  '  timeout:',
  '    step: 30s',
  '    test: 10m',
  '    navigation: 10s',
  '  mobile:',
  '    appState: preserve',
  '',
].join('\n')

async function useConfigWorkspace(): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'agent-qa-config-reveal-'))
  tempDirs.push(dir)
  const configPath = join(dir, 'agent-qa.config.yaml')
  await writeFile(configPath, revealConfig, 'utf-8')
  router = createRouter({
    db: createMockDatabase() as any,
    configManager: new ConfigManager(configPath, (text) => text),
    configPath,
  })
}

const SAME_SITE = { host: HOST, origin: `http://${HOST}`, 'sec-fetch-site': 'same-origin' }

function reveal(path: unknown[], headers: IncomingHttpHeaders = SAME_SITE): Promise<MockResponse> {
  return invokeRoute('/api/config/reveal', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ path }),
  })
}

const FARM_PATH = ['registry', 'providers', 'farm', 'accessKey']

afterEach(async () => {
  vi.restoreAllMocks()
  mockReadAuth.mockClear()
  delete process.env.AGENT_QA_MCP_TOKEN
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('POST /api/config/reveal (429-06)', () => {
  it('REVEAL-SAME-SITE-ONLY: a foreign Origin, a cross-site fetch and a rebound Host are refused with no grant', async () => {
    await useConfigWorkspace()
    const callers: Array<{ name: string; headers: IncomingHttpHeaders }> = [
      { name: 'a foreign Origin', headers: { host: HOST, origin: FOREIGN_ORIGIN } },
      {
        name: 'Sec-Fetch-Site cross-site with no Origin',
        headers: { host: HOST, 'sec-fetch-site': 'cross-site' },
      },
      { name: 'a rebound Host', headers: { host: 'evil.test' } },
    ]

    for (const caller of callers) {
      const answer = await reveal(FARM_PATH, caller.headers)
      expect(answer.status, caller.name).toBe(403)
      expect(JSON.parse(answer.body), caller.name).toEqual({ error: 'cross_site_refused' })
      expect(answer.headers['access-control-allow-origin'], caller.name).toBeUndefined()
      expect(answer.body).not.toContain(FARM_KEY)
    }

    const admitted = await reveal(FARM_PATH, SAME_SITE)
    expect(admitted.status).toBe(200)
    const local = await reveal(FARM_PATH, { host: HOST })
    expect(local.status).toBe(200)
  })

  it('REVEAL-POST-ONLY: every other method answers 405 with no grant, a preflight included', async () => {
    await useConfigWorkspace()

    for (const method of ['GET', 'PUT', 'DELETE', 'OPTIONS']) {
      const answer = await invokeRoute('/api/config/reveal', { method, headers: SAME_SITE })
      expect(answer.status, method).toBe(405)
      expect(JSON.parse(answer.body), method).toEqual({ error: 'method_not_allowed' })
      expect(answer.headers['access-control-allow-origin'], method).toBeUndefined()
    }

    const notJson = await invokeRoute('/api/config/reveal', {
      method: 'POST',
      headers: { ...SAME_SITE, 'content-type': 'text/plain' },
      body: JSON.stringify({ path: FARM_PATH }),
    })
    expect(notJson.status).toBe(400)
    expect(JSON.parse(notJson.body)).toEqual({ error: 'invalid_write_input' })
  })

  // 432-22 (D-12): the env-var-name witness was the MCP token variable, deleted with the token list;
  // a plain MCP leaf stands in beside the plain timeout.
  it('REVEAL-SECRET-PATHS-ONLY: plain paths are refused (no leaf is an env-var name since 432-22)', async () => {
    await useConfigWorkspace()
    process.env.AGENT_QA_MCP_TOKEN = ENV_TOKEN

    for (const path of [
      ['use', 'timeout', 'step'],
      ['services', 'mcp', 'port'],
    ]) {
      const answer = await reveal(path)
      expect(answer.status, JSON.stringify(path)).toBe(422)
      expect(JSON.parse(answer.body)).toEqual({ error: 'reveal_not_secret' })
      expect(answer.body).not.toContain(ENV_TOKEN)
    }
  })

  it('REVEAL-RETURNS-ONE-VALUE: one secret-class path answers its value, uncached and with no grant', async () => {
    await useConfigWorkspace()

    const answer = await reveal(FARM_PATH)

    expect(answer.status).toBe(200)
    expect(JSON.parse(answer.body)).toEqual({ value: FARM_KEY })
    expect(answer.headers['cache-control']).toBe('no-store')
    expect(answer.headers['access-control-allow-origin']).toBeUndefined()
    expect(answer.body).not.toContain(HEADER_VALUE)

    const header = await reveal([
      'registry',
      'llms',
      { name: 'gpt' },
      'providerHeaders',
      'x-org-route',
    ])
    expect(header.status).toBe(200)
    expect(JSON.parse(header.body)).toEqual({ value: HEADER_VALUE })
    expect(header.headers['cache-control']).toBe('no-store')
  })

  it('REVEAL-NEVER-AUTH-JSON: a saved credential that is not in the file is not found and auth.json is never read', async () => {
    await useConfigWorkspace()

    const answer = await reveal(['registry', 'llms', { name: 'gpt' }, 'apiKey'])

    expect(answer.status).toBe(404)
    expect(JSON.parse(answer.body)).toEqual({ error: 'reveal_not_found' })
    expect(answer.body).not.toContain(AUTH_KEY)
    expect(mockReadAuth).not.toHaveBeenCalled()
  })

  it('REVEAL-NOT-LOGGED: no console channel ever receives the revealed value', async () => {
    await useConfigWorkspace()
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((channel) =>
      vi.spyOn(console, channel).mockImplementation(() => undefined),
    )

    expect((await reveal(FARM_PATH)).status).toBe(200)
    expect((await reveal(['registry', 'providers', 'farm', 'missing'])).status).toBe(404)
    expect((await reveal(['use', 'timeout', 'step'])).status).toBe(422)
    expect((await reveal(FARM_PATH, { host: HOST, origin: FOREIGN_ORIGIN })).status).toBe(403)

    for (const spy of spies) {
      const logged = spy.mock.calls
        .map((args) => args.map((arg) => String(arg)).join(' '))
        .join('\n')
      expect(logged).not.toContain(FARM_KEY)
    }
  })
})
