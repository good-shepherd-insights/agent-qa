import { Command } from 'commander'
import { execFileSync, execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import pc from 'picocolors'
import { loadConfigFile } from '../config.js'
import { loadAuthPluginsForRawConfig, toModelProfileAndAuth, type LLMModelAdapter } from '../llm-utils.js'
import { DEFAULT_ANTHROPIC_MODEL } from '../model-defaults.js'
import { loadProviderPluginsForRawConfig } from '../provider-plugins.js'
import {
  discoverWorkspaceFiles,
  formatAppiumInstallGuidance,
  resolveAppiumExecutable,
  resolveWorkspacePaths,
  type AgentQaConfig,
  type ResolvedWorkspacePaths,
} from '@vostride/agent-qa-core'
import { createModel, getProvider } from '@vostride/agent-qa-model'
import { createKnowledgeChecks } from './doctor-knowledge-checks.js'

// 407 D-18: exported so `doctor-knowledge-checks.ts` can build rows this printer prints without
// restating the row contract. The three types are the whole of what a row is.
export type CheckStatus = 'pass' | 'warn' | 'fail' | 'skip'

export interface CheckResult {
  status: CheckStatus
  message: string
}

export interface DoctorCheck {
  name: string
  check: () => Promise<CheckResult>
  fixInstructions: string
}

type DoctorWorkspaceResolution =
  | { ok: true; workspace: ResolvedWorkspacePaths }
  | { ok: false; error: string }

function resolveDoctorWorkspace(
  config: Record<string, unknown>,
  configPath: string,
): DoctorWorkspaceResolution {
  try {
    return {
      ok: true,
      workspace: resolveWorkspacePaths({
        config: config as AgentQaConfig,
        configPath,
      }),
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

type ResolvedDoctorAuth =
  | { kind: 'api-key'; apiKey: string }
  | { kind: 'bearer-token'; token: string }
  | { kind: 'auth-fetch'; fetch: typeof globalThis.fetch; modelAdapter: LLMModelAdapter }
  | { kind: 'unauthenticated'; message: string }
  | { kind: 'missing'; message: string }

interface ActiveLLMConfig {
  name: string
  provider: string
  model: string
  baseURL?: string
  providerHeaders?: Record<string, string>
}

function getActiveLLMConfig(config: Record<string, unknown> | null): ActiveLLMConfig {
  const registry = config?.registry as { llms?: ActiveLLMConfig[] } | undefined
  const use = config?.use as { llm?: string } | undefined
  const llms = registry?.llms ?? []
  const selected = llms.find(llm => llm.name === use?.llm) ?? llms[0]

  if (selected) {
    return selected
  }

  return {
    name: 'default',
    provider: 'anthropic-subscription',
    model: DEFAULT_ANTHROPIC_MODEL,
  }
}

async function resolveActiveLLMAuth(llm: ActiveLLMConfig): Promise<ResolvedDoctorAuth> {
  const { resolveLLMAuth } = await import('@vostride/agent-qa-core') as unknown as {
    resolveLLMAuth: (
      configName: string,
      llmConfig: {
        provider: string
        model: string
        baseURL?: string
        providerHeaders?: Record<string, string>
      },
    ) => Promise<ResolvedDoctorAuth>
  }
  return await resolveLLMAuth(llm.name, {
    provider: llm.provider,
    model: llm.model,
    ...(llm.baseURL ? { baseURL: llm.baseURL } : {}),
    ...(llm.providerHeaders ? { providerHeaders: llm.providerHeaders } : {}),
  }) as ResolvedDoctorAuth
}

// ---------------------------------------------------------------------------
// The row renderer (407-24 · G-407-3).
//
// A diagnostic command is read on the terminal somebody already has. Before this, the composed row
// had no width awareness at all: `padDots` budgeted 60 columns for name-plus-message while the
// composed row is `4 spaces + name + 2 + dots + 2 + message + 2 + status`, and the `Knowledge
// store` FAIL row — whose message embeds a cwd-relative index path — measured 113 columns. At 80
// the terminal soft-wrapped it mid-word and pushed `FAIL` onto the continuation line, detached
// from the check that earned it.
//
// The budget belongs HERE and not in the copy. A message trimmed to fit today grows again the
// first time somebody runs the command from a deeper directory.
// ---------------------------------------------------------------------------

/** The width assumed when neither `process.stdout.columns` nor `COLUMNS` can answer. */
export const DEFAULT_TERMINAL_WIDTH = 80

const ROW_INDENT = '    '
/** Deeper than a row's own four spaces, so a continuation reads as subordinate to the row above. */
const CONTINUATION_INDENT = '      '
const FIX_PREFIX = '      Fix: '
/** Hanging indent: a wrapped instruction lines up under the first word after `Fix: `. */
const FIX_HANGING_INDENT = ' '.repeat(FIX_PREFIX.length)
/** `padDots`' floor, preserved: the gutter degrades rather than going negative. */
const MIN_DOTS = 2
/** `padDots`' original 60-column name-plus-message target, kept as the PREFERRED dot count. */
const DOT_TARGET_COLUMNS = 60

const STATUS_WORDS = {
  pass: 'PASS',
  warn: 'WARN',
  fail: 'FAIL',
  skip: 'SKIP',
} as const satisfies Record<CheckStatus, string>

export type StatusWord = (typeof STATUS_WORDS)[CheckStatus]

const STATUS_COLOURS: Record<StatusWord, (text: string) => string> = {
  PASS: pc.green,
  WARN: pc.yellow,
  FAIL: pc.red,
  SKIP: pc.dim,
}

/**
 * Colour a status WORD, not a status value.
 *
 * The width arithmetic must never see an escape sequence, so the formatters below deal in the
 * bare four-character word and colour is applied at emit time by handing this function to
 * `composeRow` as a decorator. Taking the word (rather than the `CheckStatus`) is what lets it BE
 * that decorator.
 */
export function formatStatus(statusWord: string): string {
  const paint = STATUS_COLOURS[statusWord as StatusWord]
  return paint === undefined ? statusWord : paint(statusWord)
}

/**
 * Why the width is resolved in ONE place, and why it is resolved at all.
 *
 * `process.stdout.columns` is the truth when there is a terminal. There often is not: a piped or
 * captured run has no `columns` at all, and a run whose output is being read by a person through
 * `less` has whatever `COLUMNS` that person exported. Somebody who sets `COLUMNS` is telling this
 * command something it has no other way to learn, so it is consulted second. 80 is the last
 * resort because it is the width a terminal is assumed to have when nothing says otherwise — the
 * VT100 default every wrapping convention since has inherited.
 */
export function resolveTerminalWidth(): number {
  const columns = process.stdout?.columns
  if (typeof columns === 'number' && Number.isFinite(columns) && columns > 0) {
    return Math.floor(columns)
  }
  const fromEnv = Number.parseInt(process.env.COLUMNS ?? '', 10)
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv
  return DEFAULT_TERMINAL_WIDTH
}

/** The four plain, ANSI-free spans a row is made of. Colour is a property of the SEGMENT. */
export interface RowSegments {
  name: string
  dots: string
  /** The message when it shares the head line; the EMPTY STRING when it moved beneath the row. */
  message: string
  status: string
}

export interface RowDecoration {
  dots: (segment: string) => string
  status: (segment: string) => string
}

/** Composes the plain line: the decorators the formatter itself uses to derive `plainLine`. */
export const IDENTITY_DECORATION: RowDecoration = {
  dots: segment => segment,
  status: segment => segment,
}

/**
 * THE ONE PLACE THE COMPOSITION IS WRITTEN DOWN.
 *
 * `formatCheckRow` runs it with identity decorators to derive `plainLine`; the emit loop runs it
 * with `{ dots: pc.dim, status: formatStatus }` to print. There is therefore no second copy of the
 * recipe to drift out of step with the first: the pinned line and the shipped line are the same
 * recipe run twice, and they differ by exactly the escape sequences and by nothing else.
 *
 * A design where the emit loop restated the template would be one string edit away from a pin that
 * silently stopped measuring the line the command actually prints.
 */
export function composeRow(segments: RowSegments, decorate: RowDecoration): string {
  const head = `${ROW_INDENT}${segments.name}  ${decorate.dots(segments.dots)}`
  const middle = segments.message === '' ? '' : `  ${segments.message}`
  return `${head}${middle}  ${decorate.status(segments.status)}`
}

export interface CheckRow extends RowSegments {
  /** The head line, ANSI-free — what every width assertion and the byte-identical pin measure. */
  plainLine: string
  /** Already-indented wrapped message lines; empty when the row fits on one line. */
  continuations: string[]
}

/**
 * Wrap on word boundaries, never inside a word.
 *
 * A word wider than the budget gets its own line UNCUT and is the only line that may exceed the
 * width. That is deliberate: the over-long tokens this command prints are index paths and shas,
 * and a path silently truncated to fit is a diagnostic a person copies and cannot use.
 *
 * The `/\s+/` split is a NO-OP on separators now (407-29): every caller hands it a pre-flattened
 * string, so it can no longer be the place where a narrow terminal quietly normalises spacing a
 * wide terminal printed verbatim. The two paths see the same bytes and differ only in where the
 * line breaks fall.
 */
function wrapWords(text: string, budget: number): string[] {
  const words = text.split(/\s+/).filter(word => word.length > 0)
  const lines: string[] = []
  let current = ''

  for (const word of words) {
    if (current === '') {
      current = word
    } else if (current.length + 1 + word.length <= budget) {
      current = `${current} ${word}`
    } else {
      lines.push(current)
      current = word
    }
  }
  if (current !== '') lines.push(current)

  return lines
}

/**
 * The dot gutter, clamped so the composed row cannot exceed the width.
 *
 * The clamp only ever REMOVES dots the 60-column target would have added past the resolved width;
 * it never adds any. That is what makes the byte-identical pin exactly true rather than
 * approximately true — a row that already fits keeps the precise gutter it has today. The
 * overhead is measured by composing with an empty dot run rather than by re-adding the separator
 * widths by hand, so the arithmetic cannot drift from `composeRow`'s template.
 */
function segmentsFor(name: string, message: string, statusWord: string, width: number): CheckRow {
  const preferred = Math.max(MIN_DOTS, DOT_TARGET_COLUMNS - (name.length + message.length))
  const bare: RowSegments = { name, dots: '', message, status: statusWord }
  const affordable = width - composeRow(bare, IDENTITY_DECORATION).length
  const segments: RowSegments = {
    ...bare,
    dots: '.'.repeat(Math.max(MIN_DOTS, Math.min(preferred, affordable))),
  }

  return {
    ...segments,
    plainLine: composeRow(segments, IDENTITY_DECORATION),
    continuations: [],
  }
}

/**
 * A message is ONE LINE by the time the budget sees it (407-29 · G-407-14).
 *
 * A producer newline is not a layout instruction — it is a byte that would silently push the
 * status word off the name line, past a length check that counted it as ONE COLUMN. Nothing this
 * renderer prints is a literal the repository controls: an arbitrary `err.message`, a plugin's
 * `auth.message`, a 60-character slice of a provider SDK error and a join of Zod issue messages
 * all arrive here as-is. So the normalisation happens at the door, once, before any arithmetic:
 * every whitespace run — newline, carriage return, tab, form feed — collapses to a single space,
 * and the result is trimmed. A whitespace-only message therefore becomes the empty string and
 * takes the no-message shape, which is the right rendering of nothing to say.
 */
function flatten(message: string): string {
  return message.replace(/\s+/gu, ' ').trim()
}

/**
 * A row in one of TWO shapes, chosen by ONE law: the status word never leaves the name line.
 *
 * The law is only true because the message is FLATTENED first: `String.length` and display
 * columns are the same number for a single line and different numbers for a string carrying a
 * break, and the shape is chosen by comparing that length to the width.
 *
 * A reader scanning a column of statuses is scanning the left-hand names beside them, so a `FAIL`
 * that soft-wrapped onto a continuation line reads as the verdict of the row below it. When the
 * one-line composition fits the width it is emitted exactly as it always was. When it does not,
 * the head line is name + gutter + status and the message follows beneath it, indented and
 * word-wrapped.
 *
 * The return is SEGMENTS rather than finished text because colour is a property of the segment —
 * `dots` is dim, `status` is status-coloured, the message is plain. A formatter that returned
 * composed text would force its caller to re-discover those spans by pattern-matching, which is
 * both fiddly and the likeliest way the byte-identical pin quietly stops measuring the shipped
 * line. Width is a PARAMETER, not a read of `process.stdout`, so a test can measure the renderer
 * at a width it chose.
 */
export function formatCheckRow(
  name: string,
  message: string,
  status: CheckStatus,
  width: number,
): CheckRow {
  const flat = flatten(message)
  const statusWord = STATUS_WORDS[status]
  const oneLine = segmentsFor(name, flat, statusWord, width)
  if (flat === '' || oneLine.plainLine.length <= width) return oneLine

  const head = segmentsFor(name, '', statusWord, width)
  return {
    ...head,
    continuations: wrapWords(flat, width - CONTINUATION_INDENT.length)
      .map(line => `${CONTINUATION_INDENT}${line}`),
  }
}

/**
 * The `Fix:` line, wrapped with a hanging indent.
 *
 * The UAT measured this line at 156 columns — the widest the command emits. Its first element
 * still begins with the same six-space `Fix: ` prefix the command has always written, so a
 * substring assertion on a short instruction is unaffected; continuations hang under it so they
 * read as belonging to the row above rather than as rows of their own.
 *
 * Flattened at the door for the same reason the check row is: an instruction carrying a break
 * would otherwise smuggle one past the hanging indent, and a continuation that is not indented
 * reads as a row of its own.
 */
export function formatFixLines(instructions: string, width: number): string[] {
  const flat = flatten(instructions)
  const wrapped = wrapWords(flat, Math.max(1, width - FIX_PREFIX.length))
  if (wrapped.length === 0) return [`${FIX_PREFIX}${flat}`]
  return wrapped.map((line, index) => (
    index === 0 ? `${FIX_PREFIX}${line}` : `${FIX_HANGING_INDENT}${line}`
  ))
}


function checkNodeVersion(): DoctorCheck {
  return {
    name: 'Node.js',
    fixInstructions: 'Install Node.js 24+ from https://nodejs.org/',
    check: async () => {
      const version = process.version
      const major = parseInt(version.slice(1).split('.')[0], 10)
      if (major >= 24) {
        return { status: 'pass', message: version }
      }
      return { status: 'fail', message: `${version} (requires 24+)` }
    },
  }
}

function checkConfigFile(configPath: string): DoctorCheck {
  return {
    name: 'Config file',
    fixInstructions: 'Run `agent-qa init` to create a config file',
    check: async () => {
      if (existsSync(configPath)) {
        return { status: 'pass', message: 'agent-qa.config.yaml found' }
      }
      return { status: 'warn', message: 'agent-qa.config.yaml not found' }
    },
  }
}

function checkLegacyV1MemoryData(configPath: string): DoctorCheck {
  const legacyMemoryDir = resolve(dirname(resolve(configPath)), 'agent-qa-memory')

  return {
    name: 'Legacy v1 memory data',
    fixInstructions: `Remove ${legacyMemoryDir} manually if you no longer need the retired v1 data.`,
    check: async () => {
      if (existsSync(legacyMemoryDir)) {
        return {
          status: 'warn',
          message: `v1 memory data found at ${legacyMemoryDir} — no longer used by agent-qa; safe to delete`,
        }
      }
      return { status: 'pass', message: `no v1 memory data found at ${legacyMemoryDir}` }
    },
  }
}

function checkConfigValidation(config: Record<string, unknown> | null): DoctorCheck {
  return {
    name: 'Config validation',
    fixInstructions: 'Fix the config errors above, or delete agent-qa.config.yaml and re-run `agent-qa init`',
    check: async () => {
      if (!config) {
        return { status: 'skip', message: 'no config to validate' }
      }

      try {
        const { AgentQaConfigSchema } = await import('@vostride/agent-qa-core')
        const result = AgentQaConfigSchema.safeParse(config)
        if (result.success) {
          return { status: 'pass', message: 'config schema valid' }
        }

        const issues = result.error.issues.slice(0, 3)
        const errors = issues.map((i: { path: PropertyKey[]; message: string }) =>
          `${i.path.map(String).join('.')}: ${i.message}`
        ).join('; ')
        return { status: 'fail', message: errors }
      } catch {
        return { status: 'warn', message: 'could not validate config' }
      }
    },
  }
}

function checkSecretsFile(config: Record<string, unknown> | null, configPath: string): DoctorCheck {
  return {
    name: 'Secrets file',
    fixInstructions: 'Set workspace.secretsFile in agent-qa.config.yaml and create the file. It may be empty, but it must exist.',
    check: async () => {
      if (!config) {
        return { status: 'skip', message: 'no config' }
      }

      const resolved = resolveDoctorWorkspace(config, configPath)
      if (!resolved.ok) {
        return { status: 'fail', message: resolved.error }
      }

      if (!existsSync(resolved.workspace.secretsFile.absolutePath)) {
        return { status: 'fail', message: `not found: ${resolved.workspace.secretsFile.absolutePath}` }
      }

      return { status: 'pass', message: `${resolved.workspace.secretsFile.workspaceRelativePath} found` }
    },
  }
}

function checkWorkspaceSupportFiles(config: Record<string, unknown> | null, configPath: string): DoctorCheck {
  return {
    name: 'Workspace files',
    fixInstructions: 'Create the files configured by workspace.hooksFile and workspace.envFile.',
    check: async () => {
      if (!config) {
        return { status: 'skip', message: 'no config' }
      }

      const resolved = resolveDoctorWorkspace(config, configPath)
      if (!resolved.ok) {
        return { status: 'fail', message: resolved.error }
      }

      const missing = [
        ['workspace.hooksFile', resolved.workspace.hooksFile],
        ['workspace.envFile', resolved.workspace.envFile],
      ] as const
      const missingFiles = missing.filter(([, file]) => !existsSync(file.absolutePath))

      if (missingFiles.length > 0) {
        return {
          status: 'fail',
          message: missingFiles.map(([key, file]) => `${key} -> ${file.absolutePath}`).join('; '),
        }
      }

      return { status: 'pass', message: 'hooks and env file found' }
    },
  }
}

function checkDocker(): DoctorCheck {
  return {
    name: 'Docker',
    fixInstructions: 'Install Docker Desktop from https://docker.com/ and ensure the daemon is running',
    check: async () => {
      try {
        const { checkDockerAvailable } = await import('@vostride/agent-qa-runner-local')
        const available = await checkDockerAvailable()
        if (available) {
          return { status: 'pass', message: 'Docker daemon running' }
        }
        return { status: 'warn', message: 'Docker not available (hooks require Docker)' }
      } catch {
        return { status: 'warn', message: 'Docker not available (hooks require Docker)' }
      }
    },
  }
}

function checkLLMApiKey(config: Record<string, unknown> | null): DoctorCheck {
  return {
    name: 'LLM credential',
    fixInstructions: 'Run `agent-qa auth set --config <name> --type api-key` for API modes, or declare a subscription auth plugin and authenticate from `agent-qa dashboard`.',
    check: async () => {
      const llm = getActiveLLMConfig(config)
      try {
        const auth = await resolveActiveLLMAuth(llm)
        switch (auth.kind) {
          case 'api-key':
            return { status: 'pass', message: 'Saved API key' }
          case 'bearer-token':
            return { status: 'pass', message: 'Saved bearer token' }
          case 'auth-fetch':
            return { status: 'pass', message: 'OAuth connected' }
          case 'unauthenticated':
            return { status: 'pass', message: `credential optional — ${auth.message}` }
          case 'missing':
            return { status: 'fail', message: auth.message }
        }
      } catch (err: unknown) {
        return { status: 'warn', message: err instanceof Error ? err.message : 'could not resolve LLM credential' }
      }
    },
  }
}

function checkSubscriptionAuth(config: Record<string, unknown> | null): DoctorCheck {
  return {
    name: 'Subscription Auth',
    fixInstructions: 'Install `@vostride/agent-qa-subscription-auth`, declare it in plugins.auth, and authenticate from `agent-qa dashboard`.',
    check: async () => {
      const llm = getActiveLLMConfig(config)
      if (getProvider(llm.provider)?.subscription !== true) {
        return { status: 'skip', message: `subscription not used for ${llm.provider}` }
      }

      try {
        const auth = await resolveActiveLLMAuth(llm)
        if (auth.kind === 'auth-fetch') {
          return { status: 'pass', message: 'OAuth connected' }
        }
        if (auth.kind === 'missing') {
          return { status: 'warn', message: auth.message }
        }
        return { status: 'warn', message: 'Subscription providers use OAuth login' }
      } catch {
        return { status: 'warn', message: 'could not check auth store' }
      }
    },
  }
}

function checkLLMConnection(config: Record<string, unknown> | null): DoctorCheck {
  return {
    name: 'LLM connection',
    fixInstructions: 'Check the saved credential, model name, and exact base URL. Run `agent-qa auth test --config <name>` for details.',
    check: async () => {
      if (!config) {
        return { status: 'skip', message: 'no config' }
      }

      const llm = getActiveLLMConfig(config)
      const provider = llm.provider
      const baseURL = llm.baseURL

      if (getProvider(provider)?.needsBaseURL && (!baseURL || baseURL.trim() === '')) {
        return { status: 'fail', message: `baseURL required for ${provider}` }
      }

      try {
        const auth = await resolveActiveLLMAuth(llm)
        if (auth.kind === 'missing') {
          return { status: 'fail', message: auth.message }
        }
        const { generateText } = await import('ai')
        const { profile, auth: modelAuth } = toModelProfileAndAuth(llm, auth as any)
        const testModel = createModel(profile, modelAuth)
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 10000)
        try {
          await generateText({
            model: testModel,
            prompt: 'Say "ok"',
            abortSignal: controller.signal,
          })
        } finally {
          clearTimeout(timeout)
        }
        if (auth.kind === 'unauthenticated') {
          return { status: 'pass', message: auth.message }
        }
        return { status: 'pass', message: 'connected' }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (/auth|unauthorized|401|invalid.*key/i.test(msg)) {
          return { status: 'fail', message: 'Authentication failed. Check the saved credential for this config.' }
        }
        if (/model|not found|404/i.test(msg)) {
          return { status: 'fail', message: 'Model not found. Check the model name.' }
        }
        if (/rate.?limit|429/i.test(msg)) {
          return { status: 'warn', message: 'rate limited — try again later' }
        }
        if (/ECONNREFUSED|ENOTFOUND|timeout|abort/i.test(msg)) {
          return { status: 'fail', message: 'Network error. Check the exact base URL and try again.' }
        }
        return { status: 'fail', message: msg.slice(0, 60) }
      }
    },
  }
}

function checkPlaywright(config: Record<string, unknown> | null): DoctorCheck {
  return {
    name: 'Playwright',
    fixInstructions: 'Run `agent-qa install-browsers --chromium`',
    check: async () => {
      // Skip if no browser config (mobile-only)
      const browsers = config?.browsers as unknown[] | undefined
      const hasBrowsers = browsers && browsers.length > 0
      if (!hasBrowsers && !isWebPlatform(config)) {
        return { status: 'skip', message: 'not configured' }
      }

      try {
        execSync('npx playwright --version', { stdio: 'pipe' })
        return { status: 'pass', message: 'installed' }
      } catch {
        return { status: 'fail', message: 'not installed' }
      }
    },
  }
}

function appiumResolverCwd(configPath: string): string {
  return dirname(resolve(configPath))
}

function mobileDriverInstallCommand(): string {
  return 'agent-qa install-mobile-drivers --all'
}

function checkAppium(config: Record<string, unknown> | null, configPath: string): DoctorCheck {
  return {
    name: 'Appium',
    fixInstructions: `${formatAppiumInstallGuidance()} Then run \`${mobileDriverInstallCommand()}\`.`,
    check: async () => {
      if (!isMobilePlatform(config)) {
        return { status: 'skip', message: 'not configured' }
      }

      try {
        const appium = resolveAppiumExecutable({ cwd: appiumResolverCwd(configPath) })
        const version = execFileSync(appium.command, ['--version'], { stdio: 'pipe' }).toString().trim()
        return { status: 'pass', message: `v${version}` }
      } catch {
        return { status: 'fail', message: 'not installed' }
      }
    },
  }
}

function checkAppiumDrivers(config: Record<string, unknown> | null, configPath: string): DoctorCheck {
  return {
    name: 'Appium drivers',
    fixInstructions: `Run \`${mobileDriverInstallCommand()}\``,
    check: async () => {
      if (!isMobilePlatform(config)) {
        return { status: 'skip', message: 'not configured' }
      }

      try {
        const appium = resolveAppiumExecutable({ cwd: appiumResolverCwd(configPath) })
        const output = execFileSync(appium.command, ['driver', 'list', '--installed'], { stdio: 'pipe' }).toString()
        const hasDrivers = output.includes('uiautomator2') || output.includes('xcuitest')
        if (hasDrivers) {
          return { status: 'pass', message: 'drivers installed' }
        }
        return { status: 'fail', message: 'no drivers installed' }
      } catch {
        return { status: 'fail', message: 'could not check drivers' }
      }
    },
  }
}

function checkAndroidSDK(config: Record<string, unknown> | null): DoctorCheck {
  return {
    name: 'Android SDK',
    fixInstructions: 'Install Android Studio and set ANDROID_HOME environment variable',
    check: async () => {
      if (!hasAndroidPlatform(config)) {
        return { status: 'skip', message: 'not configured' }
      }

      const androidHome = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT
      if (!androidHome) {
        return { status: 'fail', message: 'ANDROID_HOME not set' }
      }

      const adbPath = `${androidHome}/platform-tools/adb`
      if (existsSync(adbPath)) {
        return { status: 'pass', message: 'SDK found' }
      }
      return { status: 'fail', message: 'adb not found in ANDROID_HOME' }
    },
  }
}

function checkXcode(config: Record<string, unknown> | null): DoctorCheck {
  return {
    name: 'Xcode',
    fixInstructions: 'Install Xcode from the Mac App Store and run `xcode-select --install`',
    check: async () => {
      if (!hasIOSPlatform(config)) {
        return { status: 'skip', message: 'not configured' }
      }

      if (process.platform !== 'darwin') {
        return { status: 'fail', message: 'iOS testing requires macOS' }
      }

      try {
        execSync('xcrun simctl list', { stdio: 'pipe' })
        return { status: 'pass', message: 'simctl available' }
      } catch {
        return { status: 'fail', message: 'simctl not available' }
      }
    },
  }
}

function checkValidation(config: Record<string, unknown> | null, configPath: string): DoctorCheck {
  return {
    name: 'Validate',
    fixInstructions: 'Run `agent-qa validate` for full details, then fix reported errors',
    check: async () => {
      if (!config) {
        return { status: 'skip', message: 'no config' }
      }

      const resolved = resolveDoctorWorkspace(config, configPath)
      if (!resolved.ok) {
        return { status: 'fail', message: resolved.error }
      }

      try {
        const { validateProject } = await import('@vostride/agent-qa-core')
        const result = await validateProject({ configPath, workspace: resolved.workspace })

        if (result.errorCount === 0 && result.warningCount === 0) {
          return { status: 'pass', message: `${result.fileCount} files valid` }
        }
        if (result.errorCount === 0) {
          return { status: 'warn', message: `${result.warningCount} warning(s)` }
        }
        return { status: 'fail', message: `${result.errorCount} error(s), ${result.warningCount} warning(s)` }
      } catch {
        return { status: 'warn', message: 'could not run validation' }
      }
    },
  }
}

function checkTestDiscovery(config: Record<string, unknown> | null, configPath: string): DoctorCheck {
  return {
    name: 'Test discovery',
    fixInstructions: 'Add testMatch patterns to agent-qa.config.yaml, or create test files matching your configured patterns',
    check: async () => {
      if (!config) {
        return { status: 'skip', message: 'no config' }
      }

      try {
        const resolved = resolveDoctorWorkspace(config, configPath)
        if (!resolved.ok) {
          return { status: 'fail', message: resolved.error }
        }
        const parts: string[] = []

        const [testFiles, suiteFiles] = await Promise.all([
          discoverWorkspaceFiles({ workspace: resolved.workspace, kind: 'test' }),
          discoverWorkspaceFiles({ workspace: resolved.workspace, kind: 'suite' }),
        ])
        parts.push(`${testFiles.length} test file(s)`)
        parts.push(`${suiteFiles.length} suite file(s)`)

        const total = parts.join(', ')
        if (parts.every(p => p.startsWith('0 '))) {
          return { status: 'warn', message: `no files found — ${total}` }
        }
        return { status: 'pass', message: total }
      } catch {
        return { status: 'warn', message: 'could not scan for test files' }
      }
    },
  }
}

// Helpers to detect platform from config
function getTargetPlatforms(config: Record<string, unknown> | null): string[] {
  const registry = config?.registry as { targets?: Record<string, Record<string, unknown>> } | undefined
  const targets = registry?.targets
    ?? (config?.targets as Record<string, Record<string, unknown>> | undefined)
  if (!targets) return []
  return Object.values(targets).map((t) => (t.platform as string) ?? 'web')
}

function isWebPlatform(config: Record<string, unknown> | null): boolean {
  const platforms = getTargetPlatforms(config)
  if (platforms.length === 0) return true // default
  return platforms.some((p) => p === 'web')
}

function isMobilePlatform(config: Record<string, unknown> | null): boolean {
  const platforms = getTargetPlatforms(config)
  return platforms.some((p) => p === 'android' || p === 'ios')
}

function hasAndroidPlatform(config: Record<string, unknown> | null): boolean {
  return getTargetPlatforms(config).some((p) => p === 'android')
}

function hasIOSPlatform(config: Record<string, unknown> | null): boolean {
  return getTargetPlatforms(config).some((p) => p === 'ios')
}

function getGlobalConfigPath(command: Command): string {
  return command.parent?.opts<{ config?: string }>().config ?? 'agent-qa.config.yaml'
}

export function createDoctorCommand(): Command {
  const cmd = new Command('doctor')
    .description('Validate environment and dependencies')
    .action(async function (this: Command) {
      const configPath = getGlobalConfigPath(this)

      // Try loading config (non-validated, just raw YAML)
      let config: Record<string, unknown> | null = null
      try {
        const loaded = await loadConfigFile(configPath)
        if (loaded && typeof loaded === 'object') {
          config = loaded as Record<string, unknown>
          await loadAuthPluginsForRawConfig(config, configPath)
          await loadProviderPluginsForRawConfig(config, configPath)
        }
      } catch {
        // Config load failed — doctor will report it
      }

      const checks: DoctorCheck[] = [
        checkNodeVersion(),
        checkConfigFile(configPath),
        checkLegacyV1MemoryData(configPath),
        // 407 D-18: the knowledge substrate's three rows sit here — directly after the legacy v1
        // memory row, because they are the same subject — and before config validation, so the
        // rung reads as the conclusion of the store and embedder rows above it.
        ...createKnowledgeChecks({ config, configPath }),
        checkConfigValidation(config),
        checkSecretsFile(config, configPath),
        checkWorkspaceSupportFiles(config, configPath),
        checkDocker(),
        checkLLMApiKey(config),
        checkSubscriptionAuth(config),
        checkLLMConnection(config),
        checkPlaywright(config),
        checkAppium(config, configPath),
        checkAppiumDrivers(config, configPath),
        checkAndroidSDK(config),
        checkXcode(config),
        checkTestDiscovery(config, configPath),
        checkValidation(config, configPath),
      ]

      console.log('')
      console.log(pc.bold('  agent-qa doctor'))
      console.log('')

      let hasFailure = false
      const results: { check: DoctorCheck; result: CheckResult }[] = []

      // 407-24 (G-407-3): every line below goes through the width budget. Colour is applied HERE
      // and only here, by handing named decorators to the same `composeRow` the formatter used to
      // derive its plain line — so the printed line and the pinned one are one recipe run twice.
      //
      // THIS CHANGE IS CONFINED TO ROW RENDERING. No probe, no capability discovery and no
      // registration cleanup is touched by it: the checks above still answer exactly what they
      // answered before, and doctor still only reads.
      const width = resolveTerminalWidth()

      for (const check of checks) {
        const result = await check.check()
        results.push({ check, result })

        const row = formatCheckRow(check.name, result.message, result.status, width)
        console.log(composeRow(row, { dots: pc.dim, status: formatStatus }))
        for (const line of row.continuations) console.log(line)

        if (result.status === 'fail') {
          for (const line of formatFixLines(check.fixInstructions, width)) console.log(pc.dim(line))
          hasFailure = true
        }
      }

      console.log('')
      if (hasFailure) {
        console.log(pc.red('  Some checks failed. See fix instructions above.'))
        process.exitCode = 1
      } else {
        console.log(pc.green('  All checks passed! Your environment is ready.'))
      }
      console.log('')
    })

  return cmd
}
