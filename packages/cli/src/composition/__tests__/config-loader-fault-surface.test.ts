// A committed config the yaml parser cannot read, on every road that loads it (395-14 · F-01).
//
// THE DEFECT THIS FILE IS THE ACCEPTANCE FOR. `loadConfigFile`/`loadRequiredConfigFile` hand
// `parseYaml` the person's committed bytes and let its throw out uncaught. The vendored `yaml`
// package pretty-prints a `YAMLParseError` with a VERBATIM EXCERPT of the source around the point
// the parser gave up — for a duplicate top-level key that excerpt is the line before it, whatever
// that line happens to hold. Measured with a planted `sk-ant-`-shaped credential on that line, the
// excerpt reached `config.field.set`, `config.target.create` and `config.project.scaffold`; through
// `refusalMessage` (turn-engine.ts:290-292, which returns an `Error`'s `.message` verbatim) it
// reaches a chat turn's answer and the persisted session jsonl; and `agent-qa validate` printed the
// identical string through a SIBLING site, core `validateConfig`'s `YAML syntax error:`
// interpolation.
//
// THE CLOSURE IS 395-10's, ONE LAYER OUT: POSITION, NEVER CONTENT. Both sources compose their
// sentence from `yamlParseFailureMessage` — two numbers off the error and nothing else — so no road
// that loads a config can quote a byte of it.
//
// THE FIXTURE IS PRODUCED, NEVER A LITERAL. A real temp git repository, the config WRITTEN and
// COMMITTED, exactly the file a person would have in their tree. A type literal handed to a port
// would pin an input the loader never sees, and this defect lives in the loader.
//
// WHAT MAKES EACH CELL RED:
//
//  (F1) config.field.set         — the loader rethrowing the parse error, or wording its own
//                                  message out of the caught error's text.
//  (F2) config.target.create     — the same guard reached through a second op. A fix placed in one
//                                  op's handler rather than in the loader reds here.
//  (F3) config.project.scaffold  — and through a third, which reads the committed set from zero.
//  (F4) agent-qa validate        — core `validateConfig`'s own arm. This is a SIBLING SITE, not a
//                                  caller of the cli loader: a one-sided fix that hardened the
//                                  loader alone leaves this road printing the excerpt (388/390/392
//                                  — one-sided hardening is a regression generator).
//  (F5) the chat answer          — the equivalence the chat road rests on: the captured rejection
//                                  is an `Error` with a non-empty message, so `refusalMessage`
//                                  RETURNS THAT MESSAGE. The string asserted here is the string a
//                                  turn's answer and its session jsonl carry.
//  (F6) control, non-firing      — a WELL-FORMED config in the same harness still proposes. The
//                                  guard fired zero times; a catch that swallowed healthy loads
//                                  reds here.
//  (F7) control, secretless      — the same fault with NO credential anywhere still reports its
//                                  position. The guard's subject is the FAULT, not the secret, so a
//                                  fix keyed on detecting a secret reds here.
//  (W1) WR-08                    — `yamlParseFailureMessage` handed `null` and a bare string. The
//                                  395-10 copy read `.linePos` off the argument unguarded and
//                                  TypeError'd on `null`.
//  (E1) the ENOENT byte-pins     — `loadConfigFile` answers `{}` and `loadRequiredConfigFile` says
//                                  `Config file not found: <path>` VERBATIM. That exact string is
//                                  matched by the live lane's third-arm detection
//                                  (`scripts/395-live-from-zero.sh:514`) and folded by
//                                  `coveringGrantInForce`; a parse guard written as one broad catch
//                                  around the whole loader would reword it and red here.

import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inspect } from 'node:util'

import { invokeFunction } from '@vostride/agent-qa-agent'
import { formatDiagnostics, validateProject, yamlParseFailureMessage } from '@vostride/agent-qa-core'
import { runSafetyScope } from '@vostride/agent-qa-safety-local'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { loadConfigFile, loadRequiredConfigFile } from '../../config.js'
import { CLI_FUNCTION_CALLER, composeCliLocalAgent } from '../local-agent-host.js'

const CONFIG_FILE = 'agent-qa.config.yaml'

