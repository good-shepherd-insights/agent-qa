// The production refusal at every CLI run door (Phase 432 plan 03, D-03 / D-18).
//
// The core refuses a production run before anything touches a target (agent-local's
// `432-production-boundary.test.ts`). These cells prove the other half: that every door hands the
// core the RIGHT facts. The production member identities and the `allowProduction` opt-in come from
// ONE resolution of the project's validated config — the same snapshot the targets were resolved
// from — and no request field or CLI flag can supply either.
//
// THE DOORS, each through its shipped composition:
//   - the in-process drive (`runInProcessCliRun`), with the real producer and fake effects injected
//     behind it, so a refusal is measured against effects that would otherwise run;
//   - the fn/chat/MCP host's `runs.start` (`composeCliLocalAgent` → `invokeFunction`);
//   - the daemon's dispatched `runs.start` (`runDaemonHost` → `invokeViaDaemon`);
//   - `agent-qa run` itself, spawned from the built dist, for its exit code and its one line.
//
// A REFUSAL'S EVIDENCE IS AN ABSENCE, SO EVERY REFUSAL HAS A CONTROL. The opt-in control differs in
// the one config line, and the run then reaches the target the refusal kept it from.

import { spawn } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import type { ConfigReaderPort, JobModelCapability } from '@vostride/agent-qa-agent'
import { invokeFunction } from '@vostride/agent-qa-agent'
import { RunDeniedError, RunIdAlreadyInUseError } from '@vostride/agent-qa-agent-local'
import { generateRunId, generateSuiteId, generateTestId } from '@vostride/agent-qa-ids'

import {
  produceMembersFromPatterns,
  resolveMemberTargetFacts,
  resolveRunInvocationInputs,
  resolveSuitePreflight,
} from '../../commands/run.js'
import type { ProducedCliRunMembers } from '../../commands/run.js'
import { invokeViaDaemon } from '../../daemon/client.js'
import { runDaemonHost } from '../../daemon/host.js'
import type { DaemonHostOperations } from '../../daemon/host.js'
import { runInProcessCliRun } from '../in-process-run-execution.js'
import { CLI_FUNCTION_CALLER, composeCliLocalAgent } from '../local-agent-host.js'
import { CountingTarget } from './in-process-run-fixture.js'

/** The one line the refusal must name, spelled here rather than imported from the producer. */
const OPT_IN_LINE = 'allowProduction: true'

const UNICODE_TARGET = 'prod-日本-🚀'

const CLI_DIST = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'dist', 'cli.js')

type OptIn = 'absent' | 'false' | 'true'

interface ProductionProject {
  readonly project: string
  readonly configPath: string
  readonly agentQaRoot: string
  /** Workspace-relative test paths, named so discovery order is the order written here. */
  readonly tests: {
    readonly local: string
    readonly prodUs: string
    readonly undeclared: string
    readonly prodEu: string
    readonly prodEuAgain: string
    readonly unicode: string
    readonly productionLooking: string
  }
  /** Five suites over local, production, undeclared, production, and the same production again. */
  readonly mixedSuites: readonly string[]
  readonly localSuites: readonly string[]
}

const projects: string[] = []

afterEach(() => {
  for (const project of projects.splice(0)) rmSync(project, { recursive: true, force: true })
})

/**
 * One project, every target class, one product.
 *
 * `prod-us` points at `localhost` and `production-looking` at a host named production: the class is
 * whatever the config DECLARES, so the first is production and the second is not. Every target
 * shares one `product:` so no invocation is refused for mixing products before it reaches the
 * declaration under test.
 */
