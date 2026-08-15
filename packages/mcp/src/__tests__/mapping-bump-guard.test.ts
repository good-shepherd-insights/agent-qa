// The bump guard: the catalogue cannot change by accident (Phase 396 plan 04, D-04 · MCPS-02).
//
// WHY A COUNT WOULD NOT HAVE DONE. D-04 rejects a count-only guard by name, and the reason is the
// door-enumeration weakness this project has measured before: a count admits CANCELLING changes.
// Rename one tool and add nothing, or swap one tool's op for another's, and a count of twelve stays
// twelve while the vocabulary every downstream consumer binds against has silently moved. So the
// pin is the exact sorted NAME list plus each tool's exact OP SET — the one place in this
// repository where those names are restated, and that restatement IS the pin.
//
// EVERYTHING ELSE IS PRODUCED, NOT LITERAL. The registry's own enumeration is the denominator: the
// partition law below ranges over `registry.list(...)` rather than over a number written here, so
// "how many ops are there" is answered by the catalogue rather than by this file's opinion of it.
// MEASURED 2026-08-16: the registry declares 41 ops. 22 are projected by the twelve tools; the
// other 19 are dispositioned in `UNPROJECTED_OPS`. That settles the 41-vs-43 discrepancy the phase
// context carried — whatever the registry answers IS the denominator, and this suite reds if the
// two sets ever stop covering it exactly.
//
// MUTATION LEGS — the acceptance bar, re-runnable as `bash scripts/396-mapping-mutation.sh`.
// Every leg was applied to `packages/mcp/src/mapping.ts`, the suite re-run, and the subject
// restored from a byte snapshot with sha-256 compared. Observed on 2026-08-16:
//
//   M1  a thirteenth tool planted (`agent_qa_cancel_run` over `runs.get`)          -> RED (6 cells)
//   M2  `agent_qa_start_run` renamed to `agent_qa_begin_run`                       -> RED (4 cells)
//   M3  `agent_qa_show_proposal` remapped onto `proposals.list`                    -> RED (4 cells)
//   M4  `config.get` added to the config fold WITHOUT leaving `UNPROJECTED_OPS`    -> RED (5 cells)
//
// M2 IS THE ONE TO READ. A pure rename adds nothing and removes nothing, so a count-only guard sees
// an unchanged catalogue; four named cells here disagree. That is the whole of D-04's argument,
// measured rather than argued.
//
// A GREEN SUITE UNDER ANY LEG IS A FAILURE OF THE GUARD, NOT A PASS.

import {
  createFunctionRegistry,
  type CreateFunctionRegistryOptions,
  type FunctionDeclaration,
  type FunctionDeps,
  type FunctionRegistry,
} from '@vostride/agent-qa-agent'
import { FunctionScopeSchema } from '@vostride/agent-qa-schema'
import type { FunctionCaller } from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'

import {
  AGENT_QA_COMPOSED_CONTRACTS,
  AGENT_QA_OP_CONTRACTS,
  AGENT_QA_TOOL_PROJECTIONS,
  compositionOf,
  DEGRADED_OUTPUT_CONTRACTS,
  UNPROJECTED_OPS,
} from '../mapping.js'

/**
 * The registry, listing only.
 *
 * `deps` is EMPTY and cast, which is honest for exactly this question: `list()` consults the deps
 * for one thing — whether an op is bound in this composition — and membership of the catalogue is a
 * property of the catalogue, not of a host. A fixture supplying rich fakes would list the same
 * forty-one ids and take fifty lines to do it. Nothing here dispatches, so nothing here can reach a
 * port that is not there.
 */
function builtInRegistry(): FunctionRegistry {
  const auditSink = {
    appendExecutionAudit() {},
    appendGuardrailAudit() {},
  } as unknown as CreateFunctionRegistryOptions['auditSink']
  return createFunctionRegistry({ deps: {} as unknown as FunctionDeps, auditSink })
}

/** Every scope, and not safe mode: this suite asks what the CATALOGUE holds, not what a caller sees. */
const EVERY_SCOPE_CALLER: FunctionCaller = {
  surface: 'mcp',
  grantedScopes: [...FunctionScopeSchema.options],
  safeMode: false,
  origin: 'agent',
}

