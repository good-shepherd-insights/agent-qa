// The planner's action vocabulary IS the registry (Phase 392 plan 04, D-07 / D-08 / D-10).
//
// Three claims, and they are deliberately not the same claim:
//
//   1. THE SET. The toolset ids equal the registry walk plus exactly two meta-tools. Computed
//      from the walk, never from a number: a literal count would make this file a census of the
//      catalogue as it stood the day it was written, and 393-395's new ops would fail it rather
//      than joining it. The always-send-all law says the model sees everything the registry
//      offers; the assertion says it sees nothing else (T-392-13).
//   2. NOTHING RUNS. No tool in the set carries an execute callback, asserted per tool. This is
//      what makes D-10's "reconciliation completes BEFORE the first side effect" structural: the
//      SDK has no function to call, so `generateText` returns a plan and cannot enact one. A
//      comment saying so would be a promise; an absent property is a fact.
//   3. THE NAME MAPPING IS LOSSLESS. Round-tripped over EVERY id the walk produced, not over a
//      sample — a misdispatch costs whichever single op happened to collide, so a sample is the
//      one measurement shape that can miss it (Pitfall 8 / T-392-15).

import { asSchema } from 'ai'
import { FunctionScopeSchema, MASKED_RESOLVED_CONFIG_SCHEMA_VERSION } from '@vostride/agent-qa-schema'
import type { FunctionCaller } from '@vostride/agent-qa-schema'
import type { AuditSink } from '@vostride/agent-qa-safety'
import { describe, expect, it } from 'vitest'

import { createFunctionRegistry } from '../../functions/registry.js'
import type { FunctionDeps } from '../../functions/spec.js'
import {
  ANSWER_ONLY_TOOL_NAME,
  CHAT_META_TOOL_NAMES,
  ChatToolNameError,
  MARK_UNHANDLED_TOOL_NAME,
  fromToolName,
  isChatMetaToolName,
  toToolName,
} from '../tool-names.js'
import { projectPlannerTools } from '../planner-tools.js'

function noOpSink(): AuditSink {
  return {
    appendExecutionAudit() {},
    appendGuardrailAudit() {},
  }
}

/**
 * The required deps, at their emptiest.
 *
 * This file's subject is the CATALOGUE, not any op's behaviour: `list()` reads ids, summaries and
 * contract projections, and consults the deps only to answer bound-or-unbound. Handing it richer
 * fakes would add nothing an assertion here could see.
 */
function emptyDeps(): FunctionDeps {
  return {
    runs: {
      list: () => Promise.resolve([]),
      get: () => Promise.resolve(undefined),
      readEvents: () => Promise.resolve([]),
      readStepEvidence: () => Promise.resolve({ kind: 'run-not-recorded' } as const),
    },
    knowledge: {
      listBundles: () => Promise.resolve([]),
      inspectRecords: () => Promise.resolve([]),
      diffSince: () => Promise.resolve([]),
      showRecord: ({ recordId }) =>
        Promise.resolve({ kind: 'not-found', schemaVersion: 1, recordId } as const),
    },
    entities: {
      resolve: () => Promise.resolve({ kind: 'none' as const, reason: 'no-match' as const }),
      get: () => Promise.resolve(undefined),
    },
    config: {
      getMasked: () =>
        Promise.resolve({
          schemaVersion: MASKED_RESOLVED_CONFIG_SCHEMA_VERSION,
          configPath: 'agent-qa.config.yaml',
          entries: [],
        }),
    },
  }
}

/**
 * The planner's caller: agent origin (Pitfall 1), and NOT in safe mode.
 *
 * Safe mode is a cosmetic listing filter, so composing the toolset through a safe-mode caller
 * would hand the model a smaller vocabulary than the host can run — the hidden-door shape the
 * always-send-all law exists to refuse. The composition mints this caller; the walk equivalence
 * below compares against the SAME caller either way, which is why that assertion holds whatever
 * a host decides here.
 */
const PLANNER_CALLER: FunctionCaller = {
  surface: 'chat',
  grantedScopes: [...FunctionScopeSchema.options],
  safeMode: false,
  origin: 'agent',
}

function registry() {
  return createFunctionRegistry({ deps: emptyDeps(), auditSink: noOpSink() })
}

describe('tool-names: the dotted-id <-> provider-safe bijection (Pitfall 8)', () => {
  it('maps the dot taxonomy onto the provider-safe charset', () => {
    expect(toToolName('runs.start')).toBe('runs_start')
    expect(fromToolName('runs_start')).toBe('runs.start')
  })

  it('round-trips EVERY id the registry walk produces, not a sample', () => {
    const ids = registry().list(PLANNER_CALLER).map((declaration) => declaration.id)
    expect(ids.length).toBeGreaterThan(0)
    for (const id of ids) {
      expect(fromToolName(toToolName(id))).toBe(id)
    }
  })

  it('produces a name inside the provider-safe charset for every id in the walk', () => {
    for (const declaration of registry().list(PLANNER_CALLER)) {
      expect(toToolName(declaration.id)).toMatch(/^[a-zA-Z0-9_-]+$/)
    }
  })

  it('refuses an id carrying the separator it would map ONTO, rather than colliding quietly', () => {
    // The mapping is a bijection over the id grammar it accepts, and this is where it says so.
    // An id already carrying an underscore has two pre-images under the inverse, so the honest
    // answer is a named refusal at the projection rather than a tool name that silently
    // misdispatches to whichever op the reverse mapping happened to land on (T-392-15).
    expect(() => toToolName('runs.post_processing')).toThrow(ChatToolNameError)
  })

  it('refuses in BOTH directions on a meta-tool name, so orchestration cannot be read as an op', () => {
    // `answer_only` reverses to `answer.only`, which is a perfectly plausible op id. If the
    // catalogue ever gained one, an orchestration call and a capability call would be the same
    // bytes on the wire — so both halves refuse rather than one.
    expect(() => fromToolName(ANSWER_ONLY_TOOL_NAME)).toThrow(ChatToolNameError)
    expect(() => fromToolName(MARK_UNHANDLED_TOOL_NAME)).toThrow(ChatToolNameError)
    expect(() => toToolName('answer.only')).toThrow(ChatToolNameError)
    expect(() => toToolName('mark.unhandled')).toThrow(ChatToolNameError)
  })

  it('names exactly two meta-tools', () => {
    expect([...CHAT_META_TOOL_NAMES]).toEqual([ANSWER_ONLY_TOOL_NAME, MARK_UNHANDLED_TOOL_NAME])
    expect(isChatMetaToolName(ANSWER_ONLY_TOOL_NAME)).toBe(true)
    expect(isChatMetaToolName('runs_start')).toBe(false)
  })
})