/**
 * The planted value: `sk-ant-`-shaped, and OWNED BY THIS FIXTURE.
 *
 * Shaped like the thing a person actually pastes into a file and forgets, and unmistakably not one:
 * the whole point of the cells below is that this string must not appear in any message, so it has
 * to be searchable, distinctive, and impossible to confuse with a live credential.
 */
const PLANTED_CREDENTIAL = 'sk-ant-api03-395fourteenFIXTUREONLYnotarealkey'

/**
 * The SHIPPED binary, resolved from this file's own location (395-16 · CR-01 / S2).
 *
 * `packages/cli/src/composition/__tests__` → three levels up is `packages/cli`. The cell below
 * drives `dist/cli.js` and not the source, because the crash this measures happens in the process a
 * person actually runs — and because a reading taken on a STALE dist measures the previous build.
 * The plan's verify line rebuilds core then cli before every run of this file for exactly that
 * reason.
 */
const CLI_DIST = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'dist', 'cli.js')

let root: string
let configPath: string
let agentQaRoot: string

function git(...args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
  if (result.error !== undefined) throw result.error
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

/**
 * The config a person committed: valid-looking, comment-carrying, and holding a DUPLICATE top-level
 * key with the planted value on the line immediately above it.
 *
 * THE ADJACENCY IS THE FIXTURE. `yaml` reports a duplicate key at the key's own line and prints the
 * preceding line with it, so the credential is what the excerpt carries. That is not a contrivance —
 * it is the mechanism by which any line of a person's file can end up in an error message, and the
 * only way to measure the channel is to put something recognisable on the line it prints.
 */
/**
 * A configuration the shipped schema accepts WHOLE — the non-firing control's input, and the body
 * the faulty fixture is built from.
 *
 * COMPLETE ON PURPOSE. `config.field.set` validates the whole candidate (CFGM-01), so a config
 * missing `workspace.envFile` blocks with `schema-fail` and the control cell would be measuring the
 * validator rather than the loader guard it is the control for.
 */
const WELL_FORMED_CONFIG = `# my project's own agent-qa configuration
workspace:
  testMatch:
    - tests/**/*.yaml
  suiteMatch:
    - suites/**/*.suite.yaml
  hooksFile: hooks.yaml
  envFile: .env
  secretsFile: .env.secrets.local

registry:
  llms:
    - name: judge
      provider: openai-subscription
      model: gpt-5.6-terra

use:
  llm: judge
  parallel: false
  mobile:
    appState: preserve
  timeout:
    step: 30s
    test: 90m
    navigation: 2m
`

/** The ordinary line the secretless control carries where the credential otherwise sits. */
const ORDINARY_LINE = 'an ordinary line with nothing sensitive on it'

function faultyConfigText(options: { readonly credential: boolean }): string {
  const carried = options.credential
    ? `apiToken: ${PLANTED_CREDENTIAL}`
    : `apiToken: ${ORDINARY_LINE}`
  // THE SAME FILE, PLUS ONE DUPLICATE TOP-LEVEL KEY. The person's config was fine and then a merge
  // or a copy-paste gave them a second `registry:` — which is why the fixture is this file and not
  // a scrap of broken yaml: what the excerpt discloses is the content of a file worth protecting.
  return `${WELL_FORMED_CONFIG}
# pasted in from the provider dashboard months ago
${carried}
registry:
  llms: []
`
}

/**
 * Write the config and COMMIT it, because a committed file is what every road here reads.
 *
 * `config.project.scaffold` re-reads the committed set at proposal time and the apply's porcelain
 * check is scoped to it, so a fixture left dirty would be measuring a different road in.
 */
function seedConfig(text: string): void {
  writeFileSync(configPath, text)
  git('add', '--', CONFIG_FILE)
  git('commit', '--quiet', '-m', 'the project configures itself')
}

/**
 * Drive one verb through the PRODUCTION composition and never rethrow.
 *
 * The rejection is the subject here, so it is returned rather than thrown: every cell below reads
 * the message off it and asserts about the string itself.
 */
async function invokeComposed(input: {
  readonly functionId: string
  readonly payload: unknown
}): Promise<{ readonly answer?: unknown; readonly error?: Error }> {
  const host = composeCliLocalAgent({ agentQaRoot, configPath })
  try {
    const answer = await runSafetyScope({ executionContext: 'local-interactive' }, async () =>
      await invokeFunction(host.registry, input.functionId, input.payload, CLI_FUNCTION_CALLER))
    return { answer }
  } catch (error) {
    return { error: error as Error }
  } finally {
    await host.close()
  }
}

/** The one shape every road cell asserts: the fault is named by POSITION and by nothing else. */
function expectPositionOnly(message: string): void {
  expect(
    occurrences(message, PLANTED_CREDENTIAL),
    `the message carried the planted credential: ${message}`,
  ).toBe(0)
  expect(message).toMatch(/line \d+, column \d+/)
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'config-fault-surface-'))
  configPath = join(root, CONFIG_FILE)
  agentQaRoot = join(root, '.agent-qa')

  git('init', '--quiet')
  git('config', 'user.name', 'agent-qa fault surface test')
  git('config', 'user.email', 'fault-surface-test@example.invalid')
  git('config', 'commit.gpgsign', 'false')
  writeFileSync(join(root, '.gitignore'), '# the project\'s own rules\ndist/\n.agent-qa/\n')
  writeFileSync(join(root, 'README.md'), 'a project with a configuration it cannot parse\n')
  git('add', '--', '.gitignore', 'README.md')
  git('commit', '--quiet', '-m', 'seed')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('a committed config the parser cannot read names WHERE, never WHAT (395-14 · F-01)', () => {
  it('(F1) config.field.set faults with the position and none of the file\'s content', async () => {
    seedConfig(faultyConfigText({ credential: true }))

    const { error } = await invokeComposed({
      functionId: 'config.field.set',
      payload: { path: 'use.timeout.step', value: '45s' },
    })

    // THE OP STILL FAULTS. Converting the throw into a typed refusal arm is F-03's fix and is out
    // of this round's scope — only the message's CONTENT changes.
    expect(error, 'an unreadable committed config must still fault the op').toBeDefined()
    const message = error?.message ?? ''
    // THE DISCLOSURE ASSERTION FIRST, because it is the one F-01 is about: on pre-fix HEAD this
    // line failed with the planted credential quoted back out of the person's own file.
    expectPositionOnly(message)
    expect(message).toContain(CONFIG_FILE)
  })

  it('(F2) config.target.create faults the same way — the guard is in the LOADER', async () => {
    seedConfig(faultyConfigText({ credential: true }))

    const { error } = await invokeComposed({
      functionId: 'config.target.create',
      payload: { name: 'shop', platform: 'web', url: 'https://shop.example.com' },
    })

    expect(error, 'an unreadable committed config must still fault the op').toBeDefined()
    const message = error?.message ?? ''
    expectPositionOnly(message)
    expect(message).toContain(CONFIG_FILE)
  })

  it('(F3) config.project.scaffold faults the same way — the third op, from zero', async () => {
    seedConfig(faultyConfigText({ credential: true }))

    const { error } = await invokeComposed({
      functionId: 'config.project.scaffold',
      payload: { domain: 'booking.com' },
    })

    expect(error, 'an unreadable committed config must still fault the op').toBeDefined()
    const message = error?.message ?? ''
    expectPositionOnly(message)
    expect(message).toContain(CONFIG_FILE)
  })

  it('(F4) agent-qa validate reports the same fault position-only — the SIBLING site', async () => {
    seedConfig(faultyConfigText({ credential: true }))

    // THE ROAD `agent-qa validate` TAKES. The command catches its own `resolveConfig` failure and
    // defers to core `validateProject`, whose config-member arm is a SECOND interpolation site —
    // not a caller of the cli loader at all. A fix that hardened only the loader leaves this road
    // printing the excerpt, which is the half a three-op corpus cannot see.
    const result = await validateProject({ configPath })

    const configDiagnostics = result.diagnostics.filter((d) => d.file === configPath)
    expect(configDiagnostics).toHaveLength(1)
    const message = configDiagnostics[0]?.message ?? ''
    expectPositionOnly(message)

    // AND THE RENDERED OUTPUT, because the diagnostic is a structure and the person reads a string.
    const rendered = formatDiagnostics(result)
    expect(occurrences(rendered, PLANTED_CREDENTIAL)).toBe(0)
    expect(rendered).toMatch(/line \d+, column \d+/)
  })

  it('(F5) the chat answer carries EXACTLY this string — refusalMessage returns .message',
    async () => {
      seedConfig(faultyConfigText({ credential: true }))

      const { error } = await invokeComposed({
        functionId: 'config.project.scaffold',
        payload: { domain: 'booking.com' },
      })

      // THE EQUIVALENCE THE CHAT ROAD RESTS ON, asserted rather than assumed. `routeWriteTest`
      // captures this rejection and hands it to `refusalMessage` (turn-engine.ts:290-292), which
      // for an `Error` with a NON-EMPTY message returns that message VERBATIM — it falls through to
      // `refusalName` only otherwise. So the two predicates below are precisely the conditions
      // under which the string asserted next IS the sentence a chat turn's answer prints and the
      // session jsonl persists.
      expect(error).toBeInstanceOf(Error)
      expect(error?.message).not.toBe('')

      const asAChatTurnWouldCarryIt = error?.message ?? ''
      expectPositionOnly(asAChatTurnWouldCarryIt)
      expect(asAChatTurnWouldCarryIt).toContain(CONFIG_FILE)
    })
})

