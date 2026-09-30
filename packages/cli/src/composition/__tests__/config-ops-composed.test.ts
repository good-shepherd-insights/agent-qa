// The four 395-05 actions over the REAL ports and a REAL file (395-05 · CFGM-01/02 · D-01/D-02/D-11).
//
// 2026-09-30, 432-11 D-05/D-07: the actions WRITE IN THE CALL through the real direct writer, so
// the cells read the change back off the file on disk rather than out of a filed proposal.
//
// WHY THIS FILE EXISTS BESIDE `agent`'s `config-ops.test.ts`, AND WHY EITHER ALONE WOULD BE WEAKER.
// That file drives the real ops through the real pipeline with a yaml DOUBLE — a double built from
// the same library and the same calls the shipped port makes, which is as close as `packages/agent`
// can get, because `yaml` is not among its runtime dependencies. Close is not the same, and this
// project has recorded what the gap costs: a contract measured on one side only agrees with itself.
// So the halves this file pins are exactly the ones a double cannot:
//
//   1. `createConfigFilesPort.inspect` — the structural probe a collision refusal and a not-found
//      refusal both rest on, answered from a file on disk rather than from a fixture string.
//   2. `createConfigFilesPort.setField` with a STRUCTURED value — a target entry and a hook entry
//      are maps, and the append is past the end of a real sequence.
//   3. `createConfigFilesPort.mintHookId` — the REAL mint, checked against the REAL
//      `isCanonicalHookId`. A double's id proves only that somebody typed a plausible string.
//   4. `createConfigValidatePort` over the whole candidate SET — with `core`'s actual
//      `AgentQaConfigSchema` and `HooksFileSchema`, so "the hooks file is validated" is measured
//      against the schema that will refuse it at run time rather than against a marker.
//
// WHAT MAKES EACH CELL RED is named on the cell. The two sharpest: (H2) reds on a validator that
// reads only the config yaml — the state this code was in before 395-05 — and (H1) reds on any id
// this codebase did not mint, including a hand-formatted `h_` string that looks right.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createFunctionRegistry, invokeFunction } from '@vostride/agent-qa-agent'
import * as dashboard from '@vostride/agent-qa-dashboard'
import type { FunctionDeps } from '@vostride/agent-qa-agent'
import { isCanonicalHookId } from '@vostride/agent-qa-ids'
import {
  FunctionScopeSchema,
  MASKED_RESOLVED_CONFIG_SCHEMA_VERSION,
} from '@vostride/agent-qa-schema'
import type {
  ConfigChangeOutput,
  ConfigProposalV1,
  FunctionCaller,
} from '@vostride/agent-qa-schema'
import { scanConstructedArtifact } from '@vostride/agent-qa-safety'
import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createFnCommand } from '../../commands/fn.js'
import {
  CLI_FUNCTION_CALLER,
  composeCliLocalAgent,
  createConfigFilesPort,
  createConfigValidatePort,
  createConfigWritePort,
} from '../local-agent-host.js'

const HUMAN: FunctionCaller = {
  surface: 'test',
  grantedScopes: [...FunctionScopeSchema.options],
  safeMode: false,
  origin: 'human',
}

/** The house style, comment-dense — the comments are cell (C3)'s subject. */
const SEEDED_CONFIG = `# agent-qa Configuration

# File discovery and project settings
workspace:
  testMatch:
    - tests/**/*.yaml
  suiteMatch:
    - suites/**/*.suite.yaml
  hooksFile: hooks.yaml
  envFile: .env
  secretsFile: .env.secrets.local

# Named resource definitions (LLM configs, app targets)
registry:
  targets:
    # Optional: add more web or mobile targets here.
    local-form:
      platform: web
      url: http://127.0.0.1:8931/form.html

# How runs behave by default.
use:
  mobile:
    appState: reset
  parallel: false
`

const SEEDED_HOOKS = `hooks:
  - id: h_aster-bloom-cloud-drift-ember-field-glade-hollow-ivory-jasper
    name: Fetch first HN story
    runtime: node
    file: scripts/fetch-hn-top-story.mjs
    timeout: 30s
    network: true
`

