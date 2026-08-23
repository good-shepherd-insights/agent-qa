// The in-process invocation core, driven through its production factory (Phase 401 plan 03, D-02).
//
// WHAT THIS FILE MEASURES, and what it deliberately does not. The core's job is an ORDER —
// refuse, identify, classify, gate, assemble, start, await — so every cell here is about the order
// or about what the order lets through. The member EXECUTOR is a double, because a real one needs a
// browser and a model; everything else is the shipped path: the real `createRunInvocationCore`, the
// real `evaluate()`, the real `startRun`, the real `FsEventLog`/`FsHandoffStore` under a real
// `<configDir>/.agent-qa` root, and a real `JsonlAuditSink` reading back off disk.
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

import type { ExecutionAuditRow } from '@vostride/agent-qa-safety'
import type { RunEventEnvelope, RunSession, TrustCredential } from '@vostride/agent-qa-schema'

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
import { RUN_START_RISK_ACTION_NAME } from '../run-risk.js'
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
  trustMode?: boolean
  credential?: TrustCredential
  confirm?: (action: { name: string; disclosure?: string }) => Promise<boolean>
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
    }),
    assembleRun: input.assemble ?? recordingAssembler().assemble,
    ...(input.trustMode === undefined && input.credential === undefined
      ? {}
      : {
          trust: {
            ...(input.trustMode === undefined ? {} : { trustMode: input.trustMode }),
            ...(input.credential === undefined ? {} : { credential: input.credential }),
          },
        }),
    ...(input.confirm === undefined
      ? {}
      : {
          confirm: {
            // A TERMINAL double, declared (G-401-17): every scene in this suite is a CLI run, and
            // the browser's own scene is measured in a real browser rather than mimed here.
            surface: 'tty-prompt',
            ask: input.confirm,
          } as Parameters<typeof createRunInvocationCore>[0]['confirm'],
        }),
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

/** Every execution-audit row the run dir holds, parsed off the jsonl the gate really wrote. */
function recordedAuditRows(runId: string): ExecutionAuditRow[] {
  const slug = runId.replaceAll('/', '-')
  const path = join(agentQaRoot(), 'runs', slug, 'execution_audit.jsonl')
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as ExecutionAuditRow)
}

