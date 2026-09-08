// The bump guard: the catalogue cannot change by accident (Phase 396 plan 04, D-04 · MCPS-02).
//
// WHY A COUNT WOULD NOT HAVE DONE. D-04 rejects a count-only guard by name, and the reason is the
// door-enumeration weakness this project has measured before: a count admits CANCELLING changes.
// Rename one tool and add nothing, or swap one tool's op for another's, and a count of fourteen stays
// fourteen while the vocabulary every downstream consumer binds against has silently moved. So the
// pin is the exact sorted NAME list plus each tool's exact OP SET — the one place in this
// repository where those names are restated, and that restatement IS the pin.
//
// EVERYTHING ELSE IS PRODUCED, NOT LITERAL. The registry's own enumeration is the denominator: the
// partition law below ranges over `registry.list(...)` rather than over a number written here, so
// "how many ops are there" is answered by the catalogue rather than by this file's opinion of it.
// MEASURED 2026-08-17 (398 D-09): the registry declares 42 ops. 22 are projected by the twelve
// tools; the other 20 are dispositioned in `UNPROJECTED_OPS`. Was 41/22/19 as measured 2026-08-16;
// `agent.explain` is the arrival, and it lands on the unprojected side with its own dated reason.
// RE-MEASURED 2026-08-27 (405-01 D-03): 44/22/22. `runs.detail` is the arrival and it lands on the
// unprojected side too, with its own dated reason; the count cell below carries the live numbers.
// RE-MEASURED AGAIN 2026-08-27 (405-05 D-12/D-13): 45/22/23. `runs.artifact` is the arrival and it
// lands unprojected for a reason of its own — its result is a base64 blob, and a `tools/call` round
// trip is the wrong carriage for bytes no conversation can render.
// RE-MEASURED AGAIN 2026-08-29 (407-01 D-05): 46/22/24. `runs.knowledge` is the arrival and it
// lands unprojected on `runs.detail`'s footing — a completed run's whole used-and-learned
// projection, three served channels and a retrieval trace per step, is a large one-shot payload
// rather than a mid-flight read.
// RE-MEASURED 2026-09-08 (419 D-19/D-20): fourteen tools; 48 declarations / 24 projected /
// 24 unprojected. runs.mark arrives projected; knowledge.gates.list moves to the read door.
// The original measurement settles the 41-vs-43 discrepancy the phase
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
//
// ---- THE SECOND PINNED SET: THE MIGRATION MAP (2026-08-17, Phase 398 plan 02 · D-14) ------------
//
// ONE LAW, TWO PINNED SETS. `migration-map.ts` beside `mapping.ts` carries the thirty-three RETIRED
// v1 tool names and the arm each one was ruled onto, and it is pinned here for the same reason and
// by the same idiom as the live catalogue above: the two tables together are this package's whole
// tool-name vocabulary — the names that exist and the names that used to — and a bump to either is
// a change to what every downstream consumer binds against.
//
// WHY A COUNT WOULD NOT HAVE DONE HERE EITHER, and the map makes the argument sharper than the
// catalogue does. Its members are already censused against `DELETION-INVENTORY.md` in both
// directions (`migration-map.test.ts`), so the SET cannot drift while the document holds still.
// What that census cannot see is an ARM: rule `agent_qa_cancel_run` retired instead of pending and
// every census cell stays green, because the name is still there and the document still has its
// row — while an external agent calling the retired name is now told the capability is answered
// elsewhere when in truth it is owed by M5. So the pin is the exact sorted NAME list WITH ITS ARM,
// and a swapped arm is a visible diff in this file rather than a silent change in behaviour.
//
// THE TARGETS ARE PINNED TOO, and that is one step past D-14's letter, taken for D-14's reason. The
// `renamed-to` targets are already joined LIVE against `AGENT_QA_TOOL_PROJECTIONS`, so a target
// naming a tool that does not exist reds there. What neither that join nor the arm pin can see is a
// target swapped for a DIFFERENT LIVE tool — `agent_qa_read_test` pointed at `agent_qa_list_runs`
// passes the join (it is a real tool), passes the arm pin (still `renamed-to`) and sends every v1
// caller of the read door to the run list. That is exactly the cancelling change M2 above exists to
// refuse, seen from the map's side, so it is pinned by name here.
//
// THE PARTITION SIZES ARE DERIVED ON BOTH SIDES. The counts below are computed from
// `V1_TOOL_MIGRATION_MAP` and compared against counts computed from the PIN's own groupings —
// never against an integer typed into this file, which could be edited to agree with a drift in one
// keystroke and would then read as a measurement.

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
import { V1_TOOL_MIGRATION_MAP, type V1MigrationArm } from '../migration-map.js'

