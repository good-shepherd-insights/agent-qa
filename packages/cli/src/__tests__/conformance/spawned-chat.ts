// The spawned-binary instrument: ONE copy, shared by every cell that drives what a person installs
// (extracted 2026-08-20, Phase 399.1 plan 01).
//
// WHY THIS FILE EXISTS RATHER THAN A SECOND COPY. `parity-anchors.test.ts` states the law this
// extraction obeys, in its own words about the chat driver: "A second spawn helper would be a
// second answer to 'what did the child inherit', which is the one property every cell here depends
// on." Phase 399.1's render differential needs the same instrument — the same hermetic environment,
// the same freshness guard, the same fixture project — and copying it into a sibling test file
// would have created exactly the second answer that law forbids. So the instrument moved HERE and
// both files import it; neither owns a private copy of any of it.
//
// NOTHING IN THIS MODULE ASSERTS. Every function returns data — a freshness READING, a spawn
// OUTCOME, a fixture's paths — so each cell asserts with its own message and a refusal names the
// question that cell was asking. A helper that threw would report every caller's failure in one
// voice.
//
// THE FRESHNESS GUARD IS PART OF EACH CELL'S CONTRACT, NOT A PRECONDITION SOMEBODY SATISFIED ONCE.
// A stale `dist` is worse than an absent one: an anchor spawned against yesterday's build passes,
// reads as proof of today's source, and certifies the wrong artifact. So the guard refuses on two
// separate conditions — a MISSING built artifact and a built artifact OLDER than the newest
// non-test source file of the package it was built from — and names the offending file in both
// cases. It is an mtime comparison, which catches the failure it exists for (a person, or an agent,
// forgetting to rebuild before measuring) and does not pretend to survive somebody deliberately
// touching a build output.
//
// TEST SOURCES ARE EXCLUDED FROM THE FRESHNESS SCAN ON PURPOSE. tsup's entries are `src/index.ts`
// and `src/cli.ts`; nothing under `__tests__` is bundled into anything. Counting a test file's
// mtime would make every edit to a test look like an unbuilt change to the product, which is the
// kind of false alarm that gets a guard deleted. THIS FILE lives under `__tests__` for that exact
// reason: it is instrument, not product, and it must not make the guard cry wolf on itself.
//
// HERMETIC, AND WITHOUT A CREDENTIAL ANYWHERE (T-397-17, 396 D-17). Each spawned cell gets its own
// `mkdtemp` project whose configuration is planted throwaway workspace globs and nothing else — no
// token entry, no key, no LLM block — and the child is handed a constructed environment rather than
// the test process's, so no ambient provider credential can reach it and no provider can be spent
// against. The chat session a cell drives is therefore model-unbound by construction and takes the
// deterministic resolver route, which is the route that never touches a model at all.

import { spawn } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { generateTestId } from '@vostride/agent-qa-ids'

/** This directory. */
export const CONFORMANCE_DIR = dirname(fileURLToPath(import.meta.url))
/** `packages/cli`. */
export const CLI_PACKAGE_ROOT = resolve(CONFORMANCE_DIR, '..', '..', '..')
/** `packages`. */
export const PACKAGES_ROOT = resolve(CLI_PACKAGE_ROOT, '..')
/** The built entry a spawned cell actually executes — the thing a person installs. */
export const CLI_ENTRY = join(CLI_PACKAGE_ROOT, 'dist', 'cli.js')

export const REBUILD_INSTRUCTION =
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
export const ANCHORED_BUILDS: readonly { readonly pkg: string; readonly artifact: string }[] =
  Object.freeze([
    Object.freeze({ pkg: 'schema', artifact: join('dist', 'index.js') }),
    Object.freeze({ pkg: 'agent', artifact: join('dist', 'index.js') }),
    Object.freeze({ pkg: 'agent-local', artifact: join('dist', 'index.js') }),
    Object.freeze({ pkg: 'mcp', artifact: join('dist', 'index.js') }),
    Object.freeze({ pkg: 'cli', artifact: join('dist', 'cli.js') }),
  ])

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
      if (!/\.(?:ts|tsx|mts|cts|js|mjs|cjs|json|css|html)$/u.test(entry.name)) continue
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
 * drivable: the control cell in `parity-anchors.test.ts` points it at a synthetic package tree and
 * watches it report a missing artifact and a stale one. A guard whose refusing branches could only
 * be reached by deleting a real `dist` is a guard nobody has watched refuse.
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

