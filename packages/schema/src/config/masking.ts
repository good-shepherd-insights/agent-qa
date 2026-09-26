// 2026-09-26, 429-03 D-08: the one hard-coded map that decides masking for every config leaf,
// shared by the dashboard and `agent-qa config show`. Classes are assigned by path, never by
// guessing from a key's spelling. Its keys are the leaves of the published config schema
// (D-06), pinned against the real schema by core's config-schema-leaves test.
//
// Pattern format: dot-joined tokens, where '*' is an operator-named record key and a key
// suffixed '[]' is an array item (`registry.llms[].name`, `registry.targets.*.url`).

/**
 * How one config value is shown.
 * - `secret`: the value is masked.
 * - `env-var-name`: the value names an environment variable and is shown in clear.
 * - `plain`: the value is shown in clear.
 */
export type MaskingClass = 'secret' | 'env-var-name' | 'plain'
// prettier-ignore
export const MASKING_CLASSES = [
  'secret',
  'env-var-name',
  'plain',
] as const satisfies readonly MaskingClass[]

/**
 * Every config leaf and its class, one line per leaf in sorted order. Open-ended containers
 * (provider headers, device-farm provider settings, device `match` values, pass-rate
 * attributes) are secret wholesale, as is every leaf today's CLI masker already hid, except
 * the two env-var names.
 */
export const CONFIG_MASKING_MAP = Object.freeze({
  'analytics.passRateScope.attributes.*': 'secret',
  'analytics.passRateScope.attributes.*.regex': 'secret',
  'analytics.privacy': 'plain',
  'eval.adversarial.maxProbeCalls': 'plain',
  'eval.adversarial.maxSeedsPerRefresh': 'plain',
  'eval.gate1.maxPerJob': 'plain',
  'eval.gate1.maxScreens': 'plain',
  'eval.gate2.canaryHorizonBuilds': 'plain',
  'eval.gate2.maxAblations': 'plain',
  'eval.gate2.maxLowerTrustPerScope': 'plain',
  'eval.judge': 'plain',
  'eval.judgeAllowSameFamily': 'plain',
  'eval.judges[]': 'plain',
  'eval.k': 'plain',
  'eval.seed': 'plain',
  'eval.seeding.silverPerTestCap': 'plain',
  'knowledge.commitArtifacts': 'plain',
  'knowledge.contextBudgetTokens': 'plain',
  'knowledge.dir': 'plain',
  'plugins.auth[].package': 'plain',
  'plugins.auth[].path': 'plain',
  'plugins.providers[].package': 'plain',
  'plugins.providers[].path': 'plain',
  'registry.devices.*.match.*': 'secret',
  'registry.devices.*.platform': 'plain',
  'registry.devices.*.transport': 'plain',
  'registry.llms[].baseURL': 'plain',
  'registry.llms[].contextWindow': 'plain',
  'registry.llms[].model': 'plain',
  'registry.llms[].name': 'plain',
  'registry.llms[].provider': 'plain',
  'registry.llms[].providerHeaders.*': 'secret',
  'registry.llms[].vision': 'plain',
  'registry.providers.*.*': 'secret',
  'registry.targets.*.app.browserstack': 'plain',
  'registry.targets.*.app.path': 'plain',
  'registry.targets.*.appActivity': 'plain',
  'registry.targets.*.appPackage': 'plain',
  'registry.targets.*.bundleId': 'plain',
  'registry.targets.*.environment': 'plain',
  'registry.targets.*.platform': 'plain',
  'registry.targets.*.product': 'plain',
  'registry.targets.*.url': 'plain',
  'safety.trustMode': 'plain',
  'services.accessibility.disableRules[]': 'plain',
  'services.accessibility.enabled': 'plain',
  'services.accessibility.exclude[]': 'plain',
  'services.accessibility.failOnViolation': 'plain',
  'services.accessibility.runAfter': 'plain',
  'services.accessibility.standard': 'plain',
  'services.authState.dir': 'plain',
  'services.cache.dir': 'plain',
  'services.cache.ttl': 'plain',
  'services.dashboard.artifactsDir': 'plain',
  'services.dashboard.baseUrl': 'plain',
  'services.dashboard.dbPath': 'plain',
  'services.dashboard.host': 'plain',
  'services.dashboard.port': 'plain',
  'services.dashboard.runServiceTokens[].name': 'plain',
  'services.dashboard.runServiceTokens[].tokenEnvVar': 'env-var-name',
  'services.dashboard.runServiceTokens[].trustScope.org': 'plain',
  'services.dashboard.runServiceTokens[].trustScope.project': 'plain',
  'services.dashboard.workspace': 'plain',
  'services.logging.level': 'plain',
  'services.mcp.enabled': 'plain',
  'services.mcp.host': 'plain',
  'services.mcp.path': 'plain',
  'services.mcp.port': 'plain',
  'services.mcp.stdio.grantConfigWrite': 'plain',
  'services.mcp.tokens[].name': 'plain',
  'services.mcp.tokens[].scopes[]': 'plain',
  'services.mcp.tokens[].tokenEnvVar': 'env-var-name',
  'services.mcp.transport': 'plain',
  'services.recording.enabled': 'plain',
  'services.recording.keepFailuresOnly': 'plain',
  'services.vision.effectiveResolution': 'plain',
  'services.vision.screenshotSize': 'plain',
  'use.browser.headless': 'plain',
  'use.browser.name': 'plain',
  'use.browser.viewport.height': 'plain',
  'use.browser.viewport.width': 'plain',
  'use.buildTag': 'plain',
  'use.cache': 'plain',
  'use.llm': 'plain',
  'use.logCapture.console': 'plain',
  'use.logCapture.network': 'plain',
  'use.mobile.appState': 'plain',
  'use.parallel': 'plain',
  'use.planner.maxSubActions': 'plain',
  'use.planner.previousStepCount': 'plain',
  'use.timeout.navigation': 'plain',
  'use.timeout.step': 'plain',
  'use.timeout.test': 'plain',
  'use.workers': 'plain',
  'workspace.envFile': 'plain',
  'workspace.hooksFile': 'plain',
  'workspace.secretsFile': 'secret',
  'workspace.suiteMatch[]': 'plain',
  'workspace.testMatch[]': 'plain',
  'workspace.testPathIgnore[]': 'plain',
} as const satisfies Record<string, MaskingClass>)