let root: string
let configPath: string
let filed: { kind: string; emittedBy: string; payload: ConfigProposalV1 }[]

function registry() {
  const deps = {
    runs: {
      list: () => Promise.resolve([]),
      get: () => Promise.resolve(undefined),
      readEvents: () => Promise.resolve([]),
      readStepEvidence: () => Promise.resolve({ kind: 'run-not-recorded' as const }),
    },
    knowledge: {
      listBundles: () => Promise.resolve([]),
      inspectRecords: () => Promise.resolve([]),
      diffSince: () => Promise.resolve([]),
      showRecord: ({ recordId }: { recordId: string }) =>
        Promise.resolve({ kind: 'not-found' as const, schemaVersion: 1, recordId }),
    },
    entities: {
      resolve: () => Promise.resolve({ kind: 'none' as const, reason: 'no-match' as const }),
      get: () => Promise.resolve(undefined),
    },
    config: {
      getMasked: () => Promise.resolve({
        schemaVersion: MASKED_RESOLVED_CONFIG_SCHEMA_VERSION,
        configPath: 'agent-qa.config.yaml',
        entries: [],
      }),
    },
    // THE TWO PRODUCTION PORTS THIS FILE IS ABOUT.
    configFiles: createConfigFilesPort(configPath),
    configValidate: createConfigValidatePort(),
    // The REAL scan with an EMPTY seed set, on `config-apply.test.ts`'s stated reasoning: the
    // function is production's and the seeds are not, because a cell whose verdict depends on
    // whether a developer exported a token is a cell that measures the machine.
    configScan: { scan: (parts: Parameters<typeof scanConstructedArtifact>[0]) =>
      scanConstructedArtifact(parts, {}) },
    // 432-11: THE REAL DIRECT WRITER, over the real workspace.
    configWrite: createConfigWritePort(configPath),
    // Nothing should reach the store any more; it is still bound so a filing would be seen.
    configProposals: {
      put: (record: { kind: string; emittedBy: string; payload: ConfigProposalV1 }) => {
        filed.push(record)
        return Promise.resolve({ proposalId: `prop-${filed.length}` })
      },
    },
  } as unknown as FunctionDeps

  return createFunctionRegistry({
    deps,
    auditSink: { appendExecutionAudit() {}, appendGuardrailAudit() {} },
    resolveExecutionContext: () => 'local-interactive',
  })
}

async function call(id: string, input: unknown): Promise<ConfigChangeOutput> {
  return await invokeFunction(registry(), id, input, HUMAN) as ConfigChangeOutput
}