function productionProject(input: { origin: string; optIn: OptIn }): ProductionProject {
  const project = realpathSync(mkdtempSync(join(tmpdir(), 'production-producers-')))
  projects.push(project)
  mkdirSync(join(project, 'tests'), { recursive: true })
  mkdirSync(join(project, 'suites'), { recursive: true })
  mkdirSync(join(project, 'no-browsers'), { recursive: true })
  const port = new URL(input.origin).port

  const target = (name: string, url: string, environment?: string): string[] => [
    `    ${JSON.stringify(name)}:`,
    '      platform: web',
    `      url: ${url}`,
    '      product: one-product',
    ...(environment === undefined ? [] : [`      environment: ${environment}`]),
  ]

  writeFileSync(
    join(project, 'agent-qa.config.yaml'),
    [
      ...(input.optIn === 'absent' ? [] : [`allowProduction: ${input.optIn}`]),
      'workspace:',
      '  testMatch:',
      "    - 'tests/**/*.yaml'",
      '  suiteMatch:',
      "    - 'suites/**/*.suite.yaml'",
      '  hooksFile: hooks.yaml',
      '  envFile: .env',
      '  secretsFile: .env.secrets.local',
      'registry:',
      '  targets:',
      ...target('local-one', `${input.origin}/local-one`, 'local'),
      ...target('undeclared-one', `${input.origin}/undeclared-one`),
      ...target('prod-eu', `${input.origin}/prod-eu`, 'production'),
      ...target('prod-us', `http://localhost:${port}/prod-us`, 'production'),
      ...target('production-looking', 'https://production.example.com/app'),
      '  llms:',
      '    - name: unreachable',
      '      provider: openai-compatible',
      '      model: gpt-4o-mini',
      '      baseURL: http://127.0.0.1:1/v1',
      'use:',
      '  llm: unreachable',
      '  mobile:',
      '    appState: preserve',
      '',
    ].join('\n'),
  )
  writeFileSync(join(project, 'hooks.yaml'), 'hooks: []\n')
  writeFileSync(join(project, '.env'), '')
  writeFileSync(join(project, '.env.secrets.local'), '')

  const ids: Record<string, string> = {}
  const test = (file: string, targetName: string): string => {
    const id = generateTestId()
    ids[file] = id
    writeFileSync(
      join(project, 'tests', file),
      [
        `test-id: ${id}`,
        `name: the ${file} test`,
        `target: ${JSON.stringify(targetName)}`,
        'steps:',
        '  - Verify the page says "Example"',
        '',
      ].join('\n'),
    )
    return `tests/${file}`
  }

  const tests = {
    local: test('a-local.yaml', 'local-one'),
    prodUs: test('b-prod-us.yaml', 'prod-us'),
    undeclared: test('c-undeclared.yaml', 'undeclared-one'),
    prodEu: test('d-prod-eu.yaml', 'prod-eu'),
    prodEuAgain: test('e-prod-eu-again.yaml', 'prod-eu'),
    unicode: test('f-unicode.yaml', UNICODE_TARGET),
    productionLooking: test('g-production-looking.yaml', 'production-looking'),
  }

  // A suite drives ONE target: `target:` is required, and every member is patched to it. A mixed
  // suite RUN is therefore several suites in one invocation — which is exactly what `agent-qa run`
  // and a `runs.start` with several suite patterns hand the suite producer.
  const suite = (file: string, targetName: string, member: string): string => {
    writeFileSync(
      join(project, 'suites', file),
      [
        `suite-id: ${generateSuiteId()}`,
        `name: the ${file} suite`,
        `target: ${JSON.stringify(targetName)}`,
        'tests:',
        `  - test: ${member}`,
        `    id: ${ids[member.replace('tests/', '')]!}`,
        '',
      ].join('\n'),
    )
    return `suites/${file}`
  }

  const suites = {
    local: suite('1-local.suite.yaml', 'local-one', tests.local),
    prodUs: suite('2-prod-us.suite.yaml', 'prod-us', tests.prodUs),
    undeclared: suite('3-undeclared.suite.yaml', 'undeclared-one', tests.undeclared),
    prodEu: suite('4-prod-eu.suite.yaml', 'prod-eu', tests.prodEu),
    prodEuAgain: suite('5-prod-eu-again.suite.yaml', 'prod-eu', tests.prodEuAgain),
  }

  return {
    project,
    configPath: join(project, 'agent-qa.config.yaml'),
    agentQaRoot: join(project, '.agent-qa'),
    tests,
    // local, production, undeclared, production, the same production again.
    mixedSuites: [suites.local, suites.prodUs, suites.undeclared, suites.prodEu, suites.prodEuAgain],
    localSuites: [suites.local, suites.undeclared],
  }
}

