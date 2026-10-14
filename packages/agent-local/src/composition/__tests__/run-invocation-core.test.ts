// The in-process invocation core, driven through its production factory (Phase 401 plan 03, D-02).
//
// WHAT THIS FILE MEASURES, and what it deliberately does not. The core's job is an ORDER —
// refuse, identify, refuse production, assemble, start, await — so every cell here is about the
// order or about what the order lets through. The member EXECUTOR is a double, because a real one
// needs a browser and a model; everything else is the shipped path: the real
// `createRunInvocationCore`, the real `startRun`, the real `FsEventLog`/`FsHandoffStore` under a
// real `<configDir>/.agent-qa` root, and a real `JsonlAuditSink` reading back off disk.
//
// 2026-09-30 (432-13, D-14/D-15): THE CORE ASKS NOBODY. The run-start `evaluate()`, its confirm port
// and its session trust are gone; production is the one refusal of a well-formed request. The deny
// leg below is re-spelled as starts in every context, and the gate census as the gate's absence.
//
// THE ROOT IS THE ONE THE EVIDENCE CHECK READS (RESEARCH Pitfall 5). `createLocalRunInvocation`
// verifies a run happened by reading `buildRunPorts({ configDir: dirname(agentQaRoot) })`. If the
// core wrote anywhere else, every `runs.start` would throw `RunProducedNoEventsError` for a run that
// really happened — or somebody would "fix" it by deleting the anti-fabrication check. So the cells
// below read events through that same construction rather than through a path they compose.

import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { RunEventEnvelope, RunSession } from '@vostride/agent-qa-schema'

import { buildRunPorts } from '../run-composition.js'
import type { RunExecutionContext } from '../run-composition.js'
import {
  createRunInvocationCore,
  RunDeniedError,
  RunIdAlreadyInUseError,
  RunIdNotMintedError,
  RunRequestFieldRefusedError,
} from '../run-invocation-core.js'
import type { RunAssemblyContext, RunConfig } from '../run-invocation-core.js'
// 2026-10-01 (432-19, D-15): the run gate's descriptor recipe is deleted; its action name is kept
// here as a literal so the cells below can still assert no row ever names it.
const RETIRED_RUN_START_ACTION = 'run:start'
import type { RunTargetClass } from '../run-risk.js'

let projectDir: string

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'run-core-'))
})

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true })
})

function agentQaRoot(): string {
  return join(projectDir, '.agent-qa')
}

/**
 * The recording assembler: a real one-member `RunConfig` whose executor is the only double.
 *
 * `calls` is the instrument the deny-path cell turns on — the core must not reach assembly at all
 * when the verdict is deny, and a call COUNT is what makes "no side effects" checkable rather than
 * asserted about the effects a reader happened to think of.
 */
function recordingAssembler(): {
  calls: RunAssemblyContext[]
  assemble: (context: RunAssemblyContext) => RunConfig
} {
  const calls: RunAssemblyContext[] = []
  return {
    calls,
    assemble(context: RunAssemblyContext): RunConfig {
      calls.push(context)
      return {
        runId: context.runId as RunConfig['runId'],
        scope: { tier: 'product', key: 'fixture-product' },
        executionContext: context.executionContext,
        buildOrdinal: 1,
        configDigests: { suiteConfigDigest: 'suite-d', testConfigDigest: 'test-d' },
        members: [{ testId: 't1', name: 'the only member', filePath: 'tests/one.yaml' }],
        executor: async (member) => ({
          name: member.name,
          filePath: member.filePath,
          status: 'passed',
          steps: [{ name: 'a step', status: 'passed', duration: 1 }],
          duration: 1,
        }),
        // THE PRODUCTION PORTS, handed straight through from the core. Substituting fakes here
        // would measure the assembly and leave the persistence rooting — the thing Pitfall 5 is
        // about — untested at exactly the seam that has to hold.
        ports: context.ports,
      }
    },
  }
}

/** The name the fake resolver declares, so a disclosure assertion has something to find. */
const FAKE_TARGET_NAME = 'the-fixture-target'