/**
 * The registry, listing only.
 *
 * `deps` is EMPTY and cast, which is honest for exactly this question: `list()` consults the deps
 * for one thing — whether an op is bound in this composition — and membership of the catalogue is a
 * property of the catalogue, not of a host. A fixture supplying rich fakes would list the same
 * forty-two ids and take fifty lines to do it. Nothing here dispatches, so nothing here can reach a
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
  'agent_qa_list_knowledge_gates',
  'agent_qa_list_proposals',
  'agent_qa_list_runs',
  'agent_qa_mark_run',
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
  agent_qa_list_knowledge_gates: ['knowledge.gates.list'],
  agent_qa_mark_run: ['runs.mark'],
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

/**
 * D-05's pin (2026-08-31, Phase 408 plan 01 · MCPA-01): which tools CARRY the live-view App, and
 * where each one's concrete runId is found.
 *
 * THE THIRD RESTATEMENT IN THIS FILE, and it earns its place on the same argument as the first two.
 * `projection-fidelity.test.ts` censuses the carrier set FROM the projection table, which catches a
 * carrier planted or dropped — it cannot catch a carrier whose `runIdFrom` was swapped, because
 * both halves of a derived comparison move together. A swapped `runIdFrom` is a cancelling change
 * of exactly the M2 class: nothing is added, nothing is removed, and every derived cell stays
 * green while Plan 03's per-call reference starts decorating a result with a live view of a run
 * nobody asked about. So the pair is pinned by name here.
 *
 * IT IS ALSO THE COUNT THAT MATTERS MOST IN THIS FILE. A carrier is a door onto a channel that
 * mints a live-view CREDENTIAL, so "which tools carry the App" is not a vocabulary question the way
 * the name list is — a third entry appearing without a diff in this file is the failure this pin
 * exists to make impossible.
 */
const PINNED_TOOL_UI_CARRIERS: Readonly<
  Record<string, { readonly resource: string; readonly runIdFrom: string }>
> = {
  // The ack carries the runId the run was given, so a per-call reference reads it off the OUTPUT.
  agent_qa_start_run: { resource: 'live-run', runIdFrom: 'output' },
  // The watch/status read is ASKED about a run, so its runId is on the INPUT — this is the
  // late-attach door (D-07): a run started from CLI, CI or the dashboard is watchable through it.
  agent_qa_get_run_digest: { resource: 'live-run', runIdFrom: 'input' },
}

/**
 * D-14's pin: every retired v1 name, sorted, with the arm it was ruled onto.
 *
 * The second restatement in this file, and deliberate for the same reason as the first — this IS
 * the pin. A name added, removed or renamed reds the membership cell; an arm swapped reds the arm
 * cell by that name.
 */
const PINNED_V1_MIGRATION_ARMS: Readonly<Record<string, V1MigrationArm>> = {
  agent_qa_cancel_run: 'pending',
  agent_qa_classify_failure: 'retired',
  agent_qa_create_hook: 'renamed-to',
  agent_qa_create_suite: 'retired',
  agent_qa_create_test: 'renamed-to',
  agent_qa_delete_hook: 'retired',
  agent_qa_delete_suite: 'retired',
  agent_qa_delete_test: 'retired',
  agent_qa_discover: 'retired',
  agent_qa_enqueue_suite_run: 'renamed-to',
  agent_qa_enqueue_test_run: 'renamed-to',
  agent_qa_generate_id: 'retired',
  agent_qa_get_config: 'retired',
  agent_qa_get_run: 'retired',
  agent_qa_get_run_artifact: 'pending',
  agent_qa_get_run_execution_logs: 'retired',
  agent_qa_get_run_logs: 'retired',
  agent_qa_get_run_steps: 'retired',
  agent_qa_list_hooks: 'pending',
  agent_qa_list_suites: 'pending',
  agent_qa_list_tests: 'pending',
  agent_qa_read_hook: 'pending',
  agent_qa_read_suite: 'retired',
  agent_qa_read_test: 'renamed-to',
  agent_qa_run_hook: 'retired',
  agent_qa_schema_reference: 'retired',
  agent_qa_update_hook: 'pending',
  agent_qa_update_suite: 'retired',
  agent_qa_update_test: 'renamed-to',
  agent_qa_validate_definition: 'retired',
  agent_qa_validate_id: 'retired',
  agent_qa_validate_suite: 'retired',
  agent_qa_validate_test: 'retired',
}

/**
 * The other half, and the one the live join cannot supply: WHICH live tool each `renamed-to` name
 * was pointed at. A remap onto a different real tool reds here and nowhere else.
 */
const PINNED_V1_RENAMED_TARGETS: Readonly<Record<string, string>> = {
  agent_qa_create_hook: 'agent_qa_propose_config_change',
  agent_qa_create_test: 'agent_qa_write_test',
  agent_qa_enqueue_suite_run: 'agent_qa_start_run',
  agent_qa_enqueue_test_run: 'agent_qa_start_run',
  agent_qa_read_test: 'agent_qa_get_entity',
  agent_qa_update_test: 'agent_qa_refine_test',
}

