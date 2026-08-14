import { readFile } from 'node:fs/promises'
import { dirname, resolve as resolvePath } from 'node:path'
import { parse as parseYaml } from 'yaml'
import pc from 'picocolors'
import {
  AgentQaConfigSchema,
  loadLLMAuthPlugins,
  resolveKnowledgeRoot,
  yamlParseFailureMessage,
} from '@vostride/agent-qa-core'
import type { AgentQaConfig } from '@vostride/agent-qa-core'
import type { GuardrailDetectorFamily } from '@vostride/agent-qa-schema'
import { findDetectorMatches } from '@vostride/agent-qa-safety'

const ENV_MAPPING: Record<string, string> = {
  AGENT_QA_DASHBOARD_PORT: 'services.dashboard.port',
  AGENT_QA_MCP_PORT: 'services.mcp.port',
  AGENT_QA_CACHE_DIR: 'services.cache.dir',
  AGENT_QA_CACHE_TTL: 'services.cache.ttl',
  AGENT_QA_LOG_LEVEL: 'services.logging.level',
  AGENT_QA_HEADLESS: 'use.browser.headless',
}

function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.')
  let current: Record<string, unknown> = obj
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]
    if (!(key in current) || typeof current[key] !== 'object' || current[key] === null) {
      current[key] = {}
    }
    current = current[key] as Record<string, unknown>
  }
  current[parts[parts.length - 1]] = value
}

function parseEnvValue(key: string, value: string): unknown {
  if (key === 'AGENT_QA_DASHBOARD_PORT' || key === 'AGENT_QA_MCP_PORT') {
    const parsed = Number.parseInt(value, 10)
    if (Number.isInteger(parsed)) return parsed
  }
  if (key === 'AGENT_QA_HEADLESS') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true') return true
    if (normalized === 'false') return false
  }
  return value
}

/**
 * A committed config the parser cannot read, named by WHERE and never by WHAT (395-14 · F-01).
 *
 * WHY A NAMED CLASS AND NOT A BARE `Error`. This throw leaves the loader through every config op,
 * through `resolveConfig`, and — via `refusalMessage` — into a chat turn's answer and its session
 * jsonl. A caller that wants to recognise the case (F-03's typed-refusal arm, later) needs
 * something better than a substring match on a sentence; `name` and `configPath` are that. The
 * message itself carries the path because the surfaces this reaches print a message and nothing
 * else.
 *
 * NO MEMBER INTERPOLATES THE CAUGHT ERROR'S OWN TEXT. `yaml` pretty-prints its parse errors with a
 * verbatim excerpt of the person's source, which was measured carrying a planted credential out of
 * three ops.
 *
 * AND THE CAUSE IS SANITIZED TOO, BECAUSE THE RUNTIME READS THE CAUSE CHAIN (395-16 · CR-01).
 * An earlier revision of this class attached the raw `YAMLParseError` as `cause` on the reasoning
 * that no composed member reads it. That reasoning was false of the runtime, and shipped as a
 * defect: a thrown value is read by far more than the code that composed it. Node's DEFAULT
 * UNCAUGHT PRINTER renders an error with `util.inspect`, which walks `cause` and prints it under a
 * `[cause]:` header — `agent-qa config show` awaited this loader bare and crash-printed the
 * person's own file back at them. `console.error(err)` does the same thing, structured loggers
 * (pino, winston) serialize the chain, and crash reporters upload it. So the cause carried here is
 * a fresh `Error` holding THE SAME POSITION-ONLY SENTENCE as the message: a debugger still gets a
 * chain to walk, and every one of those readers gets a position and nothing else. The caught value
 * is not reachable from this error by any property.
 */
export class ConfigFileNotYamlError extends Error {
  readonly configPath: string

  constructor(configPath: string, cause: unknown) {
    const positionOnly = `${configPath}: ${yamlParseFailureMessage(cause)}`
    super(positionOnly, { cause: new Error(positionOnly) })
    this.name = 'ConfigFileNotYamlError'
    this.configPath = configPath
  }
}

/**
 * THE READ AND THE PARSE GET SEPARATE CATCHES, and that separation is load-bearing.
 *
 * `Config file not found: <path>` is matched verbatim by the live lane's third-arm detection
 * (`scripts/395-live-from-zero.sh:514`) and folded by `coveringGrantInForce`; a non-ENOENT read
 * fault (EISDIR, EACCES) is a fact about the filesystem and not about the file's content, and is
 * rethrown untouched. Only the PARSE throw is reworded — one guard, aimed at one channel.
 */
