// THE IN-PROCESS RUN EXECUTION'S OWN CELLS (Phase 401 plan 11).
//
// This file grows across the plan. Task 1 lands the typed-input-error register — the proof that no
// input failure on this path can terminate its host (T-401-31). Task 2 adds the composability cell,
// its denial control and the D-07 ambient-crossing pair.
//
// THE RED BASELINE FOR THE TASK-1 CELLS IS NOT A FAILING ASSERTION, and saying so plainly is more
// honest than manufacturing one. Pre-task there was no `CliRunInputError` to catch: the preflight
// RENDERED and called `process.exit`, so the measurement is what the shipped binary did, taken on
// the pre-extraction dist and pasted into the plan's SUMMARY:
//
//     $ agent-qa run tests/red.yaml          # with no .env
//     Error: Env file not found: <PROJECT>/.env
//     exit=1
//     $ agent-qa run 'tests/nothing-*.yaml'
//     Error: No test files found matching patterns:
//       tests/nothing-*.yaml
//     exit=2
//     $ agent-qa run tests/empty.yaml
//     Error: Resolved test file(s) but found 0 runnable tests.
//       <PROJECT>/tests/empty.yaml
//     Each test file must define at least one test (a top-level `name` + `steps`, or a `tests:` list).
//     exit=2
//
// A process that terminates cannot be asserted about from inside; the cells below assert the same
// lines and the same codes arriving as a VALUE, and — the discriminating half — that the
// host-terminating call was never reached.

import { describe, expect, it, vi } from 'vitest'

import {
  refuseZeroRunnableTests,
  requireReporterSelection,
  resolveRunInvocationInputs,
} from '../../commands/run.js'
import type { RunOptions } from '../../commands/run.js'
import { CliRunInputError } from '../in-process-run-execution.js'
import { CountingTarget, createInProcessFixture } from './in-process-run-fixture.js'

/**
 * Drive a producer with the host-terminating call STUBBED TO THROW A MARKER.
 *
 * Without this, "the host is still alive afterwards" is not something a cell can say: under vitest
 * a real `process.exit` would take the worker with it, and a cell that merely observed a throw
 * could not tell a typed refusal from a refusal that ALSO tried to exit on its way out. The marker
 * is the discriminator, and every cell below asserts it never appears.
 */
async function withExitTrap<T>(body: () => Promise<T>): Promise<T> {
  const marker = new Error('THE MODULE TERMINATED ITS HOST')
  const spy = vi.spyOn(process, 'exit').mockImplementation((() => {
    throw marker
  }) as never)
  try {
    return await body()
  } finally {
    spy.mockRestore()
  }
}

async function refusalFrom(body: () => Promise<unknown>): Promise<CliRunInputError> {
  const caught = await withExitTrap(async () => {
    try {
      await body()
      return undefined
    } catch (err) {
      return err
    }
  })
  if (!(caught instanceof CliRunInputError)) {
    throw new Error(
      `expected a CliRunInputError; got ${caught === undefined ? 'no throw at all' : String(caught)}`,
    )
  }
  return caught
}