describe('projectPlannerTools: the registry walk IS the toolset (D-07)', () => {
  it('projects every registered op 1:1, plus exactly the two meta-tools, and nothing else', () => {
    const walked = registry().list(PLANNER_CALLER)
    const tools = projectPlannerTools(registry(), PLANNER_CALLER)

    // The denominator is the WALK. No numeric literal appears here on purpose: a count would
    // freeze the catalogue at today's size, and 393-395 add ops whose whole arrival proof is
    // that they appear in this set without anyone editing it (D-07).
    const expected = [
      ...walked.map((declaration) => toToolName(declaration.id)),
      ...CHAT_META_TOOL_NAMES,
    ].sort()

    expect(Object.keys(tools).sort()).toEqual(expected)
  })

  it('includes agent.ask itself — op-calls-op recursion is ordinary composition (D-24)', () => {
    const tools = projectPlannerTools(registry(), PLANNER_CALLER)
    expect(Object.hasOwn(tools, 'agent_ask')).toBe(true)
  })

  it('carries NO execute callback on any tool — nothing can run before reconciliation (D-10)', () => {
    const tools = projectPlannerTools(registry(), PLANNER_CALLER)
    for (const [name, definition] of Object.entries(tools)) {
      expect(
        { name, hasExecute: 'execute' in definition },
      ).toEqual({ name, hasExecute: false })
    }
  })

  it('describes each action tool with the declaration summary a catalogue renders', () => {
    const walked = registry().list(PLANNER_CALLER)
    const tools = projectPlannerTools(registry(), PLANNER_CALLER)
    for (const declaration of walked) {
      const projected = tools[toToolName(declaration.id)]
      expect(projected?.description).toBe(declaration.summary)
    }
  })

  it('gives every action tool the declaration INPUT projection, never an invented schema', async () => {
    const walked = registry().list(PLANNER_CALLER)
    const tools = projectPlannerTools(registry(), PLANNER_CALLER)
    for (const declaration of walked) {
      const projected = tools[toToolName(declaration.id)]
      expect(projected).toBeDefined()
      // Compared as a DOCUMENT rather than by identity: `jsonSchema()` normalises what it is
      // handed, so object identity would be an assertion about the SDK's internals. What matters
      // is that the tool's schema is the declaration's published projection — the same view 396's
      // MCP listing consumes — and not a second one derived here.
      expect(await schemaDocumentOf(projected?.inputSchema)).toEqual(declaration.input)
    }
  })

  it('shapes mark_unhandled as { clause, reason } and answer_only as { text } (CHAT-01/D-08)', async () => {
    const tools = projectPlannerTools(registry(), PLANNER_CALLER)
    const unhandled = tools[MARK_UNHANDLED_TOOL_NAME]
    const answer = tools[ANSWER_ONLY_TOOL_NAME]
    expect(unhandled).toBeDefined()
    expect(answer).toBeDefined()

    const unhandledSchema = await schemaDocumentOf(unhandled?.inputSchema)
    const answerSchema = await schemaDocumentOf(answer?.inputSchema)
    expect(Object.keys(unhandledSchema.properties ?? {}).sort()).toEqual(['clause', 'reason'])
    expect(Object.keys(answerSchema.properties ?? {}).sort()).toEqual(['text'])
  })

  it('walks the registry it was handed, so a host with fewer ops gets fewer tools', () => {
    // The projection holds no catalogue of its own. Handing it a listing source that answers
    // with one declaration produces one action tool — which is the same statement as the walk
    // equivalence above, made from the other side: there is no built-in floor.
    const oneOp = registry().list(PLANNER_CALLER).slice(0, 1)
    const tools = projectPlannerTools({ list: () => oneOp }, PLANNER_CALLER)
    expect(Object.keys(tools).sort()).toEqual(
      [toToolName(oneOp[0]!.id), ...CHAT_META_TOOL_NAMES].sort(),
    )
  })
})

/**
 * The JSON-Schema document behind whatever flexible schema a tool was given.
 *
 * The SDK's own `asSchema` normalises both forms this file produces — a zod object for the two
 * meta-tools, a `jsonSchema()` wrapper for every action tool — so the assertions above read one
 * shape and cannot accidentally be asserting the difference between the two.
 */
async function schemaDocumentOf(
  flexible: unknown,
): Promise<{ properties?: Record<string, unknown> }> {
  const normalised = asSchema(flexible as Parameters<typeof asSchema>[0])
  return (await normalised.jsonSchema) as { properties?: Record<string, unknown> }
}
