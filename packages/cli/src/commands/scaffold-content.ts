// The scaffold's CONTENT, shared by both write paths (Phase 395, D-04 · CFGM-05).
//
// ONE SOURCE OF TRUTH FOR SUBSTANCE, TWO WRITE PATHS SPLIT BY ACTOR. `agent-qa init` writes these
// bytes directly for a human who asked for them at a terminal; `config.project.scaffold` renders
// the SAME bytes as a `ConfigProposal` diff a person approves. D-04's claim is that the two
// scaffolds cannot drift, and the only way to make that a property of the code rather than a
// promise is for there to be one producer. The functions below were MOVED here out of `init.ts`
// and `init-filesystem.ts` rather than copied: there is no second copy left to drift from.
//
// PURE OVER ITS INPUTS. Nothing here reads `fs`, `process` or a clock. That is what lets the
// proposal path render the same content into file bytes without performing any of `init`'s
// filesystem machinery — preflight, atomic publish, marker-last ordering — which stays where it is
// because it is about WRITING, and writing is the half the two actors do differently.
//
// IT NAMES NO INTERNAL PACKAGE, AND THAT IS THE FUNC-02 FIREWALL RATHER THAN A PREFERENCE. The
// surface firewall's ledger "only ever SHRINKS: new surface code can never join it", so a file
// written today may not import `@vostride/agent-qa-core` or `@vostride/agent-qa-model` at all. The
// two host facts the config's defaults need — the cache directory and the auth-state directory —
// arrive as ARGUMENTS from the two callers that are ledgered for them, and the provider registry
// stays entirely on `init`'s side of the boundary: what this module receives is `llmEntries`, the
// already-resolved list, because "which providers exist" is a question about this machine and
// "what does a scaffolded config look like" is not.
//
// WHAT DELIBERATELY DID NOT MOVE: `TARGET_GITIGNORE_ENTRIES` (init-filesystem.ts) and
// `buildGitignoreEntries` (init.ts). Those two are a deliberate pair of literal copies pinned
// against each other by the runtime-versus-defaults agreement test, because `init-filesystem.js` is
// mocked wholesale by the init suite. Collapsing them onto one constant here would make that test
// compare a value against itself. This module owns the block's SHAPE — markers, header line,
// splice and append — and takes the entries as an argument.

import { parseDocument, stringify } from 'yaml'

export const SUPPORTED_INIT_PLATFORMS = [
  'web',
  'android',
  'ios',
  'web+android',
  'web+ios',
] as const
export type Platform = (typeof SUPPORTED_INIT_PLATFORMS)[number]
export type PlatformCapability = 'web' | 'mobile'
export type MobileRuntime = 'android' | 'ios'
export type InitPlatformSelection = {
  capabilities: PlatformCapability[]
  mobileRuntimes: MobileRuntime[]
}
export type InitPlatformInput = Platform | InitPlatformSelection
export type InitLLMConfig = {
  name: string
  provider: string
  model: string
  baseURL?: string
}

export const SUBSCRIPTION_AUTH_PACKAGE = '@vostride/agent-qa-subscription-auth'
const DEFAULT_SCREENSHOT_SIZE = '256k'
const DEFAULT_EFFECTIVE_RESOLUTION = 768

export function parseInitPlatform(value: string): Platform {
  if ((SUPPORTED_INIT_PLATFORMS as readonly string[]).includes(value)) {
    return value as Platform
  }
  throw new Error(`Unsupported init platform "${value}"`)
}

export function normalizePlatformSelection(platform: InitPlatformInput): InitPlatformSelection {
  if (typeof platform !== 'string') {
    return {
      capabilities: [...new Set(platform.capabilities)],
      mobileRuntimes: [...new Set(platform.mobileRuntimes)],
    }
  }

  const selectedPlatform = parseInitPlatform(platform)
  switch (selectedPlatform) {
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
    default: {
      const exhaustivePlatform: never = selectedPlatform
      throw new Error(`Unsupported init platform "${String(exhaustivePlatform)}"`)
    }
  }
}

export function hasWeb(platform: InitPlatformInput): boolean {
  return normalizePlatformSelection(platform).capabilities.includes('web')
}