describe('the invocation core — the allow leg, end to end (D-02)', () => {
  it('runs a local-declared target through gate → assembly → startRun → handoff, under the production root', async () => {
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

    // ONE gate row, on the core-level action, allowed. `mutating-local` allows in EVERY context —
    // this cell runs in `ci` on purpose, because that is the D-05 guarantee CI depends on.
    const rows = recordedAuditRows(String(started.runId))
    expect(rows.filter((row) => row.action === RUN_START_RISK_ACTION_NAME)).toHaveLength(1)
    expect(rows.find((row) => row.action === RUN_START_RISK_ACTION_NAME)?.outcome).toBe('proceeded')
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

describe('the invocation core — the deny leg (D-16 criterion 3, at the unit)', () => {
  it('fails closed for a shared target in a non-interactive context and starts NOTHING', async () => {
    const assembler = recordingAssembler()
    const sessions: RunSession[] = []
    const core = makeCore({
      targetClass: 'shared',
      assemble: assembler.assemble,
      onSession: (session) => sessions.push(session),
    })

    const denial = await core.execute({}).catch((error: unknown) => error)

    expect(denial).toBeInstanceOf(RunDeniedError)
    const denied = denial as RunDeniedError

    // (a) the audit row — the assertion this cell turns on. `outcome` is a field of the record the
    // gate writes on EVERY decision; a message substring is what a stub can also produce.
    const rows = recordedAuditRows(denied.runId)
    expect(rows.map((row) => row.outcome)).toEqual(['fail-closed-denied'])
    expect(rows[0].action).toBe(RUN_START_RISK_ACTION_NAME)
    expect(rows[0].riskTier).toBe('mutating-shared')

    // (b) NO ASSEMBLY. The probe, the build-ordinal advance and the quarantine fold all live behind
    // this port, so a call count of zero is the whole "no side effects" claim in one number.
    expect(assembler.calls).toHaveLength(0)

    // (c) no run, by the same reader the composition's evidence check uses.
    expect(recordedEvents(denied.runId)).toHaveLength(0)
    expect(sessions).toHaveLength(0)

    // (d) the structured remedies a door renders — never a sentence this core composed.
    expect(denied.remedies.map((remedy) => remedy.kind)).toEqual([
      'answer-confirm',
      'trust-session-flag',
    ])
    expect(denied.neutralReason).not.toContain('--trust-session')
  })

  it('fails closed for an UNDECLARED target too — silence is not permission (D-06)', async () => {
    const assembler = recordingAssembler()
    const core = makeCore({ targetClass: undefined, assemble: assembler.assemble })

    const denial = (await core.execute({}).catch((error: unknown) => error)) as RunDeniedError

    expect(denial).toBeInstanceOf(RunDeniedError)
    expect(recordedAuditRows(denial.runId).map((row) => row.outcome)).toEqual([
      'fail-closed-denied',
    ])
    expect(assembler.calls).toHaveLength(0)
  })

  it('the allow-controls on the same door: trust mode, a scoped credential, and an answered confirm', async () => {
    for (const control of ['trust-mode', 'credential', 'confirm'] as const) {
      const assembler = recordingAssembler()
      const core = makeCore({
        targetClass: 'shared',
        assemble: assembler.assemble,
        mintRunId: () => `run_${control}`,
        ...(control === 'trust-mode' ? { trustMode: true } : {}),
        ...(control === 'credential'
          ? { credential: { scope: { project: 'local-workspace' } } as TrustCredential }
          : {}),
        ...(control === 'confirm'
          ? { executionContext: 'local-interactive' as const, confirm: async () => true }
          : {}),
      })

      const started = await core.execute({})

      expect(assembler.calls, `${control} should have reached assembly`).toHaveLength(1)
      expect(recordedAuditRows(String(started.runId))[0].verdict).toBe('allow')
      expect(recordedEvents(String(started.runId))[0].type).toBe('runStarted')
    }
  })

  it('an interactive confirm that says NO denies, and still starts nothing', async () => {
    const assembler = recordingAssembler()
    const core = makeCore({
      targetClass: 'shared',
      executionContext: 'local-interactive',
      confirm: async () => false,
      assemble: assembler.assemble,
    })

    const denial = (await core.execute({}).catch((error: unknown) => error)) as RunDeniedError

    expect(denial).toBeInstanceOf(RunDeniedError)
    expect(recordedAuditRows(denial.runId).map((row) => row.outcome)).toEqual(['prompted-denied'])
    expect(assembler.calls).toHaveLength(0)
    expect(recordedEvents(denial.runId)).toHaveLength(0)
  })

  it('the descriptor the ONE evaluate() builds carries a disclosure naming the target (401-14, W-1)', async () => {
    // THE PARAMETER USED TO BE DEAD. `buildRunRiskDescriptor(targetClass, disclosure?)` had exactly
    // one production call-site — the core's — and it passed one argument, so `disclosure` was
    // `undefined` on every run:start any surface ever raised. This cell reads the descriptor off
    // the CONFIRM PORT, which is the same object the gate hands a person's door (`gate.ts` calls
    // `confirm.ask(action)`), so it measures what a browser's frame is built from rather than what a
    // helper returns when a cell calls it directly.
    const asked: { name: string; disclosure?: string }[] = []
    const core = makeCore({
      targetClass: 'shared',
      targetNames: [FAKE_TARGET_NAME, 'a-second-target'],
      executionContext: 'local-interactive',
      confirm: async (action) => { asked.push(action); return true },
    })

    await core.execute({})

    expect(asked).toHaveLength(1)
    const disclosure = asked[0]!.disclosure
    expect(disclosure, 'the gate was asked with no disclosure — approve WHAT?').toBeTruthy()
    // EVERY declared name, not just the first: a run whose second member drives something else is
    // exactly the run a person needs the whole list for (the same fold-over-all-members reasoning
    // 401-12 applied to the CLASS, reaching the sentence the class is explained in).
    expect(disclosure).toContain(FAKE_TARGET_NAME)
    expect(disclosure).toContain('a-second-target')
    // And the class the gate decided under, in the sentence the person reads.
    expect(disclosure).toContain('shared')
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
// The three cells above measure BEHAVIOUR. These measure the two properties behaviour cannot show
// on its own: that the gate is called from exactly ONE place in this file, and that the file never
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
 * `safety`'s three active-resolver pairs, `safety-local`'s detector, and the run composition's own
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
  'getActiveMaskingContext',
  'setActiveMaskingContextResolver',
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

  it('exactly ONE evaluate() call-site lives in the core', () => {
    const code = stripComments(readFileSync(CORE_SOURCE_PATH, 'utf8'))
    const calls = code.match(/\bevaluate\s*\(/g) ?? []
    expect(calls).toHaveLength(1)

    // The count is a property of this file; WHICH files may hold gate power at all is a property of
    // the workspace, and the build already enforces it. Asserted here so removing the pin entry
    // fails the core's own suite as well as `validate:arch` — read as TEXT rather than imported,
    // because agent-local does not depend on the arch package and must not start.
    const pin = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'arch', 'src', 'lint', 'evaluate-pin.ts'),
      'utf8',
    )
    expect(pin).toContain("'packages/agent-local/src/composition/run-invocation-core.ts':")
  })

  it('the gate has already decided by the time assembly is reached (the ordering, from inside)', async () => {
    // The deny cells prove assembly is NOT reached. This proves the converse leg: when it IS
    // reached, the decision is already made and already recorded — so nothing assembly does (the
    // probe, the ordinal advance) can precede the verdict. The assembler reads the run's audit
    // trail at the moment it is called; a gate moved below assembly would find it empty.
    let rowsVisibleToAssembly: ExecutionAuditRow[] = []
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

    expect(rowsVisibleToAssembly.map((row) => row.outcome)).toEqual(['proceeded'])
    expect(rowsVisibleToAssembly[0].action).toBe(RUN_START_RISK_ACTION_NAME)
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
    // The row the refusal cell above says is ABSENT is the row this one reads back — which is what
    // makes that absence a decision rather than a harness that never arrived.
    expect(recordedAuditRows('run_a_minted_shape').map((row) => row.action))
      .toContain(RUN_START_RISK_ACTION_NAME)
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
    // Non-vacuity: the victim really has the three artifacts a collision would tamper with.
    expect(Object.keys(before).sort()).toEqual(
      expect.arrayContaining(['events.jsonl', 'execution_audit.jsonl', 'handoff.json']),
    )

    const second = makeCore({ targetClass: 'local' })
    await expect(second.execute({ runId: victimId as never })).rejects.toThrow(
      RunIdAlreadyInUseError,
    )

    expect(artifactDigests(runDir)).toEqual(before)
  })

  it('the collision refusal lands ABOVE the gate — no second row, no second event, no assembly', async () => {
    const victimId = 'run_the_second_victim'
    await makeCore({ targetClass: 'local' }).execute({ runId: victimId as never })

    const rowsBefore = recordedAuditRows(victimId).length
    const eventsBefore = recordedEvents(victimId).length
    expect(rowsBefore).toBe(1)
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
        return { targetClass: 'local', targetNames: [FAKE_TARGET_NAME] }
      },
      assembleRun: assembler.assemble,
    })

    await expect(second.execute({ runId: victimId as never })).rejects.toThrow(
      RunIdAlreadyInUseError,
    )

    // The refusal is above the DECLARATION resolve, which is itself above the gate — so nothing
    // between the request and the run's own directory was even consulted.
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

  it('NO defensive catch was added on the gate path (D-03, re-run as a census)', () => {
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
    expect(code).toContain('const policy = await evaluate(')
  })
})