// THE SURFACE THE ROUND-2 CORPUS COULD NOT SEE (395-16 · RULING 1 / CR-01).
//
// Every cell above reads `error.message`. The channel that survived them reads the error as a
// VALUE: `util.inspect` walks the `cause` chain, and Node's default uncaught printer is a
// util.inspect call — so `agent-qa config show`, which awaited the loader bare, crash-printed the
// person's file back at them while ten cells stayed green. The two cells here change the assertion
// SURFACE rather than the case count: the serialization as a printer reads it, and the shipped
// binary's entire stdout+stderr.
describe('the loader\'s error is clean as a VALUE, and the shipped command reports it (395-16)', () => {
  it('(S1) the rejection serializes position-only — util.inspect and .stack, not just .message',
    async () => {
      seedConfig(faultyConfigText({ credential: true }))

      const error = await loadConfigFile(configPath).then(
        () => undefined,
        (err: unknown) => err as Error,
      )
      expect(error, 'an unreadable committed config must still reject').toBeDefined()

      // THE CAUSE CHAIN, as every printer renders it. `inspect(err, { depth: null })` is what the
      // default uncaught printer, `console.error(err)` and every structured logger do with a thrown
      // value; a raw `YAMLParseError` attached as `cause` republishes the excerpt through all three.
      const serialized = inspect(error, { depth: null })
      expect(
        occurrences(serialized, PLANTED_CREDENTIAL),
        `the serialization carried the planted credential: ${serialized}`,
      ).toBe(0)

      // AND THE STACK, which is a second serialization of the same value — `err.stack` on an error
      // with a cause is rendered with the cause by V8's own formatter in several hosts, and is what
      // crash reporters upload.
      const stack = String(error?.stack ?? '')
      expect(
        occurrences(stack, PLANTED_CREDENTIAL),
        `the stack carried the planted credential: ${stack}`,
      ).toBe(0)

      // The `.message` surface the round-2 corpus asserted on is unchanged, and still position-only.
      expectPositionOnly(error?.message ?? '')
      expect(error?.message).toContain(CONFIG_FILE)
    })

  it('(S2) the SHIPPED `agent-qa config show` reports the position and never crash-prints the file',
    () => {
      seedConfig(faultyConfigText({ credential: true }))

      // THE BINARY, NOT THE SOURCE, and its WHOLE output — no stream filter, no line filter. The
      // verifier reproduced this leak by running exactly this command.
      const run = spawnSync(process.execPath, [CLI_DIST, 'config', 'show'], {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
      })
      const combined = `${run.stdout ?? ''}${run.stderr ?? ''}`

      expect(
        occurrences(combined, PLANTED_CREDENTIAL),
        `the command's output carried the planted credential:\n${combined}`,
      ).toBe(0)
      expect(combined, `the command's output:\n${combined}`)
        .toMatch(/not readable as YAML at line \d+, column \d+/)
      // THE CRASH-PRINTER'S OWN RENDERING, asserted on the runtime's output. Node writes
      // `[cause]: ...` when it prints an uncaught error carrying one; no source comment can fake
      // this assertion and no `.message` cell can reach it.
      expect(combined, `the command's output:\n${combined}`).not.toMatch(/\[cause\]/)
      expect(run.status, `the command should report and exit 1, not crash-exit: ${combined}`).toBe(1)
    })
})

