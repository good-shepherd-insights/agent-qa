// The two D-02 anchors: the SHIPPED binary's enumeration, compared with the in-process one.
//
// WHY THE REST OF THIS DIRECTORY NEEDS THIS FILE. Every other leg of the parity suite reads an
// enumeration composed inside the test process — a real `McpServer` built by the shipped factory, a
// real registry, the shipped planner projection and resolver table. That is the right fidelity for a
// matrix that runs on every PR, and it leaves exactly one question unanswerable from inside: whether
// the thing a person actually installs enumerates the same capabilities. A suite that only ever asks
// its own process is a suite whose subject is its own composition. These two cells spawn
// `dist/cli.js` and ask it.
//
// WHAT IS INDEPENDENT ABOUT THE TWO SIDES, STATED HONESTLY (397-02's lens warning). The workspace
// packages resolve through their BUILT dists in both halves, so `agent`, `agent-local`, `mcp` and
// `schema` are the same artifact on both sides of every comparison here. The axis that genuinely
// differs is THIS package's own bundle: the in-process half runs `packages/cli/src`, and the spawned
// half runs `packages/cli/dist/cli.js`, which is that source after tsup has bundled it and after the
// shipped command path — argument parsing, configuration resolution, credential resolution,
// composition root wiring, process lifecycle — has had its say. A divergence in the shipped command
// path is what these cells can see and no other cell in this directory can. What they cannot see is
// a divergence inside a dependency's dist, because both halves read the same file; the freshness
// guard below is what keeps that shared artifact from being a PREVIOUS revision of the source the
// rest of the suite is reasoning about.
//
// THE FRESHNESS GUARD IS PART OF THE CELL'S CONTRACT, NOT A PRECONDITION SOMEBODY SATISFIED ONCE. A
// stale `dist` is worse than an absent one: an anchor spawned against yesterday's build passes,
// reads as proof of today's source, and certifies the wrong artifact. So the guard refuses on two
// separate conditions — a MISSING built artifact and a built artifact OLDER than the newest
// non-test source file of the package it was built from — and names the offending file in both
// cases. It is an mtime comparison, which catches the failure it exists for (a person, or an agent,
// forgetting to rebuild before measuring) and does not pretend to survive somebody deliberately
// touching a build output.
//
// TEST SOURCES ARE EXCLUDED FROM THE FRESHNESS SCAN ON PURPOSE. tsup's entries are `src/index.ts`
// and `src/cli.ts`; nothing under `__tests__` is bundled into anything. Counting this very file's
// mtime would make every edit to a test look like an unbuilt change to the product, which is the
// kind of false alarm that gets a guard deleted.
//
// HERMETIC, AND WITHOUT A CREDENTIAL ANYWHERE (T-397-17, 396 D-17). Each spawned cell gets its own
// `mkdtemp` project whose configuration is planted throwaway workspace globs and nothing else — no
// token entry, no key, no LLM block — and the child is handed a constructed environment rather than
// this process's, so no ambient provider credential can reach it and no provider can be spent
// against. The chat session the anchor drives is therefore model-unbound by construction and takes
// the deterministic resolver route, which is the route that never touches a model at all.

import { spawn } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { PassThrough } from 'node:stream'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { AGENT_QA_TOOL_PROJECTIONS } from '@vostride/agent-qa-mcp'
import { AgentManifestSchema } from '@vostride/agent-qa-schema'
import { Command } from 'commander'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { loadCapabilityCatalog } from '../../capability-catalog/loader.js'
import { createChatCommand } from '../../commands/chat.js'
import { MCP_STDIO_STARTUP_MESSAGE } from '../../commands/mcp.js'
import { DEFAULT_MCP_SCOPES } from '../../composition/mcp-token-resolution.js'
import { MCP_ENUMERATION_SCOPES, enumerateMcpOpIds, expandMcpListedTools } from './adapters.js'

const CONFORMANCE_DIR = dirname(fileURLToPath(import.meta.url))
/** `packages/cli`. */
const CLI_PACKAGE_ROOT = resolve(CONFORMANCE_DIR, '..', '..', '..')
/** `packages`. */
const PACKAGES_ROOT = resolve(CLI_PACKAGE_ROOT, '..')
const CLI_ENTRY = join(CLI_PACKAGE_ROOT, 'dist', 'cli.js')

const REBUILD_INSTRUCTION =
  'the built artifacts these anchors measure are missing or older than their sources; run '
  + '`pnpm build` at the repository root before running this file (see its header). An anchor '
  + 'spawned against a stale build certifies the PREVIOUS revision while reading as proof of this '
  + 'one.'

// ---- The stale-dist guard ----------------------------------------------------------------------

/**
 * The built artifacts the spawned halves of these cells actually execute.
 *
 * `cli` is bundled from its own source; the other four arrive as their own dists because tsup leaves
 * workspace dependencies external. All five are listed because the enumeration a spawned binary
 * answers with is composed out of all five, and a guard that watched only the entry point would be
 * green while the registry the entry point lists was a revision behind.
 */