/** The bytes the direct writer left on disk for a workspace file — never a string the test built. */
function writtenText(path = 'agent-qa.config.yaml'): string {
  return readFileSync(join(root, path), 'utf8')
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'config-ops-'))
  configPath = join(root, 'agent-qa.config.yaml')
  writeFileSync(configPath, SEEDED_CONFIG)
  writeFileSync(join(root, 'hooks.yaml'), SEEDED_HOOKS)
  filed = []
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('the 395-05 actions over the real ports (D-01)', () => {
  it('(C1) creates a target as one house-style block, written to the file in the call', async () => {
    const answer = await call('config.target.create', {
      name: 'shop',
      platform: 'web',
      url: 'https://shop.example.com',
    })
    expect(answer.outcome).toBe('applied')
    if (answer.outcome !== 'applied') throw new Error('unreachable')

    expect(answer.crossBoundaryReasons).toEqual(['new-origin'])
    expect(answer.files).toEqual(['agent-qa.config.yaml'])
    // WRITTEN, IN THE CALL, AS ONE BLOCK — and nothing was filed (432-11 D-05).
    expect(writtenText()).toContain('    shop:\n      platform: web\n      url: https://shop.example.com')
    expect(filed).toHaveLength(0)
  })

  it('(C2) refuses a collision, with candidates read off the REAL document', async () => {
    const answer = await call('config.target.create', {
      name: 'local-form',
      platform: 'web',
      url: 'https://elsewhere.example',
    })
    expect(answer.outcome).toBe('refused')
    if (answer.outcome !== 'refused') throw new Error('unreachable')
    expect(answer.reason).toBe('target-exists')
    // The name came out of the file, through `inspect`. This reds on a probe that answered from a
    // parse of something else, and on one that returned nothing at all.
    expect(answer.candidates).toEqual(['local-form'])
    expect(filed).toHaveLength(0)
    expect(writtenText()).toBe(SEEDED_CONFIG)
  })

  it('(C3) every comment in the committed file survives a structured write', async () => {
    await call('config.target.create', {
      name: 'shop',
      platform: 'web',
      url: 'https://shop.example.com',
    })
    const content = writtenText()
    for (const comment of [
      '# agent-qa Configuration',
      '# File discovery and project settings',
      '# Named resource definitions (LLM configs, app targets)',
      '# Optional: add more web or mobile targets here.',
      '# How runs behave by default.',
    ]) {
      expect(content, comment).toContain(comment)
    }
  })

  it('(C4) an edit at a FIXED path answers differently for two values', async () => {
    const near = await call('config.target.edit', {
      name: 'local-form',
      changes: { url: 'http://127.0.0.1:8931/other.html' },
    })
    if (near.outcome !== 'applied') throw new Error('unreachable')
    expect(near.crossBoundaryReasons).toEqual([])

    // The second edit starts from the seeded file again, so both compare against the same origin.
    writeFileSync(configPath, SEEDED_CONFIG)
    const far = await call('config.target.edit', {
      name: 'local-form',
      changes: { url: 'http://127.0.0.1:9999/form.html' },
    })
    if (far.outcome !== 'applied') throw new Error('unreachable')
    // A DIFFERENT PORT IS A DIFFERENT ORIGIN, which is the case a host-only comparison misses.
    expect(far.crossBoundaryReasons).toEqual(['new-origin'])
  })

  it('(C5) a credential in an auth reference is refused, and the file is never opened for writing',
    async () => {
      const answer = await call('config.auth.set', {
        target: 'local-form',
        authStateName: 'AKIAQWERTYUIOPASDFGH',
      })
      expect(answer.outcome).toBe('refused')
      if (answer.outcome !== 'refused') throw new Error('unreachable')
      expect(answer.reason).toBe('refs-only')
      expect(filed).toHaveLength(0)
      expect(readFileSync(configPath, 'utf8')).toBe(SEEDED_CONFIG)
    })

  it('(H1) a hook is appended with an id the REAL canonical check accepts', async () => {
    const answer = await call('config.hook.add', {
      name: 'Seed the cart',
      runtime: 'node',
      file: 'scripts/seed.mjs',
    })
    expect(answer.outcome).toBe('applied')
    if (answer.outcome !== 'applied') throw new Error('unreachable')

    // THE ONE FILE THIS ACTION TOUCHES, and it is not the config yaml.
    expect(answer.files).toEqual(['hooks.yaml'])
    expect(answer.crossBoundaryReasons).toEqual(['hook-added'])
    expect(writtenText()).toBe(SEEDED_CONFIG)

    const content = writtenText('hooks.yaml')
    const ids = content.split('\n')
      .filter((line) => line.includes('id: h_'))
      .map((line) => line.slice(line.indexOf('h_')).trim())
    expect(ids).toHaveLength(2)
    // BOTH — the committed one and the minted one — measured against the SHIPPED predicate. A
    // hand-formatted `h_` string fails here, which is the whole reason the mint is a port call.
    for (const id of ids) expect(isCanonicalHookId(id), id).toBe(true)
    expect(ids[0]).toBe('h_aster-bloom-cloud-drift-ember-field-glade-hollow-ivory-jasper')
    expect(ids[1]).not.toBe(ids[0])
    expect(content).toContain('name: Seed the cart')
  })

  it('(H2) the REAL hooks schema validates the candidate — an unreadable duration blocks', async () => {
    // `HookDefinitionSchema.timeout` is refined through `ms()`, and the ACTION's DTO accepts any
    // non-empty string, so this is a candidate only whole-input validation can refuse. It reds on
    // the validator this code had before 395-05, which read the config yaml and nothing else.
    const answer = await call('config.hook.add', {
      name: 'Seed the cart',
      runtime: 'node',
      file: 'scripts/seed.mjs',
      timeout: 'whenever',
    })
    expect(answer.outcome).toBe('blocked')
    if (answer.outcome !== 'blocked') throw new Error('unreachable')
    expect(answer.blockedReason).toBe('schema-fail')
    expect(answer.paths).toEqual(['hooks.yaml'])
    expect(answer.validationIssues?.join(' ')).toContain('hooks.yaml')
    expect(answer.validationIssues?.join(' ')).toContain('Invalid duration format')
  })

  it('(H3) CONTROL: the same hook with a readable duration is written', async () => {
    // WITHOUT THIS, (H2) would pass against a validator that refuses every hooks file. The control
    // is what makes the refusal a fact about the duration rather than about the file.
    const answer = await call('config.hook.add', {
      name: 'Seed the cart',
      runtime: 'node',
      file: 'scripts/seed.mjs',
      timeout: '45s',
    })
    expect(answer.outcome).toBe('applied')
    expect(writtenText('hooks.yaml')).toContain('timeout: 45s')
  })

  it('(H4) a duplicate hook NAME is refused by the hooks schema, not by this code', async () => {
    // The refinement lives in `core`'s `HooksFileSchema`, and this cell is what says the pipeline
    // reaches it. An op that had grown its own duplicate check would be a second, weaker copy.
    const answer = await call('config.hook.add', {
      name: 'Fetch first HN story',
      runtime: 'node',
      file: 'scripts/other.mjs',
    })
    expect(answer.outcome).toBe('blocked')
    if (answer.outcome !== 'blocked') throw new Error('unreachable')
    expect(answer.validationIssues?.join(' ')).toContain('Duplicate hook name')
  })

  it('(H5) a project with no hooks file gets one, and it validates', async () => {
    rmSync(join(root, 'hooks.yaml'))
    const answer = await call('config.hook.add', {
      name: 'Seed the cart',
      runtime: 'bash',
      file: 'scripts/seed.sh',
    })
    expect(answer.outcome).toBe('applied')
    if (answer.outcome !== 'applied') throw new Error('unreachable')
    // CREATED: the file did not exist, and now holds the one hook with the default timeout.
    expect(answer.files).toEqual(['hooks.yaml'])
    expect(answer.shownDiff).toContain('--- /dev/null')
    expect(writtenText('hooks.yaml')).toContain('timeout: 30s')
  })
})

