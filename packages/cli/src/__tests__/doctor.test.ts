import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Command } from 'commander'
import { resolve } from 'node:path'

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
  execFileSync: vi.fn(),
}))

// 407-08: spread the real module rather than replacing it wholesale. doctor's knowledge rows reach
// the real `foldRetrievalRung` through knowledge-local, and a TOTAL node:fs replacement makes that
// package unloadable (its durable-fs layer names `openSync`/`fsyncSync` this suite never mocked).
// The five entries below are the only ones any doctor row actually calls.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    existsSync: vi.fn(() => false),
    readFile: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    readFileSync: vi.fn(() => ''),
  }
})

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(() => Promise.reject({ code: 'ENOENT' })),
}))

// checkDockerAvailable moved to runner-local in Phase 363 D-06 (doctor.ts imports it from there).
vi.mock('@vostride/agent-qa-runner-local', () => ({
  checkDockerAvailable: vi.fn(() => Promise.resolve(true)),
}))

// 407 D-18: doctor's three knowledge rows reach their probes through the ONE composition edge
// allowed to name knowledge-local (385 D-14/SC5), so that edge is what this suite replaces.
//
// `foldRetrievalRung` and `indexDbPath` are the REAL ones. Stubbing the fold here would let these
// cells agree with a doctor that prints a different word from the one the runner records, which is
// the exact disagreement D-17's one-fold rule exists to make impossible.
const knowledgeProbeStubs = vi.hoisted(() => ({
  classifyIndexFace: vi.fn<() => import('@vostride/agent-qa-agent-local').IndexFace>(
    () => ({ source: 'index' }),
  ),
  resolveEmbedderCapability: vi.fn(),
  readWriterLease: vi.fn(() => ({ kind: 'absent' as const })),
  readEmbedderWorkerRegistration: vi.fn(() => ({ kind: 'absent' as const })),
}))

vi.mock('@vostride/agent-qa-agent-local', async () => {
  const knowledge = await vi.importActual<typeof import('@vostride/agent-qa-knowledge-local')>(
    '@vostride/agent-qa-knowledge-local',
  )
  return {
    LOCAL_KNOWLEDGE_PROBES: {
      foldRetrievalRung: knowledge.foldRetrievalRung,
      indexDbPath: knowledge.indexDbPath,
      ...knowledgeProbeStubs,
    },
  }
})

vi.mock('@vostride/agent-qa-core', async () => {
  const actual = await vi.importActual<typeof import('@vostride/agent-qa-core')>('@vostride/agent-qa-core')
  return {
    ...actual,
    AgentQaConfigSchema: {
      safeParse: vi.fn((config: any) => {
        if (config?.workspace && typeof config.workspace.secretsFile !== 'string') {
          return {
            success: false,
            error: { issues: [{ path: ['workspace', 'secretsFile'], message: 'Invalid input: expected string' }] },
          }
        }
        return { success: true }
      }),
    },
    getCredential: vi.fn(() => null),
    resolveLLMAuth: vi.fn(() => Promise.resolve({
      kind: 'unauthenticated',
      credentialKey: 'planner',
      provider: 'openai-compatible',
      optional: true,
      message: 'Testing without a saved credential.',
    })),
    loadLLMAuthPlugins: vi.fn(() => Promise.resolve()),
    readAuth: vi.fn(() => ({})),
    resolveAppiumExecutable: vi.fn(() => ({ command: 'appium', source: 'path' })),
    formatAppiumInstallGuidance: vi.fn(() => 'Install Appium locally with `npm install -D appium` or globally with `npm install -g appium`.'),
    validateProject: vi.fn(() => Promise.resolve({ errorCount: 0, warningCount: 0, fileCount: 5, results: [] })),
    resolveWorkspacePaths: vi.fn(({ config, configPath }: any) => {
      const configDir = String(configPath).includes('/')
        ? String(configPath).split('/').slice(0, -1).join('/')
        : process.cwd()
      for (const key of ['testMatch', 'suiteMatch', 'hooksFile', 'envFile', 'secretsFile']) {
        if (config.workspace?.[key] === undefined) {
          throw new Error(`Missing required workspace config key: workspace.${key}`)
        }
      }
      const resolveConfigured = (value: string) => value.startsWith('/') ? value : `${configDir}/${value}`
      return {
        configPath,
        configDir,
        testMatch: config.workspace.testMatch,
        suiteMatch: config.workspace.suiteMatch,
        testPathIgnore: config.workspace.testPathIgnore ?? [],
        hooksFile: {
          configuredPath: config.workspace.hooksFile,
          absolutePath: resolveConfigured(config.workspace.hooksFile),
          workspaceRelativePath: config.workspace.hooksFile,
        },
        envFile: {
          configuredPath: config.workspace.envFile,
          absolutePath: resolveConfigured(config.workspace.envFile),
          workspaceRelativePath: config.workspace.envFile,
        },
        secretsFile: {
          configuredPath: config.workspace.secretsFile,
          absolutePath: resolveConfigured(config.workspace.secretsFile),
          workspaceRelativePath: config.workspace.secretsFile,
        },
      }
    }),
    discoverWorkspaceFiles: vi.fn(({ kind }: any) => Promise.resolve(
      kind === 'suite'
        ? [{ kind, absolutePath: `${process.cwd()}/suites/smoke.suite.yaml`, workspaceRelativePath: 'suites/smoke.suite.yaml' }]
        : [{ kind, absolutePath: `${process.cwd()}/tests/login.yaml`, workspaceRelativePath: 'tests/login.yaml' }],
    )),
  }
})

vi.mock('@vostride/agent-qa-model', async () => {
  const actual = await vi.importActual<typeof import('@vostride/agent-qa-model')>('@vostride/agent-qa-model')
  return {
    ...actual,
    createModel: vi.fn(() => ({})),
  }
})

vi.mock('ai', async () => {
  const actual = await vi.importActual<typeof import('ai')>('ai')
  return {
    ...actual,
    generateText: vi.fn(() => Promise.resolve({ text: 'ok' })),
  }
})

vi.mock('../provider-plugins.js', () => ({
  loadProviderPluginsForRawConfig: vi.fn(() => Promise.resolve()),
}))

// Capture console output
const consoleLogs: string[] = []
vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
  consoleLogs.push(args.map(String).join(' '))
})

