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
  produceMembersFromPatterns,
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

// ============================================================================================
// TASK 2 — THE PORT ITSELF
//
// THE RED BASELINE, and it is a measured fact rather than a failing assertion. Pre-task there was
// nothing to red: `assembleCliRun`'s input declares `members` and `executor` as REQUIRED,
// `RunsStartInputSchema` carries neither, and the only chain that turns one into the other lived
// unexported inside `run.ts`'s command body. A cell for the port could not be written against a
// symbol that did not exist — which is the wall 401-06 halted on, stated as a measurement. The real
// bar for these cells is the mutation ledger in task 4.
//
// EVERY RUN BELOW IS A REAL RUN, IN THIS PROCESS. The fixture's model points at an unbindable port
// and `PLAYWRIGHT_BROWSERS_PATH` is an empty directory, so a member fails fast — but it fails
// DOWNSTREAM of `startRun`, which is the whole point: the artifacts a started run leaves are what
// these cells read.
// ============================================================================================

import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach } from 'vitest'

import {
  getActiveExecutionContext,
  setActiveExecutionContextResolver,
} from '@vostride/agent-qa-safety'
import { RunDeniedError } from '@vostride/agent-qa-agent-local'
import type { RunSession } from '@vostride/agent-qa-schema'

import {
  createInProcessCliRunExecution,
  runInProcessCliRun,
} from '../in-process-run-execution.js'
import type { CliRunOutcome } from '../in-process-run-execution.js'
import { auditRows, buildOrdinalsExist, eventTypes, runDirs } from './in-process-run-fixture.js'
// 405-02 (D-08): the sidecar READER, reached through the same composition hop the drive's writer
// uses — `runner-local` is not a package a cli file may name (FUNC-02) and a test file is not
// exempt from that firewall.
import {
  digestMaskedValue,
  readMaskingDigests,
  resolveMaskingHostKey,
} from '@vostride/agent-qa-agent-local'
import type { RiskActionDescriptor } from '@vostride/agent-qa-schema'

/** The process-global resolver is exactly that; a leaked pin poisons every sibling cell. */
const shippedExecutionContextResolver = getActiveExecutionContext
let restoreResolver: (() => void) | undefined

beforeEach(() => {
  restoreResolver = undefined
})
afterEach(() => {
  restoreResolver?.()
  restoreResolver = undefined
})

function pinAmbientExecutionContext(value: 'ci' | 'local-interactive' | 'local-headless'): void {
  setActiveExecutionContextResolver(() => value as never)
  restoreResolver = () => {
    setActiveExecutionContextResolver(() => shippedExecutionContextResolver())
  }
}

function fixtureOptions(fixture: { configPath: string; agentQaRoot: string; project: string }) {
  // An empty browsers root, so the member's failure is a property of the fixture rather than of the
  // machine — the same pin the parity generator uses.
  const browsersRoot = join(fixture.project, 'no-browsers')
  if (!existsSync(browsersRoot)) mkdirSync(browsersRoot, { recursive: true })
  process.env.PLAYWRIGHT_BROWSERS_PATH = browsersRoot
  return { configPath: fixture.configPath, agentQaRoot: fixture.agentQaRoot }
}

/** Every handoff the invocation persisted — the durable record a started run always leaves. */
function handoffs(fixture: { project: string; suitePattern: string }): unknown[] {
  return runDirs(fixture as never)
    .map((dir) => join(dir, 'handoff.json'))
    .filter((path) => existsSync(path))
    .map((path) => JSON.parse(readFileSync(path, 'utf8')) as unknown)
}

