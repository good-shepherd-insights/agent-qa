import { randomUUID } from 'node:crypto'
import { resolve as resolvePath } from 'node:path'
import { Command } from 'commander'
import pc from 'picocolors'
import { resolveConfig, mergeWithTestConfig, mergeUseBlocks, formatConfigDebug, loadEnvOverrides } from '../config.js'
import { ATTR_RUNNER, ATTR_TRIGGER, AUTH_STATE_SCHEMA_VERSION, buildInternalRunAttributes, DEFAULT_AGENT_QA_ARTIFACTS_DIR, DEFAULT_AGENT_QA_CACHE_DIR, DEFAULT_AGENT_QA_VIDEOS_DIR, formatRunAttributesBlock, generateRunId, mergeRunAttributes, MobileSetupError, normalizeAuthStateUse, parseRunAttrFlags, redactAuthStateValue, resolveAuthStateForRun, resolveAuthStatePaths, resolveMemoryRoot, resolveMobileRunConfig, validateTrustedRunAttributes } from '@vostride/agent-qa-core'
import { discoverWorkspaceFiles, isWorkspacePathMatch, resolveWorkspaceFileTarget, resolveWorkspacePaths } from '@vostride/agent-qa-core'
import type { AgentQaConfig, AuthStateMetadata, NormalizedAuthStateUse, ResolvedAuthStateForRun, ResolvedAuthStatePaths, ResolvedMobileRunConfig, ResolvedWorkspacePaths, RunAttributes, RunAttributeRunner, RunAttributeTrigger, WorkspaceFileKind, WorkspaceFileRecord } from '@vostride/agent-qa-core'
import { createModel, createTokenAccounting, resolveCapabilities, resolveVisionConfig, resolveVisionGate } from '@vostride/agent-qa-model'
import { resolveTarget, type ResolvedTarget } from '../targets.js'
import { resolveDevice, loadLocalBindings, resolveProviderCredentials, type ResolvedDevice } from '../devices.js'
import { resolveLLMModels, resolveModelAuth, toModelProfileAndAuth } from '../llm-utils.js'
import { formatInstallBrowsersRetryCommand, type BrowserInstallSelection } from './install-browsers.js'
import type { TestDefinition, ParseError, SuiteDefinition, SuiteResult, RunSuiteConfig } from '@vostride/agent-qa-core'
import type { SecretStore, SecretRedactor, HookDefinition, SandboxRunnerOptions } from '@vostride/agent-qa-runner'
import { DockerHookExecutor } from '@vostride/agent-qa-runner-local'
import type { TestResult, PlatformAdapter, PlatformConfig } from '@vostride/agent-qa-runner'
import { WorkingMemoryStore } from '@vostride/agent-qa-runner'
import type { RunMemberDescriptor, ConfigDigests, MemberTestRunContext, MemberTestExecutor } from '@vostride/agent-qa-runner'
import {
  computeRunConfigDigests,
  resolveRunExecutionContext,
  buildRunPorts,
  buildScreenshotCompressor,
  resolveRunBuildOrdinal,
  createSuiteLifecycle,
  buildSuiteMemberExecutor,
  buildRunMaskingContext,
  buildRunAuditSink,
  buildRunSafetyHooks,
  extractAuthStateSensitiveStrings,
  attachRunSubscribers,
  createLivePauseController,
  type RunSubscriberHandle,
  type SuiteMemberBinding,
  type RunMaskingContext,
} from '../run-session-composition.js'
import { runSafetyScope } from '@vostride/agent-qa-safety-local'
import type { SafetyHookRunner } from '@vostride/agent-qa-safety'
import { flushWorkingMemory } from '../wm-flush.js'
import { isPathInsideDir } from '@vostride/agent-qa-core'
import { BetterSqlite3AbiMismatchError, isBetterSqlite3AbiMismatch } from '@vostride/agent-qa-core'
import { createShutdownController } from './shutdown-controller.js'
import { printAgentQaUpdateNoticeIfNeeded, shouldPrintAgentQaUpdateNotice, type AgentQaUpdateNoticeContext } from '../version-notice.js'

const RUNTIME_ARTIFACTS_DIR = DEFAULT_AGENT_QA_ARTIFACTS_DIR || '.agent-qa/artifacts'
const RUNTIME_CACHE_DIR = DEFAULT_AGENT_QA_CACHE_DIR || '.agent-qa/cache'
const RUNTIME_VIDEOS_DIR = DEFAULT_AGENT_QA_VIDEOS_DIR || '.agent-qa/artifacts/videos'

// SESSION-04 force-exit backstop grace window. Primary guarantee is the shell settling `done`
// cleanly on cancel/budget (Plan 361-13 Task 2); this is a hard safety net so a genuinely
// un-settleable run still exits 130 and a live Ctrl+C can never hang the CLI. Overridable via env
// for tests. The armed timer is `.unref()`d — it never keeps the loop alive on its own, but still
// fires if a wedged run is keeping the loop alive.
function cancelGraceMs(): number {
  return Number(process.env.AGENT_QA_CANCEL_GRACE_MS ?? 3000)
}

// CI vendor-var set reused for the CachePolicy.isCI resolution at the composition root
// (mirrors safety-local's execution-context-detector set — D-14). Kept inline so the CLI
// does not take a new cross-package dependency purely to read env markers.
const CI_VENDOR_VARS = [
  'CI', 'GITHUB_ACTIONS', 'GITLAB_CI', 'CIRCLECI', 'TRAVIS', 'APPVEYOR', 'BUILDKITE',
  'DRONE', 'JENKINS_URL', 'HUDSON_URL', 'BITBUCKET_BUILD_NUMBER', 'TEAMCITY_VERSION',
] as const

function resolveIsCI(env: NodeJS.ProcessEnv = process.env): boolean {
  return CI_VENDOR_VARS.some((name) => {
    const value = env[name]
    return value !== undefined && value !== '' && value.toLowerCase() !== 'false' && value !== '0'
  })
}

/**
 * Composition-root construction of the redesigned action cache (Phase 356, D-01/D-05/D-14).
 * Builds the runner-local `FsActionCache` behind a resolved branch `CachePolicy`, injected into the
 * runner loop's cache port via RunTest/RunSuite config. The loop's masking port carries the ONE run
 * MaskingContext (built at the composition root's startRun sites, SEAM-01/362-06), not this helper.
 */
async function buildActionCacheContext(params: {
  cacheDir: string
  disableCache: boolean
  saveCache: boolean
  protectedBranches?: string[]
}): Promise<{ cache: import('@vostride/agent-qa-runner').ActionPlanCache }> {
  const { FsActionCache, resolveBranch } = await import('@vostride/agent-qa-runner-local')
  const branch = resolveBranch({ cwd: process.cwd() })
  const cache = new FsActionCache({
    root: params.cacheDir,
    policy: {
      currentBranch: branch.currentBranch,
      defaultBranch: branch.defaultBranch,
      protectedBranches: [branch.defaultBranch, ...(params.protectedBranches ?? [])],
      isCI: resolveIsCI(),
      saveCache: params.saveCache,
      disableCache: params.disableCache,
    },
  })
  return { cache }
}

/**
 * Composition-root construction of the run-scoped storage-state store (Phase 360, D-14). Builds
 * the runner-local `FsStorageStateStore` rooted at the run's `.agent-qa` runtime dir (the
 * FsActionCache rooting idiom) — the raw-but-local auth-persistence home under
 * `.agent-qa/storage-states/`. Injected into the runner loop's `storageState` port; all fs writes
 * stay in runner-local (validate:arch storageNeutral).
 */
async function buildStorageStateStore(configDir: string): Promise<import('@vostride/agent-qa-runner').StorageStatePort> {
  const { FsStorageStateStore } = await import('@vostride/agent-qa-runner-local')
  const { resolve } = await import('node:path')
  return new FsStorageStateStore({ root: resolve(configDir, '.agent-qa') })
}

let _appiumManager: InstanceType<typeof import('@vostride/agent-qa-dashboard').AppiumManager> | null = null

async function acquireAppium(logLevel: string): Promise<string | undefined> {
  if (process.env.AGENT_QA_APPIUM_URL) return process.env.AGENT_QA_APPIUM_URL
  const { AppiumManager } = await import('@vostride/agent-qa-dashboard')
  if (!_appiumManager) {
    _appiumManager = new AppiumManager({
      logLevel: logLevel === 'debug' ? 'debug' : 'normal',
    })
  }
  await _appiumManager.acquire()
  return _appiumManager.getUrl()
}

function releaseAppium(): void {
  _appiumManager?.release()
}

export async function createPlatformAdapter(
  platform: 'web' | 'android' | 'ios',
): Promise<PlatformAdapter> {
  if (platform === 'android') {
    try {
      const { AndroidPlatformAdapter } = await import('@vostride/agent-qa-android')
      return new AndroidPlatformAdapter()
    } catch {
      throw new Error(
        'Android adapter not available. Install @vostride/agent-qa-android: pnpm add @vostride/agent-qa-android',
      )
    }
  }
  if (platform === 'ios') {
    try {
      const { IOSPlatformAdapter } = await import('@vostride/agent-qa-ios')
      return new IOSPlatformAdapter()
    } catch {
      throw new Error(
        'iOS adapter not available. Install @vostride/agent-qa-ios: pnpm add @vostride/agent-qa-ios',
      )
    }
  }
  const { WebPlatformAdapter } = await import('@vostride/agent-qa-web')
  return new WebPlatformAdapter()
}

const runWebAccessibilityCheck: NonNullable<RunSuiteConfig['accessibilityCheck']> = async (page, options) => {
  const { runAccessibilityCheck } = await import('@vostride/agent-qa-web')
  return runAccessibilityCheck(page as any, options)
}

export function buildPlatformConfig(
  platform: 'web' | 'android' | 'ios',
  resolvedDevice: ResolvedDevice | undefined,
  timeouts: PlatformConfig['timeouts'],
  globalBrowser?: { name?: string; headless?: boolean; viewport?: { width: number; height: number } },
  logCapture?: { console?: boolean; network?: boolean },
  farmSession?: PlatformConfig['farmSession'],
  mobileResolved?: ResolvedMobileRunConfig,
): PlatformConfig {
  if (platform === 'web') {
    return {
      platform: 'web',
      browser: {
        name: (globalBrowser?.name as 'chromium' | 'firefox' | 'webkit') ?? 'chromium',
        headless: globalBrowser?.headless ?? true,
        viewport: globalBrowser?.viewport,
      },
      timeouts,
      logCapture,
    }
  }
  return {
    platform,
    device: resolvedDevice ? {
      name: resolvedDevice.name,
      platform: resolvedDevice.platform,
      transport: resolvedDevice.transport,
      match: resolvedDevice.match,
    } : undefined,
    bundleId: mobileResolved?.app.bundleId,
    appPackage: mobileResolved?.app.appPackage,
    appActivity: mobileResolved?.app.appActivity,
    deepLinkAppId: mobileResolved?.app.deepLinkAppId,
    appState: mobileResolved?.appState,
    appPath: mobileResolved?.app.install?.path,
    browserstackApp: mobileResolved?.app.install?.browserstack,
    appiumUrl: mobileResolved?.appium.url,
    timeouts,
    logCapture,
    farmSession,
  }
}

type WebBrowserName = 'chromium' | 'firefox' | 'webkit'

interface FormattedFrameworkError {
  displayMessage: string
  failureSummary: string
}

function inferMissingBrowser(message: string): WebBrowserName | null {
  const lower = message.toLowerCase()
  if (/(^|[/\\])webkit-\d/.test(lower) || lower.includes('webkit')) return 'webkit'
  if (/(^|[/\\])firefox-\d/.test(lower) || lower.includes('firefox')) return 'firefox'
  if (/(^|[/\\])chromium-\d/.test(lower) || lower.includes('chromium')) return 'chromium'
  return null
}

function isRawPlaywrightMissingBrowserError(message: string): boolean {
  const lower = message.toLowerCase()
  return lower.includes("executable doesn't exist")
    && lower.includes('playwright')
    && lower.includes('install')
}

function formatBrowserInstallSelection(browserName: WebBrowserName | null): BrowserInstallSelection {
  if (browserName === 'chromium') return { chromium: true }
  if (browserName === 'firefox') return { firefox: true }
  if (browserName === 'webkit') return { webkit: true }
  return { all: true }
}

function browserDisplayName(browserName: WebBrowserName | null): string {
  if (browserName === 'chromium') return 'Chromium'
  if (browserName === 'firefox') return 'Firefox'
  if (browserName === 'webkit') return 'WebKit'
  return 'the selected browser'
}

function formatMissingBrowserFrameworkError(message: string): FormattedFrameworkError | null {
  const browserName = inferMissingBrowser(message)
  const retryCommand = formatInstallBrowsersRetryCommand(formatBrowserInstallSelection(browserName))
  const alreadyFriendly = message.startsWith('agent-qa browser support is not installed')

  if (!alreadyFriendly && !isRawPlaywrightMissingBrowserError(message)) return null

  const displayMessage = alreadyFriendly
    ? message
    : [
      `agent-qa browser support is not installed for ${browserDisplayName(browserName)}.`,
      '',
      'Install the browser managed by agent-qa, then rerun the test:',
      `  ${retryCommand}`,
      '',
      'This can happen after upgrading agent-qa or Playwright because browser binaries live outside the package install.',
    ].join('\n')

  return {
    displayMessage,
    failureSummary: `Browser support missing: run ${retryCommand}`,
  }
}

function formatFrameworkError(message: string): FormattedFrameworkError {
  return formatMissingBrowserFrameworkError(message) ?? {
    displayMessage: `Framework error: ${message}`,
    failureSummary: `Framework error: ${message.slice(0, 200)}`,
  }
}

function resolveDashboardVideoDir(
  config: AgentQaConfig,
  configDir: string,
  dashboardEnabled: boolean,
): string {
  const recordingCfg = config.services?.recording as Record<string, unknown> | undefined
  const configuredVideoDir = recordingCfg?.videoDir as string | undefined
  if (configuredVideoDir) {
    return resolvePath(configDir, configuredVideoDir)
  }
  if (dashboardEnabled) {
    const dashArtifactsDir = (config.services?.dashboard as Record<string, unknown> | undefined)?.artifactsDir as string | undefined
    return resolvePath(configDir, dashArtifactsDir ?? RUNTIME_ARTIFACTS_DIR, 'videos')
  }
  return resolvePath(configDir, RUNTIME_VIDEOS_DIR)
}

interface RunOptions {
  browser?: string
  platform?: string
  headless?: boolean
  disableCache?: boolean
  saveCache?: boolean
  memory?: boolean
  bail?: boolean
  dryRun?: boolean
  listTests?: boolean
  junitOutput?: string
  screenshotDir?: string
  screenshotMode?: string
  reporter?: string[]
  record?: boolean
  configDebug?: boolean
  test?: boolean
  suite?: boolean
  all?: boolean
  device?: string
  var?: string[]
  runAttr?: string[]
  trustSession?: boolean
}

const SUPPORTED_REPORTERS = ['console', 'junit', 'stdout-live', 'dashboard'] as const
type ReporterName = typeof SUPPORTED_REPORTERS[number]

interface ReporterSelection {
  console: boolean
  junit: boolean
  stdoutLive: boolean
  dashboard: boolean
}

interface SecretsFileArtifactMetadata {
  path: string | null
  status: 'loaded' | 'missing' | 'unreadable' | 'invalid'
  count?: number
}

interface RuntimeSecretsContext {
  secretStore: SecretStore
  secretRedactor: SecretRedactor
  secretsFileMetadata: SecretsFileArtifactMetadata
}

function parseVarFlags(flags: string[] | undefined): Record<string, string> {
  if (!flags) return {}
  const vars: Record<string, string> = {}
  for (const kv of flags) {
    const eqIdx = kv.indexOf('=')
    if (eqIdx === -1) {
      console.warn(`Warning: --var "${kv}" missing =, ignored`)
      continue
    }
    vars[kv.slice(0, eqIdx)] = kv.slice(eqIdx + 1)
  }
  return vars
}

function resolveRunnerAttribute(transport: string | undefined): RunAttributeRunner {
  return transport === 'browserstack' ? 'browserstack' : 'local'
}

function buildCliRunAttributes(userAttributes: RunAttributes, runner: RunAttributeRunner): RunAttributes {
  return mergeRunAttributes(
    buildInternalRunAttributes({ trigger: 'cli', runner }),
    userAttributes,
  )
}

function readRunAttributesFromEnv(): RunAttributes | undefined {
  const raw = process.env.AGENT_QA_RUN_ATTRIBUTES_JSON
  if (!raw) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('inherited run attributes: AGENT_QA_RUN_ATTRIBUTES_JSON must contain valid run attributes JSON')
  }
  const attributes = validateTrustedRunAttributes(parsed, 'inherited run attributes')
  return Object.keys(attributes).length > 0 ? attributes : undefined
}

function resolveCliRunAttributes(
  userAttributes: RunAttributes,
  runner: RunAttributeRunner,
  inheritedAttributes?: RunAttributes,
): RunAttributes {
  if (!inheritedAttributes) return buildCliRunAttributes(userAttributes, runner)
  const trigger = inheritedAttributes[ATTR_TRIGGER] as RunAttributeTrigger | undefined
  const inheritedUserAttributes = Object.fromEntries(
    Object.entries(inheritedAttributes)
      .filter(([key]) => key !== ATTR_TRIGGER && key !== ATTR_RUNNER),
  )
  return mergeRunAttributes(
    buildInternalRunAttributes({ trigger: trigger ?? 'cli', runner }),
    inheritedUserAttributes,
  )
}

function writeRunAttributesToEnv(attributes: RunAttributes): void {
  process.env.AGENT_QA_RUN_ATTRIBUTES_JSON = JSON.stringify(attributes)
}

function printRunAttributes(attributes: RunAttributes | undefined): void {
  if (!attributes || Object.keys(attributes).length === 0) return
  const block = formatRunAttributesBlock(attributes)
  if (block) console.log(block)
}

function resolveReporterSelection(opts: RunOptions, dashboardConfigured: boolean): { selection?: ReporterSelection; error?: string } {
  const requiredDashboard = Boolean(process.env.AGENT_QA_RUN_ID || process.env.AGENT_QA_SUITE_QUEUE_ID)
  const requested = opts.reporter
    ?.flatMap((name) => name.split(','))
    .map((name) => name.trim())
    .filter(Boolean)

  if (!requested?.length) {
    return {
      selection: {
        console: true,
        junit: Boolean(opts.junitOutput),
        stdoutLive: process.env.AGENT_QA_LIVE_EVENTS === 'true',
        dashboard: dashboardConfigured || requiredDashboard,
      },
    }
  }

  for (const name of requested) {
    if (!SUPPORTED_REPORTERS.includes(name as ReporterName)) {
      return { error: `Unknown reporter "${name}". Supported reporters: ${SUPPORTED_REPORTERS.join(', ')}` }
    }
  }

  const selected = new Set(requested as ReporterName[])
  if (selected.has('junit') && !opts.junitOutput) {
    return { error: '--reporter junit requires --junit-output <path>' }
  }

  return {
    selection: {
      console: selected.has('console'),
      junit: selected.has('junit'),
      stdoutLive: selected.has('stdout-live'),
      dashboard: selected.has('dashboard') || requiredDashboard,
    },
  }
}