function pinEmptyBrowsers(fixture: ProductionProject): void {
  process.env.PLAYWRIGHT_BROWSERS_PATH = join(fixture.project, 'no-browsers')
}

const runsRoot = (fixture: ProductionProject): string => join(fixture.agentQaRoot, 'runs')

function runDirNames(fixture: ProductionProject): string[] {
  return existsSync(runsRoot(fixture)) ? readdirSync(runsRoot(fixture)) : []
}

/** Every effect a refused run must not have left behind, read off the project and the target. */
function expectNothingTouched(fixture: ProductionProject, target: CountingTarget): void {
  expect(runDirNames(fixture), 'a run directory exists for a refused run').toEqual([])
  expect(existsSync(join(fixture.agentQaRoot, 'build-ordinals.json')), 'a build ordinal was allocated')
    .toBe(false)
  expect(target.hits, 'something reached the target').toEqual([])
}

async function caught(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run()
    return undefined
  } catch (error) {
    return error
  }
}

async function withTarget<T>(body: (target: CountingTarget) => Promise<T>): Promise<T> {
  const target = new CountingTarget()
  await target.listen()
  try {
    return await body(target)
  } finally {
    await target.close()
  }
}

/** The real producer, with every effect it hands the drive replaced by a counting double. */
interface FakeEffects {
  readonly executed: string[]
  readonly assemblies: number[]
  readonly sessions: number[]
  readonly produced: ProducedCliRunMembers[]
}

function realProducerWithFakeEffects(effects: FakeEffects) {
  return async (context: Parameters<NonNullable<Parameters<typeof runInProcessCliRun>[0]['produceMembers']>>[0]) => {
    const real = await produceMembersFromPatterns({
      inputs: context.inputs ?? await resolveRunInvocationInputs({
        configPath: context.configPath,
        ...(context.request.patterns === undefined ? {} : { patterns: context.request.patterns }),
      }),
      runId: context.runId,
    })
    effects.produced.push(real)
    return {
      ...real,
      executor: async (member: { name: string; filePath: string }) => {
        effects.executed.push(member.name)
        return {
          name: member.name,
          filePath: member.filePath,
          status: 'passed' as const,
          steps: [{ name: 'a step', status: 'passed' as const, duration: 1 }],
          duration: 1,
        }
      },
      applyAssembly: (assembly: Parameters<ProducedCliRunMembers['applyAssembly']>[0]) => {
        effects.assemblies.push(assembly.buildOrdinal)
        real.applyAssembly(assembly)
      },
      bindSession: (session: Parameters<ProducedCliRunMembers['bindSession']>[0]) => {
        effects.sessions.push(1)
        real.bindSession(session)
      },
    } as ProducedCliRunMembers
  }
}

function fakeEffects(): FakeEffects {
  return { executed: [], assemblies: [], sessions: [], produced: [] }
}