/** Arm -> how many names carry it, computed from a table. Used on BOTH sides of the size cell. */
function armSizes(entries: readonly (readonly [string, V1MigrationArm])[]): Record<string, number> {
  const sizes: Record<string, number> = { 'renamed-to': 0, retired: 0, pending: 0 }
  for (const [, arm] of entries) sizes[arm] = (sizes[arm] ?? 0) + 1
  return sizes
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
  // Fourteen is one step inside each bound, so neither can be crossed silently: a thirteenth tool
  // still passes here and reds the exact pin, and a drop to seven reds here.
  it('holds a tool count inside the MCPS-02 band, at both ends', () => {
    const count = AGENT_QA_TOOL_PROJECTIONS.length
    expect(count).toBe(14)
    expect(count).toBeGreaterThanOrEqual(MCPS_02_MIN_TOOLS)
    expect(count).toBeLessThanOrEqual(MCPS_02_MAX_TOOLS)
  })

  it('declares exactly the pinned App carriers, with the pinned runId source (408 D-05)', () => {
    const actual: Record<string, { resource: string; runIdFrom: string }> = {}
    for (const projection of AGENT_QA_TOOL_PROJECTIONS) {
      if (projection.ui === undefined) continue
      actual[projection.name] = { ...projection.ui }
    }
    expect(actual).toEqual(PINNED_TOOL_UI_CARRIERS)
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
    // 2026-09-08, 419 D-19/D-20: mark arrives and gates becomes projected (48/24/24).
    expect(declarations().length).toBe(48)
    expect(projectedOpIds().length).toBe(24)
    expect(UNPROJECTED_OPS.length).toBe(24)
  })

  it('lists no op twice in the scoping note', () => {
    const ids = UNPROJECTED_OPS.map((entry) => entry.opId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('gives every unprojected op a non-empty reason and a NAMED adjudicator', () => {
    // 2026-08-17 (398 D-09). This cell used to assert `'397'` for every entry, and that literal was
    // right for exactly as long as 397 was the last phase to add an op. `agent.explain` arrived in
    // 398, so a phase that could not have ruled on it would have been recorded as having done so —
    // which is the one failure a provenance column has.
    //
    // WIDENED AS A PIN, NOT AS A RELAXATION. The vocabulary is a closed two-member set AND the
    // membership is spelled by op id below, so a later entry stamped `'398'` because it was easier
    // reds here rather than joining a set that has quietly become "any phase number".
    const ADJUDICATED_BY_398 = new Set(['agent.explain'])
    // 2026-08-31 (408 D-01). NOT a widening: a RE-STAMP. `runs.liveurl` arrived in 403 and was
    // stamped `'403'`, but what 403 recorded was a DEFERRAL — "whether an MCP caller may mint one
    // is Phase 408's question". 408 answered it (internal mint only), so the phase that ruled this
    // absence is 408 and the stamp moves with the ruling. `'403'` leaves the vocabulary with it,
    // rather than staying as a member-less literal this pin would pass over in silence.
    const ADJUDICATED_BY_408 = new Set(['runs.liveurl'])
    // 2026-08-27 (405-01 D-03). The same widening for the same reason, two phases later:
    // `runs.detail` arrived in 405 and 397 could not have ruled on it. Membership is still
    // spelled by op id, so an entry stamped `'405'` because it was easier reds here.
    const ADJUDICATED_BY_405 = new Set(['runs.artifact', 'runs.detail'])
    // 2026-08-29 (407-01 D-05). The same widening for the same reason, two phases later:
    // `runs.knowledge` arrived in 407 and 397 could not have ruled on it. Membership is still
    // spelled by op id, so an entry stamped `'407'` because it was easier reds here.
    const ADJUDICATED_BY_407 = new Set(['runs.knowledge'])
    const expectedAdjudicator = (opId: string): string =>
      ADJUDICATED_BY_398.has(opId)
        ? '398'
        : ADJUDICATED_BY_408.has(opId)
          ? '408'
          : ADJUDICATED_BY_405.has(opId)
            ? '405'
            : ADJUDICATED_BY_407.has(opId) ? '407' : '397'
    for (const entry of UNPROJECTED_OPS) {
      expect(entry.reason.length, entry.opId).toBeGreaterThan(20)
      expect(entry.adjudication, entry.opId).toBe(expectedAdjudicator(entry.opId))
    }
    // The set is not vacuous in either direction: an id that left the register would leave this
    // pin naming nothing, which is the hole an allow-list-shaped literal always has.
    expect(
      UNPROJECTED_OPS.filter((entry) => ADJUDICATED_BY_398.has(entry.opId)).map((e) => e.opId),
      'the 398-adjudicated pin names entries the scoping note does not carry',
    ).toEqual([...ADJUDICATED_BY_398])
    expect(
      UNPROJECTED_OPS.filter((entry) => ADJUDICATED_BY_408.has(entry.opId)).map((e) => e.opId),
      'the 408-adjudicated pin names entries the scoping note does not carry',
    ).toEqual([...ADJUDICATED_BY_408])
    // …and the vocabulary really shed `'403'` rather than keeping it as a member-less literal.
    expect(
      UNPROJECTED_OPS.map((entry) => entry.adjudication as string).filter((a) => a === '403'),
      "`'403'` left the adjudicator vocabulary with the ruling it deferred — no entry may carry it",
    ).toEqual([])
    expect(
      UNPROJECTED_OPS.filter((entry) => ADJUDICATED_BY_405.has(entry.opId)).map((e) => e.opId),
      'the 405-adjudicated pin names entries the scoping note does not carry',
    ).toEqual([...ADJUDICATED_BY_405])
    expect(
      UNPROJECTED_OPS.filter((entry) => ADJUDICATED_BY_407.has(entry.opId)).map((e) => e.opId),
      'the 407-adjudicated pin names entries the scoping note does not carry',
    ).toEqual([...ADJUDICATED_BY_407])
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

describe('the pinned migration map (D-14)', () => {
  it('declares exactly the pinned sorted v1-name list', () => {
    const names = V1_TOOL_MIGRATION_MAP.map((entry) => entry.v1Name).sort()
    expect(names).toEqual(Object.keys(PINNED_V1_MIGRATION_ARMS).sort())
  })

  it('declares exactly the pinned arm for every v1 name', () => {
    const actual: Record<string, V1MigrationArm> = {}
    for (const entry of V1_TOOL_MIGRATION_MAP) actual[entry.v1Name] = entry.arm
    expect(actual).toEqual(PINNED_V1_MIGRATION_ARMS)
  })

  it('declares exactly the pinned renamed-to target for every renamed name', () => {
    const actual: Record<string, string> = {}
    for (const entry of V1_TOOL_MIGRATION_MAP) {
      if (entry.arm !== 'renamed-to') continue
      actual[entry.v1Name] = entry.v2Tool as string
    }
    expect(actual).toEqual(PINNED_V1_RENAMED_TARGETS)
  })

  // The partition, derived on both sides. The module's own enumeration versus the pin's own
  // groupings — so this cell measures agreement between two tables rather than agreement between a
  // table and an integer somebody typed beside it.
  it('partitions the map into the arm sizes the pin groups', () => {
    const fromModule = armSizes(V1_TOOL_MIGRATION_MAP.map((entry) => [entry.v1Name, entry.arm]))
    const fromPin = armSizes(Object.entries(PINNED_V1_MIGRATION_ARMS))
    expect(fromModule).toEqual(fromPin)

    // Integrity: every arm is actually populated, so the equality above is three real comparisons
    // rather than one real one and two matching zeroes.
    for (const [arm, size] of Object.entries(fromModule)) {
      expect(size, `arm ${arm} has no members`).toBeGreaterThan(0)
    }
    expect(Object.values(fromModule).reduce((a, b) => a + b, 0)).toBe(V1_TOOL_MIGRATION_MAP.length)
  })

  // The two vocabularies are DISJOINT, and that is the whole point of keeping both. A name that is
  // both live and retired would make `tools/list` and the redirect disagree about whether it exists
  // — and the redirect's teaching error would be handed to a caller whose call could have worked.
  it('shares no name with the live catalogue', () => {
    const live = new Set(AGENT_QA_TOOL_PROJECTIONS.map((projection) => projection.name))
    const overlap = V1_TOOL_MIGRATION_MAP
      .map((entry) => entry.v1Name)
      .filter((name) => live.has(name))
    expect(overlap, 'names declared BOTH live and retired').toEqual([])
  })

  // The admitted/rejected pair, as above. A near-miss spelling of a retired name must match
  // NOTHING, or the redirect would answer for names it was never given.
  it('matches nothing for a near-miss retired name', () => {
    const retired = new Set(V1_TOOL_MIGRATION_MAP.map((entry) => entry.v1Name))
    expect(retired.has('agent_qa_cancel_run')).toBe(true)
    expect(retired.has('agent_qa_cancel_runs')).toBe(false)
    expect(retired.has('agent_qa_cancel')).toBe(false)
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

const PINNED_CREDENTIAL_REQUIRED = ['agent_qa_mark_run']
it('419 D-20 pins the credential-required vocabulary', () => {
  expect(AGENT_QA_TOOL_PROJECTIONS.filter(row => row.credential === 'required').map(row => row.name)).toEqual(PINNED_CREDENTIAL_REQUIRED)
})
