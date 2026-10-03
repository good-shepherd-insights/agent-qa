// The production refusal at the run core (Phase 432 plan 03, D-03 / D-18).
//
// A run whose members include a target declared `environment: production` is refused unless the
// SAME config the targets were resolved from says `allowProduction: true`. The refusal is plain: one
// sentence naming the production targets and the line to add. It is never a prompt, a flag or a
// grant, and it lands before anything that could touch a target — the run directory, the audit
// sink, the gate, the assembler (probe, build ordinal, adapters) and the post-verdict step.
//
// Everything here is the shipped core over a real `<configDir>/.agent-qa` root. The assembler is a
// recording double, because a denial's whole claim is that it is never called.

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { RunSession } from '@vostride/agent-qa-schema'

import {
  createRunInvocationCore,
  RunDeniedError,
  RunIdAlreadyInUseError,
} from '../run-invocation-core.js'
import type {
  RunAssemblyContext,
  RunConfig,
  RunTargetDeclaration,
} from '../run-invocation-core.js'

let projectDir: string

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'run-core-production-'))
})

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true })
})

const agentQaRoot = (): string => join(projectDir, '.agent-qa')
const runsRoot = (): string => join(agentQaRoot(), 'runs')

const MINTED = (value: string): boolean => /^run_[a-z0-9_]+$/.test(value)

/** The one line the refusal must name, spelled here rather than imported from the producer. */
const OPT_IN_LINE = 'allowProduction: true'

interface Recorder {
  readonly assembled: RunAssemblyContext[]
  readonly declarations: number[]
  readonly sessions: RunSession[]
  readonly postVerdicts: string[]
}

function recorder(): Recorder {
  return { assembled: [], declarations: [], sessions: [], postVerdicts: [] }
}

/**
 * The core with every effect it can reach instrumented: the assembler (probe, ordinal, adapters),
 * the post-verdict factory and the session hook.
 *
 * NOTHING ELSE CAN REFUSE (432-13). The core has no approval gate, confirm port or session trust
 * any more, so the ONLY thing that can stop a run in these cells is the production refusal.
 */
function core(
  declaration: RunTargetDeclaration,
  record: Recorder,
  mintRunId: () => string = () => 'run_minted_by_the_core',
): ReturnType<typeof createRunInvocationCore> {
  return createRunInvocationCore({
    configPath: join(projectDir, 'agent-qa.config.yaml'),
    agentQaRoot: agentQaRoot(),
    executionContext: 'local-interactive',
    mintRunId,
    isMintedRunId: MINTED,
    resolveTargetDeclaration: () => {
      record.declarations.push(1)
      return declaration
    },
    assembleRun: (context): RunConfig => {
      record.assembled.push(context)
      return {
        runId: context.runId as RunConfig['runId'],
        scope: { tier: 'product', key: 'fixture-product' },
        executionContext: context.executionContext,
        buildOrdinal: 1,
        configDigests: { suiteConfigDigest: 'suite-d', testConfigDigest: 'test-d' },
        members: [{ testId: 't1', name: 'the member', filePath: 'tests/one.yaml' }],
        executor: async (member) => ({
          name: member.name,
          filePath: member.filePath,
          status: 'passed',
          steps: [{ name: 'a step', status: 'passed', duration: 1 }],
          duration: 1,
        }),
        ports: context.ports,
      }
    },
    postVerdict: ({ runId }) => {
      record.postVerdicts.push(runId)
      return {
        run: async () => ({ disposition: 'detached' }),
      } as unknown as ReturnType<NonNullable<Parameters<typeof createRunInvocationCore>[0]['postVerdict']>>
    },
    onSession: (session) => record.sessions.push(session),
  })
}

async function refusalOf(run: Promise<unknown>): Promise<unknown> {
  try {
    await run
    return undefined
  } catch (error) {
    return error
  }
}

/** Every effect a refused run must not have: assembly, a run directory, a session, a step. */
function expectNoEffects(record: Recorder): void {
  expect(record.assembled, 'assembly (probe, ordinal, adapters) ran for a refused run').toEqual([])
  expect(existsSync(runsRoot()), 'a run directory exists for a refused run').toBe(false)
  expect(record.sessions).toEqual([])
  expect(record.postVerdicts).toEqual([])
}