const ANCHORED_BUILDS: readonly { readonly pkg: string; readonly artifact: string }[] = Object.freeze(
  [
    Object.freeze({ pkg: 'schema', artifact: join('dist', 'index.js') }),
    Object.freeze({ pkg: 'agent', artifact: join('dist', 'index.js') }),
    Object.freeze({ pkg: 'agent-local', artifact: join('dist', 'index.js') }),
    Object.freeze({ pkg: 'mcp', artifact: join('dist', 'index.js') }),
    Object.freeze({ pkg: 'cli', artifact: join('dist', 'cli.js') }),
  ],
)

/** What a freshness reading found, as data — so a refusal names files rather than a boolean. */
export interface BuildFreshness {
  /** Packages whose built artifact does not exist at all. */
  readonly missing: readonly string[]
  /** Packages whose newest product source is newer than the artifact built from it. */
  readonly stale: readonly string[]
}

/**
 * The newest PRODUCT source under a directory, walked rather than globbed.
 *
 * Test sources are skipped for the reason in this file's header. Everything else under `src` counts,
 * including files a bundler may have tree-shaken away: a guard that tried to model the bundler's
 * reachability would be a second, quieter copy of the build.
 */
function newestProductSource(dir: string): { path: string; mtimeMs: number } | undefined {
  let newest: { path: string; mtimeMs: number } | undefined
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (!entry.isFile()) continue
      if (!/\.(?:ts|tsx|mts|cts|js|mjs|cjs|json)$/u.test(entry.name)) continue
      if (/\.test(?:-d)?\.[cm]?tsx?$/u.test(entry.name)) continue
      const { mtimeMs } = statSync(full)
      if (newest === undefined || mtimeMs > newest.mtimeMs) newest = { path: full, mtimeMs }
    }
  }
  walk(dir)
  return newest
}

/**
 * Whether every artifact these anchors execute exists and post-dates the source it was built from.
 *
 * RETURNED AS DATA rather than thrown or asserted here, so the cells assert it with their own
 * message. Both lists are relative paths, because an absolute path in a failure message is a path
 * that differs on every machine and therefore cannot be recognised.
 *
 * THE ROOT AND THE BUILD LIST ARE ARGUMENTS, and that is what makes the guard's own two branches
 * drivable: the control cell below points it at a synthetic package tree and watches it report a
 * missing artifact and a stale one. A guard whose refusing branches could only be reached by
 * deleting a real `dist` is a guard nobody has watched refuse.
 */
export function buildFreshness(
  builds: readonly { readonly pkg: string; readonly artifact: string }[] = ANCHORED_BUILDS,
  packagesRoot: string = PACKAGES_ROOT,
): BuildFreshness {
  const missing: string[] = []
  const stale: string[] = []
  for (const build of builds) {
    const artifact = join(packagesRoot, build.pkg, build.artifact)
    if (!existsSync(artifact)) {
      missing.push(relative(packagesRoot, artifact))
      continue
    }
    const sourceRoot = join(packagesRoot, build.pkg, 'src')
    if (!existsSync(sourceRoot)) continue
    const newest = newestProductSource(sourceRoot)
    if (newest === undefined) continue
    if (newest.mtimeMs > statSync(artifact).mtimeMs) {
      stale.push(
        `${relative(packagesRoot, newest.path)} is newer than `
        + `${relative(packagesRoot, artifact)}`,
      )
    }
  }
  return { missing, stale }
}

// ---- The comparator ----------------------------------------------------------------------------

/** Which ids one side of an anchor reached and the other did not — both directions, always. */
export interface AnchorDifference {
  readonly onlyInBinary: readonly string[]
  readonly onlyInProcess: readonly string[]
}

/**
 * The difference between two enumerations, as sorted ids.
 *
 * PURE AND EXPORTED so the control cell below can drive both of its branches with synthetic input.
 * A comparator whose disagreeing branch is only reachable by breaking the product is a comparator
 * nobody has watched disagree, and this whole file exists because an anchor that cannot disagree is
 * decoration.
 *
 * BOTH DIRECTIONS, because the two failures are different defects. Ids only the binary has are
 * capabilities the shipped artifact reaches that the suite never measured; ids only the in-process
 * half has are capabilities the suite has been certifying that no shipped artifact serves.
 */
export function anchorDifference(
  binary: ReadonlySet<string>,
  inProcess: ReadonlySet<string>,
): AnchorDifference {
  return {
    onlyInBinary: [...binary].filter((id) => !inProcess.has(id)).sort(),
    onlyInProcess: [...inProcess].filter((id) => !binary.has(id)).sort(),
  }
}