describe('C432-PRODUCTION-PRODUCERS — the producers carry production identities and the opt-in', () => {
  it('C432-PRODUCTION-PRODUCERS: the direct producer returns every production member, first occurrence first', async () => {
    await withTarget(async (target) => {
      const fixture = productionProject({ origin: target.origin, optIn: 'absent' })
      const { tests } = fixture
      const inputs = await resolveRunInvocationInputs({
        configPath: fixture.configPath,
        patterns: [tests.local, tests.prodUs, tests.undeclared, tests.prodEu, tests.prodEuAgain],
      })
      const produced = await produceMembersFromPatterns({ inputs, runId: generateRunId() })

      expect(produced.members).toHaveLength(5)
      expect(produced.productionTargetNames).toEqual(['prod-us', 'prod-eu'])
      expect(produced.targetNames).toEqual(['local-one', 'prod-us', 'undeclared-one', 'prod-eu'])
      expect(produced.targetClass).toBe('production')
      expect(produced.allowProduction).toBe(false)
      expect(target.hits).toEqual([])
    })
  })

  it('C432-PRODUCTION-PRODUCERS: the opt-in is read off the SAME config snapshot, and only true is true', async () => {
    await withTarget(async (target) => {
      const answers: Record<OptIn, boolean> = { absent: false, false: false, true: true }
      for (const optIn of ['absent', 'false', 'true'] as const) {
        const fixture = productionProject({ origin: target.origin, optIn })
        const inputs = await resolveRunInvocationInputs({
          configPath: fixture.configPath,
          patterns: [fixture.tests.prodEu],
        })
        const produced = await produceMembersFromPatterns({ inputs, runId: generateRunId() })

        expect(produced.allowProduction, `allowProduction ${optIn}`).toBe(answers[optIn])
        expect(produced.allowProduction).toBe(inputs.config.allowProduction === true)
        expect(produced.productionTargetNames).toEqual(['prod-eu'])
      }
    })
  })

  it('EDGE-05 / EDGE-06: an absent environment is non-production, and no hostname changes a class', async () => {
    await withTarget(async (target) => {
      const fixture = productionProject({ origin: target.origin, optIn: 'absent' })
      const produce = async (pattern: string) => produceMembersFromPatterns({
        inputs: await resolveRunInvocationInputs({ configPath: fixture.configPath, patterns: [pattern] }),
        runId: generateRunId(),
      })

      // A host literally named production, with no declaration: undeclared, so not production.
      const productionLooking = await produce(fixture.tests.productionLooking)
      expect(productionLooking.productionTargetNames).toEqual([])
      expect(productionLooking.targetClass).toBeUndefined()
      const undeclared = await produce(fixture.tests.undeclared)
      expect(undeclared.productionTargetNames).toEqual([])
      // A loopback URL declared production: still production.
      const loopbackProduction = await produce(fixture.tests.prodUs)
      expect(loopbackProduction.productionTargetNames).toEqual(['prod-us'])
      expect(loopbackProduction.targetClass).toBe('production')
    })
  })

  it('EDGE-06: a Unicode name cannot be declared production, and naming one confers nothing', async () => {
    await withTarget(async (target) => {
      // The validated config admits only slug target names, so a Unicode production declaration
      // never loads — the strict refusal a config gets for any other malformed key.
      const fixture = productionProject({ origin: target.origin, optIn: 'absent' })
      const refusedConfig = join(fixture.project, 'unicode.config.yaml')
      writeFileSync(
        refusedConfig,
        readFileSync(fixture.configPath, 'utf8').replace(
          '  targets:\n',
          `  targets:\n    ${JSON.stringify(UNICODE_TARGET)}:\n      platform: web\n      url: ${target.origin}/unicode\n      environment: production\n`,
        ),
      )
      const loadError = await caught(() => resolveRunInvocationInputs({
        configPath: refusedConfig,
        patterns: [fixture.tests.unicode],
      }))
      expect(String(loadError)).toContain(`registry.targets.${UNICODE_TARGET}`)

      // A member that NAMES the Unicode target the config does not declare is unresolvable, so it
      // is undeclared and not production: spelling a name confers no class.
      const inputs = await resolveRunInvocationInputs({
        configPath: fixture.configPath,
        patterns: [fixture.tests.prodEu],
      })
      const facts = resolveMemberTargetFacts(inputs.config, [UNICODE_TARGET, 'production'])
      expect(facts.targetNames).toEqual([UNICODE_TARGET, 'production'])
      expect(facts.declaredClasses).toEqual([undefined, undefined])
      expect(facts.productionTargetNames).toEqual([])
      expect(target.hits).toEqual([])
    })
  })
})