import pc from 'picocolors'
import {
  DEFAULT_TERMINAL_WIDTH,
  IDENTITY_DECORATION,
  composeRow,
  createDoctorCommand,
  formatCheckRow,
  formatFixLines,
  formatStatus,
  resolveTerminalWidth,
  type CheckRow,
  type CheckStatus,
} from '../commands/doctor.js'
import { execFileSync, execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { DEFAULT_EMBEDDING_PROFILE } from '@vostride/agent-qa-schema'
import * as core from '@vostride/agent-qa-core'
import { clearProviderRegistry, createModel, registerProvider } from '@vostride/agent-qa-model'
import { generateText } from 'ai'
import { loadProviderPluginsForRawConfig } from '../provider-plugins.js'

const mockExecSync = vi.mocked(execSync)
const mockExecFileSync = vi.mocked(execFileSync)
const mockExistsSync = vi.mocked(existsSync)
const mockReadFileSync = vi.mocked(readFileSync)
const mockReadFile = vi.mocked(readFile)
const mockCreateModel = vi.mocked(createModel)
const mockGetCredential = vi.mocked(core.getCredential)
const mockLoadLLMAuthPlugins = vi.mocked(core.loadLLMAuthPlugins)
const mockLoadProviderPluginsForRawConfig = vi.mocked(loadProviderPluginsForRawConfig)
const mockResolveLLMAuth = vi.mocked((core as any).resolveLLMAuth) as any
const mockResolveAppiumExecutable = vi.mocked(core.resolveAppiumExecutable)
const mockGenerateText = vi.mocked(generateText)

async function runDoctor(parentConfig?: string): Promise<void> {
  consoleLogs.length = 0
  process.exitCode = 0

  const parent = new Command()
  if (parentConfig) parent.setOptionValue('config', parentConfig)
  parent.addCommand(createDoctorCommand())
  await parent.parseAsync(['node', 'test', 'doctor'])
}

function getOutput(): string {
  return consoleLogs.join('\n')
}

/** No doctor row reads the port; only the profile's model id reaches the terminal. */
const NATIVE_READY = {
  kind: 'ready',
  rung: 'native',
  profile: DEFAULT_EMBEDDING_PROFILE,
  embedder: {},
} as never

/** The row after which the trio prints, and the row before which it must stop. */
const KNOWLEDGE_ROW_NAMES = ['Knowledge store', 'Embedder', 'Retrieval rung'] as const

const ESC = String.fromCharCode(27)
const ANSI_PATTERN = new RegExp(`${ESC}\\[[0-9;]*m`, 'g')
const stripAnsi = (text: string): string => text.replace(ANSI_PATTERN, '')

/** 407-24: the emit loop's fix line, at SIX spaces — deeper than a row's four. */
const FIX_LINE_PATTERN = /^ {6}Fix: /
/** 407-24: a message line that moved beneath its row, at the same six-space indent. */
const CONTINUATION_PATTERN = /^ {6}\S/

/** The strings the 407 UAT measured on the built cli, transcribed so the cells can pin the widths. */
const MEASURED_INDEX_PATH = 'agent-qa-knowledge/memory/index/knowledge.db'
const MEASURED_FAIL_MESSAGE = `index at ${MEASURED_INDEX_PATH} could not be opened: corrupt`
const MEASURED_FIX_INSTRUCTIONS =
  'Rebuild the index with `agent-qa knowledge rebuild-index`, or remove the corrupt file at '
  + `${MEASURED_INDEX_PATH} and re-run.`

/**
 * The row template doctor composed BEFORE 407-24, transcribed from the pre-change emit loop
 * (`    {name}  {dots}  {message}  {status}` with `padDots`' 60-column target). The byte-identical
 * pins below build their expectation from this rather than from a snapshot, so a reader can see
 * exactly which bytes are being promised.
 */
function preChangeRow(name: string, message: string, statusWord: string): string {
  const dots = '.'.repeat(Math.max(2, 60 - (name.length + message.length)))
  return `    ${name}  ${dots}  ${message}  ${statusWord}`
}

/**
 * 407-24: wide enough that every row this suite renders still fits on ONE line, so the eighteen
 * existing `rowFor` call sites keep measuring exactly the pre-change bytes. Pinned here rather
 * than inherited from the terminal, because a row's shape must be decided by the cell and not by
 * whatever width the host running the suite happens to have.
 */
const WIDE_TEST_WIDTH = 200

const ORIGINAL_STDOUT_COLUMNS = Object.getOwnPropertyDescriptor(process.stdout, 'columns')

function setStdoutColumns(value: number | undefined): void {
  Object.defineProperty(process.stdout, 'columns', { value, configurable: true, writable: true })
}

/** Resolve to exactly this width: stdout wins over COLUMNS, so clear COLUMNS as well. */
function forceTerminalWidth(width: number): void {
  setStdoutColumns(width)
  delete process.env.COLUMNS
}

function restoreTerminalWidth(): void {
  if (ORIGINAL_STDOUT_COLUMNS) {
    Object.defineProperty(process.stdout, 'columns', ORIGINAL_STDOUT_COLUMNS)
  } else {
    setStdoutColumns(undefined)
  }
}

/**
 * A row as ONE string, however many lines it took (407-24).
 *
 * The recognition rule is mechanical and in TWO parts, and the order matters. A continuation line
 * is indented deeper than a row's own four spaces and begins no new check name. AND a line
 * matching `^ {6}Fix: ` ENDS the row unconditionally, tested BEFORE the indent test: the emit loop
 * prints the fix line at six spaces, so an indent-only rule would silently swallow a failing
 * check's fix instructions into `rowFor('Knowledge store')`.
 *
 * That hazard is invisible to a "widen it and prove nothing changed" run: all eighteen existing
 * call sites assert with `toContain` on a substring that is present either way, so a WRONG helper
 * is green at that step. The terminator cell below is what proves the rule instead.
 *
 * ANSI is stripped before matching because the fix line is dimmed as a WHOLE — the escape sits
 * before its indent, so a raw `^ {6}` test would miss it on a colour-enabled host.
 */
function rowFor(name: string): string {
  const lines = consoleLogs.map(stripAnsi)
  const start = lines.findIndex(line => line.startsWith(`    ${name}  `))
  if (start < 0) return ''

  const parts: string[] = [lines[start] ?? '']
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    if (FIX_LINE_PATTERN.test(line)) break
    if (!/^ {5}/.test(line)) break
    parts.push(line.trim())
  }
  return parts.join(' ')
}

