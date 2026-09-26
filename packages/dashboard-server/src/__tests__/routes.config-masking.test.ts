import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { IncomingMessage, type IncomingHttpHeaders, type ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { afterEach, describe, expect, it, vi } from 'vitest'
import { CONFIG_MASK_PLACEHOLDER } from '@vostride/agent-qa-schema'

import { ConfigManager } from '../config/index.js'
import { createRouter } from '../server/routes.js'

const AUTH_SENTINEL = 'sk-live-AUTH-DO-NOT-LEAK'

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

interface MockResponse {
  status: number
  headers: Record<string, string>
  body: string
}

interface FileLine {
  n: number
  text: string
  class?: string
  path?: unknown[]
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

const SENTINELS = {
  header: 'sk-live-HEADER-DO-NOT-LEAK',
  farm: 'sk-live-FARM-DO-NOT-LEAK',
  udid: 'UDID-DO-NOT-LEAK-0001',
  attribute: 'ATTR-DO-NOT-LEAK-main',
  secretsFile: 'secrets-DO-NOT-LEAK.local',
  certificate: 'CERT-DO-NOT-LEAK-line',
}

const secretConfig = [
  '# owner notes: the farm key rotates monthly',
  'workspace:',
  '  testMatch:',
  '    - tests/**/*.yaml',
  '  suiteMatch:',
  '    - suites/**/*.suite.yaml',
  '  hooksFile: hooks.yaml',
  '  envFile: .env',
  `  secretsFile: ${SENTINELS.secretsFile}`,
  'services:',
  '  mcp:',
  '    tokens:',
  '      - name: ci',
  '        tokenEnvVar: AGENT_QA_MCP_TOKEN',
  '        scopes:',
  '          - read',
  'registry:',
  '  llms:',
  '    - name: gpt',
  '      provider: anthropic-compatible',
  '      model: claude-proxy',
  '      baseURL: https://llm.example.test/v1',
  '      providerHeaders:',
  `        x-org-route: ${SENTINELS.header}`,
  '  providers:',
  '    farm:',
  `      accessKey: ${SENTINELS.farm} # rotated by the owner`,
  '      certificate: |',
  `        ${SENTINELS.certificate}-one`,
  `        ${SENTINELS.certificate}-two`,
  '  devices:',
  '    phone:',
  '      platform: ios',
  '      transport: local',
  '      match:',
  `        udid: ${SENTINELS.udid}`,
  'analytics:',
  '  passRateScope:',
  '    attributes:',
  `      branch: ${SENTINELS.attribute}`,
  'plugins:',
  '  auth:',
  '    - package: "@example/agent-qa-auth"',
  'use:',
  '  llm: gpt',
  '  mobile:',
  '    appState: preserve',
  '',
].join('\n')

async function useConfigWorkspace(initialConfig = secretConfig): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'agent-qa-config-masking-'))
  tempDirs.push(dir)
  const configPath = join(dir, 'agent-qa.config.yaml')
  await writeFile(configPath, initialConfig, 'utf-8')
  router = createRouter({
    db: createMockDatabase() as any,
    configManager: new ConfigManager(configPath),
    configPath,
  })
  return configPath
}

const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex')

async function getConfig() {
  const response = await invokeRoute('/api/config', { headers: { host: HOST } })
  return { response, body: JSON.parse(response.body) as Record<string, any> }
}

async function getRevision(): Promise<string> {
  const response = await invokeRoute('/api/config/revision', { headers: { host: HOST } })
  expect(response.status).toBe(200)
  return (JSON.parse(response.body) as { revision: string }).revision
}

function lineHolding(lines: FileLine[], fragment: string): FileLine {
  const line = lines.find((candidate) => candidate.text.includes(fragment))
  expect(line, `a line holding ${fragment}`).toBeDefined()
  return line!
}

