// C445-EXAMPLES (445-02, D-06, D-26, D-32): init writes the Komazon examples, suite and targets
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Command } from 'commander'
import { parse as parseYaml } from 'yaml'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { stripVTControlCharacters } from 'node:util'

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
import { buildScaffoldFileSet } from '../commands/scaffold-content.js'
import { writeFileSync, existsSync, readFileSync } from 'node:fs'
import { clearProviderRegistry } from '@vostride/agent-qa-model'
import { isCanonicalSuiteId, isCanonicalTestId } from '@vostride/agent-qa-ids'

const mockWriteFileSync = vi.mocked(writeFileSync)
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')

const DIR = '/tmp/c445-examples'
const CHECKOUT = 'tests/examples/komazon-checkout.yaml'
const CART_TOTAL_BUG = 'tests/examples/komazon-cart-total-bug.yaml'
const SUITE = 'suites/examples.suite.yaml'
const EXAMPLE_PREFIXES = ['tests/examples/', 'scripts/examples/']
const BUG_URL = 'https://playground.vostride.dev/shop/?bug=cart-total'
const KOMAZON_TARGETS = {
  komazon: { platform: 'web', url: 'https://playground.vostride.dev/shop/' },
  'komazon-cart-total-bug': { platform: 'web', url: BUG_URL },
}
const RETIRED_PATHS = [
  'tests/example-pass.yaml',
  'tests/example-fail.yaml',
  'tests/automation-exercise/home-smoke.yaml',
  'tests/automation-exercise/products-smoke.yaml',
  'tests/automation-exercise/cart-smoke.yaml',
  'suites/automation-exercise.suite.yaml',
  'tests/hacker-news-top-story.yaml',
  'scripts/fetch-hn-top-story.mjs',
  'tests/bad-a11y.yaml',
]
const RETIRED_TARGETS = ['example-web', 'automation-exercise', 'wai-bad']
const RETIRED_IDS = [
  't_amber-birch-coral-delta-ember-falcon-garden-harbor-island-jungle',
  't_bronze-cedar-dune-ember-fjord-glade-harbor-ivory-jade-kelp',
  't_class-volume-nth-intent-break-gun-gone-ging-twig-vert',
  't_umble-ruby-direct-notify-rama-phony-dust-owl-lop-etch',
  't_kend-lack-infect-nou-bah-kil-point-reak-ura-loo',
  's_hill-gant-verb-nast-hunter-rita-home-store-amy-crest',
  't_quad-adar-micro-magic-cross-cue-open-agog-rang-cours',
  't_ponent-toa-base-fred-click-sigma-lad-agen-report-sticky',
  'h_aster-bloom-cloud-drift-ember-field-glade-hollow-ivory-jasper',
]
const RETIRED_NAMES = [
  'example-pass',
  'example-fail',
  'automation-exercise',
  'hacker-news-top-story',
  'fetch-hn-top-story',
  'bad-a11y',
]

type Write = { path: string; content: string }

async function runInit(args: string[]): Promise<void> {
  const parent = new Command()
  const init = createInitCommand({})
  parent.exitOverride()
  init.exitOverride()
  parent.addCommand(init)
  await parent.parseAsync(['node', 'test', 'init', ...args])
}

async function initWrites(platform = 'web'): Promise<Write[]> {
  mockWriteFileSync.mockClear()
  vi.mocked(console.log).mockClear()
  await runInit(['--dir', DIR, '--platform', platform])
  return mockWriteFileSync.mock.calls.map(call => ({
    path: String(call[0]).slice(DIR.length + 1),
    content: String(call[1]),
  }))
}

function written(writes: Write[], path: string): { raw: string; doc: any } {
  const write = writes.find(entry => entry.path === path)
  expect(write, `init wrote ${path}`).toBeDefined()
  return { raw: write!.content, doc: parseYaml(write!.content) }
}

function consoleOutput(): string {
  return stripVTControlCharacters(vi.mocked(console.log).mock.calls.flat().map(String).join('\n'))
}

