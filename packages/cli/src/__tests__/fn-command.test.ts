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
import { RUNS_SUBDIR } from '@vostride/agent-qa-runner-local'
import {
  CONFIG_MASK_PLACEHOLDER,
  CURRENT_HANDOFF_SCHEMA_VERSION,
} from '@vostride/agent-qa-schema'
import type {
  CompletedRunHandoff,
  KnowledgeBundleSummary,
  MaskedResolvedConfig,
} from '@vostride/agent-qa-schema'
import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createFnCommand } from '../commands/fn.js'

/** A secret-shaped value the fixture config carries so masking has something to hide. */
const FIXTURE_API_KEY = 'sk-live-DO-NOT-LEAK-4242'

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
        providers: {
          acme: { apiKey: FIXTURE_API_KEY, baseURL: 'https://acme.test' },
        },
      },
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

  it('lists every registered function id with its scopes and result kind', async () => {
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
    // The four D-06 seed capabilities, and nothing else, are bound in this composition.
    expect(declarations.map((declaration) => declaration.id)).toEqual([
      'config.get',
      'knowledge.bundles.list',
      'runs.get',
      'runs.list',
    ])
    for (const declaration of declarations) {
      expect(declaration, declaration.id).toMatchObject({
        requiredScopes: ['read'],
        resultKind: 'unary',
        bindingStatus: 'bound',
      })
    }
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
    // A neighbouring non-secret leaf keeps its real value and its provenance.
    expect(config.entries).toContainEqual({
      key: 'registry.providers.acme.baseURL',
      value: 'https://acme.test',
      source: 'config-file',
      masked: false,
    })
    // Schema defaults the file never mentioned are attributed to the default layer.
    expect(config.entries.find((entry) => entry.key === 'knowledge.dir')).toEqual({
      key: 'knowledge.dir',
      value: 'agent-qa-knowledge',
      source: 'default',
      masked: false,
    })
  })
})
