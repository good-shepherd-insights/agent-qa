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
// against.
//
// THE CHAT ANCHOR IS THE NEXT COMMIT. This one carries the MCP side, the freshness guard both cells
// share, and the guard's own controls.

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { AGENT_QA_TOOL_PROJECTIONS } from '@vostride/agent-qa-mcp'
import { afterEach, describe, expect, it } from 'vitest'

import { MCP_STDIO_STARTUP_MESSAGE } from '../../commands/mcp.js'
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
function fixtureProject(label: string): { root: string; configPath: string } {
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
        services: { mcp: { stdio: { grantConfigWrite: true } } },
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