function declarations(): readonly FunctionDeclaration[] {
  return builtInRegistry().list(EVERY_SCOPE_CALLER)
}

const projectedOpIds = (): readonly string[] =>
  AGENT_QA_TOOL_PROJECTIONS.flatMap((projection) => [...projection.ops])

// ---- THE PIN. The one restatement, and it is deliberate. ----------------------------------------

/** D-04's exact sorted list. Adding, removing or renaming a tool reds the first cell below. */
const PINNED_TOOL_NAMES: readonly string[] = [
  'agent_qa_apply_config_proposal',
  'agent_qa_apply_proposal',
  'agent_qa_get_entity',
  'agent_qa_get_run_digest',
  'agent_qa_list_proposals',
  'agent_qa_list_runs',
  'agent_qa_propose_config_change',
  'agent_qa_propose_knowledge_change',
  'agent_qa_refine_test',
  'agent_qa_show_proposal',
  'agent_qa_start_run',
  'agent_qa_write_test',
]

/** D-04's other half: WHICH ops each tool stands in front of. A remap reds without a rename. */
const PINNED_TOOL_OPS: Readonly<Record<string, readonly string[]>> = {
  agent_qa_apply_config_proposal: ['config.proposal.apply'],
  agent_qa_apply_proposal: ['knowledge.proposal.apply'],
  agent_qa_get_entity: ['entities.resolve', 'entities.get'],
  agent_qa_get_run_digest: ['runs.digest'],
  agent_qa_list_proposals: ['proposals.list'],
  agent_qa_list_runs: ['runs.list'],
  agent_qa_propose_config_change: [
    'config.field.set',
    'config.target.create',
    'config.target.edit',
    'config.auth.set',
    'config.hook.add',
    'config.project.scaffold',
    'config.undo.propose',
  ],
  agent_qa_propose_knowledge_change: [
    'knowledge.accept.propose',
    'knowledge.reject.propose',
    'knowledge.forget.propose',
  ],
  agent_qa_refine_test: ['authoring.draft.edit', 'authoring.draft.verify'],
  agent_qa_show_proposal: ['proposals.show'],
  agent_qa_start_run: ['runs.start'],
  agent_qa_write_test: ['authoring.draft.write'],
}

/** MCPS-02's stated band. Asserted AT the bound, not implied by the exact pin above it. */
const MCPS_02_MIN_TOOLS = 8
const MCPS_02_MAX_TOOLS = 15

describe('the pinned catalogue (D-04)', () => {
  it('declares exactly the pinned sorted tool-name list', () => {
    const names = AGENT_QA_TOOL_PROJECTIONS.map((projection) => projection.name).sort()
    expect(names).toEqual([...PINNED_TOOL_NAMES])
  })

  it('declares exactly the pinned op set for every tool', () => {
    const actual: Record<string, readonly string[]> = {}
    for (const projection of AGENT_QA_TOOL_PROJECTIONS) actual[projection.name] = [...projection.ops]
    expect(actual).toEqual(PINNED_TOOL_OPS)
  })

  // The MCPS-02 boundary, asserted with BOTH comparisons rather than inferred from the exact count.
  // Twelve is one step inside each bound, so neither can be crossed silently: a thirteenth tool
  // still passes here and reds the exact pin, and a drop to seven reds here.
  it('holds a tool count inside the MCPS-02 band, at both ends', () => {
    const count = AGENT_QA_TOOL_PROJECTIONS.length
    expect(count).toBe(12)
    expect(count).toBeGreaterThanOrEqual(MCPS_02_MIN_TOOLS)
    expect(count).toBeLessThanOrEqual(MCPS_02_MAX_TOOLS)
  })

  it('declares no duplicate tool name', () => {
    const names = AGENT_QA_TOOL_PROJECTIONS.map((projection) => projection.name)
    expect(new Set(names).size).toBe(names.length)
  })

  // THE ADMITTED/REJECTED PAIR (the `protected-classes-registry` analog). Without it, every cell
  // above could be satisfied by a comparison that matches loosely — a `startsWith`, a substring, a
  // set that answers yes to anything shaped like a name. A near-miss spelling of a real member must
  // match NOTHING, on both axes.
  it('matches nothing for a near-miss tool name or a near-miss op id', () => {
    const names = new Set(AGENT_QA_TOOL_PROJECTIONS.map((projection) => projection.name))
    expect(names.has('agent_qa_start_run')).toBe(true)
    expect(names.has('agent_qa_start_runs')).toBe(false)
    expect(names.has('agent_qa_start')).toBe(false)

    const ops = new Set(projectedOpIds())
    expect(ops.has('runs.start')).toBe(true)
    expect(ops.has('runs.started')).toBe(false)
    expect(ops.has('runs')).toBe(false)
  })
})

