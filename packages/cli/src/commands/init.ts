import { Command } from 'commander'
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { stringify } from 'yaml'
import pc from 'picocolors'
import select from '@inquirer/select'
import input from '@inquirer/input'
import checkbox from '@inquirer/checkbox'
import {
  DEFAULT_AGENT_QA_AUTH_STATES_DIR,
  DEFAULT_AGENT_QA_CACHE_DIR,
  DEFAULT_AGENT_QA_RUNTIME_DIR,
} from '@vostride/agent-qa-core'
import { getProvider, listProviders } from '@vostride/agent-qa-model'
import { DEFAULT_ANTHROPIC_MODEL, DEFAULT_OPENAI_MODEL } from '../model-defaults.js'

type Platform = 'web' | 'android' | 'ios' | 'web+android' | 'web+ios'
type PlatformCapability = 'web' | 'mobile'
type MobileRuntime = 'android' | 'ios'
type InitPlatformSelection = {
  capabilities: PlatformCapability[]
  mobileRuntimes: MobileRuntime[]
}
type InitPlatformInput = Platform | InitPlatformSelection
type LLMSetupChoice = 'none' | 'codex' | 'claude-code'
type InitLLMConfig = {
  name: string
  provider: string
  model: string
  baseURL?: string
}
const INIT_CACHE_DIR = DEFAULT_AGENT_QA_CACHE_DIR || '.agent-qa/cache'
const INIT_AUTH_STATES_DIR = DEFAULT_AGENT_QA_AUTH_STATES_DIR || '.agent-qa/auth-states'
const INIT_RUNTIME_DIR = DEFAULT_AGENT_QA_RUNTIME_DIR || '.agent-qa'
const SUBSCRIPTION_AUTH_PACKAGE = '@vostride/agent-qa-subscription-auth'
const PACKAGE_JSON_FILE = 'package.json'
const DEFAULT_SCREENSHOT_SIZE = '256k'
const DEFAULT_EFFECTIVE_RESOLUTION = 768
const OPENAI_SUBSCRIPTION_CONFIG: InitLLMConfig = {
  name: 'codex',
  provider: 'openai-subscription',
  model: DEFAULT_OPENAI_MODEL,
}
const ANTHROPIC_SUBSCRIPTION_CONFIG: InitLLMConfig = {
  name: 'claude-subscription',
  provider: 'anthropic-subscription',
  model: DEFAULT_ANTHROPIC_MODEL,
}

export function getProviderChoices(): Array<{ value: string; name: string }> {
  return listProviders().map(provider => ({ value: provider.id, name: provider.label }))
}

export function getCompatibleProviderChoices(): Array<{ value: string; name: string }> {
  return getProviderChoices().filter(choice => !getProvider(choice.value)?.subscription)
}
export const LLM_SETUP_CHOICES: Array<{ value: LLMSetupChoice; name: string; description: string }> = [
  {
    value: 'none',
    name: 'No subscription auth',
    description: 'Configure OpenAI-compatible, Anthropic-compatible, or Gemini credentials later.',
  },
  {
    value: 'codex',
    name: 'Codex',
    description: 'Use your existing OpenAI Codex subscription through the subscription-auth plugin.',
  },
  {
    value: 'claude-code',
    name: 'Claude Code',
    description: 'Use your existing Anthropic Claude subscription through the subscription-auth plugin.',
  },
]

function normalizePlatformSelection(platform: InitPlatformInput): InitPlatformSelection {
  if (typeof platform !== 'string') {
    return {
      capabilities: [...new Set(platform.capabilities)],
      mobileRuntimes: [...new Set(platform.mobileRuntimes)],
    }
  }

  switch (platform) {
    case 'web':
      return { capabilities: ['web'], mobileRuntimes: [] }
    case 'android':
      return { capabilities: ['mobile'], mobileRuntimes: ['android'] }
    case 'ios':
      return { capabilities: ['mobile'], mobileRuntimes: ['ios'] }
    case 'web+android':
      return { capabilities: ['web', 'mobile'], mobileRuntimes: ['android'] }
    case 'web+ios':
      return { capabilities: ['web', 'mobile'], mobileRuntimes: ['ios'] }
  }
}

function hasWeb(platform: InitPlatformInput): boolean {
  return normalizePlatformSelection(platform).capabilities.includes('web')
}

function defaultExampleTargetName(platform: InitPlatformInput): string {
  const selection = normalizePlatformSelection(platform)
  if (hasWeb(platform)) return 'example-web'
  if (selection.mobileRuntimes.includes('android')) return 'example-android'
  return 'example-ios'
}

function buildTargets(platform: InitPlatformInput): Record<string, unknown> {
  const selection = normalizePlatformSelection(platform)
  const targets: Record<string, unknown> = {}

  if (selection.capabilities.includes('web')) {
    targets['example-web'] = { platform: 'web', url: 'https://example.com' }
    targets['automation-exercise'] = { platform: 'web', url: 'https://automationexercise.com' }
    targets['wai-bad'] = { platform: 'web', url: 'https://www.w3.org/WAI/demos/bad/before/home.html' }
  }
  if (selection.mobileRuntimes.includes('android')) {
    targets['example-android'] = { platform: 'android' }
  }
  if (selection.mobileRuntimes.includes('ios')) {
    targets['example-ios'] = { platform: 'ios' }
  }

  return targets
}