// ---- 432-11 D-05/D-07: all six config operations write in the call, on the real host -----------
//
// C432-CONFIG-SIX-OPS  scaffold, target create, target edit, field set, auth set and hook add, in
//                      one workspace, through the composed CLI host and through `agent-qa fn`.
//                      Each call changes the files on disk before it answers; nothing is filed as a
//                      proposal; a dirty repository's HEAD, index and staged work do not move, and a
//                      directory with no repository is an ordinary workspace.

/** A configuration with a model and no targets, the project a scaffold merges into. */
const ZERO_TARGET_CONFIG = `# agent-qa Configuration
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
  mobile:
    appState: preserve
  parallel: false
`

const SIX_OPS: readonly (readonly [string, Record<string, unknown>])[] = [
  ['config.project.scaffold', { domain: 'booking.com' }],
  ['config.target.create', { name: 'basket', platform: 'web', url: 'https://basket.example.com' }],
  ['config.target.edit', { name: 'basket', changes: { url: 'https://basket.example.com/cart' } }],
  ['config.field.set', { path: 'use.parallel', value: true }],
  // The committed `use` block has no `authState` key (a per-test override only), so the auth op's
  // road through whole-config validation is the plugin declaration.
  ['config.auth.set', { target: 'basket', pluginPackage: '@acme/agent-qa-auth' }],
  ['config.hook.add', { name: 'Seed the cart', runtime: 'node', file: 'scripts/seed.mjs' }],
]

