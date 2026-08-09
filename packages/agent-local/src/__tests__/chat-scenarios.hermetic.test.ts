// THE HERMETIC LANE (Phase 392 plan 09, CHAT-02 / CHAT-03 / D-13 / D-15).
//
// Every `deterministic` scenario in the frozen corpus, driven through `composeLocalAgent()` and
// `invokeFunction` — the real registry, the real gate, the real session log on a real disk. Nothing
// here assembles a turn engine, a resolver table or a reconciler by hand, because a differential
// built from parts can pass while the composition wires them wrong or not at all (Pitfall 3).
//
// IT ITERATES THE MANIFEST, NEVER THE DIRECTORY. `SCENARIO_CORPUS` decides what runs, and a source
// assertion at the bottom of this file pins the absence of any directory walk over `scenarios/`.
// That is not stylistic: the ceiling below is a ratio, and a runner that discovered its own cells
// would let the denominator grow every time somebody wrote a file (D-15, the treadmill law).
//
// "NO MOCKS IN EITHER LANE" IS A TRUE STATEMENT HERE, AND THE MODEL IS HOW IT IS PROVED. A
// deterministic scenario never touches the LLM BY CONTRACT — so there is nothing to mock — but an
// absence cannot prove a skip: a host with no model bound could not call one however wrong its
// routing was. So every composition below binds a real `ChatLanguageModel` whose generate hook
// counts and throws, and the final assertion is that it was reached zero times across the whole
// corpus. It is a tripwire, not a stand-in for an answer.
//
// WHAT EACH EXPECTATION KIND MEANS, stated once because a runner that decided per-cell would be a
// place for a cell to quietly decay:
//
//   should_execute — the turn COMPLETED; one receipt per clause; the receipts' function ids equal
//                    `ops` in utterance order; every receipt reached its capability and came back
//                    `executed`; `receipts.length === expect.executed`; and the session log carries
//                    ZERO `mark_unhandled` rows. Plus `emitsSessionEvent` and `answerContains`
//                    where the scenario states them — for the four directives those two ARE the
//                    assertion, since a directive invokes nothing and its numbers are the numbers
//                    a turn that did nothing at all would show (392-08).
//
//   fail_closed    — NOTHING was carried out (`executed` count 0, matching `expect.executed`), the
//                    turn did not complete, and the refusal NAMES the clause. The naming is checked
//                    against `unhandled.reason` OR a failed receipt's clause, because the two
//                    fail-closed cells refuse at different depths and both are honest refusals:
//                    `near-miss-alias` never routes and leaves a `mark_unhandled` row, while
//                    `fn-unknown-op` reaches `invokeFunction` step 1, which raises
//                    `UnknownFunctionError` naming the op before any dependency is touched.
//
// THE PORTS THE OP-BOUND CELLS NEED ARE BOUND (392-02's handover note, discharged). A run executor
// and one seeded run handoff, and nothing else. Without them `run`, `quoted-conjunction` and
// `digest` refuse for a reason that has nothing to do with routing — and a corpus whose cells fail
// for fixture reasons is a corpus that teaches its readers to ignore it. D-13's "no mocks" is about
// the LLM; a composed local host with real adapters over fixture data is not a mock.
//
// ARGUMENTS ARE PINNED WHERE THE COMPOSITION CAN SEE THEM. `ClauseReceipt` carries no arguments and
// must not: D-18 keeps this log refs-and-one-liners because surfaces render it directly, and op
// input is exactly the field that could carry a secret. So the two cells whose bound argument is
// load-bearing here — `run` and the Pitfall-5 quoted span — are asserted at the run executor's own
// seam, which is where production hands them over. Every scenario's `argsPin` is additionally
// walked against the stage-1 table in `packages/agent`'s `scenario-manifest.test.ts`.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  AGENT_ASK_FUNCTION_ID,
  SCENARIO_CORPUS,
  ceilingExceeded,
  computeMarkUnhandledRate,
  invokeFunction,
  parseScenario,
  scenarioRelativePath,
} from '@vostride/agent-qa-agent'
import type { ChatLanguageModel, JobModelCapability } from '@vostride/agent-qa-agent'
import { FsEventLog, HANDOFF_FILE, RUNS_SUBDIR, slugBranch } from '@vostride/agent-qa-runner-local'
import {
  CURRENT_HANDOFF_SCHEMA_VERSION,
  FunctionScopeSchema,
  MASKED_RESOLVED_CONFIG_SCHEMA_VERSION,
  asRunId,
} from '@vostride/agent-qa-schema'
import type {
  AgentAskResult,
  ChatScenario,
  ChatSessionEvent,
  CompletedRunHandoff,
  FunctionCaller,
  MaskedResolvedConfig,
  RunsStartInput,
} from '@vostride/agent-qa-schema'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parse as parseYamlDocument } from 'yaml'