describe('the projection resolves against the registry, produced not literal', () => {
  it('names only ops the registry actually declares', () => {
    const registered = new Set(declarations().map((declaration) => declaration.id))
    for (const opId of projectedOpIds()) {
      expect(registered.has(opId), `${opId} is projected but not registered`).toBe(true)
    }
  })

  // One op, one door. Two tools over one op would make "which tool applies this proposal" a
  // question with two answers, and 397's parity walk would count the op twice.
  it('projects each op through exactly one tool', () => {
    const seen = new Map<string, string>()
    for (const projection of AGENT_QA_TOOL_PROJECTIONS) {
      for (const opId of projection.ops) {
        const first = seen.get(opId)
        expect(first, `${opId} is projected by both ${first} and ${projection.name}`).toBeUndefined()
        seen.set(opId, projection.name)
      }
    }
    expect(seen.size).toBe(projectedOpIds().length)
  })

  // THE GENERAL RULE BEHIND TWO NAMED PROHIBITIONS. The plan forbids projecting `proposals.accept`
  // because `requiresHumanOrigin` dead-ends an agent-origin caller (RESEARCH Pitfall 7). That is a
  // property of the OP, so it is asserted over every projected op rather than over one name — which
  // is what caught `proposals.reject`, a tool the plan's own table listed and this cell refuses.
  // A door that can never open is worse than an absent one: it advertises a capability and spends
  // every caller's call finding out it has none.
  it('projects no op that requires a human origin', () => {
    const projected = new Set(projectedOpIds())
    const humanOnly = declarations()
      .filter((declaration) => declaration.requiresHumanOrigin === true)
      .map((declaration) => declaration.id)

    // Integrity: the filter found something, so the absence below is a refusal rather than an
    // empty channel that would pass over a declaration field spelled wrong.
    expect(humanOnly.length).toBeGreaterThan(0)
    for (const opId of humanOnly) {
      expect(projected.has(opId), `${opId} requires a human origin and cannot serve this surface`)
        .toBe(false)
    }
  })

  it('carries a contract-table entry for every projected op', () => {
    for (const opId of projectedOpIds()) {
      expect(AGENT_QA_OP_CONTRACTS[opId], opId).toBeDefined()
    }
    // The reverse direction too: a contract left behind by a tool that was removed is dead weight
    // whose only effect is to make the two tables look like they agree.
    expect(Object.keys(AGENT_QA_OP_CONTRACTS).sort()).toEqual([...projectedOpIds()].sort())
  })
})