function gitIn(cwd: string, ...args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} exited ${result.status}: ${result.stderr}`)
  return result.stdout
}

function repositorySnapshot(cwd: string) {
  return {
    head: gitIn(cwd, 'rev-parse', 'HEAD').trim(),
    index: gitIn(cwd, 'ls-files', '--stage'),
    staged: gitIn(cwd, 'diff', '--cached', '--name-status'),
    commits: gitIn(cwd, 'rev-list', '--count', 'HEAD').trim(),
  }
}

async function viaHost(id: string, input: unknown): Promise<Record<string, unknown>> {
  const composed = composeCliLocalAgent({ agentQaRoot: join(root, '.agent-qa'), configPath })
  try {
    return await invokeFunction(composed.registry, id, input, CLI_FUNCTION_CALLER) as Record<string, unknown>
  } finally {
    await composed.close()
  }
}

async function viaFn(id: string, input: unknown): Promise<Record<string, unknown>> {
  const stdout: string[] = []
  const log = vi.spyOn(console, 'log').mockImplementation((...values: unknown[]) => {
    stdout.push(values.map(String).join(' '))
  })
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  const priorExit = process.exitCode
  process.exitCode = undefined
  try {
    const program = new Command()
      .option('--config <path>', 'config file path')
      .addCommand(createFnCommand())
    program.exitOverride()
    await program.parseAsync([
      'node', 'agent-qa', '--config', configPath, 'fn', id, '--json', '--input', JSON.stringify(input),
    ])
    expect(process.exitCode, `${id} exited cleanly`).toBeUndefined()
    return JSON.parse(stdout.join('\n')) as Record<string, unknown>
  } finally {
    process.exitCode = priorExit
    log.mockRestore()
    error.mockRestore()
  }
}

async function runAllSix(door: typeof viaHost): Promise<void> {
  for (const [id, input] of SIX_OPS) {
    const before = readFileSync(configPath, 'utf8')
    const answer = await door(id, input)
    expect(answer.outcome, `${id}: ${JSON.stringify(answer)}`).toBe('applied')
    expect(answer, id).not.toHaveProperty('proposalId')
    const files = answer.files as string[]
    expect(files.length, id).toBeGreaterThan(0)
    // The answer names what is now on disk: a config change moved the config file's bytes.
    if (files.includes('agent-qa.config.yaml')) {
      expect(readFileSync(configPath, 'utf8'), id).not.toBe(before)
    }
  }

  const config = readFileSync(configPath, 'utf8')
  expect(config).toContain('booking-com:')
  expect(config).toContain('url: https://basket.example.com/cart')
  expect(config).toContain('parallel: true')
  expect(config).toContain('- package: "@acme/agent-qa-auth"')
  expect(config).toContain('# agent-qa Configuration')
  const hooks = readFileSync(join(root, 'hooks.yaml'), 'utf8')
  expect(hooks).toContain('name: Seed the cart')
  expect(hooks).toContain('name: Fetch first HN story')
  expect(existsSync(join(root, '.gitignore'))).toBe(true)
  // No proposal record anywhere under the runtime root.
  expect(existsSync(join(root, '.agent-qa', 'proposals'))
    ? readdirSync(join(root, '.agent-qa', 'proposals')).filter((name) => name.endsWith('.json'))
    : []).toEqual([])
}

describe('C432-CONFIG-SIX-OPS: every config operation writes in the call through the real host', () => {
  it('C432-CONFIG-SIX-OPS: all six through the composed host in a dirty repository leave git alone',
    async () => {
      writeFileSync(configPath, ZERO_TARGET_CONFIG)
      gitIn(root, 'init', '--quiet')
      gitIn(root, 'config', 'user.name', 'agent-qa six ops test')
      gitIn(root, 'config', 'user.email', 'six-ops-test@example.invalid')
      gitIn(root, 'config', 'commit.gpgsign', 'false')
      gitIn(root, 'add', '--', 'agent-qa.config.yaml', 'hooks.yaml')
      gitIn(root, 'commit', '--quiet', '-m', 'seed')
      // Dirty: an uncommitted edit to the config and unrelated staged work.
      writeFileSync(configPath, ZERO_TARGET_CONFIG.replace('  parallel: false', '  # mine\n  parallel: false'))
      writeFileSync(join(root, 'notes.md'), 'staged by the owner\n')
      gitIn(root, 'add', '--', 'notes.md')
      const before = repositorySnapshot(root)

      await runAllSix(viaHost)

      expect(repositorySnapshot(root)).toEqual(before)
      expect(readFileSync(configPath, 'utf8')).toContain('  # mine\n')
    })

  it('C432-CONFIG-SIX-OPS: all six through agent-qa fn in a directory with no repository', async () => {
    writeFileSync(configPath, ZERO_TARGET_CONFIG)
    expect(spawnSync('git', ['rev-parse', '--git-dir'], { cwd: root, encoding: 'utf8' }).status)
      .not.toBe(0)

    await runAllSix(viaFn)

    expect(existsSync(join(root, '.git'))).toBe(false)
  })
})

// ---- 432-11: edges, retries and retained controls on the real host --------------------------------
//
// Each cell holds a path's write turn through the shared per-path queue, so an outside edit lands
// after the op read the file and before its write takes its turn — the window the transaction and
// the whole-file digest check exist for.

async function holdTurn(path: string): Promise<{ held: Promise<void>; release: () => void }> {
  const serialize = (dashboard as Record<string, unknown>).serializeConfigWrite as
    <T>(path: string, work: () => Promise<T>) => Promise<T>
  expect(typeof serialize, 'the per-path config queue is exported').toBe('function')
  let release!: () => void
  let entered!: () => void
  const holding = new Promise<void>((resolve) => { entered = resolve })
  const held = serialize(path, () => new Promise<void>((resolve) => {
    release = resolve
    entered()
  }))
  await holding
  return { held, release: () => release() }
}

function settle(ms = 50): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe('C432-CONFIG-THREE-OPS: the direct write meets an outside edit in its own turn', () => {
  it('C432-CONFIG-THREE-OPS: a field set keeps an outside edit to another field, and its diff is its own',
    async () => {
      const { held, release } = await holdTurn(configPath)
      const pending = call('config.field.set', { path: 'use.parallel', value: true })
      await settle()
      // The owner edits another field while the change waits for its turn.
      const outside = SEEDED_CONFIG.replace('    appState: reset', '    appState: preserve')
      writeFileSync(configPath, outside)
      release()
      await held

      const answer = await pending
      expect(answer).toMatchObject({ outcome: 'applied', files: ['agent-qa.config.yaml'], fields: ['use.parallel'] })
      if (answer.outcome !== 'applied') throw new Error('unreachable')
      // The diff is the change as built from the file the call read — its context still shows the
      // value the call read — so the outside edit is not in it; the file holds both.
      expect(answer.shownDiff).toContain('+  parallel: true')
      expect(answer.shownDiff).not.toContain('appState: preserve')
      expect(readFileSync(configPath, 'utf8')).toBe(outside.replace('parallel: false', 'parallel: true'))
    })

  it('C432-CONFIG-THREE-OPS: a create whose name is taken while it waits refuses, keeps the outside target, and a retry says why',
    async () => {
      const { held, release } = await holdTurn(configPath)
      const pending = call('config.target.create', {
        name: 'shop',
        platform: 'web',
        url: 'https://shop.example.com',
      })
      await settle()
      const outside = SEEDED_CONFIG.replace(
        '      url: http://127.0.0.1:8931/form.html\n',
        '      url: http://127.0.0.1:8931/form.html\n    shop:\n      platform: web\n      url: https://owner.example.com\n',
      )
      writeFileSync(configPath, outside)
      release()
      await held

      const answer = await pending
      expect(answer).toMatchObject({ outcome: 'refused', reason: 'field-changed' })
      if (answer.outcome !== 'refused') throw new Error('unreachable')
      expect(answer.detail).toContain('registry.targets.shop')
      // NOT REPLACED: the owner's target is exactly as they wrote it.
      expect(readFileSync(configPath, 'utf8')).toBe(outside)

      // THE RETRY reads the file again and gives the request-level answer.
      const retry = await call('config.target.create', {
        name: 'shop',
        platform: 'web',
        url: 'https://shop.example.com',
      })
      expect(retry).toMatchObject({ outcome: 'refused', reason: 'target-exists' })
      expect(readFileSync(configPath, 'utf8')).toBe(outside)
      expect(filed).toHaveLength(0)
    })
})

describe('C432-CONFIG-MULTIFILE-TRUTH: a whole-file write that meets an outside edit says exactly what happened', () => {
  it('C432-CONFIG-MULTIFILE-TRUTH: a hooks file edited while the write waited is not overwritten, and a retry lands on the edit',
    async () => {
      const hooksPath = join(root, 'hooks.yaml')
      const { held, release } = await holdTurn(hooksPath)
      const pending = call('config.hook.add', {
        name: 'Seed the cart',
        runtime: 'node',
        file: 'scripts/seed.mjs',
      })
      await settle()
      const outside = `${SEEDED_HOOKS}  - id: h_birch-cedar-dune-elm-fern-grove-heath-iris-juniper-kelp\n    name: Owner hook\n    runtime: bash\n    file: scripts/owner.sh\n    timeout: 10s\n`
      writeFileSync(hooksPath, outside)
      release()
      await held

      const answer = await pending
      // NOTHING WRITTEN, AND THE ANSWER SAYS SO: the only file stopped at its own turn.
      expect(answer).toMatchObject({
        outcome: 'interrupted',
        written: [],
        failed: { path: 'hooks.yaml', reason: 'file-changed' },
        unwritten: [],
      })
      expect(readFileSync(hooksPath, 'utf8')).toBe(outside)

      // THE RETRY builds over the owner's file and keeps their hook.
      const retry = await call('config.hook.add', {
        name: 'Seed the cart',
        runtime: 'node',
        file: 'scripts/seed.mjs',
      })
      expect(retry).toMatchObject({ outcome: 'applied', files: ['hooks.yaml'] })
      const hooks = readFileSync(hooksPath, 'utf8')
      expect(hooks.startsWith(outside)).toBe(true)
      expect(hooks).toContain('name: Seed the cart')
      expect(filed).toHaveLength(0)
    })

  it('C432-CONFIG-MULTIFILE-TRUTH: CONTROL: with no outside edit the same hook is written whole, first time',
    async () => {
      const answer = await call('config.hook.add', {
        name: 'Seed the cart',
        runtime: 'node',
        file: 'scripts/seed.mjs',
      })
      expect(answer).toMatchObject({ outcome: 'applied', files: ['hooks.yaml'] })
      expect(readFileSync(join(root, 'hooks.yaml'), 'utf8').startsWith(SEEDED_HOOKS)).toBe(true)
    })
})

describe('retained control: config.undo.propose still files its own proposal until 432-17', () => {
  it('the undo answers the proposal union and, with no agent commit, refuses by name and writes nothing', async () => {
    gitIn(root, 'init', '--quiet')
    gitIn(root, 'config', 'user.name', 'agent-qa undo control')
    gitIn(root, 'config', 'user.email', 'undo-control@example.invalid')
    gitIn(root, 'config', 'commit.gpgsign', 'false')
    gitIn(root, 'add', '--', 'agent-qa.config.yaml', 'hooks.yaml')
    gitIn(root, 'commit', '--quiet', '-m', 'seed')
    // A direct change first: it makes no agent commit, so there is still nothing to undo.
    expect(await viaHost('config.field.set', { path: 'use.parallel', value: true }))
      .toMatchObject({ outcome: 'applied' })
    const answer = await viaHost('config.undo.propose', {}) as { outcome: string; reason?: string }
    expect(answer.outcome).toBe('refused')
    expect(answer.reason).toBe('no-agent-commit')
    expect(readFileSync(configPath, 'utf8')).toBe(SEEDED_CONFIG.replace('parallel: false', 'parallel: true'))
    expect(gitIn(root, 'rev-list', '--count', 'HEAD').trim()).toBe('1')
    expect(existsSync(join(root, '.agent-qa', 'proposals'))).toBe(false)
  })
})