async function loadCoreYamlValidators() {
  const moduleUrl = (path: string) => pathToFileURL(resolve(repoRoot, path)).href
  const [yamlParser, suiteSchema] = await Promise.all([
    import(/* @vite-ignore */ moduleUrl('packages/core/src/parser/yaml-parser.ts')),
    import(/* @vite-ignore */ moduleUrl('packages/core/src/schema/suite-schema.ts')),
  ])
  return {
    parseTestFile: yamlParser.parseTestFile as (
      content: string,
      filePath: string,
    ) => { tests: any[]; errors: any[] },
    SuiteDefinitionSchema: suiteSchema.SuiteDefinitionSchema,
  }
}

describe('C445-EXAMPLES', () => {
  beforeEach(() => {
    clearProviderRegistry()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.clearAllMocks()
    vi.mocked(existsSync).mockReturnValue(false)
    vi.mocked(readFileSync).mockImplementation(path =>
      String(path).endsWith('package.json') ? '{"version":"0.1.1"}' : '',
    )
  })

  afterEach(() => {
    clearProviderRegistry()
    vi.restoreAllMocks()
  })

  it('init writes the examples in their own folder and the suite selects the journey then the failing test', async () => {
    const writes = await initWrites()
    const checkout = written(writes, CHECKOUT).doc
    const bug = written(writes, CART_TOTAL_BUG).doc
    const suite = written(writes, SUITE).doc

    expect(suite.target).toBe('komazon')
    expect(suite.tests).toEqual([
      { test: CHECKOUT, id: checkout['test-id'] },
      { test: CART_TOTAL_BUG, id: bug['test-id'] },
    ])

    const samplePaths = writes
      .map(write => write.path)
      .filter(path => /^(tests|suites|scripts)\//.test(path))
    expect(samplePaths.length).toBeGreaterThanOrEqual(3)
    for (const path of samplePaths) {
      const inExamples = path === SUITE || EXAMPLE_PREFIXES.some(prefix => path.startsWith(prefix))
      expect(inExamples, `${path} is outside the examples paths`).toBe(true)
    }
  })

  it('the passing journey resets the session, signs in with the declared secret and checks the order in View orders', async () => {
    const { raw, doc } = written(await initWrites(), CHECKOUT)
    const steps = doc.steps as string[]

    expect(doc.target).toBe('komazon')
    expect(steps[0]).toContain('Reset playground session')
    const signIn = steps.find(step => step.includes('alex@example.com'))
    expect(signIn, 'a step signs in with the printed email').toBeDefined()
    expect(signIn).toContain('{{secret:KOMAZON_PASSWORD}}')
    expect(steps.some(step => /add everyday ceramic mug/i.test(step))).toBe(true)
    expect(steps.some(step => step.includes('Place order'))).toBe(true)
    expect(steps.at(-1)).toContain('View orders')
    expect(steps.at(-1)).toContain('Everyday Ceramic Mug')
    expect(raw).not.toContain('headless')
  })

  it('the failing test reaches the bug through its first step and never resets', async () => {
    const { raw, doc } = written(await initWrites(), CART_TOTAL_BUG)
    const steps = doc.steps as string[]

    expect(doc.target).toBe('komazon-cart-total-bug')
    expect(steps[0]).toMatch(/^Navigate to /)
    expect(steps[0]).toContain(BUG_URL)
    expect(steps.some(step => /two Everyday Ceramic Mugs/.test(step))).toBe(true)
    expect(steps.some(step => step.includes('$53.00'))).toBe(true)
    for (const step of steps) {
      expect(step, 'the failing test resets or disables the bug').not.toMatch(/reset|disable/i)
    }
    expect(raw).not.toContain('headless')
  })

  it('the targets are komazon and komazon-cart-total-bug with no product field', async () => {
    const expected: Record<string, Record<string, unknown>> = {
      web: KOMAZON_TARGETS,
      android: { 'example-android': { platform: 'android' } },
      ios: { 'example-ios': { platform: 'ios' } },
      'web+android': { ...KOMAZON_TARGETS, 'example-android': { platform: 'android' } },
      'web+ios': { ...KOMAZON_TARGETS, 'example-ios': { platform: 'ios' } },
    }
    for (const [platform, targets] of Object.entries(expected)) {
      const config = written(await initWrites(platform), 'agent-qa.config.yaml').doc
      expect(config.registry.targets, platform).toEqual(targets)
    }
  })

  it('init writes none of the retired samples', async () => {
    const writes = await initWrites()
    const paths = writes.map(write => write.path)
    for (const path of RETIRED_PATHS) {
      expect(paths, `init still writes ${path}`).not.toContain(path)
    }

    const config = written(writes, 'agent-qa.config.yaml').doc
    for (const target of RETIRED_TARGETS) {
      expect(Object.keys(config.registry.targets), `target ${target}`).not.toContain(target)
    }
    for (const write of writes) {
      for (const id of RETIRED_IDS) {
        expect(write.content, `${write.path} carries ${id}`).not.toContain(id)
      }
    }

    const output = consoleOutput()
    const nextSteps = output.slice(output.indexOf('Next steps:'))
    expect(output).toContain('Next steps:')
    for (const name of RETIRED_NAMES) {
      expect(nextSteps, `the next steps name ${name}`).not.toContain(name)
    }
    const named = nextSteps.match(/\b(?:tests|suites|scripts)\/[\w./-]+/g) ?? []
    expect(named.length, 'the next steps name no example file').toBeGreaterThan(0)
    for (const path of named) {
      expect(paths, `the next steps name ${path}, which init does not write`).toContain(path)
    }
  })

  it('every generated test and suite parses with the shipped schemas', async () => {
    const writes = await initWrites()
    const { parseTestFile, SuiteDefinitionSchema } = await loadCoreYamlValidators()

    for (const path of [CHECKOUT, CART_TOTAL_BUG]) {
      const { raw } = written(writes, path)
      const parsed = parseTestFile(raw, path)
      expect(parsed.errors, path).toEqual([])
      expect(parsed.tests, path).toHaveLength(1)
      expect(isCanonicalTestId(parsed.tests[0]['test-id']), path).toBe(true)
    }

    const suite = SuiteDefinitionSchema.safeParse(written(writes, SUITE).doc)
    if (!suite.success) throw new Error(JSON.stringify(suite.error.issues, null, 2))
    expect(isCanonicalSuiteId(suite.data['suite-id'])).toBe(true)
    for (const member of suite.data.tests) {
      expect(isCanonicalTestId(member.id), member.test).toBe(true)
    }
  })

  it('the example files are written before the config, which is written last', async () => {
    const paths = (await initWrites()).map(write => write.path)
    const configIndex = paths.indexOf('agent-qa.config.yaml')

    expect(configIndex).toBe(paths.length - 1)
    for (const path of [CHECKOUT, CART_TOTAL_BUG, SUITE]) {
      const index = paths.indexOf(path)
      expect(index, `init wrote ${path}`).toBeGreaterThanOrEqual(0)
      expect(index, `${path} is written after the config`).toBeLessThan(configIndex)
    }
  })

  it('accessibility runs at test end, never fails the run, and its comment sits on the accessibility block', async () => {
    const writes = await initWrites()
    const { raw, doc } = written(writes, 'agent-qa.config.yaml')

    expect(doc.services.accessibility).toEqual({
      enabled: true,
      standard: 'wcag2aa',
      runAfter: 'test-end',
      failOnViolation: false,
    })
    const lines = raw.split('\n')
    const block = lines.indexOf('  accessibility:')
    expect(block, 'the config has an accessibility block').toBeGreaterThan(0)
    expect(lines[block - 1], 'the line above the accessibility block').toMatch(/^ {2}# \S/)
    for (const write of writes) {
      expect(write.content, write.path).not.toContain('W3C')
      expect(write.content, write.path).not.toContain('BAD demo')
    }
  })

  it('the config scaffold proposal writes an empty hooks list and names no script', () => {
    const input = {
      cacheDir: '.agent-qa/cache',
      authStatesDir: '.agent-qa/auth-states',
      targetName: 'booking-com',
      baseUrl: 'https://booking.com',
      gitignoreEntries: ['.env'],
    }
    const fresh = buildScaffoldFileSet(input)
    const merged = buildScaffoldFileSet({
      ...input,
      existingConfig: {
        path: 'agent-qa.config.yaml',
        text: 'registry:\n  llms: []\n',
        hooksPath: 'hooks.yaml',
        hooksPresent: false,
      },
    })

    for (const [mode, files] of [['fresh', fresh], ['merge', merged]] as const) {
      const hooks = files.find(file => file.path === 'hooks.yaml')
      expect(hooks, `${mode}: the proposal has a hooks member`).toBeDefined()
      expect(hooks!.text, mode).toBe('hooks: []\n')
      expect(hooks!.text, mode).not.toContain('file:')
    }
  })
})
