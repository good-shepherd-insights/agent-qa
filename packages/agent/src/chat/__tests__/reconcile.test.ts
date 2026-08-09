// Stage 3's whole contract (Phase 392 plan 07 — D-09 / D-10 / D-11 / D-12).
//
// THE OVERRIDE CLAIM IS A DIFFERENTIAL, NOT AN ASSERTION, and this file is written to make that
// structural. "The mapper's verdict beats the model's" is two separate claims — one about the
// ACTION SET (how many, and which) and one about the BOUND ARGUMENTS — and a suite that asserted
// only the first would pass against a reconciler that executed the right op with the model's
// arguments, which is precisely the defect D-12 names ("run test 42" executing TST-999). So the
// count and the binding are asserted apart, against the SAME input, in tests that can fail
// independently.
//
// THE INPUTS ARE BUILT THE WAY THE ENGINE BUILDS THEM. `mapped` carries the table's own bindings
// and `planned` carries raw unexecuted tool calls with `input` typed `unknown` — the exact shapes
// stage 1 and stage 2 hand over. The one thing deliberately NOT reproduced here is the engine's
// choice of which clauses to ask the planner about; that belongs to the engine's suite, and mixing
// it in here would leave both files asserting halves of each other's mechanism.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { deterministicOverrideStrategy } from '../reconcile.js'
import type { ChatClause, PlannerStageOutcome, ReconcileInput, ResolvedClause } from '../ports.js'
import {
  ANSWER_ONLY_TOOL_NAME,
  MARK_UNHANDLED_TOOL_NAME,
  toToolName,
} from '../tool-names.js'

const RUNS_START = 'runs.start'
const RUNS_DIGEST = 'runs.digest'
const PROPOSALS_LIST = 'proposals.list'

function clause(text: string, index: number): ChatClause {
  return { text, index }
}

function mappedTo(target: ChatClause, functionId: string, args: unknown): ResolvedClause {
  return { clause: target, functionId, args }
}

function planned(outcome: Partial<PlannerStageOutcome> = {}): PlannerStageOutcome {
  return { toolCalls: [], ...outcome }
}

function inputOf(
  clauses: readonly ChatClause[],
  mapped: readonly ResolvedClause[],
  outcome: PlannerStageOutcome = planned(),
): ReconcileInput {
  return { clauses, mapped, planned: outcome }
}

