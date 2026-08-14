import { Command, Option } from 'commander'
import { readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import pc from 'picocolors'
import select from '@inquirer/select'
import input from '@inquirer/input'
import checkbox from '@inquirer/checkbox'
import {
  DEFAULT_AGENT_QA_AUTH_STATES_DIR,
  DEFAULT_AGENT_QA_CACHE_DIR,
  DEFAULT_AGENT_QA_RUNTIME_DIR,
  getAgentQaVersion,
} from '@vostride/agent-qa-core'
import { getProvider, listProviders } from '@vostride/agent-qa-model'
// D-04: the scaffold's CONTENT, shared with `config.project.scaffold`. This file keeps the
// filesystem machinery and the interactive conversation; the substance being written comes from
// one producer, so the two scaffolds cannot drift.
import {
  SUBSCRIPTION_AUTH_PACKAGE,
  SUPPORTED_INIT_PLATFORMS,
  buildHooksFile,
  buildScaffoldConfig,
  hasWeb,
  normalizePlatformSelection,
  parseInitPlatform,
  renderScaffoldConfigYaml,
  HN_TOP_STORY_HOOK_ID,
  type InitLLMConfig,
  type InitPlatformInput,
  type MobileRuntime,
  type PlatformCapability,
  type Platform,
} from './scaffold-content.js'
import { DEFAULT_ANTHROPIC_MODEL, DEFAULT_OPENAI_MODEL } from '../model-defaults.js'
import {
  KNOWLEDGE_GITIGNORE_PROBES,
  TARGET_GITIGNORE_PROBES,
  classifyInitPath,
  preflightInitPlan,
  upsertManagedGitignoreBlock,
  verifyEffectiveGitignore,
  writeConfigMarkerLast,
  writeScaffoldFileAtomic,
  type InitFileResult,
  type InitFilesystemHooks,
  type InitPathPlan,
} from './init-filesystem.js'

// The platform vocabulary and the scaffold's content producers live in `scaffold-content.ts` now
// (D-04). Re-exported here because this module is their public door.
export { SUPPORTED_INIT_PLATFORMS, parseInitPlatform } from './scaffold-content.js'

// HOST DEFAULTS, READ HERE AND PASSED DOWN (FUNC-02). `scaffold-content.ts` may not name
// `@vostride/agent-qa-core` — the surface firewall's ledger never grows — so the two directory
// defaults are resolved on this side of the boundary and handed over as facts.
const INIT_CACHE_DIR = DEFAULT_AGENT_QA_CACHE_DIR || '.agent-qa/cache'
const INIT_AUTH_STATES_DIR = DEFAULT_AGENT_QA_AUTH_STATES_DIR || '.agent-qa/auth-states'

const PACKAGE_JSON_FILE = 'package.json'
// Kept here rather than moved: it feeds `buildGitignoreEntries`, the deliberate literal
// copy this file keeps pinned against `init-filesystem.ts`'s own — see scaffold-content.ts.
const INIT_RUNTIME_DIR = DEFAULT_AGENT_QA_RUNTIME_DIR || '.agent-qa'

function isSubscriptionProvider(provider: string): boolean {
  return getProvider(provider)?.subscription === true
}

/**
 * An `InitLLMConfig` as the registry writes it — the ONE question the provider registry answers.
 *
 * IT STAYS ON THIS SIDE OF THE BOUNDARY (FUNC-02). `needsBaseURL` and `subscription` are facts
 * about what this machine has installed, and `scaffold-content.ts` may not ask. It receives the
 * answers.
 */
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

/**
 * The interactive scaffold's config — the same shape `config.project.scaffold` renders (D-04).
 *
 * THE SIGNATURE IS UNCHANGED, deliberately: `init-config-schema.test.ts` and `init.test.ts` drive
 * it, and this function's answer is byte-identical to what it was before the shared module existed.
 * What moved is the SHAPE; what stayed is the provider resolution above and the host defaults, both
 * of which are questions about this machine rather than about a scaffold.
 */
export function buildDefaultConfig(
  platform: InitPlatformInput,
  providerOrLLMs: string | InitLLMConfig[],
  model?: string,
  baseURL?: string,
): Record<string, unknown> {
  const llmConfigs = Array.isArray(providerOrLLMs)
    ? providerOrLLMs
    : [buildSingleLLMConfig(providerOrLLMs, model ?? 'model-name', baseURL)]

  return buildScaffoldConfig(platform, {
    llmEntries: llmConfigs.map(toLLMEntry),
    usesSubscriptionAuth: llmConfigs.some(config => isSubscriptionProvider(config.provider)),
    cacheDir: INIT_CACHE_DIR,
    authStatesDir: INIT_AUTH_STATES_DIR,
  })
}
type LLMSetupChoice = 'none' | 'codex' | 'claude-code'
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

function defaultExampleTargetName(platform: InitPlatformInput): string {
  const selection = normalizePlatformSelection(platform)
  if (hasWeb(platform)) return 'example-web'
  if (selection.mobileRuntimes.includes('android')) return 'example-android'
  return 'example-ios'
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

function serializeEnvValue(value) {
  return value
    .replace(/\\\\/g, '\\\\\\\\')
    .replace(/"/g, '\\\\"')
    .replace(/\\r/g, '\\\\r')
    .replace(/\\n/g, '\\\\n')
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
  \`HN_FIRST_STORY_TITLE="\${serializeEnvValue(title)}"\`,
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

export function installedAgentQaVersion(): string {
  const version = getAgentQaVersion().trim()
  const exactSemver =
    /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u
  if (!exactSemver.test(version) || version === '0.0.0') {
    throw new Error(
      'Unable to resolve the installed agent-qa version; refusing to write a dependency range.',
    )
  }
  return version
}

function subscriptionAuthDependencyRange(): string {
  return installedAgentQaVersion()
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

type SubscriptionAuthDependencyPlan = {
  plan: InitPathPlan
  range: string
}

type SubscriptionAuthDependencyResult = InitFileResult & {
  range: string
}

function buildSubscriptionAuthPackageDependencyPlan(
  dir: string,
): SubscriptionAuthDependencyPlan {
  const packageJsonPath = join(dir, PACKAGE_JSON_FILE)
  const classification = classifyInitPath(packageJsonPath, dir)
  const existing = classification === 'regular'
    ? readFileSync(packageJsonPath, 'utf-8')
    : null
  const pkg = existing === null
    ? { private: true } as Record<string, unknown>
    : JSON.parse(existing) as Record<string, unknown>

  if (!objectRecord(pkg)) {
    throw new Error(`${PACKAGE_JSON_FILE} must contain a JSON object to add ${SUBSCRIPTION_AUTH_PACKAGE}`)
  }

  const dependencyBlocks = [
    'devDependencies',
    'dependencies',
    'optionalDependencies',
    'peerDependencies',
  ] as const
  const existingBlock = dependencyBlocks.find(blockName => {
    const block = objectRecord(pkg[blockName])
    return block && Object.prototype.hasOwnProperty.call(block, SUBSCRIPTION_AUTH_PACKAGE)
  })
  const targetBlock = existingBlock ?? 'devDependencies'
  const range = subscriptionAuthDependencyRange()
  let changed = existing === null
  const existingTargetDependencies = objectRecord(pkg[targetBlock])
  if (existingTargetDependencies?.[SUBSCRIPTION_AUTH_PACKAGE] !== range) {
    changed = true
  }
  const targetDependencies = {
    ...(existingTargetDependencies ?? {}),
    [SUBSCRIPTION_AUTH_PACKAGE]: range,
  }

  pkg[targetBlock] = targetDependencies
  for (const blockName of dependencyBlocks) {
    if (blockName === targetBlock) continue
    const block = objectRecord(pkg[blockName])
    if (!block || !Object.prototype.hasOwnProperty.call(block, SUBSCRIPTION_AUTH_PACKAGE)) continue
    changed = true
    const nextBlock = { ...block }
    delete nextBlock[SUBSCRIPTION_AUTH_PACKAGE]
    if (Object.keys(nextBlock).length > 0) pkg[blockName] = nextBlock
    else delete pkg[blockName]
  }

  const content = existing !== null && !changed
    ? existing
    : `${JSON.stringify(pkg, null, 2)}\n`
  return {
    plan: {
      path: packageJsonPath,
      root: dir,
      content,
      force: existing !== null && changed,
    },
    range,
  }
}

export function upsertSubscriptionAuthPackageDependency(
  dir: string,
  hooks: InitFilesystemHooks = {},
): SubscriptionAuthDependencyResult {
  const dependency = buildSubscriptionAuthPackageDependencyPlan(dir)
  return {
    ...writeScaffoldFileAtomic(dependency.plan, hooks),
    range: dependency.range,
  }
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

const DEFAULT_HOOKS_FILE = 'hooks.yaml'
const DEFAULT_ENV_FILE = '.env'
const DEFAULT_SECRETS_FILE = '.env.secrets.local'
const SECRETS_FILE_MODE = 0o600
const DEFAULT_LOCAL_CONFIG_FILE = 'agent-qa.local.yaml'

function directoryGitignoreEntry(value: string): string {
  return value.endsWith('/') ? value : `${value}/`
}

function buildGitignoreEntries(): string[] {
  return [
    directoryGitignoreEntry(INIT_RUNTIME_DIR),
    directoryGitignoreEntry(INIT_AUTH_STATES_DIR),
    // 394 (T-394-03): the draft shelf, which lives INSIDE `tests/` because that is the only
    // location a run will admit — see the two-sided admission note in
    // `composition/local-agent-host.ts`. Spelled literally here for the same reason the durable
    // temporary rule below is: init-filesystem.js is mocked wholesale by the init suite, and
    // `TARGET_GITIGNORE_ENTRIES` is the other copy the agreement test pins this against.
    'tests/.agent-qa-drafts/',
    'node_modules/',
    DEFAULT_LOCAL_CONFIG_FILE,
    DEFAULT_ENV_FILE,
    DEFAULT_SECRETS_FILE,
    // The namespace `writeDurableTemporary` publishes through. The temporary is a sibling of
    // its destination carrying that destination's content — for the secrets file, live
    // credential bytes at 0600 — and it outlives any cleanup that cannot run. Spelled
    // literally rather than imported because init-filesystem.js is mocked wholesale by the
    // init suite; `DURABLE_TEMPORARY_GITIGNORE_RULE` is the other copy, and the two are
    // pinned together by the runtime-versus-defaults agreement test.
    '.*.agent-qa-init-*.tmp',
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
// The committed/derived split every knowledge writer relies on (knowledge-store.md §4),
// plus one init-tool operational rule that is NOT part of that split — see below.
const KNOWLEDGE_GITIGNORE_FUNCTIONAL_LINES = [
  'memory/index/',
  'memory/queue/',
  '.lease',
  '.epoch',
  '**/artifacts/',
  'skills/.staging/',
  '.*.agent-qa-init-*.tmp',
] as const

// The committed/derived split below is verbatim from spec/v2/knowledge-store.md §4 — do not
// paraphrase. Future-shelf lines (skills/.staging/) ship now so the split never needs a later
// edit (D-13).
//
// The final rule is a DELIBERATE DIVERGENCE from that spec section and is labelled as such in
// the emitted file. It is not part of the committed/derived split; it is an operational rule
// for this tool's own publication temporaries. It has to live here rather than in the project
// .gitignore because a knowledge tree is routinely its own repository — measured: a nested
// repository does not inherit its parent's .gitignore — and because `init` verifies the
// knowledge root BEFORE the project managed block exists.
function buildKnowledgeGitignore(): string {
  return `# agent-qa-knowledge/.gitignore
memory/index/
memory/queue/
.lease
.epoch
# binary blobs; artifact inventories are committed and live OUTSIDE artifacts/
**/artifacts/
skills/.staging/
# INIT-TOOL OPERATIONAL — outside the committed/derived split above. agent-qa init publishes
# every file through a temporary sibling that carries the destination's own content; this
# keeps that temporary out of a commit even when this tree is its own repository.
.*.agent-qa-init-*.tmp
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
  \`artifacts/\`, and are committed.
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

function warnForMissingKnowledgeGitignoreRules(path: string): void {
  const existingLines = knowledgeGitignoreFunctionalLines(readFileSync(path, 'utf-8'))
  for (const requiredLine of KNOWLEDGE_GITIGNORE_FUNCTIONAL_LINES) {
    if (existingLines.has(requiredLine)) continue
    console.warn(pc.yellow(
      `⚠ ${path} is missing the required line "${requiredLine}" — `
      + 'add it manually to keep the committed/derived split intact.',
    ))
  }
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
  )
  if (hasWeb(platform)) {
    steps.push({ command: 'Edit tests/example-pass.yaml', description: 'Write your first test' })
  } else {
    steps.push({ command: 'Edit agent-qa.local.yaml', description: 'Bind your mobile app' })
  }
  steps.push(
    { command: 'agent-qa run', description: 'Run all tests' },
    { command: 'agent-qa dashboard', description: 'View results in browser' },
  )

  return steps
}

export interface InitCommandHooks {
  afterWrite?: (result: InitFileResult, boundary: number) => void
  onComplete?: (outcomes: readonly InitFileResult[]) => void
}

function scaffoldFilePlan(
  root: string,
  path: string,
  content: string,
  force: boolean,
  preserveOnForce = false,
  mode?: number,
): InitPathPlan {
  return {
    root,
    path: join(root, path),
    content,
    force,
    preserveOnForce,
    ...(mode === undefined ? {} : { mode }),
  }
}

function buildScaffoldFilePlans(
  dir: string,
  platform: InitPlatformInput,
  force: boolean,
): InitPathPlan[] {
  const plans = [
    // User-owned credential bytes are never replaced, including under --force.
    scaffoldFilePlan(dir, DEFAULT_ENV_FILE, '', force, true),
    scaffoldFilePlan(dir, DEFAULT_SECRETS_FILE, '', force, true, SECRETS_FILE_MODE),
    scaffoldFilePlan(dir, DEFAULT_HOOKS_FILE, buildHooksFile(platform), force),
    scaffoldFilePlan(
      dir,
      DEFAULT_LOCAL_CONFIG_FILE,
      buildLocalConfigTemplate(),
      force,
    ),
    // The knowledge root's own covering rule goes down BEFORE any other write inside the
    // knowledge tree, for the same reason the target managed block leads the whole run:
    // every scaffold write publishes through a sibling temporary, and a knowledge tree that
    // is its own repository does NOT inherit the parent's .gitignore (measured). Ordered
    // after README.md and policies/global.md, those two temporaries existed under no rule at
    // all in that case.
    scaffoldFilePlan(
      dir,
      join(KNOWLEDGE_ROOT_DIR, '.gitignore'),
      buildKnowledgeGitignore(),
      force,
      true,
    ),
    scaffoldFilePlan(
      dir,
      join(KNOWLEDGE_ROOT_DIR, 'README.md'),
      buildKnowledgeReadme(),
      force,
      true,
    ),
    scaffoldFilePlan(
      dir,
      join(KNOWLEDGE_ROOT_DIR, 'policies', 'global.md'),
      buildGlobalPolicyTemplate(),
      force,
      true,
    ),
  ]

  if (!hasWeb(platform)) return plans

  plans.push(
    scaffoldFilePlan(
      dir,
      join('tests', 'example-pass.yaml'),
      buildExampleTest(platform, 'pass'),
      force,
    ),
    scaffoldFilePlan(
      dir,
      join('tests', 'example-fail.yaml'),
      buildExampleTest(platform, 'fail'),
      force,
    ),
  )

  for (const test of AUTOMATION_EXERCISE_TESTS) {
    plans.push(scaffoldFilePlan(
      dir,
      join('tests', 'automation-exercise', test.fileName),
      buildAutomationExerciseTest(test),
      force,
    ))
  }

  plans.push(
    scaffoldFilePlan(
      dir,
      join('suites', 'automation-exercise.suite.yaml'),
      buildAutomationExerciseSuite(),
      force,
    ),
    scaffoldFilePlan(
      dir,
      join('scripts', 'fetch-hn-top-story.mjs'),
      buildHackerNewsHookScript(),
      force,
    ),
    scaffoldFilePlan(
      dir,
      join('tests', 'hacker-news-top-story.yaml'),
      buildHackerNewsTopStoryTest(),
      force,
    ),
    scaffoldFilePlan(
      dir,
      join('tests', 'bad-a11y.yaml'),
      buildBadA11yTest(),
      force,
    ),
  )

  return plans
}

function displayInitPath(dir: string, path: string): string {
  const localPath = relative(dir, path)
  return localPath.length > 0 ? localPath : path
}

function printOutcomeSummary(dir: string, outcomes: readonly InitFileResult[]): void {
  const groups = [
    ['created', 'Created'],
    ['updated', 'Updated'],
    ['preserved', 'Preserved'],
  ] as const

  for (const [outcome, label] of groups) {
    const matching = outcomes.filter(result => result.outcome === outcome)
    if (matching.length === 0) continue
    console.log(`  ${label}:`)
    for (const result of matching) {
      console.log(`    ${pc.dim('•')} ${displayInitPath(dir, result.path)}`)
    }
  }
}

function printNextSteps(
  platform: InitPlatformInput,
  config: Record<string, unknown>,
  provider: string,
): void {
  console.log('')
  console.log('  Next steps:')
  for (const [index, step] of initNextSteps(platform).entries()) {
    console.log(`    ${index + 1}. ${pc.cyan(step.command)}  ${step.description}`)
  }
  const registry = config.registry as Record<string, unknown> | undefined
  const generatedLLMs = (registry?.llms ?? []) as InitLLMConfig[]
  const subscriptionLLMs = generatedLLMs.filter(
    llm => isSubscriptionProvider(String(llm.provider)),
  )
  if (subscriptionLLMs.length === 0) {
    console.log(
      `    ${pc.dim('•')} Save credentials with `
      + pc.cyan('agent-qa auth set --config default --type api-key'),
    )
    if (getProvider(provider)?.authModes.includes('bearer-token')) {
      console.log(
        `    ${pc.dim('•')} Bearer tokens use `
        + pc.cyan('agent-qa auth set --config default --type bearer-token'),
      )
    }
    return
  }

  console.log(
    `    ${pc.dim('•')} Fetch ${SUBSCRIPTION_AUTH_PACKAGE} `
    + 'with your package manager install command',
  )
  for (const llm of subscriptionLLMs) {
    console.log(
      `    ${pc.dim('•')} Authenticate ${pc.cyan(String(llm.name))} `
      + `from ${pc.cyan('agent-qa dashboard')}`,
    )
  }
}

export function createInitCommand(hooks: InitCommandHooks = {}): Command {
  const cmd = new Command('init')
    .description('Initialize a new agent-qa project')
    .option('--dir <path>', 'target directory', process.cwd())
    .addOption(
      new Option('--platform <type>', 'platform to configure')
        .choices([...SUPPORTED_INIT_PLATFORMS]),
    )
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
      const configClassification = classifyInitPath(configPath, dir)
      if (configClassification === 'regular' && !force) {
        const completed = [{ path: configPath, outcome: 'preserved' }] as const
        console.log(pc.yellow(`Project is already initialized at ${dir}. Use --force to rebuild it.`))
        printOutcomeSummary(dir, completed)
        hooks.onComplete?.(completed)
        return
      }

      const config = buildDefaultConfig(platform, llmConfigs ?? provider, model, baseURL)
      const usesSubscriptionAuth = configUsesSubscriptionAuth(config)
      const subscriptionAuthDependency = usesSubscriptionAuth
        ? buildSubscriptionAuthPackageDependencyPlan(dir)
        : null
      const filePlans = buildScaffoldFilePlans(dir, platform, force)
      const targetGitignorePath = join(dir, '.gitignore')
      const targetGitignorePlan: InitPathPlan = {
        root: dir,
        path: targetGitignorePath,
        content: '',
      }
      const configPlan: InitPathPlan = {
        root: dir,
        path: configPath,
        content: renderScaffoldConfigYaml(config),
        force,
      }
      const completePlan = [
        ...filePlans,
        ...(subscriptionAuthDependency ? [subscriptionAuthDependency.plan] : []),
        targetGitignorePlan,
        configPlan,
      ]
      const preflight = preflightInitPlan(completePlan)

      const knowledgeGitignorePath = join(dir, KNOWLEDGE_ROOT_DIR, '.gitignore')
      const knowledgeGitignoreWasPresent = preflight.some(
        result => result.path === knowledgeGitignorePath
          && result.classification === 'regular',
      )
      if (knowledgeGitignoreWasPresent) {
        warnForMissingKnowledgeGitignoreRules(knowledgeGitignorePath)
        verifyEffectiveGitignore({
          cwd: join(dir, KNOWLEDGE_ROOT_DIR),
          label: 'existing agent-qa-knowledge/.gitignore',
          probes: KNOWLEDGE_GITIGNORE_PROBES,
          // Nothing has been written yet at this point in the run.
          written: 'nothing',
        })
      }

      const outcomes: InitFileResult[] = []
      let boundary = 0
      const recordOutcome = (result: InitFileResult): void => {
        outcomes.push(result)
        if (result.outcome === 'preserved') return
        boundary += 1
        hooks.afterWrite?.(result, boundary)
      }

      // The managed block goes down FIRST, before any other write can create a temporary.
      // Every scaffold write publishes through a sibling temporary carrying the
      // destination's own content, and until this block exists no rule covers that name —
      // so ordering it after the scaffold loop left a window in which `.env.secrets.local`'s
      // 0600 temporary was untracked and `git add .` could pick it up. The single temporary
      // this cannot cover is its own, whose content is .gitignore bytes and never a
      // credential.
      //
      // CORRECTION (round 10): that "single temporary" claim was measured against THIS root
      // only. A knowledge tree that is its own repository does not inherit this file, so the
      // knowledge root has its own first-write rule — see `buildScaffoldFilePlans`, where the
      // knowledge `.gitignore` now leads its group for exactly this reason. One uncovered
      // temporary per root, each of them a `.gitignore`'s own.
      //
      // Verifying here does NOT make "no files were changed" true — this write has already
      // happened. The refusal states what actually happened instead; see `changed` below.
      recordOutcome(upsertManagedGitignoreBlock(
        targetGitignorePath,
        buildGitignoreEntries(),
      ))
      verifyEffectiveGitignore({
        cwd: dir,
        label: 'target .gitignore',
        probes: TARGET_GITIGNORE_PROBES,
        // The managed block is on disk by now — the refusal must not say otherwise.
        written: 'managed-gitignore',
      })

      for (const plan of filePlans) {
        recordOutcome(writeScaffoldFileAtomic(plan, {}))
      }

      if (!knowledgeGitignoreWasPresent) {
        verifyEffectiveGitignore({
          cwd: join(dir, KNOWLEDGE_ROOT_DIR),
          label: 'agent-qa-knowledge/.gitignore',
          probes: KNOWLEDGE_GITIGNORE_PROBES,
          // This one runs AFTER the scaffold loop: the whole scaffold is published.
          written: 'managed-gitignore-and-scaffold',
        })
      }

      if (subscriptionAuthDependency) {
        recordOutcome(writeScaffoldFileAtomic(subscriptionAuthDependency.plan, {}))
      }

      recordOutcome(writeConfigMarkerLast(configPlan, {}))
      hooks.onComplete?.([...outcomes])

      console.log('')
      console.log(pc.green(pc.bold('✓ agent-qa project initialized!')))
      console.log('')
      printOutcomeSummary(dir, outcomes)
      printNextSteps(platform, config, provider)
      console.log('')
    })

  return cmd
}