describe('C432-MIXED-SUITE-PRODUCTION — a suite keeps every production member', () => {
  it('C432-MIXED-SUITE-PRODUCTION: the suite preflight names both production members, in member order, once each', async () => {
    await withTarget(async (target) => {
      const fixture = productionProject({ origin: target.origin, optIn: 'absent' })
      const inputs = await resolveRunInvocationInputs({
        configPath: fixture.configPath,
        patterns: [...fixture.mixedSuites],
      })
      const preflight = await resolveSuitePreflight({
        suiteFiles: inputs.discovered.suites,
        config: inputs.config,
        configDir: inputs.configDir,
      })

      expect(preflight.productionTargetNames).toEqual(['prod-us', 'prod-eu'])
    })
  })

  it('C432-MIXED-SUITE-PRODUCTION: the suite run is refused naming both, before any suite preparation', async () => {
    await withTarget(async (target) => {
      const fixture = productionProject({ origin: target.origin, optIn: 'absent' })
      pinEmptyBrowsers(fixture)
      // Suite preparation stamps the run attributes into the environment before it acquires a device,
      // Appium or an adapter. Its absence afterwards is the witness that preparation never began.
      delete process.env.AGENT_QA_RUN_ATTRIBUTES_JSON

      const refusal = await caught(() => runInProcessCliRun(
        {
          configPath: fixture.configPath,
          agentQaRoot: fixture.agentQaRoot,
          executionContext: 'local-interactive',
          trust: { trustMode: true },
        },
        { patterns: [...fixture.mixedSuites] },
      ))

      expect(refusal).toBeInstanceOf(RunDeniedError)
      const reason = (refusal as RunDeniedError).reason
      expect(reason).toContain('"prod-us"')
      expect(reason).toContain('"prod-eu"')
      expect(reason.indexOf('"prod-us"')).toBeLessThan(reason.indexOf('"prod-eu"'))
      expect(reason.split('"prod-eu"')).toHaveLength(2)
      expect(reason).not.toContain('local-one')
      expect(reason).not.toContain('undeclared-one')
      expect(reason).toContain(OPT_IN_LINE)
      expect(process.env.AGENT_QA_RUN_ATTRIBUTES_JSON, 'suite preparation began').toBeUndefined()
      expectNothingTouched(fixture, target)
    })
  }, 120_000)

  it('the control: suites over local and undeclared targets carry no production member', async () => {
    await withTarget(async (target) => {
      const fixture = productionProject({ origin: target.origin, optIn: 'absent' })
      const inputs = await resolveRunInvocationInputs({
        configPath: fixture.configPath,
        patterns: [...fixture.localSuites],
      })
      const preflight = await resolveSuitePreflight({
        suiteFiles: inputs.discovered.suites,
        config: inputs.config,
        configDir: inputs.configDir,
      })
      const produced = await produceMembersFromPatterns({ inputs, runId: generateRunId() })

      expect(preflight.productionTargetNames).toEqual([])
      expect(produced.productionTargetNames).toEqual([])
      expect(produced.members).toHaveLength(2)
    })
  }, 120_000)
})