describe('a door holding only a RunsStartInput gets a policy-gated run, in process (401-11)', () => {
  it('THE COMPOSABILITY CELL — { patterns } and a posture, and a real run happens', async () => {
    const target = new CountingTarget()
    await target.listen()
    try {
      const fixture = createInProcessFixture({ origin: target.origin, environment: 'local' })
      let session: RunSession | undefined
      const port = createInProcessCliRunExecution({
        ...fixtureOptions(fixture),
        // THE POSTURE TRAVELS EXPLICITLY (D-07). No CLI option is named anywhere in this call.
        executionContext: 'local-headless',
        onSession: (started) => { session = started },
      })

      // The member fails downstream of `startRun` (no browser binaries), and the drive re-surfaces
      // that framework error exactly as the shipped door does. The run still HAPPENED, which is
      // what every assertion below reads. Caught rather than asserted-against so this cell is about
      // the seam and not about the fixture's failure mode.
      let denial: unknown
      try {
        await port.execute({ patterns: [fixture.testPattern] })
      } catch (err) {
        denial = err
      }
      expect(denial).not.toBeInstanceOf(RunDeniedError)

      // THE IN-PROCESS WITNESS. No child process can hand back a live object, so a cell that
      // asserts this cannot pass over a spawn.
      expect(session).toBeDefined()
      expect(typeof session!.cancel).toBe('function')
      expect(typeof session!.subscribe).toBe('function')
      expect(typeof session!.id).toBe('string')

      // The durable half: a run that began, under the composition's OWN `<configDir>/.agent-qa`.
      expect(eventTypes(fixture as never)).toContain('runStarted')
      expect(handoffs(fixture)).toHaveLength(1)
      expect(runDirs(fixture as never).map((dir) => dir.split('/').pop())).toContain(
        session!.id as unknown as string,
      )
      // The gate allowed it, so the baseline probe knocked — the converse of the denial control.
      expect(target.hits).toEqual(['/in-process-thing'])
      expect(buildOrdinalsExist(fixture as never)).toBe(true)
      expect(auditRows(fixture as never).map((row) => row.outcome)).toContain('proceeded')
    } finally {
      await target.close()
    }
  }, 120_000)

  it('THE DENIAL CONTROL — one field different, and all five artifacts say refused', async () => {
    const target = new CountingTarget()
    await target.listen()
    try {
      // `environment: 'shared'` instead of `'local'`. Same URL, same test, same everything else:
      // the D-06 declaration is the axis, and D-05's classifier decides what the class means.
      const fixture = createInProcessFixture({ origin: target.origin, environment: 'shared' })
      let session: RunSession | undefined
      const port = createInProcessCliRunExecution({
        ...fixtureOptions(fixture),
        executionContext: 'local-headless',
        onSession: (started) => { session = started },
      })

      let denial: unknown
      try {
        await port.execute({ patterns: [fixture.testPattern] })
      } catch (err) {
        denial = err
      }

      expect(denial).toBeInstanceOf(RunDeniedError)
      // (a) the audit row's OUTCOME field, never a message substring
      const rows = auditRows(fixture as never)
      expect(rows).toHaveLength(1)
      expect(rows[0]!.outcome).toBe('fail-closed-denied')
      // (b) no run events — `runStarted` is seq 1 of any run that began at all
      expect(eventTypes(fixture as never)).toEqual([])
      expect(session).toBeUndefined()
      // (c) the durable assembly side effect never happened
      expect(buildOrdinalsExist(fixture as never)).toBe(false)
      // (d) nobody knocked on the target
      expect(target.hits).toEqual([])
      // (e) the reason the caller sees is READ BACK off the row, not typed into this cell — which
      // is what pins the door to rendering the gate's decision instead of composing its own.
      expect((denial as RunDeniedError).reason).toBe(rows[0]!.reason)
    } finally {
      await target.close()
    }
  }, 120_000)

  it('THE SUITE ARM — the same bare request with a suite pattern runs the SUITE', async () => {
    const target = new CountingTarget()
    await target.listen()
    try {
      const fixture = createInProcessFixture({ origin: target.origin, environment: 'local' })
      const outcome: CliRunOutcome = await runInProcessCliRun(
        { ...fixtureOptions(fixture), executionContext: 'local-headless' },
        // Still a bare `RunsStartInput`. Still no mode flag — which is exactly what
        // `createCliRunExecution` forwards today, so a producer that could not do this would be a
        // scope reduction of the shipped contract at the two doors this seam exists to unblock.
        { patterns: [fixture.suitePattern] },
      )

      const events = eventTypes(fixture as never)
      expect(events).toContain('runStarted')
      // THE MEMBER RAN. Without this, a producer that dispatched to the test path and assembled
      // zero members would pass on `runStarted` alone.
      expect(events).toContain('testStarted')
      expect(handoffs(fixture)).toHaveLength(1)
      expect(target.hits).toEqual(['/in-process-thing'])
      expect(runDirs(fixture as never).map((dir) => dir.split('/').pop())).toContain(outcome.runId)
    } finally {
      await target.close()
    }
  }, 120_000)

  it('THE REQUEST NAMES THE CONFIG — `request.configPath` decides what is resolved and gated', async () => {
    // CARRIED FORWARD BY 401-10 from `fn-runs-start.test.ts`, which died with the child it drove.
    // The old cell read the `--config` operand the port put in front of the child. The contract
    // survived the retirement (`runInProcessCliRun`: `request.configPath ?? options.configPath`)
    // and had no other cell, so it is re-asserted here at the EFFECT — the stronger reading, since
    // a port that accepted the field and dropped it produces no argv to be wrong about.
    const target = new CountingTarget()
    await target.listen()
    try {
      const composed = createInProcessFixture({ origin: target.origin, environment: 'local' })
      const named = createInProcessFixture({ origin: target.origin, environment: 'local' })
      expect(named.configPath).not.toBe(composed.configPath)

      try {
        await runInProcessCliRun(
          { ...fixtureOptions(composed), executionContext: 'local-headless' },
          { configPath: named.configPath, patterns: [named.testPattern] },
        )
      } catch { /* the member's framework error; where the run LANDED is what this cell reads */ }

      // THE GATE RAN AGAINST THE CONFIG THE REQUEST NAMED. The audit row is the gate's own record
      // and it is written beside the config whose target declaration it read — so this is the
      // assertion that a dropped `configPath` could not survive: the classification would have come
      // off the composition's project instead.
      expect(auditRows(named as never).map((row) => row.outcome)).toEqual(['proceeded'])
      expect(auditRows(composed as never)).toEqual([])

      // AND THE RUN'S DURABLE EVIDENCE FOLLOWS `agentQaRoot`, WHICH THE REQUEST CANNOT NAME. This
      // is asserted rather than smoothed over: the two halves of one run land in two projects when
      // a door's config and its request's config differ. It is not the retired wire's behaviour —
      // the child resolved BOTH from `--config`, which put the evidence somewhere the composition's
      // own evidence check could not read, and the ack failed. Recorded in the phase's
      // deferred-items as a contract question with an owner, not decided here.
      expect(eventTypes(composed as never)).toContain('runStarted')
      expect(eventTypes(named as never)).toEqual([])
      expect(buildOrdinalsExist(composed as never)).toBe(true)
      expect(buildOrdinalsExist(named as never)).toBe(false)
      // One run, one id, both halves — not two runs.
      expect(runDirs(named as never).map((dir) => dir.split('/').pop()))
        .toEqual(runDirs(composed as never).map((dir) => dir.split('/').pop()))
    } finally {
      await target.close()
    }
  }, 120_000)

  it('THE DISPATCH BOUNDARY — when both kinds resolve, the TEST path wins', async () => {
    // The direction that is easy to get backwards. `run.ts`'s shipped guard early-returns to the
    // suite path ONLY when `discoveredTestFiles.length === 0`, so a dispatcher that preferred
    // suites whenever any suite resolved would stop running an `--all`-shaped invocation's tests.
    const target = new CountingTarget()
    await target.listen()
    try {
      const fixture = createInProcessFixture({ origin: target.origin, environment: 'local' })
      const inputs = await withExitTrap(() =>
        resolveRunInvocationInputs({ configPath: fixture.configPath, mode: 'all' }),
      )
      expect(inputs.discovered.tests.length).toBe(2)
      expect(inputs.discovered.suites.length).toBe(1)

      const produced = await produceMembersFromPatterns({ inputs, runId: 'r_dispatch-boundary' })
      // The resolved member set is the TEST files', not the suite's single member.
      expect(produced.members).toHaveLength(2)
      expect(produced.members.map((member) => member.name).sort()).toEqual([
        'the standalone test',
        'the suite member',
      ])
    } finally {
      await target.close()
    }
  }, 120_000)
})