describe('deterministicOverrideStrategy: the table wins, and an unroutable clause costs the turn', () => {
  describe('D-12 — the override wins on the action set AND on the bound arguments', () => {
    // ONE input, TWO tests. The model plans a THIRD action and mis-binds the first; the two
    // failures a broken override produces (an extra action; the model's argument) are different
    // defects, so they get different tests over the same fixture.
    const first = clause('run test 42', 0)
    const second = clause('show me the digest', 1)
    const mapperArgs = { testId: 'TST-42' }
    const contested = inputOf(
      [first, second],
      [mappedTo(first, RUNS_START, mapperArgs), mappedTo(second, RUNS_DIGEST, {})],
      planned({
        toolCalls: [
          // The model's version of a clause the table already proved: wrong target argument.
          { toolName: toToolName(RUNS_START), input: { testId: 'TST-999' } },
          { toolName: toToolName(RUNS_DIGEST), input: {} },
          // And one more action nobody asked for.
          { toolName: toToolName(PROPOSALS_LIST), input: {} },
        ],
      }),
    )

    it('binds the mapper arguments, never the model ones', () => {
      const verdict = deterministicOverrideStrategy(contested)

      expect(verdict.kind).toBe('execute')
      if (verdict.kind !== 'execute') return
      expect(verdict.plan[0]?.functionId).toBe(RUNS_START)
      // The binding claim, alone: the identical object the table produced, not a look-alike.
      expect(verdict.plan[0]?.args).toEqual(mapperArgs)
      expect(JSON.stringify(verdict.plan)).not.toContain('TST-999')
    })

    it('executes exactly the table\'s action set — the model\'s extra call is discarded', () => {
      const verdict = deterministicOverrideStrategy(contested)

      expect(verdict.kind).toBe('execute')
      if (verdict.kind !== 'execute') return
      // The COUNT claim, alone. Every clause is accounted for; what was dropped is a model CALL,
      // not a clause, which is the distinction T-392-25 turns on.
      expect(verdict.plan).toHaveLength(2)
      expect(verdict.plan.map((action) => action.functionId)).toEqual([RUNS_START, RUNS_DIGEST])
      expect(verdict.plan.map((action) => action.functionId)).not.toContain(PROPOSALS_LIST)
    })

    it('marks both table-bound actions as resolver-produced, so the engine mints human', () => {
      const verdict = deterministicOverrideStrategy(contested)

      expect(verdict.kind).toBe('execute')
      if (verdict.kind !== 'execute') return
      expect(verdict.plan.map((action) => action.source)).toEqual(['resolver', 'resolver'])
    })
  })

  describe('utterance order and the mixed merge', () => {
    it('keeps clauses in utterance order even when the model answered out of order', () => {
      const first = clause('run test 42', 0)
      const second = clause('show me the digest', 1)
      const verdict = deterministicOverrideStrategy(
        inputOf(
          [first, second],
          // The mapper set is deliberately supplied BACKWARDS: order comes from the clauses.
          [mappedTo(second, RUNS_DIGEST, {}), mappedTo(first, RUNS_START, { testId: 'TST-42' })],
        ),
      )

      expect(verdict.kind).toBe('execute')
      if (verdict.kind !== 'execute') return
      expect(verdict.plan.map((action) => action.clause.text)).toEqual([
        'run test 42',
        'show me the digest',
      ])
    })

    it('aligns a non-table clause to the model action call in its position', () => {
      const first = clause('proposals', 0)
      const second = clause('summarise the last failure', 1)
      const verdict = deterministicOverrideStrategy(
        inputOf(
          [first, second],
          [mappedTo(first, PROPOSALS_LIST, {})],
          planned({ toolCalls: [{ toolName: toToolName(RUNS_DIGEST), input: { limit: 1 } }] }),
        ),
      )

      expect(verdict.kind).toBe('execute')
      if (verdict.kind !== 'execute') return
      expect(verdict.plan).toHaveLength(2)
      expect(verdict.plan[1]).toMatchObject({
        functionId: RUNS_DIGEST,
        args: { limit: 1 },
        source: 'planner',
      })
      expect(verdict.plan[1]?.clause.text).toBe('summarise the last failure')
    })

    it('aligns several non-table clauses to the model calls in the order they arrived', () => {
      const first = clause('summarise the last failure', 0)
      const second = clause('list what is quarantined', 1)
      const verdict = deterministicOverrideStrategy(
        inputOf(
          [first, second],
          [],
          planned({
            toolCalls: [
              { toolName: toToolName(RUNS_DIGEST), input: {} },
              { toolName: toToolName(PROPOSALS_LIST), input: {} },
            ],
          }),
        ),
      )

      expect(verdict.kind).toBe('execute')
      if (verdict.kind !== 'execute') return
      expect(verdict.plan.map((action) => [action.clause.index, action.functionId])).toEqual([
        [0, RUNS_DIGEST],
        [1, PROPOSALS_LIST],
      ])
      expect(verdict.plan.map((action) => action.source)).toEqual(['planner', 'planner'])
    })

    it('never reverses a meta-tool name into a function id', () => {
      const only = clause('what can you do', 0)
      const verdict = deterministicOverrideStrategy(
        inputOf(
          [only],
          [],
          planned({
            toolCalls: [{ toolName: ANSWER_ONLY_TOOL_NAME, input: { text: 'quite a lot' } }],
            answer: 'quite a lot',
          }),
        ),
      )

      // `fromToolName` THROWS on the two orchestration names by design, so a merge that reversed
      // every call without checking would crash here rather than fail an assertion.
      expect(verdict.kind).toBe('execute')
      if (verdict.kind !== 'execute') return
      expect(verdict.plan).toHaveLength(0)
      expect(verdict.answer).toBe('quite a lot')
    })

    it('runs the same path on a single-clause turn', () => {
      const only = clause('proposals', 0)
      const verdict = deterministicOverrideStrategy(
        inputOf([only], [mappedTo(only, PROPOSALS_LIST, {})]),
      )

      expect(verdict.kind).toBe('execute')
      if (verdict.kind !== 'execute') return
      expect(verdict.plan).toEqual([
        { clause: only, functionId: PROPOSALS_LIST, args: {}, source: 'resolver' },
      ])
    })
  })

  describe('the two fail-closed arms (D-10)', () => {
    it('refuses the whole turn when a clause is unmapped and unplanned, naming it', () => {
      const first = clause('proposals', 0)
      const second = clause('write a test for two factor auth', 1)
      const verdict = deterministicOverrideStrategy(
        inputOf([first, second], [mappedTo(first, PROPOSALS_LIST, {})]),
      )

      expect(verdict.kind).toBe('unhandled')
      if (verdict.kind !== 'unhandled') return
      expect(verdict.clause.text).toBe('write a test for two factor auth')
      expect(verdict.reason).toContain('write a test for two factor auth')
    })

    it('refuses the whole turn on mark_unhandled, even when every clause resolved', () => {
      const first = clause('proposals', 0)
      const second = clause('write a test for two factor auth', 1)
      const verdict = deterministicOverrideStrategy(
        inputOf(
          [first, second],
          [mappedTo(first, PROPOSALS_LIST, {}), mappedTo(second, RUNS_DIGEST, {})],
          planned({
            toolCalls: [
              {
                toolName: MARK_UNHANDLED_TOOL_NAME,
                input: {
                  clause: 'write a test for two factor auth',
                  reason: 'no authoring capability has shipped.',
                },
              },
            ],
          }),
        ),
      )

      expect(verdict.kind).toBe('unhandled')
      if (verdict.kind !== 'unhandled') return
      expect(verdict.clause.text).toBe('write a test for two factor auth')
      expect(verdict.reason).toContain('no authoring capability has shipped.')
    })

    it('refuses by name when stage 2 could not be reached at all', () => {
      const only = clause('summarise the last failure', 0)
      const verdict = deterministicOverrideStrategy(
        inputOf([only], [], planned({ failure: { name: 'AuthenticationError', message: '401' } })),
      )

      expect(verdict.kind).toBe('unhandled')
      if (verdict.kind !== 'unhandled') return
      expect(verdict.reason).toContain('AuthenticationError')
      expect(verdict.reason).toContain('summarise the last failure')
    })

    it('answers rather than refusing when the model answered a clause it could not act on', () => {
      const first = clause('proposals', 0)
      const second = clause('what is a flake', 1)
      const verdict = deterministicOverrideStrategy(
        inputOf(
          [first, second],
          [mappedTo(first, PROPOSALS_LIST, {})],
          planned({
            toolCalls: [{ toolName: ANSWER_ONLY_TOOL_NAME, input: { text: 'a test that…' } }],
            answer: 'a test that…',
          }),
        ),
      )

      expect(verdict.kind).toBe('execute')
      if (verdict.kind !== 'execute') return
      expect(verdict.plan).toHaveLength(1)
      expect(verdict.answer).toBe('a test that…')
    })
  })

  describe('the strategy is pure — which is what makes the D-16 differential meaningful', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../reconcile.ts', import.meta.url)),
      'utf8',
    )

    it('acquires nothing but local contract modules', () => {
      const specifiers = [...source.matchAll(/^import[^']*'([^']+)'/gm)].map((match) => match[1])

      expect(specifiers.length).toBeGreaterThan(0)
      for (const specifier of specifiers) {
        expect(specifier?.startsWith('./')).toBe(true)
      }
    })

    it('reads no clock and no environment', () => {
      expect(source).not.toMatch(/Date\.now|new Date|process\.env|Math\.random/)
    })

    it('returns the same verdict for the same input, called twice', () => {
      const only = clause('proposals', 0)
      const request = inputOf([only], [mappedTo(only, PROPOSALS_LIST, {})])

      expect(deterministicOverrideStrategy(request)).toEqual(
        deterministicOverrideStrategy(request),
      )
    })
  })
})
