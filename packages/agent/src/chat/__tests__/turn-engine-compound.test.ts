// Stages 3 and 4 of the turn engine, measured (Phase 392 plan 07 — D-10 / D-11 / D-18, Pitfall 1).
//
// THE PORT DOUBLES HERE ARE ENGINE-MECHANICS DOUBLES, NOT SCENARIO MOCKS. D-13's "no mocks in
// either lane" is a rule about the SCENARIO corpus: a deterministic scenario never touches the LLM
// by contract, and a planner scenario runs against a live model. This file is neither. It drives
// the engine's own wiring, so the planner seat holds a scripted port and the dispatch seat holds a
// spy — because the claims under test are "nothing was invoked", "these were invoked in this
// order" and "this caller was minted", none of which is observable through a real adapter without
// also making a real request. The resolver table, the clause splitter and the reconciliation
// strategy are the REAL shipped ones, which is what keeps the routing under test genuine.
//
// THE ZERO-INVOCATION ASSERTION IS THE FILE'S CENTRE. D-10 says reconciliation completes before the
// first side effect, and the only way to measure "before" is to count effects on a turn that got
// refused. A suite that checked the refusal MESSAGE and not the spy would pass against an engine
// that ran the first clause and then changed its mind.

import { describe, expect, it } from 'vitest'

import type {
  AgentAskInput,
  AgentAskResult,
  ChatSessionEvent,
  ChatSessionHandle,
  ChatSessionHeader,
  FunctionCaller,
  SessionLogPort,
} from '@vostride/agent-qa-schema'

import { CHAT_RESOLVER_TABLE } from '../resolver-table.js'
import { deterministicOverrideStrategy } from '../reconcile.js'
import { splitClauses } from '../clause-split.js'
import { createTurnEngine } from '../turn-engine.js'
import type { TurnEngineDeps } from '../turn-engine.js'
import { toToolName } from '../tool-names.js'
import type {
  ChatBindingStage,
  ChatDirectiveHandlers,
  ChatModelDirectiveOutcome,
  PlannerStageOutcome,
  PlannerStagePort,
  ReconcileStrategy,
} from '../ports.js'
import type { ChatConfigState } from '../config-drift.js'

const PROPOSALS_LIST = 'proposals.list'
const RUNS_LIST = 'runs.list'
const RUNS_DIGEST = 'runs.digest'

const RESOLVER_CALLER: FunctionCaller = {
  surface: 'chat',
  grantedScopes: ['read', 'run'],
  safeMode: false,
  origin: 'human',
}

const PLANNER_CALLER: FunctionCaller = {
  surface: 'chat',
  grantedScopes: ['read', 'run'],
  safeMode: false,
  origin: 'agent',
}

/** The refusal shape `invokeFunction` publishes, as a scripted stand-in with the same NAME. */
class FunctionDeniedError extends Error {
  override readonly name = 'FunctionDeniedError'
}

interface MemoryLog extends SessionLogPort {
  readonly events: ChatSessionEvent[]
  boundaries: number
  /** How many handles this log handed out, and how many came back (392-12). */
  opens: number
  closes: number
}

function memoryLog(): MemoryLog {
  const events: ChatSessionEvent[] = []
  const header: ChatSessionHeader = {
    schemaVersion: 1,
    sessionId: 'chat-test-session',
    createdAt: '1970-01-01T00:00:00.000Z',
    model: 'unbound',
    toolsetHash: 'hash-0',
  }
  // The double answers the HANDLE contract (392-12): the write verbs come back from `open()`
  // scoped to the session it opened, so a turn cannot reach a log-level append — there is none.
  const log: MemoryLog = {
    events,
    boundaries: 0,
    opens: 0,
    closes: 0,
    open(): Promise<ChatSessionHandle> {
      log.opens += 1
      return Promise.resolve({
        header,
        events: [...events],
        refusedLines: [],
        append(event: ChatSessionEvent): Promise<void> {
          events.push(event)
          return Promise.resolve()
        },
        turnBoundary(): Promise<void> {
          log.boundaries += 1
          return Promise.resolve()
        },
        close(): Promise<void> {
          log.closes += 1
          return Promise.resolve()
        },
      })
    },
  }
  return log
}

