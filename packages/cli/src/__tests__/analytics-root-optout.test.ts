// `analytics.privacy: true`, honoured AT EVERY COMPOSITION ROOT (Phase 398 plan 14, D-19 · ANLY-01).
//
// WHY THIS FILE EXISTS BESIDE A GREEN ZERO-NETWORK DIFFERENTIAL. `packages/analytics` already
// proves that `composeAnalytics` returns a walled transport when a config declares privacy. That
// differential enters ONE LAYER BELOW the seam that was broken: two shipped roots (`chat`, `init`)
// composed their host WITHOUT handing over the config at all, so the decision was correct and its
// input never arrived. A user who set the flag still emitted chat aggregates and init events, and
// every existing cell stayed green. These cells enter at the HOST layer — the shipped command's own
// action — which is the only altitude from which a dropped argument is visible.
//
// THE VACUITY TRAP, AND WHY EVERY CELL ASSERTS `optOutReasons`. `composeAnalytics` returns the noop
// transport in TWO states: the caller opted out, AND the PostHog project key is blank. The
// committed key file ships blank and the release pipeline fills it, so in this test process
// `transportKind` is `'noop'` ALREADY, on every host, with or without a config. A cell asserting
// only `transportKind === 'noop'` would be GREEN ON THE BROKEN BUILD. `optOutReasons` is computed
// by `resolveOptOutReasons` purely from the env and the config, independently of any project key,
// and carries `'config-privacy'` exactly when `config.analytics.privacy === true` REACHED the
// decision. Every cell below therefore asserts the reason on the privacy arm and its ABSENCE on a
// control arm, and asserts `transportKind` beside it — with a non-blank `projectKey` injected
// wherever the seam admits one, so the transport assertion is load-bearing too.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'

import { Command } from 'commander'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createChatCommand } from '../commands/chat.js'
import { composeAnalyticsHost } from '../composition/analytics-host.js'
import type {
  CliAnalyticsHost,
  ComposeAnalyticsHostInput,
} from '../composition/analytics-host.js'

/** A non-blank key, so the opted-IN arm is genuinely `'posthog'` and the transport assert bites. */
const CELL_PROJECT_KEY = 'phc_root_optout_cell'

/**
 * A project on disk, with or without the one boolean under measurement.
 *
 * The shape is the minimal one `chat-command.test.ts` already writes, PLUS `use.mobile.appState`.
 * That addition is load-bearing and was measured, not guessed: `chat-command.test.ts`'s fixture is
 * accepted by the lazy masked reader inside the composition but REJECTED by `resolveConfig`
 * (`use.mobile.appState is required and must be one of: preserve | reset`). A cell built on it
 * would take the tolerant read's `undefined` branch and then assert the privacy arm — proving only
 * that an invalid config is not honoured, which is the availability posture rather than the fix.
 *
 * The privacy arm adds the shipped `analytics.privacy` field from
 * `packages/core/src/schema/analytics-schema.ts`.
 */
function fixtureProject(
  roots: string[],
  options: { readonly privacy?: boolean; readonly withConfig?: boolean } = {},
): { dir: string; configPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'agent-qa-root-optout-'))
  roots.push(dir)
  const configPath = join(dir, 'agent-qa.config.yaml')
  if (options.withConfig === false) return { dir, configPath }

  writeFileSync(
    configPath,
    `${JSON.stringify({
      workspace: {
        testMatch: ['tests/**/*.test.yaml'],
        suiteMatch: ['suites/**/*.suite.yaml'],
        hooksFile: 'hooks.yaml',
        envFile: '.env',
        secretsFile: '.env.secrets.local',
      },
      use: { mobile: { appState: 'reset' } },
      ...(options.privacy === true ? { analytics: { privacy: true } } : {}),
    })}\n`,
    'utf8',
  )
  return { dir, configPath }
}

interface RecordedComposition {
  /** Exactly what the ROOT handed the binding. The argument is what is under measurement. */
  readonly inputs: ComposeAnalyticsHostInput[]
  readonly hosts: CliAnalyticsHost[]
  readonly compose: typeof composeAnalyticsHost
}

/**
 * A recording WRAPPER, not a replacement.
 *
 * It delegates to the REAL `composeAnalyticsHost`, so the opt-out decision, the identity gate and
 * the transport selection every assertion reads are the shipped ones. What it adds is only what
 * keeps the measurement hermetic: `env: {}` so the developer's own ecosystem opt-out variable
 * cannot decide the outcome, a non-blank project key, a transport that records and sends nothing,
 * and an identity stub so no real home directory is touched.
 */
