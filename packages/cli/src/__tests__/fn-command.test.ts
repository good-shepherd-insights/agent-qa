// End-to-end tracer for the 384 function layer (Plan 01, D-05/D-06/D-11).
//
// `agent-qa fn runs.list` must resolve through the WHOLE path — composition-built
// registry → invokeFunction → evaluate() → injected run-dir reader → RunSummary[] —
// against a real on-disk fixture. Nothing here stubs the gate or the registry.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// `publishBundle` reaches the knowledge-local MAIN entry on purpose: a fixture needs the
// writer to produce a genuinely committed bundle. Test files are excluded from the arch
// specifier scan, so this never relaxes the reader carve-out the production composition obeys.
import { publishBundle } from '@vostride/agent-qa-knowledge-local'
import { EVENTS_FILE, RUNS_SUBDIR } from '@vostride/agent-qa-runner-local'
import {
  CONFIG_MASK_PLACEHOLDER,
  CURRENT_HANDOFF_SCHEMA_VERSION,
} from '@vostride/agent-qa-schema'
import type {
  CompletedRunHandoff,
  KnowledgeBundleSummary,
  MaskedResolvedConfig,
  RunEventEnvelope,
  RunEventType,
} from '@vostride/agent-qa-schema'
import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createFnCommand } from '../commands/fn.js'

/** A secret-shaped value the fixture config carries so masking has something to hide. */
const FIXTURE_API_KEY = 'sk-live-DO-NOT-LEAK-4242'

/**
 * Credentials planted where NO key name marks them as secret (Plan 08 / CR-01).
 *
 * `providerHeaders` and `registry.providers.<name>` are free-form records whose keys the
 * operator chooses, so these four are reached only by the opaque-subtree rule; the fifth
 * hides inside a URL's userinfo, where there is no key at all.
 */
const FIXTURE_HEADER_KEY = 'sk-live-HEADER-KEY-DO-NOT-LEAK-1111'
const FIXTURE_HEADER_CRED = 'sk-live-HEADER-CRED-DO-NOT-LEAK-2222'
const FIXTURE_HEADER_PWD = 'sk-live-HEADER-PWD-DO-NOT-LEAK-3333'
const FIXTURE_PROVIDER_KEY = 'sk-live-PROVIDER-KEY-DO-NOT-LEAK-5555'
const FIXTURE_URL_PASSWORD = 'hunter2-URL-DO-NOT-LEAK'

interface InvocationResult {
  stdout: string
  stderr: string
  exitCode: typeof process.exitCode
}

interface FixtureWorkspace {
  root: string
  configPath: string
  runtimeRoot: string
  knowledgeRoot: string
}