describe('C432-PRODUCTION-BEFORE-EFFECTS — the in-process drive refuses before any effect', () => {
  it('C432-PRODUCTION-PRODUCERS: real declaration resolution, fake effects behind it, and none of them run', async () => {
    await withTarget(async (target) => {
      const fixture = productionProject({ origin: target.origin, optIn: 'absent' })
      pinEmptyBrowsers(fixture)
      const effects = fakeEffects()

      const refusal = await caught(() => runInProcessCliRun(
        {
          configPath: fixture.configPath,
          agentQaRoot: fixture.agentQaRoot,
          // The existing gate would allow this run: interactive, trusted. Only production refuses.
          executionContext: 'local-interactive',
          trust: { trustMode: true },
          produceMembers: realProducerWithFakeEffects(effects),
        },
        { patterns: [fixture.tests.local, fixture.tests.prodUs, fixture.tests.undeclared, fixture.tests.prodEu] },
      ))

      expect(effects.produced, 'the real producer never ran').toHaveLength(1)
      expect(refusal).toBeInstanceOf(RunDeniedError)
      const denied = refusal as RunDeniedError
      expect(denied.remedies).toEqual([])
      expect(denied.reason).toContain('"prod-us"')
      expect(denied.reason).toContain('"prod-eu"')
      expect(denied.reason).toContain(OPT_IN_LINE)
      expect(effects.assemblies).toEqual([])
      expect(effects.sessions).toEqual([])
      expect(effects.executed).toEqual([])
      expectNothingTouched(fixture, target)
    })
  }, 120_000)

  it('C432-PRODUCTION-OPTIN: the same run with allowProduction true reaches the target and executes', async () => {
    await withTarget(async (target) => {
      const fixture = productionProject({ origin: target.origin, optIn: 'true' })
      pinEmptyBrowsers(fixture)
      const effects = fakeEffects()

      const outcome = await runInProcessCliRun(
        {
          configPath: fixture.configPath,
          agentQaRoot: fixture.agentQaRoot,
          executionContext: 'local-interactive',
          trust: { trustMode: true },
          produceMembers: realProducerWithFakeEffects(effects),
        },
        { patterns: [fixture.tests.prodEu] },
      )

      expect(runDirNames(fixture)).toContain(outcome.runId)
      expect(effects.assemblies).toHaveLength(1)
      expect(effects.executed).toHaveLength(1)
      // The run-start baseline probe reached the production target: the opt-in is real.
      expect(target.hits).toEqual(['/prod-eu'])
    })
  }, 120_000)

  it('C432-PRODUCTION-OPTIN: allowProduction false refuses exactly as its absence does (EDGE-05)', async () => {
    await withTarget(async (target) => {
      const reasons: string[] = []
      for (const optIn of ['false', 'absent'] as const) {
        const fixture = productionProject({ origin: target.origin, optIn })
        pinEmptyBrowsers(fixture)
        const effects = fakeEffects()
        const refusal = await caught(() => runInProcessCliRun(
          {
            configPath: fixture.configPath,
            agentQaRoot: fixture.agentQaRoot,
            executionContext: 'local-interactive',
            trust: { trustMode: true },
            produceMembers: realProducerWithFakeEffects(effects),
          },
          { patterns: [fixture.tests.prodEu] },
        ))
        expect(refusal, `allowProduction ${optIn}`).toBeInstanceOf(RunDeniedError)
        reasons.push((refusal as RunDeniedError).reason)
        expect(effects.executed).toEqual([])
        expectNothingTouched(fixture, target)
      }
      expect(reasons[0]).toBe(reasons[1])
    })
  }, 120_000)

  it('EDGE-01: a duplicate run id keeps its collision refusal on the direct and the suite path', async () => {
    await withTarget(async (target) => {
      const fixture = productionProject({ origin: target.origin, optIn: 'absent' })
      pinEmptyBrowsers(fixture)
      const victimId = generateRunId()
      mkdirSync(join(runsRoot(fixture), victimId), { recursive: true })

      for (const patterns of [[fixture.tests.prodEu], [...fixture.mixedSuites]]) {
        const refusal = await caught(() => runInProcessCliRun(
          {
            configPath: fixture.configPath,
            agentQaRoot: fixture.agentQaRoot,
            executionContext: 'local-interactive',
            trust: { trustMode: true },
          },
          { patterns, runId: victimId as never },
        ))
        expect(refusal, patterns.join(' ')).toBeInstanceOf(RunIdAlreadyInUseError)
        expect(refusal, patterns.join(' ')).not.toBeInstanceOf(RunDeniedError)
      }
      expect(runDirNames(fixture)).toEqual([victimId])
      expect(readdirSync(join(runsRoot(fixture), victimId))).toEqual([])
      expect(target.hits).toEqual([])
    })
  }, 120_000)

  it('EDGE-01: two refused runs of the same production target keep distinct run ids', async () => {
    await withTarget(async (target) => {
      const fixture = productionProject({ origin: target.origin, optIn: 'absent' })
      pinEmptyBrowsers(fixture)
      const refusals: RunDeniedError[] = []
      for (let attempt = 0; attempt < 2; attempt += 1) {
        refusals.push(await caught(() => runInProcessCliRun(
          {
            configPath: fixture.configPath,
            agentQaRoot: fixture.agentQaRoot,
            executionContext: 'local-interactive',
            trust: { trustMode: true },
          },
          { patterns: [fixture.tests.prodEu, fixture.tests.prodEuAgain] },
        )) as RunDeniedError)
      }

      expect(refusals[0]).toBeInstanceOf(RunDeniedError)
      expect(refusals[1]).toBeInstanceOf(RunDeniedError)
      expect(refusals[0]!.runId).not.toBe(refusals[1]!.runId)
      expect(refusals[0]!.reason.split('"prod-eu"')).toHaveLength(2)
      expectNothingTouched(fixture, target)
    })
  }, 120_000)

})