describe('the partition law (D-03 / D-15)', () => {
  it('disposition every registry op exactly once, in exactly one of the two sets', () => {
    const registryIds = declarations().map((declaration) => declaration.id).sort()
    const projected = projectedOpIds()
    const unprojected = UNPROJECTED_OPS.map((entry) => entry.opId)

    // Disjoint: an op in both is a tool shipping something the scoping note says is deferred.
    const overlap = projected.filter((opId) => unprojected.includes(opId))
    expect(overlap, 'ops declared BOTH projected and unprojected').toEqual([])

    // Complete: an op in neither has landed with nobody having decided anything about it, which is
    // exactly what 397's parity walk would then be scoped around by accident.
    expect([...projected, ...unprojected].sort()).toEqual(registryIds)
  })

  it('measures the registry at the count this suite header records', () => {
    // The denominator, stated where a reader can see it move. Not a rule — a MEASUREMENT, and the
    // sentence in the header is only true while this cell is green.
    expect(declarations().length).toBe(41)
    expect(projectedOpIds().length).toBe(22)
    expect(UNPROJECTED_OPS.length).toBe(19)
  })

  it('lists no op twice in the scoping note', () => {
    const ids = UNPROJECTED_OPS.map((entry) => entry.opId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('gives every unprojected op a non-empty reason and 397 as its adjudicator', () => {
    for (const entry of UNPROJECTED_OPS) {
      expect(entry.reason.length, entry.opId).toBeGreaterThan(20)
      expect(entry.adjudication, entry.opId).toBe('397')
    }
  })

  // D-03's own note leads the list, and the ORDER is part of the decision: a reader scanning the
  // scoping note meets the one exclusion that was argued before the ones that were merely scoped.
  it('leads the scoping note with agent.ask and its dated D-03 rationale', () => {
    expect(UNPROJECTED_OPS[0]?.opId).toBe('agent.ask')
    expect(UNPROJECTED_OPS[0]?.reason).toContain('D-03')
    expect(UNPROJECTED_OPS[0]?.reason).toContain('2026-08-15')
  })
})

describe('the composed fold contracts answer for the ops the mapping declares', () => {
  /** The arm literals the ADVERTISED schema actually carries, read out of its JSON Schema. */
  function advertisedArms(toolName: string, discriminant: string): readonly unknown[] {
    const contracts = AGENT_QA_COMPOSED_CONTRACTS[toolName]
    expect(contracts, `${toolName} has no composed contract`).toBeDefined()
    const json = contracts!.input['~standard'].jsonSchema.input({ target: 'draft-2020-12' }) as {
      oneOf?: readonly { properties?: Record<string, { const?: unknown }> }[]
    }
    return (json.oneOf ?? []).map((arm) => arm.properties?.[discriminant]?.const)
  }

  // The fold unions are composed in `@vostride/agent-qa-schema`, which may not import the function
  // layer and therefore spells the op ids as literals. This cell is what makes that restatement
  // safe: the literals are read back OUT of the composed schema and compared against the mapping's
  // declared arms, so a fold that silently gained, lost or renamed an arm reds here.
  it('advertises exactly the declared arms, in the declared order', () => {
    const folds = AGENT_QA_TOOL_PROJECTIONS.filter(
      (projection) => compositionOf(projection) === 'union',
    )
    expect(folds.map((fold) => fold.name)).toEqual([
      'agent_qa_refine_test',
      'agent_qa_propose_config_change',
      'agent_qa_propose_knowledge_change',
    ])

    for (const fold of folds) {
      expect(advertisedArms(fold.name, fold.discriminant!), fold.name).toEqual([...fold.ops])
    }
  })

  it('gives every multi-arm tool a composed contract, and no 1:1 tool one', () => {
    for (const projection of AGENT_QA_TOOL_PROJECTIONS) {
      const composed = AGENT_QA_COMPOSED_CONTRACTS[projection.name] !== undefined
      if (projection.ops.length > 1) {
        expect(composed, `${projection.name} folds but has no composed contract`).toBe(true)
        continue
      }
      // The two apply doors are the deliberate exception: they advertise D-11's wire envelope
      // rather than the op's `{ proposalId }`, which is a fact about MCP and about no other caller.
      expect(composed, `${projection.name} restates a contract it could inherit`).toBe(
        projection.kind === 'apply',
      )
    }
  })
})

describe('the degradation list names tools that exist (D-16)', () => {
  it('names a declared tool and one of its declared ops for every entry', () => {
    const byName = new Map(AGENT_QA_TOOL_PROJECTIONS.map((p) => [p.name, p]))
    for (const entry of DEGRADED_OUTPUT_CONTRACTS) {
      const projection = byName.get(entry.tool)
      expect(projection, `${entry.tool} is degraded but not declared`).toBeDefined()
      expect(projection!.ops).toContain(entry.opId)
      expect(entry.measured.length).toBeGreaterThan(0)
      expect(entry.adjudication).toBe('397')
    }
  })
})
