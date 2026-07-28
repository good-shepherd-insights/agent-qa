// End-to-end tracer for the 384 function layer (Plan 01, D-05/D-06/D-11).
//
// `agent-qa fn runs.list` must resolve through the WHOLE path — composition-built
// registry → invokeFunction → evaluate() → injected run-dir reader → RunSummary[] —
// against a real on-disk fixture. Nothing here stubs the gate or the registry.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { RUNS_SUBDIR } from '@vostride/agent-qa-runner-local'
import { CURRENT_HANDOFF_SCHEMA_VERSION } from '@vostride/agent-qa-schema'
import type { CompletedRunHandoff } from '@vostride/agent-qa-schema'
import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createFnCommand } from '../commands/fn.js'

interface InvocationResult {
  stdout: string
  stderr: string
  exitCode: typeof process.exitCode
}

interface FixtureWorkspace {
  root: string
  configPath: string
  runtimeRoot: string
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
    }, null, 2)}\n`,
    'utf8',
  )
  return { root, configPath, runtimeRoot: join(root, '.agent-qa') }
}

function handoff(input: {
  runId: string
  buildOrdinal: number
  aggregateVerdict: CompletedRunHandoff['aggregateVerdict']
}): CompletedRunHandoff {
  return {
    schemaVersion: CURRENT_HANDOFF_SCHEMA_VERSION,
    runId: input.runId as CompletedRunHandoff['runId'],
    scope: { tier: 'product', key: 'shop' },
    buildOrdinal: input.buildOrdinal,
    executionContext: 'local-headless',
    aggregateVerdict: input.aggregateVerdict,
    configDigests: { suiteConfigDigest: 'suite-digest', testConfigDigest: 'test-digest' },
    startedAt: 1_000 + input.buildOrdinal,
    endedAt: 2_000 + input.buildOrdinal,
    tests: [],
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
    expect(declarations.map((declaration) => declaration.id)).toContain('runs.list')
    const runsList = declarations.find((declaration) => declaration.id === 'runs.list')
    expect(runsList).toMatchObject({
      requiredScopes: ['read'],
      resultKind: 'unary',
      bindingStatus: 'bound',
    })
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
})
