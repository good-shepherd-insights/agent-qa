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
  const writePlan = (plan: { path: string; content: string | Uint8Array }) => {
    fs.writeFileSync(plan.path, plan.content)
    return { path: plan.path, outcome: 'created' as const }
  }

  return {
    KNOWLEDGE_GITIGNORE_PROBES: [],
    TARGET_GITIGNORE_PROBES: [],
    classifyInitPath: vi.fn(() => 'missing'),
    preflightInitPlan: vi.fn((plans: Array<{ path: string }>) => plans.map(plan => ({
      path: plan.path,
      classification: 'missing',
    }))),
    writeScaffoldFileAtomic: vi.fn(writePlan),
    writeConfigMarkerLast: vi.fn(writePlan),
    upsertManagedGitignoreBlock: vi.fn((path: string) => {
      fs.writeFileSync(path, '# agent-qa init:start\n# agent-qa init:end\n')
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

import { createInitCommand } from '../commands/init.js'
import { writeFileSync, existsSync, readFileSync } from 'node:fs'
import { clearProviderRegistry } from '@vostride/agent-qa-model'

const mockWriteFileSync = vi.mocked(writeFileSync)

const PASS_STEPS = [
  'Verify the page says "This domain is for use in documentation examples"',
  'Click on "Learn more"',
  'Verify the page url is "https://www.iana.org/help/example-domains"',
]

const FAIL_STEPS = [
  PASS_STEPS[0],
  PASS_STEPS[1],
  'Verify the page url is "https://www.iana.org/example-domains"',
]

async function runInit(args: string[]): Promise<void> {
  const parent = new Command()
  const init = createInitCommand({})
  parent.exitOverride()
  init.exitOverride()
  parent.addCommand(init)
  await parent.parseAsync(['node', 'test', 'init', ...args])
}

function sample(fileName: string): { raw: string; doc: any } {
  const call = mockWriteFileSync.mock.calls.find(c => String(c[0]).endsWith(`tests/${fileName}`))
  expect(call, `init wrote tests/${fileName}`).toBeDefined()
  const raw = String(call![1])
  return { raw, doc: parseYaml(raw) }
}

describe('C433-SCAFFOLD-SAMPLES: the scaffolded example samples assert what example.com shows', () => {
  beforeEach(async () => {
    clearProviderRegistry()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.clearAllMocks()
    vi.mocked(existsSync).mockReturnValue(false)
    vi.mocked(readFileSync).mockImplementation(path => String(path).endsWith('package.json') ? '{"version":"0.1.1"}' : '')
    await runInit(['--dir', '/tmp/test-project', '--platform', 'web', '--skip-install'])
  })

  afterEach(() => {
    clearProviderRegistry()
    vi.restoreAllMocks()
  })

  it('C433-SCAFFOLD-SAMPLES pass: example-pass.yaml has exactly the visible-text, Learn more and help-URL steps', () => {
    expect(sample('example-pass.yaml').doc.steps).toEqual(PASS_STEPS)
  })

  it('C433-SCAFFOLD-SAMPLES fail: example-fail.yaml shares steps 1-2 and fails only at its designed URL step', () => {
    expect(sample('example-fail.yaml').doc.steps).toEqual(FAIL_STEPS)
  })

  it('C433-SCAFFOLD-SAMPLES title: neither sample asserts the <title>-only text "Example Domain"', () => {
    expect(sample('example-pass.yaml').raw).not.toContain('"Example Domain"')
    expect(sample('example-fail.yaml').raw).not.toContain('"Example Domain"')
  })

  it('C433-SCAFFOLD-SAMPLES identity: ids, names, target and the headed fail override are unchanged', () => {
    const pass = sample('example-pass.yaml').doc
    const fail = sample('example-fail.yaml').doc
    expect(pass['test-id']).toBe('t_amber-birch-coral-delta-ember-falcon-garden-harbor-island-jungle')
    expect(pass.name).toBe('Example passing test')
    expect(pass.target).toBe('example-web')
    expect(pass.use).toBeUndefined()
    expect(fail['test-id']).toBe('t_bronze-cedar-dune-ember-fjord-glade-harbor-ivory-jade-kelp')
    expect(fail.name).toBe('Example failing test')
    expect(fail.target).toBe('example-web')
    expect(fail.use).toEqual({ browser: { headless: false } })
  })
})