/**
 * This fixture's own mint shape (401-20).
 *
 * The core takes `isMintedRunId` as an injected predicate precisely so the canonical id shape stays
 * in the package that owns it, which this one may not name. A fixture therefore supplies a fixture
 * predicate — the core's contract is that it ASKS, and every cell below turns on what it does with
 * the answer, never on which spelling the answer was about.
 */
const FIXTURE_MINTED_RUN_ID = (value: string): boolean => /^run_[a-z_]+$/.test(value)

interface CoreInput {
  targetClass: RunTargetClass
  /** What this run's members DECLARE. Defaults to the one name every cell here resolves against. */
  targetNames?: readonly string[]
  executionContext?: RunExecutionContext
  assemble?: (context: RunAssemblyContext) => RunConfig
  onSession?: (session: RunSession) => void
  mintRunId?: () => string
  /** 401-20: the shape predicate. Defaults to the canonical one every production door supplies. */
  isMintedRunId?: (value: string) => boolean
}

function makeCore(input: CoreInput): ReturnType<typeof createRunInvocationCore> {
  return createRunInvocationCore({
    configPath: join(projectDir, 'agent-qa.config.yaml'),
    agentQaRoot: agentQaRoot(),
    executionContext: input.executionContext ?? 'ci',
    mintRunId: input.mintRunId ?? (() => 'run_minted_by_the_core'),
    isMintedRunId: input.isMintedRunId ?? FIXTURE_MINTED_RUN_ID,
    resolveTargetDeclaration: () => ({
      targetClass: input.targetClass,
      targetNames: input.targetNames ?? [FAKE_TARGET_NAME],
      // 432-03: no member of these cells is production; the production arm has its own suite.
      productionTargetNames: [],
    }),
    assembleRun: input.assemble ?? recordingAssembler().assemble,
    ...(input.onSession === undefined ? {} : { onSession: input.onSession }),
  })
}

/** Read the run's events back through the SAME construction the composition's evidence check uses. */
function recordedEvents(runId: string): RunEventEnvelope[] {
  return [...buildRunPorts({ configDir: projectDir, runId }).eventLog.read(0)]
}

/**
 * A byte digest of every artifact in a run's directory (401-20).
 *
 * SHA of the CONTENTS, not a mtime or a size: "the victim is untouched" has to be a statement
 * about bytes, and an appended line that happened to replace one of the same length would be
 * invisible to anything weaker.
 */
function artifactDigests(runDir: string): Record<string, string> {
  if (!existsSync(runDir)) return {}
  const digests: Record<string, string> = {}
  for (const entry of readdirSync(runDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue
    digests[entry.name] = createHash('sha256')
      .update(readFileSync(join(runDir, entry.name)))
      .digest('hex')
  }
  return digests
}

/**
 * Every audit row the run dir holds, from either trail (432-13: the core writes none).
 *
 * 2026-10-01 (432-19, D-17): `execution_audit.jsonl` has no writer at all, and the run's guardrail
 * rows land in `guardrail_audit.jsonl`. Both are read so "no row" means no row of any kind, and a
 * returning execution-audit writer would be seen here.
 */
function recordedAuditRows(runId: string): Array<Record<string, unknown>> {
  const slug = runId.replaceAll('/', '-')
  return ['execution_audit.jsonl', 'guardrail_audit.jsonl'].flatMap((file) => {
    const path = join(agentQaRoot(), 'runs', slug, file)
    if (!existsSync(path)) return []
    return readFileSync(path, 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line) as Record<string, unknown>)
  })
}