// ---- Fixtures ----------------------------------------------------------------------------------

const roots: string[] = []

/**
 * Register a temporary directory for removal by {@link cleanupTempRoots}.
 *
 * Exported because the control cells that plant SYNTHETIC package trees make their own roots and
 * must not have to remember a second cleanup path — one list, one sweep, whoever made the directory.
 */
export function trackTempRoot(root: string): string {
  roots.push(root)
  return root
}

/**
 * Remove every tracked root. Each importing test file calls this from its own `afterEach`.
 *
 * IT IS CALLED, NOT REGISTERED HERE. A module-level `afterEach` in a non-test module would attach
 * to whichever file imported it first under a runner that shared module state, and a cleanup whose
 * owner is ambiguous is a cleanup that runs at an ambiguous time.
 */
export function cleanupTempRoots(): void {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
}

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
export function fixtureProject(
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
  const root = trackTempRoot(mkdtempSync(join(tmpdir(), `agent-qa-397-07-${label}-`)))
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
 * `TMPDIR` point INTO the fixture so nothing the child writes escapes the directory the cleanup
 * above deletes.
 */
export function hermeticEnv(root: string): Record<string, string> {
  return {
    PATH: process.env.PATH ?? '',
    HOME: root,
    TMPDIR: join(root, '.agent-qa'),
    NODE_ENV: 'test',
  }
}

// ---- Driving the shipped binary ----------------------------------------------------------------

export interface SpawnOutcome {
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
export async function spawnCollecting(
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

/** The utterance both halves type: the deterministic resolver route, which reaches no model. */
export const CHAT_ANCHOR_UTTERANCE = 'proposals'

/**
 * Drive the SHIPPED binary's chat command over a real pipe, and wait for it to exit.
 *
 * THE UTTERANCE IS A PARAMETER, NOT A SECOND DRIVER (the no-second-copy law this module is named
 * for). A second spawn helper would be a second answer to "what did the child inherit", which is
 * the one property every cell here depends on.
 */
export async function driveChatSpawned(
  root: string,
  configPath: string,
  utterance: string = CHAT_ANCHOR_UTTERANCE,
): Promise<SpawnOutcome> {
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
  child.stdin.write(`${utterance}\n`)
  child.stdin.end()
  return await new Promise<SpawnOutcome>((settle, fail) => {
    child.once('error', fail)
    child.once('close', (code, signal) => settle({ code, signal, stdout, stderr }))
  })
}

// ---- Driving the shipped DASHBOARD (400-09) ----------------------------------------------------
//
// WHY THE DASHBOARD SPAWN LIVES HERE AND NOT IN THE TWO FILES THAT USE IT. `dashboard-anchors` and
// `dashboard-dom` both drive the same child — the built `agent-qa dashboard` command, in the same
// hermetic environment, against the same freshness reading. This module's own law ("a second spawn
// helper would be a second answer to 'what did the child inherit'") applies to that child exactly
// as it applies to the chat one, so there is one recipe and both files import it.

/**
 * The built artifacts a spawned DASHBOARD executes.
 *
 * The chat list plus the two the fourth door adds. `dashboard-server` is the process that serves
 * the routes and `dashboard-ui` is the bundle a browser is handed — and BOTH belong in the guard
 * for the reason the header gives about `cli`: a DOM cell run against yesterday's `dashboard-ui`
 * bundle passes, reads as proof of today's `.tsx`, and certifies the wrong artifact. `dashboard-ui`
 * is anchored on `dist/index.html` rather than a hashed asset name, because the asset names change
 * every build and a guard that had to know them would be a second copy of the manifest.
 *
 * `dashboard-server` IS LOAD-BEARING AND NOT DECORATIVE, said here so nobody narrows this list back
 * to the chat five (400-16). `dashboard-process-survival.test.ts` asks whether one unauthenticated
 * request ends the SHIPPED process, and its whole subject is `server.ts`'s request listener —
 * which the spawned `agent-qa dashboard` resolves through THIS artifact, because tsup leaves the
 * workspace dependency external. A survival cell run against a stale `dashboard-server/dist` would
 * spawn the pre-fix listener, die exactly as it used to, and report a fix that was never loaded.
 * The refusal that prevents that names the file: `dashboard-server/src/server/server.ts is newer
 * than dashboard-server/dist/index.js`.
 *
 * WHAT THIS LIST STILL DOES NOT COVER, so the next reader does not over-trust it: the workspace
 * packages `dashboard-server` itself imports externally (`core`, `runner`, `schema`'s siblings, …)
 * are not all enumerated, so a stale dist of one of THOSE is invisible here. Every cell that has
 * needed this guard so far is asking about `cli`, `dashboard-server` or `dashboard-ui` source, and
 * widening it further is a change that should arrive with a cell that needs it.
 */
export const DASHBOARD_ANCHORED_BUILDS: readonly {
  readonly pkg: string
  readonly artifact: string
}[] = Object.freeze([
  ...ANCHORED_BUILDS,
  Object.freeze({ pkg: 'dashboard-server', artifact: join('dist', 'index.js') }),
  Object.freeze({ pkg: 'dashboard-ui', artifact: join('dist', 'index.html') }),
])

/**
 * A project the SPAWNED dashboard can open, which is a strictly larger recipe than the chat one.
 *
 * THE THREE EMPTY FILES ARE NOT DECORATION. `agent-qa dashboard` resolves its workspace with
 * `requireExistingFiles: true`, so a project whose `hooksFile`, `envFile` or `secretsFile` is
 * merely DECLARED makes the command exit 2 before it binds a port — which a cell would read as
 * "the dashboard did not start" with no idea why. `agent-qa chat` does not take that path, which
 * is why `fixtureProject` above does not write them and why this is a second recipe rather than
 * an edit to that one.
 *
 * NOTHING SECRET IS PLANTED, on `fixtureProject`'s own argument: `.env` and `.env.secrets.local`
 * are written EMPTY. A value that does not exist cannot be printed by a diagnostic nobody
 * anticipated, and the door these cells drive is model-unbound for the same reason.
 *
 * The knowledge root is declared so a cell that wants a real entity can publish a bundle into it;
 * a cell that does not simply lists an empty store.
 */
export function dashboardFixtureProject(label: string): {
  root: string
  configPath: string
  knowledgeRoot: string
} {
  const root = trackTempRoot(mkdtempSync(join(tmpdir(), `agent-qa-400-09-${label}-`)))
  const configPath = join(root, 'agent-qa.config.yaml')
  writeFileSync(
    configPath,
    `${JSON.stringify(
      {
        workspace: {
          testMatch: ['tests/**/*.test.yaml'],
          testPathIgnore: [],
          suiteMatch: ['suites/**/*.suite.yaml'],
          hooksFile: 'hooks.yaml',
          envFile: '.env',
          secretsFile: '.env.secrets.local',
        },
        knowledge: { dir: 'agent-qa-knowledge', commitArtifacts: 'none' },
        use: { mobile: { appState: 'preserve' } },
        registry: {
          targets: {
            conformance: { platform: 'web', url: 'https://conformance.invalid' },
          },
        },
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
  writeFileSync(join(root, 'hooks.yaml'), 'hooks: {}\n', 'utf8')
  writeFileSync(join(root, '.env'), '', 'utf8')
  writeFileSync(join(root, '.env.secrets.local'), '', 'utf8')
  mkdirSync(join(root, '.agent-qa'), { recursive: true })
  const knowledgeRoot = join(root, 'agent-qa-knowledge')
  mkdirSync(knowledgeRoot, { recursive: true })
  return { root, configPath, knowledgeRoot }
}

/**
 * A port nothing is listening on, learned by binding one and letting it go.
 *
 * `--port 0` is NOT usable here even though the server accepts it: `startServer` reports the port
 * it was ASKED for rather than the one it bound, so a `0` would leave both this process and the
 * child's own `services.dashboard.baseUrl` overlay naming `http://localhost:0`. Reserving a real
 * port and handing it over keeps one number true on both sides. (The residual race — somebody else
 * taking the port between the close and the child's listen — announces itself as a child that
 * exited with an EADDRINUSE on its stderr, which every caller below quotes.)
 */
export async function reserveEphemeralPort(): Promise<number> {
  const { createServer } = await import('node:http')
  return await new Promise<number>((settle, fail) => {
    const probe = createServer()
    probe.once('error', fail)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      if (address === null || typeof address === 'string') {
        probe.close(() => { fail(new TypeError('the probe bound no port')) })
        return
      }
      const { port } = address
      probe.close(() => { settle(port) })
    })
  })
}

/** A spawned dashboard, as the cells that drive it consume it. */
export interface SpawnedDashboard {
  /** The origin a browser is pointed at. */
  readonly origin: string
  readonly port: number
  /** Everything the child has printed so far — quoted verbatim in every failure message. */
  stdout(): string
  stderr(): string
  /** Idempotent: safe to call from a cell body and from an `afterAll`. */
  stop(): Promise<void>
}

/** The line `startServer` prints once it is listening — the child's own readiness statement. */
export function dashboardReadyLine(port: number): string {
  return `Dashboard running at http://localhost:${String(port)}`
}

/**
 * Start the SHIPPED `agent-qa dashboard` command and wait for it to say it is listening.
 *
 * READINESS IS THE CHILD'S OWN SENTENCE, not a poll of the port and not a sleep. A poll would go
 * green against any process that happened to hold the port; a sleep would be a number somebody
 * guessed, and the failure it produces (an empty page) reads like a product defect.
 *
 * IT RETURNS DATA AND NEVER ASSERTS, on this module's own law — `startedAt` is `undefined` when
 * the child died or the budget ran out, and the caller decides what that means with its own
 * message and its own quoted streams.
 */
export async function spawnDashboard(
  root: string,
  configPath: string,
  port: number,
  budgetMs = 60_000,
  /**
   * Variables added to the CONSTRUCTED environment, never inherited from this process (402-07).
   *
   * A PARAMETER RATHER THAN A SECOND SPAWN HELPER, on this module's own law: the run-service
   * anchors need a declared credential in the child, and a copy of this function that also set an
   * environment would be a second answer to "what did the child inherit", which is the one
   * property every cell here depends on. `spawnCollecting` already carries the identical parameter
   * for the identical reason.
   *
   * Empty by default, so every pre-402 caller's child is hermetic byte for byte.
   */
  extraEnv: Readonly<Record<string, string>> = {},
): Promise<SpawnedDashboard & { readonly ready: boolean }> {
  const child = spawn(
    process.execPath,
    [CLI_ENTRY, '--config', configPath, 'dashboard', '--port', String(port)],
    {
      cwd: root,
      env: { ...hermeticEnv(root), ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  let stdout = ''
  let stderr = ''
  let exited = false
  child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
  child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
  child.once('close', () => { exited = true })

  const readyLine = dashboardReadyLine(port)
  const deadline = Date.now() + budgetMs
  while (!stdout.includes(readyLine) && !exited && Date.now() < deadline) {
    await new Promise<void>((tick) => setTimeout(tick, 50))
  }

  let stopped: Promise<void> | undefined
  const stop = async (): Promise<void> => {
    stopped ??= new Promise<void>((settled) => {
      if (exited) { settled(); return }
      child.once('close', () => { settled() })
      // SIGTERM first, because the command installs a handler that closes the server and the
      // database. The kill below is the backstop for a child that ignored it.
      child.kill('SIGTERM')
      const hard = setTimeout(() => { child.kill('SIGKILL') }, 5_000)
      hard.unref?.()
    })
    await stopped
  }

  return {
    origin: `http://127.0.0.1:${String(port)}`,
    port,
    ready: stdout.includes(readyLine),
    stdout: () => stdout,
    stderr: () => stderr,
    stop,
  }
}

// ---- The RUN SERVICE fixture and its build list (402-07) ---------------------------------------
//
// WHY THIS RECIPE LIVES HERE AND NOT IN EITHER FILE THAT USES IT. Two cells drive the authed run
// service and they drive it through DIFFERENT frames on purpose: the conformance adapter composes
// it in this process (`startServer`, real TCP, ephemeral port) and the wire anchors spawn the built
// `agent-qa dashboard` and reach it over a socket. What both need is the same PROJECT on disk — the
// same declared credential entry, the same locally-classified target, the same planted test — and
// this module's own law is that a second recipe would be a second answer to "what did the door
// open". So the project is written once and the two frames differ only in how they mount it, which
// is the only axis those cells mean to compare.
//
// NO VALUE IS EVER WRITTEN INTO THE PROJECT. `RunServiceTokenEntrySchema` has no member a value
// could occupy: the config declares a variable NAME, and the value travels only in a constructed
// child environment or an explicit `env` map. `fixtureProject`'s own argument applies unchanged —
// what a file does not contain cannot be printed by a diagnostic nobody anticipated.

/**
 * The environment variable the run-service fixture declares. A NAME, and only ever a name.
 *
 * NO SUFFIX A MASKER RECOGNISES, on `run-service-door.e2e.test.ts`'s reasoning: `sensitiveEnvSlice`
 * selects environment variables by name suffix, so a probe called `..._API_TOKEN` would be masked
 * by machinery that has nothing to do with this door and a leak would pass for the wrong reason.
 */
export const RUN_SERVICE_FIXTURE_TOKEN_VAR = 'AGENT_QA_402_07_RUN_CRED'

/**
 * The credential the two run-service frames present.
 *
 * A THROWAWAY THIS REPOSITORY OWNS, not a secret: it exists only inside a temp project's process
 * environment and is never written to any file. It is a distinct value from 402-01's e2e token so
 * that a cell in either file cannot accidentally authenticate against the other's door.
 */
export const RUN_SERVICE_FIXTURE_TOKEN = 'zz-402-07-conformance-run-credential-4b7e12'

/** The entry NAME the fixture declares, echoed by nothing on the wire but named once here. */
export const RUN_SERVICE_FIXTURE_ENTRY_NAME = 'conformance'

/**
 * The built artifacts a RUN SERVICE cell executes — the dashboard list plus the run path's two.
 *
 * WIDENED DELIBERATELY, and the header of {@link DASHBOARD_ANCHORED_BUILDS} asks for exactly this:
 * "widening it further is a change that should arrive with a cell that needs it." These cells need
 * it. A run started through this door executes in-process through `@vostride/agent-qa-runner`, and
 * the run gate, the scope resolution and the config schema it consults live in
 * `@vostride/agent-qa-core` — both of which the spawned `agent-qa dashboard` resolves through their
 * BUILT dists, because tsup leaves workspace dependencies external (WINDOWS #240). A wire anchor run
 * against a stale `runner/dist` would drive the previous revision of the very execution path whose
 * RPC shape it certifies, and would read as proof of this one.
 */
export const RUN_SERVICE_ANCHORED_BUILDS: readonly {
  readonly pkg: string
  readonly artifact: string
}[] = Object.freeze([
  ...DASHBOARD_ANCHORED_BUILDS,
  Object.freeze({ pkg: 'core', artifact: join('dist', 'index.js') }),
  Object.freeze({ pkg: 'runner', artifact: join('dist', 'index.js') }),
])

/**
 * A project whose dashboard mounts the authed run service, with one test a run can address.
 *
 * `environment: 'local'` ON THE TARGET IS LOAD-BEARING, and 402-01's e2e states why in full: the
 * run gate folds the most restrictive declared target class, and only an invocation whose every
 * target is declared local is decided `mutating-local` — the tier ratified as allowed in every
 * execution context. An undeclared or shared target classifies the run `mutating-shared`, which in
 * this door's fail-closed `local-headless` context is a DENIAL; a denied run never starts, never
 * acks and never streams, so a cell about DELIVERY would observe a refusal instead. That denial is
 * a real and correct behaviour of the product and 402-06 owns its cells.
 *
 * THE RUN IS EXPECTED TO FAIL, and that is fine. The planted test names steps no browser will ever
 * be launched for, so the run fails fast. Every claim these two frames make is about WIRE SHAPE —
 * an ack off the durable record, envelopes in the frozen frame, bytes that are pure JSON — and a
 * cell that needed a passing run would need a browser and would be measuring Playwright.
 */
export function runServiceFixtureProject(label: string): {
  root: string
  configPath: string
} {
  const root = trackTempRoot(mkdtempSync(join(tmpdir(), `agent-qa-402-07-${label}-`)))
  const configPath = join(root, 'agent-qa.config.yaml')
  writeFileSync(
    configPath,
    `${JSON.stringify(
      {
        workspace: {
          testMatch: ['tests/**/*.test.yaml'],
          testPathIgnore: [],
          suiteMatch: ['suites/**/*.suite.yaml'],
          hooksFile: 'hooks.yaml',
          envFile: '.env',
          secretsFile: '.env.secrets.local',
        },
        use: { mobile: { appState: 'preserve' } },
        registry: {
          targets: {
            conformance: {
              platform: 'web',
              url: 'https://conformance.invalid',
              environment: 'local',
            },
          },
        },
        services: {
          dashboard: {
            runServiceTokens: [
              {
                name: RUN_SERVICE_FIXTURE_ENTRY_NAME,
                tokenEnvVar: RUN_SERVICE_FIXTURE_TOKEN_VAR,
                trustScope: { project: 'conformance' },
              },
            ],
          },
        },
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
  // The three files `requireExistingFiles: true` refuses a project without — `dashboardFixtureProject`
  // states the reasoning; both frames take that path, the spawned one through the shipped command
  // and the in-process one through the same workspace resolution.
  // `hooks: []` AND NOT `hooks: {}`, and the difference is measured rather than copied.
  // `dashboardFixtureProject` above writes the mapping form and is correct for what it does — its
  // cells list capabilities and never start a run. A run VALIDATES the hooks document, and the
  // mapping form fails that validation with `CliRunInputError: Hooks configuration errors:`, which
  // this door then flattens into a `500 run_start_failed` carrying no diagnosis at all (correctly —
  // a crash message is composed from the host's own state and the caller is remote). A first draft
  // of this fixture copied the mapping form and every route probe read as "the door did not answer".
  writeFileSync(join(root, 'hooks.yaml'), 'hooks: []\n', 'utf8')
  writeFileSync(join(root, '.env'), '', 'utf8')
  writeFileSync(join(root, '.env.secrets.local'), '', 'utf8')
  mkdirSync(join(root, '.agent-qa'), { recursive: true })
  mkdirSync(join(root, 'tests'), { recursive: true })
  writeFileSync(
    join(root, 'tests', 'probe.test.yaml'),
    'name: The run service conformance probe\n'
    // MINTED rather than hand-written: canonical ids come from the ID helpers by house rule, and a
    // literal here would be an id this repository does not own.
    + `test-id: ${generateTestId()}\n`
    + 'target: conformance\n'
    + 'steps:\n'
    + '  - Do nothing this run will ever reach\n',
    'utf8',
  )
  return { root, configPath }
}