describe('D-07: the INJECTED execution context beats a varied ambient, on both arms (401-11)', () => {
  it('ARM A — ambient says local-interactive, injected says ci: fail-closed, confirm never asked', async () => {
    const target = new CountingTarget()
    await target.listen()
    try {
      // The ambient is pinned to the value that would ALLOW after a prompt.
      pinAmbientExecutionContext('local-interactive')
      const fixture = createInProcessFixture({ origin: target.origin, environment: 'shared' })
      let confirmCalls = 0
      let denial: unknown
      try {
        await runInProcessCliRun(
          {
            ...fixtureOptions(fixture),
            executionContext: 'ci',
            confirm: { surface: 'tty-prompt', ask: () => { confirmCalls += 1; return true } },
          },
          { patterns: [fixture.testPattern] },
        )
      } catch (err) {
        denial = err
      }

      expect(denial).toBeInstanceOf(RunDeniedError)
      expect(auditRows(fixture as never)[0]!.outcome).toBe('fail-closed-denied')
      // THE SECOND DISCRIMINATOR. A module that read the ambient would have PROMPTED and proceeded
      // — a completely different outcome, and the call count is what tells the two apart.
      expect(confirmCalls).toBe(0)
      expect(target.hits).toEqual([])
      expect(buildOrdinalsExist(fixture as never)).toBe(false)
    } finally {
      await target.close()
    }
  }, 120_000)

  it('ARM B — ambient says ci, injected says local-interactive: the confirm IS asked and it proceeds', async () => {
    const target = new CountingTarget()
    await target.listen()
    try {
      pinAmbientExecutionContext('ci')
      // AGAINST THE SHARED-DECLARED TARGET, and that is load-bearing: against a `local` target the
      // outcome is `proceeded` with call count 0 whatever the context, so an arm written to match
      // observation would prove nothing.
      const fixture = createInProcessFixture({ origin: target.origin, environment: 'shared' })
      let confirmCalls = 0
      try {
        await runInProcessCliRun(
          {
            ...fixtureOptions(fixture),
            executionContext: 'local-interactive',
            confirm: { surface: 'tty-prompt', ask: () => { confirmCalls += 1; return true } },
          },
          { patterns: [fixture.testPattern] },
        )
      } catch { /* the member's framework error; the gate decision is what this cell reads */ }

      expect(confirmCalls).toBe(1)
      expect(auditRows(fixture as never).map((row) => row.outcome)).toContain('prompted-approved')
      // A module that read the ambient would have failed closed and touched nothing.
      expect(eventTypes(fixture as never)).toContain('runStarted')
      expect(target.hits).toEqual(['/in-process-thing'])
    } finally {
      await target.close()
    }
  }, 120_000)
})