afterEach(async () => {
  vi.clearAllMocks()
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('GET /api/config masked by the one map (429-06)', () => {
  it('GET-CARRIES-NO-SECRET: every secret-class value reads [masked] whole and no auth.json value is sent', async () => {
    await useConfigWorkspace()

    const { response, body } = await getConfig()

    expect(response.status).toBe(200)
    for (const sentinel of [...Object.values(SENTINELS), AUTH_SENTINEL]) {
      expect(response.body).not.toContain(sentinel)
    }
    expect(response.body).not.toContain('DO-NOT-LEAK')
    const { config } = body
    expect(config.registry.llms[0].providerHeaders['x-org-route']).toBe(CONFIG_MASK_PLACEHOLDER)
    expect(config.registry.providers.farm.accessKey).toBe(CONFIG_MASK_PLACEHOLDER)
    expect(config.registry.providers.farm.certificate).toBe(CONFIG_MASK_PLACEHOLDER)
    expect(config.registry.devices.phone.match.udid).toBe(CONFIG_MASK_PLACEHOLDER)
    expect(config.analytics.passRateScope.attributes.branch).toBe(CONFIG_MASK_PLACEHOLDER)
    expect(config.workspace.secretsFile).toBe(CONFIG_MASK_PLACEHOLDER)
    expect(config.registry.llms[0].baseURL).toBe('https://llm.example.test/v1')
    const lines = body.file.lines as FileLine[]
    expect(lineHolding(lines, 'accessKey:').text).toBe(
      `      accessKey: "${CONFIG_MASK_PLACEHOLDER}" # rotated by the owner`,
    )
    expect(lineHolding(lines, 'x-org-route:').text).toBe(
      `        x-org-route: "${CONFIG_MASK_PLACEHOLDER}"`,
    )
  })

  it('ENV-VAR-NAME-IN-CLEAR: an MCP token env-var name reads in clear in the payload and the file view', async () => {
    await useConfigWorkspace()

    const { body } = await getConfig()

    expect(body.config.services.mcp.tokens[0].tokenEnvVar).toBe('AGENT_QA_MCP_TOKEN')
    const line = lineHolding(body.file.lines, 'tokenEnvVar:')
    expect(line).toEqual({
      n: line.n,
      text: '        tokenEnvVar: AGENT_QA_MCP_TOKEN',
      class: 'env-var-name',
    })
  })

  it('GET-HAS-REVISION-AND-FILE: config and provider stay, revision and the file view are added', async () => {
    const configPath = await useConfigWorkspace()

    const { response, body } = await getConfig()

    expect(response.status).toBe(200)
    expect(body.provider).toBe('anthropic-compatible')
    expect(body.config.use.llm).toBe('gpt')
    expect(body.revision).toBe(sha256(await readFile(configPath)))
    expect(body.file.path).toBe(configPath)
    const lines = body.file.lines as FileLine[]
    expect(lines.map((line) => line.n)).toEqual(lines.map((_, i) => i + 1))
    expect(lines[0]).toEqual({ n: 1, text: '# owner notes: the farm key rotates monthly' })
    expect(lineHolding(lines, 'package:').text).toBe('    - package: "@example/agent-qa-auth"')
    expect(body).not.toHaveProperty('fileIssues')
  })

  it('FILE-VIEW-LINES-CLASSED: secret lines carry their class and path, tagged on the masked text', async () => {
    await useConfigWorkspace()

    const { body } = await getConfig()
    const lines = body.file.lines as FileLine[]

    expect(lineHolding(lines, 'accessKey:')).toMatchObject({
      class: 'secret',
      path: ['registry', 'providers', 'farm', 'accessKey'],
    })
    expect(lineHolding(lines, 'x-org-route:')).toMatchObject({
      class: 'secret',
      path: ['registry', 'llms', { name: 'gpt' }, 'providerHeaders', 'x-org-route'],
    })
    expect(lineHolding(lines, 'udid:')).toMatchObject({
      class: 'secret',
      path: ['registry', 'devices', 'phone', 'match', 'udid'],
    })
    expect(lineHolding(lines, 'branch:')).toMatchObject({
      class: 'secret',
      path: ['analytics', 'passRateScope', 'attributes', 'branch'],
    })
    expect(lineHolding(lines, 'secretsFile:')).toMatchObject({
      class: 'secret',
      path: ['workspace', 'secretsFile'],
    })
    // The two-line block scalar is masked onto one line, so the view is one line shorter than the file.
    const certificate = lineHolding(lines, 'certificate:')
    expect(certificate).toMatchObject({
      text: `      certificate: "${CONFIG_MASK_PLACEHOLDER}"`,
      class: 'secret',
    })
    expect(lines[certificate.n]!.text).toBe('  devices:')
    expect(lines).toHaveLength(secretConfig.trimEnd().split('\n').length - 2)
    for (const plain of [
      '  llm: gpt',
      '      baseURL: https://llm.example.test/v1',
      '    appState: preserve',
    ]) {
      const line = lineHolding(lines, plain)
      expect(line).not.toHaveProperty('class')
      expect(line).not.toHaveProperty('path')
    }
  })

  it('REVISION-CHANGES-ON-OUTSIDE-EDIT: the revision read follows the bytes and matches a PATCH answer', async () => {
    const configPath = await useConfigWorkspace()

    const first = await getRevision()
    expect(first).toBe((await getConfig()).body.revision)

    const outside = secretConfig.replace('appState: preserve', 'appState: reset')
    await writeFile(configPath, outside, 'utf-8')
    const second = await getRevision()
    expect(second).not.toBe(first)
    expect(second).toBe(sha256(outside))

    const patch = await invokeRoute('/api/config', {
      method: 'PATCH',
      headers: { host: HOST, 'content-type': 'application/json' },
      body: JSON.stringify({
        changes: [
          { op: 'set', path: ['use', 'llm'], value: 'gpt' },
          { op: 'set', path: ['use', 'mobile', 'appState'], value: 'preserve' },
        ],
      }),
    })
    expect(patch.status).toBe(200)
    const written = (JSON.parse(patch.body) as { revision: string }).revision
    expect(await getRevision()).toBe(written)

    await rm(configPath)
    expect(await getRevision()).toBe('absent')
  })

  it('GET-FILE-INVALID-NAMED: a file that does not parse is named with 409 and the revision still answers', async () => {
    const configPath = await useConfigWorkspace()
    const broken = `a: 1\nb: [1, ${SENTINELS.farm}\nc: 3\n`
    await writeFile(configPath, broken, 'utf-8')

    const { response, body } = await getConfig()

    expect(response.status).toBe(409)
    expect(body.error).toBe('file_invalid')
    expect(typeof body.message).toBe('string')
    expect(body.message).not.toBe('')
    expect(response.body).not.toContain(SENTINELS.farm)
    expect(Object.keys(body).sort()).toEqual(['error', 'message'])
    expect(await getRevision()).toBe(sha256(broken))

    await writeFile(configPath, secretConfig, 'utf-8')
    expect((await getConfig()).response.status).toBe(200)
  })

  it('GET-FILE-ISSUES: a file that parses but fails whole-config validation answers 200 naming each issue', async () => {
    await useConfigWorkspace(secretConfig.replace('  llm: gpt', '  llm: missing-model'))

    const { response, body } = await getConfig()

    expect(response.status).toBe(200)
    expect(body.config.use.llm).toBe('missing-model')
    const issues = body.fileIssues as Array<{ path: Array<string | number>; message: string }>
    expect(Array.isArray(issues)).toBe(true)
    expect(issues.length).toBeGreaterThan(0)
    expect(issues.some((issue) => issue.message.includes('missing-model'))).toBe(true)
    for (const issue of issues) {
      expect(Array.isArray(issue.path)).toBe(true)
      expect(typeof issue.message).toBe('string')
    }
    expect(response.body).not.toContain('DO-NOT-LEAK')
  })
})