/**
 * The `registry.targets` block.
 *
 * `targets` IS AN OVERRIDE RATHER THAN A DEFAULT SINCE 395-08. `init` scaffolds its three example
 * web targets so a fresh project has something to run; `config.project.scaffold` derives exactly
 * ONE target from the utterance's domain and must not carry `example-web` and two third-party demo
 * sites into a person's repository they never asked for. The parameter is the difference between
 * those two callers and nothing else about the config changes.
 */
export function buildTargets(
  platform: InitPlatformInput,
  override?: Record<string, unknown>,
): Record<string, unknown> {
  if (override !== undefined) return override
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

/**
 * The host facts the config's defaults need, INJECTED (FUNC-02).
 *
 * `llmEntries` IS ALREADY RESOLVED, and that is the whole of the boundary. Turning an
 * `InitLLMConfig` into a registry entry means asking the provider registry whether the provider
 * needs a base URL, and whether it is a subscription provider; both are questions about what this
 * machine has installed. `init` answers them and hands the answers over. The scaffold path answers
 * them by having no LLMs at all.
 */
export interface ScaffoldConfigFacts {
  readonly llmEntries: readonly Record<string, unknown>[]
  readonly usesSubscriptionAuth: boolean
  /** `services.cache.dir`. A host default, so a host supplies it. */
  readonly cacheDir: string
  /** `services.authState.dir`. Same. */
  readonly authStatesDir: string
  /**
   * `registry.targets`, when the caller has its own.
   *
   * `init` scaffolds three example web targets so a fresh project has something to run;
   * `config.project.scaffold` derives exactly ONE from the utterance's domain and must not carry
   * two third-party demo sites into a repository nobody asked to have them in.
   */
  readonly targets?: Record<string, unknown>
}

export function buildScaffoldConfig(
  platform: InitPlatformInput,
  facts: ScaffoldConfigFacts,
): Record<string, unknown> {
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
      cache: { dir: facts.cacheDir, ttl: '7d' },
      authState: { dir: facts.authStatesDir },
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
      llms: [...facts.llmEntries],
      targets: buildTargets(platform, facts.targets),
    },
    ...(facts.usesSubscriptionAuth
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
      llm: (facts.llmEntries[0]?.name as string | undefined) ?? 'default',
    },
  }

  return config
}