function fixtureWorkspace(roots: string[]): FixtureWorkspace {
  const root = mkdtempSync(join(tmpdir(), 'agent-qa-fn-command-'))
  roots.push(root)
  const configPath = join(root, 'agent-qa.config.yaml')
  writeFileSync(
    configPath,
    `${JSON.stringify({
      workspace: {
        testMatch: ['tests/**/*.yaml'],
        suiteMatch: ['suites/**/*.suite.yaml'],
        hooksFile: 'hooks.yaml',
        envFile: '.env',
        secretsFile: '.env.secrets.local',
      },
      registry: {
        llms: [
          {
            name: 'judge',
            // `anthropic-compatible` is the one provider family allowed to carry
            // providerHeaders, and a compatible provider requires a baseURL — so this is
            // the schema-legal shape a real operator credential arrives in.
            provider: 'anthropic-compatible',
            model: 'claude-fixture',
            baseURL: `https://ops:${FIXTURE_URL_PASSWORD}@llm.acme.test/v1`,
            providerHeaders: {
              'x-key': FIXTURE_HEADER_KEY,
              'x-cred': FIXTURE_HEADER_CRED,
              'x-pwd': FIXTURE_HEADER_PWD,
            },
          },
        ],
        providers: {
          acme: {
            apiKey: FIXTURE_API_KEY,
            key: FIXTURE_PROVIDER_KEY,
            baseURL: 'https://acme.test',
          },
        },
      },
      // The config schema's superRefine requires this leaf, so a resolvable fixture
      // must carry it before `config.get` can read anything at all.
      use: { mobile: { appState: 'preserve' } },
    }, null, 2)}\n`,
    'utf8',
  )
  return {
    root,
    configPath,
    runtimeRoot: join(root, '.agent-qa'),
    // `knowledge.dir` defaults to the repo-relative `agent-qa-knowledge` beside the config.
    knowledgeRoot: join(root, 'agent-qa-knowledge'),
  }
}

/** Commit one real bundle so the knowledge listing has a row that came off disk. */
function seedKnowledgeBundle(workspace: FixtureWorkspace): string {
  const outcome = publishBundle(
    {
      knowledgeRoot: workspace.knowledgeRoot,
      productKey: 'shop',
      auditBaseDir: workspace.runtimeRoot,
      commitArtifacts: 'none',
    },
    {
      draft: {
        kind: 'fact',
        subtype: 'selector',
        anchors: [
          { t: 'el', role: 'Button', name: 'Checkout Now' },
          { t: 'page', route: '/cart' },
        ],
        scope: { tier: 'product', key: 'checkout' },
        summary: 'Checkout control on the cart page',
        body: 'Selecting Checkout Now advances the cart to the payment step.',
        distilledEvidenceRef: {
          id: 'fn-command-fixture',
          sha: 'd9113d37fe29084657c462ac5628ddd56519aeafad8883092a2596075878cbee',
        },
        originStage: 'run-curation',
      },
      discriminant: {
        kind: 'fact',
        subtype: 'selector',
        elementRef: { role: 'Button', name: 'Checkout Now' },
      },
      originClass: 'agent-verified',
      createdAtOrdinal: 5,
      screenStates: [],
      initialEvents: [],
      relations: [],
      provenance: {
        mode: 'run-linked',
        runId: 'fn-command-fixture',
        testId: 'fn-command',
        stepIndex: 0,
      },
      artifacts: [],
    },
  )

  expect(outcome.kind).toBe('published')
  if (outcome.kind !== 'published') throw new Error('fixture bundle did not publish')
  return outcome.id
}

function handoff(input: {
  runId: string
  buildOrdinal: number
  aggregateVerdict: CompletedRunHandoff['aggregateVerdict']
  tests?: CompletedRunHandoff['tests']
  gateRun?: true
}): CompletedRunHandoff {
  return {
    schemaVersion: CURRENT_HANDOFF_SCHEMA_VERSION,
    runId: input.runId as CompletedRunHandoff['runId'],
    scope: { tier: 'product', key: 'shop' },
    buildOrdinal: input.buildOrdinal,
    ...(input.gateRun === undefined ? {} : { gateRun: input.gateRun }),
    executionContext: 'local-headless',
    aggregateVerdict: input.aggregateVerdict,
    configDigests: { suiteConfigDigest: 'suite-digest', testConfigDigest: 'test-digest' },
    startedAt: 1_000 + input.buildOrdinal,
    endedAt: 2_000 + input.buildOrdinal,
    tests: input.tests ?? [],
  }
}

function seedRuns(workspace: FixtureWorkspace, handoffs: readonly CompletedRunHandoff[]): void {
  for (const document of handoffs) {
    const dir = join(workspace.runtimeRoot, RUNS_SUBDIR, document.runId)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'handoff.json'), `${JSON.stringify(document)}\n`, 'utf8')
  }
}

function envelope(runId: string, seq: number, type: RunEventType): RunEventEnvelope {
  return { seq, ts: 1_700_000_000_000 + seq, runId, type, payload: {} }
}

/**
 * Write a real `events.jsonl` in the exact layout the v49 `FsEventLog` appends — one JSON
 * envelope per line, seq-ordered and gap-free at 1. The stream op reads it back through the
 * same concrete store the runner writes it with, so the CLI leg is a genuine replay.
 */
function seedEvents(
  workspace: FixtureWorkspace,
  runId: string,
  events: readonly RunEventEnvelope[],
): void {
  const dir = join(workspace.runtimeRoot, RUNS_SUBDIR, runId)
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, EVENTS_FILE),
    events.map((event) => `${JSON.stringify(event)}\n`).join(''),
    'utf8',
  )
}

/** Five gap-free envelopes for `run-alpha`, the shape a completed run leaves behind. */
function fiveEvents(runId = 'run-alpha'): RunEventEnvelope[] {
  return [
    envelope(runId, 1, 'runStarted'),
    envelope(runId, 2, 'testStarted'),
    envelope(runId, 3, 'stepStarted'),
    envelope(runId, 4, 'testFinished'),
    envelope(runId, 5, 'runFinished'),
  ]
}

async function invoke(
  workspace: FixtureWorkspace,
  args: readonly string[],
): Promise<InvocationResult> {
  const stdout: string[] = []
  const stderr: string[] = []
  const log = vi.spyOn(console, 'log').mockImplementation((...values: unknown[]) => {
    stdout.push(values.map(String).join(' '))
  })
  const error = vi.spyOn(console, 'error').mockImplementation((...values: unknown[]) => {
    stderr.push(values.map(String).join(' '))
  })
  process.exitCode = undefined

  try {
    const program = new Command()
      .option('--config <path>', 'config file path')
      .addCommand(createFnCommand())
    program.exitOverride()
    await program.parseAsync([
      'node',
      'agent-qa',
      '--config',
      workspace.configPath,
      'fn',
      ...args,
    ])
    return { stdout: stdout.join('\n'), stderr: stderr.join('\n'), exitCode: process.exitCode }
  } finally {
    log.mockRestore()
    error.mockRestore()
  }
}

describe('agent-qa fn (generic function invoker)', () => {
  const roots: string[] = []
  let originalExitCode: typeof process.exitCode

  beforeEach(() => {
    originalExitCode = process.exitCode
  })

  afterEach(() => {
    process.exitCode = originalExitCode
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('resolves runs.list end-to-end against two on-disk handoffs', async () => {
    const workspace = fixtureWorkspace(roots)
    seedRuns(workspace, [
      handoff({ runId: 'run-beta', buildOrdinal: 12, aggregateVerdict: 'failed' }),
      handoff({ runId: 'run-alpha', buildOrdinal: 11, aggregateVerdict: 'passed' }),
    ])

    const result = await invoke(workspace, ['runs.list', '--json'])

    expect(result.stderr).toBe('')
    expect(result.exitCode).toBeUndefined()
    const summaries = JSON.parse(result.stdout) as {
      runId: string
      buildOrdinal: number
      aggregateVerdict: string
      testCount: number
    }[]
    expect(summaries.map((summary) => summary.runId)).toEqual(['run-alpha', 'run-beta'])
    expect(summaries[0]).toMatchObject({
      runId: 'run-alpha',
      buildOrdinal: 11,
      aggregateVerdict: 'passed',
      testCount: 0,
    })
    expect(summaries[1]).toMatchObject({ runId: 'run-beta', aggregateVerdict: 'failed' })
  })

  it('emits a deterministic listing for a fixed fixture', async () => {
    const workspace = fixtureWorkspace(roots)
    seedRuns(workspace, [
      handoff({ runId: 'run-beta', buildOrdinal: 12, aggregateVerdict: 'failed' }),
      handoff({ runId: 'run-alpha', buildOrdinal: 11, aggregateVerdict: 'passed' }),
    ])

    const first = await invoke(workspace, ['runs.list', '--json'])
    const second = await invoke(workspace, ['runs.list', '--json'])

    expect(first).toEqual(second)
  })

  it('lists every registered function id with its scopes, result kind and binding', async () => {
    const workspace = fixtureWorkspace(roots)

    const result = await invoke(workspace, ['--list', '--json'])

    expect(result.stderr).toBe('')
    expect(result.exitCode).toBeUndefined()
    const declarations = JSON.parse(result.stdout) as {
      id: string
      requiredScopes: string[]
      resultKind: string
      bindingStatus: string
    }[]
    // The registered capability set verbatim: the four D-06 seed reads plus the D-08
    // stream op. `resultKind` and `bindingStatus` are part of the published contract, so
    // the listing is asserted as an exact table rather than a shape check.
    expect(Object.fromEntries(declarations.map((declaration) => [declaration.id, {
      requiredScopes: declaration.requiredScopes,
      resultKind: declaration.resultKind,
      bindingStatus: declaration.bindingStatus,
    }]))).toEqual({
      'config.get': { requiredScopes: ['read'], resultKind: 'unary', bindingStatus: 'bound' },
      'knowledge.bundles.list': {
        requiredScopes: ['read'],
        resultKind: 'unary',
        bindingStatus: 'bound',
      },
      'runs.events': { requiredScopes: ['read'], resultKind: 'stream', bindingStatus: 'bound' },
      'runs.get': { requiredScopes: ['read'], resultKind: 'unary', bindingStatus: 'bound' },
      'runs.list': { requiredScopes: ['read'], resultKind: 'unary', bindingStatus: 'bound' },
      // Declared in full and visibly UNBOUND until 386 relocates the composition root
      // (D-09). A capability the CLI cannot run is still a capability the CLI can see.
      'runs.start': { requiredScopes: ['run'], resultKind: 'unary', bindingStatus: 'unbound' },
    })
    // Sorted lexicographically by id, so a catalog projection is deterministic.
    expect(declarations.map((declaration) => declaration.id)).toEqual(
      [...declarations.map((declaration) => declaration.id)].sort(),
    )
  })

  it('renders a human listing naming each registered function', async () => {
    const workspace = fixtureWorkspace(roots)

    const result = await invoke(workspace, ['--list'])

    expect(result.stderr).toBe('')
    expect(result.exitCode).toBeUndefined()
    expect(result.stdout).toContain('runs.list')
  })

  it('returns an empty list for a root with no runs directory', async () => {
    const workspace = fixtureWorkspace(roots)

    const result = await invoke(workspace, ['runs.list', '--json'])

    expect(result.stderr).toBe('')
    expect(result.exitCode).toBeUndefined()
    expect(JSON.parse(result.stdout)).toEqual([])
  })

  it('reports runs.start as declared-but-unbound rather than as missing (D-09)', async () => {
    const workspace = fixtureWorkspace(roots)

    const result = await invoke(workspace, ['runs.start', '--json'])

    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('FunctionNotBoundError')
    expect(result.stderr).toContain('runs.start')
    expect(result.stderr).not.toContain('Unknown function')
  })

  it('reports an unknown function id without throwing out of the action', async () => {
    const workspace = fixtureWorkspace(roots)

    const result = await invoke(workspace, ['runs.nope', '--json'])

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('runs.nope')
  })

  it('resolves runs.get end-to-end for a run recorded on disk', async () => {
    const workspace = fixtureWorkspace(roots)
    seedRuns(workspace, [
      handoff({ runId: 'run-alpha', buildOrdinal: 11, aggregateVerdict: 'passed' }),
      handoff({
        runId: 'run-beta',
        buildOrdinal: 12,
        aggregateVerdict: 'failed',
        gateRun: true,
        tests: [{
          testId: 'test-1',
          testName: 'checks out',
          filePath: 'tests/checkout.yaml',
          testIndex: 0,
          outcome: 'failed',
          steps: [],
        }],
      }),
    ])

    const result = await invoke(workspace, [
      'runs.get',
      '--input',
      JSON.stringify({ runId: 'run-beta' }),
      '--json',
    ])

    expect(result.stderr).toBe('')
    expect(result.exitCode).toBeUndefined()
    expect(JSON.parse(result.stdout)).toMatchObject({
      runId: 'run-beta',
      buildOrdinal: 12,
      aggregateVerdict: 'failed',
      gateRun: true,
      configDigests: { suiteConfigDigest: 'suite-digest', testConfigDigest: 'test-digest' },
      tests: [{
        testId: 'test-1',
        testName: 'checks out',
        filePath: 'tests/checkout.yaml',
        testIndex: 0,
        outcome: 'failed',
        stepCount: 0,
      }],
    })
  })

  it('fails runs.get with the typed not-found error for an unknown runId', async () => {
    const workspace = fixtureWorkspace(roots)
    seedRuns(workspace, [
      handoff({ runId: 'run-alpha', buildOrdinal: 11, aggregateVerdict: 'passed' }),
    ])

    const result = await invoke(workspace, [
      'runs.get',
      '--input',
      JSON.stringify({ runId: 'run-missing' }),
      '--json',
    ])

    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('RunNotFoundError')
    expect(result.stderr).toContain('run-missing')
  })

  it('resolves knowledge.bundles.list end-to-end against a committed bundle', async () => {
    const workspace = fixtureWorkspace(roots)
    const bundleId = seedKnowledgeBundle(workspace)

    const result = await invoke(workspace, ['knowledge.bundles.list', '--json'])

    expect(result.stderr).toBe('')
    expect(result.exitCode).toBeUndefined()
    const rows = JSON.parse(result.stdout) as KnowledgeBundleSummary[]
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      bundleId,
      product: 'shop',
      kind: 'fact',
      subtype: 'selector',
      scope: { tier: 'product', key: 'checkout' },
      dir: `memory/shop/bundles/${bundleId}`,
      summary: 'Checkout control on the cart page',
    })
  })

  it('returns an empty knowledge listing for a workspace with no committed bundles', async () => {
    const workspace = fixtureWorkspace(roots)

    const result = await invoke(workspace, ['knowledge.bundles.list', '--json'])

    expect(result.stderr).toBe('')
    expect(result.exitCode).toBeUndefined()
    expect(JSON.parse(result.stdout)).toEqual([])
  })

  it('resolves config.get and never renders the raw secret (T-384-07)', async () => {
    const workspace = fixtureWorkspace(roots)

    const result = await invoke(workspace, ['config.get', '--json'])

    expect(result.stderr).toBe('')
    expect(result.exitCode).toBeUndefined()

    // The security claim, asserted against the bytes a caller actually sees.
    expect(result.stdout).not.toContain(FIXTURE_API_KEY)
    expect(result.stdout).toContain(CONFIG_MASK_PLACEHOLDER)

    const config = JSON.parse(result.stdout) as MaskedResolvedConfig
    expect(config.configPath).toBe(workspace.configPath)
    const apiKey = config.entries.find(
      (entry) => entry.key === 'registry.providers.acme.apiKey',
    )
    expect(apiKey).toEqual({
      key: 'registry.providers.acme.apiKey',
      value: CONFIG_MASK_PLACEHOLDER,
      source: 'config-file',
      masked: true,
    })
    // A neighbouring leaf under the SAME opaque subtree is masked too: under a free-form
    // credential record the key name never decides. Deliberate over-masking, visibly flagged.
    expect(config.entries).toContainEqual({
      key: 'registry.providers.acme.baseURL',
      value: CONFIG_MASK_PLACEHOLDER,
      source: 'config-file',
      masked: true,
    })
    // Schema defaults the file never mentioned are attributed to the default layer.
    expect(config.entries.find((entry) => entry.key === 'knowledge.dir')).toEqual({
      key: 'knowledge.dir',
      value: 'agent-qa-knowledge',
      source: 'default',
      masked: false,
    })
  })

  it('masks operator-named credentials no key name marks as secret (CR-01)', async () => {
    const workspace = fixtureWorkspace(roots)

    const result = await invoke(workspace, ['config.get', '--json'])

    expect(result.stderr).toBe('')
    expect(result.exitCode).toBeUndefined()

    // The claim, asserted against the bytes a caller actually sees.
    for (const planted of [
      FIXTURE_HEADER_KEY,
      FIXTURE_HEADER_CRED,
      FIXTURE_HEADER_PWD,
      FIXTURE_PROVIDER_KEY,
      FIXTURE_URL_PASSWORD,
    ]) {
      expect(result.stdout).not.toContain(planted)
    }

    const config = JSON.parse(result.stdout) as MaskedResolvedConfig
    const byKey = Object.fromEntries(config.entries.map((entry) => [entry.key, entry]))
    for (const key of [
      'registry.llms.0.providerHeaders.x-key',
      'registry.llms.0.providerHeaders.x-cred',
      'registry.llms.0.providerHeaders.x-pwd',
      'registry.providers.acme.key',
    ]) {
      expect(byKey[key], key).toEqual({
        key,
        value: CONFIG_MASK_PLACEHOLDER,
        source: 'config-file',
        masked: true,
      })
    }

    // The schema-constrained baseURL stays VISIBLE — its userinfo is stripped instead, so
    // the mask is not the only thing standing between a caller and this credential.
    expect(byKey['registry.llms.0.baseURL']).toEqual({
      key: 'registry.llms.0.baseURL',
      value: 'https://llm.acme.test/v1',
      source: 'config-file',
      masked: false,
    })
  })
})

describe('agent-qa fn runs.events (the D-08 stream kind)', () => {
  const roots: string[] = []
  let originalExitCode: typeof process.exitCode

  beforeEach(() => {
    originalExitCode = process.exitCode
  })

  afterEach(() => {
    process.exitCode = originalExitCode
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('emits one NDJSON line per envelope against a real events.jsonl', async () => {
    const workspace = fixtureWorkspace(roots)
    seedEvents(workspace, 'run-alpha', fiveEvents())

    const result = await invoke(workspace, [
      'runs.events',
      '--input',
      JSON.stringify({ runId: 'run-alpha' }),
      '--json',
    ])

    expect(result.stderr).toBe('')
    expect(result.exitCode).toBeUndefined()
    const lines = result.stdout.split('\n').filter((line) => line.length > 0)
    expect(lines).toHaveLength(5)
    // NDJSON, not a JSON array: every line parses on its own, which is what makes the
    // rendering identical for a live attach that has no end.
    const envelopes = lines.map((line) => JSON.parse(line) as RunEventEnvelope)
    expect(envelopes.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5])
    expect(envelopes.map((event) => event.type)).toEqual([
      'runStarted',
      'testStarted',
      'stepStarted',
      'testFinished',
      'runFinished',
    ])
  })

  it('resumes after --from <lastEventId>, yielding lastEventId + 1 onward', async () => {
    const workspace = fixtureWorkspace(roots)
    seedEvents(workspace, 'run-alpha', fiveEvents())

    const result = await invoke(workspace, [
      'runs.events',
      '--input',
      JSON.stringify({ runId: 'run-alpha' }),
      '--from',
      '2',
      '--json',
    ])

    expect(result.stderr).toBe('')
    expect(result.exitCode).toBeUndefined()
    const envelopes = result.stdout
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as RunEventEnvelope)
    expect(envelopes.map((event) => event.seq)).toEqual([3, 4, 5])
  })

  it('ends human output with the final seq so the next --from is readable', async () => {
    const workspace = fixtureWorkspace(roots)
    seedEvents(workspace, 'run-alpha', fiveEvents())

    const result = await invoke(workspace, [
      'runs.events',
      '--input',
      JSON.stringify({ runId: 'run-alpha' }),
    ])

    expect(result.stderr).toBe('')
    expect(result.exitCode).toBeUndefined()
    const lines = result.stdout.split('\n').filter((line) => line.length > 0)
    // One line per event, then a summary naming the last seq observed.
    expect(lines).toHaveLength(6)
    expect(lines[0]).toContain('runStarted')
    expect(lines[4]).toContain('runFinished')
    expect(lines[5]).toContain('5 events')
    expect(lines[5]).toContain('last seq 5')
  })

  it('rejects a non-numeric --from without touching the event log', async () => {
    const workspace = fixtureWorkspace(roots)
    seedEvents(workspace, 'run-alpha', fiveEvents())

    const result = await invoke(workspace, [
      'runs.events',
      '--input',
      JSON.stringify({ runId: 'run-alpha' }),
      '--from',
      'later',
      '--json',
    ])

    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('--from')
  })

  it('yields an empty stream for a run that recorded no events', async () => {
    const workspace = fixtureWorkspace(roots)

    const result = await invoke(workspace, [
      'runs.events',
      '--input',
      JSON.stringify({ runId: 'run-never-ran' }),
      '--json',
    ])

    // An absent log is an ordinary empty replay, never an error (the v49 read contract).
    expect(result.stderr).toBe('')
    expect(result.exitCode).toBeUndefined()
    expect(result.stdout).toBe('')
  })
})