function buildExampleTest(platform: InitPlatformInput, variant: 'pass' | 'fail'): string {
  const expectedUrl = variant === 'pass'
    ? 'https://www.iana.org/help/example-domains'
    : 'https://www.iana.org/example-domains'
  const testId = variant === 'pass'
    ? 't_amber-birch-coral-delta-ember-falcon-garden-harbor-island-jungle'
    : 't_bronze-cedar-dune-ember-fjord-glade-harbor-ivory-jade-kelp'
  const name = variant === 'pass' ? 'Example passing test' : 'Example failing test'
  const browserOverride = variant === 'fail' && hasWeb(platform)
    ? `use:
  browser:
    headless: false
`
    : ''

  return `test-id: ${testId}
name: ${name}
target: ${defaultExampleTargetName(platform)}
${browserOverride}steps:
  - Verify the page says "Example Domain"
  - Click on "Learn More"
  - Verify the page url is "${expectedUrl}"
`
}

const AUTOMATION_EXERCISE_TESTS = [
  {
    fileName: 'home-smoke.yaml',
    id: 't_class-volume-nth-intent-break-gun-gone-ging-twig-vert',
    name: 'Automation Exercise home smoke',
    steps: [
      'Verify the page says "Automation Exercise"',
      'Verify the page has "Signup / Login"',
    ],
  },
  {
    fileName: 'products-smoke.yaml',
    id: 't_umble-ruby-direct-notify-rama-phony-dust-owl-lop-etch',
    name: 'Automation Exercise products smoke',
    steps: [
      'Click on "Products"',
      'Verify the page says "All Products"',
    ],
  },
  {
    fileName: 'cart-smoke.yaml',
    id: 't_kend-lack-infect-nou-bah-kil-point-reak-ura-loo',
    name: 'Automation Exercise cart smoke',
    steps: [
      'Click on "Cart"',
      'Verify the page says "Shopping Cart"',
    ],
  },
]
const HN_TOP_STORY_HOOK_ID = 'h_aster-bloom-cloud-drift-ember-field-glade-hollow-ivory-jasper'
const HN_TOP_STORY_TEST_ID = 't_quad-adar-micro-magic-cross-cue-open-agog-rang-cours'
const BAD_A11Y_TEST_ID = 't_ponent-toa-base-fred-click-sigma-lad-agen-report-sticky'

function buildAutomationExerciseTest(test: typeof AUTOMATION_EXERCISE_TESTS[number]): string {
  return `test-id: ${test.id}
name: ${test.name}
target: automation-exercise
steps:
${test.steps.map(step => `  - ${step}`).join('\n')}
`
}

function buildAutomationExerciseSuite(): string {
  return `suite-id: s_hill-gant-verb-nast-hunter-rita-home-store-amy-crest
name: Automation Exercise demo suite
target: automation-exercise
tests:
${AUTOMATION_EXERCISE_TESTS.map(test => `  - test: tests/automation-exercise/${test.fileName}\n    id: ${test.id}`).join('\n')}
`
}

function buildHooksFile(platform: InitPlatformInput): string {
  if (!hasWeb(platform)) return 'hooks: []\n'

  return `hooks:
  - id: ${HN_TOP_STORY_HOOK_ID}
    name: Fetch first Hacker News story
    runtime: node
    file: scripts/fetch-hn-top-story.mjs
    timeout: 30s
    network: true
`
}

function buildHackerNewsHookScript(): string {
  return `import { writeFile } from 'node:fs/promises'

const topStoriesUrl = 'https://hacker-news.firebaseio.com/v0/topstories.json'

async function getJson(url) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(\`HN API request failed: \${response.status} \${response.statusText}\`)
  }
  return response.json()
}

function escapeEnvValue(value) {
  return value
    .replace(/\\r?\\n/g, ' ')
    .replace(/\\\\/g, '\\\\\\\\')
    .replace(/"/g, '\\\\"')
}

const storyIds = await getJson(topStoriesUrl)
const firstStoryId = Array.isArray(storyIds) ? storyIds[0] : undefined
if (!Number.isInteger(firstStoryId)) {
  throw new Error('HN API returned no first story id')
}

const story = await getJson(\`https://hacker-news.firebaseio.com/v0/item/\${firstStoryId}.json\`)
const title = typeof story?.title === 'string' ? story.title.trim() : ''
if (!title) {
  throw new Error(\`HN item \${firstStoryId} returned no title\`)
}

await writeFile('/tmp/agent-qa.env', [
  \`HN_FIRST_STORY_TITLE="\${escapeEnvValue(title)}"\`,
  \`HN_FIRST_STORY_ID=\${firstStoryId}\`,
  '',
].join('\\n'), 'utf-8')
`
}