/** ANSI-strip, so a cell asserts the WORDS while `lines` keeps carrying the rendered bytes. */
function plain(lines: readonly string[]): string[] {
  return lines.map((line) => line.replace(/\[[0-9;]*m/g, ''))
}

describe('the in-process run path refuses inputs instead of terminating its host (401-11, T-401-31)', () => {
  it('a missing env file is a typed refusal carrying the command’s own line and exit code 1', async () => {
    const target = new CountingTarget()
    await target.listen()
    try {
      const fixture = createInProcessFixture({
        origin: target.origin,
        environment: 'local',
        omitEnvFile: true,
      })
      const refusal = await refusalFrom(() =>
        resolveRunInvocationInputs({
          configPath: fixture.configPath,
          patterns: [fixture.testPattern],
        }),
      )
      expect(plain(refusal.lines)).toEqual([
        `Error: Env file not found: ${fixture.project}/.env`,
      ])
      expect(refusal.exitCode).toBe(1)
    } finally {
      await target.close()
    }
  })

  it('a missing hooks file is a typed refusal with exit code 1', async () => {
    const target = new CountingTarget()
    await target.listen()
    try {
      const fixture = createInProcessFixture({
        origin: target.origin,
        environment: 'local',
        omitHooksFile: true,
      })
      const refusal = await refusalFrom(() =>
        resolveRunInvocationInputs({
          configPath: fixture.configPath,
          patterns: [fixture.testPattern],
        }),
      )
      expect(plain(refusal.lines)).toEqual([
        `Error: Hooks file not found: ${fixture.project}/hooks.yaml`,
      ])
      expect(refusal.exitCode).toBe(1)
    } finally {
      await target.close()
    }
  })

  it('a missing secrets file is a typed refusal with exit code 1 and both of its lines', async () => {
    const target = new CountingTarget()
    await target.listen()
    try {
      const fixture = createInProcessFixture({
        origin: target.origin,
        environment: 'local',
        omitSecretsFile: true,
      })
      const refusal = await refusalFrom(() =>
        resolveRunInvocationInputs({
          configPath: fixture.configPath,
          patterns: [fixture.testPattern],
        }),
      )
      expect(plain(refusal.lines)).toEqual([
        `Error: Secrets file not found: ${fixture.project}/.env.secrets.local`,
        'Create the file before running tests. It may be empty, but it must exist.',
      ])
      expect(refusal.exitCode).toBe(1)
    } finally {
      await target.close()
    }
  })

  it('patterns that match nothing are a typed refusal with exit code 2', async () => {
    const target = new CountingTarget()
    await target.listen()
    try {
      const fixture = createInProcessFixture({ origin: target.origin, environment: 'local' })
      const refusal = await refusalFrom(() =>
        resolveRunInvocationInputs({
          configPath: fixture.configPath,
          patterns: ['tests/nothing-*.yaml'],
        }),
      )
      expect(plain(refusal.lines)).toEqual([
        'Error: No test files found matching patterns:',
        '  tests/nothing-*.yaml',
      ])
      expect(refusal.exitCode).toBe(2)
    } finally {
      await target.close()
    }
  })

  it('a test file that parses to zero runnable tests is the RUNX-06 refusal, exit code 2', async () => {
    const files = ['/tmp/whatever/tests/empty.yaml']
    const refusal = await refusalFrom(async () => { refuseZeroRunnableTests(files, []) })
    expect(plain(refusal.lines)).toEqual([
      'Error: Resolved test file(s) but found 0 runnable tests.',
      '  /tmp/whatever/tests/empty.yaml',
      'Each test file must define at least one test (a top-level `name` + `steps`, or a `tests:` list).',
    ])
    expect(refusal.exitCode).toBe(2)
  })

  it('an unsupported reporter is a typed refusal with exit code 2', async () => {
    const refusal = await refusalFrom(async () => {
      requireReporterSelection({ reporter: ['not-a-reporter'] } as unknown as RunOptions, false)
    })
    expect(plain(refusal.lines)[0]).toContain('Error:')
    expect(refusal.exitCode).toBe(2)
  })

  it('THE ALLOW CONTROL — one field different, and the same producer returns instead of throwing', async () => {
    // Differs from the "patterns that match nothing" cell in exactly one field: the pattern names a
    // file that exists. Without this, every cell above would pass over a producer that threw
    // unconditionally, which is a producer that measures nothing.
    const target = new CountingTarget()
    await target.listen()
    try {
      const fixture = createInProcessFixture({ origin: target.origin, environment: 'local' })
      const inputs = await withExitTrap(() =>
        resolveRunInvocationInputs({
          configPath: fixture.configPath,
          patterns: [fixture.testPattern],
        }),
      )
      // BOTH HALVES OF THE SPLIT COME BACK. A producer that dropped `suites` would make the
      // mode-aware dispatch unbuildable, so the shape is asserted, not just the happy half.
      expect(inputs.discovered.tests).toEqual([`${fixture.project}/tests/direct.yaml`])
      expect(inputs.discovered.suites).toEqual([])
      expect(inputs.configDir).toBe(fixture.project)
      expect(inputs.resolvedEnvFilePath).toBe(`${fixture.project}/.env`)
      expect(inputs.resolvedHooks.size).toBe(0)
      expect(inputs.runtimeSecrets.secretsFileMetadata.status).toBe('loaded')
      expect(inputs.effectiveLogLevel).toBe('warn')
    } finally {
      await target.close()
    }
  })

  it('a suite pattern resolves into the SUITES half, not the tests half', async () => {
    // The other half of the split, without which "returns both halves" is a claim about one of
    // them. Task 2's dispatcher reads exactly this.
    const target = new CountingTarget()
    await target.listen()
    try {
      const fixture = createInProcessFixture({ origin: target.origin, environment: 'local' })
      const inputs = await withExitTrap(() =>
        resolveRunInvocationInputs({
          configPath: fixture.configPath,
          patterns: [fixture.suitePattern],
        }),
      )
      expect(inputs.discovered.suites).toEqual([`${fixture.project}/suites/gate.suite.yaml`])
      expect(inputs.discovered.tests).toEqual([])
    } finally {
      await target.close()
    }
  })

  it('no patterns at all resolves the configured default set (the argument-less edge)', async () => {
    const target = new CountingTarget()
    await target.listen()
    try {
      const fixture = createInProcessFixture({ origin: target.origin, environment: 'local' })
      const inputs = await withExitTrap(() =>
        resolveRunInvocationInputs({ configPath: fixture.configPath }),
      )
      expect([...inputs.discovered.tests].sort()).toEqual([
        `${fixture.project}/tests/direct.yaml`,
        `${fixture.project}/tests/member.yaml`,
      ])
    } finally {
      await target.close()
    }
  })
})