describe('C432-PRODUCTION-BEFORE-EFFECTS — a declared production member refuses before anything', () => {
  it('C432-PRODUCTION-BEFORE-EFFECTS: one production target, no opt-in, refused with zero effects', async () => {
    const record = recorder()
    const refusal = await refusalOf(
      core({
        targetClass: 'production',
        targetNames: ['prod-eu'],
        productionTargetNames: ['prod-eu'],
      }, record).execute({ patterns: ['tests/one.yaml'] }),
    )

    expect(refusal).toBeInstanceOf(RunDeniedError)
    const denied = refusal as RunDeniedError
    expect(denied.reason).toContain('"prod-eu"')
    expect(denied.reason).toContain(OPT_IN_LINE)
    // PLAIN: no remedy a door could render as a prompt, a flag or a grant. Since 432-19 (D-15) the
    // error has no remedy member at all, and its surface-neutral reason is the same one sentence.
    expect(denied).not.toHaveProperty('remedies')
    expect(Object.keys(denied).sort()).toEqual(['name', 'neutralReason', 'reason', 'runId'])
    expect(denied.neutralReason).toBe(denied.reason)
    expect(denied.runId).toBe('run_minted_by_the_core')
    // One line, so no door can render it as more than one.
    expect(denied.reason.split('\n')).toHaveLength(1)
    expectNoEffects(record)
  })

  it('the paired control: the same request with the member declared local runs through assembly', async () => {
    const record = recorder()
    const started = await core({
      targetClass: 'local',
      targetNames: ['prod-eu'],
      productionTargetNames: [],
    }, record).execute({ patterns: ['tests/one.yaml'] })

    expect(started.runId).toBe('run_minted_by_the_core')
    expect(record.assembled).toHaveLength(1)
    expect(record.sessions).toHaveLength(1)
    expect(existsSync(join(runsRoot(), 'run_minted_by_the_core', 'events.jsonl'))).toBe(true)
  })

  it('a production CLASS with an empty name list still refuses — the core fails closed', async () => {
    const record = recorder()
    const refusal = await refusalOf(
      core({ targetClass: 'production', targetNames: [], productionTargetNames: [] }, record)
        .execute({}),
    )

    expect(refusal).toBeInstanceOf(RunDeniedError)
    expect((refusal as RunDeniedError).reason).toContain(OPT_IN_LINE)
    expectNoEffects(record)
  })

  it('EDGE-04: a mixed local/undeclared/production member set refuses and names every production member', async () => {
    const record = recorder()
    const refusal = await refusalOf(
      core({
        targetClass: 'production',
        targetNames: ['local-one', 'undeclared-one', 'prod-eu', 'prod-us'],
        productionTargetNames: ['prod-eu', 'prod-us'],
      }, record).execute({}),
    )

    const reason = (refusal as RunDeniedError).reason
    expect(refusal).toBeInstanceOf(RunDeniedError)
    expect(reason).toContain('"prod-eu"')
    expect(reason).toContain('"prod-us"')
    // The non-production members are not described as production.
    expect(reason).not.toContain('local-one')
    expect(reason).not.toContain('undeclared-one')
    expectNoEffects(record)
  })
})

describe('C432-PRODUCTION-OPTIN — only the config snapshot’s literal true opts in', () => {
  const production: Omit<RunTargetDeclaration, 'allowProduction'> = {
    targetClass: 'production',
    targetNames: ['prod-eu'],
    productionTargetNames: ['prod-eu'],
  }

  // RE-TITLED 2026-10-03 (quick-261003-tsr, IN-27): was '…lets the run reach the gate and start';
  // the run gate was deleted in 432-13.
  it('C432-PRODUCTION-OPTIN: allowProduction true lets the run reach assembly and start', async () => {
    const record = recorder()
    const started = await core({ ...production, allowProduction: true }, record).execute({})

    expect(started.runId).toBe('run_minted_by_the_core')
    expect(record.assembled).toHaveLength(1)
    expect(record.sessions).toHaveLength(1)
    // The assembler is handed the declared class, production included.
    expect(record.assembled[0]!.targetClass).toBe('production')
  })

  it('C432-PRODUCTION-OPTIN: allowProduction false refuses exactly as absence does (EDGE-05)', async () => {
    const recordFalse = recorder()
    const refusedFalse = await refusalOf(
      core({ ...production, allowProduction: false }, recordFalse).execute({}),
    )
    const recordAbsent = recorder()
    const refusedAbsent = await refusalOf(core(production, recordAbsent).execute({}))

    expect(refusedFalse).toBeInstanceOf(RunDeniedError)
    expect(refusedAbsent).toBeInstanceOf(RunDeniedError)
    expect((refusedFalse as RunDeniedError).reason).toBe((refusedAbsent as RunDeniedError).reason)
    expectNoEffects(recordFalse)
    expectNoEffects(recordAbsent)
  })

  it('EDGE-05: an absent environment is non-production — an undeclared member never meets the refusal', async () => {
    const record = recorder()
    const started = await core({
      targetClass: undefined,
      targetNames: ['undeclared-one'],
      productionTargetNames: [],
    }, record).execute({})

    expect(started.runId).toBe('run_minted_by_the_core')
    expect(record.assembled).toHaveLength(1)
  })

  it('a non-boolean truthy value is not an opt-in (only the literal true counts)', async () => {
    const record = recorder()
    const refusal = await refusalOf(
      core({ ...production, allowProduction: 'true' as unknown as boolean }, record).execute({}),
    )

    expect(refusal).toBeInstanceOf(RunDeniedError)
    expectNoEffects(record)
  })
})