describe('doctor command', () => {
  const originalVersion = process.version
  const originalPlatform = process.platform
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.clearAllMocks()
    consoleLogs.length = 0
    process.exitCode = 0
    mockExistsSync.mockReturnValue(false)
    mockReadFile.mockRejectedValue({ code: 'ENOENT' })
    mockLoadLLMAuthPlugins.mockResolvedValue([])
    mockLoadProviderPluginsForRawConfig.mockResolvedValue()
    mockResolveAppiumExecutable.mockReturnValue({ command: 'appium', source: 'path' })
    mockReadFileSync.mockReturnValue('')
    // 407 D-18: a healthy knowledge substrate is the default posture; each knowledge cell below
    // moves exactly the one axis it is about.
    knowledgeProbeStubs.classifyIndexFace.mockReturnValue({ source: 'index' })
    knowledgeProbeStubs.resolveEmbedderCapability.mockResolvedValue(NATIVE_READY)
    knowledgeProbeStubs.readWriterLease.mockReturnValue({ kind: 'absent' })
    knowledgeProbeStubs.readEmbedderWorkerRegistration.mockReturnValue({ kind: 'absent' })
    // 407-24: pin the width every command-level cell renders at. Wide enough that every row
    // still fits on one line, so these cells keep measuring the pre-change bytes and the shape
    // of a row is decided by the cell rather than by this host's terminal.
    forceTerminalWidth(WIDE_TEST_WIDTH)
    // Clean env for consistent tests
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.OPENAI_API_KEY
    delete process.env.GOOGLE_GENERATIVE_AI_KEY
    delete process.env.ANDROID_HOME
    delete process.env.ANDROID_SDK_ROOT
  })

  afterEach(() => {
    clearProviderRegistry()
    Object.defineProperty(process, 'version', { value: originalVersion, writable: true })
    Object.defineProperty(process, 'platform', { value: originalPlatform })
    process.env = { ...originalEnv }
    restoreTerminalWidth()
  })

  it('Node.js version check passes for v24+', async () => {
    Object.defineProperty(process, 'version', { value: 'v24.10.0', writable: true })

    await runDoctor()
    const output = getOutput()
    expect(output).toContain('v24.10.0')
    expect(output).toContain('PASS')
  })

  it('Node.js version check fails for v18', async () => {
    Object.defineProperty(process, 'version', { value: 'v18.20.0', writable: true })

    await runDoctor()
    const output = getOutput()
    expect(output).toContain('requires 24+')
    expect(output).toContain('FAIL')
  })

  it('Config file check passes when file exists', async () => {
    mockExistsSync.mockImplementation((p) => {
      return (p as string).endsWith('agent-qa.config.yaml')
    })

    await runDoctor()
    const output = getOutput()
    expect(output).toContain('agent-qa.config.yaml found')
    expect(output).toContain('PASS')
  })

  it('Config file check warns when missing', async () => {
    mockExistsSync.mockReturnValue(false)

    await runDoctor()
    const output = getOutput()
    expect(output).toContain('not found')
    expect(output).toContain('WARN')
  })

  it('warns with the resolved path when legacy v1 memory data exists', async () => {
    const configPath = resolve(process.cwd(), 'fixture', 'agent-qa.config.yaml')
    const legacyMemoryDir = resolve(process.cwd(), 'fixture', 'agent-qa-memory')
    mockExistsSync.mockImplementation(path => path === legacyMemoryDir)

    await runDoctor(configPath)

    expect(getOutput()).toContain(
      `v1 memory data found at ${legacyMemoryDir} — no longer used by agent-qa; safe to delete`,
    )
    expect(getOutput()).toContain('WARN')
  })

  it('passes the legacy v1 memory check without modifying an absent directory', async () => {
    const configPath = resolve(process.cwd(), 'fixture', 'agent-qa.config.yaml')
    const legacyMemoryDir = resolve(process.cwd(), 'fixture', 'agent-qa-memory')
    mockExistsSync.mockReturnValue(false)

    await runDoctor(configPath)

    expect(getOutput()).toContain(`no v1 memory data found at ${legacyMemoryDir}`)
    expect(mockExistsSync).toHaveBeenCalledWith(legacyMemoryDir)
  })

  it('uses the current Claude fallback model when config is missing', async () => {
    await runDoctor()

    expect(mockResolveLLMAuth).toHaveBeenCalledWith('default', expect.objectContaining({
      provider: 'anthropic-subscription',
      model: 'claude-sonnet-4-6',
    }))
  })

  it('uses the parent global config path when loading config', async () => {
    mockExistsSync.mockImplementation((p) => p === 'custom-agent-qa.yaml')
    mockReadFile.mockResolvedValue(`
registry:
  llms:
    - name: planner
      provider: openai-compatible
      model: deepseek-chat
      baseURL: https://remote.example/api/v1
use:
  llm: planner
` as never)

    await runDoctor('custom-agent-qa.yaml')

    expect(mockExistsSync).toHaveBeenCalledWith('custom-agent-qa.yaml')
    expect(mockReadFile).toHaveBeenCalledWith('custom-agent-qa.yaml', 'utf-8')
  })

  it('passes the secrets file check when workspace.secretsFile exists', async () => {
    mockReadFile.mockResolvedValue(`
workspace:
  testMatch:
    - tests/**/*.yaml
  suiteMatch:
    - suites/**/*.suite.yaml
  hooksFile: hooks.yaml
  envFile: .env
  secretsFile: .secrets.local
registry:
  llms:
    - name: planner
      provider: openai-compatible
      model: deepseek-chat
      baseURL: https://remote.example/api/v1
use:
  llm: planner
` as never)
    mockExistsSync.mockImplementation((p) => String(p).endsWith('.secrets.local'))

    await runDoctor()

    const output = getOutput()
    expect(output).toContain('Secrets file')
    expect(output).toContain('.secrets.local found')
  })

  it('fails the secrets file check when workspace.secretsFile is missing', async () => {
    mockReadFile.mockResolvedValue(`
workspace:
  testMatch:
    - tests/**/*.yaml
  suiteMatch:
    - suites/**/*.suite.yaml
  hooksFile: hooks.yaml
  envFile: .env
registry:
  llms:
    - name: planner
      provider: openai-compatible
      model: deepseek-chat
      baseURL: https://remote.example/api/v1
use:
  llm: planner
` as never)

    await runDoctor()

    const output = getOutput()
    expect(output).toContain('Missing required workspace config key: workspace.secretsFile')
    expect(output).toContain('Set workspace.secretsFile')
  })

  it('LLM credential checks resolve by config name without env-var fallback output', async () => {
    const compatibleConfig = `
registry:
  llms:
    - name: planner
      provider: anthropic-compatible
      model: claude-remote
      baseURL: https://remote.example/messages
use:
  llm: planner
`
    mockReadFile.mockResolvedValue(compatibleConfig as never)
    mockResolveLLMAuth.mockResolvedValue({
      kind: 'unauthenticated',
      credentialKey: 'planner',
      provider: 'anthropic-compatible',
      optional: true,
      message: 'Testing without a saved credential.',
    })

    await runDoctor()
    const output = getOutput()

    expect(mockResolveLLMAuth).toHaveBeenCalledWith('planner', expect.objectContaining({
      provider: 'anthropic-compatible',
      model: 'claude-remote',
      baseURL: 'https://remote.example/messages',
    }))
    expect(output).not.toContain('ANTHROPIC_API_KEY')
    expect(output).not.toContain('OPENAI_API_KEY')
    expect(output).not.toContain('GOOGLE_GENERATIVE_AI_KEY')
  })

  it('Gemini missing credentials use resolver message without Google env-var guidance', async () => {
    const geminiConfig = `
registry:
  llms:
    - name: gemini-fast
      provider: gemini
      model: gemini-3-flash-preview
use:
  llm: gemini-fast
`
    mockReadFile.mockResolvedValue(geminiConfig as never)
    mockResolveLLMAuth.mockResolvedValue({
      kind: 'missing',
      credentialKey: 'gemini-fast',
      provider: 'gemini',
      required: true,
      message: 'Save a Gemini API key for this config before testing.',
    })

    await runDoctor()
    const output = getOutput()

    expect(output).toContain('Save a Gemini API key for this config before testing.')
    expect(output).not.toContain('GOOGLE_GENERATIVE_AI_KEY')
    expect(output).not.toContain('OPENAI_API_KEY')
    expect(output).not.toContain('ANTHROPIC_API_KEY')
  })

  it('openai-compatible checks use exact baseURL and allow resolver unauthenticated state', async () => {
    const compatibleConfig = `
registry:
  llms:
    - name: planner
      provider: openai-compatible
      model: deepseek-chat
      baseURL: https://remote.example/api/v1
use:
  llm: planner
`
    mockReadFile.mockResolvedValue(compatibleConfig as never)
    mockResolveLLMAuth.mockResolvedValue({
      kind: 'unauthenticated',
      credentialKey: 'planner',
      provider: 'openai-compatible',
      optional: true,
      message: 'Testing without a saved credential.',
    })
    mockCreateModel.mockReturnValue({} as any)
    mockGenerateText.mockResolvedValue({ text: 'ok' } as any)

    await runDoctor()

    const output = getOutput()
    expect(output).toContain('Testing without a saved credential.')
    expect(output).toContain('credential optional')
    expect(mockCreateModel).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'openai-compatible',
        model: 'deepseek-chat',
        baseURL: 'https://remote.example/api/v1',
        auth: { mode: 'none' },
      }),
      { kind: 'none' },
    )
    expect(mockGetCredential).not.toHaveBeenCalled()
  })

  it('LLM connection passes resolver auth material and providerHeaders to createModel', async () => {
    const compatibleConfig = `
registry:
  llms:
    - name: planner
      provider: anthropic-compatible
      model: claude-remote
      baseURL: https://remote.example/messages
      providerHeaders:
        x-workspace: agent-qa
use:
  llm: planner
`
    mockReadFile.mockResolvedValue(compatibleConfig as never)
    mockResolveLLMAuth.mockResolvedValue({
      kind: 'bearer-token',
      credentialKey: 'planner',
      provider: 'anthropic-compatible',
      token: 'bearer-planner',
    })

    await runDoctor()

    expect(mockResolveLLMAuth).toHaveBeenCalledWith('planner', expect.objectContaining({
      provider: 'anthropic-compatible',
      providerHeaders: { 'x-workspace': 'agent-qa' },
    }))
    expect(mockCreateModel).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'anthropic-compatible',
        model: 'claude-remote',
        baseURL: 'https://remote.example/messages',
        headers: { 'x-workspace': 'agent-qa' },
        auth: { mode: 'bearer-token' },
      }),
      { kind: 'bearer-token', token: 'bearer-planner' },
    )
  })

  it('loads declared auth plugins and forwards auth-fetch modelAdapter to createModel', async () => {
    const subscriptionConfig = `
plugins:
  auth:
    - package: "@vostride/agent-qa-subscription-auth"
  providers:
    - path: ./providers/sixth-provider.js
registry:
  llms:
    - name: codex
      provider: openai-subscription
      model: gpt-5.5
use:
  llm: codex
`
    const authFetch = vi.fn() as unknown as typeof globalThis.fetch
    mockReadFile.mockResolvedValue(subscriptionConfig as never)
    mockResolveLLMAuth.mockResolvedValue({
      kind: 'auth-fetch',
      credentialKey: 'codex',
      provider: 'openai-subscription',
      modelAdapter: 'openai-responses',
      fetch: authFetch,
    })

    await runDoctor('agent-qa.config.yaml')

    expect(mockLoadLLMAuthPlugins).toHaveBeenCalledWith(
      [{ package: '@vostride/agent-qa-subscription-auth' }],
      expect.objectContaining({ baseDir: expect.any(String) }),
    )
    expect(mockLoadProviderPluginsForRawConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        plugins: expect.objectContaining({
          providers: [{ path: './providers/sixth-provider.js' }],
        }),
      }),
      'agent-qa.config.yaml',
    )
    expect(mockCreateModel).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'openai-subscription',
        model: 'gpt-5.5',
        auth: { mode: 'subscription', plugin: 'openai-subscription' },
      }),
      { kind: 'auth-fetch', fetch: authFetch, modelAdapter: 'openai-responses' },
    )
  })

  it('classifies a registered sixth provider as subscription through registry metadata', async () => {
    registerProvider({
      id: 'sixth-subscription',
      label: 'Sixth Subscription',
      adapter: () => ({} as any),
      needsBaseURL: false,
      authModes: ['subscription'],
      subscription: true,
    })
    const subscriptionConfig = `
registry:
  llms:
    - name: sixth
      provider: sixth-subscription
      model: hosted-sixth
use:
  llm: sixth
`
    const authFetch = vi.fn() as unknown as typeof globalThis.fetch
    mockReadFile.mockResolvedValue(subscriptionConfig as never)
    mockResolveLLMAuth.mockResolvedValue({
      kind: 'auth-fetch',
      credentialKey: 'sixth',
      provider: 'sixth-subscription',
      modelAdapter: 'openai-responses',
      fetch: authFetch,
    })

    await runDoctor()

    const output = getOutput()
    expect(output).not.toContain('subscription not used for sixth-subscription')
    expect(output).toContain('OAuth connected')
    expect(mockResolveLLMAuth).toHaveBeenCalledWith('sixth', expect.objectContaining({
      provider: 'sixth-subscription',
      model: 'hosted-sixth',
    }))
  })

  it('classifies a registered sixth provider as requiring baseURL through registry metadata', async () => {
    registerProvider({
      id: 'sixth-compatible',
      label: 'Sixth Compatible',
      adapter: () => ({} as any),
      needsBaseURL: true,
      authModes: ['api-key'],
    })
    const compatibleConfig = `
registry:
  llms:
    - name: sixth
      provider: sixth-compatible
      model: hosted-sixth
use:
  llm: sixth
`
    mockReadFile.mockResolvedValue(compatibleConfig as never)

    await runDoctor()

    expect(getOutput()).toContain('baseURL required for sixth-compatible')
    expect(mockCreateModel).not.toHaveBeenCalled()
  })

  it('openai-compatible connection check fails when baseURL is missing', async () => {
    const compatibleConfig = `
registry:
  llms:
    - name: planner
      provider: openai-compatible
      model: deepseek-chat
use:
  llm: planner
`
    mockReadFile.mockResolvedValue(compatibleConfig as never)
    mockGetCredential.mockResolvedValue(null)

    await runDoctor()

    expect(getOutput()).toContain('baseURL required for openai-compatible')
    expect(mockCreateModel).not.toHaveBeenCalled()
  })

  it('Playwright check passes when installed', async () => {
    mockExecSync.mockImplementation((cmd) => {
      if ((cmd as string).includes('playwright --version')) return Buffer.from('1.50.0')
      return Buffer.from('')
    })

    await runDoctor()
    const output = getOutput()
    expect(output).toContain('installed')
  })

  it('Playwright check fails when not installed', async () => {
    mockExecSync.mockImplementation((cmd) => {
      if ((cmd as string).includes('playwright')) throw new Error('not found')
      return Buffer.from('')
    })

    await runDoctor()
    const output = getOutput()
    // Should show Playwright not installed
    expect(output).toContain('Playwright')
    expect(output).toContain('agent-qa install-browsers --chromium')
    expect(output).not.toContain('agent-qa init')
    expect(output).not.toContain('npx playwright install')
  })

  it('Appium checks skipped when platform is web-only', async () => {
    // No mobile config → appium should be skipped
    await runDoctor()
    const output = getOutput()
    // Appium line should show SKIP
    expect(output).toContain('not configured')
    expect(output).toContain('SKIP')
  })

  it('Appium checks run when platform includes mobile', async () => {
    // Load config with mobile app
    const mobileConfig = `
registry:
  llms:
    - name: default
      provider: openai-compatible
      model: model-name
      baseURL: https://remote.example/api/v1
use:
  llm: default
targets:
  my-app:
    platform: android
    environments:
      dev:
        url: http://localhost
`
    mockReadFile.mockResolvedValue(mobileConfig as never)
    mockExecSync.mockImplementation((cmd) => {
      const cmdStr = cmd as string
      if (cmdStr.includes('playwright')) throw new Error('not found')
      return Buffer.from('')
    })
    mockExecFileSync.mockImplementation((cmd, args) => {
      if (cmd === 'appium' && Array.isArray(args) && args.join(' ') === '--version') return Buffer.from('2.0.0')
      if (cmd === 'appium' && Array.isArray(args) && args.join(' ') === 'driver list --installed') return Buffer.from('uiautomator2')
      return Buffer.from('')
    })

    await runDoctor()
    const output = getOutput()
    expect(output).toContain('Appium')
    // Should not show SKIP for appium
    expect(output).toContain('v2.0.0')
  })

  it('Appium checks use the resolved local executable when available', async () => {
    const mobileConfig = `
registry:
  llms:
    - name: default
      provider: openai-compatible
      model: model-name
      baseURL: https://remote.example/api/v1
use:
  llm: default
targets:
  my-app:
    platform: ios
    environments:
      dev:
        url: http://localhost
`
    mockReadFile.mockResolvedValue(mobileConfig as never)
    mockResolveAppiumExecutable.mockReturnValue({ command: '/tmp/project/node_modules/.bin/appium', source: 'local' })
    mockExecFileSync.mockImplementation((cmd, args) => {
      if (cmd === '/tmp/project/node_modules/.bin/appium' && Array.isArray(args) && args.join(' ') === '--version') return Buffer.from('2.1.0')
      if (cmd === '/tmp/project/node_modules/.bin/appium' && Array.isArray(args) && args.join(' ') === 'driver list --installed') return Buffer.from('xcuitest')
      return Buffer.from('')
    })

    await runDoctor()

    expect(mockResolveAppiumExecutable).toHaveBeenCalledWith({ cwd: process.cwd() })
    expect(mockExecFileSync).toHaveBeenCalledWith('/tmp/project/node_modules/.bin/appium', ['--version'], { stdio: 'pipe' })
    expect(mockExecFileSync).toHaveBeenCalledWith('/tmp/project/node_modules/.bin/appium', ['driver', 'list', '--installed'], { stdio: 'pipe' })
  })

  it('Appium driver failure points to the AgentQA mobile driver install command', async () => {
    const mobileConfig = `
workspace:
  testMatch:
    - tests/**/*.yaml
  suiteMatch:
    - suites/**/*.suite.yaml
  hooksFile: hooks.yaml
  envFile: .env
  secretsFile: .env.secrets.local
registry:
  llms:
    - name: default
      provider: openai-compatible
      model: model-name
      baseURL: https://remote.example/api/v1
  targets:
    my-app:
      platform: android
use:
  llm: default
`
    mockReadFile.mockResolvedValue(mobileConfig as never)
    mockExistsSync.mockReturnValue(true)
    mockExecSync.mockImplementation((cmd) => {
      const cmdStr = cmd as string
      if (cmdStr.includes('playwright')) return Buffer.from('1.50.0')
      return Buffer.from('')
    })
    mockExecFileSync.mockImplementation((cmd, args) => {
      if (cmd === 'appium' && Array.isArray(args) && args.join(' ') === '--version') return Buffer.from('2.0.0')
      if (cmd === 'appium' && Array.isArray(args) && args.join(' ') === 'driver list --installed') return Buffer.from('')
      return Buffer.from('')
    })

    await runDoctor()

    const output = getOutput()
    expect(output).toContain('no drivers installed')
    expect(output).toContain('agent-qa install-mobile-drivers --all')
    expect(output).not.toContain('appium driver install uiautomator2')
  })

  it('missing Appium guidance keeps local install first and names the mobile driver command', async () => {
    const mobileConfig = `
registry:
  llms:
    - name: default
      provider: openai-compatible
      model: model-name
      baseURL: https://remote.example/api/v1
use:
  llm: default
targets:
  my-app:
    platform: ios
`
    mockReadFile.mockResolvedValue(mobileConfig as never)
    mockExecFileSync.mockImplementation((cmd, args) => {
      if (cmd === 'appium' && Array.isArray(args) && args.join(' ') === '--version') throw new Error('appium not found')
      return Buffer.from('')
    })

    await runDoctor()

    const output = getOutput()
    expect(output).toContain('Install Appium locally with `npm install -D appium`')
    expect(output).toContain('agent-qa install-mobile-drivers --all')
  })

  it('Android SDK check validates ANDROID_HOME', async () => {
    const mobileConfig = `
registry:
  llms:
    - name: default
      provider: openai-compatible
      model: model-name
      baseURL: https://remote.example/api/v1
use:
  llm: default
targets:
  my-app:
    platform: android
`
    mockReadFile.mockResolvedValue(mobileConfig as never)
    process.env.ANDROID_HOME = '/opt/android-sdk'
    mockExistsSync.mockImplementation((p) => {
      return (p as string).includes('platform-tools/adb')
    })

    await runDoctor()
    const output = getOutput()
    expect(output).toContain('SDK found')
  })

  it('Xcode check skipped on non-macOS', async () => {
    const mobileConfig = `
registry:
  llms:
    - name: default
      provider: openai-compatible
      model: model-name
      baseURL: https://remote.example/api/v1
use:
  llm: default
targets:
  my-app:
    platform: ios
`
    mockReadFile.mockResolvedValue(mobileConfig as never)
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })

    await runDoctor()
    const output = getOutput()
    expect(output).toContain('requires macOS')
  })

  it('Overall result: all pass → exit 0', async () => {
    Object.defineProperty(process, 'version', { value: 'v24.10.0', writable: true })
    mockExistsSync.mockReturnValue(true)
    mockExecSync.mockReturnValue(Buffer.from('ok'))
    mockResolveLLMAuth.mockResolvedValue({
      kind: 'unauthenticated',
      credentialKey: 'default',
      provider: 'openai-compatible',
      optional: true,
      message: 'Testing without a saved credential.',
    })
    // Provide a valid config so config validation passes
    const { stringify } = await import('yaml')
    const validConfig = stringify({
      workspace: {
        testMatch: ['tests/**/*.yaml'],
        suiteMatch: ['suites/**/*.suite.yaml'],
        hooksFile: 'hooks.yaml',
        envFile: '.env',
        secretsFile: '.secrets.local',
      },
      registry: { llms: [{ name: 'default', provider: 'openai-compatible', model: 'model-name', baseURL: 'https://remote.example/api/v1' }] },
      services: { cache: { dir: '.agent-qa/cache', ttl: '7d' }, logging: { level: 'warn' }, vision: { screenshotSize: '1m' } },
      use: {
        browser: { name: 'chromium', headless: true },
        timeout: { step: '30s', test: '10m', navigation: '10s' },
        healing: { maxAttempts: 3 },
        planner: { maxSubActions: 50, previousStepCount: 5 },
        llm: 'default',
      },
    })
    mockReadFile.mockResolvedValue(validConfig as never)

    await runDoctor()
    expect(process.exitCode).toBe(0)
    const output = getOutput()
    expect(output).toContain('All checks passed')
  })

  it('Overall result: any fail → exit 1', async () => {
    Object.defineProperty(process, 'version', { value: 'v18.0.0', writable: true })

    await runDoctor()
    expect(process.exitCode).toBe(1)
    const output = getOutput()
    expect(output).toContain('Some checks failed')
  })

  it('Fix instructions printed for each failure', async () => {
    Object.defineProperty(process, 'version', { value: 'v18.0.0', writable: true })

    await runDoctor()
    const output = getOutput()
    expect(output).toContain('Install Node.js 24+')
  })
  // ---- 407 TRST-02: the three knowledge trust rows (D-18/D-19/D-20) ----------------------------

  async function runHealthyHost(): Promise<void> {
    Object.defineProperty(process, 'version', { value: 'v24.10.0', writable: true })
    mockExistsSync.mockReturnValue(true)
    mockExecSync.mockReturnValue(Buffer.from('ok'))
    mockResolveLLMAuth.mockResolvedValue({
      kind: 'unauthenticated',
      credentialKey: 'default',
      provider: 'openai-compatible',
      optional: true,
      message: 'Testing without a saved credential.',
    })
    const { stringify } = await import('yaml')
    mockReadFile.mockResolvedValue(stringify({
      workspace: {
        testMatch: ['tests/**/*.yaml'],
        suiteMatch: ['suites/**/*.suite.yaml'],
        hooksFile: 'hooks.yaml',
        envFile: '.env',
        secretsFile: '.secrets.local',
      },
      registry: { llms: [{ name: 'default', provider: 'openai-compatible', model: 'model-name', baseURL: 'https://remote.example/api/v1' }] },
      services: { cache: { dir: '.agent-qa/cache', ttl: '7d' }, logging: { level: 'warn' }, vision: { screenshotSize: '1m' } },
      use: {
        browser: { name: 'chromium', headless: true },
        timeout: { step: '30s', test: '10m', navigation: '10s' },
        healing: { maxAttempts: 3 },
        planner: { maxSubActions: 50, previousStepCount: 5 },
        llm: 'default',
      },
    }) as never)
    await runDoctor()
  }

  it('prints the trio between Legacy v1 memory data and Config validation, store then embedder then rung', async () => {
    await runHealthyHost()

    const indexOf = (name: string): number => consoleLogs.findIndex(line => line.includes(`    ${name}  `))
    const legacy = indexOf('Legacy v1 memory data')
    const validation = indexOf('Config validation')
    const positions = KNOWLEDGE_ROW_NAMES.map(indexOf)

    expect(legacy).toBeGreaterThanOrEqual(0)
    expect(validation).toBeGreaterThanOrEqual(0)
    expect(positions).toEqual([legacy + 1, legacy + 2, legacy + 3])
    expect(positions[2]).toBeLessThan(validation)
  })

  it('skips all three rows when no knowledge root resolves, and never omits a row', async () => {
    mockExistsSync.mockReturnValue(false)

    await runDoctor()

    for (const name of KNOWLEDGE_ROW_NAMES) {
      expect(rowFor(name)).toContain('no knowledge root configured')
      expect(rowFor(name)).toContain('SKIP')
      expect(rowFor(name)).not.toContain('FAIL')
    }
    // The process exit code is deliberately NOT asserted here: with no config at all the LLM,
    // workspace and validation rows fail on their own account, so an assertion about it would be
    // about them. "Degraded by design still exits 0" is the WARN cell below, on a healthy host.
    expect(getOutput()).not.toContain('Fix: Rebuild the index')
    expect(getOutput()).not.toContain('Fix: Set an explicit embedder profile')
  })

  it('passes all three rows on an open index with a native embedder', async () => {
    await runHealthyHost()

    expect(rowFor('Knowledge store')).toContain('index open at')
    expect(rowFor('Embedder')).toContain(`native (${DEFAULT_EMBEDDING_PROFILE.model_id})`)
    expect(rowFor('Retrieval rung')).toContain('memidex')
    for (const name of KNOWLEDGE_ROW_NAMES) expect(rowFor(name)).toContain('PASS')
    expect(process.exitCode).toBe(0)
  })

  it('warns — never fails — a host degraded by design, so a floor install does not red the gate', async () => {
    knowledgeProbeStubs.classifyIndexFace.mockReturnValue({
      source: 'scan',
      reason: 'absent',
      detail: 'derived index file is absent',
      filePresent: false,
    })
    knowledgeProbeStubs.resolveEmbedderCapability.mockResolvedValue({
      kind: 'ready',
      rung: 'floor',
      profile: DEFAULT_EMBEDDING_PROFILE,
      embedder: {},
    } as never)

    await runHealthyHost()

    for (const name of KNOWLEDGE_ROW_NAMES) {
      expect(rowFor(name)).toContain('WARN')
      expect(rowFor(name)).not.toContain('FAIL')
    }
    expect(rowFor('Knowledge store')).toContain('scanning bundles')
    expect(rowFor('Embedder')).toContain('static floor — native ONNX runtime unavailable')
    expect(rowFor('Retrieval rung')).toContain('bundle-scan — knowledge index unavailable')
    expect(process.exitCode).not.toBe(1)
  })

  it('fails the store row and exits 1 when the index file is present and will not open', async () => {
    knowledgeProbeStubs.classifyIndexFace.mockReturnValue({
      source: 'scan',
      reason: 'corrupt',
      detail: 'SQLITE_NOTADB: file is not a database',
      filePresent: true,
    })

    await runHealthyHost()

    expect(rowFor('Knowledge store')).toContain('could not be opened: corrupt')
    expect(rowFor('Knowledge store')).toContain('FAIL')
    expect(getOutput()).toContain('Fix: Rebuild the index with `agent-qa knowledge rebuild-index`')
    expect(rowFor('Retrieval rung')).not.toContain('FAIL')
    expect(process.exitCode).toBe(1)
  })

  it('names the folded 399 failure by its cause when a live daemon lease published no worker registration', async () => {
    knowledgeProbeStubs.readWriterLease.mockReturnValue({ kind: 'parsed', lease: {} } as never)
    knowledgeProbeStubs.readEmbedderWorkerRegistration.mockReturnValue({ kind: 'absent' })
    mockReadFileSync.mockImplementation((target) => (
      String(target).endsWith('daemon-events.jsonl')
        ? `${JSON.stringify({
          kind: 'embedder-worker-exit',
          reason: 'crash',
          stderr: 'Error: Embedder worker could not resolve profile: deferred\n    at /home/u/worker.js',
        })}\n`
        : ''
    ))

    await runHealthyHost()

    expect(rowFor('Embedder')).toContain(
      'daemon embedder worker not registered: could not resolve profile (deferred)',
    )
    expect(rowFor('Embedder')).toContain('FAIL')
    expect(getOutput()).not.toContain('/home/u/worker.js')
    expect(getOutput()).toContain('Fix: Set an explicit embedder profile in agent-qa.config.yaml')
  })

  // -------------------------------------------------------------------------
  // 407-24 (G-407-3): the command measured against the width it resolved.
  // -------------------------------------------------------------------------

  it('stops a row at the Fix line instead of absorbing a failing check into it', async () => {
    knowledgeProbeStubs.classifyIndexFace.mockReturnValue({
      source: 'scan',
      reason: 'corrupt',
      detail: 'SQLITE_NOTADB: file is not a database',
      filePresent: true,
    })

    await runHealthyHost()

    const row = rowFor('Knowledge store')
    expect(row).toContain(MEASURED_FAIL_MESSAGE)
    expect(row).toContain('FAIL')
    // The fix line IS printed — so the two negatives below are about the JOIN, not about absence.
    expect(getOutput()).toContain(`Fix: ${MEASURED_FIX_INSTRUCTIONS}`)
    // The whole instruction string and the prefix literal. Deliberately not a token scan: the row
    // and its instructions legitimately share ordinary words ("index", "the", "at"), so a
    // token-by-token search would red on a correct helper, and "contains no substring" is
    // unsatisfiable as literally worded.
    expect(row).not.toContain(MEASURED_FIX_INSTRUCTIONS)
    expect(row).not.toContain('Fix: ')
  })

  it('emits no line wider than 80 columns at a resolved width of 80', async () => {
    forceTerminalWidth(80)
    knowledgeProbeStubs.classifyIndexFace.mockReturnValue({
      source: 'scan',
      reason: 'corrupt',
      detail: 'SQLITE_NOTADB: file is not a database',
      filePresent: true,
    })

    await runHealthyHost()

    const lines = consoleLogs.map(stripAnsi)
    // Strip before measuring even though picocolors disables itself off a TTY: the census must
    // measure what a COLOURED terminal receives, not what this harness happened to capture.
    const overlong = lines.filter(line => line.length > 80)
    // The ONE documented exception (T-407-24-01): a single word wider than the wrap budget takes
    // its own line UNCUT. `Legacy v1 memory data` prints an ABSOLUTE path, so on a deep enough
    // checkout that token alone can exceed 80 — and a path a person cannot copy is a diagnostic
    // that failed. Every line that is not one unbroken token must fit.
    const offenders = overlong
      .filter(line => line.trim().includes(' '))
      .map(line => `${line.length} columns: ${JSON.stringify(line)}`)
    expect(offenders).toEqual([])
    // And each exception really IS one unbroken token, never a word the wrapper cut in half.
    for (const line of overlong) expect(line.trim()).not.toContain(' ')

    // Non-vacuous: at least one row actually took the two-line shape, so a future change that made
    // every message short could not turn this census green by emptiness.
    const continuations = lines.filter(
      line => CONTINUATION_PATTERN.test(line) && !FIX_LINE_PATTERN.test(line),
    )
    expect(continuations.length).toBeGreaterThan(0)

    // The status word never left the name line.
    const head = lines.find(line => line.startsWith('    Knowledge store  '))
    expect(head).toContain('FAIL')
    expect(rowFor('Knowledge store')).toContain(MEASURED_FAIL_MESSAGE)
    expect(rowFor('Knowledge store')).toContain('FAIL')
  })

  it('leaves every row on one line at a wide width, byte-identical to the pre-change output', async () => {
    forceTerminalWidth(WIDE_TEST_WIDTH)

    await runHealthyHost()

    const lines = consoleLogs.map(stripAnsi)
    expect(lines.filter(line => /^ {5}/.test(line))).toEqual([])
    expect(lines).toContain(
      preChangeRow('Knowledge store', 'index open at agent-qa-knowledge (memidex)', 'PASS'),
    )
    expect(lines).toContain(
      preChangeRow('Embedder', `native (${DEFAULT_EMBEDDING_PROFILE.model_id})`, 'PASS'),
    )
    expect(lines).toContain(preChangeRow('Retrieval rung', 'memidex', 'PASS'))
  })
})


