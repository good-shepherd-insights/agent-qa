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
  ChatSessionHeader,
  FunctionCaller,
  OpenedChatSession,
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
  PlannerStageOutcome,
  PlannerStagePort,
  ReconcileStrategy,
} from '../ports.js'

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
  return {
    events,
    boundaries: 0,
    open(): Promise<OpenedChatSession> {
      return Promise.resolve({ header, events: [...events], refusedLines: [] })
    },
    append(event: ChatSessionEvent): Promise<void> {
      events.push(event)
      return Promise.resolve()
    },
    turnBoundary(): Promise<void> {
      this.boundaries += 1
      return Promise.resolve()
    },
    close(): Promise<void> {
      return Promise.resolve()
    },
  }
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
  runTurn(input: AgentAskInput): Promise<AgentAskResult>
}

interface HarnessOptions {
  readonly planned?: PlannerStageOutcome
  readonly failOn?: string
  readonly reconcile?: ReconcileStrategy
  readonly compaction?: boolean
}

function harness(options: HarnessOptions = {}): Harness {
  const log = memoryLog()
  const invocations: Invocation[] = []
  const ordering: string[] = []
  let plannerCalls = 0

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
      forStage: (stage: ChatBindingStage): FunctionCaller =>
        stage === 'resolver' ? RESOLVER_CALLER : PLANNER_CALLER,
    },
    invoke: (functionId, input, caller) => {
      ordering.push(`invoke:${functionId}`)
      invocations.push({ functionId, input, caller })
      if (functionId === options.failOn) return Promise.reject(new FunctionDeniedError('denied'))
      return Promise.resolve({ ok: true })
    },
    ...(planner === undefined ? {} : { planner }),
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
          answer: 'a flake is…',
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
