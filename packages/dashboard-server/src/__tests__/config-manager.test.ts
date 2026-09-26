import { IncomingMessage, type IncomingHttpHeaders, type ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const {
  mockGetCredential,
  mockResolveLLMAuth,
  mockReadAuth,
  mockWriteAuth,
  mockRemoveAuth,
  mockCreateModel,
  mockGetProviderOptions,
  mockGenerateText,
} = vi.hoisted(() => ({
  mockGetCredential: vi.fn(),
  mockResolveLLMAuth: vi.fn(),
  mockReadAuth: vi.fn(),
  mockWriteAuth: vi.fn(),
  mockRemoveAuth: vi.fn(),
  mockCreateModel: vi.fn(),
  mockGetProviderOptions: vi.fn(),
  mockGenerateText: vi.fn(),
}))

vi.mock('@vostride/agent-qa-core', async () => {
  const actual = await vi.importActual<typeof import('@vostride/agent-qa-core')>('@vostride/agent-qa-core')
  const { z } = await import('zod')
  const modelConfigBaseSchema = z.object({
    provider: z.enum([
      'openai-compatible',
      'anthropic-compatible',
      'openai-subscription',
      'anthropic-subscription',
      'gemini',
    ]),
    model: z.string(),
    baseURL: z.string().optional(),
    providerHeaders: z.record(z.string(), z.string()).optional(),
  }).strict()
  const validateModelConfig = (config: { provider?: string; baseURL?: string; providerHeaders?: Record<string, string> }, ctx: { addIssue: (issue: any) => void }) => {
    if (
      (config.provider === 'openai-compatible' || config.provider === 'anthropic-compatible')
      && (!config.baseURL || config.baseURL.trim() === '')
    ) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['baseURL'], message: `Base URL is required for ${config.provider} providers.` })
    }
    if (config.providerHeaders !== undefined && config.provider !== 'anthropic-compatible') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['providerHeaders'], message: 'providerHeaders can only be used with anthropic-compatible providers.' })
    }
  }
  const ModelConfigSchema = modelConfigBaseSchema.superRefine(validateModelConfig)
  const NamedLLMConfigSchema = modelConfigBaseSchema.extend({
    name: actual.NameSlugSchema,
  }).strict().superRefine(validateModelConfig)
  return {
    ...actual,
    ModelConfigSchema,
    NamedLLMConfigSchema,
    getCredential: (...args: unknown[]) => mockGetCredential(...args),
    resolveLLMAuth: (...args: unknown[]) => mockResolveLLMAuth(...args),
    readAuth: (...args: unknown[]) => mockReadAuth(...args),
    writeAuth: (...args: unknown[]) => mockWriteAuth(...args),
    removeAuth: (...args: unknown[]) => mockRemoveAuth(...args),
  }
})

vi.mock('@vostride/agent-qa-model', async () => {
  const actual = await vi.importActual<typeof import('@vostride/agent-qa-model')>('@vostride/agent-qa-model')
  return {
    ...actual,
    createModel: (...args: unknown[]) => mockCreateModel(...args),
    getProviderOptions: (...args: unknown[]) => mockGetProviderOptions(...args),
  }
})

vi.mock('ai', () => ({
  addToolInputExamplesMiddleware: vi.fn(() => ({})),
  createProviderRegistry: vi.fn(),
  customProvider: vi.fn(),
  extractJsonMiddleware: vi.fn(() => ({})),
  generateText: (...args: unknown[]) => mockGenerateText(...args),
  parsePartialJson: vi.fn(),
}))

