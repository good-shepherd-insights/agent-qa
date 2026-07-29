// `agent-qa fn runs.start`, end to end (Phase 385 plan 10 — D-16).
//
// This is the phase's composition-root acceptance moment as a test. The path exercised is the
// whole one: the `fn` command → `composeCliLocalAgent()` → `composeLocalAgent()` → the 384
// registry → `invokeFunction` → the REAL `evaluate` and a REAL `JsonlAuditSink` on disk → the
// bound run-invocation capability → this host's run executor → the composition's durable
// evidence check → the runs reader → the acknowledgment.
//
// Exactly ONE thing is substituted: the child launcher, because the real one starts a browser
// and a provider. Everything it would have produced, it produces — a real `events.jsonl` and a
// real `handoff.json`, written through the SAME `FsEventLog` / `FsHandoffStore` the runner
// appends with, into the run directory named by the `AGENT_QA_RUN_ID` this composition minted.
// The composition is not told any of it: it reads the run back off disk.
//
// The demo artifact under `demo/init/` is the same path with the launcher unsubstituted.

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import {
  FsEventLog,
  FsHandoffStore,
} from '@vostride/agent-qa-runner-local'
import { CURRENT_HANDOFF_SCHEMA_VERSION } from '@vostride/agent-qa-schema'
import type { CompletedRunHandoff, RunEventEnvelope, RunId } from '@vostride/agent-qa-schema'
import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createFnCommand } from '../commands/fn.js'
import { createCliRunExecution } from '../composition/local-agent-host.js'
import type { RunChildLauncher } from '../composition/local-agent-host.js'

interface FixtureWorkspace {
  root: string
  configPath: string
  runtimeRoot: string
}

function fixtureWorkspace(roots: string[]): FixtureWorkspace {
  const root = mkdtempSync(join(tmpdir(), 'agent-qa-fn-runs-start-'))
  roots.push(root)
  return {
    root,
    configPath: join(root, 'agent-qa.config.yaml'),
    runtimeRoot: join(root, '.agent-qa'),
  }
}

/** The events a run that started at all leaves behind, written the way the runner writes them. */
function writeRunEvents(workspace: FixtureWorkspace, runId: string): void {
  const log = new FsEventLog({ root: workspace.runtimeRoot, runId })
  const envelopes: RunEventEnvelope[] = [
    { seq: 1, ts: 1_700_000_000_001, runId, type: 'runStarted', payload: {} },
    { seq: 2, ts: 1_700_000_000_002, runId, type: 'testStarted', payload: {} },
    { seq: 3, ts: 1_700_000_000_003, runId, type: 'testFinished', payload: {} },
    { seq: 4, ts: 1_700_000_000_004, runId, type: 'runFinished', payload: {} },
  ] as RunEventEnvelope[]
  for (const envelope of envelopes) log.append(envelope)
}

function writeRunHandoff(workspace: FixtureWorkspace, runId: string): CompletedRunHandoff {
  const document: CompletedRunHandoff = {
    schemaVersion: CURRENT_HANDOFF_SCHEMA_VERSION,
    runId: runId as RunId,
    scope: { tier: 'product', key: 'shop' },
    buildOrdinal: 7,
    executionContext: 'local-headless',
    aggregateVerdict: 'passed',
    configDigests: { suiteConfigDigest: 'suite-digest', testConfigDigest: 'test-digest' },
    startedAt: 1_700_000_000_001,
    endedAt: 1_700_000_000_004,
    tests: [{
      testId: 'test-1',
      testName: 'checks out',
      filePath: 'tests/checkout.yaml',
      testIndex: 0,
      outcome: 'passed',
      steps: [],
    }] as CompletedRunHandoff['tests'],
  }
  new FsHandoffStore({ root: workspace.runtimeRoot, runId }).save(document)
  return document
}

interface LaunchRecord {
  argv: readonly string[]
  runIdInEnv: string | undefined
}

/**
 * A stand-in for the child that would have executed the run.
 *
 * `writes` decides what the "run" leaves behind, which is the only channel the composition
 * has for finding out whether a run happened. That is what makes the negative cases below
 * possible at all.
 */