export function addYamlComments(yamlStr: string): string {
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

/** The config yaml as a file's bytes-to-be: serialize, then re-attach the house comments. */
export function renderScaffoldConfigYaml(config: Record<string, unknown>): string {
  return addYamlComments(stringify(config))
}

export const HN_TOP_STORY_HOOK_ID
  = 'h_aster-bloom-cloud-drift-ember-field-glade-hollow-ivory-jasper'

export function buildHooksFile(platform: InitPlatformInput): string {
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

// ---------------------------------------------------------------------------------------------
// The managed .gitignore block's SHAPE. Moved from `init-filesystem.ts`, which now delegates.
// ---------------------------------------------------------------------------------------------

export const MANAGED_GITIGNORE_START = '# agent-qa init:start'
export const MANAGED_GITIGNORE_END = '# agent-qa init:end'

export function managedGitignoreBlock(entries: readonly string[]): string {
  return [
    MANAGED_GITIGNORE_START,
    '# Runtime, credential, dependency, and local-only paths managed by agent-qa init.',
    ...entries,
    MANAGED_GITIGNORE_END,
    '',
  ].join('\n')
}

export function stripManagedGitignoreBlock(content: string): string {
  const startCount = content.split(MANAGED_GITIGNORE_START).length - 1
  const endCount = content.split(MANAGED_GITIGNORE_END).length - 1
  if (startCount !== endCount || startCount > 1) {
    throw new Error(
      'Refusing malformed target .gitignore: expected at most one complete '
      + 'agent-qa init managed block',
    )
  }
  if (startCount === 0) return content

  const start = content.indexOf(MANAGED_GITIGNORE_START)
  const endMarker = content.indexOf(MANAGED_GITIGNORE_END, start)
  // The counts balance at one and one even when a bad merge inverts the pair, and the
  // anchored search then reports no match. Splicing at the offset computed from -1 would
  // cut the file at an arbitrary byte with no relationship to any marker, duplicating the
  // user's own rules and mangling a line. Refuse instead: this is the ordering property the
  // count-based refusal above already advertises but does not check.
  if (endMarker === -1) {
    throw new Error(
      'Refusing malformed target .gitignore: the agent-qa init managed '
      + 'end marker precedes its start marker',
    )
  }
  let end = endMarker + MANAGED_GITIGNORE_END.length
  if (content.slice(end, end + 2) === '\r\n') end += 2
  else if (content[end] === '\n') end += 1
  return content.slice(0, start) + content.slice(end)
}

export function appendManagedBlockAtEof(content: string, block: string): string {
  if (content.length === 0) return block
  const separator = content.endsWith('\n\n')
    ? ''
    : content.endsWith('\n')
      ? '\n'
      : '\n\n'
  return `${content}${separator}${block}`
}

/**
 * The upsert, as CONTENT: what a `.gitignore` holding `existing` should hold afterwards.
 *
 * THE WHOLE UPSERT AND NOT MERELY THE BLOCK, which is what makes the scaffold proposal's diff
 * compose with a `.gitignore` a project already has. `upsertManagedGitignoreBlock` performs this
 * same composition and then writes it; the scaffold path performs it and then proposes it.
 */
export function composeManagedGitignore(
  existing: string,
  entries: readonly string[],
): string {
  return appendManagedBlockAtEof(
    stripManagedGitignoreBlock(existing),
    managedGitignoreBlock(entries),
  )
}

// ---------------------------------------------------------------------------------------------
// The from-zero scaffold file set (395-08, D-04/D-13 · CFGM-05).
// ---------------------------------------------------------------------------------------------

export const SCAFFOLD_CONFIG_FILE = 'agent-qa.config.yaml'
export const SCAFFOLD_HOOKS_FILE = 'hooks.yaml'
export const SCAFFOLD_GITIGNORE_FILE = '.gitignore'

export interface ScaffoldContentInput {
  /** `services.cache.dir` — a host default the caller supplies (FUNC-02, see the file header). */
  readonly cacheDir: string
  /** `services.authState.dir` — same. */
  readonly authStatesDir: string
  /** The derived target name, e.g. `booking-com`. Deterministic host code produces it (D-13). */
  readonly targetName: string
  /** The derived base URL, e.g. `https://booking.com`. Same producer, same rule. */
  readonly baseUrl: string
  /** The managed block's rules, supplied by the caller — see this file's header. */
  readonly gitignoreEntries: readonly string[]
  /** What the project's `.gitignore` holds right now, or absent when it has none. */
  readonly existingGitignore?: string
  /**
   * MERGE MODE (395-12): the project's existing configuration, which declares no targets.
   *
   * ABSENT IS THE FROM-ZERO ROAD and it is byte-for-byte what it always was — the committed goldens
   * pin that, and they did not move when this field was added. Present, the producer inserts
   * exactly one `registry.targets` entry into these bytes and emits no other change to that file.
   */
  readonly existingConfig?: ScaffoldMergeTarget
}

/** Where the merge writes, and where its siblings belong beside a configuration that exists. */
export interface ScaffoldMergeTarget {
  /** The config member's own path — never assumed to be `agent-qa.config.yaml`. */
  readonly path: string
  readonly text: string
  /** Where a hooks file belongs — the name `workspace.hooksFile` declares. */
  readonly hooksPath: string
  /** True when that file already exists, in which case NO hooks content is rendered at all. */
  readonly hooksPresent: boolean
}

/**
 * The person's own configuration with exactly ONE target entry inserted (395-12 · CFGM-05).
 *
 * `parseDocument` → `setIn` → `toString` IS THE SHIPPED IDIOM, and it is the same one
 * `agent-qa config set` and `createConfigFilesPort.setField` ride — chosen for the same
 * load-bearing reason rather than for style: a parse → object → stringify round trip destroys every
 * comment in a comment-dense config and widens the rendered diff past the point a person can review
 * it, which is the whole of what CFGM-01 asks a proposal to be.
 *
 * ONE `setIn` AND NOTHING ELSE. Not a merge of two documents, not a re-serialization, not a
 * normalization pass: one write at one path. Every other key, comment, blank line and ordering
 * decision in the file is the person's, and the proposal's diff is the insertion by construction
 * rather than by a filter applied afterwards.
 */
export function mergeScaffoldTargetEntry(input: {
  readonly existingText: string
  readonly targetName: string
  readonly baseUrl: string
}): string {
  const document = parseDocument(input.existingText)
  document.setIn(
    ['registry', 'targets', input.targetName],
    { platform: 'web', url: input.baseUrl },
  )
  return document.toString()
}

export interface ScaffoldContentFile {
  /** Workspace-relative. */
  readonly path: string
  readonly text: string
}

/**
 * The whole from-zero scaffold, as content (D-04's propose half · CFGM-05's one reviewable diff).
 *
 * THREE FILES AND EXACTLY THREE, and they are the three `enumerateConfigFileSet` answers: the
 * config yaml, the hooks file it names, and the `.gitignore` whose managed block this product
 * maintains. That is not a coincidence to be preserved by care — the apply's pathspec and the
 * classifier's `out-of-set-path` rule read that same enumeration, so a fourth file here would be
 * flagged cross-boundary on its own path and refused by an apply that could not scope to it.
 *
 * NO LLM ENTRY, AND THAT IS THE HONEST DERIVATION RATHER THAN AN OMISSION (D-13). The utterance
 * carried a domain; it did not carry a provider, a model or an API base. `registry.llms` is
 * optional and `use.llm` is only checked when present, so the config this produces validates — and
 * a person reading the proposal sees a project configured for the site they named and for nothing
 * they did not say. `init` is the path that ASKS, and it still passes its answers in.
 *
 * PLATFORM IS `web`, STATED. A hostname is a web origin; there is no mobile fact in a domain token.
 *
 * TWO MODES, ONE PRODUCER (395-12, D-04). With `existingConfig` present the config member is the
 * person's own bytes plus one inserted target entry, and the hooks file is rendered only when the
 * project has none — see `ScaffoldMergeTarget`. The `.gitignore` upsert is the same in both modes,
 * because it always was an upsert.
 */
export function buildScaffoldFileSet(input: ScaffoldContentInput): readonly ScaffoldContentFile[] {
  const gitignore: ScaffoldContentFile = {
    path: SCAFFOLD_GITIGNORE_FILE,
    text: composeManagedGitignore(input.existingGitignore ?? '', input.gitignoreEntries),
  }

  if (input.existingConfig !== undefined) {
    const merge = input.existingConfig
    return [
      {
        path: merge.path,
        text: mergeScaffoldTargetEntry({
          existingText: merge.text,
          targetName: input.targetName,
          baseUrl: input.baseUrl,
        }),
      },
      // A HOOKS FILE A PERSON WROTE IS NOT A MEMBER OF THIS ANSWER. The template is content for a
      // project that has none; composing it over theirs would be the wholesale overwrite the
      // target-registry narrowing just stopped this op making, one file over.
      ...(merge.hooksPresent ? [] : [{ path: merge.hooksPath, text: buildHooksFile('web') }]),
      gitignore,
    ]
  }

  const config = buildScaffoldConfig('web', {
    llmEntries: [],
    usesSubscriptionAuth: false,
    cacheDir: input.cacheDir,
    authStatesDir: input.authStatesDir,
    targets: { [input.targetName]: { platform: 'web', url: input.baseUrl } },
  })
  // NO LLM ENTRY AND NO `use.llm`, removed rather than never written so the ONE config shape above
  // stays one shape. `registry.llms: []` beside `use.llm: default` is what the shared builder emits
  // for an empty list, and `AgentQaConfigSchema` refuses a `use.llm` naming no registered entry —
  // so leaving them would be a scaffold that cannot validate, which is exactly the failure this
  // plan was told to prove does not happen.
  const registry = config.registry as Record<string, unknown>
  delete registry.llms
  const use = config.use as Record<string, unknown>
  delete use.llm

  return [
    { path: SCAFFOLD_CONFIG_FILE, text: renderScaffoldConfigYaml(config) },
    { path: SCAFFOLD_HOOKS_FILE, text: buildHooksFile('web') },
    gitignore,
  ]
}