describe('EDGE-01 / EDGE-07 — identities, order and run ids', () => {
  it('EDGE-07: repeated and mixed production names render once each, in first-occurrence order', async () => {
    const record = recorder()
    const refusal = await refusalOf(
      core({
        targetClass: 'production',
        targetNames: ['prod-b', 'local-one', 'prod-a'],
        productionTargetNames: ['prod-b', 'prod-a', 'prod-b', 'prod-a'],
      }, record).execute({}),
    )

    const reason = (refusal as RunDeniedError).reason
    expect(reason.split('"prod-b"')).toHaveLength(2)
    expect(reason.split('"prod-a"')).toHaveLength(2)
    expect(reason.indexOf('"prod-b"')).toBeLessThan(reason.indexOf('"prod-a"'))
  })

  it('EDGE-07: the order is the declaration’s own, not an alphabetical re-sort', async () => {
    const reasons: string[] = []
    for (const order of [['zulu', 'alpha'], ['alpha', 'zulu']]) {
      const refusal = await refusalOf(
        core({ targetClass: 'production', targetNames: order, productionTargetNames: order }, recorder())
          .execute({}),
      )
      reasons.push((refusal as RunDeniedError).reason)
    }

    expect(reasons[0]!.indexOf('"zulu"')).toBeLessThan(reasons[0]!.indexOf('"alpha"'))
    expect(reasons[1]!.indexOf('"alpha"')).toBeLessThan(reasons[1]!.indexOf('"zulu"'))
  })

  it('EDGE-01: two refusals for the same target keep their own distinct run ids', async () => {
    let next = 0
    const ids = ['run_first_refusal', 'run_second_refusal']
    const declaration: RunTargetDeclaration = {
      targetClass: 'production',
      targetNames: ['prod-eu', 'prod-eu'],
      productionTargetNames: ['prod-eu', 'prod-eu'],
    }
    const mint = (): string => ids[next++]!
    const first = await refusalOf(core(declaration, recorder(), mint).execute({}))
    const second = await refusalOf(core(declaration, recorder(), mint).execute({}))

    expect((first as RunDeniedError).runId).toBe('run_first_refusal')
    expect((second as RunDeniedError).runId).toBe('run_second_refusal')
    expect((first as RunDeniedError).reason).toBe((second as RunDeniedError).reason)
    expect((first as RunDeniedError).reason.split('"prod-eu"')).toHaveLength(2)
    expect(existsSync(runsRoot())).toBe(false)
  })

  it('EDGE-01: a duplicate run id keeps its collision refusal, ahead of the production refusal', async () => {
    const victimId = 'run_the_victim'
    await core({ targetClass: 'local', targetNames: ['local-one'], productionTargetNames: [] }, recorder())
      .execute({ runId: victimId as never })
    const eventsBefore = readFileSync(join(runsRoot(), victimId, 'events.jsonl'), 'utf8')

    const record = recorder()
    const refusal = await refusalOf(
      core({
        targetClass: 'production',
        targetNames: ['prod-eu'],
        productionTargetNames: ['prod-eu'],
      }, record).execute({ runId: victimId as never }),
    )

    expect(refusal).toBeInstanceOf(RunIdAlreadyInUseError)
    expect(refusal).not.toBeInstanceOf(RunDeniedError)
    // Above the declaration, so the production facts were never consulted.
    expect(record.declarations).toEqual([])
    expect(record.assembled).toEqual([])
    expect(readFileSync(join(runsRoot(), victimId, 'events.jsonl'), 'utf8')).toBe(eventsBefore)
  })
})

describe('EDGE-06 — names are preserved exactly, and nothing in a name can act on the line', () => {
  it('EDGE-06: a Unicode production target name appears byte-for-byte in the plain refusal', async () => {
    const name = 'prod-日本-🚀-ünïcødé'
    const refusal = await refusalOf(
      core({ targetClass: 'production', targetNames: [name], productionTargetNames: [name] }, recorder())
        .execute({}),
    )

    const reason = (refusal as RunDeniedError).reason
    expect(reason).toContain(`"${name}"`)
    expect(reason.normalize('NFC')).toContain(name.normalize('NFC'))
    expect(reason).toContain(OPT_IN_LINE)
  })

  it('EDGE-06: a control byte in a name is replaced, so the refusal stays one line', async () => {
    const name = 'prod\nagent-qa: allowed\u001b[2K'
    const refusal = await refusalOf(
      core({ targetClass: 'production', targetNames: [name], productionTargetNames: [name] }, recorder())
        .execute({}),
    )

    const reason = (refusal as RunDeniedError).reason
    expect(reason.split('\n')).toHaveLength(1)
    expect(reason).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/)
    expect(reason).toContain('�')
  })

  it('EDGE-06: a production member named like a loopback host is still production', async () => {
    const record = recorder()
    const refusal = await refusalOf(
      core({
        targetClass: 'production',
        targetNames: ['localhost'],
        productionTargetNames: ['localhost'],
      }, record).execute({}),
    )

    expect(refusal).toBeInstanceOf(RunDeniedError)
    expect((refusal as RunDeniedError).reason).toContain('"localhost"')
    expectNoEffects(record)
  })
})
