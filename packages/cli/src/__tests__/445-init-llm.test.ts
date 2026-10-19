// C445-INIT-LLM (445-04, D-11, D-36): init's model connection flags and their defaults
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Command } from 'commander'
import { parse as parseYaml } from 'yaml'

vi.mock('node:fs', () => ({
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => ''),
}))

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
  execFileSync: vi.fn(),
}))

vi.mock('../commands/init-filesystem.js', async () => {
  const fs = await import('node:fs')
  const writePlan = (plan: {
    path: string
    content: string | Uint8Array
    force?: boolean
    preserveOnForce?: boolean
  }) => {
    const exists = fs.existsSync(plan.path)
    if (exists && (!plan.force || plan.preserveOnForce)) {
      return { path: plan.path, outcome: 'preserved' as const }
    }
    fs.writeFileSync(plan.path, plan.content)
    return { path: plan.path, outcome: exists ? 'updated' as const : 'created' as const }
  }

  return {
    KNOWLEDGE_GITIGNORE_PROBES: [],
    TARGET_GITIGNORE_PROBES: [],
    classifyInitPath: vi.fn((path: string) => fs.existsSync(path) ? 'regular' : 'missing'),
    preflightInitPlan: vi.fn((plans: Array<{ path: string }>) => plans.map(plan => ({
      path: plan.path,
      classification: fs.existsSync(plan.path) ? 'regular' : 'missing',
    }))),
    writeScaffoldFileAtomic: vi.fn(writePlan),
    writeConfigMarkerLast: vi.fn(writePlan),
    upsertManagedGitignoreBlock: vi.fn((path: string) => {
      fs.writeFileSync(path, '# agent-qa init:start\n.agent-qa/\n# agent-qa init:end\n')
      return { path, outcome: 'created' as const }
    }),
    verifyEffectiveGitignore: vi.fn(() => ({ checked: true })),
  }
})

vi.mock('../commands/install-browsers.js', () => ({
  formatInstallBrowsersRetryCommand: vi.fn(() => 'agent-qa install-browsers --chromium'),
  runBrowserInstall: vi.fn(() => ({ ok: true, status: 0, stage: 'installer' })),
}))

vi.mock('@inquirer/select', () => ({ default: vi.fn() }))
vi.mock('@inquirer/input', () => ({ default: vi.fn() }))
vi.mock('@inquirer/checkbox', () => ({ default: vi.fn() }))
vi.mock('@inquirer/confirm', () => ({ default: vi.fn() }))
vi.mock('@inquirer/password', () => ({ default: vi.fn() }))

vi.mock('@vostride/agent-qa-core', () => ({
  writeAuth: vi.fn(() => Promise.resolve()),
  resolveAppiumExecutable: vi.fn(() => ({ command: 'appium', source: 'path' })),
  formatAppiumInstallGuidance: vi.fn(() => 'Install Appium locally.'),
  DEFAULT_AGENT_QA_AUTH_STATES_DIR: '.agent-qa/auth-states',
  DEFAULT_AGENT_QA_CACHE_DIR: '.agent-qa/cache',
  DEFAULT_AGENT_QA_RUNTIME_DIR: '.agent-qa',
  getAgentQaVersion: vi.fn(() => '0.1.1'),
}))

import { createInitCommand, EXAMPLE_SECRET_LINE } from '../commands/init.js'
import { preflightInitPlan, writeScaffoldFileAtomic } from '../commands/init-filesystem.js'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import select from '@inquirer/select'
import input from '@inquirer/input'
import checkbox from '@inquirer/checkbox'
import confirm from '@inquirer/confirm'
import password from '@inquirer/password'
import { getProvider } from '@vostride/agent-qa-model'

const DIR = '/tmp/c445-init-llm'
const SUBSCRIPTION_AUTH_PACKAGE = '@vostride/agent-qa-subscription-auth'
const mockWriteFileSync = vi.mocked(writeFileSync)
const prompts = [select, input, checkbox, confirm, password].map(fn => vi.mocked(fn))

let stderr: string[] = []
let previousExitCode: typeof process.exitCode

async function runInit(args: string[], isTTY = false): Promise<void> {
  const parent = new Command()
  const init = createInitCommand({ isTTY } as Parameters<typeof createInitCommand>[0])
  parent.exitOverride()
  init.exitOverride()
  init.configureOutput({ writeErr: text => { stderr.push(text) }, writeOut: () => {} })
  parent.addCommand(init)
  await parent.parseAsync(['node', 'agent-qa', 'init', '--dir', DIR, ...args])
}

async function initOk(args: string[], isTTY = false): Promise<void> {
  await expect(runInit(args, isTTY)).resolves.toBeUndefined()
}

function writtenText(path: string): string {
  const call = mockWriteFileSync.mock.calls.find(entry => String(entry[0]) === `${DIR}/${path}`)
  expect(call, `init wrote ${path}`).toBeDefined()
  return String(call![1])
}

function writtenConfig(): any {
  return parseYaml(writtenText('agent-qa.config.yaml'))
}

function registryDefault(provider: string): string {
  const model = getProvider(provider)?.defaultModel
  expect(model, `${provider} has a registry default model`).toMatch(/\S/u)
  return model!
}

function refusalOutput(): string {
  return [...stderr, ...vi.mocked(console.error).mock.calls.flat().map(String)].join('\n')
}