interface Invocation {
  readonly functionId: string
  readonly input: unknown
  readonly caller: FunctionCaller
}

interface Harness {
  readonly log: MemoryLog
  readonly invocations: Invocation[]
  readonly ordering: string[]
  readonly plannerCalls: number
  /** What `/pin` was actually asked to record. EMPTY is the CR-04 assertion (392-11). */
  readonly pinCalls: string[]
  /** What `/model` was actually asked to switch to. */
  readonly modelCalls: string[]
  runTurn(input: AgentAskInput): Promise<AgentAskResult>
}

interface HarnessOptions {
  readonly planned?: PlannerStageOutcome
  readonly failOn?: string
  readonly reconcile?: ReconcileStrategy
  readonly compaction?: boolean
  /**
   * Bind SPY directive handlers, plus the config thunk the `/model` event path needs.
   *
   * A directive's side effects are the pin overlay mutation, the model override and the two events
   * they produce — none of which is observable through the invoke spy, because a directive never
   * travels the function layer. So CR-04's claim ("nothing happened on a refused turn") needs its
   * own seat, and this is it.
   */
  readonly directives?: boolean
  /**
   * The `/pin` argument the spy handler REFUSES, by throwing before it records (392-14, E3).
   *
   * The composed host's holder does exactly this: `pin-overlay.ts` raises `ChatPinError` for a
   * class no registered op answers to, and the engine's catch turns that into the refusal path.
   * The fixture needs its own copy because the claim under test is about the ORDER a batch is
   * applied in, and a batch needs a second directive that says no.
   */
  readonly unpinnable?: string
}

function harness(options: HarnessOptions = {}): Harness {
  const log = memoryLog()
  const invocations: Invocation[] = []
  const ordering: string[] = []
  const pinCalls: string[] = []
  const modelCalls: string[] = []
  let plannerCalls = 0
  // The model the session is under RIGHT NOW. The `/model` handler moves it and the config thunk
  // reads it back, which is the shape production has: the handler applies the override and the
  // re-read is what the diff calls `to`. A fixed value here would emit no `model_change` at all and
  // the zero-event assertions below would be vacuous.
  let activeModel = 'unbound'

  const planner: PlannerStagePort | undefined =
    options.planned === undefined
      ? undefined
      : {
          plan: (): Promise<PlannerStageOutcome> => {
            plannerCalls += 1
            ordering.push('planner')
            return Promise.resolve(options.planned as PlannerStageOutcome)
          },
        }

  let clock = 0
  const deps: TurnEngineDeps = {
    table: CHAT_RESOLVER_TABLE,
    split: splitClauses,
    reconcile: options.reconcile ?? deterministicOverrideStrategy,
    sessionLog: log,
    mint: {
      // Session-stamped like production (392 plan 13): the gate's deny overlay is asked WHOSE pin,
      // and a fixture minting a caller with no session would exercise a caller shape the composed
      // engine never produces.
      forStage: (stage: ChatBindingStage, sessionId: string): FunctionCaller => ({
        ...(stage === 'resolver' ? RESOLVER_CALLER : PLANNER_CALLER),
        sessionId,
      }),
    },
    invoke: (functionId, input, caller) => {
      ordering.push(`invoke:${functionId}`)
      invocations.push({ functionId, input, caller })
      if (functionId === options.failOn) return Promise.reject(new FunctionDeniedError('denied'))
      return Promise.resolve({ ok: true })
    },
    ...(planner === undefined ? {} : { planner }),
    ...(options.directives === true
      ? {
          config: (): ChatConfigState => ({ model: activeModel, toolset: { hash: 'hash-0' } }),
          // A FACTORY, as the engine now asks for (392 plan 13): the handlers a turn runs belong to
          // the session running it. This harness drives one session at a time, so the factory
          // ignores the id and the spies stay the same objects — what is under test here is the
          // ORDER effects happen in, and the per-session keying has its own composed differential.
          directives: (): ChatDirectiveHandlers => ({
            // THE BATCH PRE-FLIGHT, mirroring the composition: it asks the same question `pin`
            // answers and records NOTHING, so a turn whose second directive is unpinnable is
            // refused before the first one is applied. A fixture whose validate accepted
            // everything would leave the engine's new pass unexercised on the arm it exists for.
            validate: (directive, argument): void => {
              ordering.push('directive:validate')
              if (directive === 'pin' && argument === options.unpinnable) {
                throw new Error(
                  `Cannot pin "${argument ?? ''}": "fn:${argument ?? ''}" is not an action class `
                    + 'this host declares',
                )
              }
            },
            pin: (actionClass: string): string => {
              // Throws BEFORE recording, exactly as the shipped holder does: a refused pin leaves
              // no entry, so `pinCalls` measures what was actually carried out rather than what
              // was attempted.
              if (actionClass === options.unpinnable) {
                throw new Error(
                  `Cannot pin "${actionClass}": "fn:${actionClass}" is not an action class this `
                    + 'host declares',
                )
              }
              ordering.push('directive:pin')
              pinCalls.push(actionClass)
              return actionClass
            },
            model: (name: string): ChatModelDirectiveOutcome => {
              ordering.push('directive:model')
              modelCalls.push(name)
              const from = activeModel
              activeModel = name
              return { from, to: name, line: `model: ${name}` }
            },
          }),
        }
      : {}),
    ...(options.compaction === true
      ? {
          compaction: (): void => {
            ordering.push('compaction')
          },
        }
      : {}),
    now: () => {
      clock += 1
      return `1970-01-01T00:00:0${String(clock)}.000Z`
    },
    mintTurnId: () => 'turn-fixed',
  }

  const engine = createTurnEngine(deps)
  return {
    log,
    invocations,
    ordering,
    pinCalls,
    modelCalls,
    get plannerCalls() {
      return plannerCalls
    },
    runTurn: (input) => engine.runTurn(input),
  }
}