export async function loadConfigFile(configPath: string): Promise<unknown> {
  let content: string
  try {
    content = await readFile(configPath, 'utf-8')
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw err
  }
  try {
    return parseYaml(content) ?? {}
  } catch (err: unknown) {
    throw new ConfigFileNotYamlError(configPath, err)
  }
}

export async function loadRequiredConfigFile(configPath: string): Promise<unknown> {
  let content: string
  try {
    content = await readFile(configPath, 'utf-8')
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Config file not found: ${configPath}`)
    }
    throw err
  }
  try {
    return parseYaml(content) ?? {}
  } catch (err: unknown) {
    throw new ConfigFileNotYamlError(configPath, err)
  }
}

export function loadEnvOverrides(): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [envKey, configPath] of Object.entries(ENV_MAPPING)) {
    const value = process.env[envKey]
    if (value !== undefined) {
      setNestedValue(result, configPath, parseEnvValue(envKey, value))
    }
  }
  return result
}

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val)
}

export function mergeConfigs(
  file: unknown,
  env: Record<string, unknown>,
  flags: Record<string, unknown>,
): unknown {
  return deepMerge(deepMerge(file ?? {}, env), flags)
}

export function deepMerge(base: unknown, override: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(override)) return override
  const result: Record<string, unknown> = { ...base }
  for (const key of Object.keys(override)) {
    if (key in result && isPlainObject(result[key]) && isPlainObject(override[key])) {
      result[key] = deepMerge(result[key], override[key])
    } else {
      result[key] = override[key]
    }
  }
  return result
}

export function mergeWithTestConfig(
  globalConfig: unknown,
  testConfig: unknown,
  flagOverrides: Record<string, unknown>,
): unknown {
  return deepMerge(deepMerge(globalConfig ?? {}, testConfig ?? {}), flagOverrides)
}

/**
 * The one shaping `resolveConfig` applies before validating (395-01: exported, not moved).
 *
 * EXPORTED so the config-mutation validate port can run the SAME three steps a real run runs —
 * merge, normalize, parse. A port that skipped this would refuse a candidate whose only problem is
 * a key `resolveConfig` deletes, which is a proposal blocked by a rule nothing enforces.
 */
export function normalizeConfigForValidation(config: unknown): unknown {
  if (!isPlainObject(config)) return config
  const normalized = deepMerge({}, config) as Record<string, unknown>
  const use = normalized.use
  if (isPlainObject(use)) {
    delete use.headless
  }
  return normalized
}

export function mergeUseBlocks(
  globalUse: Record<string, unknown> | undefined,
  suiteUse: Record<string, unknown> | undefined,
  testUse: Record<string, unknown> | undefined,
  cliFlags: Record<string, unknown>,
): Record<string, unknown> {
  return deepMerge(
    deepMerge(
      deepMerge(globalUse ?? {}, suiteUse ?? {}),
      testUse ?? {},
    ),
    cliFlags,
  ) as Record<string, unknown>
}

function flattenObject(obj: unknown, prefix = ''): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    if (prefix) result[prefix] = obj
    return result
  }
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      Object.assign(result, flattenObject(value, path))
    } else {
      result[path] = value
    }
  }
  return result
}

type ConfigSource = 'global config' | 'test yaml' | 'cli flag'

/**
 * THE KEY-NAME ARM's set — normalized last segments (395-20 · F-03).
 *
 * RETUNE NOTE. This set was private to `commands/config.ts` and answered ONE caller, the `config
 * set` refusal. It held `apikey`, `authtoken`, `token`, `key`, `accesskey`, `secret`, `password`,
 * `bearertoken`, `accesstoken`, `refreshtoken` — and NOT `apitoken`, which is why the verifier's
 * `agent-qa config set apiToken sk-…` was accepted and written into the committed yaml, and why
 * applying the old predicate at the render would still have printed the review's own fixture key.
 * The widening below adds that hole's key and the adjacent forms that are obvious misses of the
 * same enumeration: the `*secret` and `*key` credential compounds, the remaining token families,
 * and the plain credential words.
 *
 * WHAT IS DELIBERATELY NOT HERE. `auth` alone: `plugins.auth` is a configuration block this
 * product's own refusal message tells people to use, and a name arm that swallows it would refuse
 * the guidance it prints. `url`, `endpoint`, `user`: identifiers, not credentials — (K4) pins them
 * rendering and writing verbatim.
 *
 * AND THE SET IS NOT THE POINT. A name list can only refuse what it can NAME (393's
 * door-enumeration finding), so every member added here closes exactly one door and no class. The
 * class is closed by the value arm below; this set exists so that a credential whose VALUE has no
 * recognisable shape (an opaque internal token, a password) is still caught under a name that says
 * what it is.
 */
const CREDENTIAL_KEY_NAMES = new Set([
  'accesskey',
  'accesstoken',
  'apikey',
  'apisecret',
  'apitoken',
  'authorization',
  'authtoken',
  'bearertoken',
  'clientsecret',
  'credential',
  'credentials',
  'idtoken',
  'key',
  'passwd',
  'password',
  'privatekey',
  'refreshtoken',
  'secret',
  'secretkey',
  'sessiontoken',
  'token',
])

/**
 * THE VALUE-SHAPE ARM's families — the SC-2 vocabulary, a named subset (395-20 · F-03).
 *
 * These four are the CREDENTIAL-shaped families of the guardrail detector set: `apiKey` (the
 * `sk-`/`gh?_`/`AIza` provider prefixes and the 40-char opaque token shape), `bearer`, `awsKey` and
 * `pemKey`. Reusing them rather than writing new regexes here is deliberate — a second answer to
 * "what does a credential look like" is a second thing that drifts, and drift between two answers
 * to one question is the defect this plan closes.
 *
 * THE THREE EXCLUDED, and why: `email` and `creditCard` are PII, not credentials — redacting a
 * `notify.email` out of `config show` would break the command for a value the person put there to
 * read back, and this predicate also gates a WRITE refusal, where refusing to set an email address
 * would be a plain regression. `injectionShape` is a prompt-routing heuristic whose own source
 * calls it a soft signal costing review rather than rejection; wiring it to a hard refusal would
 * mean `config set` rejecting ordinary prose.
 *
 * KNOWN OVER-REACH, accepted (T-395-56): the `apiKey` family carries a generic 40-character
 * alphanumeric shape, so a 40-char hex digest set as a config value is treated as credential-shaped.
 * That is the arm doing its job on an ambiguous input, and the failure direction is the safe one.
 */
const CREDENTIAL_VALUE_DETECTORS: readonly GuardrailDetectorFamily[] = [
  'apiKey',
  'awsKey',
  'bearer',
  'pemKey',
]

/**
 * THE ONE ANSWER to "is this config entry credential-bearing" (395-20 · F-03).
 *
 * TWO CALLERS, ONE EXPORT, ON PURPOSE. `formatConfigDebug`'s row loop redacts through it and
 * `setAction` refuses through it. Before this, the render had no predicate at all and the write had
 * a private one with a hole — the read and write sides of a single contract answering the question
 * differently is exactly the shape 388/390/392 keep filing, and it is why `config set apiToken`
 * could write a value `config show` would then print back.
 *
 * The arms are an OR: a credential is either something the key says is one, or something the value
 * looks like.
 */
export function isCredentialEntry(key: string, value: unknown): boolean {
  const lastSegment = key.split('.').pop() ?? ''
  if (CREDENTIAL_KEY_NAMES.has(lastSegment.toLowerCase().replace(/[^a-z0-9]/g, ''))) return true
  if (typeof value !== 'string' || value === '') return false
  return CREDENTIAL_VALUE_DETECTORS.some(
    (family) => findDetectorMatches(family, value).length > 0,
  )
}

/** What a person sees where a credential's value would have been. */
const CREDENTIAL_REDACTION = '<redacted>'

export function formatConfigDebug(
  globalConfig: unknown,
  testConfig: unknown,
  flagOverrides: Record<string, unknown>,
): string {
  const layers: { flat: Record<string, unknown>; label: ConfigSource }[] = [
    { flat: flattenObject(globalConfig), label: 'global config' },
    { flat: flattenObject(testConfig), label: 'test yaml' },
    { flat: flattenObject(flagOverrides), label: 'cli flag' },
  ]

  const merged = mergeWithTestConfig(globalConfig, testConfig, flagOverrides)
  const mergedFlat = flattenObject(merged)

  const colorize: Record<ConfigSource, (s: string) => string> = {
    'global config': pc.dim,
    'test yaml': pc.cyan,
    'cli flag': pc.green,
  }

  const rows: { key: string; value: string; source: ConfigSource }[] = []
  for (const key of Object.keys(mergedFlat).sort()) {
    let source: ConfigSource = 'global config'
    // Check layers in reverse priority order — last match wins
    for (const layer of layers) {
      if (key in layer.flat) {
        source = layer.label
      }
    }
    const valStr = typeof mergedFlat[key] === 'string' ? mergedFlat[key] : JSON.stringify(mergedFlat[key])
    // THE REDACTION LIVES HERE, IN THE ROW LOOP, NOT AT A CALL SITE (395-20 · F-03). This function
    // has THREE person-facing callers — `config show` (commands/config.ts) and the two `--debug`
    // config tables on the run road (commands/run.ts:2783 and :2913). Redacting inside `showAction`
    // would have closed the road the verifier happened to drive and left the other two printing the
    // same values: the sibling-input law applied to the render itself.
    const rendered = isCredentialEntry(key, mergedFlat[key]) ? CREDENTIAL_REDACTION : valStr
    rows.push({ key, value: rendered, source })
  }

  if (rows.length === 0) return pc.dim('  (no config values)')

  const maxKey = Math.max(...rows.map(r => r.key.length), 3)
  const maxVal = Math.max(...rows.map(r => r.value.length), 5)

  const header = `  ${'Key'.padEnd(maxKey)}  ${'Value'.padEnd(maxVal)}  Source`
  const sep = `  ${'─'.repeat(maxKey)}  ${'─'.repeat(maxVal)}  ${'─'.repeat(13)}`
  const lines = rows.map(r => {
    const color = colorize[r.source]
    return `  ${r.key.padEnd(maxKey)}  ${r.value.padEnd(maxVal)}  ${color(r.source)}`
  })

  return [header, sep, ...lines].join('\n')
}

export async function resolveConfig(options: {
  configPath?: string
  flags?: Record<string, unknown>
  loadAuthPlugins?: boolean
}): Promise<AgentQaConfig> {
  const configPath = options.configPath ?? 'agent-qa.config.yaml'
  const fileConfig = await loadRequiredConfigFile(configPath)
  const envOverrides = loadEnvOverrides()
  const merged = mergeConfigs(fileConfig, envOverrides, options.flags ?? {})
  const normalized = normalizeConfigForValidation(merged)

  const result = AgentQaConfigSchema.safeParse(normalized)
  if (!result.success) {
    const messages = result.error.issues.map((issue: { path: PropertyKey[]; message: string }) => {
      const path = issue.path.map(String).join('.')
      return `  ${path}: ${issue.message}`
    })
    const legacyDashboardEnabled =
      typeof merged === 'object'
      && merged !== null
      && !Array.isArray(merged)
      && typeof (merged as Record<string, unknown>).services === 'object'
      && (merged as Record<string, unknown>).services !== null
      && !Array.isArray((merged as Record<string, unknown>).services)
      && typeof ((merged as Record<string, unknown>).services as Record<string, unknown>).dashboard === 'object'
      && ((merged as Record<string, unknown>).services as Record<string, unknown>).dashboard !== null
      && !Array.isArray(((merged as Record<string, unknown>).services as Record<string, unknown>).dashboard)
      && 'enabled' in (((merged as Record<string, unknown>).services as Record<string, unknown>).dashboard as Record<string, unknown>)

    const dashboardHint = legacyDashboardEnabled
      ? `\n\nHint: services.dashboard.enabled was removed. Dashboard behavior is enabled by the presence of the services.dashboard block itself. Remove the enabled key and keep fields like port, dbPath, or artifactsDir.`
      : ''
    throw new Error(
      `Config validation failed:\n${messages.join('\n')}\n\n` +
      `Run 'agent-qa init' to generate a complete config file.` +
      dashboardHint
    )
  }
  if (options.loadAuthPlugins !== false) {
    await loadLLMAuthPlugins(result.data.plugins?.auth, {
      baseDir: dirname(resolvePath(configPath)),
    })
    const { loadProviderPluginsForRawConfig } = await import('./provider-plugins.js')
    await loadProviderPluginsForRawConfig(result.data, configPath)
  }
  return result.data
}

/** Resolve the writer-gated knowledge root without making each CLI surface import core directly. */
export function resolveConfiguredKnowledgeRoot(
  config: AgentQaConfig,
  configDir: string,
): string {
  return resolveKnowledgeRoot(config.knowledge, configDir)
}