function launcher(
  workspace: FixtureWorkspace,
  writes: 'events-and-handoff' | 'events-only' | 'nothing',
): { launch: RunChildLauncher; launches: () => readonly LaunchRecord[] } {
  const launches: LaunchRecord[] = []
  return {
    launch: ({ argv, env }) => {
      const runId = env.AGENT_QA_RUN_ID
      launches.push({ argv: [...argv], runIdInEnv: runId })
      if (runId !== undefined && writes !== 'nothing') {
        writeRunEvents(workspace, runId)
        if (writes === 'events-and-handoff') writeRunHandoff(workspace, runId)
      }
      return Promise.resolve(0)
    },
    launches: () => launches,
  }
}

interface InvocationResult {
  stdout: string
  stderr: string
  exitCode: number | string | undefined
}

async function invoke(
  workspace: FixtureWorkspace,
  args: readonly string[],
  options: { launch?: RunChildLauncher; newRunId?: () => string } = {},
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
    const fn = options.launch === undefined
      ? createFnCommand()
      : createFnCommand({
        runExecution: createCliRunExecution({
          configPath: workspace.configPath,
          launchChild: options.launch,
          ...(options.newRunId === undefined ? {} : { newRunId: options.newRunId }),
        }),
      })
    const program = new Command().option('--config <path>', 'config file path').addCommand(fn)
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

/** Every execution-audit row the real on-disk sink recorded for this workspace. */
function auditRows(workspace: FixtureWorkspace): Record<string, unknown>[] {
  const path = join(workspace.runtimeRoot, 'execution_audit.jsonl')
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

describe('agent-qa fn runs.start', () => {
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

  it('lists runs.start as BOUND in this host', async () => {
    const workspace = fixtureWorkspace(roots)
    const child = launcher(workspace, 'events-and-handoff')

    const result = await invoke(workspace, ['--list', '--json'], { launch: child.launch })

    const declarations = JSON.parse(result.stdout) as { id: string; bindingStatus: string }[]
    expect(declarations.find((declaration) => declaration.id === 'runs.start'))
      .toMatchObject({ id: 'runs.start', bindingStatus: 'bound' })
    // Listing resolves no executor and starts nothing: the binding is a fact about the
    // composition, not something a catalog has to run to find out.
    expect(child.launches()).toEqual([])
    // And the fourth host decision did not cost the laziness plan 09 bought: no queue
    // database is brought into existence in a project that has never enqueued anything, and
    // no run directory is created by asking what the host can do.
    expect(existsSync(join(workspace.runtimeRoot, 'agent-jobs.db'))).toBe(false)
    expect(existsSync(join(workspace.runtimeRoot, 'runs'))).toBe(false)
  })

  it('executes a run and acknowledges it with the run own recorded facts', async () => {
    const workspace = fixtureWorkspace(roots)
    const child = launcher(workspace, 'events-and-handoff')

    const result = await invoke(
      workspace,
      ['runs.start', '--input', '{"patterns":["tests/checkout.yaml"]}', '--json'],
      { launch: child.launch, newRunId: () => 'run-from-fn' },
    )

    expect(result.stderr).toBe('')
    expect(result.exitCode).toBeUndefined()
    expect(JSON.parse(result.stdout)).toEqual({
      runId: 'run-from-fn',
      scope: { tier: 'product', key: 'shop' },
      executionContext: 'local-headless',
      buildOrdinal: 7,
      startedAt: 1_700_000_000_001,
      testCount: 1,
    })

    // The host was asked to run the project's ONE run path, told which run it was, and
    // handed the caller's patterns — the request survived the whole way down.
    expect(child.launches()).toHaveLength(1)
    expect(child.launches()[0]?.runIdInEnv).toBe('run-from-fn')
    expect(child.launches()[0]?.argv).toEqual([
      '--config',
      workspace.configPath,
      'run',
      'tests/checkout.yaml',
    ])
  })

  it('crosses the gate: a real mutating-local audit row lands on disk for the invocation', async () => {
    const workspace = fixtureWorkspace(roots)
    const child = launcher(workspace, 'events-and-handoff')

    await invoke(workspace, ['runs.start', '--json'], {
      launch: child.launch,
      newRunId: () => 'run-audited',
    })

    // Not "a run happened" — "the GATE was crossed". The row is written by `evaluate()`
    // through the composition's own JsonlAuditSink, at the project root, before the binding
    // check and therefore before anything could be executed (D-11).
    expect(auditRows(workspace)).toContainEqual(expect.objectContaining({
      action: 'fn:runs.start',
      riskTier: 'mutating-local',
      verdict: 'allow',
    }))
  })

  it('acknowledges a run runs.get can then address — the acknowledgment is not a dead id', async () => {
    const workspace = fixtureWorkspace(roots)
    const child = launcher(workspace, 'events-and-handoff')

    const started = await invoke(workspace, ['runs.start', '--json'], {
      launch: child.launch,
      newRunId: () => 'run-addressable',
    })
    const acknowledged = JSON.parse(started.stdout) as { runId: string }
    const read = await invoke(
      workspace,
      ['runs.get', '--input', JSON.stringify({ runId: acknowledged.runId }), '--json'],
    )

    expect(JSON.parse(read.stdout)).toMatchObject({
      runId: 'run-addressable',
      buildOrdinal: 7,
      aggregateVerdict: 'passed',
    })
  })

  it('names a DIFFERENT run each time — the id is minted, never a constant', async () => {
    const workspace = fixtureWorkspace(roots)
    const child = launcher(workspace, 'events-and-handoff')

    const first = await invoke(workspace, ['runs.start', '--json'], { launch: child.launch })
    const second = await invoke(workspace, ['runs.start', '--json'], { launch: child.launch })

    const firstId = (JSON.parse(first.stdout) as { runId: string }).runId
    const secondId = (JSON.parse(second.stdout) as { runId: string }).runId
    expect(firstId).not.toEqual(secondId)
    // And each acknowledgment names the run its OWN child was told to write.
    expect(child.launches().map((launch) => launch.runIdInEnv)).toEqual([firstId, secondId])
  })

  it('refuses a host that ran nothing, however cheerfully it exits', async () => {
    // The laziest wrong implementation of "runs.start is bound": a port that reports success
    // without starting anything. It exits 0 and returns a well-formed run id, and there is
    // no acknowledgment it can produce.
    const workspace = fixtureWorkspace(roots)
    const child = launcher(workspace, 'nothing')

    const result = await invoke(workspace, ['runs.start', '--json'], { launch: child.launch })

    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('RunProducedNoEventsError')
  })

  it('refuses a run that started and left no completed-run record', async () => {
    // Distinct failure, distinct name: the run genuinely began (its event log exists) but
    // nothing about it can be acknowledged, so nothing about it is claimed.
    const workspace = fixtureWorkspace(roots)
    const child = launcher(workspace, 'events-only')

    const result = await invoke(workspace, ['runs.start', '--json'], { launch: child.launch })

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('RunNotRecordedError')
    expect(result.stderr).not.toContain('RunProducedNoEventsError')
  })

  it('refuses a request field this host cannot carry rather than dropping it', async () => {
    const workspace = fixtureWorkspace(roots)
    const child = launcher(workspace, 'events-and-handoff')

    const result = await invoke(
      workspace,
      ['runs.start', '--input', '{"scope":{"tier":"product","key":"shop"}}', '--json'],
      { launch: child.launch },
    )

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('UnsupportedRunRequestError')
    expect(result.stderr).toContain('scope')
    // Refused BEFORE anything ran: a dropped field would otherwise have produced a real run
    // of a different kind than the one that was asked for.
    expect(child.launches()).toEqual([])
  })

  it('routes the run at the config the request names, not only the one the flag named', async () => {
    const workspace = fixtureWorkspace(roots)
    const child = launcher(workspace, 'events-and-handoff')
    const requested = resolve(workspace.root, 'other-agent-qa.config.yaml')

    await invoke(
      workspace,
      ['runs.start', '--input', JSON.stringify({ configPath: requested }), '--json'],
      { launch: child.launch },
    )

    expect(child.launches()[0]?.argv.slice(0, 2)).toEqual(['--config', requested])
  })
})