describe('the descriptor the CLI door hands the gate names every target it will drive (401-14, W-1)', () => {
  it('a TWO-TARGET invocation is previewed with BOTH declared names and the class it was folded to', async () => {
    // THE DOOR'S OWN ROAD, not the core's. `run-invocation-core.test.ts` measures the disclosure
    // over a FAKE resolver, so a producer that supplied only the first member's name would leave
    // that cell green — measured, by mutating `resolveTargetDeclaration` to
    // `produced.targetNames.slice(0, 1)`: 15/15 still passed. This cell is what that mutation reds,
    // because the whole chain is in its road: the CLI producer's collection loop → the one
    // production resolver → the core's single `evaluate()` → the descriptor the confirm port is
    // handed. That port is where a browser's `preview` frame is built from.
    //
    // THE SECOND TARGET IS DECLARED `local` AND THE FIRST `shared`, so the run is asked about for
    // the FIRST member's reason and the fold's most-restrictive-wins answer is unchanged. What
    // varies from every other cell in this file is only the number of declared NAMES.
    const target = new CountingTarget()
    await target.listen()
    try {
      const fixture = createInProcessFixture({
        origin: target.origin,
        environment: 'shared',
        secondTarget: true,
      })
      const asked: { name: string; disclosure?: string }[] = []
      try {
        await runInProcessCliRun(
          {
            ...fixtureOptions(fixture),
            executionContext: 'local-interactive',
            confirm: {
              surface: 'tty-prompt',
              ask: (action: RiskActionDescriptor) => { asked.push(action); return true },
            },
          },
          { patterns: [fixture.testPattern, fixture.secondTestPattern!] },
        )
      } catch { /* the members' framework errors; the descriptor is what this cell reads */ }

      // ASKED AT ALL, FIRST. A cell that went straight to the disclosure would report "no names"
      // for an invocation that was refused before the gate — `requireSingleInvocationProduct` is
      // one line away and is exactly the refusal the fixture's shared `product:` exists to avoid.
      expect(asked, 'the gate never asked — nothing below measures a disclosure').toHaveLength(1)
      const disclosure = asked[0]!.disclosure
      expect(disclosure, 'the ask carried no preview — approve WHAT?').toBeTruthy()
      // BOTH names, read off the fixture's own definitions.
      expect(disclosure).toContain(fixture.targetName)
      expect(disclosure).toContain(fixture.secondTargetName!)
      // And the DECLARATION the fold attributed, which the second target's `local` did not
      // lower (401-15, WR-06). Pinned as the whole clause rather than the bare word `shared`: an
      // asserting clause ("environment: shared") contains that word too, so the substring alone
      // could not tell the honest sentence from the one UAT test 4 refused.
      expect(disclosure).toContain('declared: at least one target shared')
      expect(disclosure).not.toContain('environment: ')
    } finally {
      await target.close()
    }
  }, 120_000)
})