describe('the controls: the guard fires on the FAULT, and on nothing else (395-14)', () => {
  it('(F6) a WELL-FORMED config still proposes — the guard fired zero times', async () => {
    seedConfig(WELL_FORMED_CONFIG)

    const { answer, error } = await invokeComposed({
      functionId: 'config.field.set',
      payload: { path: 'use.timeout.step', value: '45s' },
    })

    // Named rather than swallowed: a catch that had started eating healthy loads would fail here
    // with the message it failed with.
    expect(error?.message ?? null).toBeNull()
    expect((answer as { outcome?: string }).outcome).toBe('proposed')
  })

  it('(F7) the same fault with NO credential anywhere still reports its position', async () => {
    // THE PRECONDITION-GUARDED CORPUS LAW. Every other road cell is drawn from inside the rule's
    // own assumption — a fault WITH a secret beside it. A fix keyed on detecting a secret rather
    // than on the fault would pass all of them and red here, and a fallback that hid the fault
    // entirely (T-395-42) would red here too.
    seedConfig(faultyConfigText({ credential: false }))

    const { error } = await invokeComposed({
      functionId: 'config.field.set',
      payload: { path: 'use.timeout.step', value: '45s' },
    })

    expect(error, 'a secretless parse fault is still a fault').toBeDefined()
    const message = error?.message ?? ''
    expect(message).toMatch(/line \d+, column \d+/)
    expect(message).toContain(CONFIG_FILE)
    // The file's own content stays out of it here too — the line this fixture carries instead of
    // the credential is still the person's text.
    expect(message).not.toContain(ORDINARY_LINE)
  })
})