function buildHackerNewsTopStoryTest(): string {
  return `test-id: ${HN_TOP_STORY_TEST_ID}
name: Hacker News top story hook demo
target: example-web
setup:
  - ${HN_TOP_STORY_HOOK_ID}
use:
  cache: false
steps:
  - Navigate to "https://news.ycombinator.com/"
  - Verify the page shows "{{env:HN_FIRST_STORY_TITLE}}"
`
}

function buildBadA11yTest(): string {
  return `test-id: ${BAD_A11Y_TEST_ID}
name: W3C BAD accessibility smoke
target: wai-bad
steps:
  - Verify the page says "Welcome to CityLights"
  - Verify the page says "Inaccessible Home Page"
`
}

function isSubscriptionProvider(provider: string): boolean {
  return getProvider(provider)?.subscription === true
}

function readAgentQaPackageVersion(): string | null {
  try {
    const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf-8')) as Record<string, unknown>
    return typeof manifest.version === 'string' && manifest.version.trim() ? manifest.version.trim() : null
  } catch {
    return null
  }
}

function subscriptionAuthDependencyRange(): string {
  return readAgentQaPackageVersion() ?? '*'
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function configUsesSubscriptionAuth(config: Record<string, unknown>): boolean {
  const plugins = objectRecord(config.plugins)
  const authPlugins = plugins?.auth
  if (!Array.isArray(authPlugins)) return false
  return authPlugins.some(plugin => objectRecord(plugin)?.package === SUBSCRIPTION_AUTH_PACKAGE)
}

type SubscriptionAuthDependencyResult = {
  path: string
  created: boolean
  range: string
}

export function upsertSubscriptionAuthPackageDependency(dir: string): SubscriptionAuthDependencyResult {
  const packageJsonPath = join(dir, PACKAGE_JSON_FILE)
  const created = !existsSync(packageJsonPath)
  const pkg = created
    ? { private: true } as Record<string, unknown>
    : JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as Record<string, unknown>

  if (!objectRecord(pkg)) {
    throw new Error(`${PACKAGE_JSON_FILE} must contain a JSON object to add ${SUBSCRIPTION_AUTH_PACKAGE}`)
  }

  const dependencyBlocks = ['devDependencies', 'dependencies', 'optionalDependencies', 'peerDependencies'] as const
  const existingBlock = dependencyBlocks.find(blockName => {
    const block = objectRecord(pkg[blockName])
    return block && Object.prototype.hasOwnProperty.call(block, SUBSCRIPTION_AUTH_PACKAGE)
  })
  const targetBlock = existingBlock ?? 'devDependencies'
  const targetDependencies = {
    ...(objectRecord(pkg[targetBlock]) ?? {}),
    [SUBSCRIPTION_AUTH_PACKAGE]: subscriptionAuthDependencyRange(),
  }

  pkg[targetBlock] = targetDependencies
  for (const blockName of dependencyBlocks) {
    if (blockName === targetBlock) continue
    const block = objectRecord(pkg[blockName])
    if (!block || !Object.prototype.hasOwnProperty.call(block, SUBSCRIPTION_AUTH_PACKAGE)) continue
    const nextBlock = { ...block }
    delete nextBlock[SUBSCRIPTION_AUTH_PACKAGE]
    if (Object.keys(nextBlock).length > 0) pkg[blockName] = nextBlock
    else delete pkg[blockName]
  }

  writeFileSync(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`)
  return {
    path: packageJsonPath,
    created,
    range: String(targetDependencies[SUBSCRIPTION_AUTH_PACKAGE]),
  }
}

function toLLMEntry(config: InitLLMConfig): Record<string, unknown> {
  const llmEntry: Record<string, unknown> = {
    name: config.name,
    provider: config.provider,
    model: config.model,
  }

  if (getProvider(config.provider)?.needsBaseURL) {
    llmEntry.baseURL = config.baseURL
  }

  return llmEntry
}

function buildSingleLLMConfig(provider: string, model: string, baseURL?: string): InitLLMConfig {
  return { name: 'default', provider, model, baseURL }
}

export function defaultModelForProvider(provider: string): string {
  return getProvider(provider)?.defaultModel ?? 'model-name'
}

function subscriptionConfigsForChoice(choice: LLMSetupChoice): InitLLMConfig[] {
  if (choice === 'codex') return [OPENAI_SUBSCRIPTION_CONFIG]
  if (choice === 'claude-code') return [ANTHROPIC_SUBSCRIPTION_CONFIG]
  return []
}

function subscriptionConfigsForChoices(choices: LLMSetupChoice[]): InitLLMConfig[] {
  return choices.flatMap(subscriptionConfigsForChoice)
}

export function buildDefaultConfig(
  platform: InitPlatformInput,
  providerOrLLMs: string | InitLLMConfig[],
  model?: string,
  baseURL?: string,
): Record<string, unknown> {
  const llmConfigs = Array.isArray(providerOrLLMs)
    ? providerOrLLMs
    : [buildSingleLLMConfig(providerOrLLMs, model ?? 'model-name', baseURL)]
  const llmEntries = llmConfigs.map(toLLMEntry)
  const usesSubscriptionAuth = llmConfigs.some(config => isSubscriptionProvider(config.provider))

  const config: Record<string, unknown> = {
    workspace: {
      testMatch: ['tests/**/*.yaml'],
      suiteMatch: ['suites/**/*.suite.yaml'],
      hooksFile: 'hooks.yaml',
      envFile: '.env',
      secretsFile: '.env.secrets.local',
    },
    services: {
      dashboard: { port: 3100, artifactsDir: '.agent-qa/artifacts' },
      mcp: { enabled: true, transport: 'http', host: '127.0.0.1', port: 3471, path: '/mcp' },
      cache: { dir: INIT_CACHE_DIR, ttl: '7d' },
      authState: { dir: INIT_AUTH_STATES_DIR },
      vision: { screenshotSize: DEFAULT_SCREENSHOT_SIZE, effectiveResolution: DEFAULT_EFFECTIVE_RESOLUTION },
      ...(hasWeb(platform)
        ? {
            accessibility: {
              enabled: true,
              standard: 'wcag2aa',
              runAfter: 'every-step',
              failOnViolation: false,
            },
          }
        : {}),
      recording: { enabled: true },
      logging: { level: 'warn' },
    },
    registry: {
      llms: llmEntries,
      targets: buildTargets(platform),
    },
    ...(usesSubscriptionAuth
      ? {
          plugins: {
            auth: [{ package: SUBSCRIPTION_AUTH_PACKAGE }],
          },
        }
      : {}),
    use: {
      ...(hasWeb(platform) ? { browser: { name: 'chromium', headless: true, viewport: { width: 1280, height: 720 } } } : {}),
      mobile: { appState: 'preserve' },
      timeout: { step: '20m', test: '90m', navigation: '2m' },
      planner: { maxSubActions: 10, previousStepCount: 5 },
      logCapture: { console: true, network: true },
      parallel: false,
      llm: llmConfigs[0]?.name ?? 'default',
    },
  }

  return config
}

function addYamlComments(yamlStr: string): string {
  let result = '# agent-qa Configuration\n\n'

  const lines = yamlStr.split('\n')
  for (const line of lines) {
    if (line.startsWith('workspace:')) {
      result += '# File discovery and project settings\n'
    } else if (line.startsWith('services:')) {
      result += '\n# Infrastructure services (dashboard, MCP, cache, auth state, logging)\n'
    } else if (line.startsWith('registry:')) {
      result += '\n# Committed knowledge root (optional block; these defaults apply when absent)\n'
      result += '# knowledge:\n'
      result += '#   dir: agent-qa-knowledge\n'
      result += '#   commitArtifacts: none\n'
      result += '\n# Named resource definitions (LLM configs, app targets)\n'
    } else if (line.startsWith('plugins:')) {
      result += '\n# Optional subscription auth plugin declarations\n'
    } else if (line.startsWith('use:')) {
      result += '\n# Execution settings (cascades: global -> suite -> test -> CLI flags)\n'
    }
    result += line + '\n'

    if (line === '  secretsFile: .env.secrets.local') {
      result += '# Optional: ignore archived or generated tests.\n'
      result += '  # testPathIgnore:\n'
      result += '  #   - tests/archive/**/*.yaml\n'
    } else if (line === '    artifactsDir: .agent-qa/artifacts') {
      result += '    # Optional: persist dashboard state to a custom SQLite path.\n'
      result += '    # dbPath: .agent-qa/dashboard.sqlite\n'
    } else if (line === '    ttl: 7d') {
      if (yamlStr.includes('\n  accessibility:\n')) {
        result += '  # Accessibility checks power the W3C BAD demo test.\n'
      } else {
        result += '  # Optional accessibility service example:\n'
        result += '  # accessibility:\n'
        result += '  #   enabled: false\n'
        result += '  #   standard: wcag2aa\n'
      }
    } else if (line === 'registry:') {
      result += '  # Optional: local and cloud device/provider profiles.\n'
      result += '  # devices:\n'
      result += '  #   android-emu:\n'
      result += '  #     platform: android\n'
      result += '  #     transport: local\n'
      result += '  # providers:\n'
      result += '  #   browserstack:\n'
      result += '  #     username: ${BROWSERSTACK_USERNAME}\n'
      result += '  #     accessKey: ${BROWSERSTACK_ACCESS_KEY}\n'
    } else if (line === '  targets:') {
      result += '    # Optional: add more web or mobile targets here.\n'
      result += '    # my-mobile:\n'
      result += '    #   platform: android\n'
      result += '    #   appPackage: com.example.app\n'
      result += '    #   appActivity: .MainActivity\n'
      result += '    #   app:\n'
      result += '    #     path: apps/example.apk\n'
    } else if (line === '  llm: codex' || line === '  llm: claude-subscription' || line === '  llm: default') {
      result += '  # Optional: bind mobile runs to a configured device profile.\n'
      result += '  # device: android-emu\n'
    }
  }

  return result
}

const DEFAULT_HOOKS_FILE = 'hooks.yaml'
const DEFAULT_ENV_FILE = '.env'
const DEFAULT_SECRETS_FILE = '.env.secrets.local'
const DEFAULT_LOCAL_CONFIG_FILE = 'agent-qa.local.yaml'

function directoryGitignoreEntry(value: string): string {
  return value.endsWith('/') ? value : `${value}/`
}

function buildGitignoreEntries(): string[] {
  return [
    directoryGitignoreEntry(INIT_RUNTIME_DIR),
    directoryGitignoreEntry(INIT_AUTH_STATES_DIR),
    'node_modules/',
    DEFAULT_LOCAL_CONFIG_FILE,
    DEFAULT_ENV_FILE,
    DEFAULT_SECRETS_FILE,
  ]
}

function buildLocalConfigTemplate(): string {
  return `# This file is for machine-specific device, app, and provider bindings.
# Keep it out of git.
# Add agent-qa.local.yaml to .gitignore.

devices:
  # Example local device binding:
  # android-emu:
  #   avd: Pixel_8_API_35

apps:
  # Example app install binding:
  # example-android:
  #   path: apps/example.apk

providers:
  # Example cloud provider credentials:
  # browserstack:
  #   username: ${'${BROWSERSTACK_USERNAME}'}
  #   accessKey: ${'${BROWSERSTACK_ACCESS_KEY}'}
`
}

const KNOWLEDGE_ROOT_DIR = 'agent-qa-knowledge'
// The committed/derived split every knowledge writer relies on (knowledge-store.md §4).
const KNOWLEDGE_GITIGNORE_FUNCTIONAL_LINES = [
  'memory/index/',
  'memory/queue/',
  '.lease',
  '.epoch',
  '**/artifacts/',
  'skills/.staging/',
] as const

// Verbatim from spec/v2/knowledge-store.md §4 — do not paraphrase. Future-shelf
// lines (skills/.staging/) ship now so the split never needs a later edit (D-13).
function buildKnowledgeGitignore(): string {
  return `# agent-qa-knowledge/.gitignore
memory/index/
memory/queue/
.lease
.epoch
# binary blobs; flip to thumbnails via knowledge.commitArtifacts
# (artifact inventories are committed and live OUTSIDE artifacts/)
**/artifacts/
skills/.staging/
`
}

// D-12: comment-only — zero active rules. An un-authored active rule would be
// sovereign prompt bytes on every run. HTML comments are stripped at serve time,
// so this scaffold is an empty policy until a human writes a rule below it.
function buildGlobalPolicyTemplate(): string {
  return `<!--
agent-qa policies — global scope

Write one rule per line, in plain imperative English. Every active (non-comment)
line in this file becomes a QA rule the agent follows.

Example (inactive — it lives inside this comment):
Always dismiss the cookie banner before asserting page content

Scoping: this file is the global scope. Add sibling files named <product>.md
next to it for product-scoped rules.

Sovereignty: policies are human-asserted and win every conflict. Once policy
serving lands, every active line here is served to the agent verbatim on every
run — never summarized, never budgeted out — so keep rules few and deliberate.

HTML comments are stripped at serve time: a comment-only file like this one is
an empty policy. Add rules below this comment block to activate them.
-->
`
}

// D-14: the substantive human entry point for the committed knowledge root.
function buildKnowledgeReadme(): string {
  return `# agent-qa-knowledge

The committed knowledge root for this project's QA agent. Everything the agent
learns and everything you author for it lives under this one directory.

## Two shelves

- **Learned shelf** (\`memory/\`, created by the first record write): durable
  records the agent distills from runs — facts, cautions, selectors, flows.
  Each record is a self-sufficient bundle directory: the fact, its evidence,
  and its provenance travel together.
- **Authored shelf** (\`policies/\` now; \`issues/\` and \`skills/\` arrive with
  their features): content humans write or approve — QA rules, filed issues,
  agent skills.

Only \`policies/\` exists after init; the other directories are created on
first use.

## How to review a knowledge PR

- \`record.md\` is the fact: what the agent now believes, in reviewable prose.
- \`evidence/outcomes.jsonl\` is the evidence: the append-only outcome log the
  belief rests on.
- Trust is derived by code from the outcome log — never hand-edit trust
  counters or status fields. Edit the fact or the evidence; the derivation
  follows.

## Committed vs. gitignored

\`git diff\` shows exactly what the agent learned. The \`.gitignore\` in this
directory enforces the split:

- \`memory/index/\` — derived search index; rebuildable from records, never committed.
- \`memory/queue/\`, \`.lease\`, \`.epoch\` — machine-local curation runtime state.
- \`**/artifacts/\` — binary blobs (screenshots, DOM snapshots, HAR). Excluded
  from git by default; artifact *inventories* are text, live outside
  \`artifacts/\`, and are committed. Set \`knowledge.commitArtifacts: thumbnails\`
  in the agent-qa config to commit small thumbnails for in-PR visual context.
- \`skills/.staging/\` — pending skill writes awaiting approval.

Everything else — every \`*.md\` and \`*.json\`/\`*.jsonl\` of distilled or
authored text — is committed and PR-reviewable.

## How to write policies

QA rules live in \`policies/\` as plain markdown — one rule per line, in
imperative English. Start with \`policies/global.md\` (its header comment
teaches the format); add \`policies/<product>.md\` siblings for product-scoped
rules. Policies are sovereign: served to the agent verbatim on every run.

## Spec pointers

The layout, the committed/derived split, and the config surface are specified
in the agent-qa design docs: \`spec/v2/knowledge-store.md\` §3–§6.
`
}

function trimGitignoreTrailingWhitespace(line: string): string {
  let end = line.length
  while (end > 0 && (line[end - 1] === ' ' || line[end - 1] === '\t')) {
    let precedingBackslashes = 0
    for (let index = end - 2; index >= 0 && line[index] === '\\'; index -= 1) {
      precedingBackslashes += 1
    }
    if (precedingBackslashes % 2 === 1) break
    end -= 1
  }
  return line.slice(0, end)
}

function knowledgeGitignoreFunctionalLines(content: string): Set<string> {
  return new Set(
    content
      .split(/\r?\n/)
      .map(trimGitignoreTrailingWhitespace)
      .filter(line => line.length > 0 && !line.startsWith('#')),
  )
}

function scaffoldKnowledgeRoot(dir: string): void {
  const knowledgeDir = join(dir, KNOWLEDGE_ROOT_DIR)
  mkdirSync(join(knowledgeDir, 'policies'), { recursive: true })

  // Sovereign files: --force never clobbers these — create-missing only (D-15).
  const readmePath = join(knowledgeDir, 'README.md')
  if (!existsSync(readmePath)) {
    writeFileSync(readmePath, buildKnowledgeReadme())
    console.log(pc.green(`✓ Created ${readmePath}`))
  }

  const globalPolicyPath = join(knowledgeDir, 'policies', 'global.md')
  if (!existsSync(globalPolicyPath)) {
    writeFileSync(globalPolicyPath, buildGlobalPolicyTemplate())
    console.log(pc.green(`✓ Created ${globalPolicyPath}`))
  }

  const knowledgeGitignorePath = join(knowledgeDir, '.gitignore')
  if (!existsSync(knowledgeGitignorePath)) {
    writeFileSync(knowledgeGitignorePath, buildKnowledgeGitignore())
    console.log(pc.green(`✓ Created ${knowledgeGitignorePath}`))
  } else {
    // Never rewrite an existing knowledge .gitignore (the user may have customized
    // it deliberately, D-15) — verify the functional split and warn per missing line.
    const existingLines = knowledgeGitignoreFunctionalLines(readFileSync(knowledgeGitignorePath, 'utf-8'))
    for (const requiredLine of KNOWLEDGE_GITIGNORE_FUNCTIONAL_LINES) {
      if (existingLines.has(requiredLine)) continue
      console.warn(pc.yellow(
        `⚠ ${knowledgeGitignorePath} is missing the required line "${requiredLine}" — add it manually to keep the committed/derived split intact.`,
      ))
    }
  }
}

function appendGitignore(dir: string): void {
  const gitignorePath = join(dir, '.gitignore')
  let existing = ''
  if (existsSync(gitignorePath)) {
    existing = readFileSync(gitignorePath, 'utf-8')
  }

  const existingEntries = new Set(
    existing
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean),
  )
  const missing = buildGitignoreEntries().filter((entry) => !existingEntries.has(entry))
  if (missing.length === 0) return

  const append = (existing.length > 0 && !existing.endsWith('\n') ? '\n' : '') + missing.join('\n') + '\n'
  writeFileSync(gitignorePath, existing + append)
}

function browserSetupCommand(platform: InitPlatformInput): string | null {
  return hasWeb(platform) ? 'agent-qa install-browsers --chromium' : null
}

function mobileDriverSetupCommand(platform: InitPlatformInput): string | null {
  const runtimes = normalizePlatformSelection(platform).mobileRuntimes
  if (runtimes.length === 0) return null
  return 'agent-qa install-mobile-drivers --all'
}

function initNextSteps(platform: InitPlatformInput): Array<{ command: string; description: string }> {
  const steps: Array<{ command: string; description: string }> = []
  const browserCommand = browserSetupCommand(platform)
  const mobileCommand = mobileDriverSetupCommand(platform)

  if (browserCommand) {
    steps.push({ command: browserCommand, description: 'Install browser support' })
  }
  if (mobileCommand) {
    steps.push({ command: mobileCommand, description: 'Install mobile driver support' })
  }

  steps.push(
    { command: 'agent-qa doctor', description: 'Verify your environment' },
    { command: 'Edit tests/example-pass.yaml', description: 'Write your first test' },
    { command: 'agent-qa run', description: 'Run all tests' },
    { command: 'agent-qa dashboard', description: 'View results in browser' },
  )

  return steps
}

export function createInitCommand(): Command {
  const cmd = new Command('init')
    .description('Initialize a new agent-qa project')
    .option('--dir <path>', 'target directory', process.cwd())
    .option('--platform <type>', 'platform to configure (web, android, ios, web+android, web+ios)')
    .option('--skip-install', 'deprecated no-op; setup commands are shown after init')
    .option('--force', 'overwrite existing files')
    .action(async (opts) => {
      const dir = resolve(opts.dir)
      const force = opts.force ?? false

      const isInteractive = !opts.platform

      let platform: InitPlatformInput
      let provider = 'anthropic-subscription'
      let model = DEFAULT_ANTHROPIC_MODEL
      let baseURL: string | undefined
      let llmConfigs: InitLLMConfig[] | undefined

      if (isInteractive) {
        // Step 1 — Platform selection
        const capabilities = await checkbox<PlatformCapability>({
          message: 'What platform will you test?',
          choices: [
            { value: 'web', name: 'Web', description: 'Test web apps with Playwright', checked: true },
            { value: 'mobile', name: 'Mobile', description: 'Test Android or iOS apps with Appium', checked: false },
          ],
          required: true,
          validate: (value) => value.length > 0 || 'Select at least one platform.',
        }) as PlatformCapability[]

        const mobileRuntimes: MobileRuntime[] = capabilities.includes('mobile') ? ['android', 'ios'] : []

        platform = { capabilities, mobileRuntimes }

        // Step 2 — Subscription-auth choice
        const llmSetup = await checkbox<LLMSetupChoice>({
          message: `Subscription auth ${pc.dim('(optional)')}`,
          choices: LLM_SETUP_CHOICES,
          required: true,
          validate: (value) => {
            if (value.length === 0) return 'Select No subscription auth or at least one subscription provider.'
            const selectedValues = value.map(choice => choice.value)
            if (selectedValues.includes('none') && selectedValues.length > 1) {
              return 'No subscription auth cannot be combined with Codex or Claude Code.'
            }
            return true
          },
        }) as LLMSetupChoice[]

        if (llmSetup.includes('none')) {
          // Step 3 — Provider selection for non-subscription paths
          provider = await select({
            message: 'Which LLM provider?',
            choices: getCompatibleProviderChoices(),
            default: 'anthropic-compatible',
          })

          // Step 4 — Model selection
          model = await input({ message: 'Model name:', default: defaultModelForProvider(provider) })
        } else {
          llmConfigs = subscriptionConfigsForChoices(llmSetup)
          provider = llmConfigs[0]?.provider ?? provider
          model = llmConfigs[0]?.model ?? model
        }

        // Step 5 — Exact compatible endpoint URL
        if (getProvider(provider)?.needsBaseURL) {
          baseURL = await input({
            message: 'Base URL:',
            validate: (value) => value.trim().length > 0 || 'Base URL is required for compatible providers.',
          })
        }
      } else {
        // Non-interactive mode — use flag values
        platform = (opts.platform ?? 'web') as Platform
        provider = 'anthropic-subscription'
        model = DEFAULT_ANTHROPIC_MODEL
      }

      const configPath = join(dir, 'agent-qa.config.yaml')

      // Check existing config
      if (existsSync(configPath) && !force) {
        console.log(pc.yellow(`Config file already exists at ${configPath}. Use --force to overwrite.`))
        return
      }

      // Create tests directory
      const testsDir = join(dir, 'tests')
      if (!existsSync(testsDir)) {
        mkdirSync(testsDir, { recursive: true })
      }

      // Write config file
      const config = buildDefaultConfig(platform, llmConfigs ?? provider, model, baseURL)
      const usesSubscriptionAuth = configUsesSubscriptionAuth(config)
      const yamlStr = stringify(config)
      const configContent = addYamlComments(yamlStr)
      writeFileSync(configPath, configContent)
      console.log(pc.green(`✓ Created ${configPath}`))

      const subscriptionAuthDependency = usesSubscriptionAuth
        ? upsertSubscriptionAuthPackageDependency(dir)
        : null
      if (subscriptionAuthDependency) {
        const action = subscriptionAuthDependency.created ? 'Created' : 'Updated'
        console.log(pc.green(`✓ ${action} ${subscriptionAuthDependency.path}`))
      }

      const secretsPath = join(dir, DEFAULT_SECRETS_FILE)
      if (force || !existsSync(secretsPath)) {
        writeFileSync(secretsPath, '')
        console.log(pc.green(`✓ Created ${secretsPath}`))
      }

      const envPath = join(dir, DEFAULT_ENV_FILE)
      if (force || !existsSync(envPath)) {
        writeFileSync(envPath, '')
        console.log(pc.green(`✓ Created ${envPath}`))
      }

      const hooksPath = join(dir, DEFAULT_HOOKS_FILE)
      if (force || !existsSync(hooksPath)) {
        writeFileSync(hooksPath, buildHooksFile(platform))
        console.log(pc.green(`✓ Created ${hooksPath}`))
      }

      const localConfigPath = join(dir, DEFAULT_LOCAL_CONFIG_FILE)
      if (force || !existsSync(localConfigPath)) {
        writeFileSync(localConfigPath, buildLocalConfigTemplate())
        console.log(pc.green(`✓ Created ${localConfigPath}`))
      }

      // Committed knowledge root (KDIR-01) — create-missing, never overwrite.
      scaffoldKnowledgeRoot(dir)

      // Write example tests
      const examplePassPath = join(testsDir, 'example-pass.yaml')
      writeFileSync(examplePassPath, buildExampleTest(platform, 'pass'))
      console.log(pc.green(`✓ Created ${examplePassPath}`))

      const exampleFailPath = join(testsDir, 'example-fail.yaml')
      writeFileSync(exampleFailPath, buildExampleTest(platform, 'fail'))
      console.log(pc.green(`✓ Created ${exampleFailPath}`))

      if (hasWeb(platform)) {
        const suitesDir = join(dir, 'suites')
        if (!existsSync(suitesDir)) {
          mkdirSync(suitesDir, { recursive: true })
        }

        const scriptsDir = join(dir, 'scripts')
        if (!existsSync(scriptsDir)) {
          mkdirSync(scriptsDir, { recursive: true })
        }

        const automationTestsDir = join(testsDir, 'automation-exercise')
        if (!existsSync(automationTestsDir)) {
          mkdirSync(automationTestsDir, { recursive: true })
        }

        for (const test of AUTOMATION_EXERCISE_TESTS) {
          const testPath = join(automationTestsDir, test.fileName)
          writeFileSync(testPath, buildAutomationExerciseTest(test))
          console.log(pc.green(`✓ Created ${testPath}`))
        }

        const automationSuitePath = join(suitesDir, 'automation-exercise.suite.yaml')
        writeFileSync(automationSuitePath, buildAutomationExerciseSuite())
        console.log(pc.green(`✓ Created ${automationSuitePath}`))

        const hnScriptPath = join(scriptsDir, 'fetch-hn-top-story.mjs')
        writeFileSync(hnScriptPath, buildHackerNewsHookScript())
        console.log(pc.green(`✓ Created ${hnScriptPath}`))

        const hnTestPath = join(testsDir, 'hacker-news-top-story.yaml')
        writeFileSync(hnTestPath, buildHackerNewsTopStoryTest())
        console.log(pc.green(`✓ Created ${hnTestPath}`))

        const badA11yTestPath = join(testsDir, 'bad-a11y.yaml')
        writeFileSync(badA11yTestPath, buildBadA11yTest())
        console.log(pc.green(`✓ Created ${badA11yTestPath}`))
      }

      // Update .gitignore
      appendGitignore(dir)
      console.log(pc.green('✓ Updated .gitignore'))

      // Post-init summary
      console.log('')
      console.log(pc.green(pc.bold('✓ agent-qa project initialized!')))
      console.log('')
      console.log('  Created:')
      console.log(`    ${pc.dim('•')} agent-qa.config.yaml`)
      if (subscriptionAuthDependency) {
        console.log(`    ${pc.dim('•')} ${PACKAGE_JSON_FILE} dependency for ${SUBSCRIPTION_AUTH_PACKAGE}@${subscriptionAuthDependency.range}`)
      }
      console.log(`    ${pc.dim('•')} ${DEFAULT_HOOKS_FILE}`)
      console.log(`    ${pc.dim('•')} ${DEFAULT_ENV_FILE}`)
      console.log(`    ${pc.dim('•')} ${DEFAULT_SECRETS_FILE}`)
      console.log(`    ${pc.dim('•')} ${DEFAULT_LOCAL_CONFIG_FILE}`)
      console.log(`    ${pc.dim('•')} ${KNOWLEDGE_ROOT_DIR}/ (README.md, .gitignore, policies/global.md)`)
      console.log(`    ${pc.dim('•')} tests/example-pass.yaml`)
      console.log(`    ${pc.dim('•')} tests/example-fail.yaml`)
      if (hasWeb(platform)) {
        console.log(`    ${pc.dim('•')} tests/automation-exercise/*.yaml`)
        console.log(`    ${pc.dim('•')} tests/hacker-news-top-story.yaml`)
        console.log(`    ${pc.dim('•')} tests/bad-a11y.yaml`)
        console.log(`    ${pc.dim('•')} suites/automation-exercise.suite.yaml`)
        console.log(`    ${pc.dim('•')} scripts/fetch-hn-top-story.mjs`)
      }
      console.log(`    ${pc.dim('•')} .gitignore entries`)
      console.log('')
      console.log('  Next steps:')
      for (const [index, step] of initNextSteps(platform).entries()) {
        console.log(`    ${index + 1}. ${pc.cyan(step.command)}  ${step.description}`)
      }
      const generatedLLMs = ((config.registry as Record<string, unknown> | undefined)?.llms ?? []) as InitLLMConfig[]
      const subscriptionLLMs = generatedLLMs.filter(llm => isSubscriptionProvider(String(llm.provider)))
      if (subscriptionLLMs.length === 0) {
        console.log(`    ${pc.dim('•')} Save credentials with ${pc.cyan('agent-qa auth set --config default --type api-key')}`)
        if (getProvider(provider)?.authModes.includes('bearer-token')) {
          console.log(`    ${pc.dim('•')} Bearer tokens use ${pc.cyan('agent-qa auth set --config default --type bearer-token')}`)
        }
      } else {
        console.log(`    ${pc.dim('•')} Fetch ${SUBSCRIPTION_AUTH_PACKAGE} with your package manager install command`)
        for (const llm of subscriptionLLMs) {
          console.log(`    ${pc.dim('•')} Authenticate ${pc.cyan(String(llm.name))} from ${pc.cyan('agent-qa dashboard')}`)
        }
      }
      console.log('')
    })

  return cmd
}