describe('the run-start baseline is taken PER MEMBER and deduped by URL (401-19, WR-04)', () => {
  it('two members naming two different web targets: each target is probed, once', async () => {
    // The direct producer's road. Both targets declare `local`, so the run is allowed with no
    // confirm and the only axis left is which URLs assembly reaches for.
    const target = new CountingTarget()
    await target.listen()
    try {
      const fixture = createInProcessFixture({
        origin: target.origin,
        environment: 'local',
        secondTarget: true,
      })

      // REACH, BEFORE ANY CLAIM ABOUT PROBES. Two members, and the URLs they carry are the two
      // targets' own — read off the producer rather than off the run, so a run that died before
      // assembly cannot be mistaken for a run that chose not to probe.
      const inputs = await withExitTrap(() =>
        resolveRunInvocationInputs({
          configPath: fixture.configPath,
          patterns: [fixture.testPattern, fixture.secondTestPattern!],
        }),
      )
      const produced = await produceMembersFromPatterns({ inputs, runId: 'r_per-member-probe' })
      expect(produced.members).toHaveLength(2)
      expect(produced.memberProbeUrls).toEqual([
        `${target.origin}/in-process-thing`,
        `${target.origin}/the-second-thing`,
      ])

      try {
        await runInProcessCliRun(
          { ...fixtureOptions(fixture), executionContext: 'local-headless' },
          { patterns: [fixture.testPattern, fixture.secondTestPattern!] },
        )
      } catch { /* the members' framework errors; who was knocked on is what this cell reads */ }

      expect(auditRows(fixture as never).map((row) => row.outcome)).toContain('proceeded')
      expect([...target.hits].sort()).toEqual(['/in-process-thing', '/the-second-thing'])
    } finally {
      await target.close()
    }
  }, 120_000)

  it('two members naming the SAME web target cost ONE probe, not one each', async () => {
    // The dedupe half, and the direction a naive per-member fix breaks: WR-04's complaint was an
    // unexpected outbound request, so turning one GET into N would be a regression dressed as a fix.
    const target = new CountingTarget()
    await target.listen()
    try {
      const fixture = createInProcessFixture({ origin: target.origin, environment: 'local' })
      const patterns = [fixture.testPattern, 'tests/member.yaml']

      const inputs = await withExitTrap(() =>
        resolveRunInvocationInputs({ configPath: fixture.configPath, patterns }),
      )
      const produced = await produceMembersFromPatterns({ inputs, runId: 'r_dedupe-probe' })
      expect(produced.members).toHaveLength(2)
      expect(produced.memberProbeUrls).toEqual([
        `${target.origin}/in-process-thing`,
        `${target.origin}/in-process-thing`,
      ])

      try {
        await runInProcessCliRun(
          { ...fixtureOptions(fixture), executionContext: 'local-headless' },
          { patterns },
        )
      } catch { /* as above */ }

      expect(auditRows(fixture as never).map((row) => row.outcome)).toContain('proceeded')
      expect(target.hits).toEqual(['/in-process-thing'])
    } finally {
      await target.close()
    }
  }, 120_000)

  it('THE SUITE PRODUCER, the sibling half: two suite members, one target, one probe', async () => {
    // The same claim on the other producer. A fix applied to the direct loop and not to this one is
    // this repo's most-repeated defect, so the suite path gets its own cell rather than a reader's
    // assumption that the two loops agree.
    const target = new CountingTarget()
    await target.listen()
    try {
      const fixture = createInProcessFixture({
        origin: target.origin,
        environment: 'local',
        secondSuiteMember: true,
      })

      const inputs = await withExitTrap(() =>
        resolveRunInvocationInputs({
          configPath: fixture.configPath,
          patterns: [fixture.suitePattern],
        }),
      )
      const produced = await produceMembersFromPatterns({ inputs, runId: 'r_suite-probe' })
      expect(produced.members).toHaveLength(2)
      expect(produced.memberProbeUrls).toEqual([
        `${target.origin}/in-process-thing`,
        `${target.origin}/in-process-thing`,
      ])

      try {
        await runInProcessCliRun(
          { ...fixtureOptions(fixture), executionContext: 'local-headless' },
          { patterns: [fixture.suitePattern] },
        )
      } catch { /* as above */ }

      expect(auditRows(fixture as never).map((row) => row.outcome)).toContain('proceeded')
      expect(target.hits).toEqual(['/in-process-thing'])
    } finally {
      await target.close()
    }
  }, 120_000)
})