// ---------------------------------------------------------------------------
// 407-24 (G-407-3): the row renderer, measured directly rather than through the
// command. Every cell below passes the width as a PARAMETER, so it measures the
// renderer at a width it chose instead of at whatever width this host happens to
// have — a width the code never named is the failure the UAT caught.
// ---------------------------------------------------------------------------

/** A message of about the requested length built from short words, so no long-word exception fires. */
function wordyMessage(length: number): string {
  return 'lorem ipsum dolor sit amet '.repeat(20).slice(0, length).trimEnd()
}

describe('doctor row renderer (407-24 · G-407-3)', () => {
  const originalColumnsEnv = process.env.COLUMNS

  afterEach(() => {
    restoreTerminalWidth()
    if (originalColumnsEnv === undefined) delete process.env.COLUMNS
    else process.env.COLUMNS = originalColumnsEnv
  })

  it('resolves the width from stdout first, then COLUMNS, then the documented default', () => {
    setStdoutColumns(133)
    process.env.COLUMNS = '44'
    expect(resolveTerminalWidth()).toBe(133)

    setStdoutColumns(undefined)
    expect(resolveTerminalWidth()).toBe(44)

    delete process.env.COLUMNS
    expect(resolveTerminalWidth()).toBe(DEFAULT_TERMINAL_WIDTH)
    expect(DEFAULT_TERMINAL_WIDTH).toBe(80)
  })

  it('ignores a non-positive or unparseable width from either source', () => {
    setStdoutColumns(0)
    process.env.COLUMNS = 'wide'
    expect(resolveTerminalWidth()).toBe(DEFAULT_TERMINAL_WIDTH)

    setStdoutColumns(Number.NaN)
    process.env.COLUMNS = '-20'
    expect(resolveTerminalWidth()).toBe(DEFAULT_TERMINAL_WIDTH)
  })

  it('composes a fitting row byte-for-byte the way the pre-change emit loop did', () => {
    const name = 'Knowledge store'
    const message = 'index open at agent-qa-knowledge (memidex)'

    const row = formatCheckRow(name, message, 'pass', 200)

    expect(row.plainLine).toBe(preChangeRow(name, message, 'PASS'))
    expect(row.continuations).toEqual([])
    expect(row.message).toBe(message)
  })

  it('never adds dots: a row that already fits keeps the exact gutter it has today', () => {
    const name = 'Node.js'
    const message = 'v24.10.0'

    for (const width of [80, 120, 400]) {
      expect(formatCheckRow(name, message, 'pass', width).plainLine)
        .toBe(preChangeRow(name, message, 'PASS'))
    }
  })

  it('keeps FAIL on the name line and wraps the measured 113-column row under 80', () => {
    // The width the UAT measured on the built cli, reproduced here from the same two strings.
    expect(preChangeRow('Knowledge store', MEASURED_FAIL_MESSAGE, 'FAIL')).toHaveLength(113)

    const row = formatCheckRow('Knowledge store', MEASURED_FAIL_MESSAGE, 'fail', 80)

    expect(row.plainLine).toContain('Knowledge store')
    expect(row.plainLine).toContain('FAIL')
    expect(row.message).toBe('')
    expect(row.continuations.length).toBeGreaterThan(1)
    for (const line of [row.plainLine, ...row.continuations]) {
      expect(line.length).toBeLessThanOrEqual(80)
    }
    // Nothing was cut: the wrapped lines rejoin into the message exactly.
    expect(row.continuations.map(line => line.trim()).join(' ')).toBe(MEASURED_FAIL_MESSAGE)
    // The gutter degrades to padDots' floor rather than going negative.
    expect(row.dots.length).toBeGreaterThanOrEqual(2)
  })

  it('bounds every returned line at the width across the name x message x status corpus', () => {
    const statuses: CheckStatus[] = ['pass', 'warn', 'fail', 'skip']
    const offenders: string[] = []

    for (const width of [60, 80, 120]) {
      for (let nameLength = 1; nameLength <= 40; nameLength += 1) {
        const name = 'n'.repeat(nameLength)
        for (let messageLength = 1; messageLength <= 200; messageLength += 1) {
          const message = wordyMessage(messageLength)
          for (const status of statuses) {
            const row = formatCheckRow(name, message, status, width)
            for (const line of [row.plainLine, ...row.continuations]) {
              if (line.length > width) {
                offenders.push(
                  `width=${width} name=${nameLength} message=${messageLength} status=${status}`
                  + ` produced ${line.length} columns: ${JSON.stringify(line)}`,
                )
              }
            }
          }
        }
      }
    }

    expect(offenders.slice(0, 5)).toEqual([])
  })

  it('gives a word longer than the wrap budget its own uncut line, the only line that may exceed the width', () => {
    const sha = 'a'.repeat(64)

    const row = formatCheckRow(
      'Knowledge store',
      `index at ${sha} could not be opened: corrupt`,
      'fail',
      40,
    )

    const overlong = [row.plainLine, ...row.continuations].filter(line => line.length > 40)
    expect(overlong).toHaveLength(1)
    // Uncut and alone on its line: a sha a person cannot copy is a sha this row failed to report.
    expect(overlong[0]?.trim()).toBe(sha)
  })

  it('wraps the measured 156-column Fix line with a hanging indent, keeping its six-space prefix', () => {
    expect(`      Fix: ${MEASURED_FIX_INSTRUCTIONS}`).toHaveLength(156)

    const lines = formatFixLines(MEASURED_FIX_INSTRUCTIONS, 80)

    expect(lines.length).toBeGreaterThan(1)
    expect(lines[0]?.startsWith('      Fix: ')).toBe(true)
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(80)
    for (const line of lines.slice(1)) expect(line.startsWith('           ')).toBe(true)
    expect(lines.map(line => line.trim()).join(' ')).toBe(`Fix: ${MEASURED_FIX_INSTRUCTIONS}`)
  })

  it('leaves a short Fix line exactly as the pre-change emit loop wrote it', () => {
    expect(formatFixLines('Install Node.js 24+ from https://nodejs.org/', 80)).toEqual([
      '      Fix: Install Node.js 24+ from https://nodejs.org/',
    ])
  })

  it('pins the SHIPPED decoration through the SHIPPED composer to plainLine', () => {
    // What this buys over a self-consistency check: asserting `plainLine` equals a composition of
    // its OWN segments proves only that the formatter agrees with itself, and would stay green
    // while the emit path composed something else entirely. Running the decoration the emit loop
    // actually passes through the composer the emit loop actually calls, then stripping it, is
    // what pins the emitted line to the pinned one.
    const cases: [string, number][] = [
      ['index open at agent-qa-knowledge (memidex)', 200],
      [MEASURED_FAIL_MESSAGE, 80],
    ]

    for (const [message, width] of cases) {
      const row = formatCheckRow('Knowledge store', message, 'fail', width)

      expect(stripAnsi(composeRow(row, { dots: pc.dim, status: formatStatus }))).toBe(row.plainLine)

      // Non-vacuity: picocolors disables itself off a TTY, so the assertion above can degrade to an
      // identity check on this host. Forcing escapes proves stripAnsi is doing real work.
      const forced = composeRow(row, {
        dots: segment => `${ESC}[2m${segment}${ESC}[22m`,
        status: segment => `${ESC}[31m${segment}${ESC}[39m`,
      })
      expect(forced).not.toBe(row.plainLine)
      expect(stripAnsi(forced)).toBe(row.plainLine)
    }
  })

  it('composes with identity decorators to exactly the plain line', () => {
    const row = formatCheckRow('Embedder', 'native (all-MiniLM-L6-v2)', 'pass', 120)
    expect(composeRow(row, IDENTITY_DECORATION)).toBe(row.plainLine)
  })
})