export type ConfigLeafPattern = keyof typeof CONFIG_MASKING_MAP

/** The leaves of the published config schema, derived from the map so none is unclassified. */
export const CONFIG_SCHEMA_LEAVES: readonly ConfigLeafPattern[] = Object.freeze(
  Object.keys(CONFIG_MASKING_MAP) as ConfigLeafPattern[],
)

const RECORD_KEY = '*'
const ARRAY_ITEM = '[]'

interface TrieNode {
  children: Map<string, TrieNode>
  maskingClass: MaskingClass | undefined
  hasSecretBelow: boolean
}

function patternSteps(pattern: string): string[] {
  const steps: string[] = []
  for (const token of pattern.split('.')) {
    let key = token
    let items = 0
    while (key.endsWith(ARRAY_ITEM)) {
      key = key.slice(0, -ARRAY_ITEM.length)
      items++
    }
    steps.push(key)
    for (let i = 0; i < items; i++) steps.push(ARRAY_ITEM)
  }
  return steps
}

function newNode(): TrieNode {
  return { children: new Map(), maskingClass: undefined, hasSecretBelow: false }
}

const TRIE: TrieNode = (() => {
  const root = newNode()
  for (const pattern of CONFIG_SCHEMA_LEAVES) {
    const maskingClass = CONFIG_MASKING_MAP[pattern]
    const secret = maskingClass === 'secret'
    let node = root
    for (const step of patternSteps(pattern)) {
      if (secret) node.hasSecretBelow = true
      let child = node.children.get(step)
      if (child === undefined) {
        child = newNode()
        node.children.set(step, child)
      }
      node = child
    }
    node.maskingClass = maskingClass
  }
  return root
})()

/**
 * The class of one config path, given as segments so a dotted key (a model name, a record key
 * such as `git.branch`) stays one segment. A number segment is an array index. A path the map
 * does not describe classifies `secret`.
 */
export function classifyConfigPath(segments: readonly (string | number)[]): MaskingClass {
  let node = TRIE
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index]!
    let next: TrieNode | undefined
    if (typeof segment === 'number') {
      next = node.children.get(ARRAY_ITEM)
    } else {
      next = node.children.get(segment) ?? node.children.get(RECORD_KEY)
    }
    if (next === undefined) return 'secret'
    node = next
  }
  if (node.maskingClass !== undefined) return node.maskingClass
  return node.hasSecretBelow ? 'secret' : 'plain'
}

/**
 * The list owner of a leaf pattern: the prefix before its first '*' or '[]' token, or the
 * pattern itself when it has neither.
 */
export function configLeafOwner(pattern: string): string {
  const owner: string[] = []
  for (const token of pattern.split('.')) {
    if (token === RECORD_KEY) break
    const arrayAt = token.indexOf(ARRAY_ITEM)
    if (arrayAt !== -1) {
      owner.push(token.slice(0, arrayAt))
      break
    }
    owner.push(token)
  }
  return owner.join('.')
}