describe('the shared primitive answers rather than crashes (395-14 · WR-08 / F-09)', () => {
  it('(W1) a null or primitive throw gets the value-free fallback, and no TypeError', () => {
    // THE 395-10 COPY READ `.linePos` OFF THE ARGUMENT UNGUARDED. `throw null` is a legal throw, and
    // `null.linePos` is a TypeError raised inside the code whose entire job is to turn a fault into
    // a sentence — the fault would be replaced by a crash in the reporter.
    expect(yamlParseFailureMessage(null)).toBe('not readable as YAML (position unavailable)')
    expect(yamlParseFailureMessage('boom')).toBe('not readable as YAML (position unavailable)')
    expect(yamlParseFailureMessage(undefined)).toBe('not readable as YAML (position unavailable)')
    expect(yamlParseFailureMessage(7)).toBe('not readable as YAML (position unavailable)')
    // And an object with no position — the shape the fallback exists for — answers the same.
    expect(yamlParseFailureMessage(new Error('a message nobody may publish')))
      .toBe('not readable as YAML (position unavailable)')
  })
})

describe('the ENOENT arms are byte-identical (395-14 · T-395-41)', () => {
  it('(E1) a missing file answers the empty object, and the required loader\'s VERBATIM sentence',
    async () => {
      const missing = join(root, 'nowhere', 'agent-qa.config.yaml')

      expect(await loadConfigFile(missing)).toEqual({})

      // BYTE-EQUAL, not `toContain`. `scripts/395-live-from-zero.sh:514` matches this sentence to
      // decide whether SC-5's third arm has reopened, and `coveringGrantInForce`'s fold is
      // documented against it. A parse guard written as one broad catch around the whole loader
      // would reword it, and this is the cell that would say so.
      const error = await loadRequiredConfigFile(missing).then(
        () => undefined,
        (err: unknown) => err as Error,
      )
      expect(error?.message).toBe(`Config file not found: ${missing}`)
      expect(error?.name).toBe('Error')
    })

  it('(E1b) a non-ENOENT READ fault is rethrown untouched — the guard is parse-scoped', async () => {
    // A directory where a file should be is EISDIR, a fact about the filesystem and not about any
    // file's content. A catch broad enough to reword it would be reporting a yaml position for a
    // file that was never parsed.
    const asDirectory = join(root, 'is-a-dir.yaml')
    mkdirSync(asDirectory)
    const error = await loadConfigFile(asDirectory).then(
      () => undefined,
      (err: unknown) => err as NodeJS.ErrnoException,
    )
    expect(error?.code).toBe('EISDIR')
    expect(error?.name).not.toBe('ConfigFileNotYamlError')
  })
})