// ---------------------------------------------------------------------------
// 407-29 (G-407-14 · REVIEW WR-02): the flattening law.
//
// 407-24 gave every row a width budget, and the budget measures `String.length`. A `\n` counts as
// ONE column there and as a LINE BREAK on the terminal, so a message carrying one measures short,
// takes the one-line path, and prints with the status word pushed onto a second visual line —
// the exact detachment G-407-3 exists to prevent. None of the four producers that reach this
// renderer is a literal the repository controls: `doctor.ts:505` prints `err.message` from an
// arbitrary throw, `:502`/`:527`/`:557` print a plugin's `auth.message`, `:591` prints a
// 60-character slice of a provider SDK error, and `:399-401` joins Zod issue messages.
//
// The second half is the same root: `wrapWords` splits on `/\s+/`, so a message carrying a double
// space or a tab printed VERBATIM on a wide terminal and NORMALISED on a narrow one. A diagnostic
// whose text depends on the reader's window is a diagnostic two people cannot compare.
// ---------------------------------------------------------------------------

/**
 * The message text a row carries, whichever shape it took, with the LINE JOINS collapsed and
 * nothing else.
 *
 * Deliberately not a whitespace normaliser: normalising here would hide exactly the defect this
 * block measures. Continuation lines are trimmed and joined with one space because that join is
 * an artefact of wrapping; every other space inside the message is left exactly as the renderer
 * emitted it, so a double space surviving on one path and not the other still shows up.
 */