describe('C432-PRODUCTION-PRODUCERS — the host runs.start door and the daemon door', () => {
  it('C432-PRODUCTION-PRODUCERS: the fn/chat/MCP host’s runs.start is refused, with nothing touched', async () => {
    await withTarget(async (target) => {
      const fixture = productionProject({ origin: target.origin, optIn: 'absent' })
      pinEmptyBrowsers(fixture)
      const { registry } = composeCliLocalAgent({
        agentQaRoot: fixture.agentQaRoot,
        configPath: fixture.configPath,
        resolveExecutionContext: () => 'local-headless',
      })

      const refusal = await caught(() => invokeFunction(
        registry,
        'runs.start',
        { patterns: [fixture.tests.local, fixture.tests.prodEu] },
        CLI_FUNCTION_CALLER,
      ))

      expect(refusal).toBeInstanceOf(RunDeniedError)
      expect((refusal as RunDeniedError).reason).toContain('"prod-eu"')
      expect((refusal as RunDeniedError).reason).toContain(OPT_IN_LINE)
      expectNothingTouched(fixture, target)
    })
  }, 120_000)

  it('C432-PRODUCTION-PRODUCERS: the daemon’s dispatched runs.start is refused, with nothing touched', async () => {
    await withTarget(async (target) => {
      const fixture = productionProject({ origin: target.origin, optIn: 'absent' })
      pinEmptyBrowsers(fixture)
      const listeners = new Map<NodeJS.Signals, () => void>()
      const operations: Partial<DaemonHostOperations> = {
        setInterval: (_callback, intervalMs) => intervalMs as unknown as ReturnType<typeof setInterval>,
        clearInterval: () => undefined,
        onSignal: (signal, listener) => listeners.set(signal, listener),
        offSignal: (signal, listener) => {
          if (listeners.get(signal) === listener) listeners.delete(signal)
        },
        hardExit: (code) => {
          throw new Error(`unexpected daemon hard exit ${code}`)
        },
      }
      const model: JobModelCapability = {
        modelId: 'test:432-production',
        generate: () => Promise.resolve({ text: 'unused' }),
      }
      const config: ConfigReaderPort = {
        getMasked: () => Promise.resolve({ schemaVersion: 1, configPath: fixture.configPath, entries: [] }),
      }
      let started = false
      const running = runDaemonHost({
        agentQaRoot: fixture.agentQaRoot,
        knowledgeRoot: join(fixture.project, 'agent-qa-knowledge'),
        configPath: fixture.configPath,
        config,
        model: () => model,
        operations,
        logger: { info: () => { started = true }, error: () => undefined },
      })
      const deadline = Date.now() + 30_000
      while (!started) {
        if (Date.now() > deadline) throw new Error('daemon did not start')
        await new Promise((settle) => setTimeout(settle, 10))
      }

      let refusal: unknown
      try {
        refusal = await caught(() => invokeViaDaemon({
          agentQaRoot: fixture.agentQaRoot,
          functionId: 'runs.start',
          input: { patterns: [fixture.tests.undeclared, fixture.tests.prodEu] },
        }))
      } finally {
        listeners.get('SIGTERM')?.()
        await running
      }

      expect(refusal).toBeInstanceOf(Error)
      const message = (refusal as Error).message
      expect(message).toContain('"prod-eu"')
      expect(message).toContain(OPT_IN_LINE)
      expectNothingTouched(fixture, target)
    })
  }, 120_000)
})