function recordingCompose(): RecordedComposition {
  const inputs: ComposeAnalyticsHostInput[] = []
  const hosts: CliAnalyticsHost[] = []
  const compose = async (input: ComposeAnalyticsHostInput): Promise<CliAnalyticsHost> => {
    inputs.push(input)
    const host = await composeAnalyticsHost({
      ...input,
      env: {},
      projectKey: CELL_PROJECT_KEY,
      posthogTransportFactory: () => ({
        capture: () => {},
        flush: () => {},
        shutdown: () => {},
      }),
      resolveIdentity: async () => ({
        distinctId: 'u_root-optout-cell',
        runtimeContext: 'user' as const,
      }),
    })
    hosts.push(host)
    return host
  }
  return { inputs, hosts, compose }
}

const CHAT_ROOT = 'packages/cli/src/commands/chat.ts'

interface InvocationResult {
  stdout: string
  stderr: string
  exitCode: number | string | undefined
}

/** `chat-command.test.ts`'s idiom: scripted stdin, no tty, a tick before the first line. */
async function runChat(
  configPath: string,
  typed: readonly string[],
  extraDeps: Parameters<typeof createChatCommand>[0] = {},
): Promise<InvocationResult> {
  const stdout: string[] = []
  const stderr: string[] = []
  const log = vi.spyOn(console, 'log').mockImplementation((...values: unknown[]) => {
    stdout.push(values.map(String).join(' '))
  })
  const error = vi.spyOn(console, 'error').mockImplementation((...values: unknown[]) => {
    stderr.push(values.map(String).join(' '))
  })
  const previousExitCode = process.exitCode
  process.exitCode = undefined

  const input = new PassThrough()
  const output = new PassThrough()
  output.resume()

  try {
    const program = new Command()
      .option('--config <path>', 'config file path')
      .addCommand(createChatCommand({ input, output, isTty: false, ...extraDeps }))
    program.exitOverride()
    const parsed = program.parseAsync(['node', 'agent-qa', '--config', configPath, 'chat'])
    await Promise.resolve()
    for (const line of typed) input.write(`${line}\n`)
    input.end()
    await parsed
    return { stdout: stdout.join('\n'), stderr: stderr.join('\n'), exitCode: process.exitCode }
  } finally {
    process.exitCode = previousExitCode
    log.mockRestore()
    error.mockRestore()
  }
}

describe('the chat composition root honours analytics.privacy (398-14, D-19)', () => {
  const roots: string[] = []

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  it('walls the host when the project declares analytics.privacy: true', async () => {
    const { configPath } = fixtureProject(roots, { privacy: true })
    const recorder = recordingCompose()

    await runChat(configPath, ['/quit'], { composeAnalytics: recorder.compose })

    expect(recorder.hosts).toHaveLength(1)
    const host = recorder.hosts[0]
    // BEHAVIOUR FIRST, then the input that produced it. The reason is the discriminator; the
    // transport is item 2b's literal wording, kept and honest.
    expect(
      host?.optOutReasons,
      `${CHAT_ROOT} composed a host that does not report the config opt-out reason — the `
      + 'declaration was dropped between the config file and composeAnalytics',
    ).toContain('config-privacy')
    expect(host?.optedOut).toBe(true)
    expect(host?.transportKind).toBe('noop')
    expect(
      recorder.inputs[0]?.config,
      `${CHAT_ROOT}'s analytics composition root handed no config to the one opt-out decision, `
      + 'so a user\'s analytics.privacy declaration never reached its reader',
    ).toBeDefined()
  })

  it('does NOT report the config reason when no analytics block is declared', async () => {
    const { configPath } = fixtureProject(roots)
    const recorder = recordingCompose()

    await runChat(configPath, ['/quit'], { composeAnalytics: recorder.compose })

    expect(recorder.hosts).toHaveLength(1)
    const host = recorder.hosts[0]
    // The control half. Without it the privacy arm could pass on a host that is walled for an
    // unrelated reason — a blank key, a stray environment variable — and prove nothing.
    expect(host?.optOutReasons).not.toContain('config-privacy')
    expect(host?.optedOut).toBe(false)
    expect(host?.transportKind).toBe('posthog')
  })

  it('still opens a session in a directory with NO config file (the tolerant read cannot refuse)', async () => {
    const { configPath } = fixtureProject(roots, { withConfig: false })
    const recorder = recordingCompose()

    const result = await runChat(configPath, ['/quit'], { composeAnalytics: recorder.compose })

    // T-398-32: refusing a surface over its telemetry configuration would be refusing the
    // capability over the telemetry. An unresolvable config is a real posture, not a failure.
    expect(recorder.hosts).toHaveLength(1)
    expect(result.exitCode === undefined || result.exitCode === 0).toBe(true)
  })
})