function kindsOf(events: readonly ChatSessionEvent[]): string[] {
  return events.map((event) => event.kind)
}

describe('turn engine stage 3/4: atomicity, ordered execution, receipts, per-stage origins', () => {
  describe('D-10 — a fail-closed verdict costs the turn everything and executes nothing', () => {
    it('performs ZERO invocations when a clause is unroutable', async () => {
      const run = harness()
      const result = await run.runTurn({ message: 'proposals and write a test for two factor auth' })

      expect(result.status).toBe('fail_closed')
      // The measurement D-10 is actually about. Not "the failing clause was skipped" — the
      // clause that COULD have run did not, because the verdict preceded every effect.
      expect(run.invocations).toHaveLength(0)
      expect(result.receipts).toHaveLength(0)
      expect(result.unhandled?.clause).toBe('write a test for two factor auth')
    })

    it('appends a mark_unhandled event naming the clause (D-15/D-18)', async () => {
      const run = harness()
      await run.runTurn({ message: 'proposals and write a test for two factor auth' })

      const unhandled = run.log.events.find((event) => event.kind === 'mark_unhandled')
      expect(unhandled).toBeDefined()
      expect(unhandled).toMatchObject({
        kind: 'mark_unhandled',
        turnId: 'turn-fixed',
        clause: 'write a test for two factor auth',
      })
      // The log is the triage report: the refusal's REASON is on the line, not only in the
      // return value a caller may never persist.
      expect(unhandled?.kind === 'mark_unhandled' ? unhandled.reason : '').toContain(
        'write a test for two factor auth',
      )
    })

    it('appends a mark_unhandled event for a directive with no handler bound', async () => {
      const run = harness()
      const result = await run.runTurn({ message: '/model claude-fixture' })

      expect(result.status).toBe('fail_closed')
      expect(run.invocations).toHaveLength(0)
      const unhandled = run.log.events.find((event) => event.kind === 'mark_unhandled')
      expect(unhandled).toMatchObject({ kind: 'mark_unhandled', clause: '/model claude-fixture' })
    })

    it('refuses whole when the MODEL marked a clause unhandled, even mid-plan', async () => {
      const run = harness({
        planned: {
          toolCalls: [
            {
              toolName: 'mark_unhandled',
              input: { clause: 'file an issue for it', reason: 'no issue capability has shipped.' },
            },
          ],
        },
      })
      const result = await run.runTurn({ message: 'proposals and file an issue for it' })

      expect(result.status).toBe('fail_closed')
      expect(run.invocations).toHaveLength(0)
      expect(run.log.events.filter((event) => event.kind === 'mark_unhandled')).toHaveLength(1)
    })
  })

  // CR-04, the gap round (392-11). THE DIRECTIVE LOOP USED TO RUN BEFORE THE VERDICT, so a turn
  // whose second clause was unroutable returned `fail_closed` — with the message "nothing in the
  // request was carried out" — while the pin it named was already recorded, irrevocably, and an
  // `approval_decision` row was already on the append-only log. Every existing case in this file
  // measured effects through the INVOKE spy, and a directive never travels the function layer, so
  // `executed == 0` stayed true through the defect. These cases measure the other seat.
  describe('CR-04 — no directive side effect precedes the reconciliation verdict (D-10)', () => {
    it('records NO pin when the turn is refused, though it names one', async () => {
      const run = harness({ directives: true })
      const result = await run.runTurn({
        message: '/pin fn:runs.start and write a test for 2FA',
      })

      // ONE assertion over three facts, deliberately: the STATUS was already right before this fix
      // and the two effects were already wrong, so a suite that asserted them in sequence would
      // report the defect one line at a time and hide how the three read together.
      expect({
        status: result.status,
        pinned: run.pinCalls,
        approvalDecisions: run.log.events.filter((event) => event.kind === 'approval_decision')
          .length,
      }).toEqual({ status: 'fail_closed', pinned: [], approvalDecisions: 0 })
      expect(result.unhandled?.clause).toBe('write a test for 2FA')
    })

    it('applies NO model override when the turn is refused', async () => {
      const run = harness({ directives: true })
      const result = await run.runTurn({
        message: '/model claude-fast and write a test for 2FA',
      })

      expect({
        status: result.status,
        switched: run.modelCalls,
        verbModelChanges: run.log.events.filter(
          (event) => event.kind === 'model_change' && event.source === 'verb',
        ).length,
      }).toEqual({ status: 'fail_closed', switched: [], verbModelChanges: 0 })
    })

    it('still carries the directive out on the execute arm, and its line still leads', async () => {
      const run = harness({ directives: true })
      const result = await run.runTurn({ message: '/pin fn:runs.start and proposals' })

      expect(result.status).toBe('completed')
      expect(run.pinCalls).toEqual(['fn:runs.start'])
      expect(run.log.events.filter((event) => event.kind === 'approval_decision')).toHaveLength(1)
      expect(run.invocations.map((call) => call.functionId)).toEqual([PROPOSALS_LIST])
      // Directive lines lead the answer — the person asked for the pin FIRST (D-11's order).
      expect(result.answer?.split('\n')[0]).toContain('fn:runs.start')
    })

    it('completes a turn that is ENTIRELY directives, emitting the verb-sourced event', async () => {
      const run = harness({ directives: true })
      const result = await run.runTurn({ message: '/model claude-fast' })

      expect(result.status).toBe('completed')
      expect(run.modelCalls).toEqual(['claude-fast'])
      // The control for the zero-event assertion above: this path DOES write the row, so the
      // refused turn's zero is a fact about the refusal rather than about an unbound seam.
      expect(
        run.log.events.filter(
          (event) => event.kind === 'model_change' && event.source === 'verb',
        ),
      ).toHaveLength(1)
      expect(result.answer).toContain('model: claude-fast')
    })

    it('refuses an UNBOUND directive by name before the planner is ever consulted', async () => {
      // The hoisted half. The binding check reads `deps.directives` and mutates nothing, so it can
      // stay where the execution loop used to be: a build that recognises `/model` and binds no
      // handler still says so early, and stage 2 is never reached on that arm.
      const run = harness({ planned: { toolCalls: [] } })
      const result = await run.runTurn({
        message: '/model claude-fixture and write a test for 2FA',
      })

      expect(result.status).toBe('fail_closed')
      expect(run.plannerCalls).toBe(0)
      expect(result.unhandled?.reason).toContain('no handler')
      expect(result.unhandled?.clause).toBe('/model claude-fixture')
    })
  })

  // 392-14, the CR-04 RESIDUAL (392-VERIFICATION round 2, E3/E3b). The primary fix above is real —
  // the execution loop moved below the verdict and the single-directive control proves it. But the
  // loop itself applies directives ONE AT A TIME and returns on the first refusal, so a turn whose
  // SECOND directive says no kept the first one's irrevocable effect and its append-only row. The
  // status was already right; that is what makes this shape so hard to see from the outside, and
  // why each case folds the status and the two effects into one `toEqual` rather than asserting
  // them in sequence. A refusal that carried something out is worse than a refusal that lied about
  // it, because the person is told the session is unchanged and it is not.
  describe('E3 — the directive BATCH is refused whole: no earlier directive survives a later one', () => {
    it('records NO pin when a LATER directive in the same turn refuses', async () => {
      const run = harness({ directives: true, unpinnable: 'nonsense.notacapability' })
      const result = await run.runTurn({
        message: '/pin fn:runs.start and /pin nonsense.notacapability',
      })

      expect({
        status: result.status,
        pinned: run.pinCalls,
        approvalDecisions: run.log.events.filter((event) => event.kind === 'approval_decision')
          .length,
      }).toEqual({ status: 'fail_closed', pinned: [], approvalDecisions: 0 })
      expect(result.unhandled?.clause).toBe('/pin nonsense.notacapability')
    })

    it('applies NO model override when a LATER directive in the same turn refuses', async () => {
      const run = harness({ directives: true, unpinnable: 'nonsense.notacapability' })
      const result = await run.runTurn({
        message: '/model claude-fast and /pin nonsense.notacapability',
      })

      expect({
        status: result.status,
        switched: run.modelCalls,
        verbModelChanges: run.log.events.filter(
          (event) => event.kind === 'model_change' && event.source === 'verb',
        ).length,
      }).toEqual({ status: 'fail_closed', switched: [], verbModelChanges: 0 })
    })
  })

  describe('D-11 — utterance order, stop on failure, receipts for every clause', () => {
    it('executes table-bound clauses in utterance order', async () => {
      const run = harness()
      const result = await run.runTurn({ message: 'proposals and status' })

      expect(result.status).toBe('completed')
      expect(run.invocations.map((call) => call.functionId)).toEqual([PROPOSALS_LIST, RUNS_LIST])
      expect(result.receipts.map((receipt) => receipt.clause)).toEqual(['proposals', 'status'])
    })

    it('stops the chain on a runtime failure and reports executed/failed/not-run', async () => {
      const run = harness({
        failOn: RUNS_LIST,
        planned: { toolCalls: [{ toolName: toToolName(RUNS_DIGEST), input: { runId: 'RUN-1' } }] },
      })
      const result = await run.runTurn({
        message: 'proposals and status and summarise the last failure',
      })

      expect(result.status).toBe('failed')
      expect(result.receipts.map((receipt) => receipt.status)).toEqual([
        'executed',
        'failed',
        'not-run',
      ])
      // The clause after the failure was never attempted — a fact, not an absence.
      expect(run.invocations.map((call) => call.functionId)).toEqual([PROPOSALS_LIST, RUNS_LIST])
    })

    it('carries the function layer refusal NAME verbatim on the failed receipt', async () => {
      const run = harness({ failOn: RUNS_LIST })
      const result = await run.runTurn({ message: 'proposals and status' })

      expect(result.receipts[1]).toMatchObject({
        status: 'failed',
        functionId: RUNS_LIST,
        outcome: 'FunctionDeniedError',
      })
    })

    it('logs a clause_receipt per clause, not only for the ones that ran', async () => {
      const run = harness({ failOn: PROPOSALS_LIST })
      await run.runTurn({ message: 'proposals and status' })

      const receipts = run.log.events.filter((event) => event.kind === 'clause_receipt')
      expect(receipts.map((event) => event.status)).toEqual(['failed', 'not-run'])
    })
  })

  describe('Pitfall 1 — the origin comes from the stage that PROVED the binding', () => {
    it('mints human for table-bound clauses and agent for planner-bound ones', async () => {
      const run = harness({
        planned: { toolCalls: [{ toolName: toToolName(RUNS_DIGEST), input: { runId: 'RUN-1' } }] },
      })
      const result = await run.runTurn({ message: 'proposals and summarise the last failure' })

      expect(result.status).toBe('completed')
      expect(run.invocations.map((call) => call.caller.origin)).toEqual(['human', 'agent'])
      expect(result.receipts.map((receipt) => receipt.origin)).toEqual(['human', 'agent'])
    })

    it('records the minted origin on the clause_receipt event', async () => {
      const run = harness({
        planned: { toolCalls: [{ toolName: toToolName(RUNS_DIGEST), input: { runId: 'RUN-1' } }] },
      })
      await run.runTurn({ message: 'proposals and summarise the last failure' })

      const origins = run.log.events
        .filter((event) => event.kind === 'clause_receipt')
        .map((event) => event.origin)
      expect(origins).toEqual(['human', 'agent'])
    })

    it('mints agent when a strategy binds a TABLE-resolvable clause through the planner', async () => {
      // The T-392-23 shape, and the reason `source` is carried rather than re-derived. A caller
      // matching the action back against the mapper set would answer `human` here — handing a
      // model-produced invocation the self-grant power 391 D-06 withholds. Reachable only through
      // the D-16 strategy seam, which is exactly the seat an attacker-shaped mistake would sit in.
      const smuggling: ReconcileStrategy = (input) => ({
        kind: 'execute',
        plan: input.mapped.map((resolved) => ({ ...resolved, source: 'planner' as const })),
      })
      const run = harness({ reconcile: smuggling })
      await run.runTurn({ message: 'proposals' })

      expect(run.invocations.map((call) => call.caller.origin)).toEqual(['agent'])
    })
  })

  describe('CHAT-01 — an answered turn completes without acting', () => {
    it('performs zero invocations and returns the prose', async () => {
      const run = harness({
        planned: {
          toolCalls: [
            { toolName: 'answer_only', input: { clause: 'what is a flake', text: 'a flake is…' } },
          ],
        },
      })
      const result = await run.runTurn({ message: 'what is a flake' })

      expect(result.status).toBe('completed')
      expect(run.invocations).toHaveLength(0)
      expect(result.receipts).toHaveLength(0)
      expect(result.answer).toBe('a flake is…')
    })
  })

  describe('CHAT-04/CHAT-05 wiring — the hook and the ledger', () => {
    it('runs the compaction pass BEFORE the planner is consulted', async () => {
      const run = harness({
        compaction: true,
        planned: { toolCalls: [{ toolName: toToolName(RUNS_DIGEST), input: {} }] },
      })
      await run.runTurn({ message: 'summarise the last failure' })

      expect(run.ordering.indexOf('compaction')).toBeGreaterThanOrEqual(0)
      expect(run.ordering.indexOf('compaction')).toBeLessThan(run.ordering.indexOf('planner'))
    })

    it('never consults the planner when stage 1 resolved every clause', async () => {
      const run = harness({ planned: { toolCalls: [] } })
      await run.runTurn({ message: 'proposals and status' })

      expect(run.plannerCalls).toBe(0)
    })

    it('opens with the user message, closes with the boundary, and fsyncs once', async () => {
      const run = harness()
      await run.runTurn({ message: 'proposals and status' })

      const kinds = kindsOf(run.log.events)
      expect(kinds[0]).toBe('user_message')
      expect(kinds[kinds.length - 1]).toBe('turn_complete')
      expect(run.log.boundaries).toBe(1)
    })

    it('closes the turn at the boundary even on the fail-closed arm', async () => {
      const run = harness()
      await run.runTurn({ message: 'write a test for two factor auth' })

      expect(kindsOf(run.log.events).at(-1)).toBe('turn_complete')
      expect(run.log.boundaries).toBe(1)
    })
  })
})