function messageTextOf(row: CheckRow): string {
  const parts = row.message === '' ? row.continuations : [row.message]
  return parts.map(part => part.trim()).join(' ')
}

/** A producer message carrying a break the command never wrote — `doctor.ts:505`, `:591`, `:401`. */
const NEWLINE_MESSAGE = 'Authentication failed\nresponse: 401'
/** A composed message whose spacing is deliberate, carrying a double space AND a tab. */
const SPACED_MESSAGE =
  'index at agent-qa-knowledge/memory/index/knowledge.db  could not be opened:\tcorrupt'

describe('doctor row renderer: the flattening law (407-29 · G-407-14)', () => {
  afterEach(() => {
    restoreTerminalWidth()
  })

  it('never emits a line containing the break a producer smuggled into the message', () => {
    for (const width of [40, 80, 200, 400]) {
      const row = formatCheckRow('LLM connection', NEWLINE_MESSAGE, 'fail', width)

      // A property of EVERY emitted line, not of one arrangement of one message: the assertion
      // scans what the command would print rather than comparing to a hand-built expectation.
      for (const line of [row.plainLine, ...row.continuations]) {
        expect(line).not.toContain('\n')
      }
    }
  })

  it('keeps the status word on the name line the terminal actually draws', () => {
    const row = formatCheckRow('LLM connection', NEWLINE_MESSAGE, 'fail', 80)

    // `plainLine` is ONE terminal line by construction, which is what makes the length check and
    // the display width the same number. Before flattening this split into two, and `FAIL` sat on
    // the second — read by a scanner as the verdict of the row below.
    expect(row.plainLine.split('\n')).toHaveLength(1)
    expect(row.plainLine).toContain('LLM connection')
    expect(row.plainLine).toContain('FAIL')
  })

  it('decides the shape on the flattened length, not on the raw one', () => {
    const wide = formatCheckRow('LLM connection', NEWLINE_MESSAGE, 'fail', 200)
    expect(wide.continuations).toEqual([])
    expect(wide.message).toBe('Authentication failed response: 401')

    const narrow = formatCheckRow('LLM connection', NEWLINE_MESSAGE, 'fail', 50)
    expect(narrow.message).toBe('')
    expect(narrow.continuations.length).toBeGreaterThan(0)
    expect(narrow.continuations.map(line => line.trim()).join(' '))
      .toBe('Authentication failed response: 401')
  })

  it('renders the same message text at 80 columns and at 400', () => {
    const narrow = formatCheckRow('Knowledge store', SPACED_MESSAGE, 'fail', 80)
    const wide = formatCheckRow('Knowledge store', SPACED_MESSAGE, 'fail', 400)

    // Non-vacuity: the two widths really did take the two different shapes, so this cannot pass by
    // both paths happening to be the same path.
    expect(narrow.continuations.length).toBeGreaterThan(0)
    expect(wide.continuations).toEqual([])

    expect(messageTextOf(narrow)).toBe(messageTextOf(wide))
    expect(messageTextOf(wide))
      .toBe('index at agent-qa-knowledge/memory/index/knowledge.db could not be opened: corrupt')
  })

  it('gives a whitespace-only message the no-message shape', () => {
    for (const blank of ['   ', '\t', '\n', ' \t \n ']) {
      const row = formatCheckRow('Embedder', blank, 'skip', 80)
      const empty = formatCheckRow('Embedder', '', 'skip', 80)

      expect(row.plainLine).toBe(empty.plainLine)
      expect(row.message).toBe('')
      expect(row.continuations).toEqual([])
    }
  })

  it('flattens the fix instruction too, so no Fix line carries a break', () => {
    const inputs = [
      'Rebuild the index with `agent-qa knowledge rebuild-index`,\nor remove the corrupt file.',
      'Run\t`agent-qa auth test`',
      '\n',
    ]

    for (const instructions of inputs) {
      for (const line of formatFixLines(instructions, 80)) {
        expect(line).not.toContain('\n')
        expect(line).not.toContain('\t')
      }
    }
  })
})