// 363-09: the spawn correlation env the dashboard ingest reads from `process.env` (the bus never
// carries it). Read once at the composition root and passed into `createDashboardRunIngest`.
function readDashboardCorrelationEnv(env: NodeJS.ProcessEnv = process.env): {
  runId?: string
  parentRunId?: string
  suiteQueueId?: string
  maxRetries?: number
  attemptNumber?: number
} {
  const num = (value: string | undefined): number | undefined => {
    if (value === undefined) return undefined
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return {
    runId: env.AGENT_QA_RUN_ID,
    parentRunId: env.AGENT_QA_PARENT_RUN_ID,
    suiteQueueId: env.AGENT_QA_SUITE_QUEUE_ID,
    maxRetries: num(env.AGENT_QA_MAX_RETRIES),
    attemptNumber: num(env.AGENT_QA_ATTEMPT_NUMBER),
  }
}

// 363-09 (D-08 successor): construct the dashboard DB ingest as a bus subscriber (replacing the v1
// DashboardReporter attach). Config/source snapshots + correlation env ride construction; envelopes
// drive lifecycle. Returns a subscriber handle whose `flush` lands the finalize sweep (the memory
// section arrives out-of-band). Dashboard is optional — a load failure degrades to no subscriber.
async function buildDashboardIngestSubscriber(input: {
  db: any
  configSnapshot?: unknown
  sourceSnapshot?: unknown
  attributes?: RunAttributes
  onRunCreated?: (runId: string) => void
}): Promise<RunSubscriberHandle | undefined> {
  try {
    const { createDashboardRunIngest } = await import('@vostride/agent-qa-dashboard')
    const ingest = createDashboardRunIngest({
      db: input.db,
      configSnapshot: input.configSnapshot as any,
      sourceSnapshot: input.sourceSnapshot as any,
      attributes: input.attributes,
      correlationEnv: readDashboardCorrelationEnv(),
      onRunCreated: input.onRunCreated,
    })
    return {
      handler: ingest.handler,
      flush: () => ingest.finalize(),
    }
  } catch {
    return undefined
  }
}

async function maybePrintPostRunUpdateNotice(context: AgentQaUpdateNoticeContext): Promise<void> {
  try {
    if (!shouldPrintAgentQaUpdateNotice(context)) return
    await printAgentQaUpdateNoticeIfNeeded(context)
  } catch {
    // Update notices are best-effort and must not affect run outcomes.
  }
}

function formatParseErrors(errors: ParseError[]): void {
  for (const err of errors) {
    const location = `${err.file}:${err.line}:${err.column}`
    const severity = err.severity === 'error' ? pc.red('error') : pc.yellow('warning')
    console.error(`${severity}: ${err.message}`)
    console.error(`  ${pc.blue('-->')} ${location}`)
    if (err.source) {
      console.error(`  ${pc.blue('|')} ${err.source}`)
    }
    if (err.suggestion) {
      console.error(`  ${pc.blue('=')} ${pc.bold('help')}: ${err.suggestion}`)
    }
    console.error()
  }
}

function createTestRunId(): string {
  return process.env.AGENT_QA_RUN_ID ?? generateRunId()
}

function createSuiteRunId(): string {
  return process.env.AGENT_QA_SUITE_QUEUE_ID ?? process.env.AGENT_QA_RUN_ID ?? generateRunId()
}

function printRunId(runId: string | null | undefined): void {
  if (runId) console.log(`Run ID: ${runId}`)
}

function printMemoryStatus(log: { added: number; confirmed: number; deprecated: number; errors: string[]; curatorDuration: number }): void {
  const parts: string[] = []
  if (log.added > 0) parts.push(pc.green(`${log.added} added`))
  if (log.confirmed > 0) parts.push(`${log.confirmed} confirmed`)
  if (log.deprecated > 0) parts.push(pc.yellow(`${log.deprecated} deprecated`))
  if (parts.length === 0) parts.push('no changes')
  const secs = log.curatorDuration >= 1000 ? `${Math.round(log.curatorDuration / 1000)}s` : `${log.curatorDuration}ms`
  console.log(`  ${pc.dim('Memory:')} ${parts.join(', ')} ${pc.dim(`(${secs})`)}`)
  for (const err of log.errors) {
    console.log(`  ${pc.dim('Memory:')} ${pc.yellow(`warning -- ${err}`)}`)
  }
}

function isGlobLikePattern(value: string): boolean {
  return /[*?[{]/.test(value)
}

function classifyRunPattern(pattern: string): WorkspaceFileKind {
  return pattern.includes('.suite.') ? 'suite' : 'test'
}

function matchesCliWorkspacePattern(
  workspace: ResolvedWorkspacePaths,
  kind: WorkspaceFileKind,
  pattern: string,
  record: WorkspaceFileRecord,
): boolean {
  const patternWorkspace = {
    ...workspace,
    testMatch: kind === 'test' ? [pattern] : workspace.testMatch,
    suiteMatch: kind === 'suite' ? [pattern] : workspace.suiteMatch,
  }
  return isWorkspacePathMatch({
    workspace: patternWorkspace,
    kind,
    workspaceRelativePath: record.workspaceRelativePath,
  })
}

async function discoverFilesForCliPatterns(
  workspace: ResolvedWorkspacePaths,
  patterns: string[],
): Promise<{ tests: string[]; suites: string[] }> {
  const testRecords = await discoverWorkspaceFiles({ workspace, kind: 'test' })
  const suiteRecords = await discoverWorkspaceFiles({ workspace, kind: 'suite' })
  const discoveredByKind: Record<WorkspaceFileKind, WorkspaceFileRecord[]> = {
    test: testRecords,
    suite: suiteRecords,
  }
  const selectedByKind: Record<WorkspaceFileKind, Map<string, WorkspaceFileRecord>> = {
    test: new Map(),
    suite: new Map(),
  }
  const seenKinds = new Set<WorkspaceFileKind>()

  for (const pattern of patterns) {
    const kind = classifyRunPattern(pattern)
    seenKinds.add(kind)

    if (isGlobLikePattern(pattern)) {
      for (const record of discoveredByKind[kind]) {
        if (matchesCliWorkspacePattern(workspace, kind, pattern, record)) {
          selectedByKind[kind].set(record.workspaceRelativePath, record)
        }
      }
      continue
    }

    const record = await resolveWorkspaceFileTarget({
      workspace,
      kind,
      filePath: pattern,
      requireExisting: true,
    })
    selectedByKind[kind].set(record.workspaceRelativePath, record)
  }

  if (seenKinds.size > 1) {
    throw new Error('Cannot mix suite files and test patterns in the same run')
  }

  return {
    tests: [...selectedByKind.test.values()].map(record => record.absolutePath),
    suites: [...selectedByKind.suite.values()].map(record => record.absolutePath),
  }
}

function buildHooksArtifact(hooks?: Map<string, HookDefinition>): Array<{ id: string; name: string; runtime?: string; sourcePath?: string }> {
  if (!hooks) return []
  return [...hooks.values()].map((hook) => ({
    id: hook.id,
    name: hook.name,
    runtime: (hook as any).runtime,
    sourcePath: (hook as any).path ?? (hook as any).sourcePath,
  }))
}

async function loadRuntimeSecrets(input: {
  config: AgentQaConfig
  configDir: string
  secretsFilePath?: string
  readFileSync: typeof import('node:fs').readFileSync
  existsSync: typeof import('node:fs').existsSync
}): Promise<RuntimeSecretsContext> {
  const configuredSecretsFile = (input.config as any).workspace?.secretsFile
  if (typeof configuredSecretsFile !== 'string' || configuredSecretsFile.trim().length === 0) {
    console.error(pc.red('Error: workspace.secretsFile is required. Run `agent-qa init` or set it in agent-qa.config.yaml.'))
    process.exit(1)
  }

  const secretsPath = input.secretsFilePath ?? resolvePath(input.configDir, configuredSecretsFile)
  if (!input.existsSync(secretsPath)) {
    console.error(pc.red(`Error: Secrets file not found: ${secretsPath}`))
    console.error(pc.dim('Create the file before running tests. It may be empty, but it must exist.'))
    process.exit(1)
  }

  let secretsContent: string
  try {
    secretsContent = input.readFileSync(secretsPath, 'utf-8')
  } catch {
    console.error(pc.red(`Error: Secrets file could not be read: ${secretsPath}`))
    console.error(pc.dim('Check the path and file permissions before running tests.'))
    process.exit(1)
  }

  try {
    const { SecretStore, SecretRedactor } = await import('@vostride/agent-qa-runner')
    const secretStore = SecretStore.fromEnvContent(secretsContent)
    return {
      secretStore,
      secretRedactor: new SecretRedactor(secretStore),
      secretsFileMetadata: {
        path: secretsPath,
        status: 'loaded',
        count: secretStore.count(),
      },
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(pc.red(`Error: Secrets file is invalid: ${message}`))
    process.exit(1)
  }
}

function buildRunArtifactContext(input: {
  kind: 'test' | 'suite-parent' | 'suite-child'
  configContent: string
  parsedConfig: unknown
  effectiveConfig: unknown
  envFilePath: string | null
  rawEnvFileContent: string | null
  envFileVars: Record<string, string>
  secretsFileMetadata?: SecretsFileArtifactMetadata | null
  cliVars: Record<string, string>
  inlineVars: Record<string, string>
  hooks?: Map<string, HookDefinition>
  planner: { provider?: string; model?: string }
  verifier: { provider?: string; model?: string }
  platform: 'web' | 'android' | 'ios'
  target: ResolvedTarget
  deviceName?: string
  attributes: RunAttributes
  timeouts: Record<string, unknown>
  cache: Record<string, unknown>
  memory: Record<string, unknown>
  source: Record<string, unknown>
}): { artifact: Record<string, unknown> & { kind: 'test' | 'suite-parent' | 'suite-child' } } {
  return redactAuthStateValue({
    artifact: {
      kind: input.kind,
      config: {
        rawConfigContent: input.configContent,
        parsedConfig: input.parsedConfig,
        effectiveConfig: input.effectiveConfig,
        envFile: {
          path: input.envFilePath,
          content: input.rawEnvFileContent,
          variables: input.envFileVars,
        },
        secretsFile: input.secretsFileMetadata ?? null,
        cliVars: input.cliVars,
        inlineVars: input.inlineVars,
        hooks: buildHooksArtifact(input.hooks),
        model: {
          planner: input.planner,
          verifier: input.verifier,
        },
        runtime: {
          platform: input.platform,
          targetName: input.target.name,
          deviceName: input.deviceName,
        },
        timeouts: input.timeouts,
        cache: input.cache,
        memory: input.memory,
      },
      source: input.source,
      metadata: {
        attributes: input.attributes,
      },
    },
  }) as { artifact: Record<string, unknown> & { kind: 'test' | 'suite-parent' | 'suite-child' } }
}

export async function resolveDeviceAndFarmSession(
  config: AgentQaConfig,
  deviceName: string | undefined,
  testPlatform: 'web' | 'android' | 'ios',
  testName: string,
  testTimeout?: number,
  preResolvedDevice?: ResolvedDevice,
  localBindingsOverride?: ReturnType<typeof loadLocalBindings>,
  mobileResolved?: ResolvedMobileRunConfig,
): Promise<{ resolvedDevice?: ResolvedDevice; farmSession?: PlatformConfig['farmSession'] }> {
  if (!deviceName || testPlatform === 'web') return {}

  const localBindings = localBindingsOverride ?? loadLocalBindings()
  const resolved = preResolvedDevice ?? resolveDevice(config, deviceName, localBindings)

  if (resolved.transport === 'local') {
    return { resolvedDevice: resolved }
  }

  const credentials = resolveProviderCredentials(resolved.transport, localBindings)
  const { getProvider, registerAllProviders } = await import('@vostride/agent-qa-core')
  registerAllProviders()
  const provider = getProvider(resolved.transport)
  if (!provider) {
    throw new Error(`Farm provider "${resolved.transport}" not found. Available: browserstack`)
  }
  const browserstackApp = mobileResolved?.app.install?.browserstack
  if (!browserstackApp && hasNativeAppIdentity(mobileResolved) && !isBrowserMode(resolved.match)) {
    throw new MobileSetupError({
      category: 'app-install',
      message: `BrowserStack native app target "${mobileResolved?.targetName ?? 'unknown'}" requires app.browserstack; app.path is local-only and is not used as a BrowserStack fallback.`,
      platform: resolved.platform,
      targetName: mobileResolved?.targetName,
      deviceName: resolved.name,
      appId: mobileResolved?.app.deepLinkAppId,
      sourceTrace: mobileResolved?.sourceTrace,
    })
  }
  let farmSession: PlatformConfig['farmSession']
  try {
    farmSession = await provider.resolveMobileCapabilities({
      match: resolved.match,
      platform: resolved.platform,
      credentials,
      testName,
      testTimeout,
      app: browserstackApp,
      appState: mobileResolved?.appState,
      appBaseDir: mobileResolved?.app.install?.browserstackBaseDir,
      appSourceTrace: mobileResolved?.sourceTrace,
    })
  } catch (err) {
    if (err instanceof MobileSetupError) throw err
    if (browserstackApp) {
      throw new MobileSetupError({
        category: 'app-install',
        message: `Failed to resolve BrowserStack app reference: ${err instanceof Error ? err.message : String(err)}`,
        platform: resolved.platform,
        targetName: mobileResolved?.targetName,
        deviceName: resolved.name,
        appId: browserstackApp,
        cause: err,
      })
    }
    throw err
  }
  return { resolvedDevice: resolved, farmSession }
}

function isBrowserMode(match: Record<string, unknown>): boolean {
  return typeof match.browserName === 'string' && match.browserName.trim().length > 0
}

function hasNativeAppIdentity(mobileResolved?: ResolvedMobileRunConfig): boolean {
  const app = mobileResolved?.app
  return Boolean(app?.bundleId || app?.appPackage || app?.appActivity || app?.deepLinkAppId)
}

function wrapMobileSetupError(err: unknown): never {
  if (err instanceof MobileSetupError) {
    throw new Error(`${err.category}: ${err.message}`)
  }
  throw err
}

function resolveMobileRunOrThrow(input: Parameters<typeof resolveMobileRunConfig>[0]): ResolvedMobileRunConfig {
  try {
    return resolveMobileRunConfig(input)
  } catch (err) {
    wrapMobileSetupError(err)
  }
}

function getSelectedAuthStateUse(use: Record<string, unknown> | undefined): NormalizedAuthStateUse | undefined {
  return normalizeAuthStateUse(use)
}

async function resolveSelectedAuthStateForRun(input: {
  config: AgentQaConfig
  configDir: string
  resolvedTarget: ResolvedTarget
  authState: NormalizedAuthStateUse | undefined
}): Promise<ResolvedAuthStateForRun | undefined> {
  if (!input.authState || input.authState.load === false) return undefined
  try {
    return await resolveAuthStateForRun({
      configDir: input.configDir,
      authStateDir: input.config.services?.authState?.dir,
      targetName: input.resolvedTarget.name,
      stateName: input.authState.name,
      target: { platform: input.resolvedTarget.platform },
    })
  } catch (err) {
    console.error(pc.red(`Error: ${err instanceof Error ? err.message : String(err)}`))
    process.exit(2)
  }
}

function resolveAuthStateCapturePathsForRun(input: {
  config: AgentQaConfig
  configDir: string
  resolvedTarget: ResolvedTarget
  authState: NormalizedAuthStateUse | undefined
}): ResolvedAuthStatePaths | undefined {
  if (input.authState?.capture !== true) return undefined
  try {
    return resolveAuthStatePaths({
      configDir: input.configDir,
      authStateDir: input.config.services?.authState?.dir,
      targetName: input.resolvedTarget.name,
      stateName: input.authState.name,
      target: { platform: input.resolvedTarget.platform },
    })
  } catch (err) {
    console.error(pc.red(`Error: ${err instanceof Error ? err.message : String(err)}`))
    process.exit(2)
  }
}

function formatAuthStateCaptureFailure(paths: ResolvedAuthStatePaths): string {
  return `Could not save auth state "${paths.stateName}" for target "${paths.targetName}".`
}

/**
 * Read a persisted storage-state payload JSON best-effort (D-06 masking seed source). A missing or
 * unreadable file degrades to `undefined` — never a run failure; the source simply contributes no
 * seed. Used to seed the run MaskingContext from statically-resolved auth-state at run start and to
 * register mid-run captured auth values.
 */
async function readAuthStatePayloadBestEffort(storageStatePath: string | undefined): Promise<unknown> {
  if (!storageStatePath) return undefined
  try {
    const { readFile } = await import('node:fs/promises')
    return JSON.parse(await readFile(storageStatePath, 'utf-8')) as unknown
  } catch {
    return undefined
  }
}

/**
 * Register every cookie/localStorage value from an auth-state payload into the run MaskingContext
 * (D-06). Additive; the same stable per-run placeholders. A token minted by a mid-run login flow is
 * protected for every subsequent egress once registered here.
 */
function registerAuthStateIntoMaskingContext(ctx: RunMaskingContext, payload: unknown): void {
  for (const value of extractAuthStateSensitiveStrings(payload)) ctx.register(value)
}

function getStorageStateContext(adapter: PlatformAdapter): { storageState: (options?: { indexedDB?: boolean }) => Promise<unknown> } | null {
  const maybeGetPage = (adapter as { getPage?: () => unknown }).getPage
  if (typeof maybeGetPage !== 'function') return null

  const page = maybeGetPage.call(adapter)
  if (!page || typeof page !== 'object') return null

  const maybeContext = (page as { context?: () => unknown }).context
  if (typeof maybeContext !== 'function') return null

  const context = maybeContext.call(page)
  if (!context || typeof context !== 'object') return null

  const storageState = (context as { storageState?: (options?: { indexedDB?: boolean }) => Promise<unknown> }).storageState
  if (typeof storageState !== 'function') return null

  return {
    storageState: storageState.bind(context),
  }
}

async function captureAuthStateForRun(input: {
  adapter: PlatformAdapter
  paths: ResolvedAuthStatePaths
}): Promise<ResolvedAuthStateForRun> {
  const context = getStorageStateContext(input.adapter)
  if (!context) {
    throw new Error('Web auth-state capture requires a Playwright browser context.')
  }

  const payload = await context.storageState({ indexedDB: true })
  const capturedAt = new Date().toISOString()
  const metadata: AuthStateMetadata = {
    version: AUTH_STATE_SCHEMA_VERSION,
    kind: 'web' as const,
    target: input.paths.targetName,
    name: input.paths.stateName,
    capturedAt,
  }
  const { writeAuthStateFiles } = await import('@vostride/agent-qa-core')
  await writeAuthStateFiles(input.paths, { payload, metadata })

  return {
    version: metadata.version,
    kind: metadata.kind,
    targetName: metadata.target,
    stateName: metadata.name,
    capturedAt: metadata.capturedAt,
    storageStatePath: input.paths.payloadPath,
  }
}

async function executeSuites(
  suiteFiles: string[],
  opts: RunOptions,
  config: AgentQaConfig,
  globalOpts: { config?: string; verbose?: boolean; quiet?: boolean; logLevel?: string },
  configContent: string,
  effectiveLogLevel: string,
  variableContext?: {
    envFileVars: Record<string, string>
    inlineVars: Record<string, string>
    cliVars: Record<string, string>
    rawEnvFileContent?: string | null
    resolvedEnvFilePath?: string | null
    secretStore?: SecretStore
    secretRedactor?: SecretRedactor
    secretsFileMetadata?: SecretsFileArtifactMetadata | null
    userRunAttributes: RunAttributes
    inheritedRunAttributes?: RunAttributes
  },
  hooksContext?: { resolvedHooks: Map<string, HookDefinition>; sandboxOptions: SandboxRunnerOptions },
): Promise<number> {
  const { parseSuiteFile, parseTestFile, executeSuiteMember,
    MultiReporter, createAnalyticsRunSubscriber,
  } = await import('@vostride/agent-qa-core')
  const { LLMPlanner, LLMVerifier, startRun, mapVerdictToExitCode } = await import('@vostride/agent-qa-runner')
  const { readFile } = await import('node:fs/promises')
  const path = await import('node:path')

  const configFilePath = globalOpts.config ?? 'agent-qa.config.yaml'
  const configDir = path.dirname(path.resolve(configFilePath))

  const activeSuiteDbs = new Set<any>()
  let shutdownRequested = false
  // SESSION-04 (D-01/D-03): the CLI owns the ONE run-level SIGINT. When a RunSession is live the
  // handler routes the abort into `session.cancel()` (skip the rest, aggregate `cancelled`); core's
  // per-test SIGINT registration is suppressed because the executor threads ctx.abortSignal (D-03).
  let activeRunSession: { cancel(): void } | undefined
  // SESSION-04 force-exit backstop (Plan 361-13 Task 3): armed on cancel, cleared after
  // `await session.done`. Fires only if `done` is genuinely un-settleable so the CLI can never hang.
  let graceTimer: ReturnType<typeof setTimeout> | undefined
  // SEAM-01/03 (362-06): the ONE run MaskingContext + per-run SafetyHookRunner, built at the runId
  // mint below and captured here so the earlier-defined member/teardown closures (which only execute
  // after startRun) resolve the run bundle at call time. `runMaskingContext` also feeds the D-06
  // mid-run auth-state registration at teardown capture and the WM-flush report mask.
  let runMaskingContext: RunMaskingContext | undefined
  let runSafetyHooks: SafetyHookRunner | undefined

  // Best-effort suite-DB running→cancelled sweep, invoked by the controller on the first signal.
  const sweepSuiteDbs = () => {
    for (const activeSuiteDb of activeSuiteDbs) {
      try {
        const now = new Date().toISOString()
        const runningRuns = activeSuiteDb.getRuns({ status: 'running' })
          .filter((run: any) => run.suiteId && !run.parentRunId)
        for (const run of runningRuns) {
          activeSuiteDb.updateRun(run.id, { status: 'cancelled', endedAt: now })
          const children = activeSuiteDb.getRunsByParent(run.id)
          for (const child of children) {
            if (child.status === 'running') {
              activeSuiteDb.updateRun(child.id, { status: 'cancelled', endedAt: now })
            }
          }
        }
      } catch { /* best-effort cleanup */ }
    }
  }

  // RUNX-02 / D1: route both signals through the controller so a SECOND Ctrl+C HARD force-exits
  // (130) immediately, independent of the grace timer and of any wedged async `done`. The grace-timer
  // arming/unref/clear stays inline here (owned by the caller) so the 361-13 backstop anchors hold.
  const shutdownController = createShutdownController({
    cancel: () => { try { activeRunSession?.cancel() } catch { /* cancel is best-effort */ } },
    exit: (code) => process.exit(code),
    setExitCode: (code) => { shutdownRequested = true; process.exitCode = code },
    armGrace: () => {
      const grace = setTimeout(() => process.exit(130), cancelGraceMs())
      grace.unref?.()
      graceTimer = grace
    },
    sweepSuiteDbs,
  })

  // `on`, not `once`, so a repeated Ctrl+C reaches the controller's hard force-exit path.
  process.on('SIGINT', shutdownController.handleSignal)
  process.on('SIGTERM', shutdownController.handleSignal)

  const dashboardCfg = config.services?.dashboard as Record<string, unknown> | undefined
  const reporterSelectionResult = resolveReporterSelection(opts, Boolean(dashboardCfg))
  if (reporterSelectionResult.error) {
    console.error(pc.red(`Error: ${reporterSelectionResult.error}`))
    process.exit(2)
  }
  const reporterSelection = reporterSelectionResult.selection!
  const dashboardEnabled = reporterSelection.dashboard

  const createSuiteDashboardResources = async (): Promise<{ dashboardDb?: any; logStorage?: any }> => {
    if (!dashboardEnabled) return {}
    try {
      const { DashboardDatabase, resolveDashboardDbPath } = await import('@vostride/agent-qa-dashboard')
      const configuredDbPath = dashboardCfg?.dbPath as string | undefined
      const dashboardDb = new DashboardDatabase({
        dbPath: resolveDashboardDbPath({ configDir, configuredDbPath }),
      })
      activeSuiteDbs.add(dashboardDb)
      return { dashboardDb, logStorage: dashboardDb }
    } catch (err) {
      console.warn(pc.yellow(`Warning: Could not load dashboard reporter: ${err instanceof Error ? err.message : String(err)}`))
      return {}
    }
  }

  const closeSuiteDashboardDb = (dashboardDb?: any) => {
    if (!dashboardDb) return
    activeSuiteDbs.delete(dashboardDb)
    dashboardDb.close()
  }

  // A suite fully resolved by the composition root, ready to contribute its members to the ONE
  // RunSession (D-04). Suite-level orchestration (setup hooks + adapter setup + nav / teardown +
  // auth capture + reporter end-calls) is captured as the lazy lifecycle `setup`/`teardown` the
  // shell drives when a member of this suite first runs / when the run crosses a suite boundary.
  type PreparedSuite = {
    suiteFile: string
    suite: SuiteDefinition
    suiteKey: string
    suiteConfig: RunSuiteConfig
    testEntries: [TestDefinition, string][]
    suiteMembers: Array<Record<string, unknown>>
    reporter: InstanceType<typeof MultiReporter> | undefined
    suiteRunId: string
    suiteArtifact: Record<string, unknown> | undefined
    memoryEnabled: boolean
    memoryRoot: string
    product: string | undefined
    testFileContents: string[]
    // Mutable run-state filled during execution.
    suiteHookVars: Record<string, string>
    suiteSandboxOptions: RunSuiteConfig['sandboxOptions']
    results: TestResult[]
    perMemberDigests: ConfigDigests[]
    bootstrapFailure: string | undefined
    // Teardown-time composition side effects (the old runSuite `.finally`).
    dashboardDb: any
    suiteWorkingMemory: WorkingMemoryStore
    authStateStoragePath: string | undefined
    suiteAttributes: RunAttributes
  }

  const prepareSuite = async (suiteFile: string, suite: SuiteDefinition): Promise<PreparedSuite> => {
    const suiteFailureAttributes = resolveCliRunAttributes(
      variableContext?.userRunAttributes ?? {},
      'local',
      variableContext?.inheritedRunAttributes,
    )
    const { dashboardDb, logStorage } = await createSuiteDashboardResources()
    let lastSuiteRunId: string | undefined
    let suiteFileContent = ''
    try { suiteFileContent = await readFile(suiteFile, 'utf-8') } catch { /* best-effort */ }

    const mergedUse = mergeUseBlocks(
      config.use as Record<string, unknown>,
      suite.use as Record<string, unknown> | undefined,
      undefined,
      {},
    )
    const suiteAuthStateUse = getSelectedAuthStateUse(mergedUse as Record<string, unknown>)

    const testEntries: [TestDefinition, string][] = []
    const suiteMembers: Array<Record<string, unknown>> = []
    for (const { test: relativePath, id: suiteEntryId } of suite.tests) {
      if (!isPathInsideDir(relativePath, configDir)) {
        console.error(pc.red(`Path traversal rejected: ${relativePath}`))
        const runId = createSuiteRunId()
        if (dashboardDb) {
          const now = new Date().toISOString()
          const existingRunId = process.env.AGENT_QA_RUN_ID ?? process.env.AGENT_QA_SUITE_QUEUE_ID
          if (existingRunId) {
            dashboardDb.updateRun(existingRunId, {
              name: `Path traversal rejected in suite`,
              status: 'failed',
              duration: 0,
              endedAt: now,
              attributes: suiteFailureAttributes,
              failureSummary: `Path traversal rejected: ${relativePath}`,
              errorLog: `Path traversal rejected: ${relativePath}`,
            })
          } else {
            dashboardDb.insertRun({
              id: runId,
              name: `Path traversal rejected in suite`,
              status: 'failed',
              duration: 0,
              startedAt: now,
              endedAt: now,
              attributes: suiteFailureAttributes,
              failureSummary: `Path traversal rejected: ${relativePath}`,
            })
            dashboardDb.updateRun(runId, { errorLog: `Path traversal rejected: ${relativePath}` })
          }
          closeSuiteDashboardDb(dashboardDb)
        }
        printRunId(runId)
        printRunAttributes(suiteFailureAttributes)
        process.exit(2)
      }

      const absolutePath = path.resolve(configDir, relativePath)
      const fileContent = await readFile(absolutePath, 'utf-8')
      const parseResult = parseTestFile(fileContent, absolutePath)
      if (parseResult.errors.length > 0) {
        console.error(pc.red(`Parse errors in ${relativePath}:`))
        formatParseErrors(parseResult.errors)
        const runId = createSuiteRunId()
        if (dashboardDb) {
          const now = new Date().toISOString()
          const errorLines: string[] = []
          for (const e of parseResult.errors) {
            const location = `${e.file}:${e.line}:${e.column}`
            errorLines.push(`${e.severity}: ${e.message}\n  --> ${location}`)
          }
          const existingRunId = process.env.AGENT_QA_RUN_ID ?? process.env.AGENT_QA_SUITE_QUEUE_ID
          if (existingRunId) {
            dashboardDb.updateRun(existingRunId, {
              name: `Parse errors in suite "${suite.name}"`,
              status: 'failed',
              duration: 0,
              endedAt: now,
              attributes: suiteFailureAttributes,
              failureSummary: `${parseResult.errors.length} parse error(s) in ${relativePath}`,
              errorLog: errorLines.join('\n'),
            })
          } else {
            dashboardDb.insertRun({
              id: runId,
              name: `Parse errors in suite "${suite.name}"`,
              status: 'failed',
              duration: 0,
              startedAt: now,
              endedAt: now,
              attributes: suiteFailureAttributes,
              failureSummary: `${parseResult.errors.length} parse error(s) in ${relativePath}`,
            })
            dashboardDb.updateRun(runId, { errorLog: errorLines.join('\n') })
          }
          closeSuiteDashboardDb(dashboardDb)
        }
        printRunId(runId)
        printRunAttributes(suiteFailureAttributes)
        process.exit(2)
      }
      if (parseResult.tests.length === 0) {
        console.error(pc.red(`No test definition found in ${relativePath}`))
        const runId = createSuiteRunId()
        if (dashboardDb) {
          const now = new Date().toISOString()
          const existingRunId = process.env.AGENT_QA_RUN_ID ?? process.env.AGENT_QA_SUITE_QUEUE_ID
          if (existingRunId) {
            dashboardDb.updateRun(existingRunId, {
              name: `No test definition in suite "${suite.name}"`,
              status: 'failed',
              duration: 0,
              endedAt: now,
              attributes: suiteFailureAttributes,
              failureSummary: `No test definition found in ${relativePath}`,
              errorLog: `No test definition found in ${relativePath}`,
            })
          } else {
            dashboardDb.insertRun({
              id: runId,
              name: `No test definition in suite "${suite.name}"`,
              status: 'failed',
              duration: 0,
              startedAt: now,
              endedAt: now,
              attributes: suiteFailureAttributes,
              failureSummary: `No test definition found in ${relativePath}`,
            })
            dashboardDb.updateRun(runId, { errorLog: `No test definition found in ${relativePath}` })
          }
          closeSuiteDashboardDb(dashboardDb)
        }
        printRunId(runId)
        printRunAttributes(suiteFailureAttributes)
        process.exit(2)
      }

      const testDef = parseResult.tests[0]
      const childAuthStateUse = getSelectedAuthStateUse(testDef.use as Record<string, unknown> | undefined)
      // The suite owns the shared browser context; child authState can only repeat the same logical state.
      if (suiteAuthStateUse && childAuthStateUse && childAuthStateUse.name !== suiteAuthStateUse.name) {
        console.error(pc.red(`Suite auth state "${suiteAuthStateUse.name}" conflicts with child test auth state "${childAuthStateUse.name}". Use one primary auth state per suite.`))
        process.exit(2)
      }
      if (testDef['test-id'] && testDef['test-id'] !== suiteEntryId) {
        const mismatchMsg = `ID mismatch in suite "${suite.name}": test file ${relativePath} has test-id "${testDef['test-id']}" but suite entry specifies id "${suiteEntryId}"`
        console.error(pc.red(mismatchMsg))
        const runId = createSuiteRunId()
        if (dashboardDb) {
          const now = new Date().toISOString()
          const existingRunId = process.env.AGENT_QA_RUN_ID ?? process.env.AGENT_QA_SUITE_QUEUE_ID
          if (existingRunId) {
            dashboardDb.updateRun(existingRunId, {
              name: `ID mismatch in suite "${suite.name}"`,
              status: 'failed',
              duration: 0,
              endedAt: now,
              attributes: suiteFailureAttributes,
              failureSummary: mismatchMsg,
              errorLog: mismatchMsg,
            })
          } else {
            dashboardDb.insertRun({
              id: runId,
              name: `ID mismatch in suite "${suite.name}"`,
              status: 'failed',
              duration: 0,
              startedAt: now,
              endedAt: now,
              attributes: suiteFailureAttributes,
              failureSummary: mismatchMsg,
            })
            dashboardDb.updateRun(runId, { errorLog: mismatchMsg })
          }
          closeSuiteDashboardDb(dashboardDb)
        }
        printRunId(runId)
        printRunAttributes(suiteFailureAttributes)
        process.exit(2)
      }

      suiteMembers.push({
        index: suiteMembers.length,
        ref: { test: relativePath, id: suiteEntryId },
        filePath: absolutePath,
        testId: testDef['test-id'] ?? null,
        name: testDef.name,
        target: testDef.target ?? null,
        rawYaml: fileContent,
        resolvedDefinition: testDef,
        loadStatus: 'loaded',
      })
      testEntries.push([testDef, absolutePath])
    }

    const suiteResolvedTarget = suite.target
      ? resolveTarget(config, suite.target!)
      : resolveTarget(config, testEntries[0][0].target!)
    const suitePlatform: 'web' | 'android' | 'ios' = suiteResolvedTarget.platform

    const suiteAuthState = await resolveSelectedAuthStateForRun({
      config,
      configDir,
      resolvedTarget: suiteResolvedTarget,
      authState: suiteAuthStateUse,
    })
    const suiteAuthStateCapturePaths = resolveAuthStateCapturePathsForRun({
      config,
      configDir,
      resolvedTarget: suiteResolvedTarget,
      authState: suiteAuthStateUse,
    })
    const suiteEffectiveCacheEnabled = !opts.disableCache && (mergedUse as Record<string, unknown>).cache !== false
    let suiteDeviceName = opts.device ?? (mergedUse.device as string | undefined)

    if ((suitePlatform === 'android' || suitePlatform === 'ios') && !suiteDeviceName) {
      const childDeviceNames = testEntries.map(([testDef]) => {
        const device = (testDef.use as Record<string, unknown> | undefined)?.device
        return typeof device === 'string' && device.trim().length > 0 ? device.trim() : undefined
      })
      const missingChildDevice = childDeviceNames.some((device) => !device)
      const uniqueChildDevices = [...new Set(childDeviceNames.filter((device): device is string => Boolean(device)))]

      if (missingChildDevice || uniqueChildDevices.length === 0) {
        throw new Error(`Select a device for this mobile suite "${suite.name}" with suite use.device or every child test use.device.`)
      }
      if (uniqueChildDevices.length > 1) {
        throw new Error(`Mobile suite child tests use multiple devices (${uniqueChildDevices.join(', ')}); set suite use.device or split the suite.`)
      }
      suiteDeviceName = uniqueChildDevices[0]
    }
    const deviceName = suiteDeviceName

    const suiteTimeoutConfig = mergedUse.timeout as Record<string, unknown> | undefined
    const testTimeouts = {
      step: typeof suiteTimeoutConfig?.step === 'number' ? suiteTimeoutConfig.step : 30000,
      test: typeof suiteTimeoutConfig?.test === 'number' ? suiteTimeoutConfig.test : 120000,
      navigation: typeof suiteTimeoutConfig?.navigation === 'number' ? suiteTimeoutConfig.navigation : 30000,
    }

    const suiteLocalBindings = suitePlatform === 'android' || suitePlatform === 'ios'
      ? loadLocalBindings()
      : null
    let mobileResolved: ResolvedMobileRunConfig | undefined
    let resolvedDevice: ResolvedDevice | undefined
    let farmSession: PlatformConfig['farmSession'] | undefined
    if (suitePlatform === 'android' || suitePlatform === 'ios') {
      mobileResolved = resolveMobileRunOrThrow({
        config: config as unknown as Record<string, any>,
        targetName: suiteResolvedTarget.name,
        platform: suitePlatform,
        explicitDeviceName: opts.device,
        useDeviceName: suiteDeviceName,
        appState: (mergedUse.mobile as Record<string, unknown> | undefined)?.appState as 'preserve' | 'reset' | undefined,
        localBindings: suiteLocalBindings,
        configFilePath: path.resolve(configFilePath),
        localConfigFilePath: suiteLocalBindings?.filePath,
        appiumUrl: process.env.AGENT_QA_APPIUM_URL,
      })
      const resolved = await resolveDeviceAndFarmSession(
        config, mobileResolved.deviceName, suitePlatform,
        `Suite: ${suite.name} — ${new Date().toISOString().slice(0, 19)}`,
        testTimeouts.test,
        mobileResolved.device,
        suiteLocalBindings,
        mobileResolved,
      )
      resolvedDevice = resolved.resolvedDevice
      farmSession = resolved.farmSession
    }

    const useFarm = resolvedDevice?.transport !== undefined && resolvedDevice.transport !== 'local'
    const suiteAttributes = resolveCliRunAttributes(
      variableContext?.userRunAttributes ?? {},
      resolveRunnerAttribute(resolvedDevice?.transport),
      variableContext?.inheritedRunAttributes,
    )
    writeRunAttributesToEnv(suiteAttributes)

    // Auto-start Appium for mobile platforms
    if ((suitePlatform === 'ios' || suitePlatform === 'android') && !useFarm) {
      try {
        const appiumUrl = await acquireAppium(effectiveLogLevel)
        if (mobileResolved) {
          mobileResolved = { ...mobileResolved, appium: { url: appiumUrl, managed: !process.env.AGENT_QA_APPIUM_URL } }
        }
      } catch (err) {
        throw new MobileSetupError({
          category: 'appium-startup',
          message: `Could not auto-start Appium: ${err instanceof Error ? err.message : String(err)}`,
          platform: suitePlatform,
          targetName: suiteResolvedTarget.name,
          deviceName,
          cause: err,
        })
      }
    }

    const adapter = await createPlatformAdapter(suitePlatform)

    const resolvedTarget = suite.target
      ? resolveTarget(config, suite.target)
      : testEntries[0][0].target
        ? resolveTarget(config, testEntries[0][0].target)
        : undefined

    const suiteBrowser = (mergedUse.browser as Record<string, unknown> | undefined) ?? config.use?.browser
    const suiteLogCapture = (mergedUse.logCapture as Record<string, unknown> | undefined) ?? (config as any).use?.logCapture
    const platformConfig = buildPlatformConfig(suitePlatform, resolvedDevice, testTimeouts, suiteBrowser as any, suiteLogCapture, farmSession, mobileResolved)
    platformConfig.authState = suiteAuthState
    platformConfig.verbose = effectiveLogLevel === 'debug'
    if (opts.headless !== undefined && platformConfig.browser) {
      platformConfig.browser.headless = opts.headless
    }

    const recordingEnabled = opts.record ?? config.services?.recording?.enabled ?? false
    if (recordingEnabled) {
      const recordingCfg = config.services?.recording as Record<string, unknown> | undefined
      platformConfig.recording = {
        enabled: true,
        videoDir: resolveDashboardVideoDir(config, configDir, dashboardEnabled),
        videoSize: recordingCfg?.videoSize as { width: number; height: number } | undefined,
      }
    }

    // Resolve LLM models
    const { planner: plannerCfg, verifier: verifierCfg, configName } = resolveLLMModels(config)
    const resolvedAuth = await resolveModelAuth(configName, plannerCfg)
    const { profile: plannerProfile, auth: plannerAuth } = toModelProfileAndAuth(plannerCfg, resolvedAuth)
    const { profile: verifierProfile, auth: verifierAuth } = toModelProfileAndAuth(verifierCfg, resolvedAuth)
    process.env.AGENT_QA_LLM_MODEL = plannerCfg.model
    process.env.AGENT_QA_LLM_PROVIDER = plannerCfg.provider

    const plannerModel = createModel(plannerProfile, plannerAuth)
    const verifierModel = createModel(verifierProfile, verifierAuth)
    // D-04 lazy thunk: resolveCapabilities re-reads the profile per call so a mid-run
    // overflow-driven window shrink is picked up on the next turn. Separate instances per
    // role (planner vs verifier) so each owns its own cache anchor (D-11).
    const plannerAccounting = createTokenAccounting({ getCapabilities: () => resolveCapabilities(plannerProfile) })
    const verifierAccounting = createTokenAccounting({ getCapabilities: () => resolveCapabilities(verifierProfile) })

    const { LogManager } = await import('@vostride/agent-qa-core')

    const logger = new LogManager({
      runId: process.env.AGENT_QA_RUN_ID || undefined,
      displayLevel: effectiveLogLevel as any,
      storage: logStorage,
      ndjson: process.env.AGENT_QA_LIVE_EVENTS === 'true',
      redactor: variableContext?.secretRedactor,
    })

    let agentRulesContent: string | undefined
    const agentRulesPath = (config as any).workspace?.agentRules
    if (agentRulesPath) {
      const { readFile: readFileAsync } = await import('node:fs/promises')
      const resolvedRulesPath = path.resolve(configDir, agentRulesPath)
      try {
        agentRulesContent = await readFileAsync(resolvedRulesPath, 'utf-8')
      } catch { /* agent rules file not found — ignore */ }
    }
    let suiteEffectiveRules = agentRulesContent ?? ''
    if (suiteLogCapture?.console === false) {
      suiteEffectiveRules += '\nConsole log capture is DISABLED for this test run. The readConsoleLogs action will return no data. If a test step explicitly requires reading console logs, use stepFailed to fail the step — do not silently pass with empty data.'
    }
    if (suiteLogCapture?.network === false) {
      suiteEffectiveRules += '\nNetwork log capture is DISABLED for this test run. The readNetworkLogs action will return no data. If a test step explicitly requires reading network logs, use stepFailed to fail the step — do not silently pass with empty data.'
    }
    const planner = new LLMPlanner(plannerModel, suitePlatform, logger.createScopedLogger('planner'), suiteEffectiveRules || undefined, plannerAccounting)
    const verifier = new LLMVerifier(verifierModel, verifierAccounting)

    // 363-09 (D-01 clean cut, CLI side): the v1 Reporter constructions are GONE. The bus subscribers
    // (console unmasks; junit + wire stay masked; dashboard ingest; analytics) are attached at the ONE
    // run-level startRun site below via `attachRunSubscribers`. This empty list keeps core's internal
    // MultiReporter inert (Plan 11 deletes it) and threads no reporter into the runner config.
    const reporters: never[] = []

    // Wire the redesigned action cache (runner-local FsActionCache + branch policy), injected into
    // the runner loop's cache port. The loop's masking port now carries the ONE run MaskingContext
    // (assigned at the runId mint below), no longer the cache-context identity mint (SEAM-01/D-09).
    let actionCache: import('@vostride/agent-qa-runner').ActionPlanCache | undefined
    if (suiteEffectiveCacheEnabled) {
      const { resolve } = await import('node:path')
      const ctx = await buildActionCacheContext({
        cacheDir: resolve(configDir, config.services?.cache?.dir ?? RUNTIME_CACHE_DIR),
        disableCache: false,
        saveCache: opts.saveCache === true,
      })
      actionCache = ctx.cache
    }

    // WM-01/WM-02: ONE run-scoped working-memory store spans all suite member tests; threaded
    // into each test's runner loop and flushed redacted once at suite end (finally below).
    const suiteWorkingMemory = new WorkingMemoryStore(variableContext?.secretRedactor)

    // D-14 (Phase 360): ONE run-scoped storage-state store (raw-but-local auth persistence) rooted
    // at the run's `.agent-qa` dir, mirroring the FsActionCache rooting idiom. All fs writes live in
    // runner-local (validate:arch storageNeutral); the runner loop records only { name, fingerprint }.
    const suiteStorageState = await buildStorageStateStore(configDir)

    const captureScreenshots = reporterSelection.dashboard || opts.screenshotMode === 'every-step' || Boolean(opts.screenshotDir)

    let suiteMemoryProvider: import('@vostride/agent-qa-core').MemoryProvider | undefined
    const suiteMemoryConfig = config.services?.memory
    const suiteMemoryRoot = resolveMemoryRoot(config, configDir)

    if (opts.memory !== false && suiteMemoryConfig?.enabled !== false) {
      try {
        const { createMemoryProvider } = await import('@vostride/agent-qa-core')
        suiteMemoryProvider = await createMemoryProvider({
          provider: suiteMemoryConfig?.provider ?? 'local',
          memoryRoot: suiteMemoryRoot,
          curatorLockTimeout: suiteMemoryConfig?.curatorLockTimeout,
        })
      } catch (err) {
        console.warn(`  ${pc.dim('Memory:')} init error -- ${(err as Error).message}`)
      }
    }

    const suiteArtifactContext = buildRunArtifactContext({
      kind: 'suite-parent',
      configContent,
      parsedConfig: config,
      effectiveConfig: { ...config, use: mergedUse },
      envFilePath: variableContext?.resolvedEnvFilePath ?? null,
      rawEnvFileContent: variableContext?.rawEnvFileContent ?? null,
      envFileVars: variableContext?.envFileVars ?? {},
      secretsFileMetadata: variableContext?.secretsFileMetadata ?? null,
      cliVars: variableContext?.cliVars ?? {},
      inlineVars: variableContext?.inlineVars ?? {},
      hooks: hooksContext?.resolvedHooks,
      planner: { provider: plannerCfg.provider, model: plannerCfg.model },
      verifier: { provider: verifierCfg.provider, model: verifierCfg.model },
      platform: suitePlatform,
      target: suiteResolvedTarget,
      deviceName,
      attributes: suiteAttributes,
      timeouts: testTimeouts,
      cache: {
        enabled: suiteEffectiveCacheEnabled,
        dir: config.services?.cache?.dir,
        ttl: config.services?.cache?.ttl,
      },
      memory: {
        enabled: opts.memory !== false && suiteMemoryConfig?.enabled !== false,
        curatorEnabled: suiteMemoryConfig?.curatorEnabled,
        provider: suiteMemoryConfig?.provider ?? 'local',
        dir: suiteMemoryConfig?.dir,
      },
      source: {
        kind: 'suite',
        suiteId: (suite as any)['suite-id'] ?? null,
        name: suite.name,
        filePath: suiteFile,
        rawYaml: suiteFileContent || null,
        resolvedDefinition: suite,
        loadStatus: 'loaded',
        members: suiteMembers,
      },
    })

    const suiteConfig: RunSuiteConfig = {
      adapter,
      platformConfig,
      planner,
      verifier,
      cache: suiteEffectiveCacheEnabled ? actionCache : undefined,
      // D-08/Q10: the sharp compressor is constructed at the composition root and injected into
      // every member's runner loop (sharp left core).
      compressor: buildScreenshotCompressor(logger?.createScopedLogger('adapter')),
      // The run MaskingContext is assigned at the runId mint (below) — one source of truth,
      // ungated from cache enablement (SEAM-01/D-09; WM masking + mask-before-cache-key go live).
      masking: undefined,
      workingMemory: suiteWorkingMemory,
      storageState: suiteStorageState,
      plannerModel,
      verifierModel,
      reporters,
      captureScreenshots,
      screenshotMode: (opts.screenshotMode as 'failure' | 'every-step') ?? 'failure',
      timeouts: testTimeouts,
      logger,
      configContent,
      suiteFileContent,
      envFileVars: variableContext?.envFileVars,
      inlineVars: variableContext?.inlineVars,
      cliVars: variableContext?.cliVars,
      resolvedHooks: hooksContext?.resolvedHooks,
      sandboxOptions: hooksContext?.sandboxOptions,
      logCapture: suiteLogCapture,
      accessibility: config.services?.accessibility,
      accessibilityCheck: runWebAccessibilityCheck,
      vision: resolveVisionConfig(config.services?.vision),
      // D-11: resolve the vision gate once per run at the composition root and
      // thread it structurally into the loop (undeclared vision => full capture).
      visionGate: resolveVisionGate({ vision: plannerCfg.vision ?? true }),
      memoryProvider: suiteMemoryProvider,
      memoryConfig: suiteMemoryConfig,
      memoryRoot: suiteMemoryRoot,
      product: resolvedTarget?.product,
      authStateCapture: suiteAuthStateCapturePaths
        ? {
            capture: () => captureAuthStateForRun({ adapter, paths: suiteAuthStateCapturePaths }),
            failureSummary: formatAuthStateCaptureFailure(suiteAuthStateCapturePaths),
          }
        : undefined,
      createAdapter: () => createPlatformAdapter(suitePlatform),
      resolveUrl: (targetName: string) => {
        try { return resolveTarget(config, targetName).url } catch { return undefined }
      },
      onCuratorComplete: dashboardDb ? (_testName: string, memoryLog: any) => {
        if (lastSuiteRunId) {
          try {
            dashboardDb.updateRun(lastSuiteRunId, { memoryLog: JSON.stringify(memoryLog) })
          } catch { /* DB write failure must not fail the test */ }
        }
      } : undefined,
    }
    ;(suiteConfig as any).artifactContext = suiteArtifactContext.artifact
    ;(suiteConfig as any).secretStore = variableContext?.secretStore
    ;(suiteConfig as any).secretRedactor = variableContext?.secretRedactor
    ;(suiteConfig as any).secretsFileMetadata = variableContext?.secretsFileMetadata

    // Suite-level run-scoped values runSuite used to resolve internally, now resolved at the
    // composition root and threaded into executeSuiteMember (D-01). The suite-level orchestration
    // (setup hooks + adapter.setup + nav / teardown + auth capture + reporter end-calls) runs from
    // the lazy lifecycle hooks the shell drives (suiteSetup/suiteTeardown below).
    const reporter = suiteConfig.reporters?.length ? new MultiReporter(suiteConfig.reporters) : undefined
    const preparedSuiteRunId = process.env.AGENT_QA_SUITE_QUEUE_ID ?? generateRunId()
    const preparedSuiteArtifact = (suiteConfig.artifactContext as { artifact?: Record<string, unknown> } | undefined)?.artifact
      ?? (suiteConfig.artifactContext as Record<string, unknown> | undefined)
    const initialSuiteSandboxOptions = suiteConfig.sandboxOptions && suiteConfig.platformConfig.authState
      ? { ...suiteConfig.sandboxOptions, authState: suiteConfig.platformConfig.authState }
      : suiteConfig.sandboxOptions
    const memoryEnabledForSuite = suiteConfig.memoryConfig?.enabled !== false && !!suiteConfig.memoryProvider

    return {
      suiteFile,
      suite,
      suiteKey: suiteFile,
      suiteConfig,
      testEntries,
      suiteMembers,
      reporter,
      suiteRunId: preparedSuiteRunId,
      suiteArtifact: preparedSuiteArtifact,
      memoryEnabled: memoryEnabledForSuite,
      memoryRoot: suiteConfig.memoryRoot ?? suiteMemoryRoot,
      product: resolvedTarget?.product,
      testFileContents: suiteMembers.map((m) => (typeof m.rawYaml === 'string' ? m.rawYaml : '')),
      suiteHookVars: {},
      suiteSandboxOptions: initialSuiteSandboxOptions,
      results: [],
      perMemberDigests: [],
      bootstrapFailure: undefined,
      dashboardDb,
      suiteWorkingMemory,
      authStateStoragePath: suiteAuthState?.storageStatePath,
      suiteAttributes,
    }
  }

  // Suite-level SETUP the shell runs on the first member of each suite (lazy lifecycle). Fires
  // onSuiteStart/onRunStart, runs suite setup hooks (→ suiteHookVars), then adapter.setup + the
  // suite-URL navigation. A hook/nav failure records `bootstrapFailure` so the member closures
  // synthesize a bootstrap failure (the shell then group-fail-fasts the remaining members).
  const suiteSetup = async (prepared: PreparedSuite): Promise<void> => {
    const { suite, suiteConfig, reporter, suiteRunId, suiteArtifact, testEntries } = prepared

    await reporter?.onSuiteStart?.(suite, {
      runId: suiteRunId,
      artifact: suiteArtifact ? { kind: 'suite-parent', ...suiteArtifact } : { kind: 'suite-parent' },
    } as any)
    await reporter?.onRunStart(testEntries.map(([t]) => t))

    if ((suite as any).setup?.length && suiteConfig.resolvedHooks && prepared.suiteSandboxOptions) {
      const hookDefs: HookDefinition[] = []
      let hookMissing = false
      for (const hookId of (suite as any).setup) {
        const hook = suiteConfig.resolvedHooks.get(hookId)
        if (!hook) { hookMissing = true; break }
        hookDefs.push(hook)
      }
      if (hookMissing) {
        prepared.bootstrapFailure = 'Suite setup hook not found'
        return
      }
      if (hookDefs.length > 0) {
        const envVars: Record<string, string> = {}
        if (suiteConfig.envFileVars) Object.assign(envVars, suiteConfig.envFileVars)
        if (suiteConfig.inlineVars) Object.assign(envVars, suiteConfig.inlineVars)
        if (suiteConfig.cliVars) Object.assign(envVars, suiteConfig.cliVars)
        const { runHooks } = await import('@vostride/agent-qa-runner')
        const hookRun = await runHooks(hookDefs, {
          ...prepared.suiteSandboxOptions,
          secretStore: suiteConfig.secretStore,
          secretRedactor: suiteConfig.secretRedactor,
          envVars: { ...prepared.suiteSandboxOptions.envVars, ...envVars },
        })
        for (const [name, hr] of hookRun.results) {
          const hookDef = hookDefs.find((h) => h.name === name)
          const hookExecId = randomUUID()
          await reporter?.onHookStart?.({ hookId: hookDef?.id, hookName: name, phase: 'setup', hookExecutionId: hookExecId, runId: suiteRunId })
          await reporter?.onHookEnd?.({ hookId: hookDef?.id, hookName: name, phase: 'setup', hookExecutionId: hookExecId, runId: suiteRunId, status: hr.success ? 'passed' : 'failed', duration: hr.duration, stdout: hr.stdout, stderr: hr.stderr, variables: hr.variables, error: hr.error })
        }
        if (!hookRun.allPassed) {
          prepared.bootstrapFailure = 'Suite setup hook failed'
          return
        }
        prepared.suiteHookVars = hookRun.variables
      }
    }

    await suiteConfig.adapter.setup(suiteConfig.platformConfig)

    const initialTargetName = suite.target ?? testEntries[0]?.[0].target
    if (suiteConfig.resolveUrl && initialTargetName) {
      const rawSuiteUrl = suiteConfig.resolveUrl(initialTargetName)
      if (rawSuiteUrl) {
        try {
          const navResult = await suiteConfig.adapter.execute({ type: 'navigate', to: 'url', url: rawSuiteUrl } as any)
          if (navResult && navResult.success === false) {
            prepared.bootstrapFailure = navResult.error ?? `Failed to navigate to suite target URL "${rawSuiteUrl}"`
          }
        } catch (err) {
          prepared.bootstrapFailure = err instanceof Error ? err.message : `Failed to navigate to suite target URL "${rawSuiteUrl}"`
        }
      }
    }
  }

  // Suite-level TEARDOWN the shell runs when crossing a suite boundary / at finalize: auth-state
  // capture (when every member ran and passed), suite teardown hooks, adapter.cleanup + memory
  // destroy, the aggregated onRunEnd/onSuiteEnd reporter calls, and the old runSuite `.finally`
  // composition side effects (working-memory flush, dashboard-db close, analytics flush).
  const suiteTeardown = async (prepared: PreparedSuite): Promise<void> => {
    const { suite, suiteConfig, reporter, suiteRunId, results } = prepared
    const totalMembers = prepared.testEntries.length

    if (
      suiteConfig.authStateCapture
      && results.length === totalMembers
      && results.length > 0
      && results.every((r) => r.status === 'passed')
    ) {
      try {
        const captured = await suiteConfig.authStateCapture.capture()
        // D-06: a mid-run captured auth state may carry freshly-minted tokens — register its
        // sensitive values into the run context so every subsequent egress masks them. Teardown
        // runs inside runSafetyScope; the lexically-captured run context is the active one.
        if (runMaskingContext) {
          registerAuthStateIntoMaskingContext(
            runMaskingContext,
            await readAuthStatePayloadBestEffort(captured.storageStatePath),
          )
        }
        prepared.suiteSandboxOptions = suiteConfig.sandboxOptions
          ? { ...suiteConfig.sandboxOptions, authState: captured }
          : suiteConfig.sandboxOptions
      } catch {
        const captureFailure: TestResult = {
          runId: suiteRunId, name: 'Auth state capture', filePath: '', status: 'failed',
          steps: [], duration: 0, failureSummary: suiteConfig.authStateCapture.failureSummary,
          metadata: { phase: 'auth-state-capture' },
        }
        results.push(captureFailure)
        await reporter?.onTestEnd(captureFailure)
      }
    }

    if ((suite as any).teardown?.length && suiteConfig.resolvedHooks && prepared.suiteSandboxOptions) {
      const teardownVars: Record<string, string> = {}
      if (suiteConfig.envFileVars) Object.assign(teardownVars, suiteConfig.envFileVars)
      if (suiteConfig.inlineVars) Object.assign(teardownVars, suiteConfig.inlineVars)
      if (suiteConfig.cliVars) Object.assign(teardownVars, suiteConfig.cliVars)
      Object.assign(teardownVars, prepared.suiteHookVars)
      const { runHooks } = await import('@vostride/agent-qa-runner')
      for (const hookId of (suite as any).teardown) {
        const hook = suiteConfig.resolvedHooks.get(hookId)
        if (!hook) continue
        const hookExecId = randomUUID()
        try {
          await reporter?.onHookStart?.({ hookId: hook.id, hookName: hook.name, phase: 'teardown', hookExecutionId: hookExecId, runId: suiteRunId })
          const hr = (await runHooks([hook], {
            ...prepared.suiteSandboxOptions,
            secretStore: suiteConfig.secretStore,
            secretRedactor: suiteConfig.secretRedactor,
            envVars: { ...prepared.suiteSandboxOptions.envVars, ...teardownVars },
          })).results.get(hook.name)
          await reporter?.onHookEnd?.({ hookId: hook.id, hookName: hook.name, phase: 'teardown', hookExecutionId: hookExecId, runId: suiteRunId, status: hr?.success ? 'passed' : 'failed', duration: hr?.duration ?? 0, stdout: hr?.stdout ?? '', stderr: hr?.stderr ?? '', variables: hr?.variables ?? {}, error: hr?.error })
        } catch {}
      }
    }

    try { await suiteConfig.adapter.cleanup() } catch {}
    if (suiteConfig.memoryProvider) { try { suiteConfig.memoryProvider.destroy() } catch {} }

    const passed = results.filter((r) => r.status === 'passed').length
    const failed = results.filter((r) => r.status === 'failed').length
    const cancelled = results.filter((r) => r.status === 'cancelled').length
    const skipped = (totalMembers - results.length) + results.filter((r) => r.status === 'skipped').length
    const duration = results.reduce((sum, r) => sum + r.duration, 0)
    const suiteStatus = failed > 0 ? 'failed' : cancelled > 0 ? 'cancelled' : 'passed'
    await reporter?.onRunEnd?.({ results, duration, passed, failed, skipped })
    await reporter?.onSuiteEnd?.({ runId: suiteRunId, name: suite.name, status: suiteStatus, tests: results, duration, passed, failed, skipped })

    await flushWorkingMemory(prepared.suiteWorkingMemory, {
      artifactsDir: resolvePath(configDir, config.services?.dashboard?.artifactsDir ?? RUNTIME_ARTIFACTS_DIR),
      mask: runMaskingContext ? (value: string) => runMaskingContext!.mask(value) : undefined,
    })
    closeSuiteDashboardDb(prepared.dashboardDb)
    printRunAttributes(prepared.suiteAttributes)
  }

  // ---- Compose the ONE RunSession per invocation (D-01/D-04, SESSION-01/04/05) ---------------
  // Resolve every suite up front (parse/target/model/reporter/cache resolution + suiteConfig).
  // Resolution errors still process.exit(2) inside prepareSuite (the config-error contract, D-14).
  const preparedSuites: PreparedSuite[] = []
  for (const suiteFile of suiteFiles) {
    const suite = await parseSuiteFile(suiteFile)
    preparedSuites.push(await prepareSuite(suiteFile, suite))
  }

  // Flat ordered member list across all suites (file order, then in-suite order). Each member's
  // failFastGroup = its suite file, preserving today's within-suite fail-fast while other suites
  // still run (D-15). testIndex = global array position (the shell's authoritative index).
  const members: RunMemberDescriptor[] = []
  const bindings: SuiteMemberBinding[] = []
  const digestMembers: Array<{ testFileContent: string; suiteFileContent?: string }> = []
  let perMemberDigests: ConfigDigests[] = []

  for (let suiteIndex = 0; suiteIndex < preparedSuites.length; suiteIndex++) {
    const prepared = preparedSuites[suiteIndex]
    for (let i = 0; i < prepared.testEntries.length; i++) {
      const [test, filePath] = prepared.testEntries[i]
      const globalIndex = members.length
      const memberSuiteIndex = i
      members.push({
        testId: (test as any)['test-id'] ?? test.name,
        testIndex: globalIndex,
        name: test.name,
        failFastGroup: prepared.suiteKey,
        // 363 D-01: parity descriptor fields the shell rides onto testStarted. Suite grouping is
        // per-suite (id/name/index/total); filePath + totalSteps are per-member.
        filePath,
        suiteId: prepared.suite['suite-id'],
        suiteName: prepared.suite.name,
        suiteIndex,
        suiteTotal: preparedSuites.length,
        totalSteps: test.steps.length,
      })
      digestMembers.push({
        testFileContent: prepared.testFileContents[i] ?? '',
        suiteFileContent: prepared.suiteConfig.suiteFileContent,
      })
      bindings.push({
        suiteKey: prepared.suiteKey,
        hooks: {
          setup: () => suiteSetup(prepared),
          teardown: () => suiteTeardown(prepared),
        },
        run: async (ctx) => {
          if (prepared.bootstrapFailure) {
            const bootstrapResult: TestResult = {
              runId: prepared.suiteRunId, name: test.name, filePath, status: 'failed',
              steps: [], duration: 0, failureSummary: prepared.bootstrapFailure,
              metadata: { phase: 'suite-bootstrap' },
            }
            prepared.results.push(bootstrapResult)
            return bootstrapResult
          }
          const result = await executeSuiteMember({
            suite: prepared.suite,
            test,
            filePath,
            index: memberSuiteIndex,
            totalTests: prepared.testEntries.length,
            config: prepared.suiteConfig,
            reporter: prepared.reporter,
            suiteRunId: prepared.suiteRunId,
            suiteHookVars: prepared.suiteHookVars,
            suiteSandboxOptions: prepared.suiteSandboxOptions,
            suiteArtifact: prepared.suiteArtifact,
            memoryEnabled: prepared.memoryEnabled,
            memoryRoot: prepared.memoryRoot,
            // D-02/D-03/D-20 run-shell seams.
            events: ctx.events,
            abortSignal: ctx.abortSignal,
            configDigests: perMemberDigests[globalIndex],
            // SEAM-03 (D-04): the per-run SafetyHookRunner populates LoopPorts.safetyHooks so every
            // tool call routes the async policy gate. Read at call time (bindings predate the mint).
            safetyHooks: runSafetyHooks,
          })
          prepared.results.push(result)
          return result
        },
      })
    }
  }

  // D-20: the ONE digest mint — per-member cache pairs + the run-level handoff pair; both consumers
  // (per-member cache via ctx, run-level handoff via RunConfig) draw from this single call.
  const runDigests = computeRunConfigDigests({ configContent, members: digestMembers })
  perMemberDigests = runDigests.perMember

  const runId = process.env.AGENT_QA_RUN_ID ?? generateRunId()
  const runProduct = preparedSuites.find((p) => p.product)?.product ?? 'unknown'
  const executionContext = resolveRunExecutionContext()
  const buildOrdinal = await resolveRunBuildOrdinal({ configDir, product: runProduct })
  const runPorts = buildRunPorts({ configDir, runId })

  // SEAM-01/03/04 (362-06): construct the run's real seeded MaskingContext (D-05/06/07), the per-run
  // stamped audit sink (D-12/13), and the per-run SafetyHookRunner (D-01/15/10) — then run the whole
  // run body inside runSafetyScope so every createModel egress masks and every tool call is gated +
  // audited (D-02/D-04). The masking context needs no runId, so it seeds from the statically-resolved
  // suite auth-state payloads read best-effort here.
  //
  // MASKING BOUNDARY (363-09, RESEARCH Q7 item 3): every placeholder-bearing string originates AFTER
  // this seam (masked egress, tool gating, WM). Pre-run errors (config/parse/target resolution, the
  // validation-error DB writes and crash-finalizer above) occur BEFORE the MaskingContext exists, so
  // they carry NO placeholders and need NO unmask call — the console reporter (the sole unmasking
  // surface) only handles post-seam envelopes; step-failure/deny prose reaches humans through it.
  const authStatePayloads = (
    await Promise.all(preparedSuites.map((p) => readAuthStatePayloadBestEffort(p.authStateStoragePath)))
  ).filter((payload): payload is unknown => payload !== undefined)
  const maskingContext = buildRunMaskingContext({
    secretStore: variableContext?.secretStore,
    env: process.env,
    authStatePayloads,
  })
  const auditSink = buildRunAuditSink({ configDir, runId, executionContext })
  const trustMode = opts.trustSession === true || config.safety?.trustMode === true
  // D-11 (363-09): the console pause/resume seam shared with the ask-tier confirm decorator; bound to
  // the console reporter inside `attachRunSubscribers` below. buildRunSafetyHooks composes the unmask
  // decorator OVER the timed decorator so live confirm prompts show real values (masked machine surfaces).
  const livePause = createLivePauseController()
  const { safetyHooks, confirmPausedMs } = buildRunSafetyHooks({ auditSink, executionContext, trustMode, maskingContext, live: livePause })
  runMaskingContext = maskingContext
  runSafetyHooks = safetyHooks
  // Point every suite's loop masking port at the ONE run context (ungated from cache — D-09/356).
  for (const prepared of preparedSuites) prepared.suiteConfig.masking = maskingContext

  const lifecycle = createSuiteLifecycle()
  const executor = buildSuiteMemberExecutor({ lifecycle, bindings })

  // 363-09: the run-level bus subscribers (Pitfall 8 — the SAME attach helper both startRun sites use).
  // Analytics rides the bus (D-16); the dashboard ingest (when a suite DB exists) writes runs/run_artifacts
  // rows as a subscriber (D-08). Dashboard/analytics construction data the wire omits rides here.
  const runLevelDashboardDb = preparedSuites.find((p) => p.dashboardDb)?.dashboardDb
  const extraSubscribers: RunSubscriberHandle[] = []
  if (runLevelDashboardDb) {
    const suiteArtifact = preparedSuites.find((p) => p.dashboardDb)?.suiteArtifact as
      | { config?: unknown; source?: unknown }
      | undefined
    const dashboardSubscriber = await buildDashboardIngestSubscriber({
      db: runLevelDashboardDb,
      configSnapshot: suiteArtifact?.config,
      sourceSnapshot: suiteArtifact?.source,
      attributes: preparedSuites.find((p) => p.dashboardDb)?.suiteAttributes,
    })
    if (dashboardSubscriber) extraSubscribers.push(dashboardSubscriber)
  }
  extraSubscribers.push(createAnalyticsRunSubscriber({ config, surface: 'cli' }))

  const exitCode = await runSafetyScope({ maskingContext, auditSink, executionContext }, async () => {
    try {
      const session = startRun({
        // generateRunId returns a plain string; brand it to the RunConfig's RunId without a schema dep.
        runId: runId as unknown as Parameters<typeof startRun>[0]['runId'],
        scope: { tier: 'product', key: runProduct },
        executionContext,
        configDigests: runDigests.runLevel,
        buildOrdinal,
        members,
        executor,
        masking: maskingContext,
        ports: { ...runPorts, confirmPausedMs },
      })
      activeRunSession = session

      // Attach the bus subscribers (console unmasks; junit + wire masked; dashboard ingest; analytics)
      // via subscribe(0) — replay-then-live gives D-04 for free. Console options carry the run's flags.
      const subscribers = attachRunSubscribers({
        session,
        maskingContext,
        console: reporterSelection.console ? { verbose: false, logLevel: effectiveLogLevel } : false,
        junitOutputPath: reporterSelection.junit ? opts.junitOutput : undefined,
        extraSubscribers,
        live: livePause,
      })

      const { verdict } = await session.done
      if (graceTimer) clearTimeout(graceTimer)
      await lifecycle.finalize()
      // Pitfall 6/8: await EVERY subscriber flush (junit write, dashboard finalize, analytics drain)
      // AFTER session.done + lifecycle.finalize() and BEFORE mapping the verdict to the exit code.
      await subscribers.flush()
      activeRunSession = undefined
      // D-14: the verdict-mapped exit code (passed/healed=0, failed/timeout=1, cancelled=130). A
      // SIGINT that raced the terminal verdict still maps to 130.
      return mapVerdictToExitCode(shutdownRequested ? 'cancelled' : verdict)
    } finally {
      // Pitfall 8: dispose LAST — after session.done + lifecycle.finalize() (teardown auth capture +
      // handoff assembly) so every late masker still replaces; a post-run stray egress sees no mask.
      maskingContext.dispose()
    }
  })

  shutdownController.dispose()
  process.removeListener('SIGINT', shutdownController.handleSignal)
  process.removeListener('SIGTERM', shutdownController.handleSignal)

  releaseAppium()
  return exitCode
}

export function createRunCommand(): Command {
  const cmd = new Command('run')
    .description('Run test files')
    .argument('[patterns...]', 'glob patterns for test files')
    .option('--browser <name>', 'override browser (chromium, firefox, webkit)')
    .option('--platform <name>', 'filter by platform (web, android, ios)')
    .option('--headless', 'run in headless mode')
    .option('--no-headless', 'run in headed mode')
    .option('--disable-cache', 'bypass action cache for this run')
    .option('--save-cache', 'write cache even on the default/protected branch')
    .option('--no-memory', 'disable runtime memory injection for this run')
    .option('--bail', 'stop on first test failure')
    .option('--dry-run', 'parse and list tests without executing')
    .option('--list-tests', 'list discovered test files without executing')
    .option('--junit-output <path>', 'path for JUnit XML output')
    .option('--screenshot-dir <dir>', 'directory for failure screenshots')
    .option('--screenshot-mode <mode>', 'when to capture: failure (default) or every-step')
    .option('--reporter <names...>', 'select reporters (default: console)')
    .option('--record', 'enable session video recording')
    .option('--config-debug', 'print resolved config with source attribution for each test')
    .option('--test', 'discover and run tests via testMatch patterns (default when no flags)')
    .option('--suite', 'discover and run suites via suiteMatch patterns')
    .option('--all', 'discover and run both tests (testMatch) and suites (suiteMatch)')
    .option('--device <name>', 'Override the mobile test/suite device for this run')
    .option('--var <kv...>', 'set variable KEY=VALUE (repeatable)')
    .option('--run-attr <kv...>', 'attach run attribute KEY=VALUE; repeatable')
    .option('--trust-session', 'treat every ask-tier policy decision in this session as trusted (execution-safety §2.3 session.trustMode; explicit opt-in, session-scoped)')
    .action(async (patterns: string[], opts: RunOptions, command: Command) => {
      let _crashDb: any
      try {
        const modeFlags = [opts.test, opts.suite, opts.all].filter(Boolean).length
        if (modeFlags > 1) {
          console.error(pc.red('Error: --test, --suite, and --all are mutually exclusive.'))
          process.exit(1)
        }

        const program = command.parent!
        const globalOpts = program.opts<{ config?: string; verbose?: boolean; quiet?: boolean; logLevel?: string }>()

        const flagOverrides: Record<string, unknown> = {}
        if (opts.browser) {
          flagOverrides.browsers = [{ name: opts.browser }]
        }
        if (opts.headless !== undefined) {
          // headless is handled per-platform in platformConfig setup below
        }

        const config = await resolveConfig({
          configPath: globalOpts.config,
          flags: flagOverrides,
          loadAuthPlugins: !(opts.dryRun || opts.listTests),
        })

        // Read raw config file content for cache key scoping
        const configFilePath = resolvePath(globalOpts.config ?? 'agent-qa.config.yaml')
        const workspacePaths = resolveWorkspacePaths({
          config,
          configPath: configFilePath,
        })
        let configContent = ''
        try {
          const { readFile: readConfigFile } = await import('node:fs/promises')
          configContent = await readConfigFile(configFilePath, 'utf-8')
        } catch { /* best-effort: resolveConfig already required the file */ }

        // Load variables from env file, config inline, and CLI flags
        const { parseEnvFile } = await import('@vostride/agent-qa-core')
        const { readFileSync, existsSync } = await import('node:fs')
        const configDir = workspacePaths.configDir

        const cliVars = parseVarFlags(opts.var)
        const inheritedContextRunId = process.env.AGENT_QA_RUN_ID
          ?? process.env.AGENT_QA_SUITE_QUEUE_ID
          ?? process.env.AGENT_QA_PARENT_RUN_ID
        const inheritedRunAttributes = inheritedContextRunId
          ? readRunAttributesFromEnv()
          : undefined
        let userRunAttributes: RunAttributes
        try {
          const parsedRunAttrs = parseRunAttrFlags(opts.runAttr)
          userRunAttributes = parsedRunAttrs.attributes
          for (const duplicateKey of parsedRunAttrs.duplicateKeys) {
            console.warn(`Warning: duplicate --run-attr key "${duplicateKey}"; using last value`)
          }
        } catch (err) {
          console.error(pc.red(`Error: ${err instanceof Error ? err.message : String(err)}`))
          process.exit(2)
        }
        const inlineVars: Record<string, string> = {}

        const runtimeSecrets = await loadRuntimeSecrets({
          config,
          configDir,
          secretsFilePath: workspacePaths.secretsFile.absolutePath,
          readFileSync,
          existsSync,
        })

        let envFileVars: Record<string, string> = {}
        let rawEnvFileContent: string | null = null
        let resolvedEnvFilePath: string | null = null
        resolvedEnvFilePath = workspacePaths.envFile.absolutePath
        if (!existsSync(workspacePaths.envFile.absolutePath)) {
          console.error(pc.red(`Error: Env file not found: ${workspacePaths.envFile.absolutePath}`))
          process.exit(1)
        }
        try {
          rawEnvFileContent = readFileSync(workspacePaths.envFile.absolutePath, 'utf-8')
          envFileVars = parseEnvFile(rawEnvFileContent)
        } catch {
          console.error(pc.red(`Error: Env file could not be read: ${workspacePaths.envFile.absolutePath}`))
          process.exit(1)
        }

        let resolvedHooks: Map<string, HookDefinition> | undefined
        let sandboxOptions: SandboxRunnerOptions | undefined

        const hooksFilePath = workspacePaths.hooksFile.absolutePath
        if (!existsSync(hooksFilePath)) {
          console.error(pc.red(`Error: Hooks file not found: ${hooksFilePath}`))
          process.exit(1)
        }
        try {
          const { parseHooksFile } = await import('@vostride/agent-qa-core')
          const { hooks, errors } = await parseHooksFile(hooksFilePath)
          if (errors.length > 0) {
            console.error(pc.red('Hooks configuration errors:'))
            for (const err of errors) console.error(pc.red(`  - ${err}`))
            process.exit(1)
          }
          resolvedHooks = new Map(hooks.map((h: HookDefinition) => [h.id, h]))
          // D-06: construct the runner-local Docker hook executor once at this composition
          // root and thread it inside the sandboxOptions carrier to every hook site.
          sandboxOptions = {
            executor: new DockerHookExecutor(),
            secretStore: runtimeSecrets.secretStore,
            secretRedactor: runtimeSecrets.secretRedactor,
          }
        } catch (err: any) {
          console.error(pc.red(`Error: Hooks file could not be read: ${hooksFilePath}`))
          if (err instanceof Error && err.message) console.error(pc.dim(err.message))
          process.exit(1)
        }

        let agentRulesContent: string | undefined
        const { readFile: readFileAsync } = await import('node:fs/promises')
        try {
          agentRulesContent = await readFileAsync(workspacePaths.agentRules.absolutePath, 'utf-8')
        } catch {
          console.error(pc.red(`Error: Agent rules file not found: ${workspacePaths.agentRules.absolutePath}`))
          process.exit(1)
        }

        // Resolve effective log level: CLI flag > --verbose/--quiet > config > fallback
        const effectiveLogLevel = globalOpts.logLevel
          ?? (globalOpts.verbose ? 'debug' : undefined)
          ?? (globalOpts.quiet ? 'silent' : undefined)
          ?? (config as any).services?.logging?.level
          ?? 'warn'

        let discoveredTestFiles: string[] = []
        let discoveredSuiteFiles: string[] = []

        if (patterns && patterns.length > 0) {
          try {
            const selected = await discoverFilesForCliPatterns(workspacePaths, patterns)
            discoveredTestFiles = selected.tests
            discoveredSuiteFiles = selected.suites
          } catch (err) {
            console.error(pc.red(`Error: ${err instanceof Error ? err.message : String(err)}`))
            process.exit(1)
          }

          if (discoveredTestFiles.length === 0 && discoveredSuiteFiles.length === 0) {
            const patternKind = patterns.every((pattern) => classifyRunPattern(pattern) === 'suite') ? 'suite' : 'test'
            console.error(pc.red(`Error: No ${patternKind} files found matching patterns:`))
            for (const p of patterns) console.error(pc.red(`  ${p}`))
            process.exit(2)
          }
        } else if (opts.suite) {
          discoveredSuiteFiles = (await discoverWorkspaceFiles({ workspace: workspacePaths, kind: 'suite' }))
            .map(record => record.absolutePath)
          if (discoveredSuiteFiles.length === 0) {
            console.error(pc.red('Error: No suite files found matching workspace.suiteMatch'))
            for (const p of workspacePaths.suiteMatch) {
              console.error(pc.red(`  ${p}`))
            }
            process.exit(2)
          }
        } else if (opts.all) {
          discoveredTestFiles = (await discoverWorkspaceFiles({ workspace: workspacePaths, kind: 'test' }))
            .map(record => record.absolutePath)
          discoveredSuiteFiles = (await discoverWorkspaceFiles({ workspace: workspacePaths, kind: 'suite' }))
            .map(record => record.absolutePath)

          if (discoveredTestFiles.length === 0 && discoveredSuiteFiles.length === 0) {
            console.error(pc.red('Error: No test or suite files found. Check workspace.testMatch and workspace.suiteMatch in agent-qa.config.yaml'))
            process.exit(2)
          }
        } else {
          if (!workspacePaths.testMatch || workspacePaths.testMatch.length === 0) {
            console.error(pc.red('Error: No testMatch patterns in config. Add workspace.testMatch to agent-qa.config.yaml.'))
            process.exit(2)
          }
          discoveredTestFiles = (await discoverWorkspaceFiles({ workspace: workspacePaths, kind: 'test' }))
            .map(record => record.absolutePath)
          if (discoveredTestFiles.length === 0) {
            console.error(pc.red('Error: No test files found matching workspace.testMatch'))
            for (const p of workspacePaths.testMatch) {
              console.error(pc.red(`  ${p}`))
            }
            process.exit(2)
          }
        }

        // Handle suite execution (early return)
        if (discoveredSuiteFiles.length > 0 && discoveredTestFiles.length === 0) {
          const exitCode = await executeSuites(discoveredSuiteFiles, opts, config, globalOpts, configContent, effectiveLogLevel, { envFileVars, inlineVars, cliVars, rawEnvFileContent, resolvedEnvFilePath, userRunAttributes, inheritedRunAttributes, ...runtimeSecrets }, resolvedHooks && sandboxOptions ? { resolvedHooks, sandboxOptions } : undefined)
          const suiteReporterSelection = resolveReporterSelection(opts, Boolean(config.services?.dashboard)).selection
          if (suiteReporterSelection) {
            await maybePrintPostRunUpdateNotice({
              reporterSelection: suiteReporterSelection,
              effectiveLogLevel,
              liveEvents: process.env.AGENT_QA_LIVE_EVENTS,
              cwd: process.cwd(),
            })
          }
          process.exit(exitCode)
        }

        // Handle --all: run suites first, then fall through to test execution
        let suitesFailed = false
        if (discoveredSuiteFiles.length > 0 && discoveredTestFiles.length > 0) {
          suitesFailed = (await executeSuites(discoveredSuiteFiles, opts, config, globalOpts, configContent, effectiveLogLevel, { envFileVars, inlineVars, cliVars, rawEnvFileContent, resolvedEnvFilePath, userRunAttributes, inheritedRunAttributes, ...runtimeSecrets }, resolvedHooks && sandboxOptions ? { resolvedHooks, sandboxOptions } : undefined)) !== 0
        }

        const files = discoveredTestFiles

        if (opts.listTests) {
          console.log(pc.bold(`\nDiscovered ${files.length} test file(s):\n`))
          for (const file of files) {
            console.log(`  ${file}`)
          }
          process.exit(0)
        }

        // Hoist dashboard DB init before parsing so parse errors can write to DB
        let logStorage: any
        const dashboardCfg2 = config.services?.dashboard as Record<string, unknown> | undefined
        const reporterSelectionResult = resolveReporterSelection(opts, Boolean(dashboardCfg2))
        if (reporterSelectionResult.error) {
          console.error(pc.red(`Error: ${reporterSelectionResult.error}`))
          process.exit(2)
        }
        const reporterSelection = reporterSelectionResult.selection!
        const dashboardEnabled = reporterSelection.dashboard
        let dashboardDb: any
        let currentRunId: string | undefined
        if (dashboardEnabled) {
          try {
            const { DashboardDatabase, resolveDashboardDbPath } = await import('@vostride/agent-qa-dashboard')
            const configuredDbPath = dashboardCfg2?.dbPath as string | undefined
            dashboardDb = new DashboardDatabase({
              dbPath: resolveDashboardDbPath({ configDir, configuredDbPath }),
            })
            logStorage = dashboardDb
            _crashDb = dashboardDb
          } catch (err) {
            console.warn(pc.yellow(`Warning: Could not load dashboard reporter: ${err instanceof Error ? err.message : String(err)}`))
          }
        }

        const { parseAllTests, formatParseError } = await import('@vostride/agent-qa-core')
        const parseResult = await parseAllTests(files)

        if (parseResult.errors.length > 0) {
          console.error(pc.red(`Found ${parseResult.errors.length} parse error(s):\n`))
          for (const err of parseResult.errors) {
            console.error(formatParseError(err))
          }
          const validationRunId = createTestRunId()
          const validationAttributes = resolveCliRunAttributes(userRunAttributes, 'local', inheritedRunAttributes)
          if (dashboardDb) {
            const now = new Date().toISOString()
            const { basename } = await import('node:path')
            const errorText = parseResult.errors.map(e => formatParseError(e)).join('\n').replace(/\x1b\[[0-9;]*m/g, '')
            const { readFileSync } = await import('node:fs')
            const rawContent = readFileSync(files[0], 'utf-8')
            const nameMatch = rawContent.match(/^\s*name:\s*(.+)$/m)
            const targetMatch = rawContent.match(/^\s*target:\s*(.+)$/m)
            let detectedPlatform = 'web'
            if (targetMatch) {
              const targetName = targetMatch[1].trim()
              const resolvedTarget = (config as any).registry?.targets?.[targetName]
              if (resolvedTarget?.platform) detectedPlatform = resolvedTarget.platform
            }
            const testName = nameMatch ? nameMatch[1].trim().replace(/^['"]|['"]$/g, '') : basename(files[0], '.yaml')
            const existingRunId = process.env.AGENT_QA_RUN_ID
            let artifactRunId: string
            if (existingRunId) {
              dashboardDb.updateRun(existingRunId, {
                name: testName,
                status: 'failed',
                duration: 0,
                endedAt: now,
                attributes: validationAttributes,
                platform: detectedPlatform,
                failureSummary: `${parseResult.errors.length} parse error(s)`,
                errorLog: errorText,
              })
              artifactRunId = existingRunId
            } else {
              dashboardDb.insertRun({
                id: validationRunId,
                name: testName,
                status: 'failed',
                duration: 0,
                startedAt: now,
                endedAt: now,
                attributes: validationAttributes,
                platform: detectedPlatform,
                failureSummary: `${parseResult.errors.length} parse error(s)`,
              })
              dashboardDb.updateRun(validationRunId, { errorLog: errorText })
              artifactRunId = validationRunId
            }
            dashboardDb.insertRunArtifact({
              runId: artifactRunId,
              kind: 'test',
              payload: redactAuthStateValue({
                config: {
                  rawConfigContent: configContent,
                  parsedConfig: config,
                  effectiveConfig: config,
                  envFile: { path: resolvedEnvFilePath, content: rawEnvFileContent, variables: envFileVars },
                  secretsFile: runtimeSecrets.secretsFileMetadata,
                  cliVars,
                  inlineVars,
                  hooks: buildHooksArtifact(resolvedHooks),
                },
                source: {
                  kind: 'test',
                  testId: null,
                  name: testName,
                  filePath: files[0],
                  rawYaml: rawContent,
                  resolvedDefinition: null,
                  loadStatus: 'parse-error',
                },
                runtime: {
                  platform: detectedPlatform,
                  targetName: targetMatch ? targetMatch[1].trim() : null,
                },
                metadata: { attributes: validationAttributes },
                errors: parseResult.errors.map((error) => ({
                  code: 'parse-error',
                  phase: 'parse',
                  message: error.message,
                  details: error,
                })),
              }),
            })
            dashboardDb.finalizeRunArtifact(artifactRunId)
            dashboardDb.close()
          }
          printRunId(validationRunId)
          printRunAttributes(validationAttributes)
          process.exit(2)
        }

        const filtered = parseResult.tests

        // RUNX-06: `filtered` is `parseResult.tests` verbatim — no grep/filter narrows it here — so
        // `filtered.length === 0` means discovery RESOLVED >=1 test file (the exit-2 guards above
        // already proved that) but parsing produced ZERO runnable tests. Starting a run from here
        // would assemble a zero-member RunSession and render a benign-looking "Tests: 0 of 0 passed"
        // summary (console-reporter printStandaloneSummary) — a silent green non-run. An existing
        // resolved target must instead FAIL LOUDLY (exit 2, the same config/usage contract as the
        // "no files found" guards), never a silent empty run. (T-365-04b)
        if (filtered.length === 0) {
          console.error(pc.red('Error: Resolved test file(s) but found 0 runnable tests.'))
          for (const f of files) console.error(pc.red(`  ${f}`))
          console.error(pc.dim('Each test file must define at least one test (a top-level `name` + `steps`, or a `tests:` list).'))
          process.exit(2)
        }

        if (opts.dryRun) {
          console.log(pc.bold(`\nFound ${filtered.length} test(s):\n`))
          for (const test of filtered) {
            console.log(`  ${pc.green('●')} ${test.name}`)
            if (opts.configDebug) {
              console.log(pc.bold(`\n  Config for: ${test.name}`))
              console.log(formatConfigDebug(config, test.use, flagOverrides))
              console.log()
            }
          }
          process.exit(0)
        }

        // Actual execution
        const startTime = Date.now()
        const {
          runTestWithRetry,
          MultiReporter, createAnalyticsRunSubscriber,
        } = await import('@vostride/agent-qa-core')
        const { LLMPlanner, LLMVerifier, startRun, mapVerdictToExitCode } = await import('@vostride/agent-qa-runner')

        const recordingEnabled = opts.record ?? config.services?.recording?.enabled ?? false

        // Wire action cache from config (logger wired after LogManager creation below)
        let actionCache: import('@vostride/agent-qa-runner').ActionPlanCache | undefined
        // SEAM-01/03 (362-06): the ONE run MaskingContext + per-run SafetyHookRunner for this path,
        // built at the singleRunId mint below and captured here so runOneDirectTest (defined before
        // the mint) resolves the run bundle at call time — the second call site, same helpers
        // (Pitfall 7). `singleMaskingContext` also feeds the D-06 mid-run auth registration.
        let singleMaskingContext: RunMaskingContext | undefined
        let singleSafetyHooks: SafetyHookRunner | undefined

        // WM-01/WM-02: one run-scoped working-memory store per run, constructed with the run's
        // SecretRedactor (capture-time redaction live); threaded into the loop and flushed
        // redacted at run end (finally-positioned below).
        const singleWorkingMemory = new WorkingMemoryStore(runtimeSecrets.secretRedactor)

        // D-14 (Phase 360): one run-scoped storage-state store per run, rooted at the run's
        // `.agent-qa` dir (the FsActionCache rooting idiom); threaded into the loop's storageState port.
        const singleStorageState = await buildStorageStateStore(configDir)

        // 363-09 (D-01 clean cut, CLI side): the v1 Reporter constructions are GONE. The bus subscribers
        // (console unmasks; junit + wire masked; dashboard ingest; analytics) attach at the startRun site
        // below via `attachRunSubscribers`. This empty list keeps core's internal MultiReporter + the
        // runTest reporters inert (Plan 11 deletes the Reporter shape).
        const reporters: never[] = []

        const captureScreenshots = reporterSelection.dashboard || opts.screenshotMode === 'every-step' || Boolean(opts.screenshotDir)

        const { LogManager } = await import('@vostride/agent-qa-core')

        const logger = new LogManager({
          runId: process.env.AGENT_QA_RUN_ID || undefined,
          displayLevel: effectiveLogLevel as any,
          storage: logStorage,
          ndjson: process.env.AGENT_QA_LIVE_EVENTS === 'true',
          redactor: runtimeSecrets.secretRedactor,
        })

        // Wire the redesigned action cache (runner-local FsActionCache + branch policy); skip when
        // --disable-cache. The loop's masking port now carries the run MaskingContext (assigned at
        // the singleRunId mint below), no longer a cache-context identity mint (SEAM-01/D-09).
        if (opts.disableCache !== true) {
          const { resolve } = await import('node:path')
          const ctx = await buildActionCacheContext({
            cacheDir: resolve(configDir, config.services?.cache?.dir ?? RUNTIME_CACHE_DIR),
            disableCache: false,
            saveCache: opts.saveCache === true,
          })
          actionCache = ctx.cache
        } else {
          const cacheLog = logger.createScopedLogger('cache')
          cacheLog.info('Cache disabled via --disable-cache', { operation: 'bypass' })
        }

        const multiReporter = new MultiReporter(reporters)

        const results: TestResult[] = []

        const memoryGlobalConfig = config.services?.memory
        const runtimeMemoryRoot = resolveMemoryRoot(config, configDir)

        await multiReporter.onRunStart(filtered)

        // One discovered test file = one member closure of the ONE RunSession (SESSION-01/04).
        // Retry stays a single-test-path concern INSIDE this closure (runTestWithRetry); the shell
        // derives the member outcome from the returned final TestResult exactly as for suite members
        // (RESEARCH A2 — the suite path is single-attempt, this path keeps its retry). The run-shell
        // ctx seams (events/abortSignal) and the member's cache digest pair are threaded in.
        const runOneDirectTest = async (
          test: TestDefinition,
          ctx: MemberTestRunContext,
          perMemberDigest: ConfigDigests | undefined,
        ): Promise<TestResult> => {
          let currentPlatform: 'web' | 'android' | 'ios' | null = null
          let currentAdapterKey: string | null = null
          let adapter: import('@vostride/agent-qa-runner').PlatformAdapter | null = null
          let analyticsRunId: string | undefined
          let analyticsFilePath = 'unknown'
          let analyticsPlatform: 'web' | 'android' | 'ios' | undefined
          let analyticsTestId: string | undefined
          let analyticsAttributes: RunAttributes | undefined = resolveCliRunAttributes(
            userRunAttributes,
            'local',
            inheritedRunAttributes,
          )
          let analyticsMobileTransport: string | undefined
          let analyticsAppState: string | undefined
          let analyticsStartedAt = Date.now()
          let completedResult: TestResult | undefined
          try {
          try {
          let testResolvedTarget = resolveTarget(config, test.target!)
          let testTargetUrl = testResolvedTarget.url

          const testDef = {
            ...test,
            url: testTargetUrl,
          }
          analyticsTestId = testDef['test-id']

          const filePath = files.find(f =>
            parseResult.tests.some(t => t.name === test.name),
          ) ?? 'unknown'
          analyticsFilePath = filePath

          const runId = process.env.AGENT_QA_RUN_ID ?? generateRunId()
          analyticsRunId = runId
          analyticsStartedAt = Date.now()
          currentRunId = runId
          logger.setRunId(runId)

          // Read raw test file content for cache key scoping
          let testFileContent = ''
          if (filePath !== 'unknown') {
            try {
              const { readFile: readTestFile } = await import('node:fs/promises')
              testFileContent = await readTestFile(filePath, 'utf-8')
            } catch { /* best-effort */ }
          }

          // Per-test config merge (global config < test YAML use: < CLI flags)
          const testFlagOverrides: Record<string, unknown> = {}
          if (opts.headless !== undefined) testFlagOverrides['browser'] = { headless: opts.headless }
          if (opts.browser) testFlagOverrides['browser'] = { ...(testFlagOverrides['browser'] as Record<string, unknown> ?? {}), name: opts.browser }

          const mergedUse = mergeUseBlocks(
            config.use as Record<string, unknown>,
            undefined,
            test.use as Record<string, unknown> | undefined,
            testFlagOverrides,
          )
          const testMergedConfig = { ...config, use: mergedUse } as AgentQaConfig
          const effectiveCacheEnabled = !opts.disableCache && (mergedUse as Record<string, unknown>).cache !== false

          if (opts.configDebug) {
            console.log(pc.bold(`\nConfig for: ${test.name}`))
            console.log(formatConfigDebug(config, test.use, testFlagOverrides))
            console.log()
          }

          const testPlatform: 'web' | 'android' | 'ios' = testResolvedTarget.platform
          analyticsPlatform = testPlatform
          const testAuthStateUse = getSelectedAuthStateUse(mergedUse as Record<string, unknown>)
          const testAuthState = await resolveSelectedAuthStateForRun({
            config,
            configDir,
            resolvedTarget: testResolvedTarget,
            authState: testAuthStateUse,
          })
          const testAuthStateCapturePaths = resolveAuthStateCapturePathsForRun({
            config,
            configDir,
            resolvedTarget: testResolvedTarget,
            authState: testAuthStateUse,
          })
          // D-06: register the loaded auth-state's sensitive values into the run context (runs inside
          // runSafetyScope, after the mint — singleMaskingContext is live). Additive; stable placeholders.
          if (singleMaskingContext && testAuthState) {
            registerAuthStateIntoMaskingContext(
              singleMaskingContext,
              await readAuthStatePayloadBestEffort(testAuthState.storageStatePath),
            )
          }
          let activeTestAuthState = testAuthState

          const testMergedUse = (testMergedConfig as any).use ?? (config as any).use ?? {}
          const testDeviceName = opts.device ?? testMergedUse.device as string | undefined

          const testTimeoutsForSetup = {
            step: (testMergedConfig as any).use?.timeout?.step ?? config.use?.timeout?.step,
            test: (testMergedConfig as any).use?.timeout?.test ?? config.use?.timeout?.test,
            navigation: (testMergedConfig as any).use?.timeout?.navigation ?? config.use?.timeout?.navigation,
          }

          const testLocalBindings = testPlatform === 'android' || testPlatform === 'ios'
            ? loadLocalBindings()
            : null
          let testMobileResolved: ResolvedMobileRunConfig | undefined
          let testResolvedDevice: ResolvedDevice | undefined
          let testFarmSession: PlatformConfig['farmSession'] | undefined
          if (testPlatform === 'android' || testPlatform === 'ios') {
            testMobileResolved = resolveMobileRunOrThrow({
              config: config as unknown as Record<string, any>,
              targetName: testResolvedTarget.name,
              platform: testPlatform,
              explicitDeviceName: opts.device,
              useDeviceName: testMergedUse.device as string | undefined,
              appState: testMergedUse.mobile?.appState as 'preserve' | 'reset' | undefined,
              localBindings: testLocalBindings,
              configFilePath: resolvePath(configFilePath),
              localConfigFilePath: testLocalBindings?.filePath,
              appiumUrl: process.env.AGENT_QA_APPIUM_URL,
            })
            analyticsAppState = testMobileResolved.appState
            const resolved = await resolveDeviceAndFarmSession(
              config, testMobileResolved.deviceName, testPlatform,
              `${test.name} — ${new Date().toISOString().slice(0, 19)}`,
              testTimeoutsForSetup.test,
              testMobileResolved.device,
              testLocalBindings,
              testMobileResolved,
            )
            testResolvedDevice = resolved.resolvedDevice
            testFarmSession = resolved.farmSession
            analyticsMobileTransport = testResolvedDevice?.transport
          }

          const useFarm = testResolvedDevice?.transport !== undefined && testResolvedDevice.transport !== 'local'
          const testAttributes = resolveCliRunAttributes(
            userRunAttributes,
            resolveRunnerAttribute(testResolvedDevice?.transport),
            inheritedRunAttributes,
          )
          analyticsAttributes = testAttributes
          writeRunAttributesToEnv(testAttributes)
          const adapterKey = JSON.stringify({
            platform: testPlatform,
            device: testResolvedDevice?.name,
            appPackage: testMobileResolved?.app.appPackage,
            appActivity: testMobileResolved?.app.appActivity,
            bundleId: testMobileResolved?.app.bundleId,
            appPath: testMobileResolved?.app.install?.path,
            browserstackApp: testMobileResolved?.app.install?.browserstack,
          })

            // Each direct test owns its adapter so parallel batches cannot share mutable browser/mobile state.
            if (testPlatform !== currentPlatform || adapterKey !== currentAdapterKey) {
              currentPlatform = testPlatform
              currentAdapterKey = adapterKey

              // Auto-start Appium for mobile platforms (if not already running and not in farm mode)
              if ((testPlatform === 'ios' || testPlatform === 'android') && !useFarm) {
                try {
                  const appiumUrl = await acquireAppium(effectiveLogLevel)
                  if (testMobileResolved) {
                    testMobileResolved = { ...testMobileResolved, appium: { url: appiumUrl, managed: !process.env.AGENT_QA_APPIUM_URL } }
                  }
                } catch (err) {
                  throw new MobileSetupError({
                    category: 'appium-startup',
                    message: `Could not auto-start Appium: ${err instanceof Error ? err.message : String(err)}`,
                    platform: testPlatform,
                    targetName: testResolvedTarget.name,
                    deviceName: testDeviceName,
                    cause: err,
                  })
                }
              }

              adapter = await createPlatformAdapter(testPlatform)

              const mergedBrowser = (mergedUse as Record<string, unknown>).browser as Record<string, unknown> | undefined
              const platformConfig = buildPlatformConfig(testPlatform, testResolvedDevice, testTimeoutsForSetup, mergedBrowser ?? config.use?.browser, (testMergedConfig as any).use?.logCapture ?? config.use?.logCapture, testFarmSession, testMobileResolved)
              platformConfig.authState = activeTestAuthState
              platformConfig.verbose = effectiveLogLevel === 'debug'
              if (opts.headless !== undefined) {
                if (platformConfig.browser) {
                  platformConfig.browser.headless = opts.headless
                }
              }

              // Wire recording config for this platform adapter
              const anyTestNeedsRecording = filtered.some(t => (t.meta as any)?.record === true)
              if (recordingEnabled || anyTestNeedsRecording) {
                const recCfg = config.services?.recording as Record<string, unknown> | undefined
                platformConfig.recording = {
                  enabled: true,
                  videoDir: resolveDashboardVideoDir(config, configDir, dashboardEnabled),
                  videoSize: recCfg?.videoSize as { width: number; height: number } | undefined,
                }
              }

              await adapter.setup(platformConfig)

              // Exit cleanup for farm sessions on mobile
              if (useFarm && (testPlatform === 'android' || testPlatform === 'ios')) {
                const farmAdapter = adapter
                process.on('exit', () => { void Promise.resolve(farmAdapter.cleanup()).catch(() => {}) })
              }

              if (effectiveLogLevel === 'debug') {
                console.log(pc.dim(`  Platform: ${testPlatform}${useFarm ? ` (farm: ${testResolvedDevice?.transport})` : ''}${testPlatform !== 'web' ? ' (adapter re-created)' : ''}`))
              }
            }

            // Per-test model creation using merged LLM config
            const mergedForLLM = { registry: (config as any).registry, use: (testMergedConfig as any).use ?? (config as any).use }
            const { planner: plannerCfg, verifier: verifierCfg, configName } = resolveLLMModels(mergedForLLM)
            const resolvedAuth = await resolveModelAuth(configName, plannerCfg)
            const { profile: plannerProfile, auth: plannerAuth } = toModelProfileAndAuth(plannerCfg, resolvedAuth)
            const { profile: verifierProfile, auth: verifierAuth } = toModelProfileAndAuth(verifierCfg, resolvedAuth)
            process.env.AGENT_QA_LLM_MODEL = plannerCfg.model
            process.env.AGENT_QA_LLM_PROVIDER = plannerCfg.provider
            if (effectiveLogLevel === 'debug') {
              console.log(pc.dim(`  Model: ${plannerCfg.model} (${plannerCfg.provider})`))
            }
            const plannerModel = createModel(plannerProfile, plannerAuth)
            const verifierModel = createModel(verifierProfile, verifierAuth)
            // D-04 lazy thunk + role-separated accounting instances (see suite-level site).
            const plannerAccounting = createTokenAccounting({ getCapabilities: () => resolveCapabilities(plannerProfile) })
            const verifierAccounting = createTokenAccounting({ getCapabilities: () => resolveCapabilities(verifierProfile) })
            const plannerConfig = {
              maxSubActions: testMergedConfig.use?.planner?.maxSubActions ?? 10,
              previousStepCount: testMergedConfig.use?.planner?.previousStepCount ?? 3,
            }

            const testLogCapture = (testMergedConfig as any).use?.logCapture ?? config.use?.logCapture
            let testEffectiveRules = agentRulesContent ?? ''
            if (testLogCapture?.console === false) {
              testEffectiveRules += '\nConsole log capture is DISABLED for this test run. The readConsoleLogs action will return no data. If a test step explicitly requires reading console logs, use stepFailed to fail the step — do not silently pass with empty data.'
            }
            if (testLogCapture?.network === false) {
              testEffectiveRules += '\nNetwork log capture is DISABLED for this test run. The readNetworkLogs action will return no data. If a test step explicitly requires reading network logs, use stepFailed to fail the step — do not silently pass with empty data.'
            }
            const planner = new LLMPlanner(plannerModel, testPlatform, logger.createScopedLogger('planner'), testEffectiveRules || undefined, plannerAccounting)
            const verifier = new LLMVerifier(verifierModel, verifierAccounting)

            // Per-test timeouts from merged config
            const testTimeouts = {
              step: testMergedConfig.use?.timeout?.step,
              test: testMergedConfig.use?.timeout?.test,
              navigation: testMergedConfig.use?.timeout?.navigation,
            }

            // Per-test recording override: meta.record takes priority over global
            let testRecording: import('@vostride/agent-qa-runner').PlatformConfig['recording'] | undefined
            const testRecordMeta = (testDef.meta as any)?.record
            if (testRecordMeta === true || recordingEnabled) {
              const recCfg2 = config.services?.recording as Record<string, unknown> | undefined
              testRecording = {
                enabled: true,
                videoDir: resolveDashboardVideoDir(config, configDir, dashboardEnabled),
                videoSize: recCfg2?.videoSize as { width: number; height: number } | undefined,
              }
            }
            if (testRecordMeta === false) {
              testRecording = undefined
            }

            const artifactContext = buildRunArtifactContext({
              kind: 'test',
              configContent,
              parsedConfig: config,
              effectiveConfig: testMergedConfig,
              envFilePath: resolvedEnvFilePath,
              rawEnvFileContent,
              envFileVars,
              secretsFileMetadata: runtimeSecrets.secretsFileMetadata,
              cliVars,
              inlineVars,
              hooks: resolvedHooks,
              planner: { provider: plannerCfg.provider, model: plannerCfg.model },
              verifier: { provider: verifierCfg.provider, model: verifierCfg.model },
              platform: testPlatform,
              target: testResolvedTarget,
              deviceName: testDeviceName,
              attributes: testAttributes,
              timeouts: testTimeouts,
              cache: {
                enabled: effectiveCacheEnabled,
                dir: config.services?.cache?.dir,
                ttl: config.services?.cache?.ttl,
              },
              memory: {
                enabled: opts.memory !== false && config.services?.memory?.enabled !== false,
                curatorEnabled: config.services?.memory?.curatorEnabled,
                provider: config.services?.memory?.provider ?? 'local',
              },
              source: {
                kind: 'test',
                testId: testDef['test-id'] ?? null,
                name: testDef.name,
                filePath,
                rawYaml: testFileContent || null,
                resolvedDefinition: testDef,
                loadStatus: 'loaded',
              },
            })

            // Fire onTestStart BEFORE setup hooks so DashboardReporter creates
            // the DB row and runId is available for hook recording (Phase 107 fix)
            await (multiReporter.onTestStart as any)(testDef, filePath, {
              runId,
              artifact: artifactContext.artifact,
            })

            const getAuthAwareSandboxOptions = () => sandboxOptions && activeTestAuthState
              ? { ...sandboxOptions, authState: activeTestAuthState }
              : sandboxOptions
            const authAwareSandboxOptions = getAuthAwareSandboxOptions()

            // Per-test setup hooks: run BEFORE test execution (D-01, D-03)
            let perTestSetupVars: Record<string, string> = {}
            let testStartTime = Date.now()
            let setupHookFailed = false
            let setupFailureResult: TestResult | undefined
            if (resolvedHooks && authAwareSandboxOptions && (testDef as any).setup?.length) {
              const { runHooks } = await import('@vostride/agent-qa-runner')
              const hookDefs: HookDefinition[] = []
              let hookSetupError: string | undefined
              for (const hookId of (testDef as any).setup) {
                const hook = resolvedHooks.get(hookId)
                if (!hook) { hookSetupError = `Hook ID "${hookId}" not found in hooks registry`; break }
                hookDefs.push(hook)
              }

              if (!hookSetupError && hookDefs.length > 0) {
                const allVars: Record<string, string> = { ...envFileVars }
                if (inlineVars) Object.assign(allVars, inlineVars)
                if ((testDef as any).variables) Object.assign(allVars, (testDef as any).variables)
                if (cliVars) Object.assign(allVars, cliVars)

                for (const hookDef of hookDefs) {
                  const hookExecId = randomUUID()
                  await multiReporter.onHookStart({ hookId: hookDef.id, hookName: hookDef.name, phase: 'setup', hookExecutionId: hookExecId, runId })
                  const hookResult = await runHooks([hookDef], { ...authAwareSandboxOptions, envVars: { ...authAwareSandboxOptions.envVars, ...allVars, ...perTestSetupVars } })
                  const hr = hookResult.results.get(hookDef.name)
                  await multiReporter.onHookEnd({
                    hookId: hookDef.id,
                    hookName: hookDef.name,
                    phase: 'setup',
                    hookExecutionId: hookExecId,
                    runId,
                    status: hr?.success ? 'passed' : 'failed',
                    duration: hr?.duration ?? 0,
                    stdout: hr?.stdout ?? '',
                    stderr: hr?.stderr ?? '',
                    variables: hr?.variables ?? {},
                    error: hr?.error,
                  })
                  if (!hr?.success) {
                    hookSetupError = `Setup hook "${hookDef.name}" failed: ${hr?.error ?? 'unknown'}`
                    break
                  }
                  Object.assign(perTestSetupVars, hr.variables)
                  Object.assign(allVars, hr.variables)
                }
              }

              if (hookSetupError) {
                setupHookFailed = true
                const setupResult: TestResult = {
                  runId,
                  name: test.name,
                  filePath,
                  status: 'failed',
                  steps: [],
                  duration: Date.now() - testStartTime,
                  failureSummary: hookSetupError,
                }
                results.push(setupResult)
                setupFailureResult = setupResult
                await multiReporter.onTestEnd(setupResult)
                printRunAttributes(testAttributes)
              }
            }

            if (setupHookFailed) {
              // Synthesized failed TestResult feeds the shell's member-outcome derivation (D-16).
              return setupFailureResult!
            }

            // Memory provider setup (best-effort)
            let memoryProvider: import('@vostride/agent-qa-core').MemoryProvider | undefined
            let memoryInitParams: import('@vostride/agent-qa-core').MemoryIndexParams | undefined
            const memoryConfig = config.services?.memory
            let memoryRoot: string | undefined
            if (opts.memory !== false && memoryConfig?.enabled !== false) {
              try {
                const { createMemoryProvider } = await import('@vostride/agent-qa-core')
                memoryRoot = runtimeMemoryRoot
                memoryProvider = await createMemoryProvider({
                  provider: memoryConfig?.provider ?? 'local',
                  memoryRoot,
                  curatorLockTimeout: memoryConfig?.curatorLockTimeout,
                })
                const product = testResolvedTarget.product
                const testId = testDef['test-id'] ?? testDef.name
                memoryInitParams = { product, testId, memoryRoot }
              } catch (err) {
                console.warn(`  ${pc.dim('Memory:')} init error -- ${(err as Error).message}`)
              }
            }

            const result = await runTestWithRetry(testDef, {
              adapter: adapter!,
              planner,
              verifier,
              plannerModel,
              verifierModel,
              reporters,
              captureScreenshots,
              screenshotMode: (opts.screenshotMode as 'failure' | 'every-step') ?? 'failure',
              cache: effectiveCacheEnabled ? actionCache : undefined,
              // D-08/Q10: the sharp compressor injected from the composition root (sharp left core).
              compressor: buildScreenshotCompressor(logger?.createScopedLogger('adapter')),
              // SEAM-01/03: the ONE run context + gate, ungated from cache enablement (D-09/356).
              masking: singleMaskingContext,
              safetyHooks: singleSafetyHooks,
              workingMemory: singleWorkingMemory,
              storageState: singleStorageState,
              recording: testRecording,
              plannerConfig,
              timeouts: testTimeouts,
              logger,
              configContent,
              testFileContent,
              envFileVars,
              secretStore: runtimeSecrets.secretStore,
              secretRedactor: runtimeSecrets.secretRedactor,
              secretsFileMetadata: runtimeSecrets.secretsFileMetadata,
              inlineVars,
              cliVars,
              hookSetupVars: perTestSetupVars,
              inlineHookDefs: resolvedHooks,
              inlineHookSandboxOptions: authAwareSandboxOptions,
              logCapture: testLogCapture,
              accessibility: config.services?.accessibility,
              accessibilityCheck: runWebAccessibilityCheck,
              vision: resolveVisionConfig(config.services?.vision),
              visionGate: resolveVisionGate({ vision: plannerCfg.vision ?? true }),
              contextWindow: plannerCfg.contextWindow,
              memoryProvider,
              memoryInitParams,
              runId,
              skipReporterOnTestStart: true,
              skipReporterOnTestEnd: testAuthStateUse?.capture === true,
              // D-02/D-03/D-20 run-shell seams: live event emit + run-level cancel + the member's
              // cache digest pair. Retry is preserved (runTestWithRetry) with the seams threaded in.
              events: ctx.events,
              abortSignal: ctx.abortSignal,
              configDigests: perMemberDigest,
            } as any, filePath)

            if (!result.runId) result.runId = runId
            completedResult = result

            if (testAuthStateCapturePaths && result.status === 'passed') {
              try {
                activeTestAuthState = await captureAuthStateForRun({
                  adapter: adapter!,
                  paths: testAuthStateCapturePaths,
                })
                // D-06: a mid-run captured auth state may carry freshly-minted tokens — register its
                // sensitive values so every subsequent egress masks them.
                if (singleMaskingContext) {
                  registerAuthStateIntoMaskingContext(
                    singleMaskingContext,
                    await readAuthStatePayloadBestEffort(activeTestAuthState.storageStatePath),
                  )
                }
              } catch {
                result.status = 'failed'
                result.failureSummary = formatAuthStateCaptureFailure(testAuthStateCapturePaths)
                result.metadata = {
                  ...result.metadata,
                  phase: 'auth-state-capture',
                }
              }
            }

            const teardownSandboxOptions = getAuthAwareSandboxOptions()

            // Per-test teardown hooks: run AFTER test execution (D-01, D-03)
            if (resolvedHooks && teardownSandboxOptions && (testDef as any).teardown?.length) {
              const { runHooks } = await import('@vostride/agent-qa-runner')
              for (const hookId of (testDef as any).teardown) {
                const hook = resolvedHooks.get(hookId)
                if (!hook) continue
                const hookExecId = randomUUID()
                try {
                  await multiReporter.onHookStart({ hookId: hook.id, hookName: hook.name, phase: 'teardown', hookExecutionId: hookExecId, runId })
                  const allVars: Record<string, string> = { ...envFileVars, ...perTestSetupVars }
                  if (cliVars) Object.assign(allVars, cliVars)
                  const hookResult = await runHooks([hook], { ...teardownSandboxOptions, envVars: { ...teardownSandboxOptions.envVars, ...allVars } })
                  const hr = hookResult.results.get(hook.name)
                  await multiReporter.onHookEnd({
                    hookId: hook.id,
                    hookName: hook.name,
                    phase: 'teardown',
                    hookExecutionId: hookExecId,
                    runId,
                    status: hr?.success ? 'passed' : 'failed',
                    duration: hr?.duration ?? 0,
                    stdout: hr?.stdout ?? '',
                    stderr: hr?.stderr ?? '',
                    variables: hr?.variables ?? {},
                    error: hr?.error,
                  })
                } catch {}
              }
            }

            // Capture farm session URL and device context for metadata
            if (useFarm && adapter) {
              try {
                const farmSessionUrl = (adapter as any).getSessionUrl?.()
                result.metadata = {
                  ...result.metadata,
                  ...(farmSessionUrl ? { farmSessionUrl } : {}),
                  runDevice: testPlatform === 'web'
                    ? `${config.use?.browser?.name ?? 'chromium'} (remote)`
                    : `${testResolvedDevice?.name ?? testPlatform} (remote)`,
                }
                if (result.status === 'failed') {
                  (adapter as any).markFailed?.()
                }
              } catch { /* best-effort session URL capture */ }
            } else {
              result.metadata = {
                ...result.metadata,
                runDevice: testPlatform === 'web'
                  ? `${config.use?.browser?.name ?? 'chromium'} (local)`
                  : `${testResolvedDevice?.name ?? testPlatform} (local)`,
              }
            }

            // D-10: the memory-ablation re-run and the circuit breaker are deleted — no
            // ablation second-attempt, no runaway-mitigation counters. Failed tests keep
            // single-attempt semantics; the curator runs unconditionally on the result.
            const authStateCaptureFailed = result.metadata?.phase === 'auth-state-capture'

            // Memory curator: inline blocking after teardown hooks (D-02)
            if (memoryProvider && memoryConfig?.curatorEnabled !== false) {
              try {
                const { runCurator } = await import('@vostride/agent-qa-core')
                const injectedObservationIds = new Map<number, string[]>()
                for (let i = 0; i < result.steps.length; i++) {
                  const ids = memoryProvider.getInjectedObservations(i)
                  if (ids.length > 0) injectedObservationIds.set(i, ids)
                }
                const curatorProduct = testResolvedTarget.product
                const testId = testDef['test-id'] ?? testDef.name
                const memoryLog = await runCurator({
                  testResult: result,
                  provider: memoryProvider,
                  model: plannerModel,
                  memoryRoot: memoryRoot ?? runtimeMemoryRoot,
                  product: curatorProduct,
                  testId,
                  injectedObservationIds,
                  trustConfirmDelta: memoryConfig?.trustConfirmDelta,
                  trustContradictDelta: memoryConfig?.trustContradictDelta,
                });
                (result as any).memoryLog = memoryLog
                printMemoryStatus(memoryLog)
                if (dashboardDb && currentRunId) {
                  try {
                    dashboardDb.updateRun(currentRunId, { memoryLog: JSON.stringify(memoryLog) })
                  } catch { /* DB write failure must not fail the test */ }
                }
              } catch (err) {
                console.warn(`  ${pc.dim('Memory:')} curator error -- ${(err as Error).message}`)
              }
            }

            if (testAuthStateUse?.capture === true) {
              await multiReporter.onTestEnd(result)
            }

            results.push(result)
            printRunAttributes(testAttributes)

            // Post-run cache invalidation is no longer done here (Phase 356, D-03/D-13):
            // the redesigned per-key ActionPlanCache invalidates the exact failed decision
            // point inside the runner loop (loop/index.ts on a failed step). The retired v1
            // batch recompute cannot reproduce the new opaque masked keys (they fold a runtime
            // screenIdentityHash and carry no raw step text on disk, D-06), so the loop owns
            // invalidation and no CLI-side key recompute remains.

            return result
          } finally {
            if (adapter) await adapter.cleanup()
            // WM-02 (D-13): redacted flush + disposal on every run outcome (pass/fail/error).
            // The helper never throws, so the run exit code is untouched (Pitfall 5).
            await flushWorkingMemory(singleWorkingMemory, {
              artifactsDir: resolvePath(configDir, config.services?.dashboard?.artifactsDir ?? RUNTIME_ARTIFACTS_DIR),
              mask: singleMaskingContext ? (value: string) => singleMaskingContext!.mask(value) : undefined,
            })
          }
          } catch (err) {
            // 363-09 (D-16): mobile setup-failure telemetry previously fed the v1 AnalyticsRunReporter
            // here. Analytics now rides the bus via `createAnalyticsRunSubscriber`; a pre-runner setup
            // failure re-throws (below) into the framework-error path and emits no testFinished envelope,
            // so this niche pre-runner telemetry is a known gap (re-addressable when the runner emits a
            // failure envelope for it). The normal completion path is fully covered by the bus subscriber.
            throw err
          }
        }

        // ---- Compose the ONE RunSession per invocation (D-01/D-04, SESSION-01/04) ---------------
        // Each discovered test file is a member of ONE RunSession. Members carry NO failFastGroup —
        // ungrouped members never fail-fast (Plan 04 port contract), so today's run-all-then-aggregate
        // behavior is preserved (the old parallel batching + --bail short-circuit are dropped, the
        // single-test analog of Plan 10's suite-parent parallel drop under the one-RunSession law).
        // The run-level SIGINT routes into session.cancel(); the D-14 verdict map owns the exit code.
        let shutdownRequested = false
        let activeRunSession: { cancel(): void } | undefined
        // A throw out of a member closure is a framework/setup error (not a test failure): the shell
        // absorbs executor throws into failed members (D-13, never crashes the run), so we capture the
        // first one, cancel the run, and re-surface it after `done` to preserve the exit-2 contract.
        let frameworkError: unknown | undefined
        // SESSION-04 force-exit backstop (Plan 361-13 Task 3): armed on cancel, cleared after
        // `await session.done` (and BEFORE any frameworkError re-throw so the exit-2 contract holds).
        let graceTimer: ReturnType<typeof setTimeout> | undefined
        // RUNX-02 / D1: route both signals through the controller so a SECOND Ctrl+C HARD force-exits
        // (130) immediately, independent of the grace timer and of any wedged async `done`. The
        // grace-timer arming/unref/clear stays inline here so the 361-13 backstop anchors hold.
        const shutdownController = createShutdownController({
          cancel: () => { try { activeRunSession?.cancel() } catch { /* cancel is best-effort */ } },
          exit: (code) => process.exit(code),
          setExitCode: (code) => { shutdownRequested = true; process.exitCode = code },
          armGrace: () => {
            const grace = setTimeout(() => process.exit(130), cancelGraceMs())
            grace.unref?.()
            graceTimer = grace
          },
        })
        // `on`, not `once`, so a repeated Ctrl+C reaches the controller's hard force-exit path.
        process.on('SIGINT', shutdownController.handleSignal)
        process.on('SIGTERM', shutdownController.handleSignal)

        // Pre-read each member's test file content for the ONE digest mint (D-20). Mirrors the
        // closure's own per-file read; digests must be resolved before startRun (D-04).
        const { readFile: readMemberFile } = await import('node:fs/promises')
        const members: RunMemberDescriptor[] = []
        const memberBindings: Array<(ctx: MemberTestRunContext) => Promise<TestResult>> = []
        const digestMembers: Array<{ testFileContent: string }> = []
        let perMemberDigests: ConfigDigests[] = []

        for (let i = 0; i < filtered.length; i++) {
          const test = filtered[i]
          const memberFilePath = files.find(f =>
            parseResult.tests.some(t => t.name === test.name),
          ) ?? 'unknown'
          let memberFileContent = ''
          if (memberFilePath !== 'unknown') {
            try { memberFileContent = await readMemberFile(memberFilePath, 'utf-8') } catch { /* best-effort */ }
          }
          const globalIndex = i
          members.push({
            testId: (test as any)['test-id'] ?? test.name,
            testIndex: globalIndex,
            name: test.name,
            // NO failFastGroup — the single-test path runs all members then aggregates.
            // 363 D-01: filePath + totalSteps parity fields; no suite grouping on the single-test path.
            ...(memberFilePath !== 'unknown' ? { filePath: memberFilePath } : {}),
            totalSteps: test.steps.length,
          })
          digestMembers.push({ testFileContent: memberFileContent })
          memberBindings.push((ctx) => runOneDirectTest(test, ctx, perMemberDigests[globalIndex]))
        }

        // D-20: the ONE digest mint — per-member cache pairs (suiteFileContent absent ⇒ a
        // single-member run collapses the run-level pair to the member values).
        const runDigests = computeRunConfigDigests({ configContent, members: digestMembers })
        perMemberDigests = runDigests.perMember

        // RUNX-06 invariant (defense-in-depth): the `filtered.length === 0` guard above makes this
        // unreachable, but assert it at the session boundary so no future refactor can start a
        // zero-member RunSession that renders a silent "0 of 0" summary.
        if (members.length === 0) {
          console.error(pc.red('Error: Refusing to start a run with zero members (no runnable tests resolved).'))
          process.exit(2)
        }

        const singleRunId = process.env.AGENT_QA_RUN_ID ?? generateRunId()
        let singleRunProduct = 'unknown'
        try {
          singleRunProduct = resolveTarget(config, filtered[0].target!).product ?? 'unknown'
        } catch { /* best-effort; the member closure surfaces the real target error as a framework error */ }
        const singleExecutionContext = resolveRunExecutionContext()
        const singleBuildOrdinal = await resolveRunBuildOrdinal({ configDir, product: singleRunProduct })
        const singleRunPorts = buildRunPorts({ configDir, runId: singleRunId })

        const executor: MemberTestExecutor = async (member, ctx) => {
          const binding = memberBindings[ctx.testIndex]
          if (!binding) {
            throw new Error(`No test-member binding for testIndex ${ctx.testIndex} (testId ${member.testId})`)
          }
          try {
            return await binding(ctx)
          } catch (err) {
            if (frameworkError === undefined) {
              frameworkError = err
              try { activeRunSession?.cancel() } catch { /* best-effort */ }
            }
            return {
              runId: member.testId,
              name: member.name ?? member.testId,
              filePath: 'unknown',
              status: 'failed',
              steps: [],
              duration: 0,
              failureSummary: err instanceof Error ? err.message : String(err),
            }
          }
        }

        // SEAM-01/03/04 (362-06): the SAME helpers as the suite path (Pitfall 7 — this is the common
        // local-dev invocation and 363's demo path, it must not lag). Seed from secrets + env (auth
        // registers dynamically per-test via D-06 at resolve/capture), stamp the per-run sink, build
        // the per-run gate, and run the whole body inside runSafetyScope; dispose the context LAST.
        //
        // MASKING BOUNDARY (363-09, RESEARCH Q7 item 3): placeholders only exist AFTER this seam. The
        // pre-run validation-error DB writes + crash-finalizer above run BEFORE the MaskingContext, so
        // they carry no placeholders and need no unmask call; humans see post-seam prose through the
        // console reporter (the sole unmasking surface).
        const maskingContext = buildRunMaskingContext({
          secretStore: runtimeSecrets.secretStore,
          env: process.env,
        })
        const auditSink = buildRunAuditSink({ configDir, runId: singleRunId, executionContext: singleExecutionContext })
        const trustMode = opts.trustSession === true || config.safety?.trustMode === true
        // D-11 (363-09): the console pause/resume seam bound to the console reporter in attachRunSubscribers
        // below; buildRunSafetyHooks composes the unmask decorator OVER the timed decorator (Pitfall 4).
        const livePause = createLivePauseController()
        const { safetyHooks, confirmPausedMs } = buildRunSafetyHooks({ auditSink, executionContext: singleExecutionContext, trustMode, maskingContext, live: livePause })
        singleMaskingContext = maskingContext
        singleSafetyHooks = safetyHooks

        // 363-09: run-level bus subscribers (Pitfall 8 — the SAME attach helper the suite path uses).
        // Analytics rides the bus (D-16); the dashboard ingest (when the dashboard DB exists) writes
        // runs/run_artifacts rows as a subscriber (D-08), adopting the plain/retry correlation env.
        const singleExtraSubscribers: RunSubscriberHandle[] = []
        if (dashboardDb) {
          // The primary run row is adopted from AGENT_QA_RUN_ID and refreshed from the bus envelope
          // stream (testStarted identity, testFinished status/duration, stepFinalized steps). The
          // resolved per-test config/source snapshot lives inside the member closure (D-04), so the
          // ingest seeds identity from the wire; the run row + steps (dashboard history) stay populated.
          const dashboardSubscriber = await buildDashboardIngestSubscriber({
            db: dashboardDb,
            attributes: resolveCliRunAttributes(userRunAttributes, 'local', inheritedRunAttributes),
            onRunCreated: (createdRunId: string) => { currentRunId = createdRunId; logger.setRunId(createdRunId) },
          })
          if (dashboardSubscriber) singleExtraSubscribers.push(dashboardSubscriber)
        }
        singleExtraSubscribers.push(createAnalyticsRunSubscriber({ config, surface: 'cli' }))

        const singleExit = await runSafetyScope({ maskingContext, auditSink, executionContext: singleExecutionContext }, async () => {
          try {
            const session = startRun({
              runId: singleRunId as unknown as Parameters<typeof startRun>[0]['runId'],
              scope: { tier: 'product', key: singleRunProduct },
              executionContext: singleExecutionContext,
              configDigests: runDigests.runLevel,
              buildOrdinal: singleBuildOrdinal,
              members,
              executor,
              masking: maskingContext,
              ports: { ...singleRunPorts, confirmPausedMs },
            })
            activeRunSession = session

            // Attach the bus subscribers (console unmasks; junit + wire masked; dashboard ingest; analytics)
            // via subscribe(0) — replay-then-live gives D-04 for free.
            const subscribers = attachRunSubscribers({
              session,
              maskingContext,
              console: reporterSelection.console ? { verbose: false, logLevel: effectiveLogLevel } : false,
              junitOutputPath: reporterSelection.junit ? opts.junitOutput : undefined,
              extraSubscribers: singleExtraSubscribers,
              live: livePause,
            })

            const { verdict } = await session.done
            if (graceTimer) clearTimeout(graceTimer)
            // Pitfall 6/8: await EVERY subscriber flush (junit write, dashboard finalize, analytics drain)
            // AFTER session.done and BEFORE mapping the verdict / re-throwing a framework error.
            await subscribers.flush()
            activeRunSession = undefined
            shutdownController.dispose()
            process.removeListener('SIGINT', shutdownController.handleSignal)
            process.removeListener('SIGTERM', shutdownController.handleSignal)

            // Re-surface a captured framework/setup error so the existing exit-2 contract holds — the
            // throw stays inside the scope so dispose (finally) runs before it propagates. The grace
            // backstop is already cleared above, so the exit-2 re-throw path is unaffected.
            if (frameworkError !== undefined) {
              throw frameworkError
            }

            // D-14: the verdict-mapped exit code (passed/healed=0, failed/timeout=1, cancelled=130).
            return mapVerdictToExitCode(shutdownRequested ? 'cancelled' : verdict)
          } finally {
            // Pitfall 8: dispose LAST so late maskers (handoff assembly, WM flush) still replace.
            maskingContext.dispose()
          }
        })

        releaseAppium()

        const duration = results.reduce((sum, r) => sum + r.duration, 0)
        const passed = results.filter(r => r.status === 'passed').length
        const failed = results.filter(r => r.status === 'failed').length
        const skipped = results.filter(r => r.status === 'skipped').length

        await multiReporter.onRunEnd({ results, duration, passed, failed, skipped })

        if (dashboardDb) {
          dashboardDb.close()
        }

        // `singleExit` (the D-14 verdict-mapped exit code) is returned from the run-safety scope
        // above. `suitesFailed` (the --all combined path) still forces a nonzero exit when the
        // separately-run suites leg failed.
        const exitCode = singleExit !== 0 ? singleExit : (suitesFailed ? 1 : 0)
        await maybePrintPostRunUpdateNotice({
          reporterSelection,
          effectiveLogLevel,
          liveEvents: process.env.AGENT_QA_LIVE_EVENTS,
          cwd: process.cwd(),
        })
        process.exit(exitCode)
      } catch (err) {
        // RUNX-02 / D1: a better-sqlite3 ABI/bindings mismatch (from 364-02's fail-fast) is an
        // actionable environment problem, not a framework crash. Surface its own guidance calmly and
        // exit clean and non-zero — never an opaque "Framework error" or an unhandled hang.
        if (err instanceof BetterSqlite3AbiMismatchError || isBetterSqlite3AbiMismatch(err)) {
          console.error(pc.red(err instanceof Error ? err.message : String(err)))
          if (_crashDb) { try { _crashDb.close() } catch {} }
          process.exit(1)
        }
        const errMsg = err instanceof Error ? err.message : String(err)
        const errStack = err instanceof Error ? err.stack ?? '' : ''
        const formattedError = formatFrameworkError(errMsg)
        console.error(pc.red(formattedError.displayMessage))

        if (_crashDb) {
          const fullError = `${errMsg}\n${errStack}`
          const isBrowserClose = fullError.includes('Target page, context or browser has been closed')
            || fullError.includes('browser has been closed')
            || fullError.includes('Browser closed')
          try {
            const runs = _crashDb.getRuns({ status: 'running' })
            for (const run of runs) {
              const finalStatus = isBrowserClose ? 'cancelled' : 'failed'
              printRunId(run.id)
              printRunAttributes(run.attributes)
              _crashDb.updateRun(run.id, {
                status: finalStatus,
                duration: run.startedAt ? Date.now() - new Date(run.startedAt).getTime() : 0,
                endedAt: new Date().toISOString(),
                failureSummary: isBrowserClose ? 'Browser closed by user' : redactAuthStateValue(formattedError.failureSummary),
              })
              try {
                const artifact = _crashDb.getRunArtifact(run.id)
                if (artifact && !artifact.finalizedAt) {
                  _crashDb.finalizeRunArtifact(run.id, {
                    runtime: {
                      status: finalStatus,
                      duration: run.startedAt ? Date.now() - new Date(run.startedAt).getTime() : 0,
                    },
                    errors: [{
                      code: isBrowserClose ? 'browser-disconnect' : 'process-close',
                      phase: 'process-close',
                      message: isBrowserClose ? 'Browser closed by user' : redactAuthStateValue(formattedError.failureSummary),
                    }],
                  })
                }
              } catch { /* best-effort cleanup */ }
            }
          } catch { /* best-effort cleanup */ }
        }

        if (_crashDb) {
          try { _crashDb.close() } catch {}
        }
        process.exit(2)
      }
    })

  return cmd
}