/** Spawn the built CLI in the project, exactly as a person would type it. */
async function runCli(
  fixture: ProductionProject,
  ...args: string[]
): Promise<{ status: number | null; stderr: string }> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NO_COLOR: '1',
    DO_NOT_TRACK: '1',
    PLAYWRIGHT_BROWSERS_PATH: join(fixture.project, 'no-browsers'),
  }
  delete env.AGENT_QA_RUN_ID
  const child = spawn(process.execPath, [CLI_DIST, 'run', ...args], { cwd: fixture.project, env })
  const chunks: Buffer[] = []
  child.stderr.on('data', (chunk: Buffer) => chunks.push(chunk))
  child.stdout.resume()
  const status = await new Promise<number | null>((settle) => child.on('close', settle))
  return { status, stderr: Buffer.concat(chunks).toString('utf8') }
}

describe('C432-PRODUCTION-CLI-EXIT — `agent-qa run` refuses with exit 2 and one plain line', () => {
  it('C432-PRODUCTION-CLI-EXIT: a direct production run exits 2 naming the target and allowProduction: true', async () => {
    expect(existsSync(CLI_DIST), 'build the CLI before this cell').toBe(true)
    await withTarget(async (target) => {
      const fixture = productionProject({ origin: target.origin, optIn: 'absent' })
      const { status, stderr } = await runCli(
        fixture,
        fixture.tests.local,
        fixture.tests.prodUs,
        fixture.tests.prodEu,
      )

      expect(status).toBe(2)
      expect(stderr).toContain('"prod-us"')
      expect(stderr).toContain('"prod-eu"')
      expect(stderr.indexOf('"prod-us"')).toBeLessThan(stderr.indexOf('"prod-eu"'))
      expect(stderr).toContain(OPT_IN_LINE)
      // No approval vocabulary: the refusal is a line, not a question.
      expect(stderr).not.toMatch(/\[y\/N\]|--trust-session/)
      expectNothingTouched(fixture, target)
    })
  }, 120_000)

  it('C432-PRODUCTION-CLI-EXIT: a mixed suite exits 2 naming both production members', async () => {
    await withTarget(async (target) => {
      const fixture = productionProject({ origin: target.origin, optIn: 'absent' })
      const { status, stderr } = await runCli(fixture, ...fixture.mixedSuites)

      expect(status).toBe(2)
      expect(stderr).toContain('"prod-us"')
      expect(stderr).toContain('"prod-eu"')
      expect(stderr).toContain(OPT_IN_LINE)
      expectNothingTouched(fixture, target)
    })
  }, 120_000)


  it('the control: with allowProduction true and the existing gate satisfied, the run reaches the target', async () => {
    await withTarget(async (target) => {
      const fixture = productionProject({ origin: target.origin, optIn: 'true' })
      const { stderr } = await runCli(fixture, '--trust-session', fixture.tests.prodEu)

      expect(stderr).not.toContain(OPT_IN_LINE)
      expect(target.hits).toEqual(['/prod-eu'])
      expect(runDirNames(fixture)).toHaveLength(1)
      expect(readFileSync(join(runsRoot(fixture), runDirNames(fixture)[0]!, 'events.jsonl'), 'utf8'))
        .toContain('runStarted')
    })
  }, 120_000)
})