// ---------------------------------------------------------------------------
// 405-02 (D-08): the masking-digests sidecar the drive leaves beside events.jsonl
// ---------------------------------------------------------------------------

describe('a dashboard-launched run leaves a masking-digests sidecar (405-02, D-08)', () => {
  it('masking-digests entries identify the declared secret without any file holding its bytes', async () => {
    const target = new CountingTarget()
    await target.listen()
    try {
      // A REAL, ≥4-char declared secret, so the run's seed provably registers it — the guard in
      // `createMaskingContext` (minRegisteredLength 4) drops anything shorter and the cell would
      // then be asserting over an empty map. The value is distinctive enough that a byte scan for
      // it cannot collide with ordinary run output.
      const plantedSecret = 'zq7-planted-masking-secret-405-02'
      const fixture = createInProcessFixture({
        origin: target.origin,
        environment: 'local',
        plantedSecret,
      })

      // The member dies on the pinned empty browsers root — a FRAMEWORK error this drive
      // re-surfaces, exactly as `THE REQUEST NAMES THE CONFIG` above absorbs it. Where the run
      // LANDED is what this cell reads, and the close-out (with its second digest write) runs on
      // that path too.
      try {
        await runInProcessCliRun(
          { ...fixtureOptions(fixture), executionContext: 'local-headless' },
          { patterns: [fixture.testPattern] },
        )
      } catch { /* the member's framework error */ }

      // The run really happened — otherwise "there is a sidecar" says nothing.
      expect(eventTypes(fixture as never)).toContain('runStarted')

      // The run's id, read off the one run directory rather than typed — the drive minted it.
      const dirs = runDirs(fixture as never)
      expect(dirs).toHaveLength(1)
      const runId = dirs[0]!.split('/').pop()!

      const sidecar = readMaskingDigests({ root: fixture.agentQaRoot, runId })
      expect(sidecar).toBeDefined()
      expect(sidecar!.algorithm).toBe('hmac-sha256')
      expect(Object.keys(sidecar!.entries).length).toBeGreaterThanOrEqual(1)
      // EVERY placeholder is a SECRET one — an EMAIL row here would be a value nothing could ever
      // re-derive (D-10).
      for (const placeholder of Object.keys(sidecar!.entries)) {
        expect(placeholder).toMatch(/^<SECRET_\d+>$/)
      }

      // THE SIDECAR IS BESIDE THE EVENT LOG, in the same run dir family.
      const eventsPath = join(dirs[0]!, 'events.jsonl')
      const sidecarPath = join(dirs[0]!, 'masking-digests.json')
      expect(existsSync(eventsPath)).toBe(true)
      expect(existsSync(sidecarPath)).toBe(true)

      // THE PROPERTY THE WHOLE MECHANISM EXISTS FOR (T-405-06), read off the BYTES of both files.
      expect(readFileSync(sidecarPath).includes(plantedSecret)).toBe(false)
      expect(readFileSync(eventsPath).includes(plantedSecret)).toBe(false)

      // The digest really is this host's keyed HMAC of the planted value — not a bare hash, and
      // not some unrelated string that merely happens not to be the secret.
      const key = resolveMaskingHostKey(fixture.agentQaRoot)
      expect(Object.values(sidecar!.entries)).toContain(digestMaskedValue(key, plantedSecret))

      // THE HOST KEY IS 0600 AND ITS HEX IS NOWHERE IN THE SIDECAR (T-405-07).
      const keyFile = join(fixture.agentQaRoot, 'masking-key')
      expect(existsSync(keyFile)).toBe(true)
      expect(statSync(keyFile).mode & 0o777).toBe(0o600)
      expect(readFileSync(sidecarPath).includes(key.toString('hex'))).toBe(false)
    } finally {
      await target.close()
    }
  }, 120_000)
})