import { createHash } from 'node:crypto'
import { CONFIG_MASK_PLACEHOLDER } from '@vostride/agent-qa-schema'
import { ConfigManager } from '../config/config-manager.js'
import { createRouter } from '../server/routes.js'
import { writeFile, readFile, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { AgentQaConfigSchema } from '@vostride/agent-qa-core'

let dir: string
let configPath: string
let manager: ConfigManager
let router: ReturnType<typeof createRouter>

interface MockResponse {
  status: number
  headers: Record<string, string>
  body: string
}

const SAMPLE_CONFIG = `# Test config
workspace:
  testMatch:
    - tests/**/*.yaml
  hooksFile: hooks.yaml

services:
  dashboard:
    port: 3470
  cache:
    dir: .cache
    ttl: 7d

registry:
  llms:
    - name: planner
      provider: openai-compatible
      model: openrouter/auto
      baseURL: https://openrouter.ai/api/v1

use:
  healing:
    maxAttempts: 5
  llm: gpt-4
`

beforeEach(async () => {
  dir = join(tmpdir(), `config-manager-test-${Date.now()}`)
  await mkdir(dir, { recursive: true })
  configPath = join(dir, 'agent-qa.config.yaml')
  await writeFile(configPath, SAMPLE_CONFIG)
  manager = new ConfigManager(configPath)
  router = createRouter({
    db: {
      getRuns: vi.fn(() => []),
      close: vi.fn(),
    } as any,
    configManager: manager,
    configPath,
  })

  mockGetCredential.mockReset()
  mockResolveLLMAuth.mockReset()
  mockReadAuth.mockReset()
  mockWriteAuth.mockReset()
  mockRemoveAuth.mockReset()
  mockCreateModel.mockReset()
  mockGetProviderOptions.mockReset()
  mockGenerateText.mockReset()

  mockGetCredential.mockResolvedValue(null)
  mockResolveLLMAuth.mockResolvedValue({
    kind: 'unauthenticated',
    credentialKey: 'default',
    provider: 'openai-compatible',
    optional: true,
    message: 'Testing without a saved credential.',
  })
  mockReadAuth.mockResolvedValue({})
  mockWriteAuth.mockResolvedValue(undefined)
  mockRemoveAuth.mockResolvedValue(undefined)
  mockCreateModel.mockReturnValue({ id: 'model' })
  mockGetProviderOptions.mockReturnValue(undefined)
  mockGenerateText.mockResolvedValue({ text: 'ok' })
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

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
      writeHead(statusCode: number, head?: Record<string, string>) {
        status = statusCode
        if (head) {
          for (const [key, value] of Object.entries(head)) {
            headers.set(key.toLowerCase(), value)
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
    } as unknown as ServerResponse

    try {
      router(req, res)
    } catch (error) {
      reject(error)
    }
  })
}

describe('ConfigManager', () => {
  it.each([undefined, {}, { keepFailuresOnly: true }, { keepFailuresOnly: false }, { enabled: true }, { enabled: false }])(
    'keeps authored recording omissions through GET, no-op and unrelated saves: %j', async recording => {
      const source = {
        workspace: {
          testMatch: ['tests/**/*.yaml'], suiteMatch: ['suites/**/*.yaml'],
          hooksFile: 'hooks.yaml', envFile: '.env', secretsFile: '.env.secrets.local',
        },
        use: { mobile: { appState: 'preserve' } },
        ...(recording === undefined ? {} : { services: { recording } }),
      }
      await writeFile(configPath, stringifyYaml(source))
      const response = await invokeRoute('/api/config')
      expect(response.status).toBe(200)
      const authored = JSON.parse(response.body).config
      // 429-06 D-08: the map classes workspace.secretsFile secret, so the read carries it masked whole.
      expect(authored).toEqual({
        ...source,
        workspace: { ...source.workspace, secretsFile: CONFIG_MASK_PLACEHOLDER },
      })
      expect(AgentQaConfigSchema.parse(authored).services?.recording)
        .toEqual({ enabled: true, ...recording })
      const section = authored.services?.recording
      for (const body of [
        section === undefined ? {} : { 'services.recording': section },
        { 'services.logging': { level: 'warn' } },
      ]) {
        expect((await invokeRoute('/api/config/settings', {
          method: 'PUT', body: JSON.stringify(body),
        })).status).toBe(200)
        const saved = parseYaml(await readFile(configPath, 'utf8'))
        expect(saved.services?.recording).toEqual(recording)
        expect(AgentQaConfigSchema.parse(saved).services?.recording)
          .toEqual({ enabled: true, ...recording })
      }
      const beforeInvalid = await readFile(configPath, 'utf8')
      expect((await invokeRoute('/api/config/settings', {
        method: 'PUT', body: JSON.stringify({ 'services.recording': { videoDir: 'videos' } }),
      })).status).toBe(400)
      expect(await readFile(configPath, 'utf8')).toBe(beforeInvalid)
    },
  )

  describe('key ordering preservation', () => {
    it('replaceSection preserves key position in YAML', async () => {
      await manager.replaceSection('use.healing', { maxAttempts: 10 })
      const content = await readFile(configPath, 'utf-8')
      const healingIdx = content.indexOf('healing:')
      const llmIdx = content.indexOf('llm:')
      expect(healingIdx).toBeGreaterThan(-1)
      expect(llmIdx).toBeGreaterThan(-1)
      expect(healingIdx).toBeLessThan(llmIdx)
    })

    it('replaceSectionRaw preserves scalar key position', async () => {
      await manager.replaceSectionRaw('use.llm', 'claude-sonnet')
      const content = await readFile(configPath, 'utf-8')
      const healingIdx = content.indexOf('healing:')
      const llmIdx = content.indexOf('llm: claude-sonnet')
      expect(healingIdx).toBeLessThan(llmIdx)
      // llm should still be inside the use block, not at root
      expect(content).not.toMatch(/^use\.llm:/m)
      expect(content).toMatch(/^\s+llm: claude-sonnet/m)
    })

    it('replaceSection for services.cache keeps it before use block', async () => {
      await manager.replaceSection('services.cache', { dir: '.new-cache', ttl: '30d' })
      const content = await readFile(configPath, 'utf-8')
      const servicesIdx = content.indexOf('services:')
      const useIdx = content.indexOf('use:')
      expect(servicesIdx).toBeLessThan(useIdx)
    })

    it('replaceSection persists the knowledge block as one unit', async () => {
      await manager.replaceSection('knowledge', {
        dir: 'agent-qa-knowledge',
        commitArtifacts: 'thumbnails',
      })

      const config = await manager.read()
      expect(config.knowledge).toMatchObject({
        dir: 'agent-qa-knowledge',
        commitArtifacts: 'thumbnails',
      })
    })

    it('replaceSectionRaw for array preserves position', async () => {
      await manager.replaceSectionRaw('workspace.testMatch', ['tests/web/**/*.yaml', 'tests/mobile/**/*.yaml'])
      const content = await readFile(configPath, 'utf-8')
      const workspaceIdx = content.indexOf('workspace:')
      const servicesIdx = content.indexOf('services:')
      const testMatchIdx = content.indexOf('testMatch:')
      expect(testMatchIdx).toBeGreaterThan(workspaceIdx)
      expect(testMatchIdx).toBeLessThan(servicesIdx)
    })
  })

  describe('dotted path handling', () => {
    it('replaceSection splits dotted path into nested keys', async () => {
      await manager.replaceSection('services.dashboard', { port: 4000 })
      const config = await manager.read()
      expect((config.services as any).dashboard.port).toBe(4000)
    })

    it('replaceSectionRaw writes nested scalar via dotted path', async () => {
      await manager.replaceSectionRaw('use.llm', 'new-model')
      const config = await manager.read()
      expect((config.use as any).llm).toBe('new-model')
      // must not create a literal "use.llm" top-level key
      expect(Object.keys(config)).not.toContain('use.llm')
    })

    it('deleteSectionRaw removes a dotted path without deleting nested browser settings', async () => {
      await writeFile(configPath, [
        'use:',
        '  headless: true',
        '  browser:',
        '    name: chromium',
        '    headless: false',
        '    viewport:',
        '      width: 1280',
        '      height: 720',
        '',
      ].join('\n'))

      await manager.deleteSectionRaw('use.headless')

      const config = await manager.read()
      expect((config.use as any).headless).toBeUndefined()
      expect((config.use as any).browser).toMatchObject({
        name: 'chromium',
        headless: false,
        viewport: {
          width: 1280,
          height: 720,
        },
      })
    })
  })

  describe('comments preservation', () => {
    it('preserves YAML comments after updates', async () => {
      await manager.replaceSectionRaw('use.llm', 'claude')
      const content = await readFile(configPath, 'utf-8')
      expect(content).toContain('# Test config')
    })
  })
})

const WRITE_BASE_LINES = [
  'workspace:',
  '  testMatch:',
  '    - tests/**/*.yaml',
  '  suiteMatch:',
  '    - suites/**/*.suite.yaml',
  '  hooksFile: hooks.yaml',
  '  envFile: .env',
  '  secretsFile: .env.secrets.local',
]

const WRITE_MODELS_LINES = [
  'registry:',
  '  llms:',
  '    - name: planner',
  '      provider: openai-compatible',
  '      model: openrouter/auto',
  '      baseURL: https://openrouter.ai/api/v1',
  '    - name: gpt-5.6',
  '      provider: openai-compatible',
  '      model: gpt-5.6-base',
  '      baseURL: https://api.example.test/v1',
]

const WRITE_USE_LINES = [
  'use:',
  '  llm: planner',
  '  mobile:',
  '    appState: preserve',
]

const WRITE_MOBILE_LINES = ['use:', '  mobile:', '    appState: preserve']

function writeConfig(...blocks: string[][]): string {
  return [...blocks.flat(), ''].join('\n')
}

type LlmEntry = { name: string; model: string }

function llmsOf(text: string): LlmEntry[] {
  return (parseYaml(text) as { registry: { llms: LlmEntry[] } }).registry.llms
}

describe('ConfigManager.applyChanges ops and selectors (429-05)', () => {
  it('UNSET-PRUNES-EMPTY-PARENTS: an unset prunes every ancestor map it empties, and keeps a sibling', async () => {
    await writeFile(configPath, writeConfig(
      WRITE_BASE_LINES,
      ['services:', '  recording:', '    keepFailuresOnly: true'],
      WRITE_MOBILE_LINES,
    ))

    const pruned = await manager.applyChanges([
      { op: 'unset', path: ['services', 'recording', 'keepFailuresOnly'] },
    ])

    expect(pruned.kind).toBe('ok')
    const afterPrune = parseYaml(await readFile(configPath, 'utf-8')) as Record<string, unknown>
    expect(afterPrune).not.toHaveProperty('services')

    await writeFile(configPath, writeConfig(
      WRITE_BASE_LINES,
      ['services:', '  recording:', '    keepFailuresOnly: true', '    enabled: true'],
      WRITE_MOBILE_LINES,
    ))

    const kept = await manager.applyChanges([
      { op: 'unset', path: ['services', 'recording', 'keepFailuresOnly'] },
    ])

    expect(kept.kind).toBe('ok')
    const afterKeep = parseYaml(await readFile(configPath, 'utf-8')) as { services: { recording: unknown } }
    expect(afterKeep.services.recording).toEqual({ enabled: true })
  })

  it('APPEND-CREATES-SEQ: an append to an absent sequence creates it with one entry', async () => {
    await writeFile(configPath, writeConfig(WRITE_BASE_LINES, WRITE_MOBILE_LINES))

    const outcome = await manager.applyChanges([
      { op: 'append', path: ['services', 'mcp', 'tokens'], value: { name: 'ci', tokenEnvVar: 'AGENT_QA_MCP_CI_TOKEN', scopes: ['read'] } },
    ])

    expect(outcome.kind).toBe('ok')
    const parsed = parseYaml(await readFile(configPath, 'utf-8')) as { services: { mcp: { tokens: unknown[] } } }
    expect(parsed.services.mcp.tokens).toEqual([{ name: 'ci', tokenEnvVar: 'AGENT_QA_MCP_CI_TOKEN', scopes: ['read'] }])
  })

  it('NAME-SELECTOR-RESOLVES: a { name } segment changes only that entry', async () => {
    await writeFile(configPath, writeConfig(WRITE_BASE_LINES, WRITE_MODELS_LINES, WRITE_USE_LINES))

    const outcome = await manager.applyChanges([
      { op: 'set', path: ['registry', 'llms', { name: 'gpt-5.6' }, 'model'], value: 'gpt-5.6-pro' },
    ])

    expect(outcome.kind).toBe('ok')
    expect(llmsOf(await readFile(configPath, 'utf-8')).map(({ name, model }) => [name, model])).toEqual([
      ['planner', 'openrouter/auto'],
      ['gpt-5.6', 'gpt-5.6-pro'],
    ])
  })

  it('REORDERED-SEQ-HITS-RIGHT-ENTRY: after an outside reorder the same change still hits gpt-5.6', async () => {
    const reversed = [
      'registry:',
      '  llms:',
      ...WRITE_MODELS_LINES.slice(6),
      ...WRITE_MODELS_LINES.slice(2, 6),
    ]
    await writeFile(configPath, writeConfig(WRITE_BASE_LINES, reversed, WRITE_USE_LINES))

    const outcome = await manager.applyChanges([
      { op: 'set', path: ['registry', 'llms', { name: 'gpt-5.6' }, 'model'], value: 'gpt-5.6-pro' },
    ])

    expect(outcome.kind).toBe('ok')
    expect(llmsOf(await readFile(configPath, 'utf-8')).map(({ name, model }) => [name, model])).toEqual([
      ['gpt-5.6', 'gpt-5.6-pro'],
      ['planner', 'openrouter/auto'],
    ])
  })

  it('NAME-SELECTOR-MISSING-REFUSED: an unknown name, or a { name } outside a named array, refuses and writes nothing', async () => {
    await writeFile(configPath, writeConfig(WRITE_BASE_LINES, WRITE_MODELS_LINES, WRITE_USE_LINES))
    const before = await readFile(configPath)

    const missing = await manager.applyChanges([
      { op: 'set', path: ['registry', 'llms', { name: 'missing' }, 'model'], value: 'x' },
    ])
    const outside = await manager.applyChanges([
      { op: 'set', path: ['workspace', 'testMatch', { name: 'tests/**/*.yaml' }], value: 'x' },
    ])

    expect(missing).toEqual({ kind: 'refused', error: 'path_not_found' })
    expect(outside).toEqual({ kind: 'refused', error: 'path_not_found' })
    expect(Buffer.compare(await readFile(configPath), before)).toBe(0)

    // The control: the same selector on a name that is present resolves, so the refusal above
    // is about the missing entry and not about { name } segments as such.
    const present = await manager.applyChanges([
      { op: 'set', path: ['registry', 'llms', { name: 'gpt-5.6' }, 'model'], value: 'gpt-5.6-pro' },
    ])
    expect(present.kind).toBe('ok')
  })

  it('LEGACY-HEADLESS-MIGRATED: setting use.browser.headless removes a root use.headless in the same write', async () => {
    await writeFile(configPath, writeConfig(
      WRITE_BASE_LINES,
      ['use:', '  headless: true', '  browser:', '    name: chromium', '  mobile:', '    appState: preserve'],
    ))

    const outcome = await manager.applyChanges([
      { op: 'set', path: ['use', 'browser', 'headless'], value: false },
    ])

    expect(outcome.kind).toBe('ok')
    const parsed = parseYaml(await readFile(configPath, 'utf-8')) as { use: Record<string, unknown> }
    expect(parsed.use.browser).toEqual({ name: 'chromium', headless: false })
    expect(parsed.use).not.toHaveProperty('headless')
  })
})

const BROKEN_YAML = 'a: 1\nb: [1, 2\nc: 3\n'

describe('ConfigManager broken files, missing files and the mask guard (429-05)', () => {
  it('FILE-INVALID-REFUSED: a file that does not parse is refused and never rewritten', async () => {
    await writeFile(configPath, BROKEN_YAML)

    const outcome = await manager.applyChanges([
      { op: 'set', path: ['use', 'mobile', 'appState'], value: 'preserve' },
    ])

    expect(outcome).toEqual({ kind: 'refused', error: 'file_invalid' })
    expect(await readFile(configPath, 'utf-8')).toBe(BROKEN_YAML)
  })

  it('READ-REFUSES-BROKEN-FILE: a revisioned read names a broken file instead of serving part of it', async () => {
    await writeFile(configPath, BROKEN_YAML)
    const broken = await manager.readWithRevision()
    expect(broken.kind).toBe('file_invalid')
    expect(broken.kind === 'file_invalid' ? broken.message : '').not.toBe('')

    const valid = writeConfig(WRITE_BASE_LINES, WRITE_MOBILE_LINES)
    await writeFile(configPath, valid)
    expect(await manager.readWithRevision()).toEqual({
      kind: 'ok',
      config: parseYaml(valid),
      raw: valid,
      revision: createHash('sha256').update(valid).digest('hex'),
    })

    await rm(configPath)
    expect(await manager.readWithRevision()).toEqual({ kind: 'absent' })
  })

  it('ENOENT-STARTS-EMPTY-DOCUMENT: a missing file is built through the same path, with no dotted top-level key', async () => {
    await rm(configPath)

    await expect(manager.applyChanges([
      {
        op: 'set',
        path: ['workspace'],
        value: {
          testMatch: ['tests/**/*.yaml'],
          suiteMatch: ['suites/**/*.suite.yaml'],
          hooksFile: 'hooks.yaml',
          envFile: '.env',
          secretsFile: '.env.secrets.local',
        },
      },
      { op: 'set', path: ['use', 'timeout', 'step'], value: '30s' },
      { op: 'set', path: ['use', 'timeout', 'test'], value: '10m' },
      { op: 'set', path: ['use', 'timeout', 'navigation'], value: '10s' },
      { op: 'set', path: ['use', 'mobile', 'appState'], value: 'preserve' },
    ])).resolves.toMatchObject({ kind: 'ok' })

    const text = await readFile(configPath, 'utf-8')
    expect((parseYaml(text) as { use: { timeout: unknown } }).use.timeout)
      .toEqual({ step: '30s', test: '10m', navigation: '10s' })
    expect(text).not.toMatch(/^use\.timeout:/m)
  })

  it('MASK-NEVER-WRITTEN-BACK: no write path puts the mask placeholder into the file', async () => {
    await writeFile(configPath, writeConfig(WRITE_BASE_LINES, WRITE_MODELS_LINES, WRITE_USE_LINES))
    const before = await readFile(configPath)
    const maskedProviders = { browserstack: { username: 'owner', accessKey: CONFIG_MASK_PLACEHOLDER } }

    const outcomes = [
      await manager.applyChanges([
        { op: 'set', path: ['registry', 'llms', { name: 'gpt-5.6' }, 'baseURL'], value: CONFIG_MASK_PLACEHOLDER },
      ]),
      await manager.applyChanges([
        { op: 'set', path: ['registry', 'providers'], value: maskedProviders },
      ]),
      await manager.applyChanges([
        {
          op: 'append',
          path: ['services', 'mcp', 'tokens'],
          value: { name: 'ci', tokenEnvVar: 'AGENT_QA_MCP_CI_TOKEN', scopes: ['read', CONFIG_MASK_PLACEHOLDER] },
        },
      ]),
    ]

    for (const outcome of outcomes) {
      expect(outcome).toEqual({ kind: 'refused', error: 'mask_written_back' })
    }
    await expect(manager.updateSection('registry.providers', maskedProviders)).rejects.toThrow('mask_written_back')
    await expect(manager.replaceSection('registry.providers', maskedProviders)).rejects.toThrow('mask_written_back')
    await expect(manager.replaceSectionRaw('registry.providers', maskedProviders)).rejects.toThrow('mask_written_back')
    expect(Buffer.compare(await readFile(configPath), before)).toBe(0)
  })
})

describe('dashboard compatible auth routes', () => {
  it('stores openai-compatible API keys under the named LLM config key', async () => {
    const res = await invokeRoute('/api/auth/credential', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'openai-compatible',
        configName: 'planner',
        type: 'api-key',
        secret: 'sk-router',
      }),
    })

    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ saved: true })
    expect(mockWriteAuth).toHaveBeenCalledWith('planner', {
      type: 'api',
      provider: 'openai-compatible',
      key: 'sk-router',
    })
  })

  it('rejects openai-compatible API key saves without configName', async () => {
    const res = await invokeRoute('/api/auth/credential', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'openai-compatible',
        type: 'api-key',
        secret: 'sk-router',
      }),
    })

    expect(res.status).toBe(400)
    expect(JSON.parse(res.body)).toEqual({
      error: 'configName is required',
    })
    expect(mockWriteAuth).not.toHaveBeenCalled()
  })

  it('tests compatible configs by reading only the named config credential key', async () => {
    mockResolveLLMAuth.mockResolvedValue({
      kind: 'unauthenticated',
      credentialKey: 'planner',
      provider: 'openai-compatible',
      optional: true,
      message: 'Testing without a saved credential.',
    })

    const res = await invokeRoute('/api/llm/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json', host: '127.0.0.1:4317' },
      body: JSON.stringify({
        provider: 'openai-compatible',
        configName: 'planner',
        model: 'openrouter/auto',
        baseURL: 'https://openrouter.ai/api/v1',
      }),
    })

    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toMatchObject({
      success: true,
      provider: 'openai-compatible',
      model: 'openrouter/auto',
      unauthenticated: true,
      message: 'Testing without a saved credential.',
    })
    expect(mockResolveLLMAuth).toHaveBeenCalledTimes(1)
    expect(mockResolveLLMAuth).toHaveBeenCalledWith('planner', expect.objectContaining({
      provider: 'openai-compatible',
      model: 'openrouter/auto',
      baseURL: 'https://openrouter.ai/api/v1',
    }))
    expect(mockCreateModel).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'openai-compatible',
        model: 'openrouter/auto',
        baseURL: 'https://openrouter.ai/api/v1',
      }),
      { kind: 'none' },
    )
  })

  it('does not fall back to the provider key when compatible configName is absent', async () => {
    mockResolveLLMAuth.mockResolvedValue({
      kind: 'unauthenticated',
      credentialKey: '',
      provider: 'openai-compatible',
      optional: true,
      message: 'Testing without a saved credential.',
    })

    const res = await invokeRoute('/api/llm/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json', host: '127.0.0.1:4317' },
      body: JSON.stringify({
        provider: 'openai-compatible',
        model: 'openrouter/auto',
        baseURL: 'https://openrouter.ai/api/v1',
      }),
    })

    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toMatchObject({
      success: true,
      unauthenticated: true,
    })
    expect(mockResolveLLMAuth).toHaveBeenCalledWith('', expect.objectContaining({
      provider: 'openai-compatible',
    }))
    expect(mockCreateModel).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'openai-compatible',
        model: 'openrouter/auto',
        baseURL: 'https://openrouter.ai/api/v1',
      }),
      { kind: 'none' },
    )
  })

  it('keeps the no-key compatible indicator when the provider rejects auth', async () => {
    const providerError = Object.assign(new Error('Unauthorized'), { statusCode: 401 })
    mockGenerateText.mockRejectedValue(providerError)

    const res = await invokeRoute('/api/llm/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json', host: '127.0.0.1:4317' },
      body: JSON.stringify({
        provider: 'openai-compatible',
        configName: 'planner',
        model: 'openrouter/auto',
        baseURL: 'https://openrouter.ai/api/v1',
      }),
    })

    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toMatchObject({
      success: false,
      error: 'auth_error',
      message: 'Authentication failed. Check the saved credential for this config.',
      unauthenticated: true,
      authMessage: 'Testing without a saved credential.',
    })
  })

  it('keeps first-party missing-key behavior unchanged', async () => {
    mockResolveLLMAuth.mockResolvedValue({
      kind: 'missing',
      credentialKey: 'gemini-fast',
      provider: 'gemini',
      required: true,
      message: 'Save a Gemini API key for this config before testing.',
    })

    const res = await invokeRoute('/api/llm/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json', host: '127.0.0.1:4317' },
      body: JSON.stringify({
        provider: 'gemini',
        configName: 'gemini-fast',
        model: 'gemini-2.5-flash',
      }),
    })

    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toMatchObject({
      success: false,
      error: 'missing_credential',
      message: 'Save a Gemini API key for this config before testing.',
    })
    expect(mockResolveLLMAuth).toHaveBeenCalledWith('gemini-fast', expect.objectContaining({
      provider: 'gemini',
      model: 'gemini-2.5-flash',
    }))
    expect(mockCreateModel).not.toHaveBeenCalled()
  })

  it('does not use subscription auth fetch for compatible providers', async () => {
    mockResolveLLMAuth.mockResolvedValue({
      kind: 'unauthenticated',
      credentialKey: 'planner',
      provider: 'openai-compatible',
      optional: true,
      message: 'Testing without a saved credential.',
    })

    const res = await invokeRoute('/api/llm/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json', host: '127.0.0.1:4317' },
      body: JSON.stringify({
        provider: 'openai-compatible',
        configName: 'planner',
        model: 'openrouter/auto',
        baseURL: 'https://openrouter.ai/api/v1',
      }),
    })

    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toMatchObject({
      success: true,
      unauthenticated: true,
    })
    expect(mockCreateModel).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'openai-compatible',
        model: 'openrouter/auto',
        baseURL: 'https://openrouter.ai/api/v1',
      }),
      { kind: 'none' },
    )
  })
})

describe('ConfigManager map-masked read (429-06)', () => {
  it('READ-MASKED-ALIASES-FAIL-CLOSED: an alias never carries a secret value past the map in either direction', async () => {
    await writeFile(configPath, [
      'workspace:',
      '  secretsFile: &secret secret-DO-NOT-LEAK.local',
      '  envFile: &plain plain-anchor.env',
      'knowledge:',
      '  dir: *secret',
      'registry:',
      '  providers:',
      '    farm:',
      '      accessKey: *plain',
      '',
    ].join('\n'))

    const read = await manager.readMasked()

    expect(read.kind).toBe('ok')
    if (read.kind !== 'ok') return
    const config = read.config as { workspace: Record<string, string>; knowledge: { dir: string }; registry: any }
    expect(config.workspace.secretsFile).toBe(CONFIG_MASK_PLACEHOLDER)
    expect(config.knowledge.dir).toBe(CONFIG_MASK_PLACEHOLDER)
    expect(config.registry.providers.farm.accessKey).toBe(CONFIG_MASK_PLACEHOLDER)
    expect(config.workspace.envFile).toBe('plain-anchor.env')
    expect(JSON.stringify(read)).not.toContain('DO-NOT-LEAK')
  })
})