// ---------------------------------------------------------------------------
// 407-29 (G-407-18 · REVIEW WR-06): the status token is TYPED.
//
// 407-24 widened `formatStatus` from `CheckStatus` to `string` with an unchecked
// `STATUS_COLOURS[statusWord as StatusWord]` and an `undefined` fallback, so `formatStatus('pass')`
// — the lowercase value every other function in the file deals in, and the value the OLD signature
// accepted — type-checked, missed the table and printed a bare uncoloured word. The widening was
// never required: `RowDecoration.status` narrowed alongside it, so the decorator contract carries
// the type instead of discarding it.
// ---------------------------------------------------------------------------

describe('doctor status token (407-29 · G-407-18)', () => {
  it('paints every status word, and the table has no silent fallback left', async () => {
    // picocolors decides `isColorSupported` ONCE, at its own module load, and `STATUS_COLOURS`
    // captures the bound formatters. So the only way to see real paint is a fresh doctor module
    // over a colour-ENABLED picocolors. Without that this cell degrades to an identity check and
    // could not tell a painted word from a dropped table entry.
    vi.doMock('picocolors', async () => {
      const actual = await vi.importActual<{ default: typeof pc }>('picocolors')
      return { default: (actual.default as unknown as { createColors: (on: boolean) => typeof pc })
        .createColors(true) }
    })
    vi.resetModules()
    try {
      const { formatStatus: paint } = await import('../commands/doctor.js')

      for (const word of ['PASS', 'WARN', 'FAIL', 'SKIP'] as const) {
        const painted = paint(word)
        expect(painted).not.toBe(word)
        expect(stripAnsi(painted)).toBe(word)
      }
    } finally {
      vi.doUnmock('picocolors')
      vi.resetModules()
    }
  })

  it('rejects a lowercase CheckStatus where a status WORD belongs', () => {
    // @ts-expect-error 407-29 (REVIEW WR-06): a `CheckStatus` is not a `StatusWord`. This call
    // type-checked before the narrowing, missed the table and printed an uncoloured `pass`. The
    // directive is the gate: `tsconfig.json` includes `src`, so `tsc --noEmit` fails on an UNUSED
    // directive the moment anybody re-widens the parameter — it reds on the regression itself
    // rather than on its consequence. At runtime the total table has no `undefined` branch left,
    // so the same call throws instead of quietly degrading to a bare word.
    expect(() => formatStatus('pass')).toThrow(TypeError)
  })
})