function expectNothingWritten(): void {
  expect(vi.mocked(preflightInitPlan)).not.toHaveBeenCalled()
  expect(vi.mocked(writeScaffoldFileAtomic)).not.toHaveBeenCalled()
  expect(mockWriteFileSync).not.toHaveBeenCalled()
}

function expectNoPrompt(): void {
  for (const prompt of prompts) expect(prompt).not.toHaveBeenCalled()
}

beforeEach(() => {
  vi.clearAllMocks()
  stderr = []
  previousExitCode = process.exitCode
  process.exitCode = undefined
  vi.mocked(existsSync).mockReturnValue(false)
  vi.mocked(readFileSync).mockImplementation(() => '')
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  process.exitCode = previousExitCode
  vi.restoreAllMocks()
})

describe('C445-INIT-LLM', () => {
  it('--llm codex writes one codex entry on the Codex subscription and declares the plugin', async () => {
    await initOk(['--platform', 'web', '--llm', 'codex'])

    const config = writtenConfig()
    expect(config.registry.llms).toEqual([
      { name: 'codex', provider: 'openai-subscription', model: registryDefault('openai-subscription') },
    ])
    expect(config.use.llm).toBe('codex')
    expect(config.plugins.auth).toEqual([{ package: SUBSCRIPTION_AUTH_PACKAGE }])
    expectNoPrompt()
  })

  it('with no flags and no terminal, init writes the claude-code entry and asks nothing', async () => {
    await initOk([])

    const config = writtenConfig()
    expect(config.registry.llms).toEqual([
      {
        name: 'claude-code',
        provider: 'anthropic-subscription',
        model: registryDefault('anthropic-subscription'),
      },
    ])
    expect(config.use.llm).toBe('claude-code')
    expect(config.plugins.auth).toEqual([{ package: SUBSCRIPTION_AUTH_PACKAGE }])
    for (const path of [
      'tests/examples/komazon-checkout.yaml',
      'tests/examples/komazon-cart-total-bug.yaml',
      'tests/examples/komazon-shipping-hook.yaml',
      'suites/examples.suite.yaml',
    ]) {
      expect(writtenText(path)).toMatch(/\S/u)
    }
    expect(writtenText('.env.secrets.local').split('\n')).toContain(EXAMPLE_SECRET_LINE)
    expectNoPrompt()
  })

  it('--llm anthropic-compatible writes a default entry with the Anthropic API base URL and no plugin', async () => {
    await initOk(['--platform', 'web', '--llm', 'anthropic-compatible'])

    const config = writtenConfig()
    expect(config.registry.llms).toEqual([
      {
        name: 'default',
        provider: 'anthropic-compatible',
        model: registryDefault('anthropic-compatible'),
        baseURL: 'https://api.anthropic.com/v1',
      },
    ])
    expect(config.use.llm).toBe('default')
    expect(config).not.toHaveProperty('plugins')
    expect(mockWriteFileSync.mock.calls.some(call => String(call[0]).endsWith('package.json')))
      .toBe(false)
    expectNoPrompt()
  })

  it('--llm openai-compatible takes --model and --base-url as given', async () => {
    await initOk([
      '--platform', 'web',
      '--llm', 'openai-compatible',
      '--model', 'gpt-test',
      '--base-url', 'https://llm.internal.test/v1',
    ])

    const config = writtenConfig()
    expect(config.registry.llms).toEqual([
      {
        name: 'default',
        provider: 'openai-compatible',
        model: 'gpt-test',
        baseURL: 'https://llm.internal.test/v1',
      },
    ])
    expect(config.use.llm).toBe('default')
    expect(config).not.toHaveProperty('plugins')
    expectNoPrompt()
  })

  it('--llm gemini writes a default entry with no base URL and no plugin', async () => {
    await initOk(['--platform', 'web', '--llm', 'gemini'])

    const config = writtenConfig()
    expect(config.registry.llms).toEqual([
      { name: 'default', provider: 'gemini', model: registryDefault('gemini') },
    ])
    expect(config.use.llm).toBe('default')
    expect(config).not.toHaveProperty('plugins')
    expectNoPrompt()
  })

  it('an unknown --llm value is refused before anything is written', async () => {
    await expect(runInit(['--platform', 'web', '--llm', 'gpt']))
      .rejects.toMatchObject({ code: 'commander.invalidArgument' })

    expect(refusalOutput()).toContain('claude-code')
    expectNothingWritten()
    expectNoPrompt()
  })

  it('a base URL is refused for a provider that takes none or when it is not an absolute http or https URL', async () => {
    await initOk(['--platform', 'web', '--llm', 'codex', '--base-url', 'https://x.test/v1'])
    expect(process.exitCode).toBe(1)
    expect(refusalOutput())
      .toContain('--base-url applies only to --llm openai-compatible or anthropic-compatible')
    expectNothingWritten()

    vi.clearAllMocks()
    stderr = []
    process.exitCode = undefined
    await initOk(['--platform', 'web', '--llm', 'openai-compatible', '--base-url', 'ftp://x.test'])
    expect(process.exitCode).toBe(1)
    expect(refusalOutput()).toContain('--base-url must be an absolute http or https URL')
    expectNothingWritten()
    expectNoPrompt()
  })
})