describe('the invocation core — the allow leg, end to end (D-02)', () => {
  // RE-SPELLED 2026-09-30 (432-13): 'runs a local-declared target through gate → assembly → startRun
  // → handoff, under the production root'. There is no gate step and no gate row.
  it('runs a local-declared target through assembly → startRun → handoff, under the production root', async () => {
    const assembler = recordingAssembler()
    const sessions: RunSession[] = []
    const core = makeCore({
      targetClass: 'local',
      assemble: assembler.assemble,
      onSession: (session) => sessions.push(session),
    })

    const started = await core.execute({ patterns: ['tests/one.yaml'] })

    expect(started.runId).toBe('run_minted_by_the_core')
    expect(assembler.calls).toHaveLength(1)
    // The assembler is handed the SAME id the caller is acknowledged with — a run that reported one
    // id and started under another would make every later `runs.get` a lookup of a different run.
    expect(assembler.calls[0].runId).toBe(started.runId)

    // D-09's bridge hook fired, and it fired with the session the run is actually happening on.
    expect(sessions).toHaveLength(1)
    expect(sessions[0].id).toBe(started.runId)

    // `type`, which is the envelope's own field name — the bus writes `{seq, ts, runId, type,
    // payload}`. Asserted off the jsonl the run really left behind rather than off a subscriber,
    // because what a later reader (`runs.get`, the dashboard bridge) sees is the durable log.
    const types = recordedEvents(String(started.runId)).map((event) => event.type)
    expect(types[0]).toBe('runStarted')
    expect(types).toContain('runFinished')

    // The handoff — the run's durable record — is on disk under the same root, which is what makes
    // the acknowledgment readable back by `runs.get` rather than a claim.
    const slug = String(started.runId).replaceAll('/', '-')
    expect(existsSync(join(agentQaRoot(), 'runs', slug, 'handoff.json'))).toBe(true)

    // No run-start decision row: nothing decided. This cell runs in `ci` on purpose.
    const rows = recordedAuditRows(String(started.runId))
    expect(rows.filter((row) => row.action === RETIRED_RUN_START_ACTION)).toEqual([])
  })

  it('carries the request markers onto the run and only the literal true (INVK-06 chain, shortened)', async () => {
    const assembler = recordingAssembler()
    const core = makeCore({ targetClass: 'local', assemble: assembler.assemble })

    const started = await core.execute({ gateRun: true })

    const runStarted = recordedEvents(String(started.runId))[0]
    expect(runStarted.type).toBe('runStarted')
    const slug = String(started.runId).replaceAll('/', '-')
    const handoff = JSON.parse(
      readFileSync(join(agentQaRoot(), 'runs', slug, 'handoff.json'), 'utf8'),
    ) as { gateRun?: true; excludedFromOutcomes?: true }
    expect(handoff.gateRun).toBe(true)
    // The OTHER axis was never asserted by the caller, so it must be absent rather than false.
    expect(Object.hasOwn(handoff, 'excludedFromOutcomes')).toBe(false)
  })

  it('honours a caller-minted run id (the additive request field the child env variable used to be)', async () => {
    const core = makeCore({ targetClass: 'local' })

    const started = await core.execute({ runId: 'run_from_the_door' as never })

    expect(started.runId).toBe('run_from_the_door')
    expect(recordedEvents('run_from_the_door')).not.toHaveLength(0)
  })
})

// 432-13 (D-01/D-15/D-18): the core asks nobody. Production is the one refusal left, and it lands
// before every effect; every other class starts in every context with no confirm port and no trust.
describe('C432-PRODUCTION-BEFORE-EFFECTS — production is the one refusal left (432-13)', () => {
  it('C432-PRODUCTION-BEFORE-EFFECTS: shared and undeclared runs start in ci and local-headless with no confirm or trust', async () => {
    const cases = [
      { targetClass: 'shared', executionContext: 'ci', runId: 'run_shared_in_ci' },
      { targetClass: undefined, executionContext: 'ci', runId: 'run_undeclared_in_ci' },
      { targetClass: 'shared', executionContext: 'local-headless', runId: 'run_shared_headless' },
      { targetClass: 'shared', executionContext: 'local-interactive', runId: 'run_shared_interactive' },
    ] as const
    for (const scene of cases) {
      const assembler = recordingAssembler()
      const core = makeCore({
        targetClass: scene.targetClass,
        executionContext: scene.executionContext,
        assemble: assembler.assemble,
        mintRunId: () => scene.runId,
      })

      const started = await core.execute({})

      expect(started.runId, scene.runId).toBe(scene.runId)
      expect(assembler.calls, scene.runId).toHaveLength(1)
      // The context the door carried is still the one the run records.
      expect(assembler.calls[0]!.executionContext).toBe(scene.executionContext)
      expect(recordedEvents(scene.runId)[0]?.type).toBe('runStarted')
      // No run-start decision was recorded, because none was taken.
      expect(
        recordedAuditRows(scene.runId).filter((row) => row.action === RETIRED_RUN_START_ACTION),
      ).toEqual([])
    }
  })

  it('C432-PRODUCTION-BEFORE-EFFECTS: a production run in the same contexts refuses before the audit sink, ports and assembly', async () => {
    for (const executionContext of ['ci', 'local-headless', 'local-interactive'] as const) {
      const assembler = recordingAssembler()
      const sessions: RunSession[] = []
      const runId = `run_production_${executionContext.replace('-', '_')}`
      const core = createRunInvocationCore({
        configPath: join(projectDir, 'agent-qa.config.yaml'),
        agentQaRoot: agentQaRoot(),
        executionContext,
        mintRunId: () => runId,
        isMintedRunId: FIXTURE_MINTED_RUN_ID,
        resolveTargetDeclaration: () => ({
          targetClass: 'production',
          targetNames: ['prod-eu'],
          productionTargetNames: ['prod-eu'],
        }),
        assembleRun: assembler.assemble,
        onSession: (session) => sessions.push(session),
      })

      const refusal = await core.execute({}).catch((error: unknown) => error)

      expect(refusal).toBeInstanceOf(RunDeniedError)
      expect((refusal as RunDeniedError).reason).toContain('"prod-eu"')
      expect((refusal as RunDeniedError).reason).toContain('allowProduction: true')
      expect(assembler.calls).toHaveLength(0)
      expect(sessions).toHaveLength(0)
      expect(existsSync(join(agentQaRoot(), 'runs', runId))).toBe(false)
    }
  })
})