import { CHAT_SESSIONS_SUBDIR } from '../session/jsonl-session-log.js'
import { composeLocalAgent } from '../composition/compose-local-agent.js'
import type { LocalAgentHost, RunExecutionPort } from '../composition/compose-local-agent.js'

/**
 * The corpus lives with the package that owns the routing it characterises (D-14), and this runner
 * lives with the composition that can drive it. Asserted below rather than assumed: a path that
 * moved would leave the walk scanning nothing and agreeing with an empty manifest forever.
 */
const SCENARIOS_ROOT = fileURLToPath(new URL('../../../agent/src/chat/scenarios/', import.meta.url))

/** The run the `digest` cell names. Seeded so that cell measures routing rather than a missing run. */
const SEEDED_RUN_ID = 'RUN-1'

const MASKED_CONFIG: MaskedResolvedConfig = {
  schemaVersion: MASKED_RESOLVED_CONFIG_SCHEMA_VERSION,
  configPath: '/fixture/agent-qa.config.yaml',
  entries: [],
}

/** A person holding every scope, so a refusal below can only ever be the axis under test. */
const HUMAN: FunctionCaller = {
  surface: 'test',
  grantedScopes: [...FunctionScopeSchema.options],
  safeMode: false,
  origin: 'human',
}

const JOB_MODEL: JobModelCapability = {
  modelId: 'fixture:hermetic-scenarios',
  generate: () => Promise.resolve({ text: 'unused' }),
}

const MINT_IDENTITY = (filePath: string): string => filePath

const HERMETIC_CORPUS = SCENARIO_CORPUS.filter((entry) => entry.lane === 'hermetic')

/** The ceiling's denominator: `should_execute` cells in the FROZEN manifest (D-15). */
const HERMETIC_DENOMINATOR = HERMETIC_CORPUS.filter((entry) => entry.kind === 'should_execute').length

function readScenario(entry: (typeof SCENARIO_CORPUS)[number]): ChatScenario {
  const path = join(SCENARIOS_ROOT, scenarioRelativePath(entry))
  return parseScenario(parseYamlDocument(readFileSync(path, 'utf8')), entry)
}

/** A model that FAILS the turn if it is ever reached, and counts the attempt either way. */
function plannerTripwire(): { model: ChatLanguageModel; calls: () => number } {
  let calls = 0
  const reached = (): never => {
    calls += 1
    throw new Error('a deterministic-class scenario consulted the planner')
  }
  const model = {
    specificationVersion: 'v3',
    provider: 'fixture',
    modelId: 'fixture:never-called',
    supportedUrls: {},
    doGenerate: reached,
    doStream: reached,
  } as unknown as ChatLanguageModel
  return { model, calls: () => calls }
}

function seedRun(agentQaRoot: string, runId: string): void {
  const runDir = join(agentQaRoot, RUNS_SUBDIR, slugBranch(runId))
  mkdirSync(runDir, { recursive: true })
  const handoff = {
    schemaVersion: CURRENT_HANDOFF_SCHEMA_VERSION,
    runId: asRunId(runId),
    scope: { tier: 'product', key: 'chat-scenarios' },
    buildOrdinal: 1,
    executionContext: 'local-headless',
    aggregateVerdict: 'passed',
    configDigests: { suiteConfigDigest: 'suite-digest', testConfigDigest: 'test-digest' },
    startedAt: 1,
    endedAt: 2,
    tests: [
      {
        testId: 'TST-42',
        testName: 'checks out',
        filePath: 'tests/checkout.spec.ts',
        testIndex: 0,
        outcome: 'passed',
        steps: [],
      },
    ],
  } as unknown as CompletedRunHandoff
  writeFileSync(join(runDir, HANDOFF_FILE), `${JSON.stringify(handoff)}\n`, 'utf8')
}