// ---- Fixtures ----------------------------------------------------------------------------------

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/**
 * A real project on disk, produced rather than a literal path handed to a child.
 *
 * `grantConfigWrite` is the one non-default setting and it is what makes the MCP anchor a
 * like-for-like comparison: stdio has no header to carry a scope exception, so without this opt-in
 * the spawned host serves the D-07 default grant (every scope but `config-write`) and hides the two
 * configuration tools, while the in-process adapter enumerates under every scope. Comparing those
 * two would be comparing two different questions and calling the difference a defect.
 *
 * NOTHING SECRET IS PLANTED HERE. There is no token entry, no key and no LLM block: the fixture
 * declares workspace globs and one boolean. That is stronger than planting a throwaway credential,
 * because a value that does not exist cannot be printed by a diagnostic nobody anticipated.
 */
function fixtureProject(
  label: string,
  /**
   * Declared MCP token ENTRIES — names, never values (398-08).
   *
   * Empty for every 397 anchor, which is the posture the paragraph above argues for. The 398-08
   * refs-only cell passes entries because its claim is the opposite one: that a credential which
   * DOES exist is not printed, which nothing can measure without one. An entry here still carries
   * no value — `McpTokenEntrySchema` has no member one could occupy — so what is written into the
   * fixture is a variable NAME, and the value travels only in a constructed child environment.
   */
  tokens: readonly { name: string; tokenEnvVar: string; scopes: readonly string[] }[] = [],
): { root: string; configPath: string } {
  const root = mkdtempSync(join(tmpdir(), `agent-qa-397-07-${label}-`))
  roots.push(root)
  const configPath = join(root, 'agent-qa.config.yaml')
  writeFileSync(
    configPath,
    `${JSON.stringify(
      {
        workspace: {
          testMatch: ['tests/**/*.yaml'],
          testPathIgnore: [],
          suiteMatch: ['suites/**/*.suite.yaml'],
          hooksFile: 'hooks.yaml',
          envFile: '.env',
          secretsFile: '.env.secrets.local',
        },
        use: { mobile: { appState: 'preserve' } },
        services: {
          mcp: {
            stdio: { grantConfigWrite: true },
            ...(tokens.length === 0 ? {} : { tokens }),
          },
        },
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
  mkdirSync(join(root, '.agent-qa'), { recursive: true })
  return { root, configPath }
}

/**
 * The child's whole environment, constructed rather than inherited.
 *
 * INHERITING WOULD MAKE THE CELL'S RESULT DEPEND ON WHOSE MACHINE IT RAN ON: a developer with a
 * provider key exported would be running a different chat composition from CI, and — worse — a
 * spawned process holding a real credential is a process whose stderr can print one. `HOME` and
 * `TMPDIR` point INTO the fixture so nothing the child writes escapes the directory this file
 * deletes.
 */
function hermeticEnv(root: string): Record<string, string> {
  return {
    PATH: process.env.PATH ?? '',
    HOME: root,
    TMPDIR: join(root, '.agent-qa'),
    NODE_ENV: 'test',
  }
}

// ---- The chat comparand ------------------------------------------------------------------------

/**
 * What one chat surface persisted when a conversation opened, as a comparable record.
 *
 * THE COMPARAND IS THE PERSISTED HEADER, and the header's `toolsetHash` is the shipped fingerprint
 * of what the turn engine could reach: `sha256hex16` over the SORTED id set the composed registry
 * lists for the chat caller. Sorting before hashing is what makes it an identity of the SET rather
 * than of a walk, so equality of the two hashes is equality of the two capability sets. Neither half
 * of this cell computes that hash — both sides let the shipped composition write it, which is the
 * only way to compare the recipe rather than a re-spelling of it.
 *
 * `hashShape` exists because `chatToolsetHash` answers the sentinel `'unbound'` for a registry that
 * never finished composing. Two sides that both answered the sentinel would agree perfectly while
 * measuring nothing, and a cell that could pass that way is a cell that will.
 */
export interface ChatAnchorReading {
  readonly sessions: number
  readonly model: string
  readonly toolsetHash: string
  readonly hashShape: 'sha256hex16' | 'unbound-sentinel' | 'unrecognised'
}

function hashShape(value: string): ChatAnchorReading['hashShape'] {
  if (/^[0-9a-f]{16}$/u.test(value)) return 'sha256hex16'
  if (value === 'unbound') return 'unbound-sentinel'
  return 'unrecognised'
}

/** Read whatever chat persisted under a project's runtime root. */
function readChatAnchor(root: string): ChatAnchorReading {
  const sessionsDir = join(root, '.agent-qa', 'sessions')
  const files = existsSync(sessionsDir)
    ? readdirSync(sessionsDir).filter((file) => file.endsWith('.jsonl')).sort()
    : []
  if (files.length !== 1) {
    return { sessions: files.length, model: '', toolsetHash: '', hashShape: 'unrecognised' }
  }
  const [first] = readFileSync(join(sessionsDir, files[0]!), 'utf8').split('\n')
  const header = JSON.parse(first ?? '{}') as { model?: unknown; toolsetHash?: unknown }
  const toolsetHash = typeof header.toolsetHash === 'string' ? header.toolsetHash : ''
  return {
    sessions: files.length,
    model: typeof header.model === 'string' ? header.model : '',
    toolsetHash,
    hashShape: hashShape(toolsetHash),
  }
}

/** The utterance both halves type: the deterministic resolver route, which reaches no model. */
const CHAT_ANCHOR_UTTERANCE = 'proposals'

/**
 * Drive the shipped chat command IN THIS PROCESS, over the same scripted-stdin idiom the spawned
 * half uses.
 *
 * THE SAME COMMAND, NOT AN IMITATION OF IT. The in-process half could have composed a host and
 * invoked `agent.ask` directly, and it would then have been comparing the binary against a path
 * nobody ships. Driving `createChatCommand` means the only difference between the two halves is
 * which artifact the command came out of — source here, bundle there — which is precisely the axis
 * this anchor exists to watch.
 */
async function driveChatInProcess(configPath: string): Promise<{ stdout: string; stderr: string }> {
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
      .addCommand(createChatCommand({ input, output, isTty: false }))
    program.exitOverride()
    const parsed = program.parseAsync(['node', 'agent-qa', '--config', configPath, 'chat'])
    // A tick, so a scripted line is never delivered to a readline that does not exist yet — the
    // shipped `chat-command.test.ts` idiom.
    await Promise.resolve()
    input.write(`${CHAT_ANCHOR_UTTERANCE}\n`)
    input.end()
    await parsed
    return { stdout: stdout.join('\n'), stderr: stderr.join('\n') }
  } finally {
    log.mockRestore()
    error.mockRestore()
    process.exitCode = previousExitCode
  }
}

interface SpawnOutcome {
  readonly code: number | null
  readonly signal: NodeJS.Signals | null
  readonly stdout: string
  readonly stderr: string
}

/**
 * Run a program to completion with a CONSTRUCTED environment, collecting both streams.
 *
 * Factored out of the chat driver rather than written twice: the 398-08 anchors need the same
 * hermetic spawn with an extra declared variable, and a second copy of this plumbing would be a
 * second answer to "what did the child inherit" — which is the one property these cells depend on.
 */
async function spawnCollecting(
  root: string,
  args: readonly string[],
  extraEnv: Readonly<Record<string, string>> = {},
): Promise<SpawnOutcome> {
  const child = spawn(process.execPath, [...args], {
    cwd: root,
    env: { ...hermeticEnv(root), ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk: Buffer) => {
    stdout += chunk.toString('utf8')
  })
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8')
  })
  return await new Promise<SpawnOutcome>((settle, fail) => {
    child.once('error', fail)
    child.once('close', (code, signal) => settle({ code, signal, stdout, stderr }))
  })
}

/** Drive the SHIPPED binary's `init --agent` against a project directory (398-08, D-16). */
async function spawnAgentManifest(
  root: string,
  args: readonly string[],
  extraEnv: Readonly<Record<string, string>> = {},
): Promise<SpawnOutcome> {
  return await spawnCollecting(root, [CLI_ENTRY, 'init', '--agent', '--dir', root, ...args], extraEnv)
}

/** Run a one-liner in a child with the same constructed environment — the sentinel's own control. */
async function spawnNodeInline(
  root: string,
  source: string,
  extraEnv: Readonly<Record<string, string>> = {},
): Promise<SpawnOutcome> {
  return await spawnCollecting(root, ['-e', source], extraEnv)
}

/** Drive the SHIPPED binary's chat command over a real pipe, and wait for it to exit. */
async function driveChatSpawned(root: string, configPath: string): Promise<SpawnOutcome> {
  const child = spawn(process.execPath, [CLI_ENTRY, '--config', configPath, 'chat'], {
    cwd: root,
    env: hermeticEnv(root),
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk: Buffer) => {
    stdout += chunk.toString('utf8')
  })
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8')
  })
  child.stdin.write(`${CHAT_ANCHOR_UTTERANCE}\n`)
  child.stdin.end()
  return await new Promise<SpawnOutcome>((settle, fail) => {
    child.once('error', fail)
    child.once('close', (code, signal) => settle({ code, signal, stdout, stderr }))
  })
}

// ---- The anchors -------------------------------------------------------------------------------

describe('the built-binary anchors (D-02)', () => {
  it('refuses to measure a build that is missing or older than its source', () => {
    // THE GUARD ITSELF, asserted before either anchor spawns anything, so a stale-build refusal is
    // reported as what it is rather than as an enumeration disagreement forty seconds later. The
    // two anchors below repeat the check inside their own bodies: a guard that only ran in a
    // neighbouring cell would be a guard that a `--testNamePattern` run silently skips.
    expect(buildFreshness(), REBUILD_INSTRUCTION).toEqual({ missing: [], stale: [] })
  })

  it('the shipped MCP binary lists exactly the op ids the in-process adapter does', async () => {
    expect(buildFreshness(), REBUILD_INSTRUCTION).toEqual({ missing: [], stale: [] })
    // The entry the transport is about to spawn, named separately from the freshness reading above:
    // "there is no such file" and "that file is a revision behind" are different instructions.
    expect(
      existsSync(CLI_ENTRY),
      `the built CLI entry is missing at ${relative(PACKAGES_ROOT, CLI_ENTRY)}; ${REBUILD_INSTRUCTION}`,
    ).toBe(true)

    const fixture = fixtureProject('mcp')
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [CLI_ENTRY, '--config', fixture.configPath, 'mcp'],
      cwd: fixture.root,
      env: hermeticEnv(fixture.root),
      stderr: 'pipe',
    })

    let captured = ''
    transport.stderr?.on('data', (chunk: Buffer | string) => {
      captured += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
    })

    const client = new Client({ name: 'agent-qa-397-07-mcp-anchor', version: '0.0.0' })
    try {
      await client.connect(transport)
      const listed = await client.listTools()
      const spawnedToolNames = listed.tools.map((tool) => tool.name)

      // THE SHAPE OF THE ANSWER, BEFORE ANY COMPARISON OF IT (397-04's lesson). A transport that
      // died, a command that refused to start or a listing that came back empty would otherwise
      // fold to an empty op-id set — and an empty set compared against an empty set is a green
      // cell that measured a dead process. The startup line is asserted on the captured stderr,
      // which is also the evidence that this process really did start serving.
      expect(
        { tools: spawnedToolNames.length > 0, stderr: captured.trim().slice(0, 400) },
        'the spawned MCP binary listed no tools at all; its stderr is quoted beside this',
      ).toMatchObject({ tools: true })
      expect(captured, 'the spawned MCP host never announced itself on stderr').toContain(
        MCP_STDIO_STARTUP_MESSAGE,
      )

      const spawned = expandMcpListedTools(spawnedToolNames, AGENT_QA_TOOL_PROJECTIONS)
      const inProcess = await enumerateMcpOpIds(MCP_ENUMERATION_SCOPES)

      // D-01's uncatalogued-capability shape, asked of the BINARY. `parity.test.ts` asks it of the
      // in-process server; a tool that only the shipped artifact serves would be invisible there.
      expect(
        spawned.strayTools,
        'the shipped MCP binary listed tools the declared mapping does not catalogue',
      ).toEqual([])

      // ONE FOLD CORE FOR BOTH SIDES, deliberately: a second expansion recipe written here could
      // disagree with the shipped mapping and would then be measuring itself. What makes the two
      // sides independent is the INPUT — two `tools/list` answers from two server instances in two
      // processes, one of them built by tsup out of this package's source — and not the arithmetic
      // applied to them.
      expect(
        anchorDifference(spawned.opIds, inProcess.opIds),
        `the shipped MCP binary and the in-process adapter disagree about which registry ops this `
        + `surface reaches (binary listed ${spawnedToolNames.length} tools)`,
      ).toEqual({ onlyInBinary: [], onlyInProcess: [] })

      // The comparison above is vacuous against two empty sets, and the fold is where a listing
      // becomes ops, so the produced set is asserted non-empty on its own line.
      expect(spawned.opIds.size, 'the fold produced no op ids from the binary listing')
        .toBeGreaterThan(0)
    } finally {
      await client.close().catch(() => {})
      await transport.close().catch(() => {})
    }
  }, 120_000)

  it('the shipped chat binary stamps the same toolset a chat session composed here does', async () => {
    expect(buildFreshness(), REBUILD_INSTRUCTION).toEqual({ missing: [], stale: [] })
    expect(
      existsSync(CLI_ENTRY),
      `the built CLI entry is missing at ${relative(PACKAGES_ROOT, CLI_ENTRY)}; ${REBUILD_INSTRUCTION}`,
    ).toBe(true)

    // TWO PROJECTS, because both halves persist into `<project>/.agent-qa/sessions` and one root
    // would leave two sessions in one directory with nothing to attribute them by.
    const spawnedFixture = fixtureProject('chat-binary')
    const inProcessFixture = fixtureProject('chat-in-process')

    const outcome = await driveChatSpawned(spawnedFixture.root, spawnedFixture.configPath)

    // AGAIN THE SHAPE FIRST. A non-zero exit, a signal death or an empty transcript must not reach
    // the comparison as "no session was written"; each of those is its own diagnosis and the
    // child's own stderr is quoted so the reason is in the failure rather than in a rerun.
    expect(
      { code: outcome.code, signal: outcome.signal, stderr: outcome.stderr.trim().slice(0, 600) },
      'the spawned chat binary did not exit cleanly',
    ).toMatchObject({ code: 0, signal: null })
    // The RECEIPT, not merely the absence of a throw: the deterministic route resolved the clause
    // to a registry op and the shipped surface reported that op by id.
    expect(
      outcome.stdout,
      `the spawned chat binary never reported a capability for "${CHAT_ANCHOR_UTTERANCE}"`,
    ).toContain('proposals.list')

    await driveChatInProcess(inProcessFixture.configPath)

    const binary = readChatAnchor(spawnedFixture.root)
    const inProcess = readChatAnchor(inProcessFixture.root)

    // THE VACUITY GUARD BEFORE THE EQUALITY. `chatToolsetHash` answers the string `unbound` for a
    // registry that never composed, and two halves that both answered it would agree exactly while
    // proving nothing about any capability.
    //
    // THE SESSION COUNT TRAVELS WITH THE SHAPE, so a refusal names its own cause: a half that
    // persisted nothing at all and a half that persisted an unstamped header are different
    // failures, and "no usable toolset stamp" alone would report the second wording for the first
    // situation.
    expect(
      { side: 'binary', sessions: binary.sessions, shape: binary.hashShape },
      'the shipped chat binary persisted no usable toolset stamp',
    ).toEqual({ side: 'binary', sessions: 1, shape: 'sha256hex16' })
    expect(
      { side: 'in-process', sessions: inProcess.sessions, shape: inProcess.hashShape },
      'the in-process chat session persisted no usable toolset stamp',
    ).toEqual({ side: 'in-process', sessions: 1, shape: 'sha256hex16' })

    // The whole record rather than the hash alone, so a disagreement names the field it is in —
    // a session that was never written, a model the two halves resolved differently, or the
    // capability set itself.
    expect(
      binary,
      'the shipped chat binary and an in-process chat session disagree about what a conversation '
      + 'opened against (the hash is sha256hex16 over the sorted op-id set the composed registry '
      + 'lists for the chat caller, so a difference here is a difference in reachable capabilities)',
    ).toEqual(inProcess)
  }, 180_000)

  it('the shipped init --agent manifest is the committed catalog, row for row (398-08, D-16)',
    async () => {
      // WHAT THIS CELL CAN SEE THAT NOTHING IN `manifest.test.ts` CAN. That file drives
      // `buildAgentManifest` in this process, which is the right fidelity for the manifest's own
      // laws and leaves one question unanswerable from inside: whether the thing a person installs,
      // running its own argument parsing and its own bundled command path, hands an agent the same
      // capability set. A cell that passed against a test-composed manifest and never against the
      // shipped artifact would prove nothing about what a user gets.
      //
      // THE STALE-DIST GUARD IS THE FIRST LINE, for this file's standing reason: an anchor spawned
      // against yesterday's build passes and certifies the wrong artifact.
      expect(buildFreshness(), REBUILD_INSTRUCTION).toEqual({ missing: [], stale: [] })
      expect(
        existsSync(CLI_ENTRY),
        `the built CLI entry is missing at ${relative(PACKAGES_ROOT, CLI_ENTRY)}; ${REBUILD_INSTRUCTION}`,
      ).toBe(true)

      const fixture = fixtureProject('398-08-manifest')
      const outcome = await spawnAgentManifest(fixture.root, [])

      // THE SHAPE OF THE ANSWER BEFORE ANY COMPARISON OF IT. A command that refused to start, or
      // exited non-zero, would otherwise fold to an unparseable string — and the diagnosis for
      // that is the child's own stderr, quoted here rather than found in a rerun.
      expect(
        { code: outcome.code, signal: outcome.signal, stderr: outcome.stderr.trim().slice(0, 600) },
        'the spawned `init --agent` did not exit cleanly',
      ).toMatchObject({ code: 0, signal: null })

      // THE WHOLE OF STDOUT IS THE DOCUMENT. Not "contains JSON" — parsed outright, because the
      // claim D-16 makes is that this is a machine entry point, and a machine entry point that
      // needs a filter in front of it to parse is a claim with a caveat.
      const parsed = AgentManifestSchema.safeParse(JSON.parse(outcome.stdout) as unknown)
      expect(
        parsed.success ? [] : parsed.error.issues.map((issue) => issue.path.join('.')),
        'the shipped manifest does not parse against the published contract',
      ).toEqual([])
      if (!parsed.success) return
      const manifest = parsed.data

      const committed = loadCapabilityCatalog()
      expect(
        manifest.rows,
        'the shipped `init --agent` and the committed catalog disagree about the capability rows',
      ).toEqual(committed.rows)
      expect(
        manifest.migrationMap,
        'the shipped `init --agent` and the committed catalog disagree about the migration map',
      ).toEqual(committed.migrationMap)

      // The two comparisons above are vacuous against two empty documents, so each side's
      // denominator is asserted on its own line.
      expect(manifest.rows.length, 'the shipped manifest carried no rows').toBeGreaterThan(0)
      expect(manifest.migrationMap.length, 'the shipped manifest carried no migration entries')
        .toBeGreaterThan(0)

      // THE POSTURE IS SHAPE-ASSERTED, NOT BYTE-PINNED, and that is the honest bar: it is a fact
      // about the workspace the binary ran in — a temporary directory here — so pinning its bytes
      // would pin the fixture. What must hold is that the section is WHOLE and reports the shipped
      // default grant rather than a list this cell wrote down.
      expect(manifest.posture.defaultScopes, 'the shipped posture is not the shipped default grant')
        .toEqual([...DEFAULT_MCP_SCOPES])
      expect(manifest.posture.configuration, 'the fixture project\'s config did not resolve')
        .toBe('resolved')
      expect(typeof manifest.posture.safeMode, 'the shipped posture has no safe-mode state')
        .toBe('boolean')
    }, 120_000)

  it('the shipped init --agent prints a declared credential\'s NAME and never its value (398-08, T-398-17)',
    async () => {
      // THE REFS-ONLY LAW, ON THE SURFACE A PERSON ACTUALLY SEES. `manifest.test.ts` proves the
      // value is absent from the OBJECT this process builds; this proves it is absent from the
      // BYTES a shipped process writes — both streams, including any diagnostic nobody
      // anticipated. Those are different claims, and a suite that only made the first one has
      // shipped a leak through the second before (395: the assertion read `error.message` while
      // the live channel was the error's serialization).
      //
      // ON PLANTING A VALUE AT ALL. This file's other fixtures deliberately plant NOTHING, on the
      // reasoning that a value which does not exist cannot be printed. That reasoning is right for
      // an enumeration anchor and is exactly backwards for this one: refs-only is the claim that a
      // value which DOES exist is not printed, and it is unmeasurable without one. The sentinel
      // below is minted here, authenticates nothing anywhere, and travels only in the constructed
      // environment of a child this cell kills.
      expect(buildFreshness(), REBUILD_INSTRUCTION).toEqual({ missing: [], stale: [] })

      const sentinel = 'sk-398-08-anchor-sentinel-6f21ba9c04d7e358'
      const tokenEnvVar = 'AGENT_QA_398_08_ANCHOR_TOKEN'
      const fixture = fixtureProject('398-08-refs-only', [
        { name: 'ci', tokenEnvVar, scopes: ['read'] },
      ])

      const outcome = await spawnAgentManifest(fixture.root, [], { [tokenEnvVar]: sentinel })

      expect(
        { code: outcome.code, signal: outcome.signal },
        'the spawned `init --agent` did not exit cleanly',
      ).toEqual({ code: 0, signal: null })

      const manifest = AgentManifestSchema.parse(JSON.parse(outcome.stdout) as unknown)

      // THE NAME IS THERE — without this, the absence below is satisfied by a binary that reported
      // no credential at all, which is the vacuous way to pass a "no secret" assertion.
      expect(
        manifest.posture.tokenEnvRefs,
        'the shipped manifest did not report the declared credential',
      ).toEqual([{ name: 'ci', tokenEnvVar, scopes: ['read'] }])

      // …and the VALUE is on neither stream. The variable was set in the child's environment, so a
      // path from a declared name to its contents would have had one.
      expect(
        outcome.stdout.includes(sentinel),
        'the shipped manifest printed the token VALUE on stdout',
      ).toBe(false)
      expect(
        outcome.stderr.includes(sentinel),
        'the shipped `init --agent` printed the token VALUE on stderr',
      ).toBe(false)

      // THE CONTROL ON THE CONTROL: the child really could read the sentinel. Without this the two
      // absences above are properties of an unset variable rather than of this product, and the
      // whole cell measures nothing. Driven by asking the same binary to echo its own environment
      // — through a command that is allowed to, rather than by trusting the plumbing.
      const echoed = await spawnNodeInline(
        fixture.root,
        `process.stdout.write(String(process.env[${JSON.stringify(tokenEnvVar)}] ?? ''))`,
        { [tokenEnvVar]: sentinel },
      )
      expect(echoed.stdout, 'the sentinel never reached the child environment').toBe(sentinel)
    }, 120_000)

  it('the anchor comparator names a divergence in both directions', () => {
    // A DETECTOR NOBODY HAS SEEN FIRE IS A COMMENT. Both cells above pass today, which says nothing
    // about whether they COULD fail; this drives the comparator's disagreeing branches with
    // synthetic sets. The stray id carries this plan's number so 397-09's mutation script can tell
    // a deliberate control fixture from a planted one.
    const shared = new Set(['runs.list', 'proposals.list'])
    const binaryOnly = new Set([...shared, 'control.stray.397.07'])
    const inProcessOnly = new Set([...shared, 'control.absent.397.07'])

    expect(anchorDifference(binaryOnly, inProcessOnly)).toEqual({
      onlyInBinary: ['control.stray.397.07'],
      onlyInProcess: ['control.absent.397.07'],
    })
    expect(anchorDifference(shared, shared)).toEqual({ onlyInBinary: [], onlyInProcess: [] })
  })

  it('the chat reading distinguishes two different toolset stamps', () => {
    // THE CHAT COMPARAND'S OWN NON-VACUITY, and it needs its own control for a structural reason
    // worth stating: within one workspace both halves of the chat anchor read the SAME built
    // `agent` and `agent-local` dists, and the toolset hash is a function of the registry those
    // dists declare — so no edit to THIS package can make the two hashes differ, and the anchor's
    // hash-difference branch is unreachable from a mutation of the source it actually guards. What
    // that branch WOULD catch is a shipped binary composed against a different build of the
    // function layer, which is exactly what an installed artifact is. It is driven here with two
    // planted headers instead.
    const root = mkdtempSync(join(tmpdir(), 'agent-qa-397-07-stamp-'))
    roots.push(root)
    const plant = (label: string, toolsetHash: string): string => {
      const project = join(root, label)
      mkdirSync(join(project, '.agent-qa', 'sessions'), { recursive: true })
      writeFileSync(
        join(project, '.agent-qa', 'sessions', `chat-control-397-07-${label}.jsonl`),
        `${JSON.stringify({
          schemaVersion: 1,
          sessionId: `chat-control-397-07-${label}`,
          createdAt: '2026-08-16T00:00:00.000Z',
          model: 'unbound',
          toolsetHash,
        })}\n`,
        'utf8',
      )
      return project
    }

    const left = readChatAnchor(plant('left', '0123456789abcdef'))
    const right = readChatAnchor(plant('right', 'fedcba9876543210'))

    expect(left).toEqual({
      sessions: 1,
      model: 'unbound',
      toolsetHash: '0123456789abcdef',
      hashShape: 'sha256hex16',
    })
    // The record comparison the anchor makes, driven over a real difference: same session count,
    // same model, different capability set.
    expect(left).not.toEqual(right)
    // And the sentinel a never-composed registry writes is read as the sentinel rather than as a
    // stamp, which is what stops two unbound halves from agreeing about nothing.
    expect(readChatAnchor(plant('sentinel', 'unbound')).hashShape).toBe('unbound-sentinel')
  })

  it('the freshness guard refuses a missing build and a stale one, by name', () => {
    // BOTH REFUSING BRANCHES, DRIVEN. A synthetic package tree stands in for a real one so the
    // reading is produced by the same function the anchors call rather than described here.
    const root = mkdtempSync(join(tmpdir(), 'agent-qa-397-07-freshness-'))
    roots.push(root)

    // (a) No dist at all — the `clean` reading, and the one the plan's must-have names.
    mkdirSync(join(root, 'control-397-07', 'src'), { recursive: true })
    const source = join(root, 'control-397-07', 'src', 'thing.ts')
    writeFileSync(source, 'export const a = 1\n', 'utf8')
    // FIXED STAMPS, never the wall clock: `utimes` rounds toward the second on this platform, and a
    // control whose two timestamps can land in the same second is a control that reports the
    // rounding rather than the rule.
    const at = (seconds: number): Date => new Date(seconds * 1000)
    utimesSync(source, at(2_000_000), at(2_000_000))
    const builds = [{ pkg: 'control-397-07', artifact: join('dist', 'index.js') }]
    expect(buildFreshness(builds, root)).toEqual({
      missing: [join('control-397-07', 'dist', 'index.js')],
      stale: [],
    })

    // (b) A dist that exists and is OLDER than the source it was built from — the trap this guard
    // exists for, and the one a missing-file check cannot see.
    mkdirSync(join(root, 'control-397-07', 'dist'), { recursive: true })
    const artifact = join(root, 'control-397-07', 'dist', 'index.js')
    writeFileSync(artifact, 'export const a = 1\n', 'utf8')
    utimesSync(artifact, at(1_000_000), at(1_000_000))
    expect(buildFreshness(builds, root)).toEqual({
      missing: [],
      stale: [
        `${join('control-397-07', 'src', 'thing.ts')} is newer than `
        + `${join('control-397-07', 'dist', 'index.js')}`,
      ],
    })

    // (c) Rebuilt: the artifact now post-dates its source and the guard says so.
    utimesSync(artifact, at(3_000_000), at(3_000_000))
    expect(buildFreshness(builds, root)).toEqual({ missing: [], stale: [] })

    // (d) A test source is NOT a product source. Touching one after a build must not read as an
    // unbuilt change, or the guard becomes an alarm people learn to silence.
    mkdirSync(join(root, 'control-397-07', 'src', '__tests__'), { recursive: true })
    const testSource = join(root, 'control-397-07', 'src', '__tests__', 'thing.test.ts')
    writeFileSync(testSource, 'export const b = 2\n', 'utf8')
    utimesSync(testSource, at(9_000_000), at(9_000_000))
    expect(buildFreshness(builds, root)).toEqual({ missing: [], stale: [] })
  })
})