// RE-SPELLED 2026-09-30 (432-13, D-14/D-15) from 'the invocation core — the deny leg (D-16
// criterion 3, at the unit)'. Each former denial cell keeps its fixture and now proves the run
// STARTS; the allow-controls (trust, credential, answered confirm) and the prompted-denial cell have
// nothing left to control and are folded into C432-PRODUCTION-BEFORE-EFFECTS above (every
// non-production class starts in every context). 'the descriptor the ONE evaluate() builds carries
// a disclosure naming the target' lost its consumer with the confirm port; the disclosure recipe's
// own content stays pinned in `run-risk.test.ts`.
describe('the invocation core — the former deny leg starts (432-13)', () => {
  it('starts a shared target in a non-interactive context, with no row and no remedies', async () => {
    const assembler = recordingAssembler()
    const sessions: RunSession[] = []
    const core = makeCore({
      targetClass: 'shared',
      assemble: assembler.assemble,
      onSession: (session) => sessions.push(session),
    })

    const started = await core.execute({})

    expect(recordedAuditRows(String(started.runId))).toEqual([])
    expect(assembler.calls).toHaveLength(1)
    expect(recordedEvents(String(started.runId))[0]?.type).toBe('runStarted')
    expect(sessions).toHaveLength(1)
  })

  it('starts an UNDECLARED target too — undeclared is not production (D-18)', async () => {
    const assembler = recordingAssembler()
    const core = makeCore({ targetClass: undefined, assemble: assembler.assemble })

    const started = await core.execute({})

    expect(assembler.calls).toHaveLength(1)
    expect(recordedEvents(String(started.runId))[0]?.type).toBe('runStarted')
  })

  it('the source asks nobody: no evaluate, confirm, trust or reader member remains', () => {
    const code = stripComments(readFileSync(CORE_SOURCE_PATH, 'utf8'))
    expect(code).not.toMatch(/\bevaluate\s*\(/)
    expect(code).not.toMatch(/options\.(confirm|trust|reader)\b/)
    expect(code).not.toMatch(/readonly (confirm|trust|reader)\?/)
    // Non-vacuity: the stripped file still holds the core.
    expect(code).toContain('export function createRunInvocationCore(')
  })
})

describe('the invocation core — the refused request fields (D-07 / Pitfall 7)', () => {
  it.each(['scope', 'executionContext'] as const)(
    'refuses a request-supplied %s before anything else happens',
    async (field) => {
      const assembler = recordingAssembler()
      const core = makeCore({ targetClass: 'local', assemble: assembler.assemble })

      const refusal = await core
        .execute(
          field === 'scope'
            ? { scope: { tier: 'product', key: 'other-product' } }
            : { executionContext: 'local-interactive' },
        )
        .catch((error: unknown) => error)

      expect(refusal).toBeInstanceOf(RunRequestFieldRefusedError)
      expect((refusal as RunRequestFieldRefusedError).refusedFields).toEqual([field])
      // The refusal precedes the gate, so nothing was classified, nothing was assembled, and no
      // run id exists for a caller to ask about later.
      expect(assembler.calls).toHaveLength(0)
      expect(recordedAuditRows('run_minted_by_the_core')).toHaveLength(0)
    },
  )

  it('a request-supplied executionContext can NEVER become the gate context (T-401-06)', async () => {
    const assembler = recordingAssembler()
    // The composition says `ci` — the fail-closed side. The request claims the interactive side,
    // which is the elevation this refusal exists to make unreachable.
    const core = makeCore({
      targetClass: 'shared',
      executionContext: 'ci',
      assemble: assembler.assemble,
    })

    const refusal = await core
      .execute({ executionContext: 'local-interactive' })
      .catch((error: unknown) => error)

    expect(refusal).toBeInstanceOf(RunRequestFieldRefusedError)
    expect(refusal).not.toBeInstanceOf(RunDeniedError)
    expect(assembler.calls).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------------------------
// The hygiene census (plan 03, Task 3).
//
// The cells above measure BEHAVIOUR. These measure the properties behaviour cannot show on its own:
// that the file calls no gate at all (432-13; it used to call exactly one), and that it never
// reaches for ambient process state. Both are claims about the SOURCE, so both are asserted against
// the source — and each scan is self-checked against its own known members first, because a census
// whose predicate cannot see the thing it forbids is green at rest.

/**
 * Drop block and line comments so a name that appears only in prose is never read as code.
 *
 * THIS IS THE LOAD-BEARING HALF, not a nicety. The core's header explains at length that it does
 * NOT call `resolveRunExecutionContext` or `getActiveExecutionContext` — so those names are in the
 * file, in comments, and a raw substring scan would report the file as an offender forever (or,
 * worse, be "fixed" by deleting the explanation). The `[^:]` guard keeps a protocol-relative URL
 * from being mistaken for a line comment, which is how this kind of stripper usually eats a file.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/**
 * The ambient-context family, as a COMPLETE SET rather than as the one name somebody remembered.
 *
 * Every member is a shipped export that answers "what is the ambient state of this process?" —
 * `safety`'s two active-resolver pairs, `safety-local`'s detector, and the run composition's own
 * wrapper around it. D-07 makes all of them wrong here for one reason: the core answers to a DOOR,
 * and a door's posture is not a property of the machine it runs on.
 */
const AMBIENT_RESOLVERS = [
  'resolveRunExecutionContext',
  'detectExecutionContext',
  'getActiveExecutionContext',
  'setActiveExecutionContextResolver',
  'getActiveAuditSink',
  'setActiveAuditSinkResolver',
  'runSafetyScope',
  'AsyncLocalStorage',
] as const

const CORE_SOURCE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'run-invocation-core.ts',
)

describe('the core hygiene census (D-02 / D-07, pinned to the core file)', () => {
  it('the scanner sees what it forbids — the predicate self-check, before any verdict about the core', () => {
    // (i) each member of the complete set is detected in code…
    for (const resolver of AMBIENT_RESOLVERS) {
      const planted = `import { ${resolver} } from '@vostride/agent-qa-safety'\nconst ctx = ${resolver}()\n`
      expect(
        stripComments(planted).includes(resolver),
        `the scan cannot see ${resolver} — it would pass the core vacuously`,
      ).toBe(true)
    }
    // (ii) …and NOT in prose, which is the case the core file actually presents.
    expect(stripComments('// this file never calls getActiveExecutionContext\n')).not.toContain(
      'getActiveExecutionContext',
    )
    expect(stripComments('/* no resolveRunExecutionContext here */\nconst x = 1\n')).not.toContain(
      'resolveRunExecutionContext',
    )
    // (iii) and the stripper does not eat code it should keep.
    expect(stripComments("const url = 'https://example.com' // trailing\n")).toContain(
      "https://example.com",
    )
  })

  it('the core reads NO ambient context — and its comments prove the scan is not vacuous', () => {
    const raw = readFileSync(CORE_SOURCE_PATH, 'utf8')
    const code = stripComments(raw)

    // The non-vacuity witness, and it is the file itself: the header NAMES two members of the
    // family while explaining why it does not call them. If the scan were a raw substring test it
    // would fire here; if the stripper were broken the next assertion could not pass.
    expect(raw).toContain('resolveRunExecutionContext')
    expect(raw).toContain('getActiveExecutionContext')

    for (const resolver of AMBIENT_RESOLVERS) {
      expect(code, `${resolver} is reachable from the core's CODE (D-07)`).not.toContain(resolver)
    }
  })

  // RE-SPELLED 2026-09-30 (432-13, D-03) from 'exactly ONE evaluate() call-site lives in the core'.
  // The call-site and its pin entry left together; the build refuses the file acquiring it again.
  it('C432-PRODUCTION-BEFORE-EFFECTS: NO evaluate() call-site lives in the core, and the pin no longer names it', () => {
    const code = stripComments(readFileSync(CORE_SOURCE_PATH, 'utf8'))
    expect(code.match(/\bevaluate\s*\(/g) ?? []).toEqual([])
    expect(code).not.toContain('@vostride/agent-qa-safety\'\nimport { evaluate')

    // Read as TEXT rather than imported, because agent-local does not depend on the arch package.
    const pin = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'arch', 'src', 'lint', 'evaluate-pin.ts'),
      'utf8',
    )
    expect(pin).not.toContain("'packages/agent-local/src/composition/run-invocation-core.ts':")
    // 2026-10-01 (432-19, D-15): the gate pin itself is deleted; the file keeps only the shared
    // scanner the startRun pin reads with, and names no permitted acquisition at all.
    expect(pin).not.toMatch(/export const EVALUATE_PIN\b/)
    expect(pin).toContain('export function parseModuleStatements')
  })

  // RE-SPELLED 2026-09-30 (432-13): '... above the audit sink, the ONE evaluate() and assembly'. There
  // is no evaluate() to sit above; the refusal still precedes the sink, the ports and assembly.
  it('the production refusal sits above the audit sink and assembly (432-03, D-18)', () => {
    const code = stripComments(readFileSync(CORE_SOURCE_PATH, 'utf8'))
    const execute = code.slice(code.indexOf('async execute(request: RunsStartInput)'))
    const refusal = execute.indexOf('refuseProductionWithoutOptIn(runId, declaration)')
    // Non-vacuity: the call is in the execute body, once.
    expect(refusal).toBeGreaterThan(0)
    expect(execute.split('refuseProductionWithoutOptIn(').length - 1).toBe(1)
    expect(refusal).toBeGreaterThan(execute.indexOf('options.resolveTargetDeclaration(request)'))
    expect(refusal).toBeLessThan(execute.indexOf('buildRunAuditSink('))
    expect(execute.indexOf('await evaluate(')).toBe(-1)
    expect(refusal).toBeLessThan(execute.indexOf('buildRunPorts('))
    expect(refusal).toBeLessThan(execute.indexOf('options.assembleRun('))
  })

  // RE-SPELLED 2026-09-30 (432-13) from 'the gate has already decided by the time assembly is
  // reached (the ordering, from inside)'. Nothing decides a non-production run, so the assembler
  // finds no decision row: the run's audit trail is empty when assembly is reached.
  it('nothing has been decided or recorded by the time assembly is reached (the ordering, from inside)', async () => {
    let rowsVisibleToAssembly: Array<Record<string, unknown>> = []
    const inner = recordingAssembler()
    const core = makeCore({
      targetClass: 'local',
      mintRunId: () => 'run_ordering_probe',
      assemble: (context) => {
        rowsVisibleToAssembly = recordedAuditRows('run_ordering_probe')
        return inner.assemble(context)
      },
    })

    await core.execute({})

    expect(rowsVisibleToAssembly).toEqual([])
    // Non-vacuity: assembly really was reached.
    expect(inner.calls).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------------------------
// THE IDENTITY STEP (2026-08-23, plan 20 · CR-04).
//
// THE RED BASELINE, measured on real artifacts through the shipped fn door before a line changed,
// and recorded here rather than paraphrased. Two `runs.start` calls naming the SAME id:
//
//   victim BEFORE  events.jsonl b2957897f4ab4d2d bytes=2111 lines=7
//                  handoff.json e0554efee1793bcb bytes=2127
//                  execution_audit.jsonl 84540238fb09b9e3 bytes=270 lines=1
//   victim AFTER   events.jsonl 1c007db24ed9a09b bytes=4221 lines=14   ← APPENDED
//                  handoff.json bc93c2fc8320f59c bytes=2127            ← OVERWRITTEN
//                  execution_audit.jsonl a7ae81b3df13d68d bytes=540 lines=2
//
// …and the acknowledgment came back naming the victim's own id with `buildOrdinal: 2`. The same
// probe found `runId: '../../escape'` acknowledged (run dir `escape`) and `runId: ''` running a
// whole run into a shared `runs/default/` before the op reported `RunNotRecordedError`.
//
// WHY THE ABSENCES BELOW ARE THE CORRECT EVIDENCE, and not the never-got-there failure mode 401-12
// shipped. Every other denial in this file asserts a `run:start` audit row EXISTS with a non-empty
// `riskTier` before believing its verdict, because a deny and a never-reached are otherwise the
// same empty directory. These refusals are DIFFERENT BY DESIGN: they land above the gate, so there
// is no row to read and the absence of one is the claim. What discriminates them from a broken
// harness is the paired control immediately below each — one field different, the run proceeds,
// and the row the refusal cells say is absent is the row the control reads back.
describe('the invocation core — the identity step refuses before anything (CR-04)', () => {
  it('REFUSES an id this system would not have minted, by name, having written nothing', async () => {
    const assembler = recordingAssembler()
    const core = makeCore({ targetClass: 'local', assemble: assembler.assemble })

    await expect(core.execute({ runId: 'not-a-minted-id' as never })).rejects.toThrow(
      RunIdNotMintedError,
    )

    // Nothing was minted, read or written: no run directory at all, so no audit row, no events.
    expect(existsSync(join(agentQaRoot(), 'runs'))).toBe(false)
    expect(assembler.calls).toEqual([])
  })

  it('THE CONTROL — one field different (a minted id) and the same request runs', async () => {
    const assembler = recordingAssembler()
    const core = makeCore({ targetClass: 'local', assemble: assembler.assemble })

    const started = await core.execute({ runId: 'run_a_minted_shape' as never })

    expect(started.runId).toBe('run_a_minted_shape')
    expect(assembler.calls).toHaveLength(1)
    // The run directory the refusal cell above says is ABSENT is the one this run wrote — which is
    // what makes that absence a decision rather than a harness that never arrived. (432-13: read
    // off the run's own events, since no run-start decision row is written any more.)
    expect(recordedEvents('run_a_minted_shape')[0]?.type).toBe('runStarted')
  })

  it('the predicate is ASKED about the caller-named id, and only about that one', async () => {
    const asked: string[] = []
    const core = makeCore({
      targetClass: 'local',
      isMintedRunId: (value) => { asked.push(value); return true },
      mintRunId: () => 'run_the_core_minted_it',
    })

    await core.execute({})
    // A minted id is the system's own; asking a caller's predicate about it would be the core
    // second-guessing the mint it was handed.
    expect(asked).toEqual([])

    await core.execute({ runId: 'run_the_caller_named_it' as never })
    expect(asked).toEqual(['run_the_caller_named_it'])
  })

  it('REFUSES an id that already names a run, and the victim is byte-identical after', async () => {
    const victimId = 'run_the_victim'
    const core = makeCore({ targetClass: 'local' })

    await core.execute({ runId: victimId as never })
    const runDir = join(agentQaRoot(), 'runs', victimId)
    const before = artifactDigests(runDir)
    // Non-vacuity: the victim really has the artifacts a collision would tamper with. (432-13: no
    // run-start decision row, so no `execution_audit.jsonl` is written for a run with no in-run
    // tool action.)
    expect(Object.keys(before).sort()).toEqual(
      expect.arrayContaining(['events.jsonl', 'handoff.json']),
    )

    const second = makeCore({ targetClass: 'local' })
    await expect(second.execute({ runId: victimId as never })).rejects.toThrow(
      RunIdAlreadyInUseError,
    )

    expect(artifactDigests(runDir)).toEqual(before)
  })

  it('the collision refusal lands ABOVE assembly — no row, no second event, no assembly', async () => {
    const victimId = 'run_the_second_victim'
    await makeCore({ targetClass: 'local' }).execute({ runId: victimId as never })

    const rowsBefore = recordedAuditRows(victimId).length
    const eventsBefore = recordedEvents(victimId).length
    expect(rowsBefore).toBe(0)
    expect(eventsBefore).toBeGreaterThan(0)

    const assembler = recordingAssembler()
    const declarations: number[] = []
    const second = createRunInvocationCore({
      configPath: join(projectDir, 'agent-qa.config.yaml'),
      agentQaRoot: agentQaRoot(),
      executionContext: 'ci',
      mintRunId: () => 'run_never_minted',
      isMintedRunId: FIXTURE_MINTED_RUN_ID,
      resolveTargetDeclaration: () => {
        declarations.push(1)
        return { targetClass: 'local', targetNames: [FAKE_TARGET_NAME], productionTargetNames: [] }
      },
      assembleRun: assembler.assemble,
    })

    await expect(second.execute({ runId: victimId as never })).rejects.toThrow(
      RunIdAlreadyInUseError,
    )

    // The refusal is above the DECLARATION resolve — so nothing between the request and the run's
    // own directory was even consulted.
    expect(declarations).toEqual([])
    expect(assembler.calls).toEqual([])
    expect(recordedAuditRows(victimId)).toHaveLength(rowsBefore)
    expect(recordedEvents(victimId)).toHaveLength(eventsBefore)
  })

  it('the MINT-YOUR-OWN path is untouched — no predicate call, no collision question', async () => {
    let collisionsAsked = 0
    const core = makeCore({
      targetClass: 'local',
      isMintedRunId: () => { collisionsAsked += 1; return true },
      mintRunId: () => 'run_minted_twice_over',
    })

    const first = await core.execute({})
    expect(first.runId).toBe('run_minted_twice_over')
    expect(collisionsAsked).toBe(0)

    // …and a MINTED id colliding with itself is not this refusal's business either: the core does
    // not police its own mint, which is the door's contract to keep. Stated so a later reader does
    // not read the collision refusal as a uniqueness guarantee over minted ids.
    const again = await core.execute({})
    expect(again.runId).toBe('run_minted_twice_over')
  })

  it('the two refusals are NAMED and distinguishable from each other and from a denial', () => {
    expect(new RunIdNotMintedError('x').name).toBe('RunIdNotMintedError')
    expect(new RunIdAlreadyInUseError('x').name).toBe('RunIdAlreadyInUseError')
    expect(new RunIdNotMintedError('x')).not.toBeInstanceOf(RunIdAlreadyInUseError)
    expect(new RunIdAlreadyInUseError('x')).not.toBeInstanceOf(RunDeniedError)
    expect(new RunIdNotMintedError('x')).not.toBeInstanceOf(RunRequestFieldRefusedError)
  })

  it('the shape predicate is REQUIRED, with no default and no fallback (source)', () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', 'run-invocation-core.ts'),
      'utf8',
    )
    // `readonly isMintedRunId:` and not `readonly isMintedRunId?:` — an optional predicate with a
    // permissive fallback is the accept-any-string defect wearing a type.
    expect(source).toContain('readonly isMintedRunId: (value: string) => boolean')
    expect(source).not.toContain('isMintedRunId?')
    expect(source).not.toMatch(/options\.isMintedRunId\s*\?\?/)
    // The compiler agrees, and it said so: dropping the option from the two fixtures in this
    // package produced, verbatim,
    //   run-invocation-core.test.ts(107,34): error TS2345: Argument of type '{ … }' is not
    //   assignable to parameter of type 'RunInvocationCoreOptions'.
    //   run-invocation-evidence.test.ts(112,34): error TS2345: … same shape …
    // — which is the half a source assertion cannot make and a type can.
  })

  it('NO defensive catch was added on the start path (D-03, re-run as a census)', () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', 'run-invocation-core.ts'),
      'utf8',
    )
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')
    expect(code).not.toMatch(/\bcatch\b/)
    expect(code).not.toMatch(/\.catch\s*\(/)
    // Non-vacuity: the stripper left the file's actual code behind.
    expect(code).toContain('refuseProductionWithoutOptIn(runId, declaration)')
  })
})