interface Cell {
  readonly result: AgentAskResult
  readonly events: readonly ChatSessionEvent[]
  readonly startedRuns: readonly RunsStartInput[]
  readonly plannerCalls: number
}

describe('the hermetic lane: the frozen deterministic corpus over the real composition', () => {
  let root: string
  let agentQaRoot: string
  const hosts: LocalAgentHost[] = []
  /** What actually ran, keyed by scenario id — the ceiling below reads this and nothing else. */
  const cells = new Map<string, Cell>()

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'chat-scenarios-'))
    agentQaRoot = join(root, '.agent-qa')
    mkdirSync(agentQaRoot, { recursive: true })
    seedRun(agentQaRoot, SEEDED_RUN_ID)
  })

  afterEach(() => {
    for (const composed of hosts.splice(0)) void composed.close()
    rmSync(root, { recursive: true, force: true })
  })

  async function runCell(scenario: ChatScenario): Promise<Cell> {
    const tripwire = plannerTripwire()
    const startedRuns: RunsStartInput[] = []
    // A FAITHFUL executor, not a stub that returns a plausible id. The composition reads the run's
    // own durable event log back and refuses a host that reported a run without producing one
    // (`RunProducedNoEventsError`) — which is the composition contributing the half a host must not
    // be trusted with. So the fixture does what a real executor does: it writes the run's first
    // event, under the id of the run this project already has.
    const runExecution: RunExecutionPort = {
      execute(request) {
        startedRuns.push(request)
        new FsEventLog({ root: agentQaRoot, runId: SEEDED_RUN_ID }).append({
          seq: 1,
          ts: 1,
          runId: SEEDED_RUN_ID,
          type: 'runStarted',
          payload: {},
        } as never)
        return Promise.resolve({ runId: asRunId(SEEDED_RUN_ID) })
      },
    }
    const host = composeLocalAgent({
      mintQuarantineIdentityPath: MINT_IDENTITY,
      agentQaRoot,
      config: { getMasked: () => Promise.resolve(MASKED_CONFIG) },
      knowledgeRoot: () => join(root, 'agent-qa-knowledge'),
      model: () => JOB_MODEL,
      runExecution,
      chatModel: tripwire.model,
    })
    hosts.push(host)

    const result = (await invokeFunction(
      host.registry,
      AGENT_ASK_FUNCTION_ID,
      { message: scenario.utterance },
      HUMAN,
    )) as AgentAskResult

    const events = readFileSync(
      join(agentQaRoot, CHAT_SESSIONS_SUBDIR, `${result.sessionId}.jsonl`),
      'utf8',
    )
      .split('\n')
      .filter((line) => line !== '')
      .slice(1)
      .map((line) => JSON.parse(line) as ChatSessionEvent)

    const cell: Cell = { result, events, startedRuns, plannerCalls: tripwire.calls() }
    cells.set(scenario.id, cell)
    return cell
  }

  it('walks a real corpus rather than an empty one', () => {
    // Every assertion below is `it.each` over the manifest, and an empty manifest would make the
    // whole file green while measuring nothing.
    expect(HERMETIC_CORPUS.length).toBe(13)
    expect(HERMETIC_DENOMINATOR).toBeGreaterThan(0)
  })

  it.each(HERMETIC_CORPUS.map((entry) => [entry.id, entry] as const))(
    'deterministic/%s routes as its file says',
    async (_id, entry) => {
      const scenario = readScenario(entry)
      const cell = await runCell(scenario)
      const { result } = cell
      const executed = result.receipts.filter((receipt) => receipt.status === 'executed')

      if (scenario.expect.kind === 'should_execute') {
        expect(result.status).toBe('completed')
        expect(result.receipts.map((receipt) => receipt.functionId)).toEqual(
          scenario.expect.ops ?? [],
        )
        // Every clause that was dispatched reached its capability and came back. A cell tolerating
        // a `failed` receipt would go green while the op it names refuses.
        expect(result.receipts.map((receipt) => receipt.status)).toEqual(
          result.receipts.map(() => 'executed'),
        )
        expect(executed).toHaveLength(scenario.expect.executed)
        // A `should_execute` turn that left a refusal row is the decay the ceiling exists to catch.
        expect(cell.events.filter((event) => event.kind === 'mark_unhandled')).toHaveLength(0)
      } else {
        // D-10's atomicity: NOTHING was carried out, whatever depth the refusal came from.
        expect(result.status).not.toBe('completed')
        expect(executed).toHaveLength(0)
        expect(executed).toHaveLength(scenario.expect.executed)
        const named = scenario.expect.namesClause
        expect(named, 'a fail_closed scenario must name what it refused (D-08)').toBeTruthy()
        const namings = [
          result.unhandled?.reason ?? '',
          result.unhandled?.clause ?? '',
          ...result.receipts.map((receipt) => receipt.clause),
        ]
        expect(namings.some((text) => text.includes(named ?? ''))).toBe(true)
      }

      if (scenario.expect.emitsSessionEvent !== undefined) {
        expect(cell.events.map((event) => event.kind)).toContain(scenario.expect.emitsSessionEvent)
      }
      if (scenario.expect.answerContains !== undefined) {
        expect(result.answer ?? '').toContain(scenario.expect.answerContains)
      }

      // THE STRONG FORM OF "NO LLM IN THIS LANE", and it applies to the arm that claims it: a
      // `should_execute` deterministic cell is entirely table-resolvable BY CONTRACT, so a model
      // was bound and must have gone untouched. A `fail_closed` cell whose clause the table does
      // not know legitimately flows onward to stage 2 — and what it proves instead is the stronger
      // fact: even with a planner present and unable to help, an unroutable clause becomes a named
      // refusal rather than an invocation.
      if (scenario.expect.kind === 'should_execute') expect(cell.plannerCalls).toBe(0)
    },
  )

  it('binds the run executor the arguments actually cross, quoted span intact (Pitfall 5)', () => {
    // `ClauseReceipt` carries no arguments by design (D-18), so this is the one seam in the
    // composed path where a bound argument is observable — and it is the seam production uses.
    expect(cells.get('run')?.startedRuns).toEqual([{ patterns: ['tests/checkout.spec.ts'] }])
    // The Pitfall-5 claim, end to end: ONE clause, one start, and the quoted conjunction survives
    // into the bound argument rather than being torn into a phantom second clause.
    expect(cells.get('quoted-conjunction')?.startedRuns).toEqual([
      { patterns: ['"add and remove items"'] },
    ])
  })

  it('measures the mark_unhandled rate over the FROZEN manifest and holds the ceiling', () => {
    // The denominator is the manifest's `should_execute` count. Guarded first: a run in which some
    // cells threw before recording would produce a smaller tally and a vacuously green ceiling.
    const measured = HERMETIC_CORPUS.filter((entry) => entry.kind === 'should_execute')
    expect(measured.every((entry) => cells.has(entry.id))).toBe(true)

    const refusals = measured.flatMap((entry) => cells.get(entry.id)?.events ?? [])
    const counts = computeMarkUnhandledRate(refusals, HERMETIC_DENOMINATOR)

    expect(counts.denominator).toBe(HERMETIC_DENOMINATOR)
    // THE GATE FIRST, so a control that breaks routing reds the gate rather than short-circuiting
    // on the stricter line below and leaving the gate itself unexercised.
    expect(ceilingExceeded(counts)).toBe(false)
    // Then the stronger claim this lane can make: these cells never touch a model, so an unhandled
    // clause here is a routing defect and not a model having a bad day. Note the two are not the
    // same threshold — 1/5 over an eleven-cell denominator tolerates two misses, and this line is
    // what actually holds the hermetic lane to none.
    expect(counts.unhandledCount).toBe(0)
  })
})

describe('the runner cannot discover its own cells (D-15, source assertion)', () => {
  it('reaches the corpus only through the manifest — no directory walk over scenarios/', () => {
    const source = readFileSync(fileURLToPath(import.meta.url), 'utf8')
    // Structure, not vocabulary: the prose above says "directory walk" repeatedly and must be free
    // to. What is pinned is that no reader API is CALLED against the scenarios tree.
    expect(source).not.toMatch(/readdirSync\s*\(/)
    expect(source).not.toMatch(/globSync\s*\(/)
    expect(source).toMatch(/SCENARIO_CORPUS\.filter/)
  })
})
